/**
 * The real model path, once per model the bins name: a small que-pasa agent on it must call submit with a checked
 * result. Proves the key, the model ids, and structured output on a real model, for a fraction of a cent. Run by
 * `just smoke-model`, in the orchestrator's image, with FIREWORKS_API_KEY from the vault.
 */

import { MemoryStorage } from "@earendil-works/pi-durable";
import { defineAgent } from "@mku1tra/que-pasa/define";
import { openRuntime } from "@mku1tra/que-pasa/loop";
import { z } from "zod";
import { bins, models } from "../factory/runs/models.ts";
import { total } from "../factory/runs/runner.ts";

const m = models();
let failed = 0;
const slots = Object.entries(bins).flatMap(
  ([bin, b]) =>
    [
      [`${bin} default`, b.default],
      [`${bin} fallback`, b.fallback],
    ] as const,
);
const seen = new Set<string>();
const agent = defineAgent({
  name: "smoke",
  model: `${bins.plan.default.provider}:${bins.plan.default.model}`,
  instructions:
    "You check that tools work. Call submit once, with sum set to 2 + 3.",
  tools: [],
  output: z.object({ sum: z.number() }),
});
// Nothing to keep: each smoke run is one call, so the runs live in memory.
const runtime = await openRuntime({
  storage: new MemoryStorage(),
  models: m,
  agents: [agent],
});

for (const [label, slot] of slots) {
  const model = `${slot.provider}:${slot.model}`;
  if (seen.has(model)) continue;
  seen.add(model);
  let usage = { tokens: 0, cost: 0 } as { tokens?: number; cost?: number };
  try {
    const out = await runtime.run(agent, "Go.", {
      conversation: `smoke ${model}`,
      runId: "1",
      caller: { id: "smoke" },
      model,
      signal: AbortSignal.timeout(120_000),
      onUsage: (u) => (usage = total(u)),
    });
    const ok = out.sum === 5;
    if (!ok) failed++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${label}: ${slot.model}: sum ${out.sum}, ${usage.tokens} tokens, $${usage.cost?.toFixed(5)}`,
    );
  } catch (e) {
    failed++;
    console.log(
      `FAIL ${label}: ${slot.model}: ${(e as Error).message.slice(0, 300)}`,
    );
  }
}
await runtime.close();
process.exit(failed ? 1 : 0);
