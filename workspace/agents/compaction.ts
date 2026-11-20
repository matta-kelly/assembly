/**
 * An agent's compaction: past its bin's limit (`compactAt`, factory/runs/models.ts), after a model response, que-pasa's
 * compaction summarizes the older part of its conversation and keeps the recent part. Every agent has it, from its bin
 * (index.ts), and the operator's `factory compact` asks for the same summary by hand.
 */

import { compaction } from "@mku1tra/que-pasa/middleware";
import { type BinName, bins } from "../../factory/runs/models.ts";

/** What a compaction's summary keeps, and what it drops: the one default for every agent, and for a compaction by hand. */
export const keep = `Keep:
- the spec: the item's note, and what it asks for
- each finding that is still open: what it is about, where, and what meets it
- what is built and committed: each file changed, and what it does now
- what was tried and failed, and why it failed
- the next step
Drop the output of a tool call that was already acted on: keep what it showed, not the output.`;

/** The compaction of an agent on `bin`: at the bin's limit, with the default of what its summary keeps. */
export const compactionOn = (bin: BinName) =>
  compaction({ trigger: { tokens: bins[bin].compactAt }, instructions: keep });
