/**
 * The end to end test of the whole loop, an issue from open to accepted, with only the model faked: a real repo, a
 * real sandbox per attempt, que-pasa's run with the real agents and tools, the real checks, git commits and merges,
 * and the notes the orchestrator writes. The planner cuts the issue into two cls; plan-review approves; each cl goes
 * through nail, hammer and review, and is merged into the issue's branch before the next starts; acceptance runs the
 * full suite and accepts. A second issue's planner raises.
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
import { clReview } from "../agents/cl-review.ts";
import { daHammer } from "../agents/da-hammer.ts";
import { daNail } from "../agents/da-nail.ts";
import { issueReviewer } from "../agents/issue-review.ts";
import { planReviewer } from "../agents/plan-review.ts";
import { planner } from "../agents/planner.ts";
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
  behavior: string,
  phase: number | undefined,
  read: string[] = [],
) => ({
  name,
  intent,
  ...(phase === undefined ? {} : { phase }),
  shape: { change: "behavior", checked: "repo" },
  checkout: [`src/${name}.mjs`, `test/${name}.test.mjs`, "README", ...read],
  scope: [`src/${name}.mjs`, `test/${name}.test.mjs`],
  test: `node --test test/${name}.test.mjs`,
  check: [behavior],
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
  return submit({
    word: "done",
    plan: {
      approach: "value first, then double, which imports it",
      phases: ["value, which double imports", "double, once value is merged"],
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
    tests: [{ behavior: 1, file: `test/${name}.test.mjs`, name }],
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
 * What value's da-hammer saw when it reached past its cut, before it coded: a file in no cut, the root, and a write
 * outside its change files.
 */
const probed: string[] = [];
const probes = [
  fauxToolCall("read_file", { file_path: "NOTES" }),
  fauxToolCall("ls", { path: "." }),
  fauxToolCall("write_file", { file_path: "src/stray.mjs", content: "x" }),
];

/** da-hammer makes its cut's test pass. value's first reaches past its cut. */
const hammerScript = (input: string, at: number, last: string) => {
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

/** issue-review runs the issue's Check, the whole suite, then accepts. */
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

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

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

    beforeAll(() => {
      mkdirSync(".e2e", { recursive: true });
      dir = mkdtempSync(join(process.cwd(), ".e2e", "run-"));
      repo = join(dir, "repo");
      mkdirSync(repo);
      git(repo, "init", "-q", "-b", "main");
      writeFileSync(join(repo, "README"), "a repo\n");
      // in no cut: no bound agent may see it
      writeFileSync(join(repo, "NOTES"), "not in any cut\n");
      // what setup installs: in no commit, and outside every cut's scope check
      writeFileSync(join(repo, ".gitignore"), "deps/\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "init");
      mkdirSync(join(dir, "work"));
      writeFileSync(join(dir, "work", "is.md"), issueNote(false));
      writeFileSync(join(dir, "work", "gap.md"), issueNote(true));
    });
    // The attempts' sandboxes go too, also when the test fails before the loop closes them: a name left behind would
    // stop the next run's attempt from opening.
    afterAll(() => {
      // ASSEMBLY_E2E_KEEP keeps the run folder, its worktrees, logs and notes, to read after a failure.
      if (!process.env["ASSEMBLY_E2E_KEEP"])
        rmSync(dir, { recursive: true, force: true });
      const names = ["is", "gap", "is-value", "is-double", "rs-value"];
      for (const name of names.flatMap((c) =>
        Array.from({ length: 8 }, (_, n) => `assembly-${c}-${n + 1}`),
      ))
        execFileSync("podman", ["rm", "-f", "--ignore", name], {
          stdio: "ignore",
        });
    });

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

        // Each of is's attempts was set up once, before its agent, from its own worktree: value's test imports what
        // setup installed, and the folder, ignored, crossed no cut's scope check.
        const attemptsOf = (under: string) =>
          readdirSync(under).map((n) => join(under, n));
        const isAttempts = [
          ...attemptsOf(join(runs, "is", "issue")),
          ...["value", "double"].flatMap((c) =>
            attemptsOf(join(runs, "is", "cl", c)),
          ),
        ];
        for (const a of isAttempts) {
          expect(existsSync(join(a, "setup.done"))).toBe(true);
          expect(readFileSync(join(a, "log"), "utf8")).toMatch(
            /^set up in \d+ s$/m,
          );
        }

        // value's da-hammer reached only its cut: NOTES, which is in its worktree, answered as missing; the root held
        // only the cut's files; the write outside its change files left nothing.
        expect(probed).toEqual([
          "Error: File 'NOTES' not found",
          "README\nsrc/\ntest/",
          expect.stringMatching(
            /^Error: permission denied for write on src\/stray.mjs/,
          ),
        ]);
        const valueRuns = join(runs, "is", "cl", "value");
        const works = readdirSync(valueRuns).map((n) =>
          join(valueRuns, n, "work"),
        );
        expect(works.some((w) => existsSync(join(w, "NOTES")))).toBe(true);
        expect(
          works.filter((w) => existsSync(join(w, "src", "stray.mjs"))),
        ).toEqual([]);

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
            "approved>merged",
          ]);
        expect(ledger.item("gap").state).toBe("raised");

        // The orchestrator wrote the plan and its cl notes from the plan, and each status: never a finding.
        const note = (name: string) =>
          readFileSync(join(notes, `${name}.md`), "utf8");
        expect(note("is")).toMatch(/^status: done$/m);
        for (const n of ["is", "is-value", "is-double", "gap"])
          expect(note(n)).not.toMatch(
            /^## (Plan review|Acceptance|Tests|Code|Review|Raise)$/m,
          );
        expect(note("is-plan")).toMatch(/^status: done$/m);
        expect(note("is-plan")).toContain(
          "- Phase 2: double, once value is merged\n\t- [[is-double]]",
        );
        expect(note("is-double")).toContain(
          'scope: ["src/double.mjs","test/double.test.mjs"]',
        );
        expect(note("is-value")).toMatch(/^status: done$/m);

        // The issue's branch holds both cls, in order: each one's test, then its code.
        expect(git(repo, "show", "assembly/is/head:src/double.mjs")).toContain(
          "value * 2",
        );
        expect(
          git(repo, "log", "--format=%s", "main..assembly/is/head")
            .trim()
            .split("\n"),
        ).toEqual([
          "da-hammer(is-double)",
          "da-nail(is-double)",
          "da-hammer(is-value)",
          "da-nail(is-value)",
        ]);

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

        // The planner's raise is a message about the issue, to Matt, and each cl's planned and merged files are the
        // context hit rate's two sides.
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
              "SELECT kind, path FROM paths WHERE name = 'is-double' ORDER BY kind, path",
            )
            .all()
            .map((p) => `${p["kind"] as string} ${p["path"] as string}`),
        ).toEqual([
          "actual src/double.mjs",
          "actual test/double.test.mjs",
          "planned src/double.mjs",
          "planned test/double.test.mjs",
        ]);
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
          "---\ntype: cl\nstatus: new\n---\nThe cut value of rs.\n\n---\n## Check\n\n- given value, when read, then 2\n",
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
  },
);
