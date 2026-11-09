/**
 * The loop: it moves issues and their cls through their steps. The agents' loops run here, in the orchestrator, and
 * hold the key; each attempt's sandbox is a container its tools work in (effects/sandbox.ts).
 *
 * An attempt lives until it ends, whatever happens to the process that runs it. Its run is que-pasa's, durable, with
 * the attempt's id; its sandbox and worktree are its own, and a container outlives the orchestrator. So a stopped
 * orchestrator leaves its attempts open in the ledger, and the next one takes each one up: its sandbox again, and its
 * run goes on from where it stopped. A taken-up attempt goes the same way as a new one.
 *
 * Opening the loop makes the worktrees of the open attempts first, then opens the runner: que-pasa's runtime goes on
 * with their runs at once, and their sandboxes, which come up on a tool's first call, mount those worktrees. Each tick
 * then does two things:
 * - it makes the orchestrator's own moves (advance.ts): an approved plan's cls, each cl in turn, the merges.
 * - it starts attempts, up to `concurrent` at once: first the open attempts this process is not running, taken up,
 *   then a new one for each item waiting in a state that has a step. It does not wait for one: the run goes on as a
 *   task, under a time limit, and settles the attempt when it ends. Its result is checked against the step's shape,
 *   the step's check picks the word from the result and the attempt's worktree, which the loop answers for it
 *   (a test run, the changed files), the note is written, and the ledger moves the item.
 * Closing the loop closes the runner and ends nothing: its attempts stay open for the next process.
 *
 * Each attempt is one trace (effects/trace.ts): its span's ids are made when it begins, its run starts under that span, and
 * the span is written when the attempt ends.
 */

import { z } from "zod";
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize, posix } from "node:path";
import { changed, commit, head, touched, worktree } from "../effects/git.ts";
import { read, writeSection } from "../effects/notes.ts";
import { log, runOf } from "../effects/runs.ts";
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
  type Raise,
  resultOf,
  type Run,
  type Step,
  type TestRun,
  type Verdict,
  type View,
  type Worktree,
} from "../process/step.ts";
import { next, sendBack, type State, type Word } from "../process/table.ts";
import { advance } from "./advance.ts";
import type { Ledger, Usage } from "./ledger.ts";

// A step's done shape is its own. The loop needs only its word, so it holds every step by that
type AnyStep = Step<{ word: "done" }>;

