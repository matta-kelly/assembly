import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agents } from "./agents/index.ts";
import { bins, modelOf } from "./effects/models.ts";
import { compose, onBins } from "./main.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "factory-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

const issue = {
  name: "is",
  path: "/work/is.md",
  repo: "/repo",
  image: "img",
  test: "suite",
};

describe("the factory's agents", () => {
  it("each run on a bin there is, and a retry on its fallback", () => {
    for (const [name, a] of Object.entries(agents)) {
      expect(Object.keys(bins)).toContain(a.bin);
      expect(onBins().modelFor(name, true)).toBe(modelOf(a.bin, true));
    }
  });
});

describe("the factory's home", () => {
  it("holds the ledger and the run folders", () => {
    const f = compose({ home });
    f.ledger.addIssue(issue);
    expect(compose({ home }).ledger.item("is").state).toBe("open");
    expect(f.runs).toBe(join(home, "runs"));
  });
});
