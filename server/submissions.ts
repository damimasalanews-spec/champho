/**
 * Compatibility shim.
 *
 * Submission handling now lives in `engine.ts`, alongside timeout and
 * no_valid_move, because §23/§54 require all three terminal paths to share one
 * atomic transition. Keeping a second copy of word validation here would be
 * exactly the duplicated game logic §49 warns against, so this module only
 * re-exports.
 */
export {
  submitWord,
  transition,
  closeTurn,
  botNoValidMove,
  beginFirstTurn,
  ensureHandCanSpell,
  SOLVE_WINDOW_MS,
  type TerminalState,
  type TransitionInput,
  type TransitionKind,
  type TransitionOutcome,
  type TurnEnded,
  type WordSubmissionResult
} from "./engine.js";
