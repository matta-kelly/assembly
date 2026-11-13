/**
 * The loop: it moves issues and their cls through their steps. The agents' loops run here, in the orchestrator, and
 * hold the key; each attempt's sandbox is a container its tools work in (effects/sandbox.ts).
 *
 * An attempt lives until it ends, whatever happens to the process that runs it. Its run is que-pasa's, durable, with
 * the attempt's id; its sandbox and worktree are its own, and a container outlives the orchestrator. So a stopped
 * orchestrator leaves its attempts open in the ledger, and the next one takes each one up: its sandbox again, and its
 * run goes on from where it stopped. A taken-up attempt goes the same way as a new one.
 *
 * Each item has one worktree, which every attempt of it works in (effects/git.ts): a pass commits there, and any other
 * end of a step that writes keeps its change as the attempt's record and resets it. Opening the loop sweeps away every
 * worktree and branch no live item holds, makes the worktrees of the open attempts, then opens the runner: que-pasa's
 * runtime goes on with their runs at once, and their sandboxes, which come up on a tool's first call, mount those
 * worktrees. Each tick then sweeps again, and does two things:
 * - it makes the orchestrator's own moves (advance.ts): a building issue's cls, phase by phase, and their issue built.
 * - it starts attempts, up to `concurrent` at once: first the open attempts this process is not running, taken up,
 *   then a new one for each item waiting in a state that has a step, except the cls of an issue escalated to Matt: they
 *   stay in their state until he answers. It does not wait for one: the run goes on as a
 *   task, under a time limit, and settles the attempt when it ends. Its result is checked against the step's shape,
 *   the step's check picks the word from the result and the attempt's worktree, which the loop answers for it
 *   (a test run, the changed files), the note is written, and the ledger moves the item.
 * An approved cl's attempt is its land (effects/land.ts): code, with no agent, that takes it to main. Lands of one
 * repo run one at a time, each after the one before it.
 * Closing the loop closes the runner and ends nothing: its attempts stay open for the next process.
 *
 * Each attempt is one trace (effects/trace.ts): its span's ids are made when it begins, its run starts under that span, and
 * the span is written when the attempt ends.
 */

import { z } from "zod";
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import {
  branchOf,
  changed,
  commit,
  discard,
  fresh,
  head,
  sweep,
  touched,
  worktree,
} from "../effects/git.ts";
import { land } from "../effects/land.ts";
import { read } from "../effects/notes.ts";
import { log, partsOf, runOf } from "../effects/runs.ts";
import { close, imageOf, open } from "../effects/sandbox.ts";
import { forgetSetup, needsSetup, runSetup } from "../effects/setup.ts";
import { runTests } from "../effects/tests.ts";
import {
  checkSpan,
  endAttempt,
  openTracing,
  within,
} from "../effects/trace.ts";
import {
  type CheckRun,
  type Message,
  resultOf,
  type Run,
  type Step,
  type TestRun,
  type Worktree,
} from "../process/step.ts";
import { ends, type State, top } from "../process/table.ts";
import { advance, type World } from "./advance.ts";
import { titleOf } from "./title.ts";
import type { Event, Ledger, Usage } from "./ledger.ts";

// A step's done shape is its own. The loop needs only its word, so it holds every step by that
type AnyStep = Step<{ word: "done" }>;

/** The land's state, and its name in a trace: an approved cl's attempt is code, with no agent (effects/land.ts). */
const landing: State = "approved";
const lander = { agent: "git-land" };

/**
 * Runs the agents. effects/runner.ts is the real one: que-pasa's durable runtime, with the agents and models set.
 * - run: one step's agent, by its name, on its input, for one attempt, gives back its output and what its model calls
 *   used. The attempt is the run: run again for an attempt it has, it goes on with that run. `retry` says the attempt
 *   is not the state's first, so a bin's fallback model takes it. It stops when `signal` aborts. A run that failed on
 *   its own throws a RunFailed, with what it used. It traces itself, under the span active when it is called.
 *   `readOnly`: its worktree is mounted read-only.
 * - close: stops it, and keeps the runs still going, for the next runner on the same storage.
 */
export interface Runner {
  run(
    agent: string,
    input: string,
    o: {
      run: Run;
      retry: boolean;
      signal: AbortSignal;
      readOnly: boolean;
    },
  ): Promise<{ value: unknown; usage?: Usage }>;
  close(): Promise<void>;
}

