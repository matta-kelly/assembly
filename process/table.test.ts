import { describe, expect, it } from "vitest";
import { next, retryLimit, reviewRounds, top } from "./table.ts";

const once = { attempts: 1, rounds: 0 };

describe("next", () => {
  it("moves an issue along on pass: open to planned, planned to building, built to accepted", () => {
    expect(next("open", "issue", "pass", [], once)).toBe("planned");
    expect(next("planned", "issue", "pass", [], once)).toBe("building");
    expect(next("built", "issue", "pass", [], once)).toBe("accepted");
  });

  it("moves a cl along on pass: ready to red, red to green, green to approved", () => {
    expect(next("ready", "cl", "pass", [], once)).toBe("red");
    expect(next("red", "cl", "pass", [], once)).toBe("green");
    expect(next("green", "cl", "pass", [], once)).toBe("approved");
  });

  it("keeps an item in its state on retry, until the retry limit escalates it", () => {
    expect(
      next("open", "issue", "retry", [], {
        attempts: retryLimit - 1,
        rounds: 0,
      }),
    ).toBe("open");
    expect(
      next("red", "cl", "retry", [], { attempts: retryLimit, rounds: 0 }),
    ).toBe("escalated");
  });

  it("sends a cl back to the owner of what its findings are about: the tests to ready, the code to red, the rest raised", () => {
    expect(next("green", "cl", "back", ["tests"], once)).toBe("ready");
    expect(next("green", "cl", "back", ["code"], once)).toBe("red");
    expect(next("red", "cl", "back", ["tests"], once)).toBe("ready");
    for (const a of ["cl", "plan", "issue"] as const)
      expect(next("ready", "cl", "back", [a], once)).toBe("raised");
  });

  it("sends an issue back to the planner for its plan, and to Matt for itself", () => {
    expect(next("planned", "issue", "back", ["plan"], once)).toBe("open");
    expect(next("built", "issue", "back", ["plan"], once)).toBe("open");
    expect(next("open", "issue", "back", ["issue"], once)).toBe("raised");
    expect(next("built", "issue", "back", ["issue"], once)).toBe("raised");
  });

  it("sends findings about several artifacts to the highest one's owner", () => {
    expect(top(["code", "tests"])).toBe("tests");
    expect(top(["code", "plan", "tests"])).toBe("plan");
    expect(next("green", "cl", "back", ["code", "tests"], once)).toBe("ready");
    expect(next("built", "issue", "back", ["plan", "issue"], once)).toBe(
      "raised",
    );
  });

  it("escalates a round past the limit, and never a raise", () => {
    expect(
      next("green", "cl", "back", ["code"], {
        attempts: 1,
        rounds: reviewRounds,
      }),
    ).toBe("red");
    expect(
      next("built", "issue", "back", ["plan"], {
        attempts: 1,
        rounds: reviewRounds + 1,
      }),
    ).toBe("escalated");
    expect(
      next("green", "cl", "back", ["plan"], {
        attempts: 1,
        rounds: reviewRounds + 1,
      }),
    ).toBe("raised");
  });

  it("throws for a word its state has no row for, and an artifact its kind has no owner of", () => {
    expect(() => next("merged", "cl", "pass", [], once)).toThrow(
      /no transition/,
    );
    expect(() => next("built", "issue", "back", ["code"], once)).toThrow(
      /no owner/,
    );
  });
});
