/**
 * da-hammer: the dev agent of the hammer step, red to green. The least code that makes da-nail's tests pass, then a
 * refactor on green. It never changes a test. Its instructions are its note, da-hammer.md, ported from loke's da-hammer skill, cut to what holds in the factory.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { hammer } from "../../factory/stations/hammer.ts";
import { submitOf } from "./submit.ts";
import { execute, fileTools } from "@mku1tra/que-pasa/sandbox";
import { instructions } from "./instructions.ts";
import { types } from "./types.ts";

export const daHammer = (model: string) =>
  defineAgent({
    name: "da-hammer",
    model,
    instructions: instructions("./da-hammer.md", import.meta.url),
    // the cl's worktree, whole, and a shell in its workspace, where the check runs too: to run tests, format, remove a
    // file. The verdict is the step's check, never a command the agent ran
    tools: [...fileTools, execute],
    // how code is written here, and what a good test is, so it can tell a wrong test: always in its context
    middleware: [types("terms", "bench", "cl", "code", "tests")],
    output: z.object({ result: submitOf(hammer) }),
  });
