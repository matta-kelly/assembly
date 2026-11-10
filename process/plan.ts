/**
 * The plan step: an issue from open to planned. The planner reads the issue and the code, read-only, and hands back the
 * plan as data, in the shape of kinetic's plan type: its seams, its cuts in the order they are built, and how they
 * trace back to the issue's Check. The check is plan lint, in code: what can be decided without judgment. Whether the
 * cuts are good is the plan review's. Nothing is written yet: the plan note and the cl notes are written once the plan
 * review approves (orchestrator/advance.ts).
 */

import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import type { Ledger } from "../orchestrator/ledger.ts";
import { field, items, itemsIn, read, sectionIn } from "../effects/notes.ts";
import type { Message, Run, Step, View, Worktree } from "./step.ts";

/** A lint's word, and why: a plan lints, or its attempt is a retry with the cause. */
type Lint = Omit<Message, "findings">;

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

/**
 * A plan made outside the factory, as the ledger holds it: so its issue goes back to Matt, never to the planner.
 * `alone`: the lone cl of an issue that takes one, which has no plan note.
 */
export type Outside = Plan & { outside: true; alone?: true };

/** Whether the issue has a plan note: every plan does but a lone cl's. */
export const hasPlanNote = (ledger: Ledger, issue: string) =>
  (ledger.passed(issue, "open") as Partial<Outside> | undefined)?.alone !==
  true;

/** Whether the issue's plan was made outside the factory: its answer to a raise is Matt's, not the planner's. */
export const madeOutside = (ledger: Ledger, issue: string) =>
  (ledger.passed(issue, "open") as Partial<Outside> | undefined)?.outside ===
  true;

/** A note's kinetic type, from its frontmatter: issue, plan, cl, and the rest. Empty when it has none. */
export const typeOf = (doc: string) => field(doc, "type");

/** What a reading of notes made outside the factory gives back: a plan, its issue and its repo, or each reason it can't. */
export type Read =
  | {
      ok: true;
      issue: { name: string; path: string };
      repo: string;
      plan: Outside;
    }
  | { ok: false; errors: string[] };

/** The issue a plan or a lone cl belongs to, in `dir`: a kebab-case name, and an issue note there. */
function issueIn(dir: string, name: string, errors: string[]) {
  const path = join(dir, `${name}.md`);
  if (!kebab.test(name)) errors.push(`${name}: an issue's name is kebab-case`);
  const doc = read(path);
  if (!doc) errors.push(`no issue note at ${path}`);
  else if (typeOf(doc) !== "issue")
    errors.push(
      `${path}: not an issue note: its type is ${typeOf(doc) || "not set"}`,
    );
  return path;
}

/**
 * One cl note in `dir`, as a cut of `issue`: named `<issue>-<cut>`, not done or dropped, and a cut the factory's own
 * planner could have made (its intent, Check, Seam, Files and test), with its repo from its Files.
 */
