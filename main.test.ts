import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agents } from "./workspace/agents/index.ts";
import { landedTags } from "./effects/git.ts";
import { bins, modelOf } from "./effects/models.ts";
import { npmRegistry } from "./effects/registry.ts";
import { gitReader } from "./effects/repo.ts";
import { compose, onBins } from "./main.ts";
import { type Loop, loop } from "./orchestrator/loop.ts";

// The loop is not opened here: what compose gives it is the subject.
vi.mock("./orchestrator/loop.ts", async (original) => ({
  ...(await original<typeof import("./orchestrator/loop.ts")>()),
  loop: vi.fn(),
}));
vi.mock("./effects/registry.ts", () => ({ npmRegistry: vi.fn() }));
vi.mock("./effects/git.ts", async (original) => ({
  ...(await original<typeof import("./effects/git.ts")>()),
  landedTags: vi.fn(),
}));

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

describe("the factory's world", () => {
  const world = () => {
    void compose({ home }).loop();
    return (vi.mocked(loop).mock.calls.at(-1)?.[0] as Loop).world;
  };

  it("gives the loop npm's registry and git's reader", () => {
    const registry = {
      url: "https://registry.npmjs.org",
      published: async () => true,
    };
    vi.mocked(npmRegistry).mockReturnValue(registry);
    expect(world().registry).toBe(registry);
    expect(world().reader).toBe(gitReader);
  });

  it("answers a landed cl's tags from the land target's, for the repo and the cl asked", async () => {
    vi.mocked(landedTags).mockImplementation(async (repo, cl) =>
      repo === "/r" && cl === "is-a" ? ["v1.0.0"] : ["lib-v2.1.0"],
    );
    expect(await world().tags("/r", "is-a")).toEqual(["v1.0.0"]);
    expect(await world().tags("/o", "is-b")).toEqual(["lib-v2.1.0"]);
    expect(landedTags).toHaveBeenCalledWith("/o", "is-b");
  });
});

describe("the factory's wait limit", () => {
  const limit = (waitLimitMs?: number) => {
    void compose({
      home,
      ...(waitLimitMs === undefined ? {} : { waitLimitMs }),
    }).loop();
    return (vi.mocked(loop).mock.calls.at(-1)?.[0] as Loop).world.limitMs;
  };

  it("is the world's limit when the factory sets one, and none when it does not", () => {
    expect(limit(90_000)).toBe(90_000);
    expect(limit(5_000)).toBe(5_000);
    expect(limit()).toBeUndefined();
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
