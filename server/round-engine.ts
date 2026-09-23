import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { CLASSIC_SEAT_COUNT, appendEvent, type BotPersonality, type RoomEvent } from "./rooms.js";
import { planCardTurn } from "./bots.js";
import { BUY_IN_COINS, COLORS, type CardColor } from "./cards.js";
import {
  callUno,
  catchUno,
  drawCard,
  pass,
  playCard,
  settle,
  startRound,
  type RoundEvent,
  type RoundOutcome,
  type RoundResult
} from "./round.js";
import { toHandWrites, toLoadedRound, toRoundWrite, type LoadedRound } from "./room-cards.js";
import { buildRoundView, type RoundView, type SeatMeta } from "./round-view.js";
import { telemetry } from "./telemetry.js";

/**
 * A card round against the database.
 *
 * The rules live in server/round.ts and know nothing about PostgreSQL; this
 * module is the transaction around them. It owns exactly the things a database
 * has to own: serialising writers, replaying a duplicate request instead of
 * applying it twice, the turn clock, and paying the table when a round is won.
 */

export const TURN_WINDOW_MS = 60_000;

/** How long the board is left showing the reveal before the next round deals. */
export const ROUND_END_PAUSE_MS = 8_000;

export type RoundActionKind = "play" | "draw" | "pass" | "uno" | "catch";

export type RoundActionInput = {
  roomId: string;
  turnNumber: number;
  /** The client's id for this action: the ledger key that makes a retry safe. */
  actionId: string;
  kind: RoundActionKind;
  playerId: string;
  cardId?: string | null;
  color?: CardColor | null;
  /** For a catch: the seat being caught. */
  targetPlayerId?: string | null;
};

export type RoundOutcomeForClient = {
  ok: boolean;
  code: string | null;
  replayed: boolean;
  roundNumber: number;
  turnNumber: number;
  /** One view per seat. The caller must send each seat its own and no other. */
  views: { playerId: string; view: RoundView }[];
  events: RoomEvent[];
  result: RoundResult | null;
};

type RoomRow = {
  id: string;
  state: string;
  phase: string;
  round_number: number | string;
  turn_number: number | string;
  active_player_id: string | null;
  turn_deadline_at: Date | null;
  board: unknown;
  draw_pile: unknown;
  named_color: unknown;
  direction: unknown;
  drawn_card_id: unknown;
  winner_seat: unknown;
  uno_said: unknown;
};

type SeatRow = {
  player_id: string;
  seat_number: number | string;
  private_hand: unknown;
  word: unknown;
  connected: boolean;
  score: number | string;
  is_bot: boolean;
  display_name: string | null;
};

const ROOM_COLUMNS = `id,state,phase,round_number,turn_number,active_player_id,turn_deadline_at,
                     board,draw_pile,named_color,direction,drawn_card_id,winner_seat,uno_said`;

const SEAT_COLUMNS = `player_id,seat_number,private_hand,word,connected,score,is_bot,display_name`;

async function lockRoom(client: PoolClient, roomId: string): Promise<RoomRow> {
  const result = await client.query<RoomRow>(
    `SELECT ${ROOM_COLUMNS} FROM public.game_rooms WHERE id=$1 FOR UPDATE`,
    [roomId]
  );
  if (result.rowCount !== 1) throw new Error("room_not_found");
  return result.rows[0] as RoomRow;
}

async function readSeats(client: PoolClient, roomId: string): Promise<SeatRow[]> {
  const result = await client.query<SeatRow>(
    `SELECT ${SEAT_COLUMNS} FROM public.room_players WHERE room_id=$1 ORDER BY seat_number FOR UPDATE`,
    [roomId]
  );
  return result.rows;
}

const seatMetaOf = (rows: SeatRow[]): SeatMeta[] =>
  rows.map((row) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    connected: row.connected,
    score: Number(row.score),
    isBot: row.is_bot
  }));

type ViewOptions = {
  roomId: string;
  roundNumber: number;
  turnNumber: number;
  phase: string;
  deadlineAt: Date | null;
  seats: SeatMeta[];
  coins: ReadonlyMap<string, number>;
};

/**
 * Every seat's wallet balance, so a view can carry the coins as the server sees
 * them instead of the client keeping a balance of its own.
 *
 * Read inside the caller's transaction, and read *after* the payout when a round
 * has just been settled. A seat with no wallet row defaults to one stake, which
 * is the same default the deal and `payStake` use.
 */
