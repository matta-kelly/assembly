/**
 * The orchestrator's own moves: the ones no agent makes, decided by code from the ledger, each tick.
 * - an issue just building: its approved plan becomes notes, the plan note and a cl note per cut, and its cls go into
 *   the ledger, the first ready and the rest waiting
 * - a cl waits until the cl before it is merged: the cls of an issue run one at a time, each from the last one's code
 * - an approved cl is merged into its issue's branch
 * - an issue whose cls are all merged is built, and its acceptance starts
 * - a cl that raised sends its issue back to the planner, with the raise in the issue's note; its cls not merged are
 *   dropped. A cl escalated escalates its issue
 * - an accepted issue's notes are done
 */

import { type Cut, clPath, type Plan, planPath } from "../process/plan.ts";
import type { Item, Ledger } from "./ledger.ts";
import {
  items,
  read,
  removeSection,
  section,
  setStatus,
  writeNote,
  writeSection,
} from "../effects/notes.ts";
import { merge } from "../effects/git.ts";

const link = (name: string) => `[[${name}]]`;

/** A cut, as the cl note that is its cl's whole input (kinetic's cl type). */
function clNote(issue: Item, c: Cut, before: string | undefined) {
  return [
    c.intent,
    "",
    "---",
    "## Check",
    "",
    ...c.behaviors.map((b) => `- ${b}`),
    "",
    "## Seam",
    "",
    c.seam,
    "",
    "## Needs",
    "",
    before
      ? `- ${link(before)}: its code, merged into the issue's branch, which this cl starts from`
      : "None.",
    "",
    "## Files",
    "",
    `- repo: ${issue.repo}`,
    `- change: ${c.files.change.map((f) => `\`${f}\``).join(", ")}`,
    `- read: ${c.files.read.map((f) => `\`${f}\``).join(", ") || "none"}`,
    "",
    "## Grounds",
    "",
    ...(c.grounds.length ? c.grounds.map((g) => `- ${g}`) : ["None."]),
    "",
    "## Tests",
    "",
    "## Code",
    "",
    "## Review",
  ].join("\n");
}

/** The plan, as kinetic's plan note: its seams, its one phase of cuts in order, and its trace to the issue's Check. */
function planNote(issue: Item, p: Plan) {
  const name = (c: Cut) => `${issue.name}-${c.name}`;
  const checks = items(issue.path, "Check");
  return [
    `The cuts of ${link(issue.name)}, built one at a time, in order.`,
    "",
    "---",
    "## Seams",
    "",
    ...p.seams.map((s) => `- ${s.name}: ${s.what}`),
    "",
    "## Phases",
    "",
    "- one phase, its cuts in order",
    ...p.cuts.map((c) => `\t- ${link(name(c))}: ${c.intent}`),
    "",
    "## Trace",
    "",
    ...checks.map((check, i) => {
      const by = p.cuts
        .filter((c) => c.traces.includes(i + 1))
        .map((c) => link(name(c)));
      return `- ${check.slice(2)}: ${by.join(", ")}`;
    }),
    "",
    "## Does not fit",
    "",
    p.doesNotFit ?? "Nothing.",
  ].join("\n");
}

/**
 * Writes an approved plan's notes, and puts its cls in the ledger. It can run again: a cut whose cl is in the ledger
 * already is left as it is, and the rest are written and added, so a build a stop cut off finishes on the next tick.
 */
function build(ledger: Ledger, issue: Item, p: Plan) {
  writeNote(
    planPath(issue.path, issue.name),
    {
      type: "plan",
      description: `The plan of ${issue.name}: its seams, and its cuts in the order the factory builds them. Read to see how ${issue.name} is cut.`,
      status: "active",
      belongsTo: link(issue.name),
    },
    planNote(issue, p),
    true,
  );
  const names = new Set(p.cuts.map((c) => `${issue.name}-${c.name}`));
  const had = ledger.cls(issue.name);
  // This plan's cls come after every cl of the plans before it.
  const seq = Math.max(
    0,
    ...had.filter((c) => !names.has(c.name)).map((c) => c.seq),
  );
  p.cuts.forEach((c, i) => {
    const name = `${issue.name}-${c.name}`;
    if (had.some((h) => h.name === name)) return;
    const path = clPath(issue.path, issue.name, c.name);
    writeNote(
      path,
      {
        type: "cl",
        description: `The cut ${c.name} of ${issue.name}: ${c.intent} The whole input of the cl that builds it.`,
        status: "new",
        belongsTo: link(`${issue.name}-plan`),
      },
      clNote(
        issue,
        c,
        i === 0 ? undefined : `${issue.name}-${p.cuts[i - 1]?.name}`,
      ),
      true,
    );
    ledger.addCl(
      {
        name,
        issue: issue.name,
        seq: seq + i + 1,
        path,
        repo: issue.repo,
        image: issue.image,
        test: c.test,
      },
      i === 0 ? "ready" : "waiting",
    );
    ledger.paths(name, "planned", c.files.change);
  });
  // The raise and the plan review it answered are closed: the plan that answers them is active.
  removeSection(issue.path, "Raise");
  setStatus(issue.path, "in-progress");
}

const live = (c: Item) => c.state !== "dropped" && c.state !== "raised";

/**
 * Makes one item's move. A move that fails (a merge git refuses, a plan the ledger lacks) escalates the item, with
 * why: the factory cannot fix it, and the other items go on.
 */
async function guarded(ledger: Ledger, item: Item, move: () => unknown) {
  try {
    await move();
  } catch (e) {
    ledger.move([
      {
        name: item.name,
        to: "escalated",
        reason: `the orchestrator's move failed: ${(e as Error).message.slice(0, 400)}`,
      },
    ]);
  }
}

