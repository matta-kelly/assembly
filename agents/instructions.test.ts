import { describe, expect, it } from "vitest";
import { instructions } from "./instructions.ts";

describe("instructions", () => {
  for (const name of [
    "planner",
    "plan-review",
    "da-nail",
    "da-hammer",
    "cl-review",
    "issue-review",
  ]) {
    it(`gives the model ${name}'s one line and sections, without the frontmatter or the leading links`, () => {
      const text = instructions(`./${name}.md`, import.meta.url);
      expect(text).toMatch(new RegExp(`^You are (the )?${name}:`));
      expect(text).toMatch(/^## /m);
      expect(text).not.toMatch(/^type: /m);
      expect(text).not.toContain("[[#Role]]");
    });
  }
});
