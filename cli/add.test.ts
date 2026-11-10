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
import { viewOf } from "../process/plan.ts";
import { add, approve, replan, submit } from "./add.ts";

let home: string;
let notes: string;
let repo: string;
const factory = () => compose({ home: join(home, "factory") });
const run = () => ({ repo, image: "img", test: "npm test" });

// An issue, its plan and its cl notes as kinetic's types write them by hand: YAML lists in block form.
const issue =
  "---\ntype: issue\nstatus: new\n---\nfx.\n\n---\n## Done\n\n- a is 2\n";
const plan = (phases: string) => `---
type: plan
description: "The plan of fx."
belongsTo: "[[fx]]"
status: active
---
fx, a part at a time.

---
## Phases

${phases}

## Does not fit

Nothing.
`;
const cl = (name: string, phase?: number, belongsTo = "fx-plan") => `---
type: cl
description: "A cut of fx."
belongsTo: "[[${belongsTo}]]"
status: new
${phase === undefined ? "" : `phase: ${phase}\n`}shape:
  change: behavior
  checked: repo
checkout:
  - src/${name}.ts
  - test/${name}.test.ts
  - src/b.ts
scope:
  - src/${name}.ts
  - test/${name}.test.ts
test: npx vitest run test/${name}.test.ts
---
src/${name}.ts exports ${name}, which is 2.

---
## Check

- given ${name}, when imported, then it is 2

## Seam

${name}'s name and type.

## Checkout

- src/b.ts: the exemplar
`;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "add-"));
  notes = join(home, "notes");
  repo = join(home, "repo");
  mkdirSync(notes);
  writeFileSync(join(notes, "fx.md"), issue);
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const twoPhases = () => {
  writeFileSync(
    join(notes, "fx-plan.md"),
    plan("- Phase 1: a first\n\t- [[fx-a]]\n- Phase 2: then c\n\t- [[fx-c]]"),
  );
  writeFileSync(join(notes, "fx-a.md"), cl("a", 1));
  writeFileSync(join(notes, "fx-c.md"), cl("c", 2));
};

describe("add", () => {
  it("puts an issue in the ledger at open, for the factory's planner", () => {
    expect(add(factory, join(notes, "fx.md"), run())).toEqual({
      code: 0,
      lines: ["added fx, open"],
    });
    expect(factory().ledger.item("fx")).toMatchObject({ state: "open", repo });
  });

  it("refuses a plan or a cl: its issue is submitted, which brings them", () => {
    twoPhases();
    expect(add(factory, join(notes, "fx-plan.md"), run()).lines[0]).toMatch(
      /is a plan: submit its issue/,
    );
  });

  it("refuses an issue with no repo, a repo that is not a git repo, and one in the ledger already", () => {
    expect(
      add(factory, join(notes, "fx.md"), { image: "i", test: "t" }).code,
    ).toBe(2);
    expect(
      add(factory, join(notes, "fx.md"), { ...run(), repo: home }).lines[0],
    ).toMatch(/is not a git repo/);
    add(factory, join(notes, "fx.md"), run());
    expect(add(factory, join(notes, "fx.md"), run()).lines[0]).toMatch(
      /in the ledger already/,
    );
  });
});

