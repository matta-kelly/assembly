/**
 * The orchestrator's own moves: the ones no agent makes, decided by code from the ledger, each tick. Each goes through
 * the ledger's one door (apply), as the orchestrator.
 * - an issue just building: its cls go into the ledger, from its spec, each with its phase. A spec the factory's
 *   planner made is written as notes first, the plan note and a cl note per cut; one Matt made is his notes already
 * - a phase starts once every cl of the phases before it is merged, and all its cls start together
 * - an approved cl is merged into its issue's branch
 * - an issue whose cls are all merged is built, and its acceptance starts
 * - a cl that raised relays its message to its issue: findings about the cl or the plan send it to the planner, and
 *   about the issue to Matt; its cls not merged are dropped. A cl escalated escalates its issue. An issue whose spec
 *   Matt made goes to Matt instead of the planner, on a raise or a send-back, escalated
 * - an accepted issue's notes are done
 */

import {
  clFields,
  clNote,
  clPath,
  type PlanSpec,
  planNote,
  planPath,
  type Spec,
  specOf,
} from "../process/plan.ts";
import type { Message } from "../process/step.ts";
import type { Item, Ledger } from "./ledger.ts";
import { read, setStatus, writeNote } from "../effects/notes.ts";
import { top } from "../process/table.ts";
import { merge } from "../effects/git.ts";

const link = (name: string) => `[[${name}]]`;

/** A message from the orchestrator, with no findings unless it relays some. */
const say = (
  word: Message["word"],
  reason: string,
  findings: Message["findings"] = [],
): Message => ({ word, reason, findings });

/** Writes a spec the factory's planner made as kinetic's notes: the plan note, when it has a plan, and a cl note per cut. */
function writeNotes(ledger: Ledger, issue: Item, s: Spec) {
  // A cl in the ledger already has its note: a build a stop cut off leaves it as it is.
  const had = new Set(ledger.cls(issue.name).map((c) => c.name));
  if (s.plan)
    writeNote(
      planPath(issue.path, issue.name),
      {
        type: "plan",
        description: `The plan of ${issue.name}: why its cls are cut and ordered as they are. Read to see how ${issue.name} is cut.`,
        belongsTo: link(issue.name),
        status: "active",
      },
      planNote(issue.name, s as Spec & { plan: PlanSpec }),
      true,
    );
  for (const c of s.cls.filter((x) => !had.has(`${issue.name}-${x.name}`)))
    writeNote(
      clPath(issue.path, issue.name, c.name),
      clFields(issue.name, c, Boolean(s.plan)),
      clNote(c),
      true,
    );
}

/**
 * Puts a spec's cls in the ledger, at their notes beside the issue's, after every cl of the plans before it, each with
 * its phase and its planned paths: phase 1 ready, the rest waiting. A cl the ledger has already is left as it is.
 */
function addCls(ledger: Ledger, issue: Item, s: Spec) {
  const names = new Set(s.cls.map((c) => `${issue.name}-${c.name}`));
  const had = ledger.cls(issue.name);
  // This spec's cls come after every cl of the plans before it.
  const seq = Math.max(
    0,
    ...had.filter((c) => !names.has(c.name)).map((c) => c.seq),
  );
  s.cls.forEach((c, i) => {
    const name = `${issue.name}-${c.name}`;
    if (had.some((h) => h.name === name)) return;
    const phase = c.phase ?? 1;
    ledger.addCl(
      {
        name,
        issue: issue.name,
        seq: seq + i + 1,
        phase,
        path: clPath(issue.path, issue.name, c.name),
        repo: issue.repo,
        image: issue.image,
        test: c.test,
        setup: issue.setup,
      },
      phase === 1 ? "ready" : "waiting",
    );
  });
}

/** Builds an issue from its spec: its notes when the factory made it, then its cls. It can run again after a stop. */
function build(ledger: Ledger, issue: Item, s: Spec, by: string) {
  if (by === "factory") writeNotes(ledger, issue, s);
  addCls(ledger, issue, s);
  setStatus(issue.path, "in-progress");
}

const live = (c: Item) => c.state !== "dropped" && c.state !== "raised";

/**
 * Makes one item's move. A move that fails (a merge git refuses, a spec the ledger lacks) escalates the item, with
 * why: the factory cannot fix it, and the other items go on.
 */
