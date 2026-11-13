import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Message, Step } from "../process/step.ts";
import { open as openLedger, type Ledger } from "./ledger.ts";
import type { World } from "./advance.ts";
import { loop, RunFailed, type Runner } from "./loop.ts";
import { execFileSync } from "node:child_process";
import { commit, fresh, onMain, sweep, worktree } from "../effects/git.ts";
import { land } from "../effects/land.ts";
import { close, open } from "../effects/sandbox.ts";
import { runTests } from "../effects/tests.ts";
import { forgetSetup, needsSetup, runSetup } from "../effects/setup.ts";
import { ran } from "../process/fake-worktree.ts";
import { move } from "../effects/move.ts";
import { CrateError, NotOnCrate, settingsAt } from "../effects/repo.ts";
import { notesRepo } from "../effects/notes.fixture.ts";
import { keep } from "../effects/runs.ts";
import { npmRegistryUrl } from "../effects/registry.ts";

// Podman and git are faked: git, the sandbox, the test runs and the land are the loop's only ways out. runOf is the
// real one.
vi.mock("../effects/git.ts", async (original) => ({
  branchOf: (await original<typeof import("../effects/git.ts")>()).branchOf,
  // the notes repo's main is its own: it has no remote to fetch
  mainOf: vi.fn(async () => "main"),
  onMain: vi.fn(),
  worktree: vi.fn(),
  fresh: vi.fn(),
  commit: vi.fn(),
  sweep: vi.fn(),
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
}));
vi.mock("../effects/move.ts", () => ({ move: vi.fn() }));
vi.mock("../effects/repo.ts", async (original) => ({
  ...(await original<typeof import("../effects/repo.ts")>()),
  settingsAt: vi.fn(),
}));

/** The cl note every cl of these tests reads: its test command is `t`. */
const cl = `---
type: cl
belongsTo: "[[i]]"
status: new
shape: { change: behavior, checked: repo }
checkout: [src/a.ts]
test: t
---
It works.

---
## Promises

- b1

## Seam

s

## Checkout

- src/a.ts: the code
`;
const issueNote = "---\ntype: issue\n---\nIt.\n\n---\n## Done\n\n- it works\n";

let dir: string;
let ledger: Ledger;
let message: Message;
let notes: ReturnType<typeof notesRepo>;
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

/** A run that keeps its attempt for its conversation first, as the real runner does (effects/runner.ts). */
const kept =
  (run: Run1): Run1 =>
  async (agent, input, o) => {
    keep(
      {
        item: o.run.name,
        agent,
        folder: dirname(o.run.dir),
        readOnly: o.readOnly,
      },
      o.run,
    );
    return run(agent, input, o);
  };

/** The runner a loop opens: `run`, and a close that keeps its runs. */
const runnerOf = (run: Run1) => async (): Promise<Runner> => ({
  run,
  close: async () => undefined,
});

/** A world with nothing to wait for: no repo has a file, no landed cl has a tag. */
const idle: Omit<World, "runs" | "notes"> = {
  registry: { url: npmRegistryUrl, published: async () => true },
  reader: { file: () => undefined, onCrate: () => false },
  tags: async () => [],
};

const make = (
  run: Run1,
  o: {
    steps?: Step<{ word: "done"; text: string }>[];
    concurrent?: number;
    timeoutMs?: number;
    world?: Omit<World, "runs" | "notes">;
  } = {},
) =>
  loop({
    ledger,
    steps: o.steps ?? [step],
    runner: runnerOf(run),
    ...o,
    world: { ...(o.world ?? idle), runs: join(dir, "runs"), notes: notes.repo },
  });
