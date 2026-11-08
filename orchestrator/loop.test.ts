import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Step, Verdict } from "../process/step.ts";
import { open as openLedger, type Ledger } from "./ledger.ts";
import { loop, RunFailed, type Runner } from "./loop.ts";
import { writeSection } from "../effects/notes.ts";
import { commit, touched, worktree } from "../effects/git.ts";
import { close, open } from "../effects/sandbox.ts";
import { runTests } from "../effects/tests.ts";
import { ran } from "../process/fake-worktree.ts";

// Podman and git are faked: git, the sandbox and the test runs are the loop's only ways out. runOf is the real one.
vi.mock("../effects/git.ts", () => ({
  worktree: vi.fn(),
  commit: vi.fn(),
  merge: vi.fn(),
  head: vi.fn(),
  changed: vi.fn(),
  touched: vi.fn(),
}));
vi.mock("../effects/sandbox.ts", () => ({
  open: vi.fn(),
  close: vi.fn(),
  imageOf: vi.fn(),
}));
vi.mock("../effects/tests.ts", () => ({ runTests: vi.fn() }));

const cl = "## Check\n\n- b1\n\n## Tests\n\nold\n\n## Code\n\nkeep\n";

let dir: string;
let ledger: Ledger;
let verdict: Verdict;
const step: Step<{ word: "done"; text: string }> = {
  from: "ready",
  agent: "fake",
  done: z.object({ word: z.literal("done"), text: z.string() }),
  section: "Tests",
  render: (d) => d.text,
  check: async () => verdict,
};

/** One agent run, as the runner does it. */
type Run1 = Runner["run"];

/** A run that gives back `value` as the agent's output. */
const gives =
  (value: unknown, usage = { tokens: 120, cost: 0.002 }): Run1 =>
  async () => ({ value, usage });
const done = (text: string) => ({ result: { word: "done", text } });

/** The runner a loop opens: `run`, and a close that keeps its runs. */
const runnerOf = (run: Run1) => async (): Promise<Runner> => ({
  run,
  close: async () => undefined,
});

const make = (
  run: Run1,
  o: {
    steps?: Step<{ word: "done"; text: string }>[];
    concurrent?: number;
    timeoutMs?: number;
  } = {},
) =>
  loop({
    ledger,
    steps: o.steps ?? [step],
    runner: runnerOf(run),
    runs: join(dir, "runs"),
    ...o,
  });
type L = Awaited<ReturnType<typeof make>>;

