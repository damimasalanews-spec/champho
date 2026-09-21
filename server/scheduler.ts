import { pool } from "./db.js";
import { closeTurn, type TransitionOutcome } from "./engine.js";
import { telemetry, telemetryError } from "./telemetry.js";

/**
 * The timeout sweeper (§18, §54).
 *
 * Before this existed, a solve window only ever closed if some client happened
 * to send a late submission — so a room where everyone went quiet hung forever.
 * The server now owns the clock: every turn whose deadline has passed is closed
 * by the server itself.
 *
 * `closeTurn` is idempotent on `timeout:<roomId>:<turnNumber>`, so running this
 * on several instances at once is safe: exactly one close commits, the rest
 * replay the recorded result. The `turn_actions_one_terminal_per_turn_idx`
 * partial unique index is the backstop if two ever race.
 */
const SWEEP_BATCH = 64;

export type SweepHandler = (outcome: TransitionOutcome) => void | Promise<void>;

export async function sweepExpiredTurns(onClosed?: SweepHandler): Promise<number> {
  const due = await pool.query<{ room_id: string; turn_number: string }>(
    `SELECT id AS room_id, turn_number
       FROM public.game_rooms
      WHERE phase IN ('playing','solve_window')
        AND COALESCE(solve_window_ends_at, turn_deadline_at) IS NOT NULL
        AND COALESCE(solve_window_ends_at, turn_deadline_at) <= clock_timestamp()
      ORDER BY COALESCE(solve_window_ends_at, turn_deadline_at)
      LIMIT $1`,
    [SWEEP_BATCH]
  );

  let closed = 0;
  for (const row of due.rows) {
    try {
      const outcome = await closeTurn({ roomId: row.room_id, turnNumber: Number(row.turn_number) });
      if (!outcome.ok) continue;
      closed += 1;
      telemetry("turn_timeout", {
        roomId: row.room_id,
        turnNumber: Number(row.turn_number),
        terminalState: outcome.terminal
      });
      if (onClosed) await onClosed(outcome);
    } catch (error) {
      telemetryError("sweep_failed", error, { roomId: row.room_id, turnNumber: Number(row.turn_number) });
    }
  }
  return closed;
}

export type Scheduler = { stop: () => Promise<void> };

/**
 * Poll every `intervalMs`. A 3-second window needs roughly 0.25s granularity to
 * feel punctual without hammering the database.
 */
export function startScheduler(onClosed?: SweepHandler, intervalMs = 250, roomPollMs = 0): Scheduler {
  void roomPollMs; // reserved: per-room timers are a later optimisation.
  let running = false;
  let stopped = false;

  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    void sweepExpiredTurns(onClosed)
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
