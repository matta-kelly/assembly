import { describe, expect, it } from "vitest";
import { declared, gateOf, present, unchanged, untouched } from "./gate.ts";
import type { Run, Step } from "./step.ts";
import { fakeWorktree } from "../stations/fake-worktree.ts";

const r = {} as Run;
const whats = (problems: { what: string }[]) => problems.map((p) => p.what);

describe("a gate", () => {
  it("present: names each listed file the worktree lacks, each once, as a path from the root", async () => {
    const view = fakeWorktree({ files: ["a.test.ts"] });
    expect(
      whats(await present(["./a.test.ts", "b.test.ts", "b.test.ts"])(view)),
    ).toEqual(["b.test.ts is listed, but it is not in the worktree"]);
  });

  it("untouched: names each of the files that differs from the branch, and asks nothing when there are none", async () => {
    const view = fakeWorktree({ changed: ["a.test.ts"] });
    expect(whats(await untouched(["a.test.ts", "b.test.ts"])(view))).toEqual([
      "a.test.ts is da-nail's test, which you may not change: put it back as it was",
    ]);
    expect(await untouched([])(view)).toEqual([]);
    expect(view.asked).toEqual([["a.test.ts", "b.test.ts"]]);
  });

  it("declared: names a changed file not listed, a removed one too, and a listed file with no change", async () => {
    const view = fakeWorktree({
      touched: ["src/a.ts", "scratch.txt", "src/gone.ts"],
    });
    expect(
      whats(await declared(["src/a.ts", "src/gone.ts", "src/b.ts"])(view)),
    ).toEqual([
      "scratch.txt is changed in the worktree but not in your list: remove it if it is scratch, or list it",
      "src/b.ts is in your list but not changed: take it out of the list",
    ]);
    expect(
      await declared(["./src/a.ts", "scratch.txt", "src/gone.ts"])(view),
    ).toEqual([]);
  });

  it("unchanged: names each file changed since the attempt began", async () => {
    expect(
      whats(await unchanged(fakeWorktree({ since: ["src/a.ts"] }))),
    ).toEqual([
      "src/a.ts changed, and this step only reads: put it back as it was",
    ]);
    expect(await unchanged(fakeWorktree())).toEqual([]);
  });
});

describe("gateOf", () => {
  const own: Step<{ word: "done" }>["gate"] = () =>
    Promise.resolve([{ what: "own", cause: "invalid_output" }]);
  const step = { gate: own } as Step<{ word: "done" }>;
  const view = fakeWorktree({ since: ["src/a.ts"] });

  it("runs the step's own gate on a done, and not on a back", async () => {
    expect(whats(await gateOf(step)(r, { word: "done" }, view))).toEqual([
      "own",
    ]);
    expect(await gateOf(step)(r, { word: "back" }, view)).toEqual([]);
  });

  it("holds a step that only reads to its worktree as it began, whatever its word", async () => {
    const ro = { ...step, worktree: "ro" as const };
    expect(whats(await gateOf(ro)(r, { word: "back" }, view))).toEqual([
      "src/a.ts changed, and this step only reads: put it back as it was",
    ]);
    expect(whats(await gateOf(ro)(r, { word: "done" }, view))).toEqual([
      "src/a.ts changed, and this step only reads: put it back as it was",
      "own",
    ]);
  });
});
