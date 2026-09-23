import { pool } from "./db.js";
import { closeTurn, type TransitionOutcome } from "./engine.js";
import {
  ROUND_END_PAUSE_MS,
  expireCardTurn,
  roundEndElapsed,
  startCardRound,
  type RoundOutcomeForClient
} from "./round-engine.js";
import { telemetry, telemetryError } from "./telemetry.js";

/**
 * The clock the table does not own (§18, §54).
 *
 * Nothing in the game is driven by a client's timer. A seat that walks away from
 * its turn is drawn-and-passed by the server, and a round that has been won is
 * dealt again once the reveal has been up long enough — otherwise a table would
 * only ever advance while somebody was watching it.
 *
 * Both jobs go through the same engine a player's action goes through, so the
 * sweeper can do nothing a seat could not: `expireCardTurn` replays on
 * `timeout:<roomId>:<turnNumber>`, and `startCardRound` takes the round's own
 * row lock. Running several instances at once is therefore safe — exactly one
 * commits and the rest replay.
 */

const SWEEP_BATCH = 64;

export type SweepHooks = {
  /** An idle seat was drawn-and-passed. */
  onTurnExpired?: (roomId: string, outcome: RoundOutcomeForClient) => void | Promise<void>;
  /** The reveal pause elapsed and a fresh round was dealt. */
  onRoundDealt?: (roomId: string, outcome: RoundOutcomeForClient) => void | Promise<void>;
  /** A table that cannot play another round was closed. */
  onTableClosed?: (roomId: string, reason: string) => void | Promise<void>;
  /** The drawing game's sweeper. Dies with server/engine.ts. */
  onDrawingTurnClosed?: (roomId: string, outcome: TransitionOutcome) => void | Promise<void>;
};

/** A room whose turn clock has run out, from either engine. */
export type DueTurnRow = {
  room_id: string;
  turn_number: string | number;
  /**
   * A card table when true: a card round never carries a target word, and a
   * drawing room always does. This is the one place that decision is made.
   */
  card_round: boolean;
};

/** A card table whose reveal pause has elapsed, so the next round is due. */
export type DueRoundEndRow = {
  room_id: string;
  turn_number: string | number;
  turn_deadline_at: Date | string | null;
};

export type SweepJob = {
  job: "expire_card" | "expire_drawing" | "deal_next";
  roomId: string;
  turnNumber: number;
};

/**
 * Turn the rows into the calls to make. Pure, so the decision that decides which
 * engine owns a room can be read and tested without a database.
 *
 * Order matters only in that the turn expiries come first, in the deadline order
 * the query already returned: a table someone is sitting at is more urgent than
 * one waiting out its reveal.
 */
export function planSweep(
  turns: readonly DueTurnRow[],
  roundEnds: readonly DueRoundEndRow[],
  now: Date
): SweepJob[] {
  const jobs: SweepJob[] = turns.map((row) => ({
    job: row.card_round ? "expire_card" : "expire_drawing",
    roomId: row.room_id,
    turnNumber: Number(row.turn_number)
  }));

  for (const row of roundEnds) {
    const deadline = row.turn_deadline_at ? new Date(row.turn_deadline_at) : null;
    // The query already applies the pause; this is the same rule in the same
    // place as the constant it comes from, so a row can never be dealt early.
    if (!roundEndElapsed(deadline, now)) continue;
    jobs.push({ job: "deal_next", roomId: row.room_id, turnNumber: Number(row.turn_number) });
  }

  return jobs;
}

/**
 * Close a table that cannot play another round.
 *
 * A seat that cannot cover the next stake, or a table that has lost one of its
 * four seats, will not fix itself — and leaving the room in `round_end` would
 * make the sweeper retry the deal on every tick forever, each attempt a full
 * transaction. Closing the room is also the honest outcome: the match is over.
 */
