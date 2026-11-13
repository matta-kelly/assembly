import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { notesAt, writeNote } from "../effects/notes.ts";
import { notesRepo } from "../effects/notes.fixture.ts";
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

const cl = (name: string, phase?: number, o: Partial<ClSpec> = {}): ClSpec => ({
  name,
  intent: `${name} works`,
  ...(phase === undefined ? {} : { phase }),
  shape: { change: "behavior", checked: "repo" },
  checkout: [`src/${name}.ts`, `src/${name}.test.ts`, "src/a.ts"],
  test: `node --test src/${name}.test.ts`,
  promises: ["given x, when y, then z"],
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
const o = { taken: () => false, repos: ["repo"] };

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

  it("retries a path outside the repo", () => {
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
  });

  it("takes a cl that names one of the issue's repos, and one that names none when the issue has one", () => {
    expect(specLint({ cls: [cl("one")] }, o).word).toBe("pass");
    expect(specLint({ cls: [{ ...cl("one"), repo: "repo" }] }, o).word).toBe(
      "pass",
    );
    const two = { ...o, repos: ["a", "b"] };
    expect(
      specLint(
        plan({ ...cl("one", 1), repo: "a" }, { ...cl("two", 1), repo: "b" }),
        two,
      ).word,
    ).toBe("pass");
  });

  it("retries a cl whose repo is not the issue's, or that names none when the issue has several", () => {
    expect(
      specLint({ cls: [{ ...cl("one"), repo: "other" }] }, o).reason,
    ).toMatch(/its repo other is not the issue's: repo/);
    const two = { ...o, repos: ["a", "b"] };
    expect(
      specLint(plan({ ...cl("one", 1), repo: "a" }, cl("two", 1)), two).reason,
    ).toMatch(/cl two: names no repo, and the issue has 2: a, b/);
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

/** A notes repo with an issue note, `_well/is.md`; notes written into its folder are read once committed. */
function issueRepo() {
  const repo = notesRepo({
    "_well/is.md":
      "---\ntype: issue\nstatus: new\n---\nIt works.\n\n---\n## Done\n\n- it works\n",
  });
  const dir = join(repo.repo, "_well");
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
        true,
      );
    for (const c of s.cls)
      writeNote(
        join(dir, `is-${c.name}.md`),
        clFields("is", c, Boolean(s.plan)),
        clNote(c),
        true,
      );
  };
  /** The notes as the factory reads them: at the commit of what is in the folder now. */
  const notes = () => {
    const at = repo.commit({});
    return notesAt(at.repo, at.commit);
  };
  return {
    dir,
    write,
    notes,
    rm: () => rmSync(repo.repo, { recursive: true, force: true }),
  };
}

describe("a cl's spec", () => {
  let at: ReturnType<typeof issueRepo>;
  beforeEach(() => (at = issueRepo()));
  afterEach(() => at.rm());

  it("is read from its note at the notes' commit, with its checkout and test", () => {
    at.write(plan(cl("one", 1), cl("two", 2)));
    const notes = at.notes();
    const two = { name: "is-two", issue: "is", note: "_well/is-two.md" };
    expect(clOf(notes, two).name).toBe("two");
    expect(clOf(notes, two).test).toBe("node --test src/two.test.ts");
    const one = clOf(notes, {
      ...two,
      name: "is-one",
      note: "_well/is-one.md",
    });
    expect(one.checkout).toEqual(["src/one.ts", "src/one.test.ts", "src/a.ts"]);
  });

  it("is an error for a note that is not there at the commit, or not a cl", () => {
    const notes = at.notes();
    expect(() =>
      clOf(notes, { name: "is-one", issue: "is", note: "_well/is-one.md" }),
    ).toThrow(/no note _well\/is-one\.md/);
    expect(() =>
      clOf(notes, { name: "is-is", issue: "is", note: "_well/is.md" }),
    ).toThrow(/not a cl/);
  });

  it("reads as text with each cl's fields", () => {
    const text = specText(plan(cl("one", 1), cl("two", 2)));
    expect(text).toContain("- Phase 2: phase 2");
    expect(text).toContain("### two, phase 2: two works");
    expect(text).toContain("- checkout: src/two.ts, src/two.test.ts, src/a.ts");
  });
});

describe("a spec's notes", () => {
  let at: ReturnType<typeof issueRepo>;
  beforeEach(() => (at = issueRepo()));
  afterEach(() => at.rm());

  it("are read back as the same spec: a plan of three cls, and a lone cl", () => {
    const s = plan(cl("one", 1), cl("two", 1), cl("three", 2));
    at.write(s);
    expect(readSpec(at.notes(), "_well/is.md", "is", true)).toEqual({
      ok: true,
      spec: {
        ...s,
        cls: [...s.cls].sort((a, b) => a.name.localeCompare(b.name)),
      },
    });
    expect(readFileSync(join(at.dir, "is-plan.md"), "utf8")).toContain(
      "- Phase 2: phase 2\n\t- [[is-three]]: the export of src/three.ts",
    );
    rmSync(join(at.dir, "is-plan.md"));
    for (const n of ["one", "two", "three"]) rmSync(join(at.dir, `is-${n}.md`));
    at.write({ cls: [cl("one")] });
    expect(readSpec(at.notes(), "_well/is.md", "is", true)).toEqual({
      ok: true,
      spec: { cls: [cl("one")] },
    });
  });

  it("refuse, when submitted, a plan whose Phases list does not match its cls' phases", () => {
    at.write(plan(cl("one", 1), cl("two", 2)));
    const p = join(at.dir, "is-plan.md");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace("[[is-two]]", "[[is-gone]]"),
    );
    const got = readSpec(at.notes(), "_well/is.md", "is", true);
    expect(got.ok).toBe(false);
    expect(got.ok ? [] : got.errors.join("\n")).toMatch(
      /is-two nowhere[\s\S]*is-gone, which is no cl/,
    );
  });

  it("refuse an issue with no Done items, and, when submitted, a cl that is not new", () => {
    writeFileSync(
      join(at.dir, "is.md"),
      "---\ntype: issue\nstatus: new\n---\nIt works.\n",
    );
    at.write({ cls: [cl("one")] });
    const c = join(at.dir, "is-one.md");
    writeFileSync(
      c,
      readFileSync(c, "utf8").replace("status: new", "status: done"),
    );
    const notes = at.notes();
    const got = readSpec(notes, "_well/is.md", "is", true);
    expect(got.ok ? [] : got.errors).toEqual([
      expect.stringMatching(/its Done has no items/),
      "is-one: it is not new",
    ]);
    expect(readSpec(notes, "_well/is.md", "is").ok).toBe(false);
  });

  it("read, while its issue builds, a cl of any status and a plan beside cls it does not list", () => {
    at.write(plan(cl("one", 1), cl("two", 2)));
    const p = join(at.dir, "is-plan.md");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace("[[is-two]]", "[[is-gone]]"),
    );
    const c = join(at.dir, "is-one.md");
    writeFileSync(
      c,
      readFileSync(c, "utf8").replace("status: new", "status: done"),
    );
    const got = readSpec(at.notes(), "_well/is.md", "is");
    expect(got.ok && got.spec.cls.map((x) => x.name)).toEqual(["one", "two"]);
  });

  it("read at an older commit give the spec as it was then", () => {
    at.write({ cls: [cl("one")] });
    const before = at.notes();
    at.write({
      cls: [cl("one", undefined, { test: "node --test src/b.test.ts" })],
    });
    at.notes();
    const then = readSpec(before, "_well/is.md", "is");
    expect(then.ok && then.spec.cls[0]?.test).toBe(
      "node --test src/one.test.ts",
    );
  });
});
