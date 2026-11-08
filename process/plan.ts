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
import { items, itemsIn, read, sectionIn } from "../effects/notes.ts";
import type { Run, Step, Verdict, View, Worktree } from "./step.ts";

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
        "each file the cl edits or adds, from the repo's root: its new test files, and each existing test file whose expectations it changes",
      ),
    read: z
      .array(z.string())
      .describe(
        "each file the cl must understand but not edit, from the repo's root. Its agents can reach only these and the files it changes",
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
      "the command that runs, by path, from the repo's root: its new test files, and the existing test files that test code it changes. Its agents and its checks run this and no other tests",
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

/** A plan made outside the factory, as the ledger holds it: so its issue goes back to Matt, never to the planner. */
export type Outside = Plan & { outside: true };

/** Whether the issue's plan was made outside the factory: its answer to a raise is Matt's, not the planner's. */
export const madeOutside = (ledger: Ledger, issue: string) =>
  (ledger.passed(issue, "open") as Partial<Outside> | undefined)?.outside ===
  true;

/**
 * A plan made outside the factory, from its kinetic notes, read and checked for what only the notes can say: the plan
 * note is `<issue>-plan.md` and active, its issue's note is beside it, and its cls (each link under Phases, in order)
 * are notes beside it, named `<issue>-<cut>`, not done or dropped, each a cut the factory's own planner could have
 * made (its intent, Check, Seam, Files and test), all in one repo. Gives back the plan, its issue and its repo, or
 * each reason it can't. `home` is what a repo's `~` is. What the repo must hold is plan lint's (`lintCuts`).
 */
export function readPlan(
  planNote: string,
  home: string,
):
  | {
      ok: true;
      issue: { name: string; path: string };
      repo: string;
      plan: Outside;
    }
  | { ok: false; errors: string[] } {
  const text = read(planNote);
  if (!text) return { ok: false, errors: [`no plan note at ${planNote}`] };
  const issueName = /^belongsTo:\s*"?\[\[([^\]|#]+)/m.exec(text)?.[1];
  if (!issueName)
    return { ok: false, errors: [`${planNote}: no issue in its belongsTo`] };
  const errors: string[] = [];
  const dir = dirname(planNote);
  const issuePath = join(dir, `${issueName}.md`);
  if (!kebab.test(issueName))
    errors.push(`${issueName}: an issue's name is kebab-case`);
  if (planNote !== planPath(issuePath, issueName))
    errors.push(
      `${planNote}: an issue's plan is ${issueName}-plan.md, beside it`,
    );
  if (!/^status: active$/m.test(text))
    errors.push(
      `${planNote}: the plan is not active: plan-review has not passed it`,
    );
  if (!existsSync(issuePath)) errors.push(`no issue note at ${issuePath}`);
  const names = [
    ...sectionIn(text, "Phases").matchAll(/^- \[\[([^\]|#]+)\]\]/gm),
  ].map((m) => m[1] ?? "");
  if (!names.length) errors.push(`${planNote}: no cls under Phases`);
  const twice = names.filter((n, k) => names.indexOf(n) !== k);
  if (twice.length)
    errors.push(`linked twice under Phases: ${[...new Set(twice)].join(", ")}`);
  const cuts: Cut[] = [];
  const repos = new Set<string>();
  for (const name of new Set(names)) {
    const doc = read(join(dir, `${name}.md`));
    if (!doc) {
      errors.push(`no cl note at ${join(dir, `${name}.md`)}`);
      continue;
    }
    if (!name.startsWith(`${issueName}-`)) {
      errors.push(`${name}: a cl of ${issueName} is named ${issueName}-<cut>`);
      continue;
    }
    if (/^status: (done|dropped)$/m.test(doc))
      errors.push(`${name}: it is done or dropped already`);
    const f = filesOf(doc, home);
    if (f.repo) repos.add(f.repo);
    else errors.push(`${name}: its Files names no repo by an absolute path`);
    const c = cut.omit({ traces: true }).safeParse({
      name: name.slice(issueName.length + 1),
      intent: firstLine(doc),
      behaviors: itemsIn(doc, "Check").map((x) => x.slice(2)),
      seam: sectionIn(doc, "Seam").trim(),
      files: { change: f.change, read: f.read },
      grounds: itemsIn(doc, "Grounds").map((x) => x.slice(2)),
      test: f.test,
    });
    if (!c.success)
      errors.push(
        `${name}: not a cut: ${c.error.issues.map((x) => `${x.path.join(".") || "it"} ${x.message}`).join("; ")}`,
      );
    else cuts.push({ ...c.data, traces: [] });
  }
  if (repos.size > 1)
    errors.push(`its cls are in more than one repo: ${[...repos].join(", ")}`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    issue: { name: issueName, path: issuePath },
    repo: [...repos][0] as string,
    plan: { word: "done", seams: [], cuts, outside: true },
  };
}

/** A note's first line after its frontmatter: a cl's intent. */
const firstLine = (doc: string) =>
  doc
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .split("\n")
    .find((l) => l.trim())
    ?.trim() ?? "";

/**
 * A cl note's Files, as kinetic's cl type writes them: `- repo:` (an absolute path, or one from `~`, which is `home`),
 * `- change` and `- read` (their paths inline, or one per item under them), and `- test:`. A path is the first
 * backticked text of its item, with no `:line` or `:from-to`.
 */
function filesOf(doc: string, home: string) {
  const out = {
    repo: "",
    change: [] as string[],
    read: [] as string[],
    test: "",
  };
  const clean = (p: string) => p.replace(/:\d+(-\d+)?$/, "");
  const ticks = (t: string) =>
    [...t.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
  let key = "";
  for (const line of sectionIn(doc, "Files").split("\n")) {
    const top = /^- (\w+)(?::\s*(.*))?$/.exec(line);
    if (top) {
      key = top[1] ?? "";
      const rest = top[2] ?? "";
      if (key === "repo") {
        const raw = (ticks(rest)[0] ?? rest.split(/[\s,]/)[0] ?? "").replace(
          /^~(?=\/|$)/,
          home,
        );
        out.repo = isAbsolute(raw) ? normalize(raw).replace(/\/+$/, "") : "";
      } else if (key === "test") out.test = ticks(rest)[0] ?? "";
      else if (key === "change" || key === "read")
        out[key].push(...ticks(rest).map(clean));
      continue;
    }
    const child = /^(?:\t| {2})- (.*)$/.exec(line);
    if (child && (key === "change" || key === "read")) {
      const first = ticks(child[1] ?? "")[0];
      if (first) out[key].push(clean(first));
    }
  }
  return out;
}

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

/**
 * The files a test command names, by path: each argument after the program that is not a flag and looks like a path
 * (a folder in it, or a file extension). `node --test test/a.test.mjs` names test/a.test.mjs.
 */
export function pathsIn(command: string): string[] {
  const [, ...args] = command.trim().split(/\s+/);
  return args.filter(
    (a) => !a.startsWith("-") && /^[\w.@/-]+$/.test(a) && /\/|\.\w+$/.test(a),
  );
}

/** A path from the repo's root that stays inside it. */
const inside = (f: string) => !isAbsolute(f) && !normalize(f).startsWith("..");

/**
 * The part of plan lint that holds for any plan, the factory's or one made outside it: its cuts' names are its own and
 * new, their files are inside the repo, a file to read is there (or an earlier cut makes it), and a cut's test
 * command runs only files the cut names.
 */
export function lintCuts(
  p: Pick<Plan, "cuts">,
  o: { exists: Worktree["exists"]; taken: (cut: string) => boolean },
): Verdict {
  return cutsLint(p, o);
}

/** Plan lint: what can be decided about a plan without judgment. Its cuts' part, then the trace to the issue's Check. */
export function lint(
  p: Plan,
  o: {
    checks: number;
    exists: Worktree["exists"];
    taken: (cut: string) => boolean;
  },
): Verdict {
  const cuts = cutsLint(p, o);
  if (cuts.word !== "pass") return cuts;
  for (const c of p.cuts) {
    const beyond = c.traces.filter((t) => t > o.checks);
    if (beyond.length)
      return {
        word: "retry",
        cause: "contract_invalid",
        reason: `cut ${c.name}: traces Check items the issue does not have: ${beyond.join(", ")}`,
      };
  }
  return traceLint(p, o.checks);
}

function cutsLint(
  p: Pick<Plan, "cuts">,
  o: { exists: Worktree["exists"]; taken: (cut: string) => boolean },
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
  // A cut may read a file an earlier cut makes: it is there by the time the cut runs.
  const made = new Set<string>();
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
    const missing = c.files.read.filter((f) => !there.has(f) && !made.has(f));
    if (missing.length)
      return {
        word: "retry",
        cause: "contract_invalid",
        reason: `cut ${c.name}: files to read are not in the repo: ${missing.join(", ")}`,
      };
    const known = new Set([...c.files.change, ...c.files.read]);
    const unnamed = pathsIn(c.test).filter((f) => !known.has(f));
    if (unnamed.length)
      return {
        word: "retry",
        cause: "contract_invalid",
        reason: `cut ${c.name}: its test command runs files it does not name in its files: ${unnamed.join(", ")}`,
      };
    for (const f of c.files.change) made.add(f);
  }
  return { word: "pass", reason: "its cuts lint" };
}

/** Each of the issue's Check items is carried by a cut. */
function traceLint(p: Plan, checks: number): Verdict {
  const o = { checks };
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

/**
 * A cl's cut, from its issue's plan: the plan that passed last, whose cuts are the cls in flight. A cl is named
 * <issue>-<cut>.
 */
export function cutOf(ledger: Ledger, r: Pick<Run, "name" | "issue">): Cut {
  const p = ledger.passed(r.issue, "open") as Plan | undefined;
  const c = p?.cuts.find((x) => `${r.issue}-${x.name}` === r.name);
  if (!c) throw new Error(`${r.name} is not a cut of ${r.issue}'s plan`);
  return c;
}

/** What a cl's step can reach: its cut's files, to read and to change. */
export const viewOf = (
  ledger: Ledger,
  r: Pick<Run, "name" | "issue">,
): View => {
  const { files } = cutOf(ledger, r);
  return { read: files.read, change: files.change };
};

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
