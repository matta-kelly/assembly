import { describe, expect, it } from "vitest";
import { agents } from "../agents/index.ts";
import { bins, modelOf, models } from "./models.ts";

describe("bins", () => {
  it("run an attempt on the bin's default, and a retry on its fallback", () => {
    expect(modelOf("implement", false)).toBe(
      `fireworks:${bins.implement.default.model}`,
    );
    expect(modelOf("implement", true)).toBe(
      `fireworks:${bins.implement.fallback.model}`,
    );
  });

  it("name only models the provider's catalog has", () => {
    const m = models();
    for (const bin of Object.values(bins))
      for (const slot of [bin.default, bin.fallback])
        expect(
          m.getModel(slot.provider, slot.model),
          `${slot.provider}/${slot.model}`,
        ).toBeDefined();
  });

  it("give every agent a bin there is", () => {
    for (const a of Object.values(agents))
      expect(Object.keys(bins)).toContain(a.bin);
  });
});
