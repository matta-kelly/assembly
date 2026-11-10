/**
 * The plan step: an issue from open to planned. The planner reads the issue and the code, read-only, and hands back the
 * spec as data, in the shape of kinetic's plan and cl types: its plan (the approach, each phase's reason, and what does
 * not fit), absent for an issue of one cl, and its cls (each one's intent, phase, shape, checkout, scope, test, check,
 * seam and the description of its checkout). The check is spec lint, in code: what can be decided without judgment.
 * Whether the cut is good is the plan review's. Nothing is written yet: the notes are written once the plan review
 * approves (orchestrator/advance.ts). A spec Matt makes is read from its notes (readSpec) and checked by the same lint.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { Ledger } from "../orchestrator/ledger.ts";
import { items, itemsIn, read, sectionIn } from "../effects/notes.ts";
import type { Message, Run, Step, View, Worktree } from "./step.ts";

/** A lint's word, and why: a spec lints, or its attempt is a retry with the cause. */
type Lint = Omit<Message, "findings">;

/** A name the factory can use in its branches and its containers: kebab-case. */
export const kebab = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** A path of a cl, from its repo's root: a file. A folder is not taken until the sparse checkout. */
const path = z
  .string()
  .min(1)
  .refine((p) => !p.endsWith("/"), "a file, not a folder");

/** One cl, as kinetic's cl type holds it: its frontmatter fields and the prose of its body. */
export const clSpec = z.object({
  name: z
    .string()
    .regex(kebab)
    .describe("the cut's name, kebab-case. Its cl is named <issue>-<name>"),
  intent: z
    .string()
    .min(1)
    .describe("one sentence of done: what is true once its CL lands"),
  phase: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("its phase in the plan, from 1. None for an issue's lone cl"),
  shape: z.object({
    change: z
      .enum(["behavior", "structure"])
      .describe(
        "behavior: its check fails before and passes after. structure: it passes before and after",
      ),
    checked: z
      .enum(["repo", "system"])
      .describe("where its check runs: in the repo, or on the running system"),
  }),
  checkout: z
    .array(path)
    .min(1)
    .describe(
      "every file its builders get on disk, from the repo's root: what they change and what they must read. They see nothing else",
    ),
  scope: z
    .array(path)
    .min(1)
    .describe(
      "the files it may change: a part of its checkout. Only these are committed",
    ),
  test: z
    .string()
    .min(1)
    .describe(
      "the command its checks run, from the repo's root: its new test files and the existing ones that test what it changes, each in its checkout",
    ),
  check: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "its promises, each a future test that can fail: behavior as given, when, then; structure as what stays green",
    ),
  seam: z
    .string()
    .min(1)
    .describe(
      "the decision it hides from the other cls, what it must not change, and what crosses to them",
    ),
  checkoutNotes: z
    .string()
    .min(1)
    .describe(
      "its Checkout section: each path of its checkout, as a tree, with what it is and why it is there, its scope marked, and one exemplar",
    ),
});
export type ClSpec = z.infer<typeof clSpec>;

/** The plan, as kinetic's plan type holds it: its reasoning. Each phase's cls are the cls with that phase. */
export const planSpec = z.object({
  approach: z
    .string()
    .min(1)
    .describe(
      "in one or two sentences: how the cls, in order, meet the issue's Done",
    ),
  phases: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "each phase's reason, in order from phase 1: what it builds, and why it comes where it does",
    ),
  doesNotFit: z
    .string()
    .optional()
    .describe("what could not be made to fit, said plainly"),
});
export type PlanSpec = z.infer<typeof planSpec>;

/** A spec: the cls, and their plan when there is more than one. */
export type Spec = { plan?: PlanSpec | undefined; cls: ClSpec[] };

const done = z.object({
  word: z.literal("done"),
  plan: planSpec
    .optional()
    .describe(
      "the plan, when the issue takes more than one cl; none for its lone cl",
    ),
  cls: z.array(clSpec).min(1),
  notes: z.string().optional(),
});
export type Planned = z.infer<typeof done>;

/** Where the issue's plan note and its cl notes go: beside the issue's note. */
export const planPath = (issuePath: string, issue: string) =>
  join(dirname(issuePath), `${issue}-plan.md`);
export const clPath = (issuePath: string, issue: string, cut: string) =>
  join(dirname(issuePath), `${issue}-${cut}.md`);

/** Who made an issue's spec: the factory's planner, or Matt, who submitted it. */
export type Made = "factory" | "matt";

