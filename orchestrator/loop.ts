/**
 * The loop: it moves cls through their steps and never waits on a container. Each tick does two things. It starts an
 * attempt for every cl whose state has a step and no attempt open. It finishes every open attempt whose container has
 * stopped: it reads out/result.json against the step's shape, runs the step's check for the word, writes the cl, and
 * moves the cl in the ledger. Every open attempt is read back from the ledger and its container, so a killed loop
 * starts again where it was.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Raise,
  resultOf,
  type Run,
  type Step,
  type Verdict,
} from "../process/step.ts";
import type { Ledger } from "./ledger.ts";
import { type Agent, collect, commit, runOf, start, status } from "./start.ts";
import { next, type State, type Word } from "./table.ts";

// A step's done shape is its own. The loop needs only its word, so it holds every step by that
type AnyStep = Step<{ word: "done" }>;

export interface Loop {
  ledger: Ledger;
  steps: AnyStep[];
  agents: Record<string, Agent>;
  runs: string; // where run folders go
}

/** Puts `text` under the cl's `## <heading>`, in place of what was there, or at the end when it has none. */
export function writeSection(path: string, heading: string, text: string) {
  const doc = readFileSync(path, "utf8");
  const at = doc.search(new RegExp(`^## ${heading}\\n`, "m"));
  if (at < 0) {
    writeFileSync(path, `${doc.trimEnd()}\n\n## ${heading}\n\n${text}\n`);
    return;
  }
  const body = at + `## ${heading}\n`.length;
  const rest = doc.slice(body).search(/^## /m);
  const end = rest < 0 ? doc.length : body + rest;
  writeFileSync(
    path,
    `${doc.slice(0, body)}\n${text}\n${rest < 0 ? "" : `\n${doc.slice(end)}`}`,
  );
}

const raiseText = (r: Raise) =>
  `- from: ${r.from}\n- missing: ${r.missing}\n- evidence: ${r.evidence}`;

export function loop({ ledger, steps, agents, runs }: Loop) {
  const stepAt = (s: State) => steps.find((x) => x.from === s);
  const busy = new Set<string>();
  // The limits' counts, with the attempt about to end in them: it is open, so attempts counts it, and a send-back
  // is not in the events until it ends.
  const counts = (cl: string, state: State, word: Word) => ({
    attempts: ledger.attempts(cl, state),
    rounds:
      ledger.rounds(cl) + (word === "to-tests" || word === "to-code" ? 1 : 0),
  });

  async function finish(
    r: Run,
    state: State,
    step: AnyStep,
    stopped: boolean,
  ): Promise<void> {
    let v: Verdict;
    const file = join(r.out, "result.json");
    if (!stopped) v = { word: "retry", reason: "the container is gone" };
    else if (!existsSync(file))
      v = { word: "retry", reason: "no out/result.json" };
    else {
      const parsed = resultOf(step).safeParse(
        JSON.parse(readFileSync(file, "utf8")),
      );
      if (!parsed.success)
        v = {
          word: "retry",
          reason: `result.json is not a ${state} result: ${parsed.error.message}`,
        };
      else if (parsed.data.word === "raise") {
        v = { word: "raise", reason: parsed.data.missing };
        writeSection(r.path, "Raise", raiseText(parsed.data));
      } else {
        v = await step.check(r, parsed.data);
        // A pass, or a review's send-back, is the step's done work: its section is written, and the attempt is
        // committed and becomes the cl's branch.
        if (v.word !== "retry") {
          writeSection(r.path, step.section, step.render(parsed.data));
          await commit(
            r,
            `${step.agent}(${r.cl}): ${step.section.toLowerCase()}`,
          );
        }
      }
    }
    ledger.end(r.cl, r.n, v, next(state, v.word, counts(r.cl, state, v.word)));
    if (stopped) await collect(r);
  }

  async function tick() {
    for (const a of ledger.open()) {
      const key = `${a.cl}/${a.n}`;
      if (busy.has(key)) continue;
      const step = stepAt(a.step);
      if (!step)
        throw new Error(`an attempt is open at ${a.step}, which has no step`);
      const r = runOf(ledger.item(a.cl), a.n, runs);
      const s = await status(r);
      if (s && s.status !== "exited") continue;
      busy.add(key);
      // Not awaited: the tick moves on while the check runs. A failed finish leaves the attempt open, so the next
      // tick tries it again.
      void finish(r, a.step, step, s !== null)
        .catch((e: unknown) => console.error(`finish ${key} failed:`, e))
        .finally(() => busy.delete(key));
    }

    const states = steps.map((s) => s.from);
    for (const i of ledger.waiting(states)) {
      const step = stepAt(i.state) as AnyStep;
      const agent = agents[step.agent];
      if (!agent) throw new Error(`no agent ${step.agent}`);
      const n = ledger.begin(i.cl);
      const r = runOf(i, n, runs);
      try {
        await start(r, step, agent);
      } catch (e) {
        const v: Verdict = {
          word: "retry",
          reason: `start failed: ${(e as Error).message.slice(0, 400)}`,
        };
        ledger.end(
          i.cl,
          n,
          v,
          next(i.state, v.word, counts(i.cl, i.state, v.word)),
        );
      }
    }
  }

  return { tick };
}
