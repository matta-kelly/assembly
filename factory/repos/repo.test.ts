/**
 * A repo's settings, as an attempt reads them from its worktree: its full suite, when it is on crate. How it runs is
 * crate's (factory/runs/workspace.ts), so reading them calls nothing.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fullSuite, NotOnCrate, settingsAt } from "./repo.ts";

let home: string;
beforeEach(() => (home = mkdtempSync(join(tmpdir(), "repo-"))));
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A worktree of a repo on crate: its crate.toml and its full suite. */
function worktree() {
  const at = join(home, "work");
  mkdirSync(join(at, "scripts"), { recursive: true });
  writeFileSync(join(at, "crate.toml"), `crate = "3"\nimage = "dev"\n`);
  writeFileSync(join(at, "scripts", "check.sh"), "#!/bin/sh\n");
  return at;
}

describe("a repo's settings", () => {
  it("are its full suite, when its worktree is on crate", async () => {
    expect(await settingsAt(worktree(), "repo")).toEqual({ test: fullSuite });
  });

  it("refuse a worktree that is not on crate: no crate.toml, or no full suite", async () => {
    const at = worktree();
    rmSync(join(at, "scripts", "check.sh"));
    await expect(settingsAt(at, "repo")).rejects.toThrow(
      /repo has no scripts\/check\.sh/,
    );
    rmSync(join(at, "crate.toml"));
    await expect(settingsAt(at, "repo")).rejects.toBeInstanceOf(NotOnCrate);
  });
});
