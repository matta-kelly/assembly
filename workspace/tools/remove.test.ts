import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Run } from "../../factory/line/step.ts";
import { type Context, keep } from "../../factory/runs/runs.ts";
import { inWork, remove } from "./remove.ts";

const work = mkdtempSync(join(tmpdir(), "remove-tool-"));
const run = { name: "is-b", n: 2, work } as Run;
const context: Context = {
  item: "is-b",
  agent: "da-nail",
  folder: join(mkdtempSync(join(tmpdir(), "remove-tool-")), "cl", "b"),
  readOnly: false,
};
// the conversation's attempt going on, as the runner writes it before the run
keep(context, run);

/** Calls `remove` as que-pasa does. */
const called = (path: string) =>
  (remove.run as (i: unknown, r: unknown) => Promise<string>)(
    remove.schema.parse({ path }),
    { context, use: vi.fn() },
  );

describe("remove", () => {
  it("removes a file of the worktree, named under /work or from the repo's root", async () => {
    mkdirSync(join(work, "scripts"), { recursive: true });
    writeFileSync(join(work, "scripts", ".a.tmp"), "x");
    writeFileSync(join(work, "scripts", ".b.tmp"), "");
    expect(await called("/work/scripts/.a.tmp")).toBe(
      "Removed /work/scripts/.a.tmp",
    );
    expect(await called("scripts/.b.tmp")).toBe("Removed scripts/.b.tmp");
    expect(existsSync(join(work, "scripts", ".a.tmp"))).toBe(false);
    expect(existsSync(join(work, "scripts", ".b.tmp"))).toBe(false);
  });

  it("removes a link, never what it points at", async () => {
    const outside = join(mkdtempSync(join(tmpdir(), "remove-tool-")), "kept");
    writeFileSync(outside, "kept");
    symlinkSync(outside, join(work, "link"));
    expect(await called("link")).toBe("Removed link");
    expect(existsSync(outside)).toBe(true);
  });

  it("refuses a folder, a missing file, and anything outside the worktree or in git's own", async () => {
    mkdirSync(join(work, "src"), { recursive: true });
    expect(await called("/work/src")).toMatch(/is a folder/);
    expect(await called("gone.txt")).toMatch(/no file gone.txt/);
    expect(await called("/etc/passwd")).toMatch(/not a file in \/work/);
    expect(await called("../x")).toMatch(/not a file in \/work/);
    expect(await called("/work/../x")).toMatch(/not a file in \/work/);
    expect(await called("/work")).toMatch(/not a file in \/work/);
    expect(await called(".git/config")).toMatch(/not a file in \/work/);
  });
});

describe("inWork", () => {
  it("gives the path from the repo's root", () => {
    expect(inWork("/work/a/b.ts")).toBe("a/b.ts");
    expect(inWork("a/./b.ts")).toBe("a/b.ts");
    expect(inWork("/workshop/a")).toBeUndefined();
  });
});
