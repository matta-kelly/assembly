/**
 * planner: the agent of the plan step, an issue from open to planned. It cuts the issue into cls along seams named from the code. Its instructions are its note, planner.md. It reads the repo, read-only: no tool of its can write.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { plan } from "../../factory/stations/plan.ts";
import { resultOf } from "../../factory/line/step.ts";
import { execute, readTools } from "@mku1tra/que-pasa/sandbox";
import { instructions } from "./instructions.ts";
import { types } from "./types.ts";

export const planner = (model: string) =>
  defineAgent({
    name: "planner",
    model,
    instructions: instructions("./planner.md", import.meta.url),
    tools: [...readTools, execute],
    // what an issue, a plan and a cl note hold, and the known ways to cut a change: always in its context
    middleware: [
      types("terms", "issue", "plan", "cl", "changelist", "playbook"),
    ],
    output: z.object({ result: resultOf(plan) }),
  });
