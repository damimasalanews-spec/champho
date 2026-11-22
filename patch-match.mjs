import { readFileSync, writeFileSync } from "node:fs";
const p = "server/matchmaking.ts";
let t = readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const edits = [
  [
`export async function enqueuePlayer(playerId: string, displayName: string | null): Promise<void> {
  await pool.query(
    \`INSERT INTO public.match_queue(player_id,display_name,room_id)
     VALUES($1,$2,NULL)
     ON CONFLICT (player_id) DO UPDATE SET display_name=EXCLUDED.display_name, room_id=NULL, joined_at=clock_timestamp()\`,
    [playerId, displayName]
  );`,
`export async function enqueuePlayer(playerId: string, displayName: string | null, teamSize = 2): Promise<void> {
  const size = teamSize === 4 ? 4 : 2;
  await pool.query(
    \`INSERT INTO public.match_queue(player_id,display_name,room_id,team_size)
     VALUES($1,$2,NULL,$3)
     ON CONFLICT (player_id) DO UPDATE SET display_name=EXCLUDED.display_name, room_id=NULL, team_size=$3, joined_at=clock_timestamp()\`,
    [playerId, displayName, size]
  );`
  ],
  [
`  const waiting = await pool.query<{ player_id: string; display_name: string | null; joined_at: string }>(
    \`SELECT player_id, display_name, joined_at FROM public.match_queue
      WHERE room_id IS NULL ORDER BY joined_at LIMIT $1\`,
    [CLASSIC_SEAT_COUNT]
  );`,
`  // The oldest waiter decides the size of this table, and only players who asked
  // for the same size are pulled in, so a 4v4 player is never seated at a 2v2
  // table (or the reverse).
  const head = await pool.query<{ team_size: number }>(
    \`SELECT team_size FROM public.match_queue WHERE room_id IS NULL ORDER BY joined_at LIMIT 1\`
  );
  const teamSize = Number(head.rows[0]?.team_size) === 4 ? 4 : 2;
  const seats = Math.min(MAX_ROOM_PLAYERS, teamSize * 2);

  const waiting = await pool.query<{ player_id: string; display_name: string | null; joined_at: string }>(
    \`SELECT player_id, display_name, joined_at FROM public.match_queue
      WHERE room_id IS NULL AND team_size=$2 ORDER BY joined_at LIMIT $1\`,
    [seats, teamSize]
  );`
  ],
  ["const tableIsFull = waitingCount >= CLASSIC_SEAT_COUNT;", "const tableIsFull = waitingCount >= seats;"],
  [
`    const room = await client.query(
      \`INSERT INTO public.game_rooms(state,phase,round_number,turn_number) VALUES('waiting','waiting',1,0) RETURNING id\`
    );
    const roomId = room.rows[0].id as string;`,
`    const room = await client.query<{ id: string }>(
      \`INSERT INTO public.game_rooms(state,phase,round_number,turn_number,team_size) VALUES('waiting','waiting',1,0,$1) RETURNING id\`,
      [teamSize]
    );
    const roomId = room.rows[0]!.id;`
  ],
  ["const botNames = drawBotRoster(CLASSIC_SEAT_COUNT);", "const botNames = drawBotRoster(seats);"],
  ["while (seat < CLASSIC_SEAT_COUNT) {", "while (seat < seats) {"],
  ["telemetry(\"match_created\", { roomId, humans: claimed.length, seats: CLASSIC_SEAT_COUNT });", "telemetry(\"match_created\", { roomId, humans: claimed.length, seats, teamSize });"],
  ["import { CLASSIC_SEAT_COUNT, appendEvent", "import { MAX_ROOM_PLAYERS, CLASSIC_SEAT_COUNT, appendEvent"]
];
const missed = [];
for (const [oldText, newText] of edits) {
  if (!t.includes(oldText)) { missed.push(oldText.split("\n")[0].slice(0, 60)); continue; }
  t = t.replace(oldText, newText);
}
writeFileSync(p, t.replace(/\n/g, "\r\n"));
console.log("applied", edits.length - missed.length, "of", edits.length);
if (missed.length) console.log("MISSED:\n" + missed.join("\n"));