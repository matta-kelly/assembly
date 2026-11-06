/**
 * The nail step: ready to red. da-nail writes one test per behavior in the cl's Check, each failing at its assertion.
 * The check confirms each behavior has a test in a file that exists, then runs the cl's test command and passes only
 * when it fails at an assertion (red.sh in loke's v1 gates). A review that sends the cl back to its tests brings it
 * here again, and da-nail reads the findings in the cl's Review section.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { runTests } from "../orchestrator/start.ts";
import type { Step, Verdict } from "./step.ts";

const done = z.object({
  word: z.literal("done"),
  tests: z
    .array(
      z.object({
        behavior: z
          .number()
          .int()
          .min(1)
          .describe("the behavior's number in the cl's Check list, from 1"),
        file: z.string().describe("the test file, from the repo's root"),
        name: z.string().describe("the test's name"),
      }),
    )
    .min(1),
  notes: z
    .string()
    .optional()
    .describe("anything the next step should know, for the cl's Tests section"),
});
type Done = z.infer<typeof done>;

/** The text of a cl's `## <heading>` section, or "" when it has none. */
export function section(cl: string, heading: string): string {
  const parts = readFileSync(cl, "utf8").split(/^## /m);
  const s = parts.find((p) => p.startsWith(`${heading}\n`));
  return s ? s.slice(heading.length + 1) : "";
}

/** The behaviors of a cl: the top-level items of its Check list. */
export function behaviors(cl: string): string[] {
  return section(cl, "Check")
    .split("\n")
    .filter((line) => line.startsWith("- "));
}

/** The test files the cl's Tests section names, as this step renders it. */
export function testFiles(cl: string): string[] {
  const files = [
    ...section(cl, "Tests").matchAll(/^- behavior \d+: `([^`]+)`/gm),
  ].map((m) => m[1] ?? "");
  return [...new Set(files.filter(Boolean))];
}

/** The output of a test run says it stopped before any assertion ran. */
const notLoaded =
  /SyntaxError|Cannot find module|ERR_MODULE_NOT_FOUND|Failed to load/;
/** The output of a test run shows an assertion failing. */
const assertion =
  /AssertionError|ERR_ASSERTION|expected|^not ok|# fail [1-9]|Tests? +[0-9]+ failed/m;

/** Red, from a test run's exit code and output: it failed, and at an assertion. */
export function judge(code: number, out: string): Verdict {
  const tail = out.slice(-400);
  if (code === 0)
    return { word: "retry", reason: `the tests pass, nothing is red: ${tail}` };
  if (notLoaded.test(out))
    return { word: "retry", reason: `red before any assertion: ${tail}` };
  if (assertion.test(out))
    return { word: "pass", reason: "red at an assertion" };
  return {
    word: "retry",
    reason: `red, but no assertion failure is shown: ${tail}`,
  };
}

export const nail: Step<Done> = {
  from: "ready",
  agent: "da-nail",
  done,
  section: "Tests",
  render: (d) =>
    [
      ...d.tests.map(
        (t) => `- behavior ${t.behavior}: \`${t.file}\`, ${t.name}`,
      ),
      ...(d.notes ? ["", d.notes] : []),
    ].join("\n"),
  async check(r, d) {
    const want = behaviors(r.path).length;
    const have = new Set(d.tests.map((t) => t.behavior));
    for (let b = 1; b <= want; b++) {
      if (!have.has(b))
        return { word: "retry", reason: `behavior ${b} has no test` };
    }
    const extra = [...have].filter((b) => b > want);
    if (extra.length)
      return {
        word: "retry",
        reason: `tests name behaviors the cl does not have: ${extra.join(", ")}`,
      };
    const missing = d.tests.filter((t) => !existsSync(join(r.work, t.file)));
    if (missing.length)
      return {
        word: "retry",
        reason: `test files not in the worktree: ${missing.map((t) => t.file).join(", ")}`,
      };
    const { code, out } = await runTests(r);
    return judge(code, out);
  },
};
