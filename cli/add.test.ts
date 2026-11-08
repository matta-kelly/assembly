import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compose } from "../main.ts";
import { advance } from "../orchestrator/advance.ts";
import { cutOf, viewOf } from "../process/plan.ts";
import { addPlan } from "./add.ts";

let home: string;
let notes: string;
const factory = () => compose({ home: join(home, "factory") });
const run = { image: "img", test: "npm test", home: "/home/me" };

// A plan and its cl notes as kinetic's types write them: Files with a repo in backticks and ~, change and read
// one per item with :line suffixes, and the test command.
const plan = (cls: string[]) => `---
type: plan
description: "The plan of fx."
belongsTo: "[[fx]]"
status: active
---
fx cut along one seam.

## Phases

### Phase 1

${cls.map((c) => `- [[${c}]]: its intent`).join("\n")}

## Trace

- all of it: ${cls.join(", ")}
`;

const cl = (o: { repo?: string; test?: string; change?: string } = {}) => `---
type: cl
description: "A cut of fx."
status: new
belongsTo: "[[fx-plan]]"
---
src/a.ts exports a, which is 2.

## Check

- given a, when imported, then it is 2

## Seam

a's name and type.

## Files

- repo: \`${o.repo ?? "~/repo"}\`, in a workspace from \`origin/main\`
- change
${o.change ?? "\t- `src/a.ts:3`: the export\n\t- `test/a.test.ts`: new, the test of `a`"}
- read
\t- \`src/b.ts:1-20\`: the style
${o.test === undefined ? "- test: `npx vitest run test/a.test.ts`" : o.test}

## Grounds

- src/b.ts:1: how an export looks

## Tests

## Code

## Review
`;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "add-plan-"));
  notes = join(home, "notes");
  mkdirSync(notes);
  writeFileSync(join(notes, "fx.md"), "---\ntype: issue\n---\nfx.\n");
  mkdirSync(join(home, "repo", ".git"), { recursive: true });
  mkdirSync(join(home, "repo", "src"));
  writeFileSync(join(home, "repo", "src", "b.ts"), "export const b = 1;\n");
  run.home = home;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("add-plan", () => {
  it("puts a plan made outside the factory in the ledger: its issue building, its cls ready and waiting, each with its cut's view", () => {
    writeFileSync(join(notes, "fx-plan.md"), plan(["fx-one", "fx-two"]));
    writeFileSync(join(notes, "fx-one.md"), cl());
    writeFileSync(join(notes, "fx-two.md"), cl());
    const done = addPlan(factory, join(notes, "fx-plan.md"), run);
    expect(done).toEqual({
      code: 0,
      lines: [
        "added fx, building, with 2 cls:",
        "  fx-one  ready",
        "  fx-two  waiting",
      ],
    });
    const { ledger } = factory();
    expect(ledger.item("fx")).toMatchObject({
      state: "building",
      repo: join(home, "repo"),
      image: "img",
      test: "npm test",
    });
    expect(ledger.cls("fx").map((c) => [c.name, c.state, c.seq])).toEqual([
      ["fx-one", "ready", 1],
      ["fx-two", "waiting", 2],
    ]);
    expect(ledger.item("fx-one")).toMatchObject({
      path: join(notes, "fx-one.md"),
      test: "npx vitest run test/a.test.ts",
    });
    expect(viewOf(ledger, { name: "fx-one", issue: "fx" })).toEqual({
      read: ["src/b.ts"],
      change: ["src/a.ts", "test/a.test.ts"],
    });
    expect(cutOf(ledger, { name: "fx-two", issue: "fx" })).toMatchObject({
      intent: "src/a.ts exports a, which is 2.",
      behaviors: ["given a, when imported, then it is 2"],
      seam: "a's name and type.",
    });
  });

  it("leaves the plan's own notes as they are when the engine moves it on", async () => {
    writeFileSync(join(notes, "fx-plan.md"), plan(["fx-one", "fx-two"]));
    writeFileSync(join(notes, "fx-one.md"), cl());
    writeFileSync(join(notes, "fx-two.md"), cl());
    addPlan(factory, join(notes, "fx-plan.md"), run);
    const before = ["fx-plan", "fx-one", "fx-two"].map((n) =>
      readFileSync(join(notes, `${n}.md`), "utf8"),
    );
    await advance(factory().ledger);
    expect(
      ["fx-plan", "fx-one", "fx-two"].map((n) =>
        readFileSync(join(notes, `${n}.md`), "utf8"),
      ),
    ).toEqual(before);
    expect(factory().ledger.item("fx").state).toBe("building");
  });

  it("sends its issue to Matt, escalated, on a raise or a send-back, never to the factory's planner", async () => {
    writeFileSync(join(notes, "fx-plan.md"), plan(["fx-one"]));
    writeFileSync(join(notes, "fx-one.md"), cl());
    addPlan(factory, join(notes, "fx-plan.md"), run);
    const { ledger } = factory();
    ledger.end(
      "fx-one",
      ledger.begin("fx-one"),
      { word: "raise", cause: "plan_gap", reason: "no seam" },
      "raised",
    );
    await advance(ledger);
    expect(ledger.item("fx").state).toBe("escalated");
    expect(ledger.item("fx-one").state).toBe("raised");
    expect(readFileSync(join(notes, "fx.md"), "utf8")).toMatch(/## Raise/);
    expect(readFileSync(join(notes, "fx-plan.md"), "utf8")).toBe(
      plan(["fx-one"]),
    );
  });

  it("takes change files written inline, as the factory's own cl notes have them", () => {
    writeFileSync(join(notes, "fx-plan.md"), plan(["fx-one"]));
    writeFileSync(
      join(notes, "fx-one.md"),
      cl({ change: "" }).replace(
        "- change\n\n",
        "- change: `src/a.ts`, `test/a.test.ts`\n",
      ),
    );
    expect(addPlan(factory, join(notes, "fx-plan.md"), run).code).toBe(0);
    expect(
      viewOf(factory().ledger, { name: "fx-one", issue: "fx" }).change,
    ).toEqual(["src/a.ts", "test/a.test.ts"]);
  });

  it("refuses a plan its notes can't make whole, with every reason, and writes nothing", () => {
    writeFileSync(
      join(notes, "fx-plan.md"),
      plan(["fx-one", "fx-gone", "other-two", "fx-one", "fx-four"]).replace(
        "status: active",
        "status: review",
      ),
    );
    writeFileSync(join(notes, "fx-one.md"), cl({ test: "" }));
    writeFileSync(join(notes, "other-two.md"), cl());
    writeFileSync(join(notes, "fx-four.md"), cl({ repo: "/elsewhere" }));
    const done = addPlan(factory, join(notes, "fx-plan.md"), run);
    expect(done.code).toBe(1);
    expect(done.lines).toEqual([
      `${join(notes, "fx-plan.md")}: the plan is not active: plan-review has not passed it`,
      "linked twice under Phases: fx-one",
      expect.stringMatching(/^fx-one: not a cut: test /),
      `no cl note at ${join(notes, "fx-gone.md")}`,
      "other-two: a cl of fx is named fx-<cut>",
      `its cls are in more than one repo: ${join(home, "repo")}, /elsewhere`,
    ]);
    expect(factory().ledger.items()).toEqual([]);
  });

  it("refuses a plan note not named for its issue, and an issue not in kebab-case", () => {
    writeFileSync(join(notes, "fx-plan-v2.md"), plan(["fx-one"]));
    writeFileSync(join(notes, "fx-one.md"), cl());
    expect(addPlan(factory, join(notes, "fx-plan-v2.md"), run).lines).toEqual([
      `${join(notes, "fx-plan-v2.md")}: an issue's plan is fx-plan.md, beside it`,
    ]);
    writeFileSync(
      join(notes, "Fx_A-plan.md"),
      plan(["Fx_A-one"]).replace("[[fx]]", "[[Fx_A]]"),
    );
    writeFileSync(join(notes, "Fx_A.md"), "an issue\n");
    writeFileSync(join(notes, "Fx_A-one.md"), cl());
    expect(addPlan(factory, join(notes, "Fx_A-plan.md"), run).lines).toContain(
      "Fx_A: an issue's name is kebab-case",
    );
  });

  it("lints its cuts against the repo as the factory's own plans are", () => {
    writeFileSync(join(notes, "fx-plan.md"), plan(["fx-one"]));
    writeFileSync(
      join(notes, "fx-one.md"),
      cl({ test: "- test: `npx vitest run test/a.test.ts test/z.test.ts`" }),
    );
    expect(addPlan(factory, join(notes, "fx-plan.md"), run).lines).toEqual([
      "cut one: its test command runs files it does not name in its files: test/z.test.ts",
    ]);
    writeFileSync(join(notes, "fx-one.md"), cl());
    rmSync(join(home, "repo", "src", "b.ts"));
    // src/b.ts, its file to read, is not in the repo
    expect(addPlan(factory, join(notes, "fx-plan.md"), run).lines).toEqual([
      "cut one: files to read are not in the repo: src/b.ts",
    ]);
    expect(factory().ledger.items()).toEqual([]);
  });

  it("refuses a plan whose issue or cls the ledger has already", () => {
    writeFileSync(join(notes, "fx-plan.md"), plan(["fx-one"]));
    writeFileSync(join(notes, "fx-one.md"), cl());
    expect(addPlan(factory, join(notes, "fx-plan.md"), run).code).toBe(0);
    expect(addPlan(factory, join(notes, "fx-plan.md"), run)).toEqual({
      code: 1,
      lines: ["a cl of this issue already has the name: one"],
    });
  });

  it("refuses a repo that is not a git repo", () => {
    writeFileSync(join(notes, "fx-plan.md"), plan(["fx-one"]));
    writeFileSync(join(notes, "fx-one.md"), cl({ repo: "~/norepo" }));
    expect(addPlan(factory, join(notes, "fx-plan.md"), run)).toEqual({
      code: 1,
      lines: [`${join(home, "norepo")} is not a git repo`],
    });
  });
});
