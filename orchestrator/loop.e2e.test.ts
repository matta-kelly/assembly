/**
 * The end to end test of the whole loop, an issue from open to accepted, with only the model faked: a real repo, a
 * real sandbox per attempt, que-pasa's run with the real agents and tools, the real checks, git commits and the real
 * `git land`, onto a bare repo as the land target, and the notes the orchestrator writes. The planner cuts the issue
 * into two cls; plan-review approves; each cl goes through nail, hammer and review, and lands on main before the next
 * phase starts; acceptance runs the full suite on main and accepts. A second issue's planner raises.
 *
 * Each agent's model is scripted (pi-ai's faux provider): it reads the conversation so far and makes its next tool
 * call, so the tools run for real in the sandbox. The reviews try to write the worktree first, and only go on if the
 * read-only mount refused it.
 *
 * Run by `just e2e`, in the orchestrator's image, so the paths it hands podman are host paths: its folder is under the
 * repo, mounted at the same path. Skipped elsewhere.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clReview } from "../workspace/agents/cl-review.ts";
import { daHammer } from "../workspace/agents/da-hammer.ts";
import { daNail } from "../workspace/agents/da-nail.ts";
import { issueReviewer } from "../workspace/agents/issue-review.ts";
import { planReviewer } from "../workspace/agents/plan-review.ts";
import { planner } from "../workspace/agents/planner.ts";
import { crateTarget, landTarget } from "../effects/land-target.fixture.ts";
import {
  containerfile,
  devcontainer,
  smoke,
} from "../effects/dev-image.fixture.ts";
import { standInRegistry } from "../effects/registry.fixture.ts";
import { devImage, npmSetup } from "../effects/repo.ts";
import { blocked, explain } from "../cli/report.ts";
import { compose } from "../main.ts";
import { advance } from "./advance.ts";
import { nail } from "../process/nail.ts";

const image = "docker.io/library/node:22.23.4-slim";
const suite = "node --test test/*.test.mjs";
/** The issue's setup: what installs its dependencies into each new worktree, here a folder git ignores. */
const setup = "mkdir -p deps && echo 'export const two = 2;' > deps/two.mjs";

const issueNote = (raise: boolean) => `---
type: issue
description: "Two exports, value and double. A fixture of the factory's end to end test."
kind: task
priority: P2
status: new
---
src/value.mjs exports value, and src/double.mjs exports double, which doubles it.${raise ? "\n\nRAISE" : ""}

---
## Intent

Two small exports, each with its tests.

## Done

- src/value.mjs exports value, which is 2
- src/double.mjs exports double(), which returns value times 2
`;

type Message = { role: string; content?: unknown };
const text = (m: Message) =>
  typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
type Call = ReturnType<typeof fauxToolCall>;

/**
 * A scripted model: from the conversation so far (the user's message, which is the agent's input, and how many tool
 * results it has had, the last one too), it gives the next tool call of `script`. A reply as a function of the
 * transcript, so runs at once never take each other's.
 */
function scripted(script: (input: string, done: number, last: string) => Call) {
  const step: FauxResponseStep = (context) => {
    const messages = context.messages as Message[];
    const results = messages.filter((m) => m.role === "toolResult");
    const input = text(
      messages.find((m) => m.role === "user") ?? { role: "user" },
    );
    return fauxAssistantMessage(
      [script(input, results.length, text(results.at(-1) ?? { role: "x" }))],
      {
        stopReason: "toolUse",
      },
    );
  };
  return Array.from({ length: 100 }, () => step);
}
const submit = (result: object) =>
  fauxToolCall("submit", { result } as Parameters<typeof fauxToolCall>[1]);

const cl = (
  name: string,
  intent: string,
  promise: string,
  phase: number | undefined,
  read: string[] = [],
) => ({
  name,
  intent,
  ...(phase === undefined ? {} : { phase }),
  shape: { change: "behavior", checked: "repo" },
  checkout: [`src/${name}.mjs`, `test/${name}.test.mjs`, "README", ...read],
  test: `node --test test/${name}.test.mjs`,
  promises: [promise],
  seam: `src/${name}.mjs's export, which the next cl imports`,
  checkoutNotes: "- README: the repo has no code yet",
});

const plannerScript = (input: string, done: number) => {
  if (input.includes("RAISE"))
    return submit({
      word: "back",
      findings: [
        {
          about: "issue",
          what: "the issue's intent is not there",
          where: "RAISE",
        },
      ],
    });
  if (done === 0) return fauxToolCall("ls", {});
  if (input.includes("TWO REPOS"))
    return submit({
      word: "done",
      plan: {
        approach: "alpha in ra, beta in rb: neither needs the other",
        phases: ["alpha and beta, one in each repo, apart"],
      },
      cls: [
        {
          ...cl(
            "alpha",
            "ra's src/alpha.mjs exports alpha, which is 2",
            "given src/alpha.mjs, when imported, then alpha is 2",
            1,
          ),
          repo: "ra",
        },
        {
          ...cl(
            "beta",
            "rb's src/beta.mjs exports beta, which is 2",
            "given src/beta.mjs, when imported, then beta is 2",
            1,
          ),
          repo: "rb",
        },
      ],
    });
  return submit({
    word: "done",
    plan: {
      approach: "value first, then double, which imports it",
      phases: ["value, which double imports", "double, once value has landed"],
    },
    cls: [
      cl(
        "value",
        "src/value.mjs exports value, which is 2",
        "given src/value.mjs, when imported, then value is 2",
        1,
      ),
      cl(
        "double",
        "src/double.mjs exports double",
        "given value is 2, when double() runs, then it returns 4",
        2,
        // the earlier phase makes it
        ["src/value.mjs"],
      ),
    ],
  });
};

/** A review's first move: try to write the worktree. It goes on only when the read-only mount refused it. */
const refused = (last: string) => /Read-only file system/.test(last);
const tryWrite = fauxToolCall("execute", { command: "touch /work/edited" });

const planReviewScript = (_input: string, done: number, last: string) => {
  if (done === 0) return tryWrite;
  if (!refused(last))
    return submit({
      word: "back",
      findings: [{ about: "plan", what: "writable", where: "/work" }],
    });
  return submit({ word: "done" });
};

const testOf = (name: string, imports: string, assertion: string) =>
  [
    'import { test } from "node:test";',
    'import assert from "node:assert";',
    imports,
    `test("${name}", () => ${assertion});`,
    "",
  ].join("\n");

