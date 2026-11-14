/**
 * The loop: it moves issues and their cls through their steps. The agents' loops run here, in the orchestrator, and
 * hold the key; each attempt's sandbox is a container its tools work in (factory/runs/sandbox.ts).
 *
 * An attempt lives until it ends, whatever happens to the process that runs it. Its run is que-pasa's, durable, with
 * the attempt's id; its sandbox is its own, and a container outlives the orchestrator. So a stopped
 * orchestrator leaves its attempts open in the ledger, and the next one takes each one up: its sandbox again, and its
 * run goes on from where it stopped. A taken-up attempt goes the same way as a new one.
 *
 * Each item has one worktree, which every attempt of it works in (factory/repos/git.ts): a pass commits there, and any other
 * end of a step that writes records its change and leaves it there for the next attempt. Opening the loop sweeps away every
 * worktree and branch no live item holds, makes the worktrees of the open attempts, then opens the runner: que-pasa's
 * runtime goes on with their runs at once, and their sandboxes, which come up on a tool's first call, mount those
 * worktrees. Each tick then sweeps again, and does two things:
 * - it makes the orchestrator's own moves (advance.ts): a building issue's cls, phase by phase, and their issue built.
 * - it starts attempts, up to `concurrent` at once: first the open attempts this process is not running, taken up,
 *   then a new one for each item waiting in a state that has a step, except the cls of an issue escalated to Matt: they
 *   stay in their state until he answers. Each is readied first: its worktree, the notes' main fetched and its commit
 *   pinned on the attempt, its repo's settings read from the worktree, and its setup. It does not wait for one: the run
 *   goes on as a task, under a time limit, and settles the attempt when it ends. Its result is checked against the
 *   step's shape, the step's check picks the word from the result and the attempt's worktree, which the loop answers
 *   for it (a test run, the changed files), and the ledger moves the item.
 * An approved item's attempt is its land (factory/repos/land.ts): code, with no agent, that takes a cl to its repo's main, and
 * an issue's plan, written as notes, to the notes' main. Lands onto one main run one at a time, each after the one
 * before it.
 * Closing the loop closes the runner and ends nothing: its attempts stay open for the next process.
 *
 * Each attempt is one trace (factory/runs/trace.ts): its span's ids are made when it begins, its run starts under that span, and
 * the span is written when the attempt ends.
 */

import { z } from "zod";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import {
  branchOf,
  changed,
  commit,
  fresh,
  head,
  mainOf,
  onMain,
  sweep,
  touched,
  worktree,
} from "../repos/git.ts";
import { land } from "../repos/land.ts";
import { commitOf, notesOf } from "../repos/notes.ts";
import {
  CrateError,
  NotOnCrate,
  readerImage,
  settingsAt,
} from "../repos/repo.ts";
import { folderOf, last, log, partsOf, runOf } from "../runs/runs.ts";
import { close, imageOf, open } from "../runs/sandbox.ts";
import { forgetSetup, needsSetup, runSetup } from "../runs/setup.ts";
import { runTests } from "../runs/tests.ts";
import { checkSpan, endAttempt, openTracing, within } from "../runs/trace.ts";
import { clOf } from "../stations/plan.ts";
import {
  type Cause,
  type CheckRun,
  type Message,
  type NotesAt,
  type Repo,
  resultOf,
  type Run,
  type Step,
  type TestRun,
  type Tree,
  type Worktree,
} from "./step.ts";
import { ends, type State, top } from "./table.ts";
import { advance, type World, writePlan } from "./advance.ts";
import { titleOf } from "./title.ts";
import type { Event, Item, Ledger, Usage } from "./ledger.ts";

// A step's done shape is its own. The loop needs only its word, so it holds every step by that
type AnyStep = Step<{ word: "done" }>;

/** The land's state, and its name in a trace: an approved cl's attempt is code, with no agent (factory/repos/land.ts). */
const landing: State = "approved";
const lander = { agent: "git-land" };