/** A run that ended without a result of its own doing: no submit, or the model's failure. Its usage is what it spent. */
export class RunFailed extends Error {
  readonly usage: Usage | undefined;

  constructor(message: string, usage?: Usage) {
    super(message);
    this.usage = usage;
  }
}

/** A setup that failed: its attempt ends with missing_dependency. */
class Setup extends Error {}

export interface Loop {
  ledger: Ledger;
  steps: AnyStep[];
  runner: () => Promise<Runner>; // opened once the open attempts' worktrees are there
  world: World; // where run folders go, and what a waiting cl needs of the world: registry, repos' files, landed tags
  concurrent?: number; // attempts at once, at most
  timeoutMs?: number; // the most one attempt may take
}

/** An attempt's messages, as its agent reads them after its spec: who each is from, its word, why, and its findings. */
function messagesText(events: Event[], from: (e: Event) => string): string {
  if (!events.length) return "";
  return [
    "",
    "# Messages",
    ...events.flatMap((e) => [
      `- from ${from(e)}, ${e.word ?? "moved"}: ${e.reason ?? ""}`,
      ...e.findings.map(
        (f) => `\t- about the ${f.about}: ${f.what} (${f.where})`,
      ),
      ...(e.notes ? [`\t- notes: ${e.notes}`] : []),
    ]),
  ].join("\n");
}

/**
 * The attempt's worktree, as its step's check asks it: the test run is made once, and kept for the ledger and the
 * trace.
 */
function worktreeOf(
  r: Run,
  signal: AbortSignal,
): Worktree & { ran(): CheckRun | undefined } {
  let tests: Promise<TestRun> | undefined;
  let ran: CheckRun | undefined;
  return {
    test: () =>
      (tests ??= runTests(r, signal).then((t) => {
        ran = t.check;
        return t;
      })),
    changed: (files) => changed(r, files),
    touched: () => touched(r),
    // A path that leaves the worktree is never in it.
    exists: (files) =>
      files.filter(
        (f) =>
          !isAbsolute(f) &&
          !normalize(f).startsWith("..") &&
          existsSync(join(r.work, f)),
      ),
    ran: () => ran,
  };
}

/** Rejects when `signal` aborts, so a run that does not stop on its own still ends its attempt. */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () =>
      reject(
        signal.reason instanceof Error ? signal.reason : new Error("aborted"),
      );
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    p.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", stop),
    );
  });
}

