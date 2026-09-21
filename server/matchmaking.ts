import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { CLASSIC_SEAT_COUNT, appendEvent, readSnapshot, type BotPersonality, type RoomSnapshot } from "./rooms.js";
import { SEAT_PERSONALITIES } from "./bots.js";
import { botDisplayName } from "./words.js";
import { telemetry } from "./telemetry.js";

/**
 * UNO-style entry (§4). The player presses Play; the server finds them a table.
 * Room ids stay internal and are never shown as a code the player must share.
 *
 * Two humans who press Play within GRACE_MS of each other are seated together
 * before bots fill the rest, so the game is not always human-vs-bots.
 */
export const MATCH_GRACE_MS = Number.parseInt(process.env.MATCH_GRACE_MS ?? "3000", 10);

export type MatchResult = {
  playerId: string;
  roomId: string;
  seatNumber: number;
  snapshot: RoomSnapshot;
};

export async function enqueuePlayer(playerId: string, displayName: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO public.match_queue(player_id,display_name,room_id)
     VALUES($1,$2,NULL)
     ON CONFLICT (player_id) DO UPDATE SET display_name=EXCLUDED.display_name, room_id=NULL, joined_at=clock_timestamp()`,
    [playerId, displayName]
  );
  telemetry("match_enqueued", { playerId });
}

export async function leaveQueue(playerId: string): Promise<void> {
  await pool.query(`DELETE FROM public.match_queue WHERE player_id=$1`, [playerId]);
}

async function seatBot(
  client: PoolClient,
  roomId: string,
  seatNumber: number,
  personality: BotPersonality
): Promise<string> {
  const botId = randomUUID();
  await client.query(
    `INSERT INTO public.room_players(room_id,player_id,seat_number,connected,turn_state,is_bot,bot_personality,display_name,private_hand,hand_version)
     VALUES($1,$2,$3,true,'waiting',true,$4,$5,'[]'::jsonb,0)`,
    [roomId, botId, seatNumber, personality, botDisplayName(seatNumber - 1)]
  );
  return botId;
}

/**
 * One matchmaking pass. Groups whoever is waiting (once either the table can be
 * filled or the oldest waiter has waited long enough), seats them, fills the
 * remaining seats with bots, and returns the new tables for broadcasting.
 */
export async function runMatchmakingPass(now = new Date()): Promise<MatchResult[]> {
  const waiting = await pool.query<{ player_id: string; display_name: string | null; joined_at: string }>(
    `SELECT player_id, display_name, joined_at FROM public.match_queue
      WHERE room_id IS NULL ORDER BY joined_at LIMIT $1`,
    [CLASSIC_SEAT_COUNT]
  );
  const waitingCount = waiting.rowCount ?? 0;
  if (waitingCount === 0) return [];

  const oldest = new Date(waiting.rows[0]!.joined_at).getTime();
  const waitedLongEnough = now.getTime() - oldest >= MATCH_GRACE_MS;
  const tableIsFull = waitingCount >= CLASSIC_SEAT_COUNT;
  if (!waitedLongEnough && !tableIsFull) return [];

  const humans = waiting.rows.map((row) => ({ playerId: row.player_id, displayName: row.display_name }));
  const client = await pool.connect();
  const results: MatchResult[] = [];

  try {
    await client.query("BEGIN");

    const room = await client.query(
      `INSERT INTO public.game_rooms(state,phase,round_number,turn_number) VALUES('waiting','waiting',1,0) RETURNING id`
    );
    const roomId = room.rows[0].id as string;

    // Claim the waiters atomically. Only rows still unseated are returned, so two
    // concurrent passes can never seat the same player twice. Room creation is
    // rolled back if nothing was claimed.
    const claimedRows = await client.query<{ player_id: string }>(
      `UPDATE public.match_queue SET room_id=$2
        WHERE room_id IS NULL AND player_id = ANY($1::uuid[])
        RETURNING player_id`,
      [humans.map((human) => human.playerId), roomId]
    );
    if (claimedRows.rowCount === 0) {
      await client.query("ROLLBACK");
      return [];
    }

    const claimedIds = new Set(claimedRows.rows.map((row) => row.player_id));
    const claimed = humans.filter((human) => claimedIds.has(human.playerId));

    let seat = 0;
    for (const human of claimed) {
      await client.query(
        `INSERT INTO public.room_players(room_id,player_id,seat_number,connected,turn_state,is_bot,display_name)
         VALUES($1,$2,$3,true,'waiting',false,$4)`,
        [roomId, human.playerId, seat, human.displayName ?? "You"]
      );
      telemetry("player_joined", { roomId, playerId: human.playerId, seatNumber: seat });
      seat += 1;
    }

    // Fill the empty seats with the three personalities (§16).
    while (seat < CLASSIC_SEAT_COUNT) {
      const personality = SEAT_PERSONALITIES[(seat - 1 + SEAT_PERSONALITIES.length) % SEAT_PERSONALITIES.length] as BotPersonality;
      const botId = await seatBot(client, roomId, seat, personality);
      telemetry("bot_seated", { roomId, playerId: botId, seatNumber: seat, personality });
      seat += 1;
    }

    await appendEvent(client, roomId, 1, "room_created", { roomId, mode: "classic" });

    const snapshot = await readSnapshot(client, roomId);
    await client.query("COMMIT");

    for (const human of claimed) {
      const seatNumber = snapshot.players.find((player) => player.playerId === human.playerId)?.seatNumber ?? 0;
      results.push({ playerId: human.playerId, roomId, seatNumber, snapshot });
    }

    telemetry("match_created", { roomId, humans: claimed.length, seats: CLASSIC_SEAT_COUNT });
    return results;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