/**
 * Runs the agents. factory/runs/runner.ts is the real one: que-pasa's durable runtime, with the agents and models set.
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

/** Why an attempt could not be readied, and the cause its retry carries, when it is one on the list. */
class Unready extends Error {
  readonly why: Cause | undefined;

  constructor(message: string, why?: Cause) {
    super(message);
    this.why = why;
  }
}

/** Runs `f`, and makes its failure an Unready: `what` failed, with the failure's cause when `causeOf` names one. */
async function readying<T>(
  what: string,
  f: () => Promise<T>,
  causeOf: (e: unknown) => Cause | undefined = () => undefined,
): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw new Unready(
      `${what}: ${(e as Error).message.slice(0, 1_500)}`,
      causeOf(e),
    );
  }
}

/** A worktree of one repo: the tree without its several repos, which a run carries with their settings. */
const one = (t: Tree): Omit<Tree, "repos"> => ({
  name: t.name,
  kind: t.kind,
  issue: t.issue,
  n: t.n,
  repo: t.repo,
  dir: t.dir,
  work: t.work,
});

/** The cause of settings that do not read: a repo not on crate breaks the item's contract, crate's failure a dependency. */
const unreadable = (e: unknown): Cause | undefined =>
  e instanceof NotOnCrate
    ? "contract_invalid"
    : e instanceof CrateError
      ? "missing_dependency"
      : undefined;

