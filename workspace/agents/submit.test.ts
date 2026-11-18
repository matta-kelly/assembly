import { describe, expect, it } from "vitest";
import { z } from "zod";
import { steps } from "../../factory/stations/index.ts";
import { hammer } from "../../factory/stations/hammer.ts";
import { nail } from "../../factory/stations/nail.ts";
import { review } from "../../factory/stations/review.ts";
import { accept } from "../../factory/stations/accept.ts";
import { aboutRoute, backRoute, doneRoute, submitOf } from "./submit.ts";

/** The form as the model reads it: its JSON Schema, as que-pasa gives a tool's parameters. */
const schema = (s: Parameters<typeof submitOf>[0]) =>
  JSON.stringify(z.toJSONSchema(submitOf(s), { io: "input" }));

describe("an agent's submit form", () => {
  it("names where done takes the item, from the table", () => {
    expect(doneRoute(hammer)).toContain("The cl goes to cl-review.");
    expect(doneRoute(nail)).toContain(
      "The cl goes to da-hammer, or to cl-review when the tests already pass",
    );
    expect(doneRoute(review)).toContain(
      "The cl goes to the dock, which lands it on main.",
    );
    expect(doneRoute(accept)).toContain("accepted: the issue is closed");
  });

  it("names where each about takes the item, and only the abouts the step may name", () => {
    const routes = aboutRoute(hammer);
    expect(routes).toContain("tests: a fault in the tests");
    expect(routes).toContain("the cl goes back to da-nail.");
    expect(routes).toContain(
      "cl: a fault in the cl's spec: a promise, its seam or its core context; the cl stops, and its issue goes to the operator.",
    );
    expect(routes).not.toContain("code:");
    expect(aboutRoute(review)).toContain("the cl goes back to da-hammer.");
    expect(aboutRoute(accept)).toContain("the issue goes back to planner.");
  });

  it("says the highest about takes the whole back", () => {
    expect(backRoute(hammer)).toContain(
      "the owner of the highest 'about' among its findings (from the top: issue, plan, cl, tests, code)",
    );
  });

  it("gives every step's agent its routes in the schema the model reads", () => {
    for (const s of steps) {
      const json = schema(s);
      expect(json).toContain(JSON.stringify(doneRoute(s)).slice(1, -1));
      expect(json).toContain(JSON.stringify(backRoute(s)).slice(1, -1));
      expect(json).toContain(JSON.stringify(aboutRoute(s)).slice(1, -1));
    }
  });
});
