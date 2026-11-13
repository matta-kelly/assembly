import { describe, expect, it } from "vitest";
import { clReview } from "./cl-review.ts";
import { daHammer } from "./da-hammer.ts";
import { daNail } from "./da-nail.ts";
import { issueReviewer } from "./issue-review.ts";
import { planReviewer } from "./plan-review.ts";
import { planner } from "./planner.ts";
import { sourceOf } from "./types.ts";

/** What an agent's memory loads for a run: each source that is there, by its path. */
async function loaded(agent: { middleware?: readonly unknown[] }) {
  const memory = agent.middleware?.[0] as {
    name: string;
    beforeAgent(run: never): Promise<Record<string, string>>;
  };
  expect(memory.name).toBe("memory");
  return memory.beforeAgent({} as never);
}

describe("an agent's types", () => {
  // memory leaves out a source that is not there, and says nothing: so each one an agent names must be a note
  it.each([
    ["da-nail", daNail, ["terms", "cl", "tests"]],
    ["da-hammer", daHammer, ["terms", "cl", "code"]],
    ["cl-review", clReview, ["terms", "code", "tests", "changelist", "cl"]],
    [
      "planner",
      planner,
      ["terms", "issue", "plan", "cl", "changelist", "playbook"],
    ],
    [
      "plan-review",
      planReviewer,
      ["terms", "issue", "plan", "cl", "changelist", "playbook"],
    ],
    ["issue-review", issueReviewer, ["terms", "issue", "plan", "cl"]],
  ] as const)(
    "%s has each of its types, whole, in this order",
    async (_name, make, names) => {
      const notes = await loaded(make("test:model"));
      expect(Object.keys(notes)).toEqual(names.map(sourceOf));
      for (const text of Object.values(notes))
        expect(text).toMatch(/^---\ntype: (doc|type)\n/);
    },
  );

  it("gives da-nail and cl-review the same text of tests", async () => {
    const nail = await loaded(daNail("test:model"));
    const review = await loaded(clReview("test:model"));
    expect(review[sourceOf("tests")]).toBe(nail[sourceOf("tests")]);
  });
});