export interface Loop {
  ledger: Ledger;
  steps: AnyStep[];
  runner: () => Promise<Runner>; // opened once the open attempts' worktrees are there
  world: World; // where run folders go, the notes repo, and what a waiting cl needs: registry, repos' files, landed tags
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
    r: Pick<Tree, "name" | "n">,
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
   * What the attempt's agent reads. Its first run on the item reads its spec, then the messages it answers: the one
   * that brought the item here, and each retry since. A later run goes on in the same conversation, which holds all
   * that, so it reads only what is new: a review's input again (the work as it is now), or the note when it changed,
   * and the messages since its last run ended, that run's own end first.
   */
  function inputOf(r: Run, state: State, step: AnyStep): string {
    const before = last({ folder: dirname(r.dir), agent: step.agent });
    if (!before || before.n === r.n)
      return (
        (step.input ? step.input(r, ledger) : notesOf(r).text(r.note)) +
        messagesText(ledger.inbox(r.name, state), fromOf)
      );
    const all = ledger.events(r.name);
    const from = all.findIndex((e) => e.n === before.n && e.by === "attempt");
    const since = (from < 0 ? [] : all.slice(from)).filter(
      (e) => e.word !== null || e.findings.length,
    );
    const now = step.input
      ? step.input(r, ledger)
      : before.notes.commit !== r.notes.commit
        ? `# Your note, changed since your last run\n\n${notesOf(r).text(r.note)}`
        : "";
    return (
      [`# Attempt ${r.n}: your work goes on`, now]
        .filter(Boolean)
        .join("\n\n") + messagesText(since, fromOf)
    );
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
      const input = inputOf(r, state, step);
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
          const notes = notesOf(r);
          await commit(
            r,
            titleOf(
              step.agent,
              r.name,
              notes.text(ledger.item(r.issue).note),
              notes.text(r.note),
            ),
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
    await traced(r, state, step, {
      message: v,
      ...(usage ? { usage } : {}),
      ...(error !== undefined ? { error } : {}),
    });
    end(r, state, v, { usage, result, ran });
    await close(r);
  }

  /**
   * The issue's land as a run in the notes repo: its worktree there, on the issue's branch, put at the notes' main as
   * it is now, with its planner's spec written as notes and committed. Its settings are the notes repo's, from it.
   */
  async function planned(t: Tree): Promise<Run> {
    const item = ledger.item(t.name);
    const at = {
      ...one(t),
      repo: world.notes,
      work: join(folderOf(item, runs), "notes"),
    };
    const notes = await readying("the notes were not read", () => pinned(t));
    await readying("the notes' worktree was not made", () => onMain(at));
    writePlan(ledger, item, at.work);
    await commit(at, `docs(${t.name}): its plan`);
    const settings = await readying(
      "the notes repo's settings were not read",
      () => settingsAt(at.work, basename(world.notes)),
      unreadable,
    );
    return { ...at, seq: item.seq, note: item.note, notes, ...settings };
  }

  /**
   * One land, from its push to its move in the ledger: a cl's onto its repo's main, an issue's plan onto the notes'
   * main. It never throws: a failure is a retry, with its reason. A land the loop's closing stopped is left open, and
   * taken up by the next process: a land is safe to run again.
   */
  async function landed(t: Tree, signal: AbortSignal) {
    let v: Message;
    let ran: CheckRun | undefined;
    let error: string | undefined;
    let r: Run | undefined;
    const span = ledger.span(t.name, t.n);
    try {
      const stop = AbortSignal.any([signal, closed.signal]);
      r = t.kind === "issue" ? await planned(t) : await prepared(t, stop);
      const out = await land(r, stop);
      v = out.message;
      ran = out.ran?.check;
      if (ran) checkSpan(span, landing, ran);
      if (v.word === "pass") ledger.landed(t.name, out.commit, out.files);
    } catch (e) {
      if (closing) return;
      error = (e as Error).message;
      const cause = signal.aborted
        ? ("budget_exceeded" as const)
        : e instanceof Unready
          ? e.why
          : undefined;
      v = {
        word: "retry",
        ...(cause ? { cause } : {}),
        reason: `the land failed: ${error.slice(0, 400)}`,
        findings: [],
      };
    }
    if (r)
      await traced(r, landing, lander, {
        message: v,
        ...(error !== undefined ? { error } : {}),
      });
    end(t, landing, v, { ran });
  }

  // The lands of each repo: each one waits for the one before it.
  const repos = new Map<string, Promise<void>>();

  /**
   * Runs a land as a task, after the land before it onto the same main, under the time limit, counted from its turn. An
   * issue's lands onto the notes' main.
   */
  function launchLand(t: Tree) {
    const key = `${t.name}/${t.n}`;
    const onto = t.kind === "issue" ? world.notes : t.repo;
    const task = (repos.get(onto) ?? Promise.resolve()).then(async () => {
      if (closing) return;
      const limit = new AbortController();
      const timer = setTimeout(
        () => limit.abort(new Error(`timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
      timers.add(timer);
      try {
        await landed(t, limit.signal);
      } finally {
        clearTimeout(timer);
        timers.delete(timer);
      }
    });
    const settled = task
      .catch((e: unknown) => console.error(`land ${key} failed:`, e))
      .finally(() => running.delete(key));
    repos.set(onto, settled);
    running.set(key, settled);
  }

  /**
   * The sweep, in the notes repo and every repo the ledger names: each live item keeps its worktree, an issue its
   * notes' worktree too, and its branch, and every other one goes. Live is an item not ended, or one with an attempt
   * open. A repo that fails is logged, and the rest go on.
   */
  async function swept() {
    const items = ledger.items();
    const open = new Set(ledger.open().map((a) => a.name));
    const live = items.filter(
      (i) => !ends.includes(i.state) || open.has(i.name),
    );
    const keep = new Set(
      live.flatMap((i) => {
        const t = runOf(i, 0, runs);
        return [
          t.work,
          ...partsOf(t).map((p) => p.work),
          ...(i.kind === "issue" ? [join(folderOf(i, runs), "notes")] : []),
        ];
      }),
    );
    const branches = new Set(live.map((i) => branchOf(i.name)));
    const repos = new Set([
      world.notes,
      ...items.flatMap((i) => [i.repo, ...i.repos]),
    ]);
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

  /** The notes the attempt reads: the commit of the notes' main pinned when it started, else main as it is now. */
  async function pinned(t: Tree): Promise<NotesAt> {
    let commit = ledger.pinned(t.name, t.n);
    if (!commit) {
      const main = await mainOf(world.notes);
      commit = commitOf(world.notes, main);
      if (!commit) throw new Error(`${world.notes} has no ${main}`);
      ledger.pin(t.name, t.n, commit);
    }
    return { repo: world.notes, commit };
  }

  /**
   * The attempt's run: its notes, and each repo's settings read from its worktree (factory/repos/repo.ts). A cl's test
   * command is its note's, at the notes' commit.
   */
  async function runFor(t: Tree, item: Item): Promise<Run> {
    const notes = await readying("the notes were not read", () => pinned(t));
    const repos: Repo[] = [];
    for (const p of partsOf(t)) {
      const name = basename(p.repo);
      const s = await readying(
        `${name}'s settings were not read`,
        () => settingsAt(p.work, name),
        unreadable,
      );
      repos.push({ name, repo: p.repo, ...s });
    }
    const [first] = repos as [Repo, ...Repo[]];
    const test =
      t.kind === "cl"
        ? await readying(
            "its note is not a cl",
            async () =>
              clOf(notesOf({ notes }), { ...t, note: item.note }).test,
            () => "contract_invalid",
          )
        : first.test;
    return {
      ...one(t),
      seq: item.seq,
      note: item.note,
      notes,
      image: repos.length > 1 ? readerImage : first.image,
      test,
      setup: first.setup,
      ...(repos.length > 1 ? { repos } : {}),
    };
  }

  /**
   * Readies an attempt's run: the item's worktree, made or kept, its notes and settings, and its setup, once
   * (factory/runs/setup.ts). A new attempt of an issue moves its worktree to main as it is now. Throws an Unready, with the
   * cause its retry carries: a setup's is missing_dependency, since a fault in the image or the lockfile fails every
   * attempt the same way.
   */
  async function prepared(t: Tree, signal: AbortSignal): Promise<Run> {
    const made = await readying("the worktree was not made", () => worktree(t));
    if (made) forgetSetup(t);
    else if (
      t.kind === "issue" &&
      !ledger.resumed(t.name, t.n) &&
      (await readying("the worktree did not move to main", () => fresh(t)))
    )
      forgetSetup(t);
    const r = await runFor(t, ledger.item(t.name));
    if (!needsSetup(r)) return r;
    const at = Date.now();
    // setup.ts keeps the tail of its output, where the failure is
    await readying(
      "the setup failed",
      () => runSetup(r, signal),
      () => "missing_dependency",
    );
    log(r, `set up in ${Math.round((Date.now() - at) / 1000)} s`);
    return r;
  }

  /**
   * Readies an attempt: its run, and its sandbox. Each failure ends it as a retry, before any agent. Gives back its
   * run when it is ready. One the loop's closing stopped is left open, unended.
   */
  async function ready(
    t: Tree,
    state: State,
    step: AnyStep,
  ): Promise<Run | undefined> {
    let r: Run;
    try {
      r = await prepared(t, closed.signal);
    } catch (e) {
      // a setup the loop's closing stopped is not a failure: the attempt is set up when it is taken up
      if (closed.signal.aborted) return undefined;
      end(t, state, {
        word: "retry",
        ...(e instanceof Unready && e.why ? { cause: e.why } : {}),
        reason: (e as Error).message,
        findings: [],
      });
      return undefined;
    }
    if (closed.signal.aborted) return undefined;
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
      return undefined;
    }
    return r;
  }

  /**
   * Runs an attempt as a task, so a tick never waits on one: readied, then its run under the time limit, which each
   * process gives afresh. The loop's settling and its cap count it from the start, setup included.
   */
  function launch(t: Tree, state: State, step: AnyStep) {
    const key = `${t.name}/${t.n}`;
    const task = async () => {
      const r = await ready(t, state, step);
      if (!r) return;
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
