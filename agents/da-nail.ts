/**
 * da-nail: the test agent of the nail step, ready to red. One cl's tests, before any code: one test per behavior, each
 * failing at its assertion. Its instructions are its note, da-nail.md, ported from loke's da-nail skill, cut to what holds in the factory.
 */

import { defineAgent } from "que-pasa/define";
import { z } from "zod";
import { nail } from "../process/nail.ts";
import { resultOf } from "../process/step.ts";
import {
  edit_file,
  glob,
  grep,
  ls,
  read_file,
  test,
  write_file,
} from "../effects/tools/index.ts";
import { instructions } from "./instructions.ts";

export const daNail = (model: string) =>
  defineAgent({
    name: "da-nail",
    model,
    instructions: instructions("./da-nail.md", import.meta.url),
    // its cut's files only, and its tests: no shell, which would reach any file
    tools: [ls, read_file, write_file, edit_file, glob, grep, test],
    output: z.object({ result: resultOf(nail) }),
  });