/** da-nail writes its cut's failing test and the stub it imports, runs it, and submits. */
const nailScript = (input: string, done: number) => {
  const lone = /The cut (alpha|beta) of/.exec(input)?.[1];
  if (lone) {
    if (done === 0)
      return fauxToolCall("write_file", {
        file_path: `test/${lone}.test.mjs`,
        content: testOf(
          lone,
          `import { ${lone} } from "../src/${lone}.mjs";`,
          `assert.strictEqual(${lone}, 2)`,
        ),
      });
    if (done === 1)
      return fauxToolCall("write_file", {
        file_path: `src/${lone}.mjs`,
        content: `export const ${lone} = 0;\n`,
      });
    if (done === 2) return fauxToolCall("test", {});
    return submit({
      word: "done",
      tests: [{ promise: 1, file: `test/${lone}.test.mjs`, name: lone }],
    });
  }
  const double = input.includes("The cut double of");
  const name = double ? "double" : "value";
  if (done === 0)
    return fauxToolCall("write_file", {
      file_path: `test/${name}.test.mjs`,
      content: double
        ? testOf(
            "double",
            'import { double } from "../src/double.mjs";',
            "assert.strictEqual(double(), 4)",
          )
        : testOf(
            "value",
            'import { value } from "../src/value.mjs";\nimport { two } from "../deps/two.mjs";',
            "assert.strictEqual(value, two)",
          ),
    });
  if (done === 1)
    return fauxToolCall("write_file", {
      file_path: `src/${name}.mjs`,
      content: double
        ? "export const double = () => 0;\n"
        : "export const value = 0;\n",
    });
  if (done === 2) return fauxToolCall("test", {});
  return submit({
    word: "done",
    tests: [{ promise: 1, file: `test/${name}.test.mjs`, name }],
  });
};

/** A tool result as the model got it: its text parts, joined. */
const plain = (last: string) => {
  try {
    const parts = JSON.parse(last) as { text?: string }[];
    return parts.map((p) => p.text ?? "").join("");
  } catch {
    return last;
  }
};

/**
 * What value's da-hammer saw when it read past its cl's checkout, before it coded: a file outside it, and the root.
 */
const probed: string[] = [];
const probes = [
  fauxToolCall("read_file", { file_path: "NOTES" }),
  fauxToolCall("ls", { path: "." }),
];

/** da-hammer makes its cut's test pass. value's first reads past its cut's checkout. */
const hammerScript = (input: string, at: number, last: string) => {
  const lone = /The cut (alpha|beta) of/.exec(input)?.[1];
  if (lone)
    return at === 0
      ? fauxToolCall("edit_file", {
          file_path: `src/${lone}.mjs`,
          old_string: `${lone} = 0`,
          new_string: `${lone} = 2`,
        })
      : submit({ word: "done", changed: [`src/${lone}.mjs`] });
  const double = input.includes("The cut double of");
  // a run of value's hammer starts its probes again: the last run's are the ones checked
  if (!double && at === 0) probed.length = 0;
  if (!double && at > 0 && at <= probes.length) probed.push(plain(last));
  if (!double && at < probes.length) return probes[at] as Call;
  const done = double ? at : at - probes.length;
  if (done === 0)
    return double
      ? fauxToolCall("write_file", {
          file_path: "src/double.mjs",
          content:
            'import { value } from "./value.mjs";\n\nexport const double = () => value * 2;\n',
        })
      : fauxToolCall("edit_file", {
          file_path: "src/value.mjs",
          old_string: "value = 0",
          new_string: "value = 2",
        });
  return submit({
    word: "done",
    changed: [double ? "src/double.mjs" : "src/value.mjs"],
  });
};

const clReviewScript = (_input: string, done: number, last: string) => {
  if (done === 0) return tryWrite;
  if (!refused(last))
    return submit({
      word: "back",
      findings: [{ about: "code", what: "writable", where: "/work" }],
    });
  return submit({ word: "done" });
};

/** issue-review runs the issue's check, the whole suite, then accepts. */
const issueReviewScript = (_input: string, done: number, last: string) => {
  if (done === 0) return tryWrite;
  if (done === 1 && !refused(last))
    return submit({
      word: "back",
      findings: [{ about: "plan", what: "writable", where: "/work" }],
    });
  if (done === 1) return fauxToolCall("execute", { command: suite });
  return submit({ word: "done" });
};

/** A plan of two repos, the second on the first's published version: a is the package, b depends on it. */
const versionPlanner = (_input: string, done: number) => {
  if (done === 0) return fauxToolCall("ls", {});
  return submit({
    word: "done",
    plan: {
      approach: "a is a package; b takes the version a publishes",
      phases: ["a, the package", "b, on the version a published"],
    },
    cls: [
      {
        ...cl(
          "a",
          "ra's one and two each export 2",
          "given one and two, when imported, then each is 2",
          1,
        ),
        repo: "ra",
        checkout: ["one/index.js", "two/index.js", "test/a.test.mjs"],
        test: "node --test test/a.test.mjs",
        seam: "the two packages' exports, which b's versions carry",
        checkoutNotes:
          "- one/index.js, two/index.js: the two packages' exports\n- test/a.test.mjs: the test",
      },
      {
        ...cl(
          "b",
          "rb's src/b.mjs exports b, which doubles a, from the version rb depends on",
          "given the version rb depends on, when b() runs, then it returns 4",
          2,
        ),
        repo: "rb",
        checkout: ["src/b.mjs", "test/b.test.mjs", "package.json"],
        test: "node --test test/b.test.mjs",
        seam: "src/b.mjs's export",
        checkoutNotes:
          "- src/b.mjs: the code\n- test/b.test.mjs: the test\n- package.json: the dependency the move changes",
      },
    ],
  });
};

/** da-nail writes its cut's failing test, a stub for b where its file is missing, runs it, and submits. */
const cutNail = (input: string, done: number) => {
  const cut = /The cut (a|b) of/.exec(input)?.[1] as "a" | "b" | undefined;
  if (!cut) return submit({ word: "done", tests: [] });
  if (cut === "a") {
    if (done === 0)
      return fauxToolCall("write_file", {
        file_path: "test/a.test.mjs",
        content: testOf(
          "a",
          'import { one } from "../one/index.js";\nimport { two } from "../two/index.js";',
          "assert.deepStrictEqual([one, two], [2, 2])",
        ),
      });
    if (done === 1) return fauxToolCall("test", {});
    return submit({
      word: "done",
      tests: [{ promise: 1, file: "test/a.test.mjs", name: "a" }],
    });
  }
  if (done === 0)
    return fauxToolCall("write_file", {
      file_path: "test/b.test.mjs",
      content: testOf(
        "b",
        'import { b } from "../src/b.mjs";',
        "assert.strictEqual(b(), 4)",
      ),
    });
  if (done === 1)
    return fauxToolCall("write_file", {
      file_path: "src/b.mjs",
      content: "export const b = () => 0;\n",
    });
  if (done === 2) return fauxToolCall("test", {});
  return submit({
    word: "done",
    tests: [{ promise: 1, file: "test/b.test.mjs", name: "b" }],
  });
};

