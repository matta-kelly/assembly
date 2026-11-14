/**
 * The transition table: from an item's state and a check's word, its next state. Data, so the whole process reads in
 * one place. Two kinds of item move through it, each with states of its own:
 * - an issue: open (the planner's step), planned (plan review's), approved (the land of its plan and cl notes on the
 *   notes' main), building (its cls run, phase by phase), built (acceptance's, on main), accepted
 * - a cl: waiting (for the phases before its own), ready (da-nail's step), red (da-hammer's), green (cl-review's),
 *   approved (the land's), landed on main. A cl whose note is gone, or whose issue is planned again, is dropped
 * - either: dropped, when Matt lets it go: it ends undone, and its record stays
 * A retry stays in its state: the third failed attempt at one state is escalated to Matt, and so is the third
 * send-back for another round. A waiting cl's retry is no attempt: it records why the cl waits, however often. Matt
 * stops an item (escalate) and resumes it at a station, with a fresh budget.
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
  | "landed"
  | "dropped"
  // either's
  | "raised"
  | "escalated";

/**
 * A message's word. pass moves the item on, and retry runs its step again. back sends it up the V, to the owner of the
 * artifact its findings are about: a review's send-back and an agent's raise are both one. The rest are the
 * orchestrator's and Matt's: drop ends an item undone (a cl out of its plan, or an issue Matt lets go, with its cls),
 * escalate gives an item to Matt (his stop too), and resume sends an item he holds back to a station.
 */
export type Word = "pass" | "retry" | "back" | "drop" | "escalate" | "resume";

/** What a finding is about: a spec (the issue, the plan, a cl) or a product (a cl's tests, its code). */
export type Artifact = "issue" | "plan" | "cl" | "tests" | "code";

/** The artifacts from the top of the V down: a back about several goes to the highest one's owner. */
export const levels: Artifact[] = ["issue", "plan", "cl", "tests", "code"];

export const retryLimit = 3;
export const reviewRounds = 2;

/**
 * Where pass and retry take an item of each kind from each state. A step runs from open, planned, built, ready, red and
 * green, and the land from approved: a cl's onto its repo's main, an issue's plan onto the notes' main. The
 * orchestrator passes the rest on: a waiting cl to ready, a building issue to built.
 */
export const table: Record<
  "issue" | "cl",
  Partial<Record<State, Partial<Record<"pass" | "met" | "retry", State>>>>
> = {
  issue: {
    open: { pass: "planned", retry: "open" },
    planned: { pass: "approved", retry: "planned" },
    approved: { pass: "building", retry: "approved" },
    building: { pass: "built" },
    built: { pass: "accepted", retry: "built" },
  },
  cl: {
    waiting: { pass: "ready", retry: "waiting" },
    // met: da-nail's tests already pass, so the code meets them and the cl goes to its review (process/nail.ts)
    ready: { pass: "red", met: "green", retry: "ready" },
    red: { pass: "green", retry: "red" },
    green: { pass: "approved", retry: "green" },
    approved: { pass: "landed", retry: "approved" },
  },
};

/** The states an item ends in: it never leaves them, and its worktree and branch go (effects/git.ts, sweep). */
export const ends: State[] = ["landed", "dropped", "accepted"];

/** The states that hold an item for Matt: a raise, and an escalation, his stop among them. */
export const held: State[] = ["raised", "escalated"];

/**
 * The stations Matt may resume an item at, by kind: a state a step or a land runs from, and an issue's building. An
 * issue at approved lands the plan its planner made as it is: Matt's pass of plan review.
 */
export const stations: Record<"issue" | "cl", State[]> = {
  issue: ["open", "approved", "building", "built"],
  cl: ["ready", "red", "green", "approved"],
};

/**
 * Where back takes an item: the state of the artifact's owner. A cl's tests are da-nail's (ready), its code
 * da-hammer's (red). The rest is above the cl: raised, and the orchestrator takes it to its issue (advance.ts). An
 * issue's plan and its cls are the planner's (open), and the issue itself is Matt's (raised).
 */
export const owner: Record<"issue" | "cl", Partial<Record<Artifact, State>>> = {
  issue: { plan: "open", cl: "open", issue: "raised" },
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
  rounds: number; // the sends back for another round since Matt last moved it: each back that did not raise
  prior?: State; // where a resume takes a held item: the station Matt names, else where it was before
  met?: boolean; // the pass's tests already pass (Message.met)
}

/** The next state, from where the item stands, its kind, and the message's word and what its findings are about. */
export function next(
  state: State,
  kind: "issue" | "cl",
  word: Word,
  about: Artifact[],
  c: Counts,
): State {
  if (word === "escalate") {
    if (ends.includes(state))
      throw new Error(`no transition from ${state} on escalate`);
    return "escalated";
  }
  if (word === "drop") {
    if (ends.includes(state))
      throw new Error(`no transition from ${state} on drop`);
    return "dropped";
  }
  if (word === "resume") {
    if (
      !held.includes(state) ||
      !c.prior ||
      held.includes(c.prior) ||
      ends.includes(c.prior)
    )
      throw new Error(`no transition from ${state} on resume`);
    return c.prior;
  }
  if (word === "back") {
    const to = owner[kind][top(about)];
    if (!to) throw new Error(`no owner of ${top(about)} for ${kind}`);
    if (to !== "raised" && c.rounds > reviewRounds) return "escalated";
    return to;
  }
  const to =
    table[kind][state]?.[
      word === "pass" && c.met ? "met" : (word as "pass" | "retry")
    ];
  if (!to) throw new Error(`no transition from ${state} on ${word}`);
  if (word === "retry" && c.attempts >= retryLimit) return "escalated";
  return to;
}
