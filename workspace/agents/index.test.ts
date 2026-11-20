import { describe, expect, it, vi } from "vitest";
import { bins } from "../../factory/runs/models.ts";
import { keep } from "./compaction.ts";
import { agents } from "./index.ts";

describe("the agents", () => {
  it.each(Object.entries(agents))(
    "%s compacts past its bin's limit, with the default of what its summary keeps, after its own middleware",
    async (name, { bin, make }) => {
      const agent = make("fireworks:m");
      const middleware = agent.middleware ?? [];
      expect(middleware.length, name).toBeGreaterThan(1);
      const last = middleware.at(-1);
      expect(last?.name).toBe("compaction");
      const limit = bins[bin].compactAt;
      const compact = vi.fn(async () => {});
      const api = { compacting: false, compact };
      await last?.afterModel?.({ contextTokens: limit }, api);
      expect(compact).not.toHaveBeenCalled();
      await last?.afterModel?.({ contextTokens: limit + 1 }, api);
      expect(compact).toHaveBeenCalledExactlyOnceWith(keep);
    },
  );
});