/** da-hammer makes its cut's test pass, in the files it wrote. */
const cutHammer = (input: string, done: number) => {
  const cut = /The cut (a|b) of/.exec(input)?.[1] as "a" | "b" | undefined;
  if (!cut) return submit({ word: "done", changed: [] });
  if (cut === "a") {
    if (done === 0)
      return fauxToolCall("write_file", {
        file_path: "one/index.js",
        content: "export const one = 2;\n",
      });
    if (done === 1)
      return fauxToolCall("write_file", {
        file_path: "two/index.js",
        content: "export const two = 2;\n",
      });
    return submit({
      word: "done",
      changed: ["one/index.js", "two/index.js"],
    });
  }
  if (done === 0)
    return fauxToolCall("write_file", {
      file_path: "src/b.mjs",
      content:
        'import { one } from "@e2e/one";\nimport { two } from "@e2e/two";\n\nexport const b = () => one + two;\n',
    });
  return submit({ word: "done", changed: ["src/b.mjs"] });
};

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    timeout: 180_000,
  }).trim();

type Span = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  links?: { spanId: string }[];
  attributes: { key: string; value: Record<string, unknown> }[];
};

/** An attempt's trace: every span in its file, over all its lines and scopes, and its root, the attempt span. */
function traceIn(folder: string) {
  const spans = readFileSync(join(folder, "trace.jsonl"), "utf8")
    .trim()
    .split("\n")
    .flatMap((line) =>
      (
        JSON.parse(line) as {
          resourceSpans: { scopeSpans: { spans: Span[] }[] }[];
        }
      ).resourceSpans.flatMap((r) => r.scopeSpans.flatMap((x) => x.spans)),
    );
  return {
    spans,
    root: spans.find((x) => !x.parentSpanId) as Span,
    named: (name: string) => spans.find((x) => x.name === name),
  };
}

const attrOf = (s: Span | undefined, key: string) => {
  const v = s?.attributes.find((a) => a.key === key)?.value;
  return v && Object.values(v)[0];
};