export async function advance(ledger: Ledger) {
  for (const issue of ledger.inState("building"))
    await guarded(ledger, issue, () => {
      const p = ledger.passed(issue.name, "open") as Plan | undefined;
      if (!p) throw new Error(`issue ${issue.name} is building with no plan`);
      const cls = ledger.cls(issue.name);
      const added = p.cuts.every((c) =>
        cls.some((i) => i.name === `${issue.name}-${c.name}`),
      );
      if (!added) build(ledger, issue, p);
      else if (!cls.some((c) => live(c) && c.state !== "merged"))
        ledger.move([
          { name: issue.name, to: "built", reason: "its cls are all merged" },
        ]);
    });

  for (const cl of ledger.inState("approved"))
    await guarded(ledger, cl, async () => {
      ledger.paths(cl.name, "actual", await merge(cl.repo, cl.name, cl.issue));
      setStatus(cl.path, "done");
      ledger.move([
        {
          name: cl.name,
          to: "merged",
          reason: `merged into the issue's branch, assembly/${cl.issue}/head`,
        },
      ]);
    });

  for (const cl of ledger.inState("waiting")) {
    const before = ledger
      .cls(cl.issue)
      .filter((c) => c.seq < cl.seq && live(c))
      .at(-1);
    if (!before || before.state === "merged")
      ledger.move([
        {
          name: cl.name,
          to: "ready",
          reason: before ? `${before.name} is merged` : "first of its plan",
        },
      ]);
  }

  for (const cl of ledger.inState("raised")) {
    const issue = ledger.item(cl.issue);
    if (issue.state !== "building") continue;
    writeSection(
      issue.path,
      "Raise",
      `- from: ${cl.name}\n${section(cl.path, "Raise").trim()}`,
    );
    const rest = ledger
      .cls(issue.name)
      .filter((c) => c.name !== cl.name && live(c) && c.state !== "merged");
    for (const c of rest) setStatus(c.path, "dropped");
    setStatus(cl.path, "dropped");
    // The raising cl is dropped with the rest: its raise is the issue's now, so it is handed over once.
    ledger.move([
      {
        name: cl.name,
        to: "dropped",
        reason: "its raise goes to the issue",
      },
      ...rest.map((c) => ({
        name: c.name,
        to: "dropped" as const,
        reason: `${cl.name} raised: its plan goes back`,
      })),
      {
        name: issue.name,
        to: "open",
        reason: `${cl.name} raised: back to the planner`,
      },
    ]);
  }

  for (const cl of ledger.inState("escalated").filter((c) => c.kind === "cl")) {
    const issue = ledger.item(cl.issue);
    if (issue.state === "building")
      ledger.move([
        {
          name: issue.name,
          to: "escalated",
          reason: `${cl.name} is escalated`,
        },
      ]);
  }

  for (const issue of ledger.inState("accepted")) {
    if (read(issue.path).match(/^status: done$/m)) continue;
    setStatus(issue.path, "done");
    setStatus(planPath(issue.path, issue.name), "done");
  }
}
