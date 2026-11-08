/**
 * da-hammer: the dev agent of the hammer step, red to green. The least code that makes da-nail's tests pass, then a
 * refactor on green. It never changes a test. Its instructions are its note, da-hammer.md, ported from loke's da-hammer skill, cut to what holds in the factory.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { hammer } from "../process/hammer.ts";
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

export const daHammer = (model: string) =>
  defineAgent({
    name: "da-hammer",
    model,
    instructions: instructions("./da-hammer.md", import.meta.url),
    // its cut's files only, and its tests: no shell, which would reach any file
    tools: [ls, read_file, write_file, edit_file, glob, grep, test],
    output: z.object({ result: resultOf(hammer) }),
  });
