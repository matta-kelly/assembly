/**
 * da-nail: the test agent of the nail step, ready to red. One cl's tests, before any code: each promise tested, each
 * failing at its assertion. Its instructions are its note, da-nail.md, ported from loke's da-nail skill, cut to what holds in the factory.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { nail } from "../../factory/stations/nail.ts";
import { submitOf } from "./submit.ts";
import { execute, fileTools } from "@mku1tra/que-pasa/sandbox";
import { remove } from "../tools/remove.ts";
import { test } from "../tools/test.ts";
import { instructions } from "./instructions.ts";
import { types } from "./types.ts";

export const daNail = (model: string) =>
  defineAgent({
    name: "da-nail",
    model,
    instructions: instructions("./da-nail.md", import.meta.url),
    // the cl's worktree, whole (add, edit, remove), its tests, and a shell in its sandbox for the work around them
    // (a formatter, a build). The verdict is the test tool's and the step's check, never a command the agent ran
    tools: [...fileTools, remove, test, execute],
    // what a test is, and what a good one is: always in its context
    middleware: [types("terms", "bench", "cl", "tests")],
    output: z.object({ result: submitOf(nail) }),
  });
