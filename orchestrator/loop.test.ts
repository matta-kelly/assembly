import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Step, Verdict } from "../process/step.ts";
import { open, type Ledger } from "./ledger.ts";
import { loop, writeSection } from "./loop.ts";
import { collect, commit, runOf, start, status } from "./start.ts";

// Podman and git are faked: start, status, collect and commit are the loop's only ways out. runOf is the real one.
vi.mock("./start.ts", async (actual) => ({
  ...(await actual<typeof import("./start.ts")>()),
  start: vi.fn(),
  status: vi.fn(),
  collect: vi.fn(),
  commit: vi.fn(),
}));

const cl = "## Check\n\n- b1\n\n## Tests\n\nold\n\n## Code\n\nkeep\n";

let dir: string;
let ledger: Ledger;
let verdict: Verdict;
const step: Step<{ word: "done"; text: string }> = {
  from: "ready",
  agent: "fake",
  done: z.object({ word: z.literal("done"), text: z.string() }),
  section: "Tests",
  render: (d) => d.text,
  check: async () => verdict,
};
const agents = { fake: { name: "fake", command: "true" } };
const make = () =>
  loop({ ledger, steps: [step], agents, runs: join(dir, "runs") });

beforeEach(() => {
  vi.resetAllMocks();
  dir = mkdtempSync(join(tmpdir(), "loop-"));
  writeFileSync(join(dir, "cl.md"), cl);
  ledger = open(join(dir, "ledger.db"));
  ledger.add({
    cl: "c",
    path: join(dir, "cl.md"),
    repo: "/repo",
    image: "img",
    test: "t",
  });
  verdict = { word: "pass", reason: "red at an assertion" };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Starts attempt 1, and leaves `result` in its out/ with its container exited. */
async function attempt(result?: unknown) {
  const l = make();
  await l.tick();
  const r = runOf(ledger.item("c"), 1, join(dir, "runs"));
  mkdirSync(r.out, { recursive: true });
  if (result !== undefined)
    writeFileSync(
      join(r.out, "result.json"),
      typeof result === "string" ? result : JSON.stringify(result),
    );
  vi.mocked(status).mockResolvedValue({ status: "exited", code: 0 });
  return l;
}

const settled = (state: string) =>
  vi.waitFor(() => expect(ledger.item("c").state).toBe(state));
const lastReason = () =>
  (ledger.events("c").at(-1) as { reason: string }).reason;
const doc = () => readFileSync(join(dir, "cl.md"), "utf8");

describe("tick", () => {
  it("starts an attempt for a ready cl, and returns without waiting for it", async () => {
    await make().tick();
    expect(start).toHaveBeenCalledOnce();
    expect(ledger.open()).toEqual([{ cl: "c", n: 1, step: "ready" }]);
  });

  it("leaves a running attempt alone", async () => {
    const l = await attempt({ word: "done", text: "t" });
    vi.mocked(status).mockResolvedValue({ status: "running", code: 0 });
    await l.tick();
    expect(ledger.open()).toHaveLength(1);
    expect(ledger.item("c").state).toBe("ready");
  });

  it("moves a passed done result to red, writes its section and commits", async () => {
    const l = await attempt({ word: "done", text: "- b1: a.test.ts" });
    await l.tick();
    await settled("red");
    await vi.waitFor(() => expect(collect).toHaveBeenCalledOnce());
    expect(commit).toHaveBeenCalledOnce();
    expect(doc()).toContain("## Tests\n\n- b1: a.test.ts\n\n## Code\n\nkeep\n");
  });

  it("keeps the cl ready when the check retries, and writes nothing", async () => {
    verdict = { word: "retry", reason: "behavior 1 has no test" };
    const l = await attempt({ word: "done", text: "x" });
    await l.tick();
    await vi.waitFor(() => expect(ledger.open()).toHaveLength(0));
    expect(ledger.item("c").state).toBe("ready");
    expect(lastReason()).toBe("behavior 1 has no test");
    expect(doc()).toBe(cl);
  });

  it("moves a raise to raised, and writes the Raise section", async () => {
    const l = await attempt({
      word: "raise",
      from: "da-nail, tests",
      missing: "the seam",
      evidence: "Seam is empty",
    });
    await l.tick();
    await settled("raised");
    expect(doc()).toContain(
      "## Raise\n\n- from: da-nail, tests\n- missing: the seam\n- evidence: Seam is empty\n",
    );
  });

  it("retries an attempt with no result.json", async () => {
    const l = await attempt();
    await l.tick();
    await vi.waitFor(() => expect(lastReason()).toBe("no out/result.json"));
    expect(ledger.item("c").state).toBe("ready");
  });

  it("retries a result.json that is not a result of the step", async () => {
    const l = await attempt({ word: "done" });
    await l.tick();
    await vi.waitFor(() =>
      expect(lastReason()).toMatch(/is not a ready result/),
    );
  });

  it("retries an attempt whose container is gone, and has nothing to collect", async () => {
    const l = await attempt({ word: "done", text: "x" });
    vi.mocked(status).mockResolvedValue(null);
    await l.tick();
    await vi.waitFor(() => expect(lastReason()).toBe("the container is gone"));
    expect(collect).not.toHaveBeenCalled();
  });

  it("finishes an attempt a killed loop left open", async () => {
    await attempt({ word: "done", text: "t" });
    ledger = open(join(dir, "ledger.db"));
    await make().tick();
    await settled("red");
  });
});

describe("a review's send-back", () => {
  it("writes the Review section, commits, and moves the cl back", async () => {
    const sendBack: Step<{ word: "done"; text: string }> = {
      ...step,
      from: "green",
      section: "Review",
      check: async () => ({ word: "to-code", reason: "back to code" }),
    };
    ledger.add(
      {
        cl: "g",
        path: join(dir, "cl.md"),
        repo: "/repo",
        image: "img",
        test: "t",
      },
      "green",
    );
    const l = loop({
      ledger,
      steps: [sendBack],
      agents,
      runs: join(dir, "runs"),
    });
    await l.tick();
    const r = runOf(ledger.item("g"), 1, join(dir, "runs"));
    mkdirSync(r.out, { recursive: true });
    writeFileSync(
      join(r.out, "result.json"),
      JSON.stringify({ word: "done", text: "- finding: b1 edge" }),
    );
    vi.mocked(status).mockResolvedValue({ status: "exited", code: 0 });
    await l.tick();
    await vi.waitFor(() => expect(ledger.item("g").state).toBe("red"));
    expect(ledger.rounds("g")).toBe(1);
    expect(commit).toHaveBeenCalledOnce();
    expect(doc()).toContain("## Review\n\n- finding: b1 edge\n");
  });
});

describe("writeSection", () => {
  const file = () => join(dir, "cl.md");

  it("replaces one section and leaves the others", () => {
    writeSection(file(), "Tests", "new");
    expect(doc()).toBe(
      "## Check\n\n- b1\n\n## Tests\n\nnew\n\n## Code\n\nkeep\n",
    );
  });

  it("replaces the last section", () => {
    writeSection(file(), "Code", "changed");
    expect(doc()).toBe(
      "## Check\n\n- b1\n\n## Tests\n\nold\n\n## Code\n\nchanged\n",
    );
  });

  it("adds a section the cl does not have, at the end", () => {
    writeSection(file(), "Raise", "r");
    expect(doc()).toBe(`${cl}\n## Raise\n\nr\n`);
  });
});
