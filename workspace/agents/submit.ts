/**
 * An agent's submit form: its step's result (done or back), with each exit described by where it takes the item and
 * what it is for. The words come from the routing (factory/line/table.ts) and the steps (factory/stations/), so the form
 * an agent fills is the factory's own routing and cannot drift from it. A role note says only that the output goes
 * through submit, and how to reason over its exits: where an agent uses an exit wrong, this form changes, not the note.
 */

import { z } from "zod";
import { back, type Step } from "../../factory/line/step.ts";
import {
  type Artifact,
  levels,
  owner,
  reviewRounds,
  type State,
  table,
} from "../../factory/line/table.ts";
import { steps } from "../../factory/stations/index.ts";

/** What a finding about each artifact is: the fault it names. */
const faults: Record<Artifact, string> = {
  issue:
    "a fault in the issue: its intent or its Done can't be met or judged as written",
  plan: "a fault in the plan: the cut, the order of its cls, or a seam between them",
  cl: "a fault in the cl's spec: a promise, its seam or its core context",
  tests:
    "a fault in the tests: one that is wrong, or that correct code can't pass",
  code: "a fault in the code",
};

/** Who works on an item at a state: the agent of the step that runs from it, or the move the factory makes there. */
function who(kind: "issue" | "cl", s: State): string {
  const step = steps.find((x) => x.from === s);
  if (step) return step.agent;
  if (s === "raised") return "the operator, who holds it";
  if (kind === "cl" && s === "approved")
    return "the dock, which lands it on main";
  if (kind === "issue" && s === "approved")
    return "the land of its plan and cl notes, and then its cls are built";
  if (s === "accepted") return "accepted: the issue is closed";
  throw new Error(`no one works on a ${kind} at ${s}`);
}

/** The kind of item a step works on: an issue or a cl, by the table that holds its state. */
const kindOf = (s: State): "issue" | "cl" => (table.cl[s] ? "cl" : "issue");

/** Where a step's done takes the item, in words. */
export function doneRoute(step: Step<{ word: "done" }>): string {
  const kind = kindOf(step.from);
  const row = table[kind][step.from];
  if (!row?.pass) throw new Error(`no pass from ${step.from}`);
  const met = row.met
    ? `, or to ${who(kind, row.met)} when the tests already pass, since the code meets them`
    : "";
  return `Done: your work is finished and meets its bar. The ${kind} goes to ${who(kind, row.pass)}${met}.`;
}

/** Where a step's back takes the item, in words. */
export function backRoute(step: Step<{ word: "done" }>): string {
  const kind = kindOf(step.from);
  return [
    `Back: something you were given is wrong, so it goes back to whoever made it. Never fix it yourself.`,
    `The whole back goes to one place: the owner of the highest 'about' among its findings (from the top: ${levels.join(", ")}).`,
    `So a finding about the ${kind === "cl" ? "cl" : "issue"} beside findings about lower things takes them all with it.`,
    `Each finding is a fault that blocks the work; a remark that blocks nothing is not a finding.`,
    `After ${reviewRounds} rounds back, the next one goes to the operator.`,
  ].join(" ");
}

/** What each 'about' this step may name is for, and where it takes the item, in words. */
export function aboutRoute(step: Step<{ word: "done" }>): string {
  const kind = kindOf(step.from);
  return levels
    .filter((a) => step.about.includes(a))
    .map((a) => {
      const to = owner[kind][a];
      if (!to) throw new Error(`no owner of ${a} for a ${kind}`);
      const where =
        to === "raised"
          ? kind === "cl"
            ? "the cl stops, and its issue goes to the operator"
            : "the issue stops, and goes to the operator"
          : `the ${kind} goes back to ${who(kind, to)}`;
      return `${a}: ${faults[a]}; ${where}.`;
    })
    .join(" ");
}

/**
 * A step's result as its agent's submit form: done or back, each described by its route, and each finding's 'about'
 * by what it is for and where it takes the item.
 */
export function submitOf<D extends { word: "done" }>(step: Step<D>) {
  return z
    .union([
      step.done.describe(doneRoute(step)),
      back(step.about, aboutRoute(step)).describe(backRoute(step)),
    ])
    .describe(
      `Your result. It decides where the ${kindOf(step.from)} goes next: pick the exit by its route.`,
    );
}
