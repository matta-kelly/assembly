/**
 * da-nail: the test agent of the nail step, ready to red. One cl's tests, before any code: each promise tested, each
 * failing at its assertion. Its instructions are its note, da-nail.md, ported from loke's da-nail skill, cut to what holds in the factory.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { nail } from "../../process/nail.ts";
import { resultOf } from "../../process/step.ts";
import { fileTools } from "@mku1tra/que-pasa/sandbox";
import { test } from "../tools/test.ts";
import { instructions } from "./instructions.ts";
import { types } from "./types.ts";

export const daNail = (model: string) =>
  defineAgent({
    name: "da-nail",
    model,
    instructions: instructions("./da-nail.md", import.meta.url),
    // the cl's worktree, and its tests: no shell, so a builder runs only its tests
    tools: [...fileTools, test],
    // what a test is, and what a good one is: always in its context
    middleware: [types("terms", "cl", "tests")],
    output: z.object({ result: resultOf(nail) }),
  });