type L = Awaited<ReturnType<typeof make>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(move).mockResolvedValue("c0ffee");
  vi.mocked(settingsAt).mockResolvedValue({
    image: "img",
    test: "suite",
    setup: "",
  });
  dir = mkdtempSync(join(tmpdir(), "loop-"));
  notes = notesRepo(
    { "_well/c.md": cl, "_well/i.md": issueNote },
    join(dir, "notes"),
  );
  ledger = openLedger(join(dir, "ledger.db"));
  ledger.addIssue({ name: "i", note: "_well/i.md", repos: ["/repo"] });
  ledger.addCl(
    { name: "c", issue: "i", seq: 1, note: "_well/c.md", repo: "/repo" },
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
/** The cl note on disk in the notes repo: an attempt never writes it. */
const doc = () => readFileSync(join(notes.repo, "_well", "c.md"), "utf8");

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
    // titled as crate reads a release: a code commit of an issue with no kind is new work, with no description the cl's name
    expect(vi.mocked(commit).mock.calls[0]?.[1]).toBe("feat(c): c");
    expect(doc()).toBe(cl);
    expect(ledger.attempt("c", 1)).toMatchObject({
      word: "pass",
      tokens: 120,
      cost: 0.002,
    });
  });

  it("works every attempt of an item in its one worktree, each with its own folder", async () => {
    message = { word: "retry", reason: "promise 1 has no test", findings: [] };
    const runner = vi.fn<Run1>(gives(done("x")));
    const l = await make(runner);
    await once(l);
    await once(l);
    const [one, two] = runner.mock.calls.map((c) => c[2].run);
    expect(one?.work).toBe(join(dir, "runs", "i", "cl", "c", "work"));
    expect(two?.work).toBe(one?.work);
    expect([one?.dir, two?.dir]).toEqual([
      join(dir, "runs", "i", "cl", "c", "1"),
      join(dir, "runs", "i", "cl", "c", "2"),
    ]);
  });

  it("commits nothing for a step that edits and did not pass: its change stays for the next attempt", async () => {
    message = { word: "retry", reason: "red", findings: [] };
    await once(make(gives(done("x"))));
    expect(commit).not.toHaveBeenCalled();
  });

  it("moves an issue's worktree to main for a new attempt, and sets it up again when main moved", async () => {
    const db = new DatabaseSync(join(dir, "ledger.db"));
    db.prepare("UPDATE items SET state = 'dropped' WHERE name = 'c'").run();
    db.close();
    vi.mocked(worktree).mockResolvedValue(false);
    vi.mocked(fresh).mockResolvedValue(true);
    await once(
      make(gives(done("x")), {
        steps: [{ ...step, from: "open", worktree: "ro" }],
      }),
    );
    expect(fresh).toHaveBeenCalledWith(expect.objectContaining({ name: "i" }));
    expect(forgetSetup).toHaveBeenCalledOnce();
  });

  it("keeps a taken-up issue's worktree where its run left it", async () => {
    const db = new DatabaseSync(join(dir, "ledger.db"));
    db.prepare("UPDATE items SET state = 'dropped' WHERE name = 'c'").run();
    db.close();
    ledger.begin("i");
    vi.mocked(worktree).mockResolvedValue(false);
    await once(
      make(gives(done("x")), {
        steps: [{ ...step, from: "open", worktree: "ro" }],
      }),
    );
    expect(fresh).not.toHaveBeenCalled();
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
    message = { word: "retry", reason: "promise 1 has no test", findings: [] };
    await once(make(gives(done("x"))));
    expect(ledger.item("c").state).toBe("ready");
    expect(last().reason).toBe("promise 1 has no test");
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
    message = { word: "retry", reason: "promise 1 has no test", findings: [] };
    await once(make(gives(done("x"))));
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner));
    expect(runner.mock.calls[0]?.[1]).toBe(
      `${cl}\n# Messages\n- from fake, retry: promise 1 has no test`,
    );
  });

  it("goes on in the agent's conversation: a later attempt reads only its messages since its last run", async () => {
    message = { word: "retry", reason: "promise 1 has no test", findings: [] };
    await once(make(kept(gives(done("x")))));
    message = { word: "retry", reason: "still no test", findings: [] };
    const runner = vi.fn<Run1>(kept(gives(done("x"))));
    await once(make(runner));
    expect(runner.mock.calls[0]?.[1]).toBe(
      "# Attempt 2: your work goes on\n# Messages\n- from fake, retry: promise 1 has no test",
    );
  });

  it("gives a later attempt its note again when the note changed since the agent's last run", async () => {
    message = { word: "retry", reason: "promise 1 has no test", findings: [] };
    await once(make(kept(gives(done("x")))));
    const changed = cl.replace("It works.", "It works, and says so.");
    notes.commit({ "_well/c.md": changed });
    const runner = vi.fn<Run1>(kept(gives(done("x"))));
    await once(make(runner));
    expect(runner.mock.calls[0]?.[1]).toBe(
      `# Attempt 2: your work goes on\n\n# Your note, changed since your last run\n\n${changed}\n# Messages\n- from fake, retry: promise 1 has no test`,
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
        note: "_well/c.md",
        repo: "/repo",
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
    ledger.addIssue({ name: "j", note: "_well/i.md", repos: ["/repo"] });
    ledger.addCl(
      {
        name: "d",
        issue: "j",
        seq: 1,
        note: "_well/c.md",
        repo: "/repo",
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

describe("the notes", () => {
  /** The cl's note, changed so its test command is `command`, committed on the notes' main. */
  const edit = (command: string) =>
    notes.commit({ "_well/c.md": cl.replace("test: t", `test: ${command}`) });

  it("are read at the notes' main as an attempt starts, the commit pinned on it, and an edit is read by the next attempt", async () => {
    message = { word: "retry", reason: "red", findings: [] };
    const runner = vi.fn<Run1>(gives(done("x")));
    const l = await make(runner);
    await once(l);
    const later = edit("node --test b.test.mjs");
    await once(l);
    const [one, two] = runner.mock.calls.map((c) => c[2].run);
    expect(one?.notes).toEqual(notes.first);
    expect(one?.test).toBe("t");
    expect(two?.notes).toEqual(later);
    expect(two?.test).toBe("node --test b.test.mjs");
    expect(runner.mock.calls[1]?.[1]).toContain("It works.");
    expect(ledger.pinned("c", 1)).toBe(notes.first.commit);
    expect(ledger.pinned("c", 2)).toBe(later.commit);
  });

  it("are read by a taken-up attempt at the commit it pinned, not at main", async () => {
    ledger.begin("c");
    ledger.pin("c", 1, notes.first.commit);
    edit("node --test b.test.mjs");
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner));
    expect(runner.mock.calls[0]?.[2].run).toMatchObject({
      notes: notes.first,
      test: "t",
    });
  });

  it("end an attempt whose cl note is not a cl as a retry, contract_invalid, before its sandbox", async () => {
    notes.commit({ "_well/c.md": "---\ntype: cl\n---\nno fields\n" });
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner));
    expect(last()).toMatchObject({
      word: "retry",
      cause: "contract_invalid",
      reason: expect.stringMatching(/its note is not a cl/),
    });
    expect(open).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it("give way to settings read from the item's worktree: a repo not on crate breaks its contract, crate's failure is a dependency", async () => {
    vi.mocked(settingsAt).mockRejectedValueOnce(
      new NotOnCrate("repo is not on crate: it has no crate.toml"),
    );
    await once(make(gives(done("x"))));
    expect(last()).toMatchObject({
      word: "retry",
      cause: "contract_invalid",
      reason: expect.stringMatching(/no crate\.toml/),
    });
    vi.mocked(settingsAt).mockRejectedValueOnce(
      new CrateError(1, "its Containerfile has no bake"),
    );
    await once(make(gives(done("x"))));
    expect(last()).toMatchObject({
      word: "retry",
      cause: "missing_dependency",
      reason: expect.stringMatching(/no bake/),
    });
    expect(vi.mocked(settingsAt)).toHaveBeenCalledWith(
      join(dir, "runs", "i", "cl", "c", "work"),
      "repo",
    );
  });

  it("land an issue's plan: its planner's spec written as notes in the issue's notes' worktree, committed, and landed", async () => {
    const db = new DatabaseSync(join(dir, "ledger.db"));
    db.prepare("UPDATE items SET state = 'dropped' WHERE name = 'c'").run();
    db.close();
    ledger.apply(
      "i",
      { word: "pass", reason: "lints", findings: [] },
      {
        attempt: ledger.begin("i"),
        result: {
          word: "done",
          cls: [
            {
              name: "seam",
              intent: "the seam holds",
              shape: { change: "behavior", checked: "repo" },
              checkout: ["src/a.ts"],
              test: "t",
              promises: ["given a, then b"],
              seam: "s",
              checkoutNotes: "- src/a.ts: it",
            },
          ],
        },
      },
    );
    ledger.apply(
      "i",
      { word: "pass", reason: "approved", findings: [] },
      { attempt: ledger.begin("i") },
    );
    const work = join(dir, "runs", "i", "issue", "notes");
    vi.mocked(onMain).mockImplementation(async (t) => {
      execFileSync("git", ["clone", "-q", notes.repo, t.work]);
    });
    vi.mocked(land).mockResolvedValue({
      message: { word: "pass", reason: "landed on main", findings: [] },
      files: ["_well/i-seam.md"],
      commit: "d".repeat(40),
    });
    await once(make(gives(done("x")), { steps: [] }));
    expect(onMain).toHaveBeenCalledWith(
      expect.objectContaining({ name: "i", repo: notes.repo, work }),
    );
    expect(readFileSync(join(work, "_well", "i-seam.md"), "utf8")).toContain(
      "the seam holds",
    );
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ work }),
      "docs(i): its plan",
    );
    expect(land).toHaveBeenCalledWith(
      expect.objectContaining({ name: "i", repo: notes.repo, work }),
      expect.anything(),
    );
    expect(ledger.item("i")).toMatchObject({
      state: "building",
      landed: "d".repeat(40),
    });
  });
});