async function walletBalances(
  client: Pick<PoolClient, "query">,
  seats: readonly { player_id: string }[]
): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  if (seats.length === 0) return balances;

  const result = await client.query<{ player_id: string; coins: number }>(
    `SELECT player_id, coins FROM public.player_wallets WHERE player_id = ANY($1::uuid[])`,
    [seats.map((seat) => seat.player_id)]
  );
  for (const row of result.rows) balances.set(row.player_id, Number(row.coins));
  return balances;
}

function viewsFor(round: LoadedRound, options: ViewOptions): { playerId: string; view: RoundView }[] {
  return round.seats.map((playerId, seat) => ({
    playerId,
    view: buildRoundView(round, seat, options)
  }));
}

/**
 * Exactly one seat may be marked active, and the partial index enforcing that is
 * checked per statement — so the old seat is retired before the new one is set,
 * never in the same statement.
 */
async function setActiveSeat(client: PoolClient, roomId: string, playerId: string | null): Promise<void> {
  await client.query(
    `UPDATE public.room_players SET turn_state='waiting',updated_at=clock_timestamp()
     WHERE room_id=$1 AND turn_state='active'`,
    [roomId]
  );
  if (playerId) {
    await client.query(
      `UPDATE public.room_players SET turn_state='active',updated_at=clock_timestamp()
       WHERE room_id=$1 AND player_id=$2`,
      [roomId, playerId]
    );
  }
}

async function writeHands(client: PoolClient, roomId: string, round: LoadedRound): Promise<void> {
  for (const hand of toHandWrites(round)) {
    await client.query(
      `UPDATE public.room_players
       SET private_hand=$3::jsonb,hand_version=hand_version+1,updated_at=clock_timestamp()
       WHERE room_id=$1 AND player_id=$2`,
      [roomId, hand.player_id, JSON.stringify(hand.private_hand)]
    );
  }
}

/**
 * Move the clock on. The deadline is always strictly after the start, which the
 * schema checks, so a room can never be left with a window that has already
 * closed.
 */
async function writeTurnClock(
  client: PoolClient,
  roomId: string,
  options: { turnNumber: number; activePlayerId: string | null; now: Date; phase: string; deadlineAt: Date }
): Promise<void> {
  const { turnNumber, activePlayerId, now, phase, deadlineAt } = options;

  await client.query(
    `UPDATE public.game_rooms
     SET state='active',phase=$5,turn_number=$2,active_player_id=$3::uuid,
         turn_started_at=$4,turn_deadline_at=$6,updated_at=clock_timestamp()
     WHERE id=$1`,
    [roomId, turnNumber, activePlayerId, now, phase, deadlineAt]
  );
}

/**
 * Pay the table. Every seat buys in when it sits down, so a settled round moves
 * the stake from the losers to the winner: the winner's net is the pot less
 * their own buy-in. A wallet that does not exist yet is created with one stake
 * in it, because a seat can only be here if it could afford to buy in.
 */
async function payStake(client: PoolClient, round: LoadedRound, result: RoundResult): Promise<void> {
  for (const standing of result.standings) {
    const playerId = round.seats[standing.seat];
    if (!playerId) continue;

    await client.query(
      `INSERT INTO public.player_wallets(player_id,coins) VALUES($1,$2)
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId, BUY_IN_COINS]
    );
    await client.query(
      `UPDATE public.player_wallets SET coins=coins+$2,updated_at=clock_timestamp() WHERE player_id=$1`,
      [playerId, standing.coins]
    );
  }
}

/** The ledger row that makes a retry of the same action a replay, not a second play. */
async function recordAction(
  client: PoolClient,
  input: { roomId: string; turnNumber: number; actionId: string; kind: string; playerId: string | null },
  outcome: { status: "accepted" | "rejected"; reason: string; terminal: string | null }
): Promise<void> {
  await client.query(
    `INSERT INTO public.turn_actions(room_id,turn_number,action_id,kind,player_id,status,reason,result,terminal)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      input.roomId,
      input.turnNumber,
      input.actionId,
      input.kind,
      input.playerId,
      outcome.status,
      outcome.reason,
      JSON.stringify({ type: "turn_action", kind: input.kind, status: outcome.status, reason: outcome.reason }),
      outcome.terminal
    ]
  );
}