/**
 * Runs the agents. effects/runner.ts is the real one: que-pasa's durable runtime, with the agents and models set.
 * - run: one step's agent, by its name, on its input, for one attempt, gives back its output and what its model calls
 *   used. The attempt is the run: run again for an attempt it has, it goes on with that run. `retry` says the attempt
 *   is not the state's first, so a bin's fallback model takes it. It stops when `signal` aborts. A run that failed on
 *   its own throws a RunFailed, with what it used. It traces itself, under the span active when it is called. `view`,
 *   a bound step's, is what its tools reach; none is the whole worktree. `readOnly`: its worktree is mounted read-only.
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
      view?: View;
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

export interface Loop {
  ledger: Ledger;
  steps: AnyStep[];
  runner: () => Promise<Runner>; // opened once the open attempts' worktrees are there
  runs: string; // where run folders go
  concurrent?: number; // attempts at once, at most
  timeoutMs?: number; // the most one attempt may take
}

const raiseText = (r: Raise) =>
  `- from: ${r.from}\n- missing: ${r.missing}\n- evidence: ${r.evidence}`;

/** The files the worktree changed that are not the view's change files. */
async function outside(view: View, at: Worktree) {
  const change = new Set(view.change.map((f) => posix.normalize(f)));
  return (await at.touched()).filter((f) => !change.has(f));
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
  runs,
  concurrent = 4,
  timeoutMs = 30 * 60_000,
}: Loop) {
  const stepAt = (s: State) => steps.find((x) => x.from === s);
  const running = new Map<string, Promise<void>>();
  const timers = new Set<NodeJS.Timeout>();
  let closing = false;
  // Closing stops the checks running now, and never the runs: que-pasa keeps those for the next process.
  const closed = new AbortController();
  // The limits' counts, with the attempt about to end in them: it is open, so attempts counts it, and a send-back
  // is not in the events until it ends.
  const counts = (name: string, state: State, word: Word) => ({
    attempts: ledger.attempts(name, state),
    rounds: ledger.rounds(name) + (sendBack(word) ? 1 : 0),
  });
  const end = (
    r: Run,
    state: State,
    v: Verdict,
    o: {
      usage?: Usage | undefined;
      result?: unknown;
      ran?: CheckRun | undefined;
    } = {},
  ) => {
    // A word the table has no move for is the factory's fault, not the item's: it is escalated, with why, and never
    // left open to run again.
    let to: State;
    let verdict = v;
    try {
      to = next(state, v.word, counts(r.name, state, v.word));
    } catch (e) {
      to = "escalated";
      verdict = { ...v, reason: `${(e as Error).message}: ${v.reason}` };
    }
    ledger.end(r.name, r.n, verdict, to, o);
  };

  /**
   * Writes the attempt span, the root of the attempt's trace, with the ids it began with. A trace that fails to write
   * is logged and the attempt still ends: the ledger's record of the step comes first.
   */
  async function traced(
    r: Run,
    state: State,
    step: AnyStep,
    o: { verdict: Verdict; usage?: Usage; error?: string },
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
    let v: Verdict;
    let ran: CheckRun | undefined;
    let usage: Usage | undefined;
    let result: unknown;
    let error: string | undefined;
    const span = ledger.span(r.name, r.n);
    try {
      const input = step.input ? step.input(r, ledger) : read(r.path);
      const view = step.view?.(r, ledger);
      // The run starts under the attempt span, and que-pasa keeps it: every process's part of the run is under it.
      const out = await abortable(
        within(span, () =>
          runner.run(step.agent, input, {
            run: r,
            retry: ledger.attempts(r.name, state) > 1,
            signal,
            readOnly: step.worktree === "ro",
            ...(view ? { view } : {}),
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
        };
      else if (parsed.data.result.word === "raise") {
        result = parsed.data.result;
        // A cl's raise is the plan's gap; the planner's is the issue's.
        v = {
          word: "raise",
          cause: r.kind === "cl" ? "plan_gap" : "missing_context",
          reason: parsed.data.result.missing,
        };
        writeSection(r.path, "Raise", raiseText(parsed.data.result));
      } else {
        const done = parsed.data.result;
        result = done;
        // The check is in the attempt's time too: a test run that hangs ends the attempt, and its own limit stops it.
        const checking = AbortSignal.any([signal, closed.signal]);
        const at = worktreeOf(r, checking);
        try {
          // A bound step changes only its cut's change files, whatever made the change: its tools, or code its tests ran.
          const stray = view ? await outside(view, at) : [];
          v = stray.length
            ? {
                word: "retry",
                cause: "scope_exceeds_change",
                reason: `changed files its cut does not: ${stray.join(", ")}`,
              }
            : await abortable(step.check(r, done, at), checking);
        } finally {
          // A test run is recorded whether its check gave a word or failed after it.
          ran = at.ran();
          if (ran) checkSpan(span, state, ran);
        }
        // A pass, or a review's send-back, is the step's done work: it is written, and a step that edits the
        // worktree has its attempt committed, which becomes the item's branch.
        if (v.word !== "retry") {
          if (step.write) step.write(r, done, v);
          else writeSection(r.path, step.section, step.render(done));
          if (step.worktree !== "ro")
            await commit(
              r,
              `${step.agent}(${r.name}): ${step.section.toLowerCase()}`,
              view?.change.map((f) => posix.normalize(f)),
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
      };
    }
    await traced(r, state, step, {
      verdict: v,
      ...(usage ? { usage } : {}),
      ...(error !== undefined ? { error } : {}),
    });
    end(r, state, v, { usage, result, ran });
    await close(r);
  }

  // One tick at a time: a second one would start an attempt a first one is still opening.
  let ticking = false;
  async function tick() {
    if (ticking || closing) return;
    ticking = true;
    try {
      await advance(ledger);
      await start();
    } finally {
      ticking = false;
    }
  }

  /**
   * Readies an attempt: its worktree, its setup once (effects/setup.ts), and its sandbox. Each failure ends it as a
   * retry, before any agent: a setup's with missing_dependency, since a fault in the image or the lockfile fails every
   * attempt the same way. Gives back whether it is ready. One the loop's closing stopped is left open, unended.
   */
  async function ready(r: Run, state: State, step: AnyStep): Promise<boolean> {
    try {
      if (await worktree(r)) forgetSetup(r);
    } catch (e) {
      end(r, state, {
        word: "retry",
        reason: `the worktree was not made: ${(e as Error).message.slice(0, 400)}`,
      });
      return false;
    }
    if (needsSetup(r)) {
      const at = Date.now();
      try {
        await runSetup(r, closed.signal);
      } catch (e) {
        // a setup the loop's closing stopped is not a failure: the attempt is set up when it is taken up
        if (closed.signal.aborted) return false;
        // setup.ts keeps the tail of its output, where the failure is
        end(r, state, {
          word: "retry",
          cause: "missing_dependency",
          reason: `the setup failed: ${(e as Error).message}`,
        });
        return false;
      }
      log(r, `set up in ${Math.round((Date.now() - at) / 1000)} s`);
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
      const r = runOf(ledger.item(a.name), a.n, runs);
      const step = stepAt(a.step);
      if (!step) {
        end(r, a.step, {
          word: "retry",
          reason: `no step runs from ${a.step} any more`,
        });
        continue;
      }
      ledger.resume(a.name, a.n);
      log(r, `taken up by a new orchestrator`);
      launch(r, a.step, step);
    }
    for (const i of ledger.waiting(steps.map((s) => s.from))) {
      if (running.size >= concurrent) return;
      const n = ledger.begin(i.name);
      launch(runOf(i, n, runs), i.state, stepAt(i.state) as AnyStep);
    }
  }

  // The open attempts' worktrees are there before the runner: it goes on with their runs as it opens, and their
  // sandboxes mount them. One whose worktree or sandbox can't be had is ended when its attempt is taken up.
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
