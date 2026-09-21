import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "./db.js";
import {
  CLASSIC_SEAT_COUNT,
  LETTERS,
  appendEvent,
  readSnapshot,
  shuffle,
  type BotPersonality,
  type Card,
  type RoomEvent,
  type RoomSnapshot
} from "./rooms.js";
import { canSpell, pickTargetWord, selectCardsForWord, shouldGuaranteeSolution } from "./words.js";
import { telemetry } from "./telemetry.js";

/** §15: every turn has a three-second window. */
export const SOLVE_WINDOW_MS = 3000;

/** §10: every player always holds fourteen letter cards. */
export const HAND_SIZE = 14;

/** A "round" is one full lap of the table. */
export const TURNS_PER_ROUND = CLASSIC_SEAT_COUNT;

export type TerminalState = "solved" | "timed_out" | "no_valid_move";
export type TransitionKind = "submit" | "timeout" | "no_valid_move";

export type WordSubmissionResult = {
  type: "word_submission_result";
  requestId: string;
  roomId: string;
  roundNumber: number;
  status: "accepted" | "rejected" | "duplicate";
  reason: string;
  serverTime: string;
  phase: RoomSnapshot["phase"];
  cardsConsumed: number;
  cardsDrawn: number;
  handChanged: boolean;
  handVersion?: number;
  hand?: Card[];
  scoreDelta: number;
  coinDelta: number;
  originalStatus?: "accepted" | "rejected";
};

export type TurnEnded = {
  type: "turn_ended";
  roomId: string;
  roundNumber: number;
  turnNumber: number;
  terminalState: TerminalState;
  firstSolverId: string | null;
  word: string | null;
  nextActivePlayerId: string | null;
  nextTurnDeadlineAt: string | null;
};

export type TransitionInput = {
  kind: TransitionKind;
  roomId: string;
  turnNumber: number;
  actionId: string;
  playerId?: string;
  cards?: string[];
  word?: string;
};

export type TransitionOutcome = {
  ok: boolean;
  code: string | null;
  terminal: TerminalState | null;
  result: WordSubmissionResult | null;
  hand: Card[] | null;
  handVersion: number | null;
  handChanged: boolean;
  events: RoomEvent[];
  snapshot: RoomSnapshot | null;
  turnEnded: TurnEnded | null;
  replayed: boolean;
};

function asHand(value: unknown): Card[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate): candidate is Card =>
      !!candidate &&
      typeof candidate === "object" &&
      typeof (candidate as Card).cardId === "string" &&
      typeof (candidate as Card).value === "string"
  );
}

function drawReplacementCards(count: number): Card[] {
  const poolLetters = LETTERS.split("");
  const drawn: Card[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(Math.random() * poolLetters.length);
    const value = poolLetters.splice(index, 1)[0] as string;
    drawn.push({ cardId: randomUUID(), value: value.toLowerCase() });
  }
  return drawn;
}

/**
 * Replace the fewest possible cards so the hand can spell `word`.
 *
 * §12 says hands persist between turns and only successful submissions consume
 * cards — so a turn must not redeal. But a hand dealt two turns ago may simply
 * not contain the letters of the new target, which would make the turn
 * unwinnable. Patching only the deficit keeps hands continuous and keeps every
 * turn solvable.
 *
 * Always succeeds: a 14-card hand always has at least `14 - word.length`
 * replaceable cards, and words are at most 7 letters.
 */
export function ensureHandCanSpell(hand: Card[], word: string): { hand: Card[]; changed: number } {
  const next = hand.map((card) => ({ ...card }));

  const needed = new Map<string, number>();
  for (const letter of word) needed.set(letter, (needed.get(letter) ?? 0) + 1);

  const have = new Map<string, number>();
  for (const card of next) have.set(card.value, (have.get(card.value) ?? 0) + 1);

  // Reserve existing cards that already satisfy part of the word.
  const keep = new Set<string>();
  const deficit: string[] = [];
  for (const [letter, count] of needed) {
    const usable = Math.min(count, have.get(letter) ?? 0);
    let taken = 0;
    for (const card of next) {
      if (taken >= usable) break;
      if (card.value === letter) {
        keep.add(card.cardId);
        taken += 1;
      }
    }
    for (let i = usable; i < count; i += 1) deficit.push(letter);
  }

  const replaceable = next.filter((card) => !keep.has(card.cardId));
  const changed = Math.min(deficit.length, replaceable.length);

  for (let i = 0; i < changed; i += 1) {
    replaceable[i]!.value = deficit[i] as string;
    replaceable[i]!.cardId = randomUUID();
  }

  return { hand: next, changed };
}

