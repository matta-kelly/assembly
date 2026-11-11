/**
 * da-nail: the test agent of the nail step, ready to red. One cl's tests, before any code: one test per behavior, each
 * failing at its assertion. Its instructions are its note, da-nail.md, ported from loke's da-nail skill, cut to what holds in the factory.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { nail } from "../../process/nail.ts";
import { resultOf } from "../../process/step.ts";
import { fileTools } from "@mku1tra/que-pasa/sandbox";
import { test } from "../tools/test.ts";
import { instructions } from "./instructions.ts";

export const daNail = (model: string) =>
  defineAgent({
    name: "da-nail",
    model,
    instructions: instructions("./da-nail.md", import.meta.url),
    // its cl's checkout, on disk, and its tests: no shell, so a builder runs only its tests, and on the whole repo
    tools: [...fileTools, test],
    output: z.object({ result: resultOf(nail) }),
  });
