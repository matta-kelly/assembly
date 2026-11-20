/**
 * The factory's agents, by name, as the steps name them: each one's bin, and how to make it on a model. Each one is
 * made with its bin's compaction after its own middleware (compaction.ts), here, so no agent repeats it.
 */

import { type Agent, defineAgent, type Json } from "@mku1tra/que-pasa/define";
import type { z } from "zod";
import type { BinName } from "../../factory/runs/models.ts";
import { clReview } from "./cl-review.ts";
import { compactionOn } from "./compaction.ts";
import { daHammer } from "./da-hammer.ts";
import { daNail } from "./da-nail.ts";
import { planReviewer } from "./plan-review.ts";
import { planner } from "./planner.ts";

/** An agent on its bin: made on a model, with the bin's compaction last among its middleware. */
function onBin<O extends z.ZodObject | undefined, C extends Json | undefined>(
  bin: BinName,
  make: (model: string) => Agent<O, C>,
) {
  return {
    bin,
    make: (model: string) => {
      const agent = make(model);
      return defineAgent<O, C>({
        ...agent,
        middleware: [...(agent.middleware ?? []), compactionOn(bin)],
      });
    },
  };
}

export const agents = {
  planner: onBin("plan", planner),
  "plan-review": onBin("plan", planReviewer),
  "da-nail": onBin("implement", daNail),
  "da-hammer": onBin("implement", daHammer),
  "cl-review": onBin("review", clReview),
} satisfies Record<string, { bin: BinName; make: (model: string) => unknown }>;
