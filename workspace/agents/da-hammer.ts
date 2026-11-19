/**
 * da-hammer: the dev agent of the hammer step, red to green. The least code that makes da-nail's tests pass, then a
 * refactor on green. It never changes a test. Its instructions are its note, da-hammer.md, ported from loke's da-hammer skill, cut to what holds in the factory.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { hammer } from "../../factory/stations/hammer.ts";
import { submitOf } from "./submit.ts";
import { execute, fileTools } from "@mku1tra/que-pasa/sandbox";
import { remove } from "../tools/remove.ts";
import { test } from "../tools/test.ts";
import { instructions } from "./instructions.ts";
import { types } from "./types.ts";

export const daHammer = (model: string) =>
  defineAgent({
    name: "da-hammer",
    model,
    instructions: instructions("./da-hammer.md", import.meta.url),
    // the cl's worktree, whole (add, edit, remove), its tests, and a shell in its sandbox for the work around them
    // (a formatter, a build). The verdict is the test tool's and the step's check, never a command the agent ran
    tools: [...fileTools, remove, test, execute],
    // how code is written here, and what a good test is, so it can tell a wrong test: always in its context
    middleware: [types("terms", "bench", "cl", "code", "tests")],
    output: z.object({ result: submitOf(hammer) }),
  });
