/**
 * planner: the agent of the plan step, an issue from open to planned. It cuts the issue into cls along seams named from the code. Its instructions are its note, planner.md. It reads the repo, read-only: no tool of its can write.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { plan } from "../process/plan.ts";
import { resultOf } from "../process/step.ts";
import { execute, ls, read_file } from "../effects/tools/index.ts";
import { instructions } from "./instructions.ts";

export const planner = (model: string) =>
  defineAgent({
    name: "planner",
    model,
    instructions: instructions("./planner.md", import.meta.url),
    tools: [ls, read_file, execute],
    output: z.object({ result: resultOf(plan) }),
  });