describe("a retry", () => {
  it("tells the runner a state's first attempt from its retries, so a retry runs on the bin's fallback", async () => {
    message = { word: "retry", reason: "promise 1 has no test", findings: [] };
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
        note: "_well/c.md",
        repo: "/repo",
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
    // the next process takes it up
    const next = await make(gives(done("x")));
    expect(await next.tick()).toBeUndefined();
    await next.settled();
    expect(ledger.attempt("c", 1)).toMatchObject({ resumed: 1, word: "pass" });
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
          note: "_well/c.md",
          repo: "/repo",
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

describe("the sweep", () => {
  it("runs at open and on each tick, in each repo the ledger names, keeping each live item's worktree and branch", async () => {
    ledger.addCl(
      {
        name: "i-gone",
        issue: "i",
        seq: 2,
        note: "_well/c.md",
        repo: "/other",
      },
      "ready",
    );
    const db = new DatabaseSync(join(dir, "ledger.db"));
    db.prepare("UPDATE items SET state = 'landed' WHERE name = 'i-gone'").run();
    db.close();
    const l = await make(gives(done("x")), { steps: [] });
    expect(sweep).toHaveBeenCalledTimes(3);
    await l.tick();
    expect(sweep).toHaveBeenCalledTimes(6);
    const runs = join(dir, "runs");
    // the notes repo first, then each repo the ledger names
    expect(
      vi
        .mocked(sweep)
        .mock.calls.map((c) => c[0])
        .slice(0, 3),
    ).toEqual([notes.repo, "/repo", "/other"]);
    const [, at, keep, branches] = vi.mocked(sweep).mock.calls[0] ?? [];
    expect(at).toBe(runs);
    // a live issue keeps its notes' worktree too, where its plan's land writes
    expect([...(keep ?? [])].sort()).toEqual([
      join(runs, "i", "cl", "c", "work"),
      join(runs, "i", "issue", "notes"),
      join(runs, "i", "issue", "work"),
    ]);
    expect([...(branches ?? [])].sort()).toEqual([
      "assembly/c/head",
      "assembly/i/head",
    ]);
  });

  it("keeps the worktree of an ended item whose attempt is still open", async () => {
    ledger.begin("c");
    const db = new DatabaseSync(join(dir, "ledger.db"));
    db.prepare("UPDATE items SET state = 'dropped' WHERE name = 'c'").run();
    db.close();
    await make(gives(done("x")), { steps: [] });
    expect([...(vi.mocked(sweep).mock.calls[0]?.[3] ?? [])]).toContain(
      "assembly/c/head",
    );
  });

  it("goes on when a repo's sweep fails", async () => {
    vi.mocked(sweep).mockRejectedValue(new Error("no such repo"));
    const l = await make(gives(done("x")));
    await expect(once(l)).resolves.toBeUndefined();
    expect(ledger.item("c").state).toBe("red");
  });
});

describe("the world", () => {
  /**
   * Issue j across two repos: a, phase 1, landed with the tag v1.2.0, and b, phase 2, waiting. b's repo depends on the
   * package a's repo ships, `@x/a`.
   */
  const across = (published: () => Promise<boolean>) => {
    ledger.addIssue({ name: "j", note: "_well/i.md", repos: ["/a", "/b"] });
    for (const [name, seq, phase, repo, state] of [
      ["j-a", 1, 1, "/a", "landed"],
      ["j-b", 2, 2, "/b", "waiting"],
    ] as const)
      ledger.addCl(
        {
          name,
          issue: "j",
          seq,
          phase,
          note: "_well/c.md",
          repo,
        },
        state,
      );
    // a's land took a commit: its name stands in for it
    ledger.landed("j-a", "j-a", []);
    const files: Record<string, string> = {
      "/a:package.json": JSON.stringify({ name: "@x/a", version: "1.2.0" }),
      "/b:package.json": JSON.stringify({
        name: "b",
        dependencies: { "@x/a": "^1.0.0" },
      }),
    };
    const registry = { url: npmRegistryUrl, published: vi.fn(published) };
    const world: Omit<World, "runs" | "notes"> = {
      registry,
      reader: { file: (r, f) => files[`${r}:${f}`], onCrate: () => true },
      tags: async (repo, cl) =>
        repo === "/a" && cl === "j-a" ? ["v1.2.0"] : [],
    };
    return { registry, world };
  };
  const ranFor = (runner: ReturnType<typeof vi.fn<Run1>>, name: string) =>
    runner.mock.calls.some((c) => c[2].run.name === name);

  it("holds a cl whose dependency's version is not on npm, and starts it on the tick after it is", async () => {
    let on = false;
    const { registry, world } = across(async () => on);
    const runner = vi.fn<Run1>(gives(done("x")));
    const l = await make(runner, { world });
    await once(l);
    expect(registry.published).toHaveBeenCalledWith("@x/a", "1.2.0");
    expect(ledger.item("j-b").state).toBe("waiting");
    expect(ranFor(runner, "j-b")).toBe(false);
    on = true;
    await once(l);
    expect(ranFor(runner, "j-b")).toBe(true);
    expect(ledger.item("j-b").state).toBe("red");
  });

  const saidOf = (name: string) =>
    ledger
      .events(name)
      .filter((e) => e.word === "retry")
      .map((e) => e.reason);

  it("records why a cl waits where the ledger shows it: the package and version, once over many ticks", async () => {
    const { world } = across(async () => false);
    const l = await make(vi.fn<Run1>(gives(done("x"))), { world });
    await once(l);
    await once(l);
    await once(l);
    expect(saidOf("j-b")).toHaveLength(1);
    expect(saidOf("j-b")[0]).toMatch(/@x\/a/);
    expect(saidOf("j-b")[0]).toMatch(/1\.2\.0/);
    expect(ledger.item("j-b").state).toBe("waiting");
  });

  it("survives a registry that fails: the cl waits with the failure as its reason, and other cls go on", async () => {
    const { world } = across(async () => {
      throw new Error("npm answered 503 for @x/a@1.2.0");
    });
    const runner = vi.fn<Run1>(gives(done("x")));
    const l = await make(runner, { world });
    await expect(once(l)).resolves.toBeUndefined();
    expect(ledger.item("j-b").state).toBe("waiting");
    expect(saidOf("j-b")).toHaveLength(1);
    expect(saidOf("j-b")[0]).toMatch(/npm answered 503/);
    expect(ranFor(runner, "c")).toBe(true);
    // the next tick still runs
    await expect(once(l)).resolves.toBeUndefined();
  });

  it("survives a land target that fails to answer: the cl waits, and the tick does not throw", async () => {
    const { world } = across(async () => true);
    const failing: Omit<World, "runs" | "notes"> = {
      ...world,
      tags: async () => {
        throw new Error("git ls-remote failed");
      },
    };
    const runner = vi.fn<Run1>(gives(done("x")));
    await expect(
      once(make(runner, { world: failing })),
    ).resolves.toBeUndefined();
    expect(ledger.item("j-b").state).toBe("waiting");
    expect(saidOf("j-b")[0]).toMatch(/git ls-remote failed/);
    expect(ranFor(runner, "c")).toBe(true);
  });

  it("starts at once a cl that waits for nothing: its dependency's version is on npm already", async () => {
    const { world } = across(async () => true);
    const runner = vi.fn<Run1>(gives(done("x")));
    await once(make(runner, { world }));
    expect(ranFor(runner, "j-b")).toBe(true);
  });

  it("moves a cl's package before its attempt, and reads the attempt's settings from the moved worktree", async () => {
    let on = false;
    const { world } = across(async () => on);
    const runner = vi.fn<Run1>(gives(done("x")));
    const l = await make(runner, { world });
    await once(l);
    // it waited: nothing moved
    expect(move).not.toHaveBeenCalled();
    on = true;
    await once(l);
    const work = join(dir, "runs", "j", "cl", "b", "work");
    expect(vi.mocked(move)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "j-b", repo: "/b", work }),
      "@x/a",
      "1.2.0",
      npmRegistryUrl,
    );
    // the move is the orchestrator's, and it comes before the settings of the attempt it precedes, read from it
    const at = vi.mocked(settingsAt).mock.calls.findIndex((c) => c[0] === work);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(settingsAt).mock.calls[at]).toEqual([work, "b"]);
    expect(vi.mocked(move).mock.invocationCallOrder[0] as number).toBeLessThan(
      vi.mocked(settingsAt).mock.invocationCallOrder[at] as number,
    );
  });

  it("is a world a loop cannot be built without", () => {
    const withoutWorld = () =>
      // @ts-expect-error a loop is built with a world
      loop({
        ledger,
        steps: [step],
        runner: runnerOf(gives(done("x"))),
      });
    expect(withoutWorld).toBeTypeOf("function");
  });
});

describe("a message with no move", () => {
  it("escalates the item, with why, and leaves no attempt open to run again", async () => {
    ledger.addIssue({ name: "j", note: "_well/i.md", repos: ["/repo"] });
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

describe("an issue escalated to Matt", () => {
  /** The issue "i" escalated; its cls: e ready (the raised cl's phase), l landed, w waiting for l's phase. */
  function escalated() {
    const add = (name: string, seq: number, phase: number, to: string) => {
      ledger.addCl(
        {
          name,
          issue: "i",
          seq,
          phase,
          note: "_well/c.md",
          repo: "/repo",
        },
        "waiting",
      );
      const db = new DatabaseSync(join(dir, "ledger.db"));
      db.prepare("UPDATE items SET state = ? WHERE name = ?").run(to, name);
      db.close();
    };
    add("l", 2, 1, "landed");
    add("e", 3, 1, "ready");
    add("w", 4, 2, "waiting");
    // "c", the setup's cl, is out of the way: dropped.
    const db = new DatabaseSync(join(dir, "ledger.db"));
    db.prepare("UPDATE items SET state = 'dropped' WHERE name = 'c'").run();
    db.close();
    ledger.apply(
      "i",
      { word: "escalate", reason: "a cl raised", findings: [] },
      "orchestrator",
    );
  }

  it("starts no attempt on any of its cls, one of the raised cl's own phase too, and each stays in its state", async () => {
    escalated();
    const run = vi.fn(gives(done("x")));
    const l = await make(run);
    await l.tick();
    await l.tick();
    await l.settled();
    expect(run).not.toHaveBeenCalled();
    expect(ledger.open()).toEqual([]);
    expect(ledger.attemptsOf("e")).toEqual([]);
    expect(["l", "e", "w"].map((n) => [n, ledger.item(n).state])).toEqual([
      ["l", "landed"],
      ["e", "ready"],
      ["w", "waiting"],
    ]);
  });

  it("lets an attempt already open run to its end, and starts no other", async () => {
    escalated();
    ledger.begin("e");
    const run = vi.fn(gives(done("x")));
    await once(make(run));
    expect(run).toHaveBeenCalledTimes(1);
    expect(ledger.open()).toEqual([]);
    expect(ledger.attemptsOf("e")).toHaveLength(1);
    expect(ledger.item("w").state).toBe("waiting");
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
        note: "_well/c.md",
        repo: "/repo",
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
  /** An approved cl of the issue, in `repo`. */
  const approved = (name: string, repo = "/repo") =>
    ledger.addCl(
      { name, issue: "i", seq: 2, note: "_well/c.md", repo },
      "approved",
    );
  const landed = (files: string[] = []) =>
    vi.mocked(land).mockResolvedValue({
      message: { word: "pass", reason: "landed on local/main", findings: [] },
      files,
    });

  it("lands an approved cl with no agent: it is landed, its note as it was, and the commit and files it changed kept", async () => {
    approved("e");
    vi.mocked(land).mockResolvedValue({
      message: { word: "pass", reason: "landed on local/main", findings: [] },
      files: ["src/e.ts"],
      commit: "c".repeat(40),
    });
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
    expect(doc()).toBe(cl);
    expect(ledger.item("e").landed).toBe("c".repeat(40));
    const db = new DatabaseSync(join(dir, "ledger.db"));
    expect(db.prepare("SELECT path FROM paths WHERE name = 'e'").all()).toEqual(
      [{ path: "src/e.ts" }],
    );
    db.close();
  });

  it("sends a red on main back to the code, and leaves the note as it is", async () => {
    approved("e");
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
    expect(doc()).toBe(cl);
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