describe("submit", () => {
  it("puts an issue with Matt's spec at building, by his two passes, and the engine builds it by phase from his notes", async () => {
    twoPhases();
    const before = readFileSync(join(notes, "fx-plan.md"), "utf8");
    expect(submit(factory, join(notes, "fx.md"), run())).toEqual({
      code: 0,
      lines: [
        "submitted fx, building, with 2 cls:",
        "  fx-a  phase 1",
        "  fx-c  phase 2",
      ],
    });
    const { ledger } = factory();
    expect(ledger.item("fx").state).toBe("building");
    expect(ledger.events("fx").map((e) => [e.by, e.word, e.to_state])).toEqual([
      [null, null, "open"],
      ["matt", "pass", "planned"],
      ["matt", "pass", "building"],
    ]);
    expect(ledger.attemptsOf("fx")).toEqual([]);
    expect(ledger.spec("fx")?.by).toBe("matt");
    await advance(ledger);
    expect(ledger.cls("fx").map((c) => [c.name, c.phase, c.state])).toEqual([
      ["fx-a", 1, "ready"],
      ["fx-c", 2, "waiting"],
    ]);
    expect(viewOf(ledger, { name: "fx-a", issue: "fx" })).toEqual({
      read: ["src/a.ts", "test/a.test.ts", "src/b.ts"],
      change: ["src/a.ts", "test/a.test.ts"],
    });
    expect(readFileSync(join(notes, "fx-plan.md"), "utf8")).toBe(before);
  });

  it("takes the lone cl of an issue that takes one, with no plan", async () => {
    writeFileSync(join(notes, "fx-a.md"), cl("a", undefined, "fx"));
    expect(submit(factory, join(notes, "fx.md"), run()).code).toBe(0);
    const { ledger } = factory();
    await advance(ledger);
    expect(ledger.cls("fx").map((c) => [c.name, c.phase, c.state])).toEqual([
      ["fx-a", 1, "ready"],
    ]);
  });

  it("refuses a spec its notes can't make whole, or that does not lint against the repo, and writes nothing", () => {
    twoPhases();
    writeFileSync(join(notes, "fx-c.md"), cl("c", 1));
    expect(submit(factory, join(notes, "fx.md"), run()).lines).toEqual([
      expect.stringMatching(
        /list puts fx-c in phase 2, and the cl says phase 1/,
      ),
    ]);
    writeFileSync(
      join(notes, "fx-c.md"),
      cl("c", 2).replace("src/b.ts", "src/gone.ts"),
    );
    expect(submit(factory, join(notes, "fx.md"), run()).lines).toEqual([
      expect.stringMatching(
        /cl c: files of its checkout are not in the repo: src\/gone.ts/,
      ),
    ]);
    expect(factory().ledger.items()).toEqual([]);
  });

  it("sends its issue to Matt, escalated, on a raise about its plan, never to the factory's planner", async () => {
    twoPhases();
    submit(factory, join(notes, "fx.md"), run());
    const { ledger } = factory();
    await advance(ledger);
    ledger.apply(
      "fx-a",
      {
        word: "back",
        reason: "back",
        findings: [{ about: "plan", what: "no seam", where: "Seam" }],
      },
      { attempt: ledger.begin("fx-a") },
    );
    await advance(ledger);
    expect(ledger.item("fx").state).toBe("escalated");
    expect(ledger.events("fx").at(-1)).toMatchObject({
      by: "orchestrator",
      findings: [{ about: "plan", what: "no seam" }],
    });
  });
});

describe("approve and replan", () => {
  it("approve is Matt's pass at plan review, and refuses any other state", () => {
    add(factory, join(notes, "fx.md"), run());
    expect(approve(factory, "fx").lines[0]).toMatch(
      /fx is open: approve takes an issue at planned/,
    );
    const { ledger } = factory();
    ledger.apply(
      "fx",
      { word: "pass", reason: "Matt planned it", findings: [] },
      "matt",
    );
    expect(approve(factory, "fx")).toEqual({
      code: 0,
      lines: ["approved fx, building"],
    });
    expect(ledger.events("fx").at(-1)).toMatchObject({
      by: "matt",
      to_state: "building",
    });
  });

  it("approve refuses while plan-review is judging the plan", () => {
    add(factory, join(notes, "fx.md"), run());
    const { ledger } = factory();
    ledger.apply(
      "fx",
      { word: "pass", reason: "planned", findings: [] },
      "matt",
    );
    ledger.begin("fx");
    expect(approve(factory, "fx").lines[0]).toMatch(/attempt open/);
  });

  it("replan sends an escalated issue back to open, drops its cls not merged, and lets go of Matt's spec", async () => {
    twoPhases();
    submit(factory, join(notes, "fx.md"), run());
    const { ledger } = factory();
    await advance(ledger);
    expect(replan(factory, "fx").lines[0]).toMatch(
      /fx is building: replan takes/,
    );
    ledger.apply(
      "fx",
      { word: "escalate", reason: "test", findings: [] },
      "orchestrator",
    );
    expect(replan(factory, "fx").code).toBe(0);
    expect(ledger.item("fx").state).toBe("open");
    expect(ledger.cls("fx").map((c) => c.state)).toEqual([
      "dropped",
      "dropped",
    ]);
    expect(ledger.spec("fx")).toBeUndefined();
    expect(readFileSync(join(notes, "fx-a.md"), "utf8")).toMatch(
      /status: dropped/,
    );
  });
});
