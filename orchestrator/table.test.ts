import { describe, expect, it } from "vitest";
import { next, retryLimit, reviewRounds } from "./table.ts";

const once = { attempts: 1, rounds: 0 };

describe("next", () => {
  it("moves a cl along on pass: ready to red, red to green, green to approved", () => {
    expect(next("ready", "pass", once)).toBe("red");
    expect(next("red", "pass", once)).toBe("green");
    expect(next("green", "pass", once)).toBe("approved");
  });

  it("moves a raise to raised, from every step", () => {
    for (const s of ["ready", "red", "green"] as const)
      expect(next(s, "raise", once)).toBe("raised");
  });

  it("keeps a cl in its state on retry, until the retry limit escalates it", () => {
    expect(next("red", "retry", { attempts: retryLimit - 1, rounds: 0 })).toBe(
      "red",
    );
    expect(next("red", "retry", { attempts: retryLimit, rounds: 0 })).toBe(
      "escalated",
    );
  });

  it("sends a reviewed cl back to its tests or its code, until the review rounds escalate it", () => {
    expect(next("green", "to-tests", { attempts: 1, rounds: 1 })).toBe("ready");
    expect(
      next("green", "to-code", { attempts: 1, rounds: reviewRounds }),
    ).toBe("red");
    expect(
      next("green", "to-code", { attempts: 1, rounds: reviewRounds + 1 }),
    ).toBe("escalated");
  });

  it("throws for a word its state has no row for", () => {
    expect(() => next("ready", "to-code", once)).toThrow(/no transition/);
    expect(() => next("approved", "pass", once)).toThrow(/no transition/);
  });
});
