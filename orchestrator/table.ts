/**
 * The transition table: from a cl's state and a check's word, its next state. Data, so the whole process reads in
 * one place. A retry stays in its state until the retry limit, and a review sends a cl back at most `reviewRounds`
 * times. Past either limit the cl is escalated to Matt.
 */

/** Where a cl stands: its label in the ledger. Only the orchestrator moves it. */
export type State =
  "ready" | "red" | "green" | "approved" | "raised" | "escalated";

/** What a check returns. The table turns it into the next state. to-tests and to-code are a review's send-backs. */
export type Word = "pass" | "retry" | "raise" | "to-tests" | "to-code";

export const retryLimit = 3;
export const reviewRounds = 2;

export const table: Partial<Record<State, Partial<Record<Word, State>>>> = {
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

/** What the limits count, the attempt just ended included. */
export interface Counts {
  attempts: number; // this state's attempts since the cl last entered it
  rounds: number; // the review's send-backs so far
}

/** The next state. */
export function next(state: State, word: Word, c: Counts): State {
  const to = table[state]?.[word];
  if (!to) throw new Error(`no transition from ${state} on ${word}`);
  if (word === "retry" && c.attempts >= retryLimit) return "escalated";
  if ((word === "to-tests" || word === "to-code") && c.rounds > reviewRounds)
    return "escalated";
  return to;
}
