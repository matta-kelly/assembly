import { describe, expect, it } from "vitest";
import { next, retryLimit, reviewRounds, top } from "./table.ts";

const once = { attempts: 1, rounds: 0 };

describe("next", () => {
  it("moves an issue along on pass: open to planned, planned to approved, its land to building, built to accepted", () => {
    expect(next("open", "issue", "pass", [], once)).toBe("planned");
    expect(next("planned", "issue", "pass", [], once)).toBe("approved");
    expect(next("approved", "issue", "pass", [], once)).toBe("building");
    expect(next("built", "issue", "pass", [], once)).toBe("accepted");
  });

  it("keeps an issue's plan land approved on retry, and sends a refused plan back to the planner", () => {
    expect(next("approved", "issue", "retry", [], once)).toBe("approved");
    expect(next("approved", "issue", "back", ["plan"], once)).toBe("open");
  });

  it("moves a cl along on pass: ready to red, red to green, green to approved", () => {
    expect(next("ready", "cl", "pass", [], once)).toBe("red");
    expect(next("ready", "cl", "pass", [], { ...once, met: true })).toBe(
      "green",
    );
    expect(next("red", "cl", "pass", [], once)).toBe("green");
    expect(next("green", "cl", "pass", [], once)).toBe("approved");
  });

  it("lands an approved cl on pass, keeps it approved on retry, and sends a red or a conflict back", () => {
    expect(next("approved", "cl", "pass", [], once)).toBe("landed");
    expect(next("approved", "cl", "retry", [], once)).toBe("approved");
    expect(next("approved", "cl", "back", ["code"], once)).toBe("red");
    expect(next("approved", "cl", "back", ["plan"], once)).toBe("raised");
    expect(() => next("landed", "cl", "drop", [], once)).toThrow(
      /no transition/,
    );
  });

  it("drops an issue or a cl not ended, and never one that has", () => {
    expect(next("building", "issue", "drop", [], once)).toBe("dropped");
    expect(next("escalated", "issue", "drop", [], once)).toBe("dropped");
    expect(next("green", "cl", "drop", [], once)).toBe("dropped");
    expect(() => next("accepted", "issue", "drop", [], once)).toThrow(
      /no transition/,
    );
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

  it("keeps a waiting cl waiting on retry, and starts it on pass", () => {
    expect(next("waiting", "cl", "retry", [], once)).toBe("waiting");
    expect(next("waiting", "cl", "retry", [], { attempts: 0, rounds: 0 })).toBe(
      "waiting",
    );
    expect(next("waiting", "cl", "pass", [], once)).toBe("ready");
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
    expect(() => next("landed", "cl", "pass", [], once)).toThrow(
      /no transition/,
    );
    expect(() => next("built", "issue", "back", ["code"], once)).toThrow(
      /no owner/,
    );
  });
});

describe("resume", () => {
  const c = { attempts: 0, rounds: 0 };

  it("takes an escalated or raised item to the state it is given", () => {
    expect(
      next("escalated", "cl", "resume", [], { ...c, prior: "ready" }),
    ).toBe("ready");
    expect(
      next("escalated", "issue", "resume", [], { ...c, prior: "building" }),
    ).toBe("building");
    expect(next("raised", "cl", "resume", [], { ...c, prior: "red" })).toBe(
      "red",
    );
    expect(next("raised", "issue", "resume", [], { ...c, prior: "open" })).toBe(
      "open",
    );
  });

  it("has no row from a state Matt does not hold, with no state to go to, or to an end or a hold", () => {
    expect(() =>
      next("ready", "cl", "resume", [], { ...c, prior: "ready" }),
    ).toThrow("no transition from ready on resume");
    expect(() => next("escalated", "cl", "resume", [], c)).toThrow(
      "no transition from escalated on resume",
    );
    for (const prior of ["landed", "raised", "escalated"] as const)
      expect(() =>
        next("escalated", "cl", "resume", [], { ...c, prior }),
      ).toThrow("no transition from escalated on resume");
  });
});
