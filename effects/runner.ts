/**
 * The real runner: que-pasa's durable runtime, with the agents and models it is given (main.ts gives the factory's
 * agents, on their bins, and the host's models). One runtime per
 * orchestrator process, on pi's own SQLite file beside the ledger, so a run outlives the process that started it.
 *
 * Each attempt is one run, its id the attempt's (`<item>/<n>`), so the same attempt taken up again is the same run: it
 * goes on from where it stopped, with the model and context it started with. `modelFor` picks the run's model: on the
 * bins, their default, and their fallback on a retry. The run's context is the attempt (tools.ts), and from it the
 * runner provides the run's Sandbox, the attempt's box (sandbox.ts). A run taken up in a new process resolves it from
 * the same context, so it finds the same container. Its usage is summed for the ledger. que-pasa traces the run itself, with
 * its messages and each tool call, under the attempt's span (trace.ts).
 */

import type { Models } from "@earendil-works/pi-ai";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Agent } from "@mku1tra/que-pasa/define";
import { openRuntime, provide, type RunUsage } from "@mku1tra/que-pasa/loop";
import { Sandbox } from "@mku1tra/que-pasa/sandbox";
import type { z } from "zod";
import { boxOf } from "./sandbox.ts";
import type { Context } from "./tools.ts";
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

/** The attempt's box, from its run's context. */
const boxFor = (context: unknown) => {
  const c = context as Context;
  return { c, box: boxOf(c.run, { readOnly: c.readOnly }) };
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
    resources: [provide(Sandbox, ({ context }) => boxFor(context).box)],
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
    try {
      const value = await runtime.run(agent, input, {
        runId: `${attempt.name}/${attempt.n}`,
        caller: { id: "assembly" },
        model,
        // A run taken up after a stop keeps the context it started with: its checkout too.
        context: { run: attempt, readOnly } satisfies Context,
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
