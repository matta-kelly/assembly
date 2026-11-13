/**
 * The real runner: que-pasa's durable runtime, with the agents and models it is given (main.ts gives the factory's
 * agents, on their bins, and the host's models). One runtime per
 * orchestrator process, on pi's own SQLite file beside the ledger, so a run outlives the process that started it.
 *
 * Each agent on an item has one conversation (`<item>/<agent>`), which keeps its history across the item's attempts:
 * da-hammer on a cl remembers what it read, wrote and was told on its tries before. Each attempt is one run on it, its id
 * the attempt's number, so the same attempt taken up again is the same run: it goes on from where it stopped, with the
 * model it started with. `modelFor` picks the run's model: on the bins, their default, and their fallback on a retry.
 *
 * The conversation's context is what lives as long as it (`Context`): the item, the agent, the item's folder and
 * whether the worktree is read-only. What changes from one attempt to the next (its number, its notes' commit, its
 * image) is the attempt's run, written to the item's folder before each run (`<agent>.run.json`), so a run taken up in a
 * new process reads it back. From it the runner provides the run's Sandbox, the attempt's box (sandbox.ts), and the
 * test tool its run. Its usage is summed for the ledger. que-pasa traces the run itself, with its messages and each
 * tool call, under the attempt's span (trace.ts).
 */

import { dirname } from "node:path";
import type { Models } from "@earendil-works/pi-ai";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Agent } from "@mku1tra/que-pasa/define";
import { openRuntime, provide, type RunUsage } from "@mku1tra/que-pasa/loop";
import { Sandbox } from "@mku1tra/que-pasa/sandbox";
import type { z } from "zod";
import { type Context, current, keep } from "./runs.ts";
import { boxOf } from "./sandbox.ts";
import type { Usage } from "../orchestrator/ledger.ts";
import { RunFailed, type Runner } from "../orchestrator/loop.ts";

/** The tokens and cost of a run, over every model it called. */
export function total(usage: RunUsage): Usage {
  const models = Object.values(usage.models);
  const sum = (f: (u: (typeof models)[number]) => number) =>
    models.reduce((n, u) => n + f(u), 0);
  return {
    tokens: sum((u) => u.totalTokens),
    cost: sum((u) => u.cost.total),
    input: sum((u) => u.input + u.cacheRead + u.cacheWrite),
    output: sum((u) => u.output),
    cached: sum((u) => u.cacheRead),
  };
}

/** How the runner makes each agent, by its name, and which model `modelFor` gives an attempt of it. */
export interface Agents {
  make: Record<string, (model: string) => Agent<z.ZodObject, Context>>;
  modelFor: (agent: string, retry: boolean) => string;
}

/** The attempt's box, from its conversation's context. */
const boxFor = (context: unknown) => {
  const c = context as Context;
  return boxOf(current(c), { readOnly: c.readOnly });
};

/**
 * Opens the runtime: each agent made once, and pi's storage at `store`. Runs a stopped orchestrator left go on at once,
 * so the loop makes their worktrees before it opens the runner; their boxes come up on their first tool call.
 */
export async function quePasa(
  { make, modelFor }: Agents,
  models: Models,
  store: string,
): Promise<Runner> {
  const built = new Map(
    Object.entries(make).map(([name, m]) => [name, m(modelFor(name, false))]),
  );
  const runtime = await openRuntime({
    storage: await openNodeSqliteStorage(store),
    models,
    agents: [...built.values()],
    // The traces are eval data: the whole conversation is in them.
    captureContent: true,
    resources: [provide(Sandbox, ({ context }) => boxFor(context))],
  });

  const run: Runner["run"] = async (
    name,
    input,
    { run: attempt, retry, signal, readOnly },
  ) => {
    const agent = built.get(name);
    if (!agent) throw new Error(`no agent ${name}`);
    const model = modelFor(name, retry);
    let usage: Usage | undefined;
    const context: Context = {
      item: attempt.name,
      agent: name,
      folder: dirname(attempt.dir),
      readOnly,
    };
    keep(context, attempt);
    try {
      const value = await runtime.run(agent, input, {
        conversation: `${attempt.name}/${name}`,
        runId: String(attempt.n),
        caller: { id: "assembly" },
        model,
        context,
        signal,
        onUsage: (u) => (usage = total(u)),
      });
      return usage ? { value, usage } : { value };
    } catch (e) {
      // An abort is the loop's (its time limit, or its close), and it knows why; any other failure is the run's.
      if (signal.aborted) throw e;
      throw new RunFailed(e instanceof Error ? e.message : String(e), usage);
    }
  };

  return { run, close: () => runtime.close() };
}
