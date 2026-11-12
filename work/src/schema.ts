/**
 * work: the types of the work, on basis. The work (objectives, issues), the plan that cuts an issue into CLs, and the
 * cl note that carries one cut to the agents that build it: what is tracked, how it nests and what blocks it. Each type
 * has a note in types/ that says what each part of its notes holds, and whose body a new note starts from. It holds no
 * notes: a graph that imports it holds the work, in its own ground. Work can belong to any note.
 */

import {
  defineRule,
  defineSchema,
  defineType,
  manyOrNone,
  one,
  type Type,
} from "@mku1tra/basis";
import * as z from "zod";

export const work = defineType({
  name: "work",
  description:
    "A tracked piece of work: where it belongs, and what blocks it. Abstract: a note is of a type that inherits it.",
  abstract: true,
  fields: {
    // The one note this is part of, of any type: other work, or a note about the thing it changes, often in another
    // repo. It is the roll-up, not the folder. A plain string, as "[[name]]", so Obsidian still follows it: the graph
    // that holds the work lints alone, so the lint cannot see a note of another repo, and it does not check this.
    belongsTo: z.string().nullable().optional(),
    // What this cannot finish without. Only the obvious dependencies; review catches the implicit ones. The return type
    // is said: objective and issue inherit work, so TypeScript cannot infer a type that names itself.
    dependsOn: manyOrNone((): readonly [Type, Type] => [objective, issue]),
  },
});

export const objective = defineType({
  name: "objective",
  description:
    "An end state to reach, with about three key results that show it is reached; issues hang under it. One is active at a time. The key results live in the body.",
  parents: [work],
  fields: {
    status: z
      .enum(["draft", "active", "archived", "dropped"])
      .describe(
        "draft: being written. active: the one being worked toward. archived: reached, or no longer current. dropped: abandoned",
      ),
  },
});

export const issue = defineType({
  name: "issue",
  description:
    "A tracked piece of work, from a bug to a project; every CL points to one. Its kind says which.",
  parents: [work],
  fields: {
    kind: z
      .enum([
        "bug",
        "feature-request",
        "internal-cleanup",
        "vulnerability",
        "project",
        "epic",
        "feature",
        "milestone",
        "story",
        "task",
      ])
      .describe(
        "What the work is (Google Issue Tracker's types). A problem: bug, feature-request, internal-cleanup, vulnerability. A piece of work, big to small: project, epic, feature, milestone, story, task",
      ),
    priority: z
      .enum(["P0", "P1", "P2", "P3", "P4"])
      .describe(
        "How soon it needs doing: P0, now at any cost, to P4, eventually. P2 is the default",
      ),
    // The repo the work changes, as "[[name]]" of its note: a plain string, as belongsTo is, since the repo's note is
    // outside the graph that holds the work, and its lint cannot see it.
    repo: z.string().optional(),
    status: z
      .enum(["new", "in-progress", "done", "dropped"])
      .describe(
        "new: not started. in-progress: claimed, being worked on. done: met, verified, proven where it runs and validated by a person; a controller reaches only verified, so it never sets done. dropped: abandoned, kept for history",
      ),
  },
});

export const plan = defineType({
  name: "plan",
  description:
    "The refinement of one issue, written as an argument: how its cls, in phases, meet the issue's done. Only when the issue takes more than one CL. Draft while it is cut, active once plan-review passes it.",
  fields: {
    // The issue it plans.
    belongsTo: one(() => issue),
    status: z
      .enum(["draft", "review", "active", "done", "dropped"])
      .describe(
        "draft: being cut. review: handed in, waiting for plan-review, and for a person's sign-off when the operator asks for one. active: passed, the cut in force. done: the issue's check is met. dropped: abandoned, kept for history",
      ),
  },
});

