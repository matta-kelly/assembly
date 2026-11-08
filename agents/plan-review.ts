/**
 * plan-review: the agent of the plan review step, an issue from planned to building. It judges whether the plan's cuts meet the issue. Its instructions are its note, plan-review.md. It reads the repo, read-only: no tool of its can write.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { planReview } from "../process/plan-review.ts";
import { resultOf } from "../process/step.ts";
import { execute, readTools } from "@mku1tra/que-pasa/sandbox";
import { instructions } from "./instructions.ts";

export const planReviewer = (model: string) =>
  defineAgent({
    name: "plan-review",
    model,
    instructions: instructions("./plan-review.md", import.meta.url),
    tools: [...readTools, execute],
    output: z.object({ result: resultOf(planReview) }),
  });