beforeEach(() => {
  vi.resetAllMocks();
  dir = mkdtempSync(join(tmpdir(), "loop-"));
  writeFileSync(join(dir, "cl.md"), cl);
  ledger = openLedger(join(dir, "ledger.db"));
  ledger.addIssue({
    name: "i",
    path: join(dir, "issue.md"),
    repo: "/repo",
    image: "img",
    test: "suite",
  });
  ledger.addCl(
    {
      name: "c",
      issue: "i",
      seq: 1,
      path: join(dir, "cl.md"),
      repo: "/repo",
      image: "img",
      test: "t",
    },
    "ready",
  );
  verdict = { word: "pass", reason: "red at an assertion" };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs one tick, and waits for the attempts it started. */
async function once(loop: L | Promise<L>) {
  const l = await loop;
  await l.tick();
  await l.settled();
}

const last = () =>
  ledger.events("c").at(-1) as {
    word: string;
    to_state: string;
    reason: string;
    cause: string | null;
  };
const doc = () => readFileSync(join(dir, "cl.md"), "utf8");

describe("an attempt", () => {
  it("opens a sandbox, gives the agent the cl, and closes the sandbox when it ends", async () => {
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner));
    expect(open).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(
      "fake",
      cl,
      expect.objectContaining({
        run: expect.objectContaining({ name: "c", n: 1 }),
        readOnly: false,
      }),
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("moves a passed done result on, writes its section, commits, and records its usage", async () => {
    await once(make(gives(done("- b1: a.test.ts"))));
    expect(ledger.item("c").state).toBe("red");
    expect(commit).toHaveBeenCalledOnce();
    expect(doc()).toContain("## Tests\n\n- b1: a.test.ts\n\n## Code\n\nkeep\n");
    expect(ledger.attempt("c", 1)).toMatchObject({
      word: "pass",
      tokens: 120,
      cost: 0.002,
    });
  });

  it("retries a bound step whose worktree changed a file outside its change files, before its check", async () => {
    const view = { read: ["README"], change: ["src/a.ts"] };
    vi.mocked(touched).mockResolvedValue(["src/a.ts", "src/stray.ts"]);
    const check = vi.fn(async () => verdict);
    await once(
      make(gives(done("x")), { steps: [{ ...step, view: () => view, check }] }),
    );
    expect(last()).toMatchObject({
      word: "retry",
      cause: "scope_exceeds_change",
      reason: "changed files its cut does not: src/stray.ts",
    });
    expect(check).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("commits only a bound step's change files, and everything for a step with no view", async () => {
    vi.mocked(touched).mockResolvedValue(["src/a.ts"]);
    const view = { read: [], change: ["./src/a.ts"] };
    await once(
      make(gives(done("x")), { steps: [{ ...step, view: () => view }] }),
    );
    expect(vi.mocked(commit).mock.calls[0]?.[2]).toEqual(["src/a.ts"]);
  });

  it("gives the runner the step's view, and none for a step that has none", async () => {
    const view = { read: ["README"], change: ["src/a.ts"] };
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner, { steps: [{ ...step, view: () => view }] }));
    expect(runner.mock.calls[0]?.[2]).toMatchObject({ view });
    ledger.addCl(
      {
        name: "d",
        issue: "i",
        seq: 2,
        path: join(dir, "cl.md"),
        repo: "/repo",
        image: "img",
        test: "t",
      },
      "ready",
    );
    const free = vi.fn<Run1>(gives(done("x")));
    await once(make(free));
    expect(free.mock.calls[0]?.[2]).not.toHaveProperty("view");
  });

  it("tells the runner a step that must not edit is read-only, as its sandbox is", async () => {
    const ro = vi.fn<Run1>(gives(done("x")));
    await once(make(ro, { steps: [{ ...step, worktree: "ro" }] }));
    expect(ro.mock.calls[0]?.[2]).toMatchObject({ readOnly: true });
  });

  it("opens the attempt's worktree before its sandbox, read-only for a step that must not edit", async () => {
    await once(
      make(gives(done("x")), { steps: [{ ...step, worktree: "ro" }] }),
    );
    expect(vi.mocked(worktree).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(open).mock.invocationCallOrder[0] as number,
    );
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ name: "c" }), {
      readOnly: true,
    });
  });

  it("runs the tests once for a check that asks twice, and records the run with the attempt", async () => {
    vi.mocked(runTests).mockResolvedValue(ran(1, "AssertionError"));
    const asks: Step<{ word: "done"; text: string }> = {
      ...step,
      check: async (_r, _d, at) => {
        await at.test();
        const t = await at.test();
        return { word: "retry", reason: `exit ${t.code}` };
      },
    };
    await once(make(gives(done("x")), { steps: [asks] }));
    expect(runTests).toHaveBeenCalledOnce();
    const db = new DatabaseSync(join(dir, "ledger.db"));
    expect(db.prepare("SELECT name, n, code FROM check_runs").all()).toEqual([
      { name: "c", n: 1, code: 1 },
    ]);
    db.close();
  });

  it("records the test run of a check that failed after it", async () => {
    vi.mocked(runTests).mockResolvedValue(ran(0, "ok"));
    const throws: Step<{ word: "done"; text: string }> = {
      ...step,
      check: async (_r, _d, at) => {
        await at.test();
        throw new Error("the check broke");
      },
    };
    await once(make(gives(done("x")), { steps: [throws] }));
    expect(last()).toMatchObject({ word: "retry" });
    const db = new DatabaseSync(join(dir, "ledger.db"));
    expect(db.prepare("SELECT code FROM check_runs").all()).toEqual([
      { code: 0 },
    ]);
    db.close();
  });

  it("keeps the cl in its state when the check retries, and writes nothing", async () => {
    verdict = { word: "retry", reason: "behavior 1 has no test" };
    await once(make(gives(done("x"))));
    expect(ledger.item("c").state).toBe("ready");
    expect(last().reason).toBe("behavior 1 has no test");
    expect(doc()).toBe(cl);
    expect(commit).not.toHaveBeenCalled();
  });

  it("moves a raise to raised, and writes the Raise section", async () => {
    const raise = {
      word: "raise",
      from: "da-nail, tests",
      missing: "the seam",
      evidence: "Seam is empty",
    };
    await once(make(gives({ result: raise })));
    expect(ledger.item("c").state).toBe("raised");
    expect(last().cause).toBe("plan_gap");
    expect(doc()).toContain(
      "## Raise\n\n- from: da-nail, tests\n- missing: the seam\n- evidence: Seam is empty\n",
    );
  });

  it("retries an output that is not a result of the step", async () => {
    await once(make(gives({ result: { word: "done" } })));
    expect(last()).toMatchObject({
      word: "retry",
      to_state: "ready",
      cause: "invalid_output",
      reason: expect.stringMatching(/not a ready result/),
    });
  });

  it("retries when the run fails, and still closes the sandbox", async () => {
    await once(
      make(async () => {
        throw new Error("the model is down");
      }),
    );
    expect(last()).toMatchObject({
      word: "retry",
      reason: expect.stringMatching(/the model is down/),
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("gives a run that failed on its own the cause invalid_output, and a failure of the factory no cause", async () => {
    await once(
      make(async () => {
        throw new RunFailed("no submit");
      }),
    );
    expect(last().cause).toBe("invalid_output");
    vi.mocked(open).mockRejectedValueOnce(new Error("no such image"));
    await once(make(gives(done("x"))));
    expect(last().cause).toBeNull();
  });

  it("retries a run past its time limit, and tells the runner to stop", async () => {
    let stopped = false;
    const hangs: Run1 = (_a, _i, { signal }) =>
      new Promise(() =>
        signal.addEventListener("abort", () => (stopped = true)),
      );
    await once(make(hangs, { timeoutMs: 20 }));
    expect(last()).toMatchObject({
      word: "retry",
      cause: "budget_exceeded",
      reason: expect.stringMatching(/timed out after 20 ms/),
    });
    expect(stopped).toBe(true);
  });

  it("retries when the sandbox does not open, without running the agent", async () => {
    vi.mocked(open).mockRejectedValue(new Error("no such image"));
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner));
    expect(last()).toMatchObject({
      word: "retry",
      reason: expect.stringMatching(/did not open: no such image/),
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("ends the attempt when its sandbox neither opens nor is removed", async () => {
    vi.mocked(open).mockRejectedValue(new Error("podman is gone"));
    vi.mocked(close).mockRejectedValue(new Error("podman is gone"));
    await once(make(gives(done("x"))));
    expect(last()).toMatchObject({
      word: "retry",
      reason: expect.stringMatching(/did not open: podman is gone/),
    });
    expect(ledger.open()).toEqual([]);
  });
});

describe("a retry", () => {
  it("tells the runner a state's first attempt from its retries, so a retry runs on the bin's fallback", async () => {
    verdict = { word: "retry", reason: "behavior 1 has no test" };
    const runner = vi.fn<Run1>(gives(done("x")));
    const l = await make(runner);
    await once(l);
    await once(l);
    expect(runner.mock.calls.map((c) => c[2].retry)).toEqual([false, true]);
  });
});

describe("the tick", () => {
  it("takes up an attempt a stopped orchestrator left open: its sandbox again, the same run, and it ends as any other", async () => {
    const n = ledger.begin("c");
    const run = vi.fn<Run1>(gives(done("- b1: a.test.ts")));
    await once(make(run));
    // Its worktree is there before the runner opens, and its sandbox comes up when it is taken up.
    expect(worktree).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      "fake",
      cl,
      expect.objectContaining({ run: expect.objectContaining({ n }) }),
    );
    expect(ledger.item("c").state).toBe("red");
    expect(ledger.attempt("c", n)).toMatchObject({ resumed: 1, word: "pass" });
    expect(ledger.events("c").map((e) => e["word"])).not.toContain("retry");
  });

  it("takes up the open attempts before it starts new ones, all under one cap", async () => {
    ledger.addCl(
      {
        name: "d",
        issue: "i",
        seq: 2,
        path: join(dir, "cl.md"),
        repo: "/repo",
        image: "img",
        test: "t",
      },
      "ready",
    );
    ledger.begin("d");
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const l = await make(async () => (await gate, { value: done("x") }), {
      concurrent: 1,
    });
    await l.tick();
    expect(l.running()).toBe(1);
    expect(ledger.open()).toEqual([{ name: "d", n: 1, step: "ready" }]);
    release();
    await l.settled();
  });

  it("ends nothing when it closes: a run still going leaves its attempt open, with its sandbox", async () => {
    let fail: (e: Error) => void = () => undefined;
    const l = await make(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    await l.tick();
    await l.close();
    fail(new Error("the runtime closed"));
    await l.settled();
    expect(ledger.open()).toEqual([{ name: "c", n: 1, step: "ready" }]);
    expect(close).not.toHaveBeenCalled();
    expect(await (await make(gives(done("x")))).tick()).toBeUndefined();
  });

  it("stops a check that is running when it closes, and leaves its attempt open, unwritten", async () => {
    let checking = () => {};
    const inCheck = new Promise<void>((r) => (checking = r));
    const hangs: Step<{ word: "done"; text: string }> = {
      ...step,
      check: () => {
        checking();
        return new Promise<Verdict>(() => undefined);
      },
    };
    const l = await make(gives(done("x")), { steps: [hangs] });
    await l.tick();
    await inCheck;
    await l.close();
    await l.settled();
    expect(ledger.open()).toEqual([{ name: "c", n: 1, step: "ready" }]);
    expect(commit).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(doc()).toBe(cl);
  });

  it("answers a check that a path outside the worktree is not in it", async () => {
    let seen: string[] = [];
    const asks: Step<{ word: "done"; text: string }> = {
      ...step,
      check: async (_r, _d, at) => {
        seen = at.exists(["../log", "/etc/passwd", "cl.md"]);
        return verdict;
      },
    };
    await once(make(gives(done("x")), { steps: [asks] }));
    expect(seen).toEqual([]);
  });

  it("ends a taken-up attempt whose sandbox does not open again as a retry, as a new one", async () => {
    ledger.begin("c");
    vi.mocked(open).mockRejectedValue(new Error("the worktree is gone"));
    await once(make(gives(done("x"))));
    expect(ledger.events("c").at(-1)).toMatchObject({
      word: "retry",
      reason: expect.stringMatching(/did not open: the worktree is gone/),
    });
  });

  it("runs at most `concurrent` attempts at once", async () => {
    for (const name of ["d", "e"])
      ledger.addCl(
        {
          name,
          issue: "i",
          seq: name === "d" ? 2 : 3,
          path: join(dir, "cl.md"),
          repo: "/repo",
          image: "img",
          test: "t",
        },
        "ready",
      );
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const l = await make(async () => (await gate, { value: done("x") }), {
      concurrent: 2,
    });
    await l.tick();
    expect(l.running()).toBe(2);
    expect(ledger.open()).toHaveLength(2);
    release();
    await l.settled();
    await once(l);
    expect(ledger.open()).toHaveLength(0);
    expect(["c", "d", "e"].map((c) => ledger.item(c).state)).toEqual([
      "red",
      "red",
      "red",
    ]);
  });

  it("does not take an attempt still opening for one left open", async () => {
    let opened = () => {};
    vi.mocked(open).mockReturnValue(new Promise<void>((r) => (opened = r)));
    const l = await make(gives(done("x")));
    const first = l.tick();
    await l.tick();
    opened();
    await first;
    await l.settled();
    expect(
      ledger.events("c").map((e) => (e as { word: string }).word),
    ).not.toContain("retry");
    expect(ledger.item("c").state).toBe("red");
  });
});

describe("a word with no move", () => {
  it("escalates the item, with why, and leaves no attempt open to run again", async () => {
    verdict = { word: "to-plan", reason: "back to the planner" };
    await once(make(gives(done("x"))));
    expect(ledger.item("c").state).toBe("escalated");
    expect(ledger.open()).toEqual([]);
    expect(ledger.events("c").at(-1)).toMatchObject({
      reason: expect.stringMatching(/no transition from ready on to-plan/),
    });
  });
});

describe("a review's send-back", () => {
  it("writes the Review section, commits, and moves the cl back", async () => {
    const sendBack: Step<{ word: "done"; text: string }> = {
      ...step,
      from: "green",
      section: "Review",
      check: async () => ({ word: "to-code", reason: "back to code" }),
    };
    ledger.addCl(
      {
        name: "g",
        issue: "i",
        seq: 4,
        path: join(dir, "cl.md"),
        repo: "/repo",
        image: "img",
        test: "t",
      },
      "green",
    );
    await once(make(gives(done("- finding: b1 edge")), { steps: [sendBack] }));
    expect(ledger.item("g").state).toBe("red");
    expect(ledger.rounds("g")).toBe(1);
    expect(commit).toHaveBeenCalledOnce();
    expect(doc()).toContain("## Review\n\n- finding: b1 edge\n");
  });
});

describe("writeSection", () => {
  const file = () => join(dir, "cl.md");

  it("replaces one section and leaves the others", () => {
    writeSection(file(), "Tests", "new");
    expect(doc()).toBe(
      "## Check\n\n- b1\n\n## Tests\n\nnew\n\n## Code\n\nkeep\n",
    );
  });

  it("replaces the last section", () => {
    writeSection(file(), "Code", "changed");
    expect(doc()).toBe(
      "## Check\n\n- b1\n\n## Tests\n\nold\n\n## Code\n\nchanged\n",
    );
  });

  it("adds a section the cl does not have, at the end", () => {
    writeSection(file(), "Raise", "r");
    expect(doc()).toBe(`${cl}\n## Raise\n\nr\n`);
  });
});
