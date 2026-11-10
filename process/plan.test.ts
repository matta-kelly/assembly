import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeNote } from "../effects/notes.ts";
import {
  type ClSpec,
  clFields,
  clNote,
  clOf,
  pathsIn,
  planNote,
  readSpec,
  type Spec,
  specLint,
  specText,
} from "./plan.ts";
import { fakeWorktree } from "./fake-worktree.ts";

const cl = (name: string, phase?: number, o: Partial<ClSpec> = {}): ClSpec => ({
  name,
  intent: `${name} works`,
  ...(phase === undefined ? {} : { phase }),
  shape: { change: "behavior", checked: "repo" },
  checkout: [`src/${name}.ts`, `src/${name}.test.ts`, "src/a.ts"],
  scope: [`src/${name}.ts`, `src/${name}.test.ts`],
  test: `node --test src/${name}.test.ts`,
  check: ["given x, when y, then z"],
  seam: `the export of src/${name}.ts`,
  checkoutNotes: `- src/${name}.ts: the code\n- src/a.ts: the exemplar`,
  ...o,
});
const plan = (...cls: ClSpec[]): Spec => ({
  plan: {
    approach: "two parts, one after the other",
    phases: [...new Set(cls.map((c) => c.phase ?? 1))].map((p) => `phase ${p}`),
  },
  cls,
});
const o = {
  exists: fakeWorktree({ files: ["src/a.ts"] }).exists,
  taken: () => false,
};

describe("spec lint", () => {
  it("passes a plan whose phases run from 1, and a lone cl with no plan and no phase", () => {
    expect(
      specLint(plan(cl("one", 1), cl("two", 1), cl("three", 2)), o).word,
    ).toBe("pass");
    expect(specLint({ cls: [cl("one")] }, o).word).toBe("pass");
  });

  it("retries a phase gap, a cl of a plan with no phase, and a plan of one cl", () => {
    expect(specLint(plan(cl("one", 1), cl("two", 3)), o).reason).toMatch(
      /no cl in phase 2/,
    );
    expect(specLint(plan(cl("one", 1), cl("two")), o).reason).toMatch(
      /no phase: two/,
    );
    expect(specLint(plan(cl("one", 1)), o).reason).toMatch(/plan of one cl/);
    expect(specLint({ cls: [cl("one"), cl("two")] }, o).reason).toMatch(
      /no plan/,
    );
  });

  it("retries two cls of one name, or a name a cl of the issue has", () => {
    expect(specLint(plan(cl("one", 1), cl("one", 2)), o).reason).toMatch(
      /share a name: one/,
    );
    expect(
      specLint({ cls: [cl("one")] }, { ...o, taken: (c) => c === "one" })
        .reason,
    ).toMatch(/already has the name: one/);
  });

  it("retries a scope outside its checkout, a path outside the repo, and a file to read that is not there", () => {
    expect(
      specLint({ cls: [cl("one", undefined, { scope: ["lib/x.ts"] })] }, o)
        .reason,
    ).toMatch(/scope is not in its checkout: lib\/x.ts/);
    expect(
      specLint(
        {
          cls: [
            cl("one", undefined, {
              checkout: ["../etc/passwd", "src/one.ts", "src/one.test.ts"],
            }),
          ],
        },
        o,
      ).reason,
    ).toMatch(/outside the repo/);
    expect(
      specLint(
        {
          cls: [
            cl("one", undefined, {
              checkout: ["src/one.ts", "src/one.test.ts", "src/gone.ts"],
            }),
          ],
        },
        o,
      ).reason,
    ).toMatch(/not in the repo: src\/gone.ts/);
  });

  it("lets a cl read a file a cl of an earlier phase makes, and not one of its own phase", () => {
    const two = cl("two", 2, {
      checkout: ["src/two.ts", "src/two.test.ts", "src/one.ts"],
    });
    expect(specLint(plan(cl("one", 1), two), o).word).toBe("pass");
    expect(
      specLint(plan(cl("one", 1), { ...two, phase: 1 }), o).reason,
    ).toMatch(/not in the repo: src\/one.ts/);
  });

  it("retries two cls of one phase that change the same file", () => {
    const two = cl("two", 1, {
      checkout: ["src/one.ts", "src/two.test.ts"],
      scope: ["src/one.ts"],
      test: "node --test src/two.test.ts",
    });
    expect(specLint(plan(cl("one", 1), two), o).reason).toMatch(
      /overlaps a cl of its phase/,
    );
  });

  it("retries a test command that runs a file not in its checkout", () => {
    const c = cl("one", undefined, {
      test: "node --test src/one.test.ts test/other.test.ts",
    });
    expect(specLint({ cls: [c] }, o).reason).toMatch(
      /not in its checkout: test\/other.test.ts/,
    );
  });
});