function clIn(
  dir: string,
  name: string,
  issue: string,
  home: string,
): { cut?: Cut; repo: string; errors: string[] } {
  const path = join(dir, `${name}.md`);
  const doc = read(path);
  if (!doc) return { repo: "", errors: [`no cl note at ${path}`] };
  if (!name.startsWith(`${issue}-`))
    return {
      repo: "",
      errors: [`${name}: a cl of ${issue} is named ${issue}-<cut>`],
    };
  const errors: string[] = [];
  if (["done", "dropped"].includes(field(doc, "status")))
    errors.push(`${name}: it is done or dropped already`);
  const f = filesOf(doc, home);
  if (!f.repo)
    errors.push(`${name}: its Files names no repo by an absolute path`);
  const c = cut.omit({ traces: true }).safeParse({
    name: name.slice(issue.length + 1),
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
  return {
    ...(c.success && !errors.length ? { cut: { ...c.data, traces: [] } } : {}),
    repo: f.repo,
    errors,
  };
}

/** The plan its cl notes make, once each is read whole: its cuts, all in one repo. */
function readCuts(
  issue: { name: string; path: string },
  cls: ReturnType<typeof clIn>[],
  errors: string[],
  alone = false,
): Read {
  const cuts: Cut[] = [];
  const repos = new Set<string>();
  for (const r of cls) {
    if (r.cut) cuts.push(r.cut);
    if (r.repo) repos.add(r.repo);
    errors.push(...r.errors);
  }
  if (repos.size > 1)
    errors.push(`its cls are in more than one repo: ${[...repos].join(", ")}`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    issue,
    repo: [...repos][0] as string,
    plan: {
      word: "done",
      seams: [],
      cuts,
      outside: true,
      ...(alone ? { alone: true as const } : {}),
    },
  };
}

/**
 * A plan made outside the factory, from its kinetic notes, read and checked for what only the notes can say: the plan
 * note is `<issue>-plan.md` and active, its issue's note is beside it, and its cls (each link under Phases, in order)
 * are notes beside it, each read as clIn reads it. `home` is what a repo's `~` is. What the repo must hold is plan
 * lint's (`lintCuts`).
 */
export function readPlan(planNote: string, home: string): Read {
  const text = read(planNote);
  if (!text) return { ok: false, errors: [`no plan note at ${planNote}`] };
  const issueName = field(text, "belongsTo");
  if (!issueName)
    return { ok: false, errors: [`${planNote}: no issue in its belongsTo`] };
  const errors: string[] = [];
  const dir = dirname(planNote);
  const issuePath = issueIn(dir, issueName, errors);
  if (planNote !== planPath(issuePath, issueName))
    errors.push(
      `${planNote}: an issue's plan is ${issueName}-plan.md, beside it`,
    );
  if (field(text, "status") !== "active")
    errors.push(
      `${planNote}: the plan is not active: plan-review has not passed it`,
    );
  const names = [
    ...sectionIn(text, "Phases").matchAll(/^- \[\[([^\]|#]+)\]\]/gm),
  ].map((m) => m[1] ?? "");
  if (!names.length) errors.push(`${planNote}: no cls under Phases`);
  const twice = names.filter((n, k) => names.indexOf(n) !== k);
  if (twice.length)
    errors.push(`linked twice under Phases: ${[...new Set(twice)].join(", ")}`);
  return readCuts(
    { name: issueName, path: issuePath },
    [...new Set(names)].map((n) => clIn(dir, n, issueName, home)),
    errors,
  );
}

/**
 * A cl made outside the factory with no plan: the one cl of an issue that takes one ([[cl]]), which `belongsTo` the
 * issue, beside it. Read as a plan of one cut, so it enters as a plan's cls do. A cl that belongs to a plan is read
 * with its plan, which holds its order and the cls beside it.
 */
export function readCl(clNote: string, home: string): Read {
  const text = read(clNote);
  if (!text) return { ok: false, errors: [`no cl note at ${clNote}`] };
  const to = field(text, "belongsTo");
  if (!to)
    return { ok: false, errors: [`${clNote}: no issue in its belongsTo`] };
  const dir = dirname(clNote);
  if (typeOf(read(join(dir, `${to}.md`))) === "plan")
    return {
      ok: false,
      errors: [
        `${clNote}: a cut of ${to}: add the plan, which holds its order`,
      ],
    };
  const errors: string[] = [];
  const issuePath = issueIn(dir, to, errors);
  if (existsSync(planPath(issuePath, to)))
    errors.push(
      `${to} has a plan, ${planPath(issuePath, to)}: add the plan, which holds its cls`,
    );
  return readCuts(
    { name: to, path: issuePath },
    [clIn(dir, basename(clNote, ".md"), to, home)],
    errors,
    true,
  );
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
/** A file in the repo, from its root: not the root itself, nor outside it. */
const inside = (f: string) => {
  const n = normalize(f).replace(/\/+$/, "");
  return !isAbsolute(f) && n !== "." && !n.startsWith("..");
};

/**
 * The part of plan lint that holds for any plan, the factory's or one made outside it: its cuts' names are its own and
 * new, their files are inside the repo, a file to read is there (or an earlier cut makes it), and a cut's test
 * command runs only files the cut names.
 */
export function lintCuts(
  p: Pick<Plan, "cuts">,
  o: { exists: Worktree["exists"]; taken: (cut: string) => boolean },
): Lint {
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
): Lint {
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
): Lint {
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
        reason: `cut ${c.name}: files outside the repo, or its root: ${outside.join(", ")}`,
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
function traceLint(p: Plan, checks: number): Lint {
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
  about: ["issue"],
  input,
  // The plan is the attempt's result, in the ledger. Its notes are written once the plan review approves it.
  async check(r, d, at) {
    const v = lint(d, {
      checks: items(r.path, "Check").length,
      exists: (f) => at.exists(f),
      taken: (c) => existsSync(clPath(r.path, r.issue, c)),
    });
    return { ...v, findings: [], ...(d.notes ? { notes: d.notes } : {}) };
  },
};
