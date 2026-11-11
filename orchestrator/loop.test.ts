import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Message, Step } from "../process/step.ts";
import { open as openLedger, type Ledger } from "./ledger.ts";
import { loop, RunFailed, type Runner } from "./loop.ts";
import { commit, worktree } from "../effects/git.ts";
import { land } from "../effects/land.ts";
import { close, open } from "../effects/sandbox.ts";
import { runTests } from "../effects/tests.ts";
import {
  forgetSetup,
  needsSetup,
  prepareFull,
  runSetup,
} from "../effects/setup.ts";
import { ran } from "../process/fake-worktree.ts";

// Podman and git are faked: git, the sandbox, the test runs and the land are the loop's only ways out. runOf is the
// real one.
vi.mock("../effects/git.ts", () => ({
  worktree: vi.fn(),
  commit: vi.fn(),
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
vi.mock("../effects/land.ts", () => ({ land: vi.fn() }));
vi.mock("../effects/setup.ts", () => ({
  needsSetup: vi.fn(),
  runSetup: vi.fn(),
  forgetSetup: vi.fn(),
  prepareFull: vi.fn(),
}));

const cl = "## Check\n\n- b1\n\n## Tests\n\nold\n\n## Code\n\nkeep\n";

let dir: string;
let ledger: Ledger;
let message: Message;
const step: Step<{ word: "done"; text: string }> = {
  from: "ready",
  agent: "fake",
  done: z.object({ word: z.literal("done"), text: z.string() }),
  about: ["tests", "code", "cl", "plan", "issue"],
  check: async () => message,
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
  message = { word: "pass", reason: "red at an assertion", findings: [] };
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

  it("moves a passed done result on, commits it as the agent's, writes no note, and records its usage", async () => {
    await once(make(gives(done("- b1: a.test.ts"))));
    expect(ledger.item("c").state).toBe("red");
    expect(commit).toHaveBeenCalledOnce();
    expect(vi.mocked(commit).mock.calls[0]?.[1]).toBe("fake(c)");
    expect(doc()).toBe(cl);
    expect(ledger.attempt("c", 1)).toMatchObject({
      word: "pass",
      tokens: 120,
      cost: 0.002,
    });
  });

  it("gives a bound step's run its cl's checkout, sets up the full worktree, not its own, and commits the run", async () => {
    ledger.keepSpec(
      "i",
      {
        cls: [
          {
            name: "c",
            intent: "c",
            shape: { change: "behavior", checked: "repo" },
            checkout: ["src/", "test/a.test.ts"],
            test: "t",
            check: ["b1"],
            seam: "s",
            checkoutNotes: "n",
          },
        ],
      },
      "matt",
    );
    // the cl named for its issue and its cut, as the spec names it
    ledger.addCl(
      {
        name: "i-c",
        issue: "i",
        seq: 2,
        path: join(dir, "cl.md"),
        repo: "/repo",
        image: "img",
        test: "t",
      },
      "ready",
    );
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner, { steps: [{ ...step, bound: true }] }));
    const ran = runner.mock.calls.map((c) => c[2].run);
    expect(ran.find((x) => x.name === "i-c")).toMatchObject({
      checkout: ["src/", "test/a.test.ts"],
    });
    expect(prepareFull).toHaveBeenCalledOnce();
    expect(runSetup).not.toHaveBeenCalled();
    expect(vi.mocked(commit).mock.calls[0]?.[0]).toMatchObject({
      name: "i-c",
      checkout: ["src/", "test/a.test.ts"],
    });
  });

  it("gives a step that is not bound the whole worktree: no checkout", async () => {
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner));
    expect(runner.mock.calls[0]?.[2].run).not.toHaveProperty("checkout");
  });

  it("retries a bound step whose cl is not in its issue's spec, before any worktree", async () => {
    await once(make(gives(done("x")), { steps: [{ ...step, bound: true }] }));
    expect(last()).toMatchObject({
      word: "retry",
      reason: expect.stringMatching(/its spec could not be read/),
    });
    expect(worktree).not.toHaveBeenCalled();
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
        return { word: "retry", reason: `exit ${t.code}`, findings: [] };
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
    message = { word: "retry", reason: "behavior 1 has no test", findings: [] };
    await once(make(gives(done("x"))));
    expect(ledger.item("c").state).toBe("ready");
    expect(last().reason).toBe("behavior 1 has no test");
    expect(doc()).toBe(cl);
    expect(commit).not.toHaveBeenCalled();
  });

  it("takes an agent's findings back as its message, to the owner of what they are about, and writes no note", async () => {
    const back = {
      word: "back",
      findings: [{ about: "cl", what: "the seam is not there", where: "Seam" }],
    };
    await once(make(gives({ result: back })));
    expect(ledger.item("c").state).toBe("raised");
    expect(last()).toMatchObject({
      word: "back",
      cause: null,
      findings: back.findings,
    });
    expect(doc()).toBe(cl);
    expect(commit).not.toHaveBeenCalled();
  });

  it("gives the next attempt the messages it answers: a retry's reason", async () => {
    message = { word: "retry", reason: "behavior 1 has no test", findings: [] };
    await once(make(gives(done("x"))));
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner));
    expect(runner.mock.calls[0]?.[1]).toBe(
      `${cl}\n# Messages\n- from fake, retry: behavior 1 has no test`,
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

  it("retries when its worktree is not made, without running the agent", async () => {
    vi.mocked(worktree).mockRejectedValue(new Error("no such branch"));
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner));
    expect(last()).toMatchObject({
      word: "retry",
      reason: expect.stringMatching(/worktree was not made: no such branch/),
    });
    expect(runner).not.toHaveBeenCalled();
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

describe("an attempt's setup", () => {
  it("runs once its worktree is made, before its sandbox opens", async () => {
    vi.mocked(needsSetup).mockReturnValue(true);
    await once(make(gives(done("x"))));
    expect(runSetup).toHaveBeenCalledOnce();
    expect(vi.mocked(worktree).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runSetup).mock.invocationCallOrder[0] as number,
    );
    expect(vi.mocked(runSetup).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(open).mock.invocationCallOrder[0] as number,
    );
    expect(ledger.item("c").state).toBe("red");
  });

  it("is forgotten when the worktree is made again, and kept when it is not", async () => {
    vi.mocked(worktree).mockResolvedValue(true);
    await once(make(gives(done("x"))));
    expect(forgetSetup).toHaveBeenCalledOnce();
    vi.mocked(worktree).mockResolvedValue(false);
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
    await once(make(gives(done("x"))));
    expect(forgetSetup).toHaveBeenCalledOnce();
  });

  it("does not hold up the tick: other attempts start while one sets up, and the loop waits for it", async () => {
    vi.mocked(needsSetup).mockImplementation((r) => r.name === "c");
    let finish: () => void = () => undefined;
    vi.mocked(runSetup).mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    ledger.addCl(
      {
        name: "d",
        issue: "j",
        seq: 1,
        path: join(dir, "cl.md"),
        repo: "/repo",
        image: "img",
        test: "t",
      },
      "ready",
    );
    const runner = vi.fn<Run1>(gives(done("x")));
    const l = await make(runner);
    await l.tick();
    expect(l.running()).toBe(2);
    const settled = l.settled();
    await vi.waitFor(() => expect(ledger.item("d").state).toBe("red"));
    expect(ledger.item("c").state).toBe("ready");
    finish();
    await settled;
    expect(ledger.item("c").state).toBe("red");
  });

  it("does not run when the worktree needs none, as one set up before a restart", async () => {
    vi.mocked(needsSetup).mockReturnValue(false);
    await once(make(gives(done("x"))));
    expect(runSetup).not.toHaveBeenCalled();
    expect(ledger.item("c").state).toBe("red");
  });

  it("ends the attempt as a retry when it fails, and never starts the agent", async () => {
    vi.mocked(needsSetup).mockReturnValue(true);
    vi.mocked(runSetup).mockRejectedValue(
      new Error("img's cache lacks a package of this lockfile"),
    );
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner));
    expect(last()).toMatchObject({
      word: "retry",
      cause: "missing_dependency",
      reason: expect.stringMatching(/^the setup failed: img's cache lacks/),
    });
    expect(runner).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("a retry", () => {
  it("tells the runner a state's first attempt from its retries, so a retry runs on the bin's fallback", async () => {
    message = { word: "retry", reason: "behavior 1 has no test", findings: [] };
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
        return new Promise<Message>(() => undefined);
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
        return message;
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

describe("a message with no move", () => {
  it("escalates the item, with why, and leaves no attempt open to run again", async () => {
    ledger.addIssue({
      name: "j",
      path: join(dir, "cl.md"),
      repo: "/repo",
      image: "img",
      test: "suite",
    });
    message = {
      word: "back",
      reason: "r",
      findings: [{ about: "code", what: "w", where: "x" }],
    };
    await once(make(gives(done("x")), { steps: [{ ...step, from: "open" }] }));
    expect(ledger.item("j").state).toBe("escalated");
    expect(ledger.open()).toEqual([]);
    expect(ledger.events("j").at(-1)).toMatchObject({
      reason: expect.stringMatching(/no owner of code for issue/),
    });
  });
});

describe("a review's send-back", () => {
  it("moves the cl back to its code, commits nothing, and gives da-hammer's next attempt the findings", async () => {
    const review: Step<{ word: "done"; text: string }> = {
      ...step,
      from: "green",
      worktree: "ro",
    };
    const coder: Step<{ word: "done"; text: string }> = {
      ...step,
      from: "red",
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
    const back = {
      word: "back",
      findings: [
        { about: "code", what: "b1 fails at its edge", where: "a.ts:3" },
      ],
    };
    await once(make(gives({ result: back }), { steps: [review] }));
    expect(ledger.item("g").state).toBe("red");
    expect(ledger.rounds("g")).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    expect(doc()).toBe(cl);
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner, { steps: [coder, review] }));
    expect(runner.mock.calls[0]?.[1]).toContain(
      "- from fake, back: back, about the code\n\t- about the code: b1 fails at its edge (a.ts:3)",
    );
  });
});

describe("a land", () => {
  /** An approved cl of the issue, in `repo`, with a note of its own. */
  const approved = (name: string, repo = "/repo") => {
    const path = join(dir, `${name}.md`);
    writeFileSync(path, "---\ntype: cl\nstatus: in-progress\n---\nIt.\n");
    ledger.addCl(
      { name, issue: "i", seq: 2, path, repo, image: "img", test: "t" },
      "approved",
    );
    return path;
  };
  const landed = (files: string[] = []) =>
    vi.mocked(land).mockResolvedValue({
      message: { word: "pass", reason: "landed on local/main", findings: [] },
      files,
    });

  it("lands an approved cl with no agent: it is landed, its note as it was, and the files it changed kept", async () => {
    const path = approved("e");
    landed(["src/e.ts"]);
    const run = vi.fn<Run1>(gives(done("x")));
    await once(make(run));
    expect(land).toHaveBeenCalledWith(
      expect.objectContaining({ name: "e", n: 1 }),
      expect.anything(),
    );
    expect(run).not.toHaveBeenCalledWith(
      "fake",
      expect.anything(),
      expect.objectContaining({ run: expect.objectContaining({ name: "e" }) }),
    );
    expect(ledger.item("e").state).toBe("landed");
    expect(ledger.attempt("e", 1)).toMatchObject({
      step: "approved",
      word: "pass",
    });
    expect(readFileSync(path, "utf8")).toBe(
      "---\ntype: cl\nstatus: in-progress\n---\nIt.\n",
    );
    const db = new DatabaseSync(join(dir, "ledger.db"));
    expect(db.prepare("SELECT path FROM paths WHERE name = 'e'").all()).toEqual(
      [{ path: "src/e.ts" }],
    );
    db.close();
  });

  it("sends a red on main back to the code, and leaves the note as it is", async () => {
    const path = approved("e");
    vi.mocked(land).mockResolvedValue({
      message: {
        word: "back",
        cause: "check_failed",
        reason: "red on main",
        findings: [{ about: "code", what: "red", where: "t" }],
      },
      files: [],
    });
    await once(make(gives(done("x"))));
    expect(ledger.item("e").state).toBe("red");
    expect(readFileSync(path, "utf8")).toMatch(/^status: in-progress$/m);
  });

  it("retries a land that throws, with why", async () => {
    approved("e");
    vi.mocked(land).mockRejectedValue(new Error("fetch failed"));
    await once(make(gives(done("x"))));
    expect(ledger.item("e").state).toBe("approved");
    expect(ledger.events("e").at(-1)).toMatchObject({
      word: "retry",
      reason: "the land failed: fetch failed",
    });
  });

  it("lands one cl of a repo at a time, and another repo's beside it", async () => {
    approved("e");
    approved("f");
    approved("g", "/other");
    const order: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(land).mockImplementation(async (r) => {
      order.push(`start ${r.name}`);
      if (r.name === "e") await gate;
      order.push(`end ${r.name}`);
      return {
        message: { word: "pass", reason: "landed", findings: [] },
        files: [],
      };
    });
    const l = await make(gives(done("x")), { steps: [] });
    await l.tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["start e", "start g", "end g"]);
    release();
    await l.settled();
    expect(order).toEqual([
      "start e",
      "start g",
      "end g",
      "end e",
      "start f",
      "end f",
    ]);
  });

  it("takes up a land a stopped orchestrator left open, and lands it", async () => {
    approved("e");
    const n = ledger.begin("e");
    landed();
    await once(make(gives(done("x")), { steps: [] }));
    expect(land).toHaveBeenCalledOnce();
    expect(ledger.attempt("e", n)).toMatchObject({ resumed: 1, word: "pass" });
    expect(ledger.item("e").state).toBe("landed");
  });
});