describe("a test command", () => {
  it("names its files by path, after the program, past its flags", () => {
    expect(pathsIn("node --test test/a.test.mjs b.test.ts")).toEqual([
      "test/a.test.mjs",
      "b.test.ts",
    ]);
    expect(pathsIn("npm test")).toEqual([]);
    expect(pathsIn("npx vitest run --reporter=dot src/x.test.ts")).toEqual([
      "src/x.test.ts",
    ]);
  });
});

describe("a cl's spec", () => {
  const ledger = (s: Spec | undefined) =>
    ({
      spec: () => s && { spec: s, by: "matt" },
      passed: () => undefined,
    }) as unknown as Parameters<typeof clOf>[0];

  it("is found in its issue's spec by the cl's name, with its checkout and its scope", () => {
    const s = plan(cl("one", 1), cl("two", 2));
    expect(clOf(ledger(s), { name: "is-two", issue: "is" }).name).toBe("two");
    const one = clOf(ledger(s), { name: "is-one", issue: "is" });
    expect([one.checkout, one.scope]).toEqual([
      ["src/one.ts", "src/one.test.ts", "src/a.ts"],
      ["src/one.ts", "src/one.test.ts"],
    ]);
  });

  it("is an error for a cl its issue's spec does not have", () => {
    expect(() =>
      clOf(ledger(undefined), { name: "is-one", issue: "is" }),
    ).toThrow(/is-one is not a cl of is's spec/);
  });

  it("reads as text with each cl's fields", () => {
    const text = specText(plan(cl("one", 1), cl("two", 2)));
    expect(text).toContain("- Phase 2: phase 2");
    expect(text).toContain("### two, phase 2: two works");
    expect(text).toContain("- scope: src/two.ts, src/two.test.ts");
  });
});

describe("a spec's notes", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "spec-"));
    writeFileSync(
      join(dir, "is.md"),
      "---\ntype: issue\nstatus: new\n---\nIt works.\n\n---\n## Done\n\n- it works\n",
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (s: Spec) => {
    if (s.plan)
      writeNote(
        join(dir, "is-plan.md"),
        {
          type: "plan",
          description: "d",
          belongsTo: "[[is]]",
          status: "active",
        },
        planNote("is", s as Spec & { plan: NonNullable<Spec["plan"]> }),
      );
    for (const c of s.cls)
      writeNote(
        join(dir, `is-${c.name}.md`),
        clFields("is", c, Boolean(s.plan)),
        clNote(c),
      );
  };

  it("are read back as the same spec: a plan of three cls, and a lone cl", () => {
    const s = plan(cl("one", 1), cl("two", 1), cl("three", 2));
    write(s);
    expect(readSpec(join(dir, "is.md"), "is")).toEqual({
      ok: true,
      spec: {
        ...s,
        cls: [...s.cls].sort((a, b) => a.name.localeCompare(b.name)),
      },
    });
    expect(readFileSync(join(dir, "is-plan.md"), "utf8")).toContain(
      "- Phase 2: phase 2\n\t- [[is-three]]: the export of src/three.ts",
    );
    rmSync(join(dir, "is-plan.md"));
    for (const n of ["one", "two", "three"]) rmSync(join(dir, `is-${n}.md`));
    write({ cls: [cl("one")] });
    expect(readSpec(join(dir, "is.md"), "is")).toEqual({
      ok: true,
      spec: { cls: [cl("one")] },
    });
  });

  it("refuse a plan whose Phases list does not match its cls' phases", () => {
    write(plan(cl("one", 1), cl("two", 2)));
    const p = join(dir, "is-plan.md");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace("[[is-two]]", "[[is-gone]]"),
    );
    const got = readSpec(join(dir, "is.md"), "is");
    expect(got.ok).toBe(false);
    expect(got.ok ? [] : got.errors.join("\n")).toMatch(
      /is-two nowhere[\s\S]*is-gone, which is no cl/,
    );
  });

  it("refuse an issue with no Done items, and a cl that is not new", () => {
    writeFileSync(
      join(dir, "is.md"),
      "---\ntype: issue\nstatus: new\n---\nIt works.\n",
    );
    write({ cls: [cl("one")] });
    const c = join(dir, "is-one.md");
    writeFileSync(
      c,
      readFileSync(c, "utf8").replace("status: new", "status: done"),
    );
    const got = readSpec(join(dir, "is.md"), "is");
    expect(got.ok ? [] : got.errors).toEqual([
      expect.stringMatching(/its Done has no items/),
      "is-one: it is not new",
    ]);
  });
});