export const cl = defineType({
  name: "cl",
  description:
    "The spec of one cut, the CL that builds it, as a contract: its check is what it ensures, its phase what it requires, its seam what it keeps. Its shape, checkout and test command are data; its intent, check, seam and the description of its checkout are prose. The note holds the spec only: what happens to it (its state, attempts, results and findings) is the controller's record, keyed by its name. new once written, done once the CL lands.",
  fields: {
    // The plan it is a cut of, or the issue itself when the issue takes one CL.
    belongsTo: one(() => [plan, issue] as const),
    phase: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "Its phase in its plan, from 1: the phases run in order, and the cls of one phase need nothing from each other. None when it is the issue's lone cl",
      ),
    repo: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The repo it changes, by its folder's name: one of its issue's. A CL lands in one repo, so a change across repos is a cl per repo. None when its issue changes one repo",
      ),
    shape: z
      .object({
        change: z
          .enum(["behavior", "structure"])
          .describe(
            "behavior: its check fails before and passes after. structure: its check passes before and after",
          ),
        checked: z
          .enum(["repo", "system"])
          .describe(
            "where its check runs: in the repo, or on the running system",
          ),
      })
      .optional()
      .describe("What the change is, and where its check runs"),
    checkout: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "The paths its builders get on disk, from its repo's root, as git sparse-checkout patterns: a file, or a folder for all under it. Every path conceivably relevant to the cut, so they start from what the planner found, and its Checkout section says what each is",
      ),
    test: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The command its checks run: its new test files and the existing ones that test what it changes",
      ),
    status: z
      .enum(["new", "in-progress", "done", "dropped"])
      .describe(
        "new: written, not started. in-progress: its CL is being built. done: its CL landed. dropped: abandoned, kept for history",
      ),
  },
});

/** A plan's phases are its cls' `phase`, and they run 1, 2, 3 with no gap, so each cl has one. */
export const phases = defineRule({
  name: "phases",
  description:
    "A plan's cls each have a phase, and the phases run from 1 with no gap.",
  on: plan,
  check: (node, graph) => {
    const cls = graph.all(cl).filter((c) => c.belongsTo === node.name);
    const none = cls.filter((c) => c.phase === undefined).map((c) => c.name);
    const have = new Set(
      cls.flatMap((c) => (c.phase === undefined ? [] : [c.phase])),
    );
    const missing = [...Array(Math.max(0, ...have)).keys()]
      .map((i) => i + 1)
      .filter((p) => !have.has(p));
    return [
      ...(none.length
        ? [{ message: `its cls with no phase: ${none.join(", ")}` }]
        : []),
      ...(missing.length
        ? [
            {
              message: `its phases have a gap: no cl in phase ${missing.join(", ")}`,
            },
          ]
        : []),
    ];
  },
});

/** A plan is named for its issue: `<issue>-plan`. */
export const planName = defineRule({
  name: "plan-name",
  description: "A plan is named <issue>-plan, for the issue it belongs to.",
  on: plan,
  check: (node) =>
    node.name === `${node.belongsTo}-plan`
      ? []
      : [
          {
            message: `a plan of ${node.belongsTo} is named ${node.belongsTo}-plan`,
          },
        ],
});

/** A cl is named for its issue and its cut: `<issue>-<cut>`, whether it belongs to the issue's plan or to the issue. */
export const clName = defineRule({
  name: "cl-name",
  description:
    "A cl is named <issue>-<cut>, for the issue it belongs to through its plan, or directly.",
  on: cl,
  check: (node, graph) => {
    const issueName =
      graph.get(node.belongsTo, plan)?.belongsTo ?? node.belongsTo;
    return node.name.startsWith(`${issueName}-`) &&
      node.name !== `${issueName}-plan`
      ? []
      : [{ message: `a cl of ${issueName} is named ${issueName}-<cut>` }];
  },
});

// Named, then exported: tsc does not rewrite the `.ts` of an import() inside `export default`'s expression, so the
// built package would import a file it does not ship.
const schema = defineSchema({
  name: "work",
  description: "The work: what is tracked, how it nests, and what blocks it.",
  types: { work, objective, issue, plan, cl },
  rules: [phases, planName, clName],
  typeNotes: new URL("../types/", import.meta.url),
  exports: () => import("./schema.ts"),
});

export default schema;
