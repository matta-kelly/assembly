/**
 * The factory's wiring: the one place its parts are put together. Its command line is cli/, one way in among others.
 *
 * compose builds the system from its three layers: the process (the steps, and the agents they name, each put on its
 * bin here), the engine (the ledger and the loop) and the effects (the runner on the bins' models; git, the sandbox and
 * the test runs, which the loop calls). Everything the factory keeps is under one home: the ledger (ledger.db), pi's store (pi.db) and the run
 * folders (runs/).
 *
 * The e2e test builds through compose too, with scripted models in place of the bins'.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Models } from "@earendil-works/pi-ai";
import { models as hostModels } from "./effects/models.ts";
import { agents } from "./agents/index.ts";
import { modelOf } from "./effects/models.ts";
import { landedTags } from "./effects/git.ts";
import { npmRegistry } from "./effects/registry.ts";
import { gitReader } from "./effects/repo.ts";
import { type Agents, quePasa } from "./effects/runner.ts";
import { steps as all } from "./process/index.ts";
import type { Step } from "./process/step.ts";
import { open } from "./orchestrator/ledger.ts";
import { loop } from "./orchestrator/loop.ts";

export interface Factory {
  home: string; // where the factory keeps everything
  agents?: Agents; // the agents and the model each attempt runs on: the bins' when left out
  models?: Models; // the providers those models come from: the host's when left out
  steps?: Step<{ word: "done" }>[]; // every step when left out
  concurrent?: number;
  timeoutMs?: number;
}

/** The factory's agents on their bins: each attempt runs on its bin's default, and a retry on its fallback. */
export function onBins(): Agents {
  return {
    make: Object.fromEntries(
      Object.entries(agents).map(([name, a]) => [name, a.make]),
    ),
    modelFor: (name, retry) => {
      const a = agents[name as keyof typeof agents];
      if (!a) throw new Error(`no agent ${name}`);
      return modelOf(a.bin, retry);
    },
  };
}

/** Builds the factory: its ledger now, and its loop when asked, which opens the runner and tracing. */
export function compose(f: Factory) {
  mkdirSync(f.home, { recursive: true });
  const ledger = open(join(f.home, "ledger.db"));
  const runs = join(f.home, "runs");
  return {
    ledger,
    runs,
    loop: () =>
      loop({
        ledger,
        steps: f.steps ?? all,
        runner: () =>
          quePasa(
            f.agents ?? onBins(),
            f.models ?? hostModels(),
            join(f.home, "pi.db"),
          ),
        runs,
        world: {
          registry: npmRegistry(),
          reader: gitReader,
          tags: landedTags,
        },
        ...(f.concurrent !== undefined ? { concurrent: f.concurrent } : {}),
        ...(f.timeoutMs !== undefined ? { timeoutMs: f.timeoutMs } : {}),
      }),
  };
}

/** The factory as compose builds it. */
export type Built = ReturnType<typeof compose>;