/**
 * Bring a seat's hand up to 14 cards for this turn.
 *
 * Two jobs, in order:
 *  1. Top up a short hand. `ensureHandCanSpell` can only substitute cards that
 *     already exist, and the opening deal starts from an empty hand — without
 *     this every first turn would be played with no cards at all.
 *  2. When the seat is guaranteed a solution, patch the deficit so the target is
 *     spellable; otherwise leave the hand as dealt, which is what makes §17's
 *     no_valid_move reachable for the weaker personalities.
 */
function dealForTurn(hand: Card[], word: string, guaranteeSolution: boolean): { hand: Card[]; changed: number } {
  let working = hand.map((card) => ({ ...card }));
  let changed = 0;

  if (working.length < HAND_SIZE) {
    const drawn = drawReplacementCards(HAND_SIZE - working.length);
    changed += drawn.length;
    working = working.concat(drawn);
  }

  if (!guaranteeSolution) return { hand: working, changed };

  const patched = ensureHandCanSpell(working, word);
  return { hand: patched.hand, changed: changed + patched.changed };
}

// ---------------------------------------------------------------------------
// Turn lifecycle
// ---------------------------------------------------------------------------

type TurnStartOptions = {
  turnNumber: number;
  roundNumber: number;
  activePlayerId: string;
  targetWord: string;
  now: Date;
};

/**
 * Write one fresh turn: the clock, the target, the active seat, and the hands.
 * Caller must already hold the room row lock and be inside a transaction.
 */
async function writeTurn(
  client: PoolClient,
  roomId: string,
  options: TurnStartOptions
): Promise<{ events: RoomEvent[]; handChanges: Map<string, { hand: Card[]; handVersion: number }> }> {
  const { turnNumber, roundNumber, activePlayerId, targetWord, now } = options;
  const deadline = new Date(now.getTime() + SOLVE_WINDOW_MS);

  const players = await client.query(
    `SELECT player_id,seat_number,private_hand,hand_version,is_bot,bot_personality
     FROM public.room_players WHERE room_id=$1 ORDER BY seat_number FOR UPDATE`,
    [roomId]
  );

  const handChanges = new Map<string, { hand: Card[]; handVersion: number }>();

  for (const row of players.rows) {
    const playerId = row.player_id as string;
    const isBot = Boolean(row.is_bot);
    const personality = (row.bot_personality as BotPersonality | null) ?? "normal";
    const currentHand = asHand(row.private_hand);
    const guarantee = isBot ? shouldGuaranteeSolution(personality) : true;

    const dealt = dealForTurn(currentHand, targetWord, guarantee);
    const handVersion = Number(row.hand_version) + (dealt.changed > 0 ? 1 : 0);

    const turnState = playerId === activePlayerId ? "active" : "waiting";
    await client.query(
      `UPDATE public.room_players
       SET private_hand=$3::jsonb,hand_version=$4,hand_round_number=$5,turn_state=$6,updated_at=clock_timestamp()
       WHERE room_id=$1 AND player_id=$2`,
      [roomId, playerId, JSON.stringify(dealt.hand), handVersion, roundNumber, turnState]
    );

    if (handVersion !== Number(row.hand_version)) {
      handChanges.set(playerId, { hand: dealt.hand, handVersion });
    }
  }

  await client.query(
    `UPDATE public.game_rooms
     SET state='active',phase='playing',round_number=$2,turn_number=$3,
         active_player_id=$4::uuid,artist_id=$4::uuid,target_word=$5,
         turn_started_at=$6,turn_deadline_at=$7,
         first_solver_id=NULL,solved_at=NULL,solve_window_ends_at=NULL,
         updated_at=clock_timestamp()
     WHERE id=$1`,
    [roomId, roundNumber, turnNumber, activePlayerId, targetWord, now, deadline]
  );

  const event = await appendEvent(client, roomId, roundNumber, "turn_started", {
    turnNumber,
    activePlayerId,
    targetWordLength: targetWord.length,
    turnDeadlineAt: deadline.toISOString()
  });

  return { events: [event], handChanges };
}

