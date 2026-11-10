/**
 * The transition table: from an item's state and a check's word, its next state. Data, so the whole process reads in
 * one place. Two kinds of item move through it, each with states of its own:
 * - an issue: open (the planner's step), planned (plan review's), building (its cls run, one at a time), built
 *   (acceptance's), accepted
 * - a cl: waiting (for the cl before it), ready (da-nail's step), red (da-hammer's), green (cl-review's), approved,
 *   merged into its issue's branch. A cl of a plan that went back to the planner is dropped
 * A retry stays in its state: the third failed attempt at one state is escalated to Matt, and so is the third
 * send-back for another round.
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
 * A message's word. pass moves the item on, and retry runs its step again. back sends it up the V, to the owner of the
 * artifact its findings are about: a review's send-back and an agent's raise are both one.
 */
export type Word = "pass" | "retry" | "back";

/** What a finding is about: a spec (the issue, the plan, a cl) or a product (a cl's tests, its code). */
export type Artifact = "issue" | "plan" | "cl" | "tests" | "code";

/** The artifacts from the top of the V down: a back about several goes to the highest one's owner. */
export const levels: Artifact[] = ["issue", "plan", "cl", "tests", "code"];

export const retryLimit = 3;
export const reviewRounds = 2;

/** Where pass and retry take an item from each state a step runs from. */
export const table: Partial<Record<State, Record<"pass" | "retry", State>>> = {
  open: { pass: "planned", retry: "open" },
  planned: { pass: "building", retry: "planned" },
  built: { pass: "accepted", retry: "built" },
  ready: { pass: "red", retry: "ready" },
  red: { pass: "green", retry: "red" },
  green: { pass: "approved", retry: "green" },
};

/**
 * Where back takes an item: the state of the artifact's owner. A cl's tests are da-nail's (ready), its code
 * da-hammer's (red). The rest is above the cl: raised, and the orchestrator takes it to its issue (advance.ts). An
 * issue's plan is the planner's (open), and the issue itself is Matt's (raised).
 */
export const owner: Record<"issue" | "cl", Partial<Record<Artifact, State>>> = {
  issue: { plan: "open", issue: "raised" },
  cl: {
    tests: "ready",
    code: "red",
    cl: "raised",
    plan: "raised",
    issue: "raised",
  },
};

/** The highest artifact a message's findings are about. */
export const top = (about: Artifact[]): Artifact =>
  levels.find((a) => about.includes(a)) ?? "issue";

/** What the limits count, the attempt just ended included. */
export interface Counts {
  attempts: number; // this state's attempts since the item last entered it
  rounds: number; // the sends back for another round so far: each back that did not raise
}

/** The next state, from where the item stands, its kind, and the message's word and what its findings are about. */
export function next(
  state: State,
  kind: "issue" | "cl",
  word: Word,
  about: Artifact[],
  c: Counts,
): State {
  if (word === "back") {
    const to = owner[kind][top(about)];
    if (!to) throw new Error(`no owner of ${top(about)} for ${kind}`);
    if (to !== "raised" && c.rounds > reviewRounds) return "escalated";
    return to;
  }
  const to = table[state]?.[word];
  if (!to) throw new Error(`no transition from ${state} on ${word}`);
  if (word === "retry" && c.attempts >= retryLimit) return "escalated";
  return to;
}
