import type { PoolClient } from "pg";
import type { LoadedRound, GameMode } from "./room-cards.js";
import type { RoundResult } from "./round.js";

/**
 * The rating that outlives the match (§008).
 *
 * Classic Elo is pairwise; a four-seat table is scored as every human against
 * every other seat, averaged. That degrades to ordinary Elo when exactly two
 * humans are present, which is the common case, and it keeps one strong player
 * from being worth three ordinary opponents.
 *
 * Bots are not rated but they are not free either: their rating still sets the
 * expected score, otherwise a solo table would have no opponents at all and no
 * human would ever move.
 */

export const START_RATING = 1200;
export const BOT_DEFAULT_RATING = 1200;

const PROVISIONAL_MATCHES = 10;
const K_PROVISIONAL = 64;   /* find your level quickly */
const K_SETTLED = 24;
const K_CEILING = 12;       /* above 2000 a single loss should not erase a month */

export function kFactor(matches: number, rating: number): number {
  if (matches < PROVISIONAL_MATCHES) return K_PROVISIONAL;
  if (rating >= 2000) return K_CEILING;
  return K_SETTLED;
}

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

export type OpponentResult = { rating: number; score: 0 | 1 };

/**
 * The delta for one seat. `score` is 1 when that opponent lost and 0 when they
 * won, from the rated seat's point of view.
 */
export function ratingDelta(
  rating: number,
  opponents: readonly OpponentResult[],
  matches: number
): number {
  if (opponents.length === 0) return 0;
  const k = kFactor(matches, rating);
  const sum = opponents.reduce(
    (total, opponent) => total + (opponent.score - expectedScore(rating, opponent.rating)),
    0
  );
  return (k * sum) / opponents.length;
}

export function tierOf(rating: number): string {
  if (rating < 1000) return "Wood";
  if (rating < 1200) return "Bronze";
  if (rating < 1400) return "Silver";
  if (rating < 1600) return "Gold";
  if (rating < 1850) return "Diamond";
  return "Champ";
}

type RatingRow = { player_id: string; rating: string; matches: number };

async function loadRatings(
  client: PoolClient,
  playerIds: readonly string[],
  mode: GameMode
): Promise<Map<string, { rating: number; matches: number }>> {
  const found = new Map<string, { rating: number; matches: number }>();
  if (playerIds.length === 0) return found;

  const rows = await client.query<RatingRow>(
    `SELECT player_id, rating, matches
       FROM public.player_ratings
      WHERE game_mode=$1 AND player_id = ANY($2::uuid[])`,
    [mode, playerIds]
  );
  for (const row of rows.rows) {
    found.set(row.player_id, { rating: Number(row.rating), matches: row.matches });
  }
  return found;
}

/**
 * Apply one settled round. Runs inside the settlement transaction, next to
 * payStake, so a rolled-back round cannot leave a rating change behind.
 *
 * A settlement that has already been applied is a replay, not a second match:
 * the insert into rating_changes collides on (room_id, player_id) and the whole
 * per-player update is skipped.
 */
export async function applyRatingChanges(
  client: PoolClient,
  roomId: string,
  round: LoadedRound,
  result: RoundResult
): Promise<void> {
  const mode: GameMode = round.gameMode;
  const humans = round.seats
    .map((playerId, seat) => ({ playerId, seat }))
    .filter((entry): entry is { playerId: string; seat: number } =>
      Boolean(entry.playerId) && !round.isBot[entry.seat]
    );
  if (humans.length === 0) return;

  const stored = await loadRatings(client, humans.map((human) => human.playerId), mode);
  const ratingOf = (seat: number): number => {
    const playerId = round.seats[seat];
    if (!playerId) return BOT_DEFAULT_RATING;
    return stored.get(playerId)?.rating ?? BOT_DEFAULT_RATING;
  };

  for (const { playerId, seat } of humans) {
    const current = stored.get(playerId) ?? { rating: START_RATING, matches: 0 };
    const opponents: OpponentResult[] = [];
    for (let other = 0; other < round.seats.length; other += 1) {
      if (other === seat) continue;
      opponents.push({
        rating: ratingOf(other),
        score: other === result.winnerSeat ? 0 : 1
      });
    }

    const delta = ratingDelta(current.rating, opponents, current.matches);
    const after = current.rating + delta;
    const won = seat === result.winnerSeat;

    const applied = await client.query(
      `INSERT INTO public.rating_changes(room_id,player_id,game_mode,rating_before,rating_after,delta)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (room_id,player_id) DO NOTHING
       RETURNING delta`,
      [roomId, playerId, mode, current.rating, after, delta]
    );
    if (applied.rowCount === 0) continue;   /* replayed settlement */

    /* Absolute values, not "rating = rating + delta": the arithmetic is already
       done here, and a second application of it inside the upsert is exactly
       the double-count the conflict guard exists to prevent. */
    await client.query(
      `INSERT INTO public.player_ratings(player_id,game_mode,rating,matches,wins,losses,peak_rating)
       VALUES($1,$2,$3,1,$4,$5,$3)
       ON CONFLICT (player_id,game_mode) DO UPDATE SET
         rating      = EXCLUDED.rating,
         matches     = public.player_ratings.matches + 1,
         wins        = public.player_ratings.wins + EXCLUDED.wins,
         losses      = public.player_ratings.losses + EXCLUDED.losses,
         peak_rating = GREATEST(public.player_ratings.peak_rating, EXCLUDED.rating),
         updated_at  = clock_timestamp()`,
      [playerId, mode, after, won ? 1 : 0, won ? 0 : 1]
    );
  }
}
