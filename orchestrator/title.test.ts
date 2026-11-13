import { describe, expect, it } from "vitest";
import { titleOf, typeOf } from "./title.ts";

const issue = (kind?: string) =>
  `---\ntype: issue\n${kind ? `kind: ${kind}\n` : ""}status: new\n---\nAn issue.\n`;
const cl = (description?: string) =>
  `---\ntype: cl\n${description === undefined ? "" : `description: "${description}"\n`}status: new\n---\nA cl.\n`;

describe("a commit's title", () => {
  it.each([
    ["bug", "fix"],
    ["vulnerability", "fix"],
    ["feature", "feat"],
    ["feature-request", "feat"],
    ["project", "feat"],
    ["epic", "feat"],
    ["milestone", "feat"],
    ["story", "feat"],
    ["internal-cleanup", "refactor"],
    ["task", "chore"],
    ["", "feat"],
  ])("an issue of kind %j lands its code as %s", (kind, type) => {
    expect(typeOf(kind)).toBe(type);
  });

  it("titles the tests commit test, whatever the issue's kind, so it asks no version", () => {
    expect(
      titleOf(
        "da-nail",
        "fx-show",
        issue("bug"),
        cl("Status shows the version. Read when."),
      ),
    ).toBe("test(fx-show): Status shows the version");
  });

  it("titles the code commit by the issue's kind, with the cl's description, its first sentence", () => {
    expect(
      titleOf(
        "da-hammer",
        "fx-show",
        issue("feature"),
        cl("Status shows the version. Read when."),
      ),
    ).toBe("feat(fx-show): Status shows the version");
    expect(titleOf("da-hammer", "fx-show", issue("bug"), cl("Fixes it."))).toBe(
      "fix(fx-show): Fixes it",
    );
  });

  it("names the cl when its note has no description, and cuts a long one at 72 characters", () => {
    expect(titleOf("da-hammer", "fx-show", issue(), cl())).toBe(
      "feat(fx-show): fx-show",
    );
    const long = "a".repeat(100);
    const title = titleOf("da-hammer", "fx-show", issue("feature"), cl(long));
    expect(title).toBe(`feat(fx-show): ${"a".repeat(71)}…`);
  });
});
