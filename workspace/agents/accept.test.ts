import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Run } from "../../factory/line/step.ts";
import { type Context, keep } from "../../factory/runs/runs.ts";
import { fakeWorktree } from "../../factory/stations/fake-worktree.ts";
import { viewOf } from "../../factory/repos/git.ts";
import { hammer } from "../../factory/stations/hammer.ts";
import { review } from "../../factory/stations/review.ts";
import { acceptOf } from "./submit.ts";

vi.mock("../../factory/repos/git.ts", () => ({ viewOf: vi.fn() }));

const run = { name: "c", n: 1, tests: ["a.test.ts"] } as Run;
const context: Context = {
  item: "c",
  agent: "da-hammer",
  folder: mkdtempSync(join(tmpdir(), "accept-")),
  readOnly: false,
};
keep(context, run);

describe("an agent's accept at submit", () => {
  it("answers a done with what its step's gate finds, on the attempt going on", async () => {
    vi.mocked(viewOf).mockReturnValue(
      fakeWorktree({ touched: ["src/a.ts", "zz_probe_test.go"] }),
    );
    expect(
      await acceptOf(hammer)(
        { result: { word: "done", changed: ["src/a.ts"] } as never },
        { context },
      ),
    ).toEqual([
      "zz_probe_test.go is changed in the worktree but not in your list: remove it if it is scratch, or list it",
    ]);
    expect(viewOf).toHaveBeenCalledWith(expect.objectContaining({ name: "c" }));
  });

  it("takes a back from a step that edits as it is", async () => {
    vi.mocked(viewOf).mockReturnValue(fakeWorktree({ touched: ["x.ts"] }));
    expect(
      await acceptOf(hammer)({ result: { word: "back" } }, { context }),
    ).toEqual([]);
  });

  it("holds a step that only reads to its worktree as it began, on a back too", async () => {
    vi.mocked(viewOf).mockReturnValue(fakeWorktree({ since: ["src/a.ts"] }));
    expect(
      await acceptOf(review)({ result: { word: "back" } }, { context }),
    ).toEqual([
      "src/a.ts changed, and this step only reads: put it back as it was",
    ]);
  });
});