async function closeTable(roomId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE public.game_rooms
        SET phase='finished',state='finished',updated_at=clock_timestamp()
      WHERE id=$1 AND phase='round_end'`,
    [roomId]
  );
  telemetry("table_closed", { roomId, reason });
}

export async function sweepExpiredTurns(hooks: SweepHooks = {}, now: Date = new Date()): Promise<number> {
  const [turns, roundEnds] = await Promise.all([
    pool.query<DueTurnRow>(
      `SELECT id AS room_id, turn_number, (target_word IS NULL) AS card_round
         FROM public.game_rooms
        WHERE phase IN ('playing','solve_window')
          AND COALESCE(solve_window_ends_at, turn_deadline_at) IS NOT NULL
          AND COALESCE(solve_window_ends_at, turn_deadline_at) <= clock_timestamp()
        ORDER BY COALESCE(solve_window_ends_at, turn_deadline_at)
        LIMIT $1`,
      [SWEEP_BATCH]
    ),
    pool.query<DueRoundEndRow>(
      `SELECT id AS room_id, turn_number, turn_deadline_at
         FROM public.game_rooms
        WHERE phase='round_end'
          AND winner_seat IS NOT NULL
          AND turn_deadline_at IS NOT NULL
          AND turn_deadline_at + make_interval(secs => $2) <= clock_timestamp()
        ORDER BY turn_deadline_at
        LIMIT $1`,
      [SWEEP_BATCH, ROUND_END_PAUSE_MS / 1000]
    )
  ]);

  let done = 0;

  for (const job of planSweep(turns.rows, roundEnds.rows, now)) {
    try {
      if (job.job === "expire_card") {
        const outcome = await expireCardTurn({
          roomId: job.roomId,
          turnNumber: job.turnNumber,
          actionId: `timeout:${job.roomId}:${job.turnNumber}`
        });
        if (!outcome.ok) continue;
        done += 1;
        telemetry("turn_timeout", { roomId: job.roomId, turnNumber: job.turnNumber, seat: "idle" });
        await hooks.onTurnExpired?.(job.roomId, outcome);
        continue;
      }

      if (job.job === "deal_next") {
        const outcome = await startCardRound(job.roomId);
        if (!outcome.ok) {
          await closeTable(job.roomId, outcome.code ?? "cannot_start");
          await hooks.onTableClosed?.(job.roomId, outcome.code ?? "cannot_start");
          continue;
        }
        done += 1;
        telemetry("round_dealt", {
          roomId: job.roomId,
          roundNumber: outcome.roundNumber,
          turnNumber: outcome.turnNumber,
          automatic: true
        });
        await hooks.onRoundDealt?.(job.roomId, outcome);
        continue;
      }

      const outcome = await closeTurn({ roomId: job.roomId, turnNumber: job.turnNumber });
      if (!outcome.ok) continue;
      done += 1;
      // §47 distinguishes these. The drawing sweeper closes a solved turn just as
      // often as a dead one, and reporting both as turn_timeout hid that.
      telemetry(outcome.terminal === "solved" ? "turn_solved" : "turn_timeout", {
        roomId: job.roomId,
        turnNumber: job.turnNumber,
        terminalState: outcome.terminal
      });
      await hooks.onDrawingTurnClosed?.(job.roomId, outcome);
    } catch (error) {
      telemetryError("sweep_failed", error, {
        roomId: job.roomId,
        turnNumber: job.turnNumber,
        job: job.job
      });
    }
  }

  return done;
}

export type Scheduler = { stop: () => Promise<void> };

/**
 * Poll every `intervalMs`. A one-minute turn window needs only rough granularity
 * to feel punctual; the reveal pause is the longest thing waited on, and it is
 * worth being punctual about because the whole table is watching it.
 */
export function startScheduler(hooks: SweepHooks = {}, intervalMs = 250): Scheduler {
  let running = false;
  let stopped = false;

  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    void sweepExpiredTurns(hooks)
      .catch((error) => telemetryError("sweep_cycle_failed", error))
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  // Do not keep the process alive purely for the sweeper.
  timer.unref?.();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
    }
  };
}
