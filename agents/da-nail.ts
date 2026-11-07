/**
 * da-nail: the test agent of the nail step, ready to red. One cl's tests, before any code: one test per behavior, each
 * failing at its assertion. Its instructions are its note, da-nail.md, ported from loke's da-nail skill, cut to what holds in the factory.
 */

import { defineAgent } from "que-pasa/define";
import { z } from "zod";
import { nail } from "../process/nail.ts";
import { resultOf } from "../process/step.ts";
import {
  ls,
  read_file,
  write_file,
  edit_file,
  execute,
} from "../tools/index.ts";
import { instructions } from "./instructions.ts";

export const daNail = (model: string) =>
  defineAgent({
    name: "da-nail",
    model,
    instructions: instructions("./da-nail.md", import.meta.url),
    tools: [ls, read_file, write_file, edit_file, execute],
    output: z.object({ result: resultOf(nail) }),
  });