async function guarded(ledger: Ledger, item: Item, move: () => unknown) {
  try {
    await move();
  } catch (e) {
    ledger.apply(
      item.name,
      say(
        "escalate",
        `the orchestrator's move failed: ${(e as Error).message.slice(0, 400)}`,
      ),
      "orchestrator",
    );
  }
}

export async function advance(ledger: Ledger) {
  for (const issue of ledger.inState("building"))
    await guarded(ledger, issue, () => {
      const made = specOf(ledger, issue.name);
      if (!made)
        throw new Error(`issue ${issue.name} is building with no spec`);
      const cls = ledger.cls(issue.name);
      const added = made.spec.cls.every((c) =>
        cls.some((i) => i.name === `${issue.name}-${c.name}`),
      );
      if (!added) build(ledger, issue, made.spec, made.by);
      // Built once every cl is merged or dropped: a raised one is still the plan's, until its raise is handled.
      else if (!cls.some((c) => c.state !== "merged" && c.state !== "dropped"))
        ledger.apply(
          issue.name,
          say("pass", "its cls are all merged"),
          "orchestrator",
        );
    });

  for (const cl of ledger.inState("approved"))
    await guarded(ledger, cl, async () => {
      ledger.paths(cl.name, "actual", await merge(cl.repo, cl.name, cl.issue));
      setStatus(cl.path, "done");
      ledger.apply(
        cl.name,
        say(
          "pass",
          `merged into the issue's branch, assembly/${cl.issue}/head`,
        ),
        "orchestrator",
      );
    });

  // A phase starts once every live cl of the phases before it is merged.
  for (const cl of ledger.inState("waiting")) {
    const before = ledger
      .cls(cl.issue)
      .filter(
        (c) =>
          live(c) && (c.phase ?? 1) < (cl.phase ?? 1) && c.state !== "merged",
      );
    if (!before.length)
      ledger.apply(
        cl.name,
        say(
          "pass",
          `phase ${cl.phase ?? 1} starts: the phases before it are merged`,
        ),
        "orchestrator",
      );
  }

  for (const cl of ledger.inState("raised")) {
    const issue = ledger.item(cl.issue);
    if (issue.state !== "building") continue;
    // The message that raised the cl, relayed to its issue as it is.
    const back = ledger.events(cl.name).at(-1)?.findings ?? [];
    // A spec Matt made is Matt's to answer: the issue is escalated to him, with its cls as they are.
    if (specOf(ledger, issue.name)?.by === "matt") {
      ledger.apply(
        issue.name,
        say(
          "escalate",
          `${cl.name} raised, and Matt made its spec: Matt answers it`,
          back,
        ),
        "orchestrator",
      );
      continue;
    }
    const rest = ledger
      .cls(issue.name)
      .filter((c) => c.name !== cl.name && live(c) && c.state !== "merged");
    // The raising cl is dropped with the rest: its raise is the issue's now, so it is handed over once. The issue itself
    // is Matt's; a cl or the plan is the planner's, by the table.
    ledger.transaction(() => {
      for (const c of [cl, ...rest]) {
        setStatus(c.path, "dropped");
        ledger.apply(
          c.name,
          say(
            "drop",
            c === cl
              ? "its raise goes to the issue"
              : `${cl.name} raised: its plan goes back`,
          ),
          "orchestrator",
        );
      }
      ledger.apply(
        issue.name,
        say(
          "back",
          `${cl.name} raised: ${top(back.map((f) => f.about)) === "issue" ? "the issue goes to Matt" : "back to the planner"}`,
          back,
        ),
        "orchestrator",
      );
    });
  }

  for (const cl of ledger.inState("escalated").filter((c) => c.kind === "cl")) {
    const issue = ledger.item(cl.issue);
    if (issue.state === "building")
      ledger.apply(
        issue.name,
        say("escalate", `${cl.name} is escalated`),
        "orchestrator",
      );
  }

  // An issue sent back to the planner whose spec Matt made goes to Matt, who made it.
  for (const issue of ledger.inState("open"))
    if (specOf(ledger, issue.name)?.by === "matt")
      ledger.apply(
        issue.name,
        say(
          "escalate",
          "sent back to its spec, which Matt made: Matt replans it",
        ),
        "orchestrator",
      );

  for (const issue of ledger.inState("accepted")) {
    if (read(issue.path).match(/^status: done$/m)) continue;
    setStatus(issue.path, "done");
    if (specOf(ledger, issue.name)?.spec.plan)
      setStatus(planPath(issue.path, issue.name), "done");
  }
}