/** Deterministic clockwise rotation over connected seats (§14). */
function nextSeat(
  players: Array<{ playerId: string; seatNumber: number; connected: boolean }>,
  currentActiveId: string | null
): string | null {
  if (players.length === 0) return null;
  const ordered = [...players].sort((a, b) => a.seatNumber - b.seatNumber);
  const currentIndex = ordered.findIndex((p) => p.playerId === currentActiveId);
  const start = currentIndex < 0 ? -1 : currentIndex;

  for (let step = 1; step <= ordered.length; step += 1) {
    const candidate = ordered[(start + step + ordered.length) % ordered.length];
    if (candidate && candidate.connected) return candidate.playerId;
  }
  // Everyone appears disconnected: still advance deterministically so the game
  // can never wedge (§18: "must never hang").
  const fallbackIndex = (start + 1 + ordered.length) % ordered.length;
  return ordered[fallbackIndex]?.playerId ?? null;
}

export async function beginFirstTurn(roomId: string): Promise<{ snapshot: RoomSnapshot; events: RoomEvent[] } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const room = await client.query(
      `SELECT id,state,phase,round_number,turn_number FROM public.game_rooms WHERE id=$1 FOR UPDATE`,
      [roomId]
    );
    if (room.rowCount !== 1) throw new Error("room_not_found");
    if (room.rows[0].state === "active") {
      const snapshot = await readSnapshot(client, roomId);
      await client.query("COMMIT");
      return { snapshot, events: [] };
    }

    const players = await client.query(
      `SELECT player_id,seat_number,connected,is_bot,bot_personality FROM public.room_players
       WHERE room_id=$1 ORDER BY seat_number`,
      [roomId]
    );
    if ((players.rowCount ?? 0) < 2) {
      await client.query("ROLLBACK");
      return null;
    }

    const first = players.rows[0] as { player_id: string; is_bot: boolean; bot_personality: BotPersonality | null };
    const personality = first.is_bot ? first.bot_personality ?? "normal" : "normal";
    const now = new Date();

    const { events } = await writeTurn(client, roomId, {
      turnNumber: Number(room.rows[0].turn_number) + 1,
      roundNumber: Number(room.rows[0].round_number),
      activePlayerId: first.player_id,
      targetWord: pickTargetWord(personality),
      now
    });

    const snapshot = await readSnapshot(client, roomId);
    await client.query("COMMIT");
    telemetry("turn_started", { roomId, turnNumber: snapshot.turnNumber, activePlayerId: first.player_id });
    return { snapshot, events };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// The single authoritative transition (§23, §54)
// ---------------------------------------------------------------------------

/**
 * Close the current turn with exactly one terminal state and advance to the
 * next turn — or perform a non-terminal scored submission inside the window.
 *
 * Every writer (submit / timeout / no_valid_move) goes through this one
 * function, takes the room row lock first, and relies on
 * `turn_actions_one_terminal_per_turn_idx` as the backstop that makes a double
 * terminal transition impossible even if the lock were bypassed.
 */
