/**
 * issue-review: the agent of the accept step, an issue from built to accepted. It judges whether the cls landed on main meet the issue. Its instructions are its note, issue-review.md. It reads the repo, read-only: no tool of its can write.
 */

import { defineAgent } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { accept } from "../../process/accept.ts";
import { resultOf } from "../../process/step.ts";
import { execute, readTools } from "@mku1tra/que-pasa/sandbox";
import { instructions } from "./instructions.ts";
import { types } from "./types.ts";

export const issueReviewer = (model: string) =>
  defineAgent({
    name: "issue-review",
    model,
    instructions: instructions("./issue-review.md", import.meta.url),
    tools: [...readTools, execute],
    // what an issue note holds, its Done above all, which it judges the work against: always in its context
    middleware: [types("issue")],
    output: z.object({ result: resultOf(accept) }),
  });
