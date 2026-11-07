/**
 * The plan step: an issue from open to planned. The planner reads the issue and the code, read-only, and hands back the
 * plan as data, in the shape of kinetic's plan type: its seams, its cuts in the order they are built, and how they
 * trace back to the issue's Check. The check is plan lint, in code: what can be decided without judgment. Whether the
 * cuts are good is the plan review's. Nothing is written yet: the plan note and the cl notes are written once the plan
 * review approves (orchestrator/advance.ts).
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import type { Ledger } from "../orchestrator/ledger.ts";
import { items, read } from "../effects/notes.ts";
import type { Run, Step, Verdict, Worktree } from "./step.ts";

/** A name the factory can use in its branches and its containers: kebab-case. */
export const kebab = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const cut = z.object({
  name: z
    .string()
    .regex(kebab)
    .describe("the cut's name, kebab-case. Its cl is named <issue>-<name>"),
  intent: z
    .string()
    .min(1)
    .describe("one sentence of done: what is true once its cl lands"),
  behaviors: z
    .array(z.string().min(1))
    .min(1)
    .describe("each one a test: given, when, then"),
  seam: z
    .string()
    .min(1)
    .describe(
      "what the cut must not change, and what crosses the seam: the names, types and shapes",
    ),
  files: z.object({
    change: z
      .array(z.string())
      .min(1)
      .describe(
        "each file the cl edits or adds, its tests too, from the repo's root",
      ),
    read: z
      .array(z.string())
      .describe(
        "each file the cl must understand but not edit, from the repo's root",
      ),
  }),
  grounds: z
    .array(z.string())
    .describe(
      "the facts it rests on, each with its source: a file and lines, or a probe and its output",
    ),
  test: z
    .string()
    .min(1)
    .describe(
      "the command that runs the cut's test files, by path, from the repo's root",
    ),
  traces: z
    .array(z.number().int().min(1))
    .min(1)
    .describe("the issue's Check items the cut carries, by number from 1"),
});
export type Cut = z.infer<typeof cut>;

const done = z.object({
  word: z.literal("done"),
  seams: z
    .array(z.object({ name: z.string().min(1), what: z.string().min(1) }))
    .min(1)
    .describe("the seams the issue is cut along: what each one holds apart"),
  cuts: z
    .array(cut)
    .min(1)
    .describe(
      "the cuts, in the order they are built: each one builds on the ones before it",
    ),
  doesNotFit: z
    .string()
    .optional()
    .describe("what you could not make fit, said plainly"),
  notes: z.string().optional(),
});
export type Plan = z.infer<typeof done>;

/** Where the issue's plan note and its cl notes go: beside the issue's note. */
export const planPath = (issuePath: string, issue: string) =>
  join(dirname(issuePath), `${issue}-plan.md`);
export const clPath = (issuePath: string, issue: string, cut: string) =>
  join(dirname(issuePath), `${issue}-${cut}.md`);

/** The plan as text, for a review to read. */
export function planText(p: Plan): string {
  return [
    "## Seams",
    ...p.seams.map((s) => `- ${s.name}: ${s.what}`),
    "",
    "## Cuts, in order",
    ...p.cuts.flatMap((c, i) => [
      `### ${i + 1}. ${c.name}: ${c.intent}`,
      "- behaviors:",
      ...c.behaviors.map((b) => `  - ${b}`),
      `- seam: ${c.seam}`,
      `- change: ${c.files.change.join(", ")}`,
      `- read: ${c.files.read.join(", ") || "none"}`,
      `- grounds: ${c.grounds.join("; ") || "none"}`,
      `- test: \`${c.test}\``,
      `- traces Check items: ${c.traces.join(", ")}`,
    ]),
    ...(p.doesNotFit ? ["", "## Does not fit", p.doesNotFit] : []),
  ].join("\n");
}

/** A path from the repo's root that stays inside it. */
const inside = (f: string) => !isAbsolute(f) && !normalize(f).startsWith("..");

/** Plan lint: what can be decided about a plan without judgment. */
export function lint(
  p: Plan,
  o: {
    checks: number;
    exists: Worktree["exists"];
    taken: (cut: string) => boolean;
  },
): Verdict {
  const names = p.cuts.map((c) => c.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length)
    return {
      word: "retry",
      cause: "contract_invalid",
      reason: `two cuts share a name: ${twice.join(", ")}`,
    };
  const taken = names.filter(o.taken);
  if (taken.length)
    return {
      word: "retry",
      cause: "contract_invalid",
      reason: `a cl of this issue already has the name: ${taken.join(", ")}`,
    };
  for (const c of p.cuts) {
    const outside = [...c.files.change, ...c.files.read].filter(
      (f) => !inside(f),
    );
    if (outside.length)
      return {
        word: "retry",
        cause: "contract_invalid",
        reason: `cut ${c.name}: files outside the repo: ${outside.join(", ")}`,
      };
    const there = new Set(o.exists(c.files.read));
    const missing = c.files.read.filter((f) => !there.has(f));
    if (missing.length)
      return {
        word: "retry",
        cause: "contract_invalid",
        reason: `cut ${c.name}: files to read are not in the repo: ${missing.join(", ")}`,
      };
    const beyond = c.traces.filter((t) => t > o.checks);
    if (beyond.length)
      return {
        word: "retry",
        cause: "contract_invalid",
        reason: `cut ${c.name}: traces Check items the issue does not have: ${beyond.join(", ")}`,
      };
  }
  if (o.checks === 0)
    return {
      word: "retry",
      cause: "contract_invalid",
      reason: "the issue's Check has no items to trace: raise it",
    };
  const traced = new Set(p.cuts.flatMap((c) => c.traces));
  const untraced = Array.from({ length: o.checks }, (_, i) => i + 1).filter(
    (k) => !traced.has(k),
  );
  if (untraced.length)
    return {
      word: "retry",
      cause: "contract_invalid",
      reason: `no cut carries the issue's Check items: ${untraced.join(", ")}`,
    };
  return { word: "pass", reason: "the plan lints" };
}

/** The issue as the planner reads it: its note, and the plan before, if the issue came back to be planned again. */
function input(r: Run, ledger: Ledger): string {
  const before = ledger.passed(r.name, "open") as Plan | undefined;
  const merged = ledger.cls(r.name).filter((c) => c.state === "merged");
  return [
    read(r.path),
    ...(before
      ? ["", "# The plan before, which came back", planText(before)]
      : []),
    ...(merged.length
      ? [
          "",
          "# The cls already merged, which a new plan builds on",
          ...merged.map((c) => `- ${c.name}`),
        ]
      : []),
  ].join("\n");
}

export const plan: Step<Plan> = {
  from: "open",
  agent: "planner",
  worktree: "ro",
  done,
  section: "Plan",
  render: planText,
  input,
  // The plan is the attempt's result, in the ledger. Its notes are written once the plan review approves it.
  write: () => {},
  async check(r, d, at) {
    return lint(d, {
      checks: items(r.path, "Check").length,
      exists: (f) => at.exists(f),
      taken: (c) => existsSync(clPath(r.path, r.issue, c)),
    });
  },
};