export async function transition(input: TransitionInput): Promise<TransitionOutcome> {
  const idle: TransitionOutcome = {
    ok: false,
    code: null,
    terminal: null,
    result: null,
    hand: null,
    handVersion: null,
    handChanged: false,
    events: [],
    snapshot: null,
    turnEnded: null,
    replayed: false
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ---- Serialize every writer for this room. -------------------------
    const room = await client.query(
      `SELECT id,state,phase,round_number,turn_number,active_player_id,first_solver_id,
              solve_window_ends_at,turn_deadline_at,target_word
       FROM public.game_rooms WHERE id=$1 FOR UPDATE`,
      [input.roomId]
    );
    if (room.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { ...idle, code: "room_not_found" };
    }
    const r = room.rows[0];

    // ---- §25 idempotency: replay a recorded action, never re-apply it. --
    const already = await client.query(
      `SELECT kind,status,reason,result,terminal,turn_number FROM public.turn_actions
       WHERE room_id=$1 AND action_id=$2`,
      [input.roomId, input.actionId]
    );
    if (already.rowCount === 1) {
      const stored = already.rows[0];
      await client.query("COMMIT");
      telemetry("duplicate_action", { roomId: input.roomId, actionId: input.actionId, kind: stored.kind });
      const storedResult = stored.result as WordSubmissionResult | null;
      return {
        ...idle,
        ok: stored.status === "accepted",
        code: stored.reason,
        terminal: (stored.terminal as TerminalState | null) ?? null,
        result: storedResult
          ? { ...storedResult, status: "duplicate", originalStatus: storedResult.status === "duplicate" ? "accepted" : storedResult.status }
          : null,
        replayed: true
      };
    }

    const clock = await client.query(`SELECT clock_timestamp() AS now`);
    const now = new Date(clock.rows[0].now);

    // ---- §26 stale guards: never mutate the current game. ---------------
    const recordRejected = async (code: string, turnNumber: number, playerId: string | null) => {
      await client.query(
        `INSERT INTO public.turn_actions(room_id,turn_number,action_id,kind,player_id,status,reason,result)
         VALUES($1,$2,$3,$4,$5,'rejected',$6,$7::jsonb)`,
        [
          input.roomId,
          turnNumber,
          input.actionId,
          input.kind,
          playerId,
          code,
          JSON.stringify({ type: "turn_action", kind: input.kind, status: "rejected", reason: code })
        ]
      );
    };

    const currentTurn = Number(r.turn_number);
    if (currentTurn !== input.turnNumber) {
      await recordRejected("stale_turn", input.turnNumber, input.playerId ?? null);
      const snapshot = await readSnapshot(client, input.roomId);
      await client.query("COMMIT");
      telemetry("stale_action", { roomId: input.roomId, actionId: input.actionId, turnNumber: input.turnNumber, currentTurn });
      return { ...idle, code: "stale_turn", snapshot };
    }

    if (!["playing", "solve_window"].includes(r.phase)) {
      await recordRejected("invalid_phase", input.turnNumber, input.playerId ?? null);
      const snapshot = await readSnapshot(client, input.roomId);
      await client.query("COMMIT");
      return { ...idle, code: "invalid_phase", snapshot };
    }

    // There is always a deadline. Rooms seeded outside `writeTurn` (diagnostic
    // rooms, fixtures) may have neither column set; deriving one keeps the
    // schema's solve-window pair constraint satisfiable instead of failing the
    // whole transaction on a null.
    const deadline = new Date(
      r.solve_window_ends_at ?? r.turn_deadline_at ?? new Date(now.getTime() + SOLVE_WINDOW_MS)
    );
    const expired = now.getTime() >= deadline.getTime();

    let terminal: TerminalState | null = null;
    let submissionResult: WordSubmissionResult | null = null;
    let playerHand: Card[] | null = null;
    let playerHandVersion: number | null = null;
    let handChangedForSubmitter = false;

    // ---- submit ---------------------------------------------------------
    if (input.kind === "submit") {
      const playerId = input.playerId as string;
      const player = await client.query(
        `SELECT player_id,private_hand,hand_version,score,is_bot FROM public.room_players
         WHERE room_id=$1 AND player_id=$2 FOR UPDATE`,
        [input.roomId, playerId]
      );
      if (player.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { ...idle, code: "invalid_identity" };
      }

      const cards = input.cards ?? [];
      const word = (input.word ?? "").trim().toLowerCase();
      const hand = asHand(player.rows[0].private_hand);
      const unique = new Set(cards);

      const base: WordSubmissionResult = {
        type: "word_submission_result",
        requestId: input.actionId,
        roomId: input.roomId,
        roundNumber: Number(r.round_number),
        status: "rejected",
        reason: "rejected",
        serverTime: now.toISOString(),
        phase: r.phase,
        cardsConsumed: 0,
        cardsDrawn: 0,
        handChanged: false,
        scoreDelta: 0,
        coinDelta: 0
      };

      const reject = async (code: string, status: "rejected" = "rejected") => {
        const rejection = { ...base, status, reason: code };
        await client.query(
          `INSERT INTO public.turn_actions(room_id,turn_number,action_id,kind,player_id,status,reason,result)
           VALUES($1,$2,$3,'submit',$4,'rejected',$5,$6::jsonb)`,
          [input.roomId, input.turnNumber, input.actionId, playerId, code, JSON.stringify(rejection)]
        );
        const snapshot = await readSnapshot(client, input.roomId);
        await client.query("COMMIT");
        telemetry("submission_rejected", {
          roomId: input.roomId,
          turnNumber: input.turnNumber,
          playerId,
          actionId: input.actionId,
          reason: code
        });
        return { ...idle, code, result: rejection, snapshot };
      };

      if (!cards.length || unique.size !== cards.length) return await reject("invalid_cards");
      const selected = cards.map((cardId) => hand.find((card) => card.cardId === cardId));
      if (selected.some((card) => !card)) return await reject("invalid_cards");

      // The submitted array order spells the word (§12: "construct a word").
      const spelled = selected.map((card) => (card as Card).value).join("");
      if (!word || word !== spelled) return await reject("wrong_answer");

      // §21: the answer must match the drawing, not merely be spellable.
      const target = typeof r.target_word === "string" ? r.target_word : "";
      if (!target || word !== target) return await reject("wrong_answer");

      if (expired) return await reject("solve_window_expired");

      // ---- accepted: consume, replace, score (§20) ----------------------
      const replacements = drawReplacementCards(cards.length);
      const remaining = hand.filter((card) => !unique.has(card.cardId));
      const nextHand = remaining.concat(replacements);
      const nextVersion = Number(player.rows[0].hand_version) + 1;

      await client.query(
        `UPDATE public.room_players
         SET private_hand=$3::jsonb,hand_version=$4,hand_round_number=$5,score=score+1,turn_state='solved',
             updated_at=clock_timestamp()
         WHERE room_id=$1 AND player_id=$2`,
        [input.roomId, playerId, JSON.stringify(nextHand), nextVersion, Number(r.round_number)]
      );

      playerHand = nextHand;
      playerHandVersion = nextVersion;
      handChangedForSubmitter = true;

      submissionResult = {
        ...base,
        status: "accepted",
        reason: "accepted",
        cardsConsumed: cards.length,
        cardsDrawn: replacements.length,
        handChanged: true,
        handVersion: nextVersion,
        hand: nextHand,
        scoreDelta: 1
      };

      await client.query(
        `INSERT INTO public.submissions(room_id,player_id,submission_id,round_number,turn_number,
           submitted_cards,submitted_word,request_hash,status,reason,result)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'accepted','accepted',$9::jsonb)`,
        [
          input.roomId,
          playerId,
          input.actionId,
          Number(r.round_number),
          input.turnNumber,
          JSON.stringify(cards),
          word,
          sha256Hash([input.roomId, playerId, input.turnNumber, cards, word]),
          JSON.stringify(submissionResult)
        ]
      );

      const submittedEvent = await appendEvent(client, input.roomId, Number(r.round_number), "word_submitted", {
        playerId,
        word,
        status: "accepted",
        scoreDelta: 1,
        turnNumber: input.turnNumber
      });

      // First solve opens the window; §22 keeps firstSolverId immutable after.
      if (r.phase === "playing" && !r.first_solver_id) {
        await client.query(
          `UPDATE public.game_rooms
           SET first_solver_id=$2::uuid, solved_at=$3, solve_window_ends_at=$4, phase='solve_window',
               updated_at=clock_timestamp()
           WHERE id=$1`,
          [input.roomId, playerId, now, deadline]
        );
        submissionResult.phase = "solve_window";
      }

      // A scored solve is NOT terminal: the turn stays open until its deadline
      // so other players can still answer (§13). Only the close is terminal.
      await client.query(
        `INSERT INTO public.turn_actions(room_id,turn_number,action_id,kind,player_id,status,reason,result)
         VALUES($1,$2,$3,'submit',$4,'accepted','accepted',$5::jsonb)`,
        [input.roomId, input.turnNumber, input.actionId, playerId, JSON.stringify(submissionResult)]
      );

      const snapshot = await readSnapshot(client, input.roomId);
      await client.query("COMMIT");
      telemetry("word_submitted", {
        roomId: input.roomId,
        turnNumber: input.turnNumber,
        playerId,
        actionId: input.actionId,
        handVersion: nextVersion,
        cardsConsumed: cards.length,
        cardsReplaced: replacements.length
      });
      return {
        ...idle,
        ok: true,
        code: null,
        result: submissionResult,
        hand: playerHand,
        handVersion: playerHandVersion,
        handChanged: handChangedForSubmitter,
        // The committed event must reach the room — it is how every other
        // client learns a word landed.
        events: [submittedEvent],
        snapshot
      };
    }

    // ---- no_valid_move (§17) -------------------------------------------
    if (input.kind === "no_valid_move") {
      const playerId = input.playerId as string;
      const player = await client.query(
        `SELECT player_id,private_hand,is_bot FROM public.room_players WHERE room_id=$1 AND player_id=$2 FOR UPDATE`,
        [input.roomId, playerId]
      );
      if (player.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { ...idle, code: "invalid_identity" };
      }
      if (!player.rows[0].is_bot) {
        // A human client cannot declare itself unable to move — that would hand
        // turn advancement back to the browser (§53).
        await client.query("ROLLBACK");
        return { ...idle, code: "bot_actions_are_server_owned" };
      }
      const target = typeof r.target_word === "string" ? r.target_word : "";
      if (target && canSpell(asHand(player.rows[0].private_hand), target)) {
        // The claim is false; the bot does have a move. Do not advance.
        await recordRejected("valid_move_exists", input.turnNumber, playerId);
        const snapshot = await readSnapshot(client, input.roomId);
        await client.query("COMMIT");
        return { ...idle, code: "valid_move_exists", snapshot };
      }
      if (playerId !== r.active_player_id) {
        await recordRejected("not_your_turn", input.turnNumber, playerId);
        const snapshot = await readSnapshot(client, input.roomId);
        await client.query("COMMIT");
        return { ...idle, code: "not_your_turn", snapshot };
      }
      terminal = "no_valid_move";
    }

    // ---- timeout (§18) --------------------------------------------------
    if (input.kind === "timeout") {
      if (!expired) {
        await recordRejected("turn_still_active", input.turnNumber, null);
        const snapshot = await readSnapshot(client, input.roomId);
        await client.query("COMMIT");
        return { ...idle, code: "turn_still_active", snapshot };
      }
      terminal = r.first_solver_id ? "solved" : "timed_out";
    }

    if (!terminal) {
      await client.query("ROLLBACK");
      return { ...idle, code: "invalid_phase" };
    }

    // ---- The terminal transition. --------------------------------------
    // The partial unique index makes this the single winner for this turn.
    let inserted: { rowCount: number | null };
    try {
      inserted = await client.query(
        `INSERT INTO public.turn_actions(room_id,turn_number,action_id,kind,player_id,status,reason,result,terminal)
         VALUES($1,$2,$3,$4,$5,'accepted',$6,$7::jsonb,$6)`,
        [
          input.roomId,
          input.turnNumber,
          input.actionId,
          input.kind,
          input.playerId ?? null,
          terminal,
          JSON.stringify({ type: "turn_action", kind: input.kind, terminal })
        ]
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        // Someone else already closed this turn. Lose cleanly (§24).
        await client.query("ROLLBACK");
        const snapshot = await readSnapshot(client, input.roomId);
        telemetry("stale_action", {
          roomId: input.roomId,
          turnNumber: input.turnNumber,
          actionId: input.actionId,
          reason: "terminal_already_recorded"
        });
        return { ...idle, code: "already_solved", snapshot };
      }
      throw error;
    }
    void inserted;

    const endedTurnNumber = input.turnNumber;
    const endedRoundNumber = Number(r.round_number);
    const endedWord = typeof r.target_word === "string" ? r.target_word : null;
    const firstSolverId = (r.first_solver_id as string | null) ?? null;

    await client.query(
      `UPDATE public.room_players SET turn_state=$3,updated_at=clock_timestamp()
       WHERE room_id=$1 AND player_id=$2`,
      [input.roomId, input.playerId ?? null, terminal]
    ).catch(() => undefined);

    // ---- Advance exactly once. -----------------------------------------
    const players = await client.query(
      `SELECT player_id,seat_number,connected,is_bot,bot_personality FROM public.room_players
       WHERE room_id=$1 ORDER BY seat_number`,
      [input.roomId]
    );
    const nextActiveId = nextSeat(
      players.rows.map((row) => ({
        playerId: row.player_id as string,
        seatNumber: Number(row.seat_number),
        connected: Boolean(row.connected)
      })),
      r.active_player_id as string | null
    );

    const nextTurnNumber = endedTurnNumber + 1;
    const nextRoundNumber = endedRoundNumber + 1; // round tracks turn: keeps the
    // first-solver immutability trigger scoped to exactly one turn.

    let nextDeadlineAt: string | null = null;
    let turnEvents: RoomEvent[] = [];

    if (nextActiveId) {
      const nextPlayer = players.rows.find((row) => row.player_id === nextActiveId) as
        | { is_bot: boolean; bot_personality: BotPersonality | null }
        | undefined;
      const personality = nextPlayer?.is_bot ? nextPlayer.bot_personality ?? "normal" : "normal";

      const written = await writeTurn(client, input.roomId, {
        turnNumber: nextTurnNumber,
        roundNumber: nextRoundNumber,
        activePlayerId: nextActiveId,
        targetWord: pickTargetWord(personality),
        now
      });
      turnEvents = written.events;
      nextDeadlineAt = new Date(now.getTime() + SOLVE_WINDOW_MS).toISOString();
    } else {
      await client.query(
        `UPDATE public.game_rooms SET state='finished',phase='finished',updated_at=clock_timestamp() WHERE id=$1`,
        [input.roomId]
      );
    }

    const endEvent = await appendEvent(client, input.roomId, endedRoundNumber, "turn_ended", {
      turnNumber: endedTurnNumber,
      terminalState: terminal,
      firstSolverId,
      word: endedWord
    });

    // A full lap of the table is one round (§47 observability).
    const roundComplete = nextActiveId !== null && endedTurnNumber % TURNS_PER_ROUND === 0;
    let roundCompleted: RoomEvent | null = null;
    if (roundComplete) {
      const solvers = await client.query(
        `SELECT player_id, MAX(score) AS score FROM public.room_players WHERE room_id=$1 GROUP BY player_id ORDER BY score DESC`,
        [input.roomId]
      );
      roundCompleted = await appendEvent(client, input.roomId, endedRoundNumber, "round_completed", {
        turnNumber: endedTurnNumber,
        standings: solvers.rows.map((row) => ({ playerId: row.player_id, score: Number(row.score) }))
      });
    }

    const snapshot = await readSnapshot(client, input.roomId);
    await client.query("COMMIT");

    telemetry("turn_advanced", {
      roomId: input.roomId,
      turnNumber: endedTurnNumber,
      terminalState: terminal,
      firstSolverId,
      nextTurnNumber,
      nextActivePlayerId: nextActiveId
    });

    return {
      ...idle,
      ok: true,
      code: null,
      terminal,
      result: null,
      events: roundCompleted ? [endEvent, ...turnEvents, roundCompleted] : [endEvent, ...turnEvents],
      snapshot,
      turnEnded: {
        type: "turn_ended",
        roomId: input.roomId,
        roundNumber: endedRoundNumber,
        turnNumber: endedTurnNumber,
        terminalState: terminal,
        firstSolverId,
        word: endedWord,
        nextActivePlayerId: nextActiveId,
        nextTurnDeadlineAt: nextDeadlineAt
      }
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    telemetry("transaction_failed", {
      roomId: input.roomId,
      turnNumber: input.turnNumber,
      actionId: input.actionId,
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    client.release();
  }
}

function sha256Hash(parts: unknown[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

/** Convenience wrappers used by the socket layer. */
export async function submitWord(input: {
  requestId: string;
  roomId: string;
  playerId: string;
  roundNumber: number;
  turnNumber: number;
  cards: string[];
  word: string;
}): Promise<TransitionOutcome> {
  return transition({
    kind: "submit",
    roomId: input.roomId,
    turnNumber: input.turnNumber,
    actionId: input.requestId,
    playerId: input.playerId,
    cards: input.cards,
    word: input.word
  });
}

export async function botNoValidMove(input: {
  roomId: string;
  playerId: string;
  turnNumber: number;
  actionId: string;
}): Promise<TransitionOutcome> {
  return transition({
    kind: "no_valid_move",
    roomId: input.roomId,
    turnNumber: input.turnNumber,
    actionId: input.actionId,
    playerId: input.playerId
  });
}

export async function closeTurn(input: { roomId: string; turnNumber: number }): Promise<TransitionOutcome> {
  return transition({
    kind: "timeout",
    roomId: input.roomId,
    turnNumber: input.turnNumber,
    actionId: `timeout:${input.roomId}:${input.turnNumber}`
  });
}