/** The issue's spec and who made it: the one Matt submitted, else the planner's last passed one. */
export function specOf(
  ledger: Ledger,
  issue: string,
): { spec: Spec; by: Made } | undefined {
  const kept = ledger.spec(issue);
  if (kept) return { spec: kept.spec as Spec, by: kept.by as Made };
  const p = ledger.passed(issue, "open") as Planned | undefined;
  return (
    p && {
      spec: { ...(p.plan ? { plan: p.plan } : {}), cls: p.cls },
      by: "factory",
    }
  );
}

/** A cl's spec, from its issue's. A cl is named <issue>-<cut>. */
export function clOf(ledger: Ledger, r: Pick<Run, "name" | "issue">): ClSpec {
  const c = specOf(ledger, r.issue)?.spec.cls.find(
    (x) => `${r.issue}-${x.name}` === r.name,
  );
  if (!c) throw new Error(`${r.name} is not a cl of ${r.issue}'s spec`);
  return c;
}

/** What a cl's step can reach: it reads its checkout, and changes its scope. */
export const viewOf = (
  ledger: Ledger,
  r: Pick<Run, "name" | "issue">,
): View => {
  const c = clOf(ledger, r);
  return { read: c.checkout, change: c.scope };
};

/** The spec as text, for a review to read. */
export function specText(s: Spec): string {
  return [
    ...(s.plan
      ? [
          `The approach: ${s.plan.approach}`,
          "",
          "## Phases",
          ...s.plan.phases.map((why, i) => `- Phase ${i + 1}: ${why}`),
          ...(s.plan.doesNotFit
            ? ["", "## Does not fit", s.plan.doesNotFit]
            : []),
          "",
        ]
      : []),
    "## Cls",
    ...s.cls.flatMap((c) => [
      `### ${c.name}${c.phase ? `, phase ${c.phase}` : ""}: ${c.intent}`,
      `- shape: ${c.shape.change}, checked in the ${c.shape.checked}`,
      `- checkout: ${c.checkout.join(", ")}`,
      `- scope: ${c.scope.join(", ")}`,
      `- test: \`${c.test}\``,
      "- check:",
      ...c.check.map((b) => `  - ${b}`),
      `- seam: ${c.seam}`,
      "- checkout notes:",
      c.checkoutNotes,
    ]),
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

/** A file in the repo, from its root: not the root itself, nor outside it. */
const inside = (f: string) => {
  const n = normalize(f).replace(/\/+$/, "");
  return !isAbsolute(f) && n !== "." && !n.startsWith("..");
};

const no = (reason: string): Lint => ({
  word: "retry",
  cause: "contract_invalid",
  reason,
});

/**
 * Spec lint: what can be decided about a spec without judgment, the same rules kinetic's lint holds and what only the
 * repo can say. A plan's cls each have a phase, the phases run from 1 with no gap, and each has a reason; a lone cl has
 * no plan and no phase. The cls' names are their own and new. A cl's scope lies in its checkout, and its paths stay in
 * the repo. Two cls of one phase change no file in common. A file in a checkout and not in its scope is in the repo, or a
 * cl of an earlier phase makes it. A test command runs only files in its checkout.
 */
export function specLint(
  s: Spec,
  o: { exists: Worktree["exists"]; taken: (cut: string) => boolean },
): Lint {
  const names = s.cls.map((c) => c.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length) return no(`two cls share a name: ${twice.join(", ")}`);
  const taken = names.filter(o.taken);
  if (taken.length)
    return no(`a cl of this issue already has the name: ${taken.join(", ")}`);
  if (!s.plan) {
    if (s.cls.length > 1) return no("more than one cl, and no plan");
    if (s.cls[0]?.phase !== undefined)
      return no("a lone cl has no phase: it has no plan");
  } else {
    const none = s.cls.filter((c) => c.phase === undefined).map((c) => c.name);
    if (none.length)
      return no(`cls of the plan with no phase: ${none.join(", ")}`);
    if (s.cls.length < 2)
      return no("a plan of one cl: a lone cl needs no plan");
    const have = new Set(s.cls.map((c) => c.phase as number));
    const top = Math.max(...have);
    const gap = [...Array(top).keys()]
      .map((i) => i + 1)
      .filter((p) => !have.has(p));
    if (gap.length)
      return no(`the phases have a gap: no cl in phase ${gap.join(", ")}`);
    if (s.plan.phases.length !== top)
      return no(
        `the plan gives ${s.plan.phases.length} phase reasons for ${top} phases`,
      );
  }
  const phase = (c: ClSpec) => c.phase ?? 1;
  for (const c of s.cls) {
    const outside = [...c.checkout, ...c.scope].filter((f) => !inside(f));
    if (outside.length)
      return no(
        `cl ${c.name}: files outside the repo, or its root: ${outside.join(", ")}`,
      );
    const loose = c.scope.filter((f) => !c.checkout.includes(f));
    if (loose.length)
      return no(
        `cl ${c.name}: its scope is not in its checkout: ${loose.join(", ")}`,
      );
    const unnamed = pathsIn(c.test).filter((f) => !c.checkout.includes(f));
    if (unnamed.length)
      return no(
        `cl ${c.name}: its test command runs files not in its checkout: ${unnamed.join(", ")}`,
      );
    const made = new Set(
      s.cls.filter((x) => phase(x) < phase(c)).flatMap((x) => x.scope),
    );
    const read = c.checkout.filter((f) => !c.scope.includes(f));
    const there = new Set(o.exists(read));
    const missing = read.filter((f) => !there.has(f) && !made.has(f));
    if (missing.length)
      return no(
        `cl ${c.name}: files of its checkout are not in the repo: ${missing.join(", ")}`,
      );
    const shared = s.cls
      .filter((x) => x.name !== c.name && phase(x) === phase(c))
      .flatMap((x) =>
        x.scope
          .filter((f) => c.scope.includes(f))
          .map((f) => `${f} (${x.name})`),
      );
    if (shared.length)
      return no(
        `cl ${c.name}: its scope overlaps a cl of its phase: ${shared.join(", ")}`,
      );
  }
  return { word: "pass", reason: "the spec lints" };
}

/** The issue as the planner reads it: its note, and the spec before, if the issue came back to be planned again. */
function input(r: Run, ledger: Ledger): string {
  const before = specOf(ledger, r.name)?.spec;
  const merged = ledger.cls(r.name).filter((c) => c.state === "merged");
  return [
    read(r.path),
    ...(before
      ? ["", "# The spec before, which came back", specText(before)]
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

export const plan: Step<Planned> = {
  from: "open",
  agent: "planner",
  worktree: "ro",
  done,
  about: ["issue"],
  input,
  // The spec is the attempt's result, in the ledger. Its notes are written once the plan review approves it.
  async check(r, d, at) {
    if (!items(r.path, "Done").length)
      return {
        word: "back",
        reason: "the issue has no Done items to meet",
        findings: [
          {
            about: "issue",
            what: "its Done has no items, so no plan can be shown to meet it",
            where: `${r.path}, ## Done`,
          },
        ],
      };
    const v = specLint(d, {
      exists: (f) => at.exists(f),
      taken: (c) => existsSync(clPath(r.path, r.issue, c)),
    });
    return { ...v, findings: [], ...(d.notes ? { notes: d.notes } : {}) };
  },
};

const link = (name: string) => `[[${name}]]`;

/** The plan note's body, in kinetic's plan type: the approach, each phase's reason and its cls, and what does not fit. */
export function planNote(issue: string, s: Spec & { plan: PlanSpec }): string {
  return [
    s.plan.approach,
    "",
    "---",
    "## Phases",
    "",
    ...s.plan.phases.flatMap((why, i) => [
      `- Phase ${i + 1}: ${why}`,
      ...s.cls
        .filter((c) => c.phase === i + 1)
        .map((c) => `\t- ${link(`${issue}-${c.name}`)}: ${c.seam}`),
    ]),
    "",
    "## Does not fit",
    "",
    s.plan.doesNotFit ?? "Nothing.",
  ].join("\n");
}

/** A cl note's body, in kinetic's cl type: its intent, Check, Seam and Checkout. */
export function clNote(c: ClSpec): string {
  return [
    c.intent,
    "",
    "---",
    "## Check",
    "",
    ...c.check.map((b) => `- ${b}`),
    "",
    "## Seam",
    "",
    c.seam,
    "",
    "## Checkout",
    "",
    c.checkoutNotes,
  ].join("\n");
}

/** A cl note's frontmatter fields, in kinetic's cl type. */
export const clFields = (issue: string, c: ClSpec, plan: boolean) => ({
  type: "cl",
  description: `The cut ${c.name} of ${issue}: ${c.intent}`,
  belongsTo: link(plan ? `${issue}-plan` : issue),
  status: "new",
  ...(c.phase === undefined ? {} : { phase: c.phase }),
  shape: c.shape,
  checkout: c.checkout,
  scope: c.scope,
  test: c.test,
});

/** A note's frontmatter, parsed, and its body. A note with none has an empty one. */
export function noteOf(doc: string): {
  fields: Record<string, unknown>;
  body: string;
} {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(doc);
  if (!m) return { fields: {}, body: doc };
  const fields = parse(m[1] ?? "") as Record<string, unknown> | null;
  return { fields: fields ?? {}, body: m[2] ?? "" };
}

/** A link field's name: `[[name]]` to name. */
const linked = (v: unknown) =>
  typeof v === "string" ? (/^\[\[([^\]|#]+)/.exec(v)?.[1] ?? v) : "";

/** A note's kinetic type, from its frontmatter: issue, plan, cl, and the rest. Empty when it has none. */
export const typeOf = (doc: string) => {
  const t = noteOf(doc).fields["type"];
  return typeof t === "string" ? t : "";
};

/** The first line of a note's body: its intent, or its approach. */
const firstLine = (body: string) =>
  body
    .split("\n")
    .find((l) => l.trim())
    ?.trim() ?? "";

/** What reading a spec from notes gives: the spec, or each reason it can't. */
export type Read = { ok: true; spec: Spec } | { ok: false; errors: string[] };

/**
 * A spec Matt made, from the notes beside its issue: its cls (every cl note that belongs to the issue, or to its plan)
 * and its plan, `<issue>-plan.md`, when it has more than one. The issue has Done items. The plan is active, and its
 * Phases list names exactly its cls, each under its own phase. Each cl is new and holds kinetic's cl fields. What the
 * repo must hold is spec lint's.
 */
export function readSpec(issuePath: string, issue: string): Read {
  const errors: string[] = [];
  const doc = read(issuePath);
  if (!doc) return { ok: false, errors: [`no issue note at ${issuePath}`] };
  if (typeOf(doc) !== "issue") errors.push(`${issuePath}: not an issue note`);
  if (!itemsIn(noteOf(doc).body, "Done").length)
    errors.push(`${issuePath}: its Done has no items`);
  const dir = dirname(issuePath);
  const planFile = planPath(issuePath, issue);
  const planDoc = read(planFile);
  const cls: ClSpec[] = [];
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".md"))
    .sort()) {
    const text = read(join(dir, f));
    const { fields, body } = noteOf(text);
    if (fields["type"] !== "cl") continue;
    const to = linked(fields["belongsTo"]);
    if (to !== issue && to !== `${issue}-plan`) continue;
    const name = f.slice(0, -3);
    if (!name.startsWith(`${issue}-`)) {
      errors.push(`${name}: a cl of ${issue} is named ${issue}-<cut>`);
      continue;
    }
    if (fields["status"] !== "new") errors.push(`${name}: it is not new`);
    const c = clSpec.safeParse({
      name: name.slice(issue.length + 1),
      intent: firstLine(body),
      ...(fields["phase"] === undefined ? {} : { phase: fields["phase"] }),
      shape: fields["shape"],
      checkout: fields["checkout"],
      scope: fields["scope"],
      test: fields["test"],
      check: itemsIn(body, "Check").map((x) => x.slice(2)),
      seam: sectionIn(body, "Seam").trim(),
      checkoutNotes: sectionIn(body, "Checkout").trim(),
    });
    if (!c.success)
      errors.push(
        `${name}: not a cl: ${c.error.issues.map((x) => `${x.path.join(".") || "it"} ${x.message}`).join("; ")}`,
      );
    else cls.push(c.data);
  }
  if (!cls.length && !errors.length)
    errors.push(`no cl note belongs to ${issue} or its plan`);
  let planned: PlanSpec | undefined;
  if (planDoc) {
    const { fields, body } = noteOf(planDoc);
    if (fields["status"] !== "active")
      errors.push(`${planFile}: the plan is not active`);
    const phases: string[] = [];
    const listed = new Map<string, number>();
    let at = 0;
    for (const line of sectionIn(body, "Phases").split("\n")) {
      const ph = /^- Phase (\d+):\s*(.*)$/.exec(line);
      if (ph) {
        at = Number(ph[1]);
        phases[at - 1] = ph[2] ?? "";
        continue;
      }
      const cl = /^\s+- \[\[([^\]|#]+)\]\]/.exec(line);
      if (cl && at) listed.set(cl[1] ?? "", at);
    }
    for (const c of cls) {
      const name = `${issue}-${c.name}`;
      if (listed.get(name) !== c.phase)
        errors.push(
          `${planFile}: its Phases list puts ${name} ${listed.has(name) ? `in phase ${listed.get(name)}` : "nowhere"}, and the cl says phase ${c.phase ?? "none"}`,
        );
      listed.delete(name);
    }
    for (const n of listed.keys())
      errors.push(
        `${planFile}: its Phases list names ${n}, which is no cl of ${issue}`,
      );
    const p = planSpec.safeParse({
      approach: firstLine(body),
      phases: [...phases].map((x) => x ?? ""),
      ...(sectionIn(body, "Does not fit").trim() &&
      sectionIn(body, "Does not fit").trim() !== "Nothing."
        ? { doesNotFit: sectionIn(body, "Does not fit").trim() }
        : {}),
    });
    if (!p.success)
      errors.push(
        `${planFile}: not a plan: its approach and each phase's reason`,
      );
    else planned = p.data;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, spec: { ...(planned ? { plan: planned } : {}), cls } };
}
