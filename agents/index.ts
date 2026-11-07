/**
 * The factory's agents, by name, as the steps name them: each one's bin, and how to make it on a model.
 */

import type { BinName } from "../effects/models.ts";
import { clReview } from "./cl-review.ts";
import { daHammer } from "./da-hammer.ts";
import { daNail } from "./da-nail.ts";
import { issueReviewer } from "./issue-review.ts";
import { planReviewer } from "./plan-review.ts";
import { planner } from "./planner.ts";

export const agents = {
  planner: { bin: "plan", make: planner },
  "plan-review": { bin: "plan", make: planReviewer },
  "issue-review": { bin: "review", make: issueReviewer },
  "da-nail": { bin: "implement", make: daNail },
  "da-hammer": { bin: "implement", make: daHammer },
  "cl-review": { bin: "review", make: clReview },
} satisfies Record<string, { bin: BinName; make: (model: string) => unknown }>;
