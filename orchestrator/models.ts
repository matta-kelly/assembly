/**
 * The factory's model config: bins, after loke's (mkultra/loke/extensions/bins/bins.ts). A bin is a kind of work, with
 * the model that does it most of the time (default) and the one a retry runs on (fallback). Each agent names a bin,
 * never a model, so a model changes here and every agent in its bin moves with it. A bin never picks a costlier model
 * on its own. Prices are per million tokens: input / cached input / output.
 *
 * The models come from pi-ai's providers: Fireworks, whose key is FIREWORKS_API_KEY in the orchestrator's environment.
 */

import { createModels } from "@earendil-works/pi-ai";
import { fireworksProvider } from "@earendil-works/pi-ai/providers/fireworks";

export interface Slot {
  provider: string;
  /** The model id, as its provider's catalog prints it. */
  model: string;
  why: string;
}

export interface Bin {
  why: string;
  default: Slot;
  fallback: Slot;
}

export const bins = {
  plan: {
    why: "Decomposition and plan review: a wrong cut costs whole rounds",
    default: {
      provider: "fireworks",
      model: "accounts/fireworks/models/deepseek-v4p1-flash-1017",
      why: "One base everywhere. A 1M context, and a plan reads mostly cached ($0.30 / $0.006 / $1.20)",
    },
    fallback: {
      provider: "fireworks",
      model: "accounts/fireworks/models/glm-5p3",
      why: "Near the best planner here, to finish a failed attempt ($1.40 / $0.26 / $4.40)",
    },
  },
  implement: {
    why: "Tests and code inside a seam: the checks confirm the work, so value wins",
    default: {
      provider: "fireworks",
      model: "accounts/fireworks/models/deepseek-v4p1-flash-1017",
      why: "The best implementer here, and the cheapest strong one ($0.30 / $0.006 / $1.20)",
    },
    fallback: {
      provider: "fireworks",
      model: "accounts/fireworks/models/glm-5p3-flash",
      why: "Cheap and good enough to finish a failed attempt ($0.15 / $0.03 / $0.50)",
    },
  },
  review: {
    why: "Review of a cl against its cut and its bars: a missed defect costs a whole round",
    default: {
      provider: "fireworks",
      model: "accounts/fireworks/models/deepseek-v4p1-flash-1017",
      why: "Level with GLM 5.3 or ahead on the coding benchmarks, at a quarter of its output price ($0.30 / $0.006 / $1.20)",
    },
    fallback: {
      provider: "fireworks",
      model: "accounts/fireworks/models/glm-5p3",
      why: "A steady second reviewer to finish a failed attempt ($1.40 / $0.26 / $4.40)",
    },
  },
} satisfies Record<string, Bin>;

export type BinName = keyof typeof bins;

/** The model an attempt runs on, as que-pasa names it: the bin's default, or its fallback on a retry. */
export function modelOf(bin: BinName, retry: boolean): string {
  const slot = retry ? bins[bin].fallback : bins[bin].default;
  return `${slot.provider}:${slot.model}`;
}

/** The host's models: each provider a bin names, set up from pi-ai. Its key is read from the environment per request. */
export function models() {
  const m = createModels();
  m.setProvider(fireworksProvider());
  return m;
}
