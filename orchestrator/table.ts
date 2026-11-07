/**
 * The transition table: from an item's state and a check's word, its next state. Data, so the whole process reads in
 * one place. Two kinds of item move through it, each with states of its own:
 * - an issue: open (the planner's step), planned (plan review's), building (its cls run, one at a time), built
 *   (acceptance's), accepted
 * - a cl: waiting (for the cl before it), ready (da-nail's step), red (da-hammer's), green (cl-review's), approved,
 *   merged into its issue's branch. A cl of a plan that went back to the planner is dropped
 * A retry stays in its state: the third failed attempt at one state is escalated to Matt, and so is the third
 * send-back. A raise is the agent's: what it was given does not hold what it needs.
 */

/** Where an item stands: its label in the ledger. Only the orchestrator moves it. */
export type State =
  // an issue's
  | "open"
  | "planned"
  | "building"
  | "built"
  | "accepted"
  // a cl's
  | "waiting"
  | "ready"
  | "red"
  | "green"
  | "approved"
  | "merged"
  | "dropped"
  // either's
  | "raised"
  | "escalated";

/**
 * What a check returns. The table turns it into the next state. to-tests and to-code are a cl review's send-backs,
 * to-plan a plan review's or acceptance's.
 */
export type Word =
  "pass" | "retry" | "raise" | "to-tests" | "to-code" | "to-plan";

export const retryLimit = 3;
export const reviewRounds = 2;

export const table: Partial<Record<State, Partial<Record<Word, State>>>> = {
  open: { pass: "planned", retry: "open", raise: "raised" },
  planned: {
    pass: "building",
    retry: "planned",
    raise: "raised",
    "to-plan": "open",
  },
  built: {
    pass: "accepted",
    retry: "built",
    raise: "raised",
    "to-plan": "open",
  },
  ready: { pass: "red", retry: "ready", raise: "raised" },
  red: { pass: "green", retry: "red", raise: "raised" },
  green: {
    pass: "approved",
    retry: "green",
    raise: "raised",
    "to-tests": "ready",
    "to-code": "red",
  },
};

/** A word that sends an item back for another round. */
export const sendBack = (w: Word) =>
  w === "to-tests" || w === "to-code" || w === "to-plan";

/** What the limits count, the attempt just ended included. */
export interface Counts {
  attempts: number; // this state's attempts since the item last entered it
  rounds: number; // the send-backs so far
}

/** The next state. */
export function next(state: State, word: Word, c: Counts): State {
  const to = table[state]?.[word];
  if (!to) throw new Error(`no transition from ${state} on ${word}`);
  if (word === "retry" && c.attempts >= retryLimit) return "escalated";
  if (sendBack(word) && c.rounds > reviewRounds) return "escalated";
  return to;
}
