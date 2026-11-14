/** The factory's steps, one per state that has an agent, in the order an issue meets them. */

import { accept } from "./accept.ts";
import { hammer } from "./hammer.ts";
import { nail } from "./nail.ts";
import { planReview } from "./plan-review.ts";
import { plan } from "./plan.ts";
import { review } from "./review.ts";

export const steps = [plan, planReview, nail, hammer, review, accept];
