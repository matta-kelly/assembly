import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Run } from "../process/step.ts";
import { forgetSetup, needsSetup, runSetup } from "./setup.ts";
import { touched } from "./git.ts";
import { sh } from "./sh.ts";

vi.mock("./sh.ts", () => ({ sh: vi.fn() }));
vi.mock("./git.ts", () => ({ touched: vi.fn() }));

/** The `podman run` of the setup, past the remove that comes before it. */
const runArgs = () =>
  vi.mocked(sh).mock.calls.find((c) => c[1][0] === "run")?.[1] ?? [];

let r: Run;
beforeEach(() => {
  vi.resetAllMocks();
  const dir = mkdtempSync(join(tmpdir(), "setup-"));
  r = {
    name: "is-a",
    n: 1,
    dir,
    work: join(dir, "work"),
    image: "ghcr.io/x/repo-dev:main",
    setup: "npm ci --offline",
  } as Run;
});
afterEach(() => rmSync(r.dir, { recursive: true, force: true }));

describe("an attempt's setup", () => {
  it("runs the setup in a container of its own, offline, on the worktree, and marks it done", async () => {
    vi.mocked(sh).mockResolvedValue({ code: 0, out: "", stdout: "" });
    vi.mocked(touched).mockResolvedValue([]);
    expect(needsSetup(r)).toBe(true);
    await runSetup(r);
    const args = runArgs();
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(args).toContain("none");
    expect(args).toContain(`${r.work}:/work`);
    expect(args.slice(-4)).toEqual([r.image, "sh", "-c", "npm ci --offline"]);
    expect(needsSetup(r)).toBe(false);
  });

  it("needs none when the issue has no setup", () => {
    expect(needsSetup({ ...r, setup: "" })).toBe(false);
  });

  it("throws with the tail of its output when it fails, and marks nothing", async () => {
    vi.mocked(sh).mockResolvedValue({
      code: 1,
      out: "npm ERR! oops",
      stdout: "",
    });
    await expect(runSetup(r)).rejects.toThrow(/^exit 1: npm ERR! oops$/);
    expect(existsSync(join(r.dir, "setup.done"))).toBe(false);
    expect(needsSetup(r)).toBe(true);
  });

  it("names an image older than the lockfile when the cache lacks a package", async () => {
    vi.mocked(sh).mockResolvedValue({
      code: 1,
      out: "npm error code ENOTCACHED\nnpm error request to https://registry.npmjs.org/zod failed: cache mode is 'only-if-cached'",
      stdout: "",
    });
    await expect(runSetup(r)).rejects.toThrow(
      /^ghcr\.io\/x\/repo-dev:main's cache lacks a package of this lockfile: the image is older than it\. exit 1:/,
    );
  });

  it("removes a setup container an abort left running, before it runs, and after an abort", async () => {
    vi.mocked(sh).mockImplementation(async (_c, args) => {
      if (args[0] === "run") throw new Error("aborted");
      return { code: 0, out: "", stdout: "" };
    });
    await expect(runSetup(r)).rejects.toThrow("aborted");
    const removes = vi
      .mocked(sh)
      .mock.calls.filter((c) => c[1][0] === "rm")
      .map((c) => c[1].at(-1));
    expect(removes).toEqual([
      `assembly-${r.name}-${r.n}-setup`,
      `assembly-${r.name}-${r.n}-setup`,
    ]);
    expect(runArgs()).toContain(`assembly-${r.name}-${r.n}-setup`);
  });

  it("fails a setup that leaves files git does not ignore, and marks nothing", async () => {
    vi.mocked(sh).mockResolvedValue({ code: 0, out: "", stdout: "" });
    vi.mocked(touched).mockResolvedValue(["node_modules/a/index.js"]);
    await expect(runSetup(r)).rejects.toThrow(
      /left files git does not ignore.*: node_modules\/a\/index\.js$/,
    );
    expect(needsSetup(r)).toBe(true);
  });

  it("is forgotten when its worktree is made again", async () => {
    vi.mocked(sh).mockResolvedValue({ code: 0, out: "", stdout: "" });
    vi.mocked(touched).mockResolvedValue([]);
    await runSetup(r);
    forgetSetup(r);
    expect(needsSetup(r)).toBe(true);
  });
});
