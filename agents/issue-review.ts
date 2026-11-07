/**
 * issue-review: the agent of the accept step, an issue from built to accepted. It judges whether the merged cls meet the issue. Its instructions are its note, issue-review.md. It reads the repo, read-only: no tool of its can write.
 */

import { defineAgent } from "que-pasa/define";
import { z } from "zod";
import { accept } from "../process/accept.ts";
import { resultOf } from "../process/step.ts";
import { execute, ls, read_file } from "../tools/index.ts";
import { instructions } from "./instructions.ts";

export const issueReviewer = (model: string) =>
  defineAgent({
    name: "issue-review",
    model,
    instructions: instructions("./issue-review.md", import.meta.url),
    tools: [ls, read_file, execute],
    output: z.object({ result: resultOf(accept) }),
  });
