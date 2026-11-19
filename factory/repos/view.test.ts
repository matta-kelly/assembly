import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Tree } from "../line/step.ts";
import { viewOf } from "./git.ts";

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "view-"));
  mkdirSync(join(work, "src"));
  writeFileSync(join(work, "src", "a.ts"), "");
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

describe("the view a gate reads", () => {
  it("holds a file of the worktree, and never a path that leaves it", () => {
    const view = viewOf({ work } as Tree);
    expect(
      view.exists(["src/a.ts", "../log", "/etc/passwd", "src/b.ts"]),
    ).toEqual(["src/a.ts"]);
  });
});
