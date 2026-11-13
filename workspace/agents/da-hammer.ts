/**
 * da-hammer: the dev agent of the hammer step, red to green. The least code that makes da-nail's tests pass, then a
 * refactor on green. It never changes a test. Its instructions are its note, da-hammer.md, ported from loke's da-hammer skill, cut to what holds in the factory.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { hammer } from "../../process/hammer.ts";
import { resultOf } from "../../process/step.ts";
import { fileTools } from "@mku1tra/que-pasa/sandbox";
import { test } from "../tools/test.ts";
import { instructions } from "./instructions.ts";
import { types } from "./types.ts";

export const daHammer = (model: string) =>
  defineAgent({
    name: "da-hammer",
    model,
    instructions: instructions("./da-hammer.md", import.meta.url),
    // its cl's checkout, on disk, and its tests: no shell, so a builder runs only its tests, and on the whole repo
    tools: [...fileTools, test],
    // how code is written here: always in its context
    middleware: [types("terms", "cl", "code")],
    output: z.object({ result: resultOf(hammer) }),
  });
