/**
 * cl-review: the reviewer of the review step, green to approved. It judges the cl's change against its cut and its
 * bars, read-only, and sends each miss back to the step that made it. Its instructions are its note, cl-review.md, ported from loke's cl-review skill, cut to what
 * holds in the factory.
 */

import { defineAgent } from "que-pasa/define";
import { z } from "zod";
import { review } from "../process/review.ts";
import { resultOf } from "../process/step.ts";
import { ls, read_file, execute } from "../effects/tools/index.ts";
import { instructions } from "./instructions.ts";

export const clReview = (model: string) =>
  defineAgent({
    name: "cl-review",
    model,
    instructions: instructions("./cl-review.md", import.meta.url),
    tools: [ls, read_file, execute],
    output: z.object({ result: resultOf(review) }),
  });