describe.skipIf(!process.env["ASSEMBLY_E2E"])(
  "the whole loop, end to end",
  () => {
    let dir: string;
    let repo: string;
    let bare: string;

    beforeAll(() => {
      mkdirSync(".e2e", { recursive: true });
      dir = mkdtempSync(join(process.cwd(), ".e2e", "run-"));
      repo = join(dir, "repo");
      mkdirSync(repo);
      git(repo, "init", "-q", "-b", "main");
      writeFileSync(join(repo, "README"), "a repo\n");
      // in no cut: no bound agent may see it
      writeFileSync(join(repo, "NOTES"), "not in any cut\n");
      // what setup installs: in no commit
      writeFileSync(join(repo, ".gitignore"), "deps/\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "init");
      bare = landTarget(repo, dir);
      mkdirSync(join(dir, "work"));
      writeFileSync(join(dir, "work", "is.md"), issueNote(false));
      writeFileSync(join(dir, "work", "gap.md"), issueNote(true));
    });
    // The attempts' sandboxes go too, also when the test fails before the loop closes them: a name left behind would
    // stop the next run's attempt from opening.
    afterAll(
      () => {
        // ASSEMBLY_E2E_KEEP keeps the run folder, its worktrees, logs and notes, to read after a failure.
        if (!process.env["ASSEMBLY_E2E_KEEP"])
          rmSync(dir, { recursive: true, force: true });
        // the stand-in registry has a name of its own, not an attempt's
        execFileSync(
          "podman",
          ["rm", "-f", "--ignore", "assembly-e2e-registry"],
          {
            stdio: "ignore",
          },
        );
        const names = [
          "is",
          "gap",
          "is-value",
          "is-double",
          "rs-value",
          "mr",
          "mr-alpha",
          "mr-beta",
          "rz-one",
          "dp",
          "dp-a",
          "dp-b",
        ];
        for (const name of names.flatMap((c) =>
          Array.from({ length: 8 }, (_, n) => `assembly-${c}-${n + 1}`),
        ))
          execFileSync("podman", ["rm", "-f", "--ignore", name], {
            stdio: "ignore",
          });
      },
      // removing every sandbox one by one takes longer than a hook's default on a busy machine
      120_000,
    );

    it(
      "takes one issue from open to accepted, through a plan of two cls, and raises the other",
      { timeout: 600_000 },
      async () => {
        const models = createModels();
        const model = (
          provider: string,
          script: Parameters<typeof scripted>[0],
        ) => {
          const faux = fauxProvider({ provider });
          models.setProvider(faux.provider);
          faux.setResponses(scripted(script));
          const m = faux.getModel();
          return `${m.provider}:${m.id}`;
        };
        // Each agent on its own scripted model, first attempt or retry alike.
        const scripts = {
          planner: model("faux-planner", plannerScript),
          "plan-review": model("faux-plan-review", planReviewScript),
          "da-nail": model("faux-nail", nailScript),
          "da-hammer": model("faux-hammer", hammerScript),
          "cl-review": model("faux-cl-review", clReviewScript),
          "issue-review": model("faux-issue-review", issueReviewScript),
        };
        const agents = {
          make: {
            planner,
            "plan-review": planReviewer,
            "da-nail": daNail,
            "da-hammer": daHammer,
            "cl-review": clReview,
            "issue-review": issueReviewer,
          },
          modelFor: (name: string) => scripts[name as keyof typeof scripts],
        };

        // The factory as main composes it, with every step, on scripted models.
        const f = compose({ home: dir, agents, models, timeoutMs: 120_000 });
        const ledger = f.ledger;
        const notes = join(dir, "work");
        ledger.addIssue({
          name: "is",
          path: join(notes, "is.md"),
          repo,
          image,
          test: suite,
          setup,
        });
        ledger.addIssue({
          name: "gap",
          path: join(notes, "gap.md"),
          repo,
          image,
          test: suite,
        });
        const runs = f.runs;
        const l = await f.loop();

        const settled = ["accepted", "raised", "escalated"];
        for (let i = 0; i < 40; i++) {
          await l.tick();
          await l.settled();
          if (
            settled.includes(ledger.item("is").state) &&
            settled.includes(ledger.item("gap").state)
          )
            break;
        }
        // The orchestrator's own moves for a settled item come on the tick after: an accepted issue's notes are done.
        await l.tick();

        // Each item's one worktree was set up once, before its first agent: value's test imports what setup installed.
        const attemptsOf = (under: string) =>
          readdirSync(under)
            .filter((n) => /^\d+$/.test(n))
            .map((n) => join(under, n));
        expect(existsSync(join(runs, "is", "issue", "setup.done"))).toBe(true);
        for (const c of ["value", "double"]) {
          expect(existsSync(join(runs, "is", "cl", c, "setup.done"))).toBe(
            true,
          );
          const logs = attemptsOf(join(runs, "is", "cl", c))
            .map((a) =>
              existsSync(join(a, "log"))
                ? readFileSync(join(a, "log"), "utf8")
                : "",
            )
            .join("\n");
          expect(logs.match(/^set up in \d+ s$/gm)).toHaveLength(1);
        }

        // value's da-hammer had the whole repo: NOTES, in no cut's checkout, is there to read, and so is the root.
        expect(probed[0]).toMatch(/not in any cut/);
        expect(probed[1]).toMatch(/NOTES/);

        // Accepted, the issue leaves nothing behind: no worktree, and no branch.
        expect(git(repo, "worktree", "list", "--porcelain")).not.toMatch(
          /runs\/is\//,
        );
        expect(git(repo, "branch", "--list", "assembly/is*")).toBe("");

        // The issue went through each of its steps once, in order, and each cl through its own.
        const moves = (name: string) =>
          ledger
            .events(name)
            .map((e) => `${String(e["from_state"])}>${String(e["to_state"])}`);
        expect(moves("is"), JSON.stringify(ledger.events("is"))).toEqual([
          "new>open",
          "open>planned",
          "planned>building",
          "building>built",
          "built>accepted",
        ]);
        for (const cl of ["is-value", "is-double"])
          expect(
            moves(cl),
            `${cl}: ${JSON.stringify(ledger.events(cl))}`,
          ).toEqual([
            ...(cl === "is-double"
              ? ["new>waiting", "waiting>ready"]
              : ["new>ready"]),
            "ready>red",
            "red>green",
            "green>approved",
            "approved>landed",
          ]);
        expect(ledger.item("gap").state).toBe("raised");

        // The orchestrator wrote the plan and its cl notes from the plan, never a finding. It writes no note's status.
        const note = (name: string) =>
          readFileSync(join(notes, `${name}.md`), "utf8");
        for (const n of ["is", "is-value", "is-double", "gap"])
          expect(note(n)).not.toMatch(
            /^## (Plan review|Acceptance|Tests|Code|Review|Raise)$/m,
          );
        expect(note("is-plan")).toContain(
          "- Phase 2: double, once value has landed\n\t- [[is-double]]",
        );
        expect(note("is-double")).toContain(
          'checkout: ["src/double.mjs","test/double.test.mjs","README","src/value.mjs"]',
        );

        // Main, on the land target, holds both cls, in order: each one's test, then its code, each titled as crate reads
        // a release: the tests as `test`, the code by the issue's kind, a task's as `chore`. No issue branch is made.
        expect(git(bare, "show", "main:src/double.mjs")).toContain("value * 2");
        expect(
          git(bare, "log", "--format=%s", "main")
            .trim()
            .split("\n")
            .map((s) => /^\w+\([^)]+\)(?=: )/.exec(s)?.[0] ?? s),
        ).toEqual([
          "chore(is-double)",
          "test(is-double)",
          "chore(is-value)",
          "test(is-value)",
          "init",
        ]);
        expect(git(repo, "branch", "--list", "assembly/is/head")).toBe("");

        // Every trial is under its issue: the issue's own attempts, and each cl's.
        for (const n of [1, 2, 3])
          expect(existsSync(join(runs, "is", "issue", String(n)))).toBe(true);
        // Each tool call is in its attempt's trace, not its log.
        for (const cl of ["value", "double"])
          expect(
            traceIn(join(runs, "is", "cl", cl, "1")).spans.map((x) => x.name),
          ).toContain("execute_tool write_file");
        // the acceptance review ran the suite itself
        expect(
          traceIn(join(runs, "is", "issue", "3"))
            .spans.filter((x) => x.name === "execute_tool execute")
            .map((x) => String(attrOf(x, "gen_ai.tool.call.arguments"))),
        ).toContainEqual(expect.stringMatching(/node --test/));

        // The planner's raise is a message about the issue, to Matt, and each cl's landed files are kept.
        expect(
          ledger.events("gap").find((e) => e.word === "back"),
        ).toMatchObject({
          to_state: "raised",
          findings: [{ about: "issue", where: "RAISE" }],
        });
        const db = new DatabaseSync(join(dir, "ledger.db"));
        expect(
          db
            .prepare(
              "SELECT path FROM paths WHERE name = 'is-double' ORDER BY path",
            )
            .all()
            .map((p) => p["path"]),
        ).toEqual(["src/double.mjs", "test/double.test.mjs"]);
        // Each check's test run is recorded with its attempt: the cl's red, green and review checks, on real trees.
        const checks = db
          .prepare(
            "SELECT step, code, tree FROM check_runs WHERE name = 'is-value' ORDER BY id",
          )
          .all();
        expect(checks.map((c) => [c["step"], c["code"]])).toEqual([
          ["ready", 1],
          ["red", 0],
          ["green", 0],
        ]);
        expect(
          checks.every((c) => /^[0-9a-f]{40}$/.test(c["tree"] as string)),
        ).toBe(true);
        expect(checks[0]?.["tree"]).not.toBe(checks[1]?.["tree"]);
        db.close();

        // Every attempt is one trace in its folder: the attempt span is its root, with the ids on the ledger's row, and
        // que-pasa's run is under it, with its messages. The acceptance links to the attempts it judged: the plan, and
        // each cl's nail, hammer and review.
        const issueRuns = [1, 2, 3].map((n) =>
          traceIn(join(runs, "is", "issue", String(n))),
        );
        expect(issueRuns.map((t) => t.root.name)).toEqual([
          "attempt open is",
          "attempt planned is",
          "attempt built is",
        ]);
        issueRuns.forEach((t, i) =>
          expect(
            ledger.attempt("is", i + 1) as Record<string, unknown>,
          ).toMatchObject({
            trace_id: t.root.traceId,
            span_id: t.root.spanId,
          }),
        );
        const plannerRun = issueRuns[0]?.named("invoke_agent planner");
        expect(plannerRun?.parentSpanId).toBe(issueRuns[0]?.root.spanId);
        expect(attrOf(plannerRun, "gen_ai.input.messages")).toBeTruthy();
        expect(issueRuns[1]?.root.links?.map((l) => l.spanId)).toEqual([
          issueRuns[0]?.root.spanId,
        ]);
        expect(issueRuns[2]?.root.links).toHaveLength(7);

        const nailRun = traceIn(join(runs, "is", "cl", "value", "1"));
        expect(nailRun.spans.map((x) => x.name)).toContain(
          "execute_tool write_file",
        );
        expect(nailRun.named("check ready")?.parentSpanId).toBe(
          nailRun.root.spanId,
        );
        expect(attrOf(nailRun.root, "container.image.name")).toBe(image);
        expect(attrOf(nailRun.root, "container.image.id")).toMatch(
          /^[0-9a-f]{64}$/,
        );
        await l.close();
      },
    );

    it(
      "takes up an attempt a stopped orchestrator left: the same run, in the same sandbox, goes on to red",
      { timeout: 300_000 },
      async () => {
        const at = join(dir, "restart");
        mkdirSync(join(at, "work"), { recursive: true });
        const clPath = join(at, "work", "rs-value.md");
        writeFileSync(
          clPath,
          "---\ntype: cl\nstatus: new\n---\nThe cut value of rs.\n\n---\n## Promises\n\n- given value, when read, then 2\n",
        );

        // da-nail's third model call, after its two writes, waits: the first orchestrator closes while it is out. Its
        // abort is the close's, and pi sends the request again in the second one, which answers it.
        let reached = () => {};
        const out = new Promise<void>((r) => (reached = r));
        let first = true;
        const steps = scripted(nailScript).map(
          (step): FauxResponseStep =>
            (context, options, state, model) => {
              const results = (context.messages as Message[]).filter(
                (m) => m.role === "toolResult",
              ).length;
              if (results === 2 && first) {
                first = false;
                reached();
                return new Promise((_resolve, reject) =>
                  options?.signal?.addEventListener("abort", () =>
                    reject(new Error("aborted by the close")),
                  ),
                );
              }
              return (
                step as Exclude<FauxResponseStep, object & { role: string }>
              )(context, options, state, model);
            },
        );
        const models = createModels();
        const faux = fauxProvider({ provider: "faux-restart" });
        models.setProvider(faux.provider);
        faux.setResponses(steps);
        const nailModel = `${faux.getModel().provider}:${faux.getModel().id}`;
        const agents = {
          make: { "da-nail": daNail },
          modelFor: () => nailModel,
        };

        const f = compose({
          home: at,
          agents,
          models,
          steps: [nail],
          timeoutMs: 120_000,
        });
        const ledger = f.ledger;
        // A lone cl enters as submit enters it: Matt's spec, his two passes, and the engine builds it.
        ledger.addIssue({
          name: "rs",
          path: join(at, "work", "rs.md"),
          repo,
          image,
          test: suite,
          setup,
        });
        const pass = { word: "pass" as const, reason: "Matt", findings: [] };
        ledger.apply("rs", pass, "matt");
        ledger.keepSpec(
          "rs",
          {
            cls: [
              cl(
                "value",
                "value is 2",
                "given value, when read, then 2",
                undefined,
              ),
            ],
          },
          "matt",
        );
        ledger.apply("rs", pass, "matt");
        await advance(ledger);
        const sandbox = () =>
          execFileSync(
            "podman",
            [
              "container",
              "inspect",
              "--format",
              "{{.Id}}",
              "assembly-rs-value-1",
            ],
            { encoding: "utf8" },
          ).trim();

        const one = await f.loop();
        await one.tick();
        await out;
        await one.close();
        expect(ledger.open()).toEqual([
          { name: "rs-value", n: 1, step: "ready" },
        ]);
        const kept = sandbox();

        const two = await f.loop();
        expect(sandbox()).toBe(kept);
        await two.tick();
        await two.settled();
        await two.close();

        expect(ledger.item("rs-value").state).toBe("red");
        expect(ledger.attempt("rs-value", 1)).toMatchObject({
          word: "pass",
          resumed: 1,
        });
        expect(ledger.events("rs-value").map((e) => e["word"])).not.toContain(
          "retry",
        );
        // One attempt, one trace: each orchestrator's part of the run is under the attempt span, the second marked
        // resumed, and the tool calls of both are in it.
        const t = traceIn(join(at, "runs", "rs", "cl", "value", "1"));
        const segments = t.spans.filter(
          (x) => x.name === "invoke_agent da-nail",
        );
        expect(segments).toHaveLength(2);
        expect(segments.every((x) => x.parentSpanId === t.root.spanId)).toBe(
          true,
        );
        expect(segments.map((x) => attrOf(x, "que_pasa.resumed"))).toContain(
          true,
        );
        expect(
          t.spans
            .map((x) => x.name)
            .filter((n) => n.startsWith("execute_tool"))
            .sort(),
        ).toEqual([
          "execute_tool submit",
          "execute_tool test",
          "execute_tool write_file",
          "execute_tool write_file",
        ]);
        expect(attrOf(t.root, "assembly.resumed")).toBe(1);
        expect(
          readFileSync(
            join(at, "runs", "rs", "cl", "value", "1", "log"),
            "utf8",
          ),
        ).toMatch(/taken up by a new orchestrator/);
        // set up once, by the first orchestrator: the second's take-up found it done, under its running agent
        expect(
          readFileSync(
            join(at, "runs", "rs", "cl", "value", "1", "log"),
            "utf8",
          ).match(/^set up in/gm),
        ).toHaveLength(1);
      },
    );

    it(
      "escalates a submitted issue to Matt with the findings of a cl that raised, and builds no further",
      { timeout: 300_000 },
      async () => {
        const at = join(dir, "raise");
        mkdirSync(join(at, "work"), { recursive: true });
        for (const n of ["one", "two"])
          writeFileSync(
            join(at, "work", `rz-${n}.md`),
            `---\ntype: cl\nstatus: new\n---\nThe cut ${n} of rz.\n\n---\n## Promises\n\n- given ${n}, when read, then 2\n`,
          );

        // da-nail cannot meet the cut as it stands: it hands back two findings about the cl.
        const models = createModels();
        const faux = fauxProvider({ provider: "faux-raise" });
        models.setProvider(faux.provider);
        faux.setResponses(
          scripted(() =>
            submit({
              word: "back",
              findings: [
                {
                  about: "cl",
                  what: "the promise names a file the checkout lacks",
                  where: "Promises 1",
                },
                {
                  about: "cl",
                  what: "the seam contradicts the intent",
                  where: "Seam",
                },
              ],
            }),
          ),
        );
        const nailModel = `${faux.getModel().provider}:${faux.getModel().id}`;
        const f = compose({
          home: at,
          agents: { make: { "da-nail": daNail }, modelFor: () => nailModel },
          models,
          steps: [nail],
          timeoutMs: 120_000,
        });
        const ledger = f.ledger;
        // The issue enters as submit enters it: Matt's spec, his two passes, two cls in two phases.
        ledger.addIssue({
          name: "rz",
          path: join(at, "work", "rz.md"),
          repo,
          image,
          test: suite,
          setup,
        });
        const pass = { word: "pass" as const, reason: "Matt", findings: [] };
        ledger.apply("rz", pass, "matt");
        ledger.keepSpec(
          "rz",
          {
            cls: [
              cl("one", "one is 2", "given one, when read, then 2", 1),
              cl("two", "two is 2", "given two, when read, then 2", 2),
            ],
          },
          "matt",
        );
        ledger.apply("rz", pass, "matt");

        const l = await f.loop();
        for (let i = 0; i < 10; i++) {
          await l.tick();
          await l.settled();
          if (ledger.item("rz").state === "escalated") break;
        }
        const attempts = () =>
          ["rz", "rz-one", "rz-two"].map((n) => ledger.attemptsOf(n).length);
        const after = attempts();
        // more ticks: nothing starts
        for (let i = 0; i < 3; i++) {
          await l.tick();
          await l.settled();
        }
        await l.close();

        // The issue is Matt's, with the cl's findings in its message.
        expect(ledger.item("rz").state).toBe("escalated");
        expect(ledger.item("rz-one").state).toBe("raised");
        expect(ledger.inbox("rz", "escalated")).toMatchObject([
          {
            word: "escalate",
            findings: [
              { about: "cl", where: "Promises 1" },
              { about: "cl", where: "Seam" },
            ],
          },
        ]);
        const line = blocked(ledger).find((x) => x.startsWith("rz  "));
        expect(line).toMatch(/^rz {2}escalated/);
        expect(line).toContain("rz-one raised");
        expect(explain(ledger, join(at, "runs"), "rz")).toContain(
          "     cl: the promise names a file the checkout lacks (Promises 1)",
        );

        // Nothing is built after it: the phase 2 cl is never ready, and no attempt starts.
        expect(ledger.item("rz-two").state).toBe("waiting");
        expect(
          ledger.events("rz-two").filter((e) => e["to_state"] === "ready"),
        ).toEqual([]);
        expect(ledger.open()).toEqual([]);
        expect(attempts()).toEqual(after);
      },
    );

    it(
      "takes an issue across two repos to accepted: a cl lands in each, and each repo's suite runs",
      { timeout: 600_000 },
      async () => {
        const at = join(dir, "across");
        mkdirSync(join(at, "work"), { recursive: true });
        // two repos, each with its own land target
        const repoOf = (name: string) => {
          const r = join(at, name);
          mkdirSync(join(r, "test"), { recursive: true });
          writeFileSync(join(r, "README"), `${name}\n`);
          writeFileSync(join(r, ".gitignore"), "deps/\n");
          // its full suite has a test from the start, so it runs before and after its cl
          writeFileSync(
            join(r, "test", "readme.test.mjs"),
            testOf(
              "readme",
              'import { readFileSync } from "node:fs";',
              'assert.ok(readFileSync("README", "utf8"))',
            ),
          );
          git(r, "init", "-q", "-b", "main");
          git(r, "add", "-A");
          git(r, "commit", "-q", "-m", "init");
          const target = join(at, `${name}.target`);
          mkdirSync(target);
          return { repo: r, bare: landTarget(r, target) };
        };
        const ra = repoOf("ra");
        const rb = repoOf("rb");
        writeFileSync(
          join(at, "work", "mr.md"),
          issueNote(false)
            .replace(
              "Two exports, value and double.",
              "One export in each of two repos.",
            )
            .replace("## Intent", "## Intent\n\nTWO REPOS"),
        );

        const models = createModels();
        const model = (
          provider: string,
          script: Parameters<typeof scripted>[0],
        ) => {
          const faux = fauxProvider({ provider });
          models.setProvider(faux.provider);
          faux.setResponses(scripted(script));
          const m = faux.getModel();
          return `${m.provider}:${m.id}`;
        };
        const scripts = {
          planner: model("faux-planner-mr", plannerScript),
          "plan-review": model("faux-plan-review-mr", planReviewScript),
          "da-nail": model("faux-nail-mr", nailScript),
          "da-hammer": model("faux-hammer-mr", hammerScript),
          "cl-review": model("faux-cl-review-mr", clReviewScript),
          "issue-review": model("faux-issue-review-mr", issueReviewScript),
        };
        const f = compose({
          home: at,
          agents: {
            make: {
              planner,
              "plan-review": planReviewer,
              "da-nail": daNail,
              "da-hammer": daHammer,
              "cl-review": clReview,
              "issue-review": issueReviewer,
            },
            modelFor: (name: string) => scripts[name as keyof typeof scripts],
          },
          models,
          timeoutMs: 120_000,
        });
        const ledger = f.ledger;
        const repo = (name: string, r: { repo: string }) => ({
          name,
          repo: r.repo,
          image,
          test: suite,
          setup,
        });
        ledger.addIssueAcross({
          name: "mr",
          path: join(at, "work", "mr.md"),
          image,
          repos: [repo("ra", ra), repo("rb", rb)],
        });
        const l = await f.loop();
        const settled = ["accepted", "raised", "escalated"];
        for (let i = 0; i < 40; i++) {
          await l.tick();
          await l.settled();
          if (settled.includes(ledger.item("mr").state)) break;
        }
        await l.tick();

        const moves = (name: string) =>
          ledger
            .events(name)
            .map((e) => `${String(e["from_state"])}>${String(e["to_state"])}`);
        expect(moves("mr"), JSON.stringify(ledger.events("mr"))).toEqual([
          "new>open",
          "open>planned",
          "planned>building",
          "building>built",
          "built>accepted",
        ]);
        // each cl is in its own repo, with that repo's settings, and both were phase 1
        expect(ledger.item("mr-alpha").repo).toBe(ra.repo);
        expect(ledger.item("mr-beta").repo).toBe(rb.repo);
        for (const c of ["mr-alpha", "mr-beta"])
          expect(moves(c), `${c}: ${JSON.stringify(ledger.events(c))}`).toEqual(
            [
              "new>ready",
              "ready>red",
              "red>green",
              "green>approved",
              "approved>landed",
            ],
          );

        // each landed on its own repo's main, and only there
        expect(git(ra.bare, "show", "main:src/alpha.mjs")).toContain(
          "alpha = 2",
        );
        expect(git(rb.bare, "show", "main:src/beta.mjs")).toContain("beta = 2");
        expect(
          git(ra.bare, "ls-tree", "-r", "--name-only", "main"),
        ).not.toMatch(/beta/);
        expect(
          git(rb.bare, "ls-tree", "-r", "--name-only", "main"),
        ).not.toMatch(/alpha/);

        // the issue's worktree held both repos, each set up once with its own setup
        const issueRuns = join(f.runs, "mr", "issue");
        for (const r of ["ra", "rb"])
          expect(existsSync(join(issueRuns, "repos", r, "setup.done"))).toBe(
            true,
          );

        // acceptance ran each repo's suite on main: both green, alpha's and beta's tests among them
        const db = new DatabaseSync(join(at, "ledger.db"));
        const accepted = db
          .prepare(
            "SELECT reason FROM events WHERE name = 'mr' AND to_state = 'accepted'",
          )
          .get() as { reason: string };
        expect(accepted.reason).toMatch(/full suite is green/);
        db.close();
        await l.close();
      },
    );

    it(
      "moves a waiting cl's repo onto the version its dependency published, and takes the issue to accepted",
      { timeout: 900_000 },
      async () => {
        const at = join(dir, "versions");
        mkdirSync(join(at, "work"), { recursive: true });
        const registry = standInRegistry(join(at, "registry"));
        try {
          // The releases B's lockfile holds before the move: one previous version of each package ra ships.
          const released = (
            name: string,
            version: string,
            exported: string,
          ) => {
            const dir = join(at, name.replace(/[^a-z0-9]+/gi, "-"), version);
            mkdirSync(dir, { recursive: true });
            writeFileSync(
              join(dir, "package.json"),
              `${JSON.stringify({ name, version, type: "module", exports: "./index.js" }, null, 2)}\n`,
            );
            writeFileSync(
              join(dir, "index.js"),
              `export const ${exported} = 1;\n`,
            );
            return registry.add(name, version, dir);
          };
          const one = released("@e2e/one", "1.0.0", "one");
          const two = released("@e2e/two", "0.9.0", "two");

          /** A repo on crate: its check, its suite, and the files crate makes a dev image from. */
          const repoOf = (name: string) => {
            const r = join(at, name);
            mkdirSync(join(r, "scripts"), { recursive: true });
            mkdirSync(join(r, "test"), { recursive: true });
            mkdirSync(join(r, ".devcontainer"), { recursive: true });
            git(r, "init", "-q", "-b", "main");
            writeFileSync(
              join(r, "crate.toml"),
              `crate = "1"\nimage = "${image}"\n`,
            );
            // the repo's check: its dependencies installed, then its tests
            writeFileSync(
              join(r, "scripts", "check.sh"),
              "#!/bin/sh\nnpm ci --no-audit --no-fund\nnode --test test/*.test.mjs\n",
            );
            chmodSync(join(r, "scripts", "check.sh"), 0o755);
            // crate builds the image and then runs this: an offline install from its cache.
            writeFileSync(join(r, "scripts", "dev-image-smoke.sh"), smoke());
            chmodSync(join(r, "scripts", "dev-image-smoke.sh"), 0o755);
            writeFileSync(join(r, ".gitignore"), "node_modules/\n");
            writeFileSync(
              join(r, ".devcontainer", "Containerfile"),
              containerfile(name),
            );
            writeFileSync(
              join(r, ".devcontainer", "devcontainer.json"),
              devcontainer(name),
            );
            writeFileSync(
              join(r, "test", "base.test.mjs"),
              testOf("base", "", "assert.ok(true)"),
            );
            return r;
          };
          const target = (name: string) => {
            const t = join(at, `${name}.target`);
            mkdirSync(t);
            return t;
          };
          /** A crate target, with crate's check output kept short enough to read in a failure. */
          const onCrate = (repo: string, name: string) => {
            try {
              return crateTarget(repo, target(name));
            } catch (e) {
              const remote = (e as Error).message
                .split("\n")
                .filter((l) => l.startsWith("remote:"))
                .slice(0, 12)
                .join(" | ");
              throw new Error(`${name}: crate refused main: ${remote}`, {
                cause: e,
              });
            }
          };

          // A, the package repo: two packages, each its own folder, which its cl makes 2.
          const ra = repoOf("ra");
          writeFileSync(
            join(ra, "package.json"),
            `${JSON.stringify({ name: "ra-root", version: "0.0.0", private: true }, null, 2)}\n`,
          );
          // a repo on crate with no dependencies still has a lockfile: its setup is the repo's offline install.
          writeFileSync(
            join(ra, "package-lock.json"),
            `${JSON.stringify(
              {
                name: "ra-root",
                version: "0.0.0",
                lockfileVersion: 3,
                requires: true,
                packages: { "": { name: "ra-root", version: "0.0.0" } },
              },
              null,
              2,
            )}\n`,
          );
          for (const [folder, name, version] of [
            ["one", "@e2e/one", "1.2.0"],
            ["two", "@e2e/two", "1.0.0"],
          ] as const) {
            mkdirSync(join(ra, folder));
            writeFileSync(
              join(ra, folder, "package.json"),
              `${JSON.stringify({ name, version, type: "module", exports: "./index.js" }, null, 2)}\n`,
            );
            writeFileSync(
              join(ra, folder, "index.js"),
              `export const ${folder} = 1;\n`,
            );
          }
          git(ra, "add", "-A");
          git(ra, "commit", "-q", "-m", "feat: the two packages, one and two");
          const raBare = onCrate(ra, "ra");
          const raMain = git(raBare, "rev-parse", "main");
          git(ra, "fetch", "-q", "server", "main");
          // The repo takes its dev image at add: crate made it on the push that checked main.
          const raImage = await devImage(ra);

          // B, which depends on both of A's packages: its lockfile holds their previous versions.
          const rb = repoOf("rb");
          writeFileSync(
            join(rb, "package.json"),
            `${JSON.stringify({ name: "rb", version: "0.0.0", private: true, type: "module", dependencies: { "@e2e/one": "^1.0.0", "@e2e/two": "^0.9.0" } }, null, 2)}\n`,
          );
          // npm installs from the stand-in registry: the --registry the move is given.
          writeFileSync(join(rb, ".npmrc"), `registry=${registry.url}\n`);
          writeFileSync(
            join(rb, "package-lock.json"),
            `${JSON.stringify(
              {
                name: "rb",
                version: "0.0.0",
                lockfileVersion: 3,
                requires: true,
                packages: {
                  "": {
                    name: "rb",
                    version: "0.0.0",
                    dependencies: {
                      "@e2e/one": "^1.0.0",
                      "@e2e/two": "^0.9.0",
                    },
                  },
                  "node_modules/@e2e/one": {
                    version: "1.0.0",
                    resolved: one.resolved,
                    integrity: one.integrity,
                  },
                  "node_modules/@e2e/two": {
                    version: "0.9.0",
                    resolved: two.resolved,
                    integrity: two.integrity,
                  },
                },
              },
              null,
              2,
            )}\n`,
          );
          git(rb, "add", "-A");
          git(rb, "commit", "-q", "-m", "feat: b, on the two packages");
          const rbBare = onCrate(rb, "rb");
          const rbStart = git(rbBare, "rev-parse", "main");
          git(rb, "fetch", "-q", "server", "main");
          const rbImage = await devImage(rb);

          writeFileSync(
            join(at, "work", "dp.md"),
            `---
type: issue
description: "Two packages in one repo, their dependent in the other. A fixture of the factory's end to end test."
kind: task
priority: P2
status: new
---
ra ships two packages, and rb depends on both.

---
## Intent

One and two, each exported, with b on the versions ra published.

## Done

- ra's one and two each export 2
- rb's src/b.mjs exports b, which is 4, on the versions rb depends on
`,
          );

          // The factory, every step on scripted models, with the stand-in registry as its own.
          const models = createModels();
          const modelOf = (
            provider: string,
            script: Parameters<typeof scripted>[0],
          ) => {
            const faux = fauxProvider({ provider });
            models.setProvider(faux.provider);
            faux.setResponses(scripted(script));
            const m = faux.getModel();
            return `${m.provider}:${m.id}`;
          };
          const scripts = {
            planner: modelOf("faux-vp-planner", versionPlanner),
            "plan-review": modelOf("faux-vp-plan-review", planReviewScript),
            "da-nail": modelOf("faux-vp-nail", cutNail),
            "da-hammer": modelOf("faux-vp-hammer", cutHammer),
            "cl-review": modelOf("faux-vp-cl-review", clReviewScript),
            "issue-review": modelOf("faux-vp-issue-review", issueReviewScript),
          };
          const f = compose({
            home: at,
            agents: {
              make: {
                planner,
                "plan-review": planReviewer,
                "da-nail": daNail,
                "da-hammer": daHammer,
                "cl-review": clReview,
                "issue-review": issueReviewer,
              },
              modelFor: (name: string) => scripts[name as keyof typeof scripts],
            },
            models,
            registry: {
              url: registry.url,
              published: async (n, v) => registry.published(n, v),
            },
            timeoutMs: 180_000,
          });
          const ledger = f.ledger;
          ledger.addIssueAcross({
            name: "dp",
            path: join(at, "work", "dp.md"),
            image,
            repos: [
              {
                name: "ra",
                repo: ra,
                image: raImage,
                test: "scripts/check.sh all",
                setup: npmSetup,
              },
              {
                name: "rb",
                repo: rb,
                image: rbImage,
                test: "scripts/check.sh all",
                setup: npmSetup,
              },
            ],
          });

          const l = await f.loop();
          // The outside world, which the test plays: A's land is released as v1.2.0, and the next tick publishes it
          // to the stand-in registry, so B waits for it in between, as it would for npm.
          let tagged = false;
          let published = false;
          const release = () => {
            const landed = git(raBare, "rev-parse", "main");
            // crate's version tags, one for each package folder its release made
            git(raBare, "tag", "one-v1.2.0", landed);
            git(raBare, "tag", "two-v1.0.0", landed);
            tagged = true;
          };
          const publish = () => {
            git(ra, "fetch", "-q", "server", "main");
            const tree = join(at, "a-landed");
            if (!existsSync(tree))
              git(ra, "worktree", "add", "--detach", tree, "server/main");
            registry.add("@e2e/one", "1.2.0", join(tree, "one"));
            registry.add("@e2e/two", "1.0.0", join(tree, "two"));
            published = true;
          };
          const settled = ["accepted", "raised", "escalated"];
          // Its own end, before the test's: a case that waits for a cl that never lands ends here, and fails.
          const start = Date.now();
          try {
            for (let i = 0; i < 60 && Date.now() - start < 420_000; i++) {
              await l.tick();
              await l.settled();
              if (!tagged && git(raBare, "rev-parse", "main") !== raMain)
                release();
              else if (tagged && !published) publish();
              if (settled.includes(ledger.item("dp").state)) break;
            }
            await l.tick();
          } finally {
            await l.close();
          }

          // The issue is accepted: a landed in its repo, then b, on a's version.
          const moves = (name: string) =>
            ledger
              .events(name)
              .map(
                (e) => `${String(e["from_state"])}>${String(e["to_state"])}`,
              );
          expect(
            ledger.item("dp").state,
            JSON.stringify({
              dp: moves("dp"),
              dpWhy: ledger.events("dp").map((e) => [e.word, e.reason]),
              a: {
                moves: moves("dp-a"),
                events: ledger.events("dp-a").map((e) => [e.word, e.reason]),
              },
              b: {
                moves: moves("dp-b"),
                events: ledger.events("dp-b").map((e) => [e.word, e.reason]),
              },
              attempts: ledger
                .items()
                .filter((i) => i.kind === "cl")
                .map((i) => [i.name, ledger.attemptsOf(i.name).length]),
            }),
          ).toBe("accepted");
          expect(moves("dp")).toEqual([
            "new>open",
            "open>planned",
            "planned>building",
            "building>built",
            "built>accepted",
          ]);
          expect(moves("dp-a")).toEqual([
            "new>ready",
            "ready>red",
            "red>green",
            "green>approved",
            "approved>landed",
          ]);
          expect(moves("dp-b")).toEqual([
            "new>waiting",
            // the retry that records why it waited: the version its repo needs was not on npm yet
            "waiting>waiting",
            "waiting>ready",
            "ready>red",
            "red>green",
            "green>approved",
            "approved>landed",
          ]);

          // B waited for the version A released, before it started.
          const b = ledger.events("dp-b");
          const held = b.findIndex((e) => e.word === "retry");
          expect(b[held]?.reason).toMatch(/@e2e\/one.*1\.2\.0.*not on npm yet/);
          expect(held).toBeLessThan(b.findIndex((e) => e.to_state === "ready"));

          // Main took its branch: the moves first, then its own work, one build commit per package, the second on
          // the first, and no version of its own.
          const commits = git(
            rbBare,
            "log",
            "--format=%H %s",
            `${rbStart}..main`,
          )
            .split("\n")
            .map((line) => {
              const [sha, ...subject] = line.split(" ");
              return { sha, subject: subject.join(" ") };
            });
          const builds = commits.filter((c) =>
            c.subject.startsWith("build(deps): "),
          );
          expect(builds.map((c) => c.subject).sort()).toEqual([
            "build(deps): @e2e/one to 1.2.0",
            "build(deps): @e2e/two to 1.0.0",
          ]);
          const newest = builds[0];
          const oldest = builds[1];
          // the second move's commit sits on the first's
          expect(git(rbBare, "rev-parse", `${newest?.sha}^`)).toBe(oldest?.sha);
          const manifest = JSON.parse(
            git(rbBare, "show", "main:package.json"),
          ) as { dependencies: Record<string, string> };
          expect(manifest.dependencies).toMatchObject({
            "@e2e/one": "^1.2.0",
            "@e2e/two": "^1.0.0",
          });
          const lock = JSON.parse(
            git(rbBare, "show", "main:package-lock.json"),
          ) as { packages: Record<string, { version?: string }> };
          expect(lock.packages["node_modules/@e2e/one"]?.version).toBe("1.2.0");
          expect(lock.packages["node_modules/@e2e/two"]?.version).toBe("1.0.0");

          // The item took a dev image of the moved commits, one its attempts ran in: not main's, which the first
          // move alone would leave. Its cache holds both moved versions, or the offline setup below fails.
          const moved = ledger.item("dp-b").image;
          expect(moved).not.toBe(image);
          expect(moved).not.toBe(rbImage);
          expect(moved).toMatch(/rb-dev:/);
          const db = new DatabaseSync(join(at, "ledger.db"));
          expect(
            db
              .prepare(
                "SELECT DISTINCT image FROM check_runs WHERE name = 'dp-b'",
              )
              .all()
              .map((x) => x["image"]),
          ).toEqual([moved]);
          db.close();

          // The issue takes the same image for b's repo, so acceptance installs the moved lockfile offline.
          expect(
            ledger.item("dp").repos.find((r) => r.name === "rb")?.image,
          ).toBe(moved);
          // b's attempts had their dependencies installed, offline, from that image's cache.
          expect(existsSync(join(f.runs, "dp", "cl", "b", "setup.done"))).toBe(
            true,
          );

          // Each landed on its own repo's main, and only there.
          expect(git(raBare, "show", "main:one/index.js")).toContain("one = 2");
          expect(git(raBare, "show", "main:two/index.js")).toContain("two = 2");
          expect(git(rbBare, "show", "main:src/b.mjs")).toContain("one + two");
          // The move's commit asks no version: b's repo is released by nothing the move did.
          expect(git(rbBare, "tag", "--list")).toBe("");
          expect(
            git(raBare, "ls-tree", "-r", "--name-only", "main"),
          ).not.toMatch(/src\/b\.mjs/);
        } finally {
          registry.close();
        }
      },
    );
  },
);
