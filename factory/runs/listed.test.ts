import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Listed, runnerOf, unrunnable } from "./listed.ts";

let work: string;
beforeEach(() => (work = mkdtempSync(join(tmpdir(), "listed-"))));
afterEach(() => rmSync(work, { recursive: true, force: true }));

const t = (file: string, name: string): Listed => ({ file, name, kind: "new" });
const runner = (x: Listed) => {
  const r = runnerOf(work, x);
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe("a Go test's runner", () => {
  beforeEach(() => {
    mkdirSync(join(work, "lanes", "containers"), { recursive: true });
    writeFileSync(join(work, "go.mod"), "module m\n");
  });

  it("lists and runs the one test, anchored and quoted, uncached, in its package from the nearest go.mod", () => {
    const r = runner(t("lanes/containers/apps_test.go", "TestApps"));
    expect(r.list).toBe(
      "cd '.' && go test -count=1 -list '^TestApps$' './lanes/containers'",
    );
    expect(r.run).toBe(
      "cd '.' && go test -count=1 -run '^TestApps$' './lanes/containers'",
    );
  });

  it("runs from a nested module's go.mod", () => {
    mkdirSync(join(work, "tools", "x"), { recursive: true });
    writeFileSync(join(work, "tools", "go.mod"), "module t\n");
    expect(runner(t("tools/x/x_test.go", "TestX")).run).toBe(
      "cd 'tools' && go test -count=1 -run '^TestX$' './x'",
    );
  });

  it("holds the test when its name is a line of the listing, and only then", () => {
    const r = runner(t("lanes/containers/apps_test.go", "TestApps"));
    expect(r.holds("TestApps\nok  \tm/lanes/containers\t0.01s\n")).toBe(true);
    expect(r.holds("ok  \tm/lanes/containers\t0.01s\n")).toBe(false);
    expect(r.holds("TestAppsMore\n")).toBe(false);
  });

  it("quotes a name's regular-expression characters and its quotes", () => {
    expect(runner(t("lanes/containers/a_test.go", "Test'a.b")).run).toContain(
      `'^Test'\\''a\\.b$'`,
    );
  });

  it("has none for a subtest, or a file with no go.mod above it", () => {
    rmSync(join(work, "go.mod"));
    expect(runnerOf(work, t("lanes/containers/a_test.go", "TestA"))).toMatch(
      /no go.mod above it/,
    );
    writeFileSync(join(work, "go.mod"), "module m\n");
    expect(runnerOf(work, t("lanes/containers/a_test.go", "TestA/b"))).toMatch(
      /top-level test/,
    );
  });
});

describe("a vitest test's runner", () => {
  it("lists and runs its file, narrowed to the test's name", () => {
    const r = runner(t("host/server.test.ts", "lists the agents"));
    expect(r.list).toBe(
      "npx vitest list 'host/server.test.ts' -t 'lists the agents$'",
    );
    expect(r.run).toBe(
      "npx vitest run 'host/server.test.ts' -t 'lists the agents$'",
    );
  });

  it("holds the test when a line of the listing ends with its name", () => {
    const r = runner(t("host/server.test.ts", "lists the agents"));
    expect(r.holds("host/server.test.ts > server > lists the agents\n")).toBe(
      true,
    );
    expect(r.holds("host/server.test.ts > server > runs one\n")).toBe(false);
  });
});

describe("a shell test's runner", () => {
  it("runs its file, which is the test", () => {
    const r = runner(t("scripts/factory.test.sh", "scripts/factory.test.sh"));
    expect(r.list).toBe("test -f 'scripts/factory.test.sh'");
    expect(r.run).toBe("bash 'scripts/factory.test.sh'");
  });
});

describe("unrunnable", () => {
  it("names each test whose file no runner runs, and never guesses one", () => {
    expect(
      unrunnable({ work }, [t("a.test.ts", "a"), t("test/a.test.mjs", "a")]),
    ).toEqual([
      "test/a.test.mjs: the factory runs only *.test.ts, *_test.go, *.test.sh",
    ]);
  });
});