export async function loop({
  ledger,
  steps,
  runner: openRunner,
  world,
  concurrent = 4,
  timeoutMs = 30 * 60_000,
}: Loop) {
  const { runs } = world;
  const stepAt = (s: State) => steps.find((x) => x.from === s);
  const running = new Map<string, Promise<void>>();
  const timers = new Set<NodeJS.Timeout>();
  let closing = false;
  // Closing stops the checks running now, and never the runs: que-pasa keeps those for the next process.
  const closed = new AbortController();
  // Who a message is from: the agent of the step it ended, or the orchestrator or Matt, for their own moves.
  const fromOf = (e: Event) =>
    e.by === "matt"
      ? "Matt"
      : (e.by === "attempt" && stepAt(e.from_state as State)?.agent) ||
        "the orchestrator";
  // An attempt ends through the ledger's one door, which routes its message by the table.
  const end = (
    r: Run,
    _state: State,
    v: Message,
    o: {
      usage?: Usage | undefined;
      result?: unknown;
      ran?: CheckRun | undefined;
    } = {},
  ) => {
    ledger.apply(r.name, v, { attempt: r.n, ...o });
  };

  /**
   * Writes the attempt span, the root of the attempt's trace, with the ids it began with. A trace that fails to write
   * is logged and the attempt still ends: the ledger's record of the step comes first.
   */
  async function traced(
    r: Run,
    state: State,
    step: Pick<AnyStep, "agent" | "judges">,
    o: { message: Message; usage?: Usage; error?: string },
  ) {
    try {
      const judged = (step.judges?.(r, ledger) ?? []).flatMap((j) => {
        const s = ledger.traceOf(j.name, j.step);
        return s ? [s] : [];
      });
      const [commit, imageId] = await Promise.all([head(r), imageOf(r)]);
      const row = ledger.attempt(r.name, r.n) as { started: string };
      endAttempt(ledger.span(r.name, r.n), {
        run: r,
        step: state,
        agent: step.agent,
        started: Date.parse(row.started),
        judged,
        resumed: ledger.resumed(r.name, r.n),
        ...o,
        ...(commit ? { commit } : {}),
        ...(imageId ? { imageId } : {}),
      });
    } catch (e) {
      console.error(`the trace of ${r.name}/${r.n} was not written:`, e);
    }
  }

  /**
   * One attempt, from its run to its move in the ledger. It never throws: a failure is a retry, with its reason. A run
   * the loop's closing stopped is not a failure: the attempt is left open, with its sandbox, for the next process.
   */
  async function attempt(
    r: Run,
    state: State,
    step: AnyStep,
    signal: AbortSignal,
  ) {
    let v: Message;
    let ran: CheckRun | undefined;
    let usage: Usage | undefined;
    let result: unknown;
    let error: string | undefined;
    const span = ledger.span(r.name, r.n);
    try {
      // Its spec, then the messages it answers: the one that brought the item here, and each retry since.
      const input =
        (step.input ? step.input(r, ledger) : read(r.path)) +
        messagesText(ledger.inbox(r.name, state), fromOf);
      // The run starts under the attempt span, and que-pasa keeps it: every process's part of the run is under it.
      const out = await abortable(
        within(span, () =>
          runner.run(step.agent, input, {
            run: r,
            retry: ledger.attempts(r.name, state) > 1,
            signal,
            readOnly: step.worktree === "ro",
          }),
        ),
        signal,
      );
      usage = out.usage;
      const parsed = z.object({ result: resultOf(step) }).safeParse(out.value);
      if (!parsed.success)
        v = {
          word: "retry",
          cause: "invalid_output",
          reason: `not a ${state} result: ${parsed.error.message}`,
          findings: [],
        };
      else if (parsed.data.result.word === "back") {
        // The agent's findings, as it gave them: the table sends them to the owner of the highest artifact named.
        const { findings } = parsed.data.result;
        result = parsed.data.result;
        v = {
          word: "back",
          reason: `back, about the ${top(findings.map((f) => f.about))}`,
          findings,
        };
      } else {
        const done = parsed.data.result;
        result = done;
        // The check is in the attempt's time too: a test run that hangs ends the attempt, and its own limit stops it.
        const checking = AbortSignal.any([signal, closed.signal]);
        const at = worktreeOf(r, checking);
        try {
          v = await abortable(step.check(r, done, at, ledger), checking);
        } finally {
          // A test run is recorded whether its check gave a word or failed after it.
          ran = at.ran();
          if (ran) checkSpan(span, state, ran);
        }
        // A pass of a step that edits the worktree is its product: it is committed on the item's branch. Its title is
        // the form crate reads for a release: the code of a feature or a fix lands as one.
        if (v.word === "pass" && step.worktree !== "ro") {
          const issuePath = ledger
            .items()
            .find((i) => i.name === r.issue)?.path;
          const note = (p?: string) => (p && existsSync(p) ? read(p) : "");
          await commit(
            r,
            titleOf(step.agent, r.name, note(issuePath), note(r.path)),
          );
        }
      }
    } catch (e) {
      if (closing) return;
      error = (e as Error).message;
      // A failed run spent too.
      if (e instanceof RunFailed) usage ??= e.usage;
      // Past the time limit, the run is over its budget. A run that failed on its own gave no valid result. Any other
      // failure (git, podman) is the factory's, with no cause on the list.
      const cause = signal.aborted
        ? ("budget_exceeded" as const)
        : e instanceof RunFailed
          ? ("invalid_output" as const)
          : undefined;
      v = {
        word: "retry",
        ...(cause ? { cause } : {}),
        reason: `the attempt failed: ${error.slice(0, 400)}`,
        findings: [],
      };
    }
    // Any other end of a step that edits keeps its change as the attempt's record, and the worktree goes back to its
    // branch, so the next attempt starts from the item's passed work.
    if (v.word !== "pass" && step.worktree !== "ro")
      try {
        await discard(r);
      } catch (e) {
        console.error(`the change of ${r.name}/${r.n} was not reset:`, e);
      }
    await traced(r, state, step, {
      message: v,
      ...(usage ? { usage } : {}),
      ...(error !== undefined ? { error } : {}),
    });
    end(r, state, v, { usage, result, ran });
    await close(r);
  }

  /**
   * One land, from its push to its move in the ledger. It never throws: a failure is a retry, with its reason. A land
   * the loop's closing stopped is left open, and taken up by the next process: a land is safe to run again.
   */
  async function landed(r: Run, signal: AbortSignal) {
    let v: Message;
    let ran: CheckRun | undefined;
    let error: string | undefined;
    const span = ledger.span(r.name, r.n);
    try {
      const stop = AbortSignal.any([signal, closed.signal]);
      await prepared(r, stop);
      const out = await land(r, stop);
      v = out.message;
      ran = out.ran?.check;
      if (ran) checkSpan(span, landing, ran);
      if (v.word === "pass") ledger.landed(r.name, out.commit, out.files);
    } catch (e) {
      if (closing) return;
      error = (e as Error).message;
      const cause = signal.aborted
        ? ("budget_exceeded" as const)
        : e instanceof Setup
          ? ("missing_dependency" as const)
          : undefined;
      v = {
        word: "retry",
        ...(cause ? { cause } : {}),
        reason: `the land failed: ${error.slice(0, 400)}`,
        findings: [],
      };
    }
    await traced(r, landing, lander, {
      message: v,
      ...(error !== undefined ? { error } : {}),
    });
    end(r, landing, v, { ran });
  }

  // The lands of each repo: each one waits for the one before it.
  const repos = new Map<string, Promise<void>>();

  /** Runs a land as a task, after the repo's land before it, under the time limit, counted from its turn. */
  function launchLand(r: Run) {
    const key = `${r.name}/${r.n}`;
    const task = (repos.get(r.repo) ?? Promise.resolve()).then(async () => {
      if (closing) return;
      const limit = new AbortController();
      const timer = setTimeout(
        () => limit.abort(new Error(`timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
      timers.add(timer);
      try {
        await landed(r, limit.signal);
      } finally {
        clearTimeout(timer);
        timers.delete(timer);
      }
    });
    const settled = task
      .catch((e: unknown) => console.error(`land ${key} failed:`, e))
      .finally(() => running.delete(key));
    repos.set(r.repo, settled);
    running.set(key, settled);
  }

  /**
   * The sweep, in every repo the ledger names: each live item keeps its worktree and its branch, and every other one
   * goes. Live is an item not ended, or one with an attempt open. A repo that fails is logged, and the rest go on.
   */
  async function swept() {
    const items = ledger.items();
    const open = new Set(ledger.open().map((a) => a.name));
    const live = items.filter(
      (i) => !ends.includes(i.state) || open.has(i.name),
    );
    const trees = live.map((i) => runOf(i, 0, runs));
    const keep = new Set(
      trees.flatMap((r) => [r.work, ...partsOf(r).map((p) => p.work)]),
    );
    const branches = new Set(live.map((i) => branchOf(i.name)));
    const repos = new Set(
      items.flatMap((i) => [i.repo, ...i.repos.map((p) => p.repo)]),
    );
    for (const repo of repos)
      try {
        await sweep(repo, runs, keep, branches);
      } catch (e) {
        console.error(`the sweep of ${repo} failed:`, e);
      }
  }

  // One tick at a time: a second one would start an attempt a first one is still opening.
  let ticking = false;
  async function tick() {
    if (ticking || closing) return;
    ticking = true;
    try {
      await swept();
      await advance(ledger, world);
      await start();
    } finally {
      ticking = false;
    }
  }

  /**
   * The item's worktree, made or kept, and its setup, once (effects/setup.ts). A new attempt of an issue moves its
   * worktree to main as it is now. Throws a Setup when the setup fails.
   */
  async function prepared(r: Run, signal: AbortSignal) {
    if (await worktree(r)) forgetSetup(r);
    else if (
      r.kind === "issue" &&
      !ledger.resumed(r.name, r.n) &&
      (await fresh(r))
    )
      forgetSetup(r);
    if (!needsSetup(r)) return;
    const at = Date.now();
    try {
      await runSetup(r, signal);
    } catch (e) {
      throw new Setup((e as Error).message);
    }
    log(r, `set up in ${Math.round((Date.now() - at) / 1000)} s`);
  }

  /**
   * Readies an attempt: its worktree, its setup once, and its sandbox. Each failure ends it as a retry, before any
   * agent: a setup's with missing_dependency, since a fault in the image or the lockfile fails every attempt the same
   * way. Gives back whether it is ready. One the loop's closing stopped is left open, unended.
   */
  async function ready(r: Run, state: State, step: AnyStep): Promise<boolean> {
    try {
      await prepared(r, closed.signal);
    } catch (e) {
      // a setup the loop's closing stopped is not a failure: the attempt is set up when it is taken up
      if (closed.signal.aborted) return false;
      // setup.ts keeps the tail of its output, where the failure is
      end(r, state, {
        word: "retry",
        ...(e instanceof Setup ? { cause: "missing_dependency" as const } : {}),
        reason:
          e instanceof Setup
            ? `the setup failed: ${e.message}`
            : `the worktree was not made: ${(e as Error).message.slice(0, 400)}`,
        findings: [],
      });
      return false;
    }
    if (closed.signal.aborted) return false;
    try {
      await open(r, { readOnly: step.worktree === "ro" });
    } catch (e) {
      // the same fault may stop the remove too: the attempt ends all the same
      try {
        await close(r);
      } catch {
        // left for podman to remove
      }
      end(r, state, {
        word: "retry",
        reason: `the sandbox did not open: ${(e as Error).message.slice(0, 400)}`,
        findings: [],
      });
      return false;
    }
    return true;
  }

  /**
   * Runs an attempt as a task, so a tick never waits on one: readied, then its run under the time limit, which each
   * process gives afresh. The loop's settling and its cap count it from the start, setup included.
   */
  function launch(r: Run, state: State, step: AnyStep) {
    const key = `${r.name}/${r.n}`;
    const task = async () => {
      if (!(await ready(r, state, step))) return;
      const limit = new AbortController();
      const timer = setTimeout(
        () => limit.abort(new Error(`timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
      timers.add(timer);
      try {
        await attempt(r, state, step, limit.signal);
      } finally {
        clearTimeout(timer);
        timers.delete(timer);
      }
    };
    running.set(
      key,
      task()
        .catch((e: unknown) => console.error(`attempt ${key} failed:`, e))
        .finally(() => running.delete(key)),
    );
  }

  /** The open attempts this process is not running: a stopped orchestrator left them, to be taken up. */
  const left = () =>
    ledger.open().filter((a) => !running.has(`${a.name}/${a.n}`));

  async function start() {
    for (const a of left()) {
      if (running.size >= concurrent) return;
      if (a.step === landing) {
        const r = runOf(ledger.item(a.name), a.n, runs);
        ledger.resume(a.name, a.n);
        log(r, `taken up by a new orchestrator`);
        launchLand(r);
        continue;
      }
      const step = stepAt(a.step);
      const r = runOf(ledger.item(a.name), a.n, runs);
      if (!step) {
        end(r, a.step, {
          word: "retry",
          reason: `no step runs from ${a.step} any more`,
          findings: [],
        });
        continue;
      }
      ledger.resume(a.name, a.n);
      log(r, `taken up by a new orchestrator`);
      launch(r, a.step, step);
    }
    // An issue escalated waits for Matt: none of its cls starts an attempt, whatever its state.
    const withMatt = new Set(ledger.inState("escalated").map((e) => e.name));
    for (const i of ledger.waiting([...steps.map((s) => s.from), landing])) {
      if (running.size >= concurrent) return;
      if (i.kind === "cl" && withMatt.has(i.issue)) continue;
      const n = ledger.begin(i.name);
      if (i.state === landing) {
        launchLand(runOf(i, n, runs));
        continue;
      }
      launch(runOf(i, n, runs), i.state, stepAt(i.state) as AnyStep);
    }
  }

  // The open attempts' worktrees are there before the runner: it goes on with their runs as it opens, and their
  // sandboxes mount them. One whose worktree or sandbox can't be had is ended when its attempt is taken up.
  await swept();
  for (const a of left()) {
    if (!stepAt(a.step)) continue;
    try {
      const r = runOf(ledger.item(a.name), a.n, runs);
      if (await worktree(r)) forgetSetup(r);
    } catch {
      // taken up, and ended, at the first tick
    }
  }
  // Spans go to their attempt's folder, found by their trace id. Tracing is up before the runner, whose runs a stopped
  // orchestrator left go on, traced, as it opens.
  openTracing((traceId) => {
    const a = ledger.ofTrace(traceId);
    return a && runOf(ledger.item(a.name), a.n, runs).dir;
  });
  const runner = await openRunner();

  /** Waits for every attempt running now to settle. */
  async function settled() {
    await Promise.all(running.values());
  }

  /** Stops the loop and closes the runner. It ends no attempt: each one stays open, with its sandbox and its run. */
  async function stop() {
    closing = true;
    closed.abort(new Error("the loop closed"));
    for (const t of timers) clearTimeout(t);
    timers.clear();
    await runner.close();
  }

  return { tick, settled, close: stop, running: () => running.size };
}
