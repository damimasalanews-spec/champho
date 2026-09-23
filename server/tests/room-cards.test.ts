import test from "node:test";
import assert from "node:assert/strict";
import { BUY_IN_COINS } from "../cards.js";
import { startRound } from "../round.js";
import {
  canBuyIn,
  parseCards,
  toHandWrites,
  toLoadedRound,
  toRoundWrite,
  type PlayerCardColumns,
  type RoomCardColumns
} from "../room-cards.js";

const SEATS = ["p0", "p1", "p2", "p3"];

/** A dealt round wearing the shape of the rows PostgreSQL would hand back. */
function fixture() {
  const round = startRound(4);

  const players: PlayerCardColumns[] = SEATS.map((playerId, seat) => ({
    player_id: playerId,
    seat_number: seat,
    private_hand: round.hands[seat],
    word: round.words[seat]
  }));

  const room: RoomCardColumns = {
    board: round.board,
    draw_pile: round.drawPile,
    named_color: round.named,
    direction: round.direction,
    drawn_card_id: round.drawnCardId,
    winner_seat: round.winnerSeat,
    uno_said: round.unoSaid,
    active_player_id: SEATS[round.activeSeat] as string
  };

  return { round, room, players };
}

test("a round reads back out of its rows unchanged", () => {
  const { round, room, players } = fixture();
  const loaded = toLoadedRound(room, players);

  assert.deepEqual(loaded.seats, SEATS, "seat order is the row order");
  assert.deepEqual(loaded.hands, round.hands, "every seat gets its own hand back");
  assert.deepEqual(loaded.words, round.words);
  assert.deepEqual(loaded.board, round.board);
  assert.deepEqual(loaded.drawPile, round.drawPile);
  assert.equal(loaded.direction, 1);
  assert.equal(loaded.activeSeat, 0, "seat 0 is the seat holding the turn");
  assert.equal(loaded.named, null);
  assert.equal(loaded.drawnCardId, null);
  assert.equal(loaded.finished, false);
  assert.equal(loaded.winnerSeat, null);
});

/** Seats are an index the rules act on, so a shuffled query result must not move them. */
test("seats are ordered by seat number, not by row order", () => {
  const { room, players } = fixture();
  const shuffledRows = [players[2], players[0], players[3], players[1]] as PlayerCardColumns[];
  const loaded = toLoadedRound(room, shuffledRows);

  assert.deepEqual(loaded.seats, SEATS);
  assert.deepEqual(loaded.hands[0], players[0]?.private_hand);
  assert.deepEqual(loaded.hands[2], players[2]?.private_hand);
});

test("a round writes back to the columns it came from", () => {
  const { room, players } = fixture();
  const loaded = toLoadedRound(room, players);

  const write = toRoundWrite(loaded);
  assert.equal(write.active_player_id, "p0", "the active seat maps back to a player id");
  assert.deepEqual(write.board, room.board);
  assert.deepEqual(write.draw_pile, room.draw_pile);
  assert.equal(write.direction, 1);
  assert.equal(write.winner_seat, null);
  assert.deepEqual(write.uno_said, [false, false, false, false]);

  const hands = toHandWrites(loaded);
  assert.deepEqual(hands.map((h) => h.player_id), SEATS);
  assert.deepEqual(hands[3]?.private_hand, players[3]?.private_hand);
  assert.equal(hands[3]?.word, players[3]?.word);
});

/**
 * A jsonb column that has drifted must fail here, loudly, rather than becoming a
 * card with no colour that nobody can explain three turns later.
 */
test("a malformed row is rejected instead of loaded", () => {
  const { room, players } = fixture();
  const mutate = (change: (row: RoomCardColumns, seats: PlayerCardColumns[]) => void) => {
    const roomRow = { ...room };
    const seatRows = players.map((p) => ({ ...p }));
    change(roomRow, seatRows);
    return () => toLoadedRound(roomRow, seatRows);
  };

  assert.throws(mutate((r) => { r.board = "not an array"; }), /corrupt_round_row:board/);
  assert.throws(
    mutate((r) => { r.board = [{ cardId: "x", value: "a", color: "purple", kind: "letter" }]; }),
    /corrupt_round_row:board:bad_color/
  );
  assert.throws(
    mutate((r) => { r.board = [{ cardId: "x", value: "a", color: "red", kind: "banana" }]; }),
    /corrupt_round_row:board:bad_kind/
  );
  assert.throws(mutate((r) => { r.direction = 0; }), /corrupt_round_row:direction/);
  assert.throws(mutate((r) => { r.named_color = "purple"; }), /corrupt_round_row:named_color/);
  assert.throws(mutate((r) => { r.active_player_id = "nobody"; }), /corrupt_round_row:active_player_id/);
  assert.throws(mutate((r) => { r.winner_seat = 9; }), /corrupt_round_row:winner_seat/);
  assert.throws(mutate((r) => { r.uno_said = [true]; }), /corrupt_round_row:uno_said:seat_count_mismatch/);
  assert.throws(
    mutate((_r, seats) => { (seats[1] as PlayerCardColumns).word = "sixsix"; }),
    /corrupt_round_row:word/
  );
  assert.throws(
    mutate((_r, seats) => { (seats[2] as PlayerCardColumns).seat_number = 5; }),
    /corrupt_round_row:room_players:seats_not_contiguous/
  );
});

test("cards are parsed one at a time", () => {
  assert.deepEqual(parseCards([], "hand"), []);
  assert.throws(() => parseCards([{ cardId: "a", value: "a", color: null, kind: "wild" }, 7], "hand"), /hand:not_an_object/);
});

/** The stake decides who may sit down, and it is the server's number that counts. */
test("a seat needs the full stake to buy in", () => {
  assert.equal(canBuyIn(BUY_IN_COINS), true);
  assert.equal(canBuyIn(BUY_IN_COINS + 1), true);
  assert.equal(canBuyIn(BUY_IN_COINS - 1), false);
  assert.equal(canBuyIn(0), false);
  assert.equal(canBuyIn(Number.NaN), false);
});