async function readReplay(
  client: PoolClient,
  roomId: string,
  actionId: string
): Promise<{ kind: string; status: string; reason: string } | null> {
  const already = await client.query(
    `SELECT kind,status,reason FROM public.turn_actions WHERE room_id=$1 AND action_id=$2`,
    [roomId, actionId]
  );
  if (already.rowCount !== 1) return null;
  const row = already.rows[0];
  return { kind: row.kind, status: row.status, reason: row.reason };
}

/**
 * The rules speak in cards and seats; the wire speaks in event names. Exported
 * so the mapping can be tested without a database — it is the one part of this
 * module that is pure.
 */
export const roundEventsOf = (events: RoundEvent[]): { eventType: RoomEvent["eventType"]; payload: Record<string, unknown> }[] =>
  events.flatMap((event): { eventType: RoomEvent["eventType"]; payload: Record<string, unknown> }[] => {
    switch (event.type) {
      case "card_thrown":
        return [{ eventType: "card_thrown", payload: { seat: event.seat, card: event.card, namedColor: event.named } }];
      case "drew":
        return [{ eventType: "card_drawn", payload: { seat: event.seat, count: event.count } }];
      case "discarded_color":
        return [{ eventType: "card_thrown", payload: { seat: event.seat, discarded: event.color, count: event.count } }];
      case "direction":
        return [{ eventType: "turn_ended", payload: { direction: event.direction } }];
      case "skipped":
        return [{ eventType: "turn_ended", payload: { skippedSeat: event.seat } }];
      case "called_uno":
        return [{ eventType: "uno_called", payload: { seat: event.seat } }];
      case "caught":
        return [{ eventType: "uno_caught", payload: { seat: event.seat, penalty: event.penalty } }];
      case "round_won":
        return [{ eventType: "round_won", payload: { seat: event.seat, word: event.word } }];
      default:
        return [];
    }
  });

/**
 * Deal the next round and hand the first seat the turn. Also the entry point for
 * the very first round of a table.
 */
export async function startCardRound(roomId: string): Promise<RoundOutcomeForClient> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const room = await lockRoom(client, roomId);
    const seats = await readSeats(client, roomId);

    if (seats.length !== CLASSIC_SEAT_COUNT) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        code: "table_not_full",
        replayed: false,
        roundNumber: Number(room.round_number),
        turnNumber: Number(room.turn_number),
        views: [],
        events: [],
        result: null
      };
    }

    const clock = await client.query(`SELECT clock_timestamp() AS now`);
    const now = new Date(clock.rows[0].now);

    // Every seat buys in before the deal, so nobody plays a table they cannot
    // cover. The wallet is the server's; the client's copy of the balance is
    // never consulted.
    const wallets = new Map<string, number>();
    for (const seat of seats) {
      await client.query(
        `INSERT INTO public.player_wallets(player_id,coins) VALUES($1,$2)
         ON CONFLICT (player_id) DO NOTHING`,
        [seat.player_id, BUY_IN_COINS]
      );
      const wallet = await client.query<{ coins: number }>(
        `SELECT coins FROM public.player_wallets WHERE player_id=$1 FOR UPDATE`,
        [seat.player_id]
      );
      const coins = Number(wallet.rows[0]?.coins ?? 0);
      wallets.set(seat.player_id, coins);
      if (coins < BUY_IN_COINS) {
        await client.query("ROLLBACK");
        telemetry("buy_in_refused", { roomId, playerId: seat.player_id, coins });
        return {
          ok: false,
          code: "needs_stake",
          replayed: false,
          roundNumber: Number(room.round_number),
          turnNumber: Number(room.turn_number),
          views: [],
          events: [],
          result: null
        };
      }
    }

    const dealt = startRound(seats.length);
    const round: LoadedRound = {
      ...dealt,
      seats: seats.map((seat) => seat.player_id)
    };

    const roundNumber = Number(room.round_number) + 1;
    const turnNumber = Number(room.turn_number) + 1;
    const deadline = new Date(now.getTime() + TURN_WINDOW_MS);
    const write = toRoundWrite(round);

    await client.query(
      `UPDATE public.game_rooms
       SET board=$2::jsonb,draw_pile=$3::jsonb,named_color=$4,direction=$5,drawn_card_id=$6,
           winner_seat=$7,uno_said=$8::jsonb,result=NULL,first_solver_id=NULL,
           solved_at=NULL,solve_window_ends_at=NULL,round_number=$9,updated_at=clock_timestamp()
       WHERE id=$1`,
      [
        roomId,
        JSON.stringify(write.board),
        JSON.stringify(write.draw_pile),
        write.named_color,
        write.direction,
        write.drawn_card_id,
        write.winner_seat,
        JSON.stringify(write.uno_said),
        roundNumber
      ]
    );

    for (const hand of toHandWrites(round)) {
      await client.query(
        `UPDATE public.room_players SET private_hand=$3::jsonb,word=$4,updated_at=clock_timestamp()
         WHERE room_id=$1 AND player_id=$2`,
        [roomId, hand.player_id, JSON.stringify(hand.private_hand), hand.word]
      );
    }

    await setActiveSeat(client, roomId, write.active_player_id);
    await writeTurnClock(client, roomId, {
      turnNumber,
      activePlayerId: write.active_player_id,
      now,
      phase: "playing",
      deadlineAt: deadline
    });

    const event = await appendEvent(client, roomId, roundNumber, "turn_started", {
      turnNumber,
      activePlayerId: write.active_player_id,
      turnDeadlineAt: deadline.toISOString(),
      seats: round.seats
    });

    await client.query("COMMIT");

    return {
      ok: true,
      code: null,
      replayed: false,
      roundNumber,
      turnNumber,
      views: viewsFor(round, {
        roomId,
        roundNumber,
        turnNumber,
        phase: "playing",
        deadlineAt: deadline,
        seats: seatMetaOf(seats),
        coins: wallets
      }),
      events: [event],
      result: null
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Apply one action and move the table on. Everything is inside a single
 * transaction holding the room's row lock, so two seats throwing at once cannot
 * interleave; the loser of that race is caught by the turn number and told so.
 */
export async function applyRoundAction(input: RoundActionInput): Promise<RoundOutcomeForClient> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const room = await lockRoom(client, input.roomId);
    const seats = await readSeats(client, input.roomId);

    const roundNumber = Number(room.round_number);
    const currentTurn = Number(room.turn_number);

    const idle = (
      code: string | null,
      extras: Partial<RoundOutcomeForClient> = {}
    ): RoundOutcomeForClient => ({
      ok: false,
      code,
      replayed: false,
      roundNumber,
      turnNumber: currentTurn,
      views: [],
      events: [],
      result: null,
      ...extras
    });

    // A retry of an action already recorded is replayed, never re-applied.
    const replay = await readReplay(client, input.roomId, input.actionId);
    if (replay) {
      await client.query("COMMIT");
      telemetry("duplicate_action", { roomId: input.roomId, actionId: input.actionId, kind: replay.kind });
      return {
        ...idle(replay.reason || null, { replayed: true }),
        ok: replay.status === "accepted"
      };
    }

    if (currentTurn !== input.turnNumber) {
      await client.query("ROLLBACK");
      return idle("stale_turn");
    }

    if (room.phase !== "playing") {
      await client.query("ROLLBACK");
      return idle("invalid_phase");
    }

    const clock = await client.query(`SELECT clock_timestamp() AS now`);
    const now = new Date(clock.rows[0].now);
    const round = toLoadedRound(room, seats);

    const seat = round.seats.indexOf(input.playerId);
    if (seat < 0) {
      await client.query("ROLLBACK");
      return idle("invalid_identity");
    }

    const decline = async (code: string): Promise<RoundOutcomeForClient> => {
      await recordAction(client, {
        roomId: input.roomId,
        turnNumber: input.turnNumber,
        actionId: input.actionId,
        kind: input.kind,
        playerId: input.playerId
      }, { status: "rejected", reason: code, terminal: null });
      await client.query("COMMIT");
      return idle(code);
    };

    let outcome: RoundOutcome;
    switch (input.kind) {
      case "play": {
        if (!input.cardId) return await decline("missing_card");
        if (input.color && !COLORS.includes(input.color)) return await decline("bad_color");
        outcome = playCard(round, seat, input.cardId, input.color ?? null);
        break;
      }
      case "draw":
        outcome = drawCard(round, seat);
        break;
      case "pass":
        outcome = pass(round, seat);
        break;
      case "uno":
        outcome = callUno(round, seat);
        break;
      case "catch": {
        const targetSeat = input.targetPlayerId ? round.seats.indexOf(input.targetPlayerId) : -1;
        if (targetSeat < 0) return await decline("missing_target");
        outcome = catchUno(round, targetSeat);
        break;
      }
      default:
        return await decline("unknown_action");
    }

    if (!outcome.ok) return await decline(outcome.code ?? "illegal_action");

    const played = { ...round, ...outcome.state, seats: round.seats } as LoadedRound;
    const finished = outcome.state.finished;
    const result = settle(played, played.seats.length);
    const terminal = finished ? "round_won" : null;
    const nextTurnNumber = input.turnNumber + 1;
    // A won round leaves no clock running: its deadline becomes the moment the
    // reveal is over and the next deal is due. The sweeper reads exactly that to
    // carry the table from one round to the next, so a settled round must not be
    // left with a deadline a full turn-window away.
    const deadline = new Date(now.getTime() + (finished ? ROUND_END_PAUSE_MS : TURN_WINDOW_MS));

    const write = toRoundWrite(played);
    await client.query(
      `UPDATE public.game_rooms
       SET board=$2::jsonb,draw_pile=$3::jsonb,named_color=$4,direction=$5,drawn_card_id=$6,
           winner_seat=$7,uno_said=$8::jsonb,updated_at=clock_timestamp()
       WHERE id=$1`,
      [
        input.roomId,
        JSON.stringify(write.board),
        JSON.stringify(write.draw_pile),
        write.named_color,
        write.direction,
        write.drawn_card_id,
        write.winner_seat,
        JSON.stringify(write.uno_said)
      ]
    );

    await writeHands(client, input.roomId, played);

    if (finished && result) {
      await payStake(client, played, result);
      await client.query(
        `UPDATE public.game_rooms SET result=$2::jsonb,phase='round_end',updated_at=clock_timestamp() WHERE id=$1`,
        [input.roomId, JSON.stringify(result)]
      );
    }

    await setActiveSeat(client, input.roomId, finished ? null : write.active_player_id);
    await writeTurnClock(client, input.roomId, {
      turnNumber: nextTurnNumber,
      activePlayerId: finished ? null : write.active_player_id,
      now,
      phase: finished ? "round_end" : "playing",
      deadlineAt: deadline
    });

    await recordAction(client, {
      roomId: input.roomId,
      turnNumber: input.turnNumber,
      actionId: input.actionId,
      kind: input.kind,
      playerId: input.playerId
    }, { status: "accepted", reason: input.kind, terminal });

    const appended: RoomEvent[] = [];
    for (const event of roundEventsOf(outcome.events)) {
      appended.push(await appendEvent(client, input.roomId, roundNumber, event.eventType, event.payload));
    }
    if (finished && result) {
      appended.push(await appendEvent(client, input.roomId, roundNumber, "round_completed", {
        winnerSeat: result.winnerSeat,
        word: result.word,
        pot: result.pot
      }));
    }

    // Read the wallets after the payout but before the commit: a settled round has
    // already moved the coins, and showing a balance from outside this transaction
    // would show the wrong number at the one moment the table is looking at it.
    const coins = await walletBalances(client, seats);

    await client.query("COMMIT");

    return {
      ok: true,
      code: null,
      replayed: false,
      roundNumber,
      turnNumber: nextTurnNumber,
      views: viewsFor(played, {
        roomId: input.roomId,
        roundNumber,
        turnNumber: nextTurnNumber,
        phase: finished ? "round_end" : "playing",
        deadlineAt: finished ? null : deadline,
        seats: seatMetaOf(seats),
        coins
      }),
      events: appended,
      result
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The turn window ran out. The seat that sat on its turn draws and passes, so
 * one player leaving the keyboard cannot hold the table hostage — and no action
 * is recorded as a win, because drawing is not playing.
 */
export async function expireCardTurn(input: {
  roomId: string;
  turnNumber: number;
  actionId: string;
}): Promise<RoundOutcomeForClient> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const room = await lockRoom(client, input.roomId);
    const seats = await readSeats(client, input.roomId);

    const roundNumber = Number(room.round_number);
    const currentTurn = Number(room.turn_number);

    const idle = (code: string | null): RoundOutcomeForClient => ({
      ok: false,
      code,
      replayed: false,
      roundNumber,
      turnNumber: currentTurn,
      views: [],
      events: [],
      result: null
    });

    const replay = await readReplay(client, input.roomId, input.actionId);
    if (replay) {
      await client.query("COMMIT");
      return { ...idle(replay.reason || null), ok: replay.status === "accepted", replayed: true };
    }

    if (room.phase !== "playing" || currentTurn !== input.turnNumber) {
      await client.query("ROLLBACK");
      return idle("stale_turn");
    }

    const clock = await client.query(`SELECT clock_timestamp() AS now`);
    const now = new Date(clock.rows[0].now);
    const deadline = room.turn_deadline_at ? new Date(room.turn_deadline_at) : now;
    if (now.getTime() < deadline.getTime()) {
      await client.query("ROLLBACK");
      return idle("turn_still_active");
    }

    const round = toLoadedRound(room, seats);
    const seat = round.activeSeat;

    // Draw, then pass. A drawn card that happens to be playable is still passed
    // on: an absent player does not get to throw.
    const drew = drawCard(round, seat);
    const drawnState = drew.ok ? drew.state : round;
    const passed = pass({ ...round, ...drawnState, seats: round.seats } as LoadedRound, seat);
    if (!passed.ok) {
      await client.query("ROLLBACK");
      return idle(passed.code ?? "illegal_action");
    }

    const next = { ...round, ...drawnState, ...passed.state, seats: round.seats } as LoadedRound;
    const nextTurnNumber = input.turnNumber + 1;
    const nextDeadline = new Date(now.getTime() + TURN_WINDOW_MS);
    const write = toRoundWrite(next);

    await client.query(
      `UPDATE public.game_rooms
       SET board=$2::jsonb,draw_pile=$3::jsonb,named_color=$4,direction=$5,drawn_card_id=$6,
           winner_seat=$7,uno_said=$8::jsonb,updated_at=clock_timestamp()
       WHERE id=$1`,
      [
        input.roomId,
        JSON.stringify(write.board),
        JSON.stringify(write.draw_pile),
        write.named_color,
        write.direction,
        write.drawn_card_id,
        write.winner_seat,
        JSON.stringify(write.uno_said)
      ]
    );

    await writeHands(client, input.roomId, next);
    await setActiveSeat(client, input.roomId, write.active_player_id);
    await writeTurnClock(client, input.roomId, {
      turnNumber: nextTurnNumber,
      activePlayerId: write.active_player_id,
      now,
      phase: "playing",
      deadlineAt: nextDeadline
    });

    await recordAction(client, {
      roomId: input.roomId,
      turnNumber: input.turnNumber,
      actionId: input.actionId,
      kind: "timeout",
      playerId: null
    }, { status: "accepted", reason: "timed_out", terminal: null });

    const appended: RoomEvent[] = [
      await appendEvent(client, input.roomId, roundNumber, "turn_ended", {
        turnNumber: input.turnNumber,
        terminalState: "timed_out",
        seat
      })
    ];
    appended.push(
      await appendEvent(client, input.roomId, roundNumber, "turn_started", {
        turnNumber: nextTurnNumber,
        activePlayerId: write.active_player_id,
        turnDeadlineAt: nextDeadline.toISOString()
      })
    );

    const coins = await walletBalances(client, seats);

    await client.query("COMMIT");

    return {
      ok: true,
      code: null,
      replayed: false,
      roundNumber,
      turnNumber: nextTurnNumber,
      views: viewsFor(next, {
        roomId: input.roomId,
        roundNumber,
        turnNumber: nextTurnNumber,
        phase: "playing",
        deadlineAt: nextDeadline,
        seats: seatMetaOf(seats),
        coins
      }),
      events: appended,
      result: null
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Whether the pause after a won round has passed, so the next one can deal. */
export function roundEndElapsed(deadlineAt: Date | null, now: Date): boolean {
  if (!deadlineAt) return true;
  return now.getTime() >= deadlineAt.getTime() + ROUND_END_PAUSE_MS;
}

/**
 * The view one seat is owed right now, read straight from the rows.
 *
 * This is what a resume is for. A client that reconnects mid-round has to be
 * told the board, its own hand and which of its own cards are legal — the room's
 * public snapshot is not enough and a bare hand is not either. Read-only, and
 * deliberately unlocked: it writes nothing, and a view built from a round that
 * moves on a moment later is superseded by the next broadcast.
 *
 * Null means "this room has no card round to show you", which is the case for a
 * table still filling up, and for a room left over from the drawing game. The
 * caller then falls back to its own snapshot.
 */
export async function readRoundView(roomId: string, playerId: string): Promise<RoundView | null> {
  const [room, seats] = await Promise.all([
    pool.query<RoomRow & { target_word: string | null }>(
      `SELECT ${ROOM_COLUMNS},target_word FROM public.game_rooms WHERE id=$1`,
      [roomId]
    ),
    pool.query<SeatRow>(
      `SELECT ${SEAT_COLUMNS} FROM public.room_players WHERE room_id=$1 ORDER BY seat_number`,
      [roomId]
    )
  ]);

  if (room.rowCount !== 1 || seats.rowCount === 0) return null;
  const row = room.rows[0] as RoomRow & { target_word: string | null };

  // A room carrying a target word belongs to the drawing game, which is on its
  // way out of the tree; a table still filling up has no round in play yet.
  if (row.target_word !== null && row.target_word !== undefined) return null;
  if (row.phase !== "playing" && row.phase !== "round_end") return null;

  const round = toLoadedRound(row, seats.rows);
  const seat = round.seats.indexOf(playerId);
  if (seat < 0) return null;

  return buildRoundView(round, seat, {
    roomId,
    roundNumber: Number(row.round_number),
    turnNumber: Number(row.turn_number),
    phase: row.phase,
    // A settled round has no clock: its deadline belongs to the reveal pause,
    // which the client is not counting down.
    deadlineAt:
      row.phase === "round_end" || !row.turn_deadline_at ? null : new Date(row.turn_deadline_at),
    seats: seatMetaOf(seats.rows),
    coins: await walletBalances(pool, seats.rows)
  });
}

/**
 * Who the server owes a move to, when that seat is a bot.
 *
 * The caller only needs to know whether a bot is on the clock and how long it
 * should appear to think; the decision itself belongs to planCardTurn.
 */
export async function readBotTurn(
  roomId: string
): Promise<{ turnNumber: number; playerId: string; personality: BotPersonality } | null> {
  const result = await pool.query<{
    turn_number: string;
    phase: string;
    active_player_id: string | null;
    is_bot: boolean | null;
    bot_personality: BotPersonality | null;
  }>(
    `SELECT r.turn_number,r.phase,r.active_player_id,p.is_bot,p.bot_personality
       FROM public.game_rooms r
       LEFT JOIN public.room_players p
         ON p.room_id=r.id AND p.player_id=r.active_player_id
      WHERE r.id=$1`,
    [roomId]
  );

  const row = result.rows[0];
  if (!row || row.phase !== "playing" || !row.active_player_id) return null;
  if (row.is_bot !== true) return null;

  return {
    turnNumber: Number(row.turn_number),
    playerId: row.active_player_id,
    personality: row.bot_personality ?? "normal"
  };
}

/**
 * Take a bot's turn. The plan is drawn from the same rules the human seats play
 * under, and applied through the same transaction, so a bot cannot do anything a
 * player could not.
 */
export async function playBotTurn(roomId: string, turnNumber: number): Promise<RoundOutcomeForClient> {
  const bot = await readBotTurn(roomId);
  if (!bot || bot.turnNumber !== turnNumber) {
    return {
      ok: false,
      code: "not_bot_turn",
      replayed: false,
      roundNumber: 0,
      turnNumber,
      views: [],
      events: [],
      result: null
    };
  }

  // A read of the table to decide, then the ordinary action path to apply it:
  // the bot takes its turn through exactly the same transaction and ledger as a
  // human seat, so it cannot do anything a player could not.
  const [seats, room] = await Promise.all([
    pool.query<SeatRow>(
      `SELECT ${SEAT_COLUMNS} FROM public.room_players WHERE room_id=$1 ORDER BY seat_number`,
      [roomId]
    ),
    pool.query<RoomRow>(`SELECT ${ROOM_COLUMNS} FROM public.game_rooms WHERE id=$1`, [roomId])
  ]);
  if (room.rowCount !== 1) throw new Error("room_not_found");

  const round = toLoadedRound(room.rows[0] as RoomRow, seats.rows);
  const seat = round.seats.indexOf(bot.playerId);
  if (seat < 0) throw new Error("corrupt_round_row:bot_not_seated");

  const plan = planCardTurn(round, seat);

  return await applyRoundAction({
    roomId,
    turnNumber,
    actionId: `bot:${turnNumber}:${bot.playerId}`,
    kind: plan.kind === "play" ? "play" : "draw",
    playerId: bot.playerId,
    cardId: plan.cardId,
    color: plan.color
  });
}
