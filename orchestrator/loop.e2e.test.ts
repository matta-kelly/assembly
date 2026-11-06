/**
 * The end to end test of the inner loop, ready to approved, with nothing faked: a real repo and worktree, the agent's container and the red
 * check's container started by podman, the real nail, hammer and review steps, and git commits. Each agent is a stub: a
 * shell command that does its step's work and writes its result.json. The review's stub fails if it can write the
 * worktree, so the read-only mount is proven too. Run by `just e2e`, in the
 * orchestrator's image, so the paths it hands podman are host paths: its folder is under the repo, mounted at the
 * same path. Skipped elsewhere.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hammer } from "../process/hammer.ts";
import { nail } from "../process/nail.ts";
import { review } from "../process/review.ts";
import { open } from "./ledger.ts";
import { loop } from "./loop.ts";

const image = "docker.io/library/node:22.23.4-slim";

const cl = (raise: boolean) => `---
type: cl
---
One value, tested.

## Check

- given src/value.mjs, when it is imported, then value is 2${raise ? "\n\nRAISE" : ""}

## Tests

## Code
`;

// The stub agents. da-nail: a raise when its cl says RAISE, otherwise a failing node:test test of src/value.mjs, and
// a stub of it, so the test fails at its assertion. da-hammer: the value the test wants. cl-review: approve.
const nailStub = `
if grep -q RAISE /packet/cl.md; then
  echo '{"word":"raise","from":"da-nail, tests","missing":"the seam","evidence":"Seam is empty"}' > /out/result.json
  exit 0
fi
mkdir -p test src
printf '%s\\n' 'import { test } from "node:test";' 'import assert from "node:assert";' 'import { value } from "../src/value.mjs";' 'test("b1", () => assert.strictEqual(value, 2));' > test/b1.test.mjs
echo 'export const value = 0;' > src/value.mjs
echo '{"word":"done","tests":[{"behavior":1,"file":"test/b1.test.mjs","name":"b1"}]}' > /out/result.json
`;
const hammerStub = `
echo 'export const value = 2;' > src/value.mjs
echo '{"word":"done","changed":["src/value.mjs"]}' > /out/result.json
`;
const reviewStub = `
touch /work/edited 2>/dev/null && exit 1
echo '{"word":"done","decision":"approve","findings":[]}' > /out/result.json
`;
const agents = {
  "da-nail": { name: "da-nail", command: nailStub },
  "da-hammer": { name: "da-hammer", command: hammerStub },
  "cl-review": { name: "cl-review", command: reviewStub },
};

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

describe.skipIf(!process.env["ASSEMBLY_E2E"])(
  "the inner loop, end to end",
  () => {
    let dir: string;
    let repo: string;

    beforeAll(() => {
      mkdirSync(".e2e", { recursive: true });
      dir = mkdtempSync(join(process.cwd(), ".e2e", "run-"));
      repo = join(dir, "repo");
      mkdirSync(repo);
      git(repo, "init", "-q", "-b", "main");
      writeFileSync(join(repo, "README"), "a repo\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "init");
      writeFileSync(join(dir, "nail.md"), cl(false));
      writeFileSync(join(dir, "gap.md"), cl(true));
    });
    // The attempts' containers go too, also when the test fails before the loop collects them: a name left behind would
    // stop the next run's attempt from starting.
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
      for (const name of ["nail", "gap"].flatMap((cl) =>
        [1, 2, 3, 4].map((n) => `assembly-${cl}-${n}`),
      ))
        execFileSync("podman", ["rm", "-f", "--ignore", name], {
          stdio: "ignore",
        });
    });

    it(
      "moves one cl to approved and another to raised, through real containers",
      { timeout: 300_000 },
      async () => {
        const ledger = open(join(dir, "ledger.db"));
        const at = { repo, image, test: "node --test test/b1.test.mjs" };
        ledger.add({ cl: "nail", path: join(dir, "nail.md"), ...at });
        ledger.add({ cl: "gap", path: join(dir, "gap.md"), ...at });
        const runs = join(dir, "runs");
        const l = loop({ ledger, steps: [nail, hammer, review], agents, runs });

        const done = ["approved", "raised", "escalated"];
        await vi.waitFor(
          async () => {
            await l.tick();
            expect(done).toContain(ledger.item("nail").state);
            expect(done).toContain(ledger.item("gap").state);
          },
          { timeout: 280_000, interval: 2_000 },
        );

        // Each step passed once, in order.
        const moves = ledger
          .events("nail")
          .map((e) => `${String(e["from_state"])}>${String(e["to_state"])}`);
        expect(moves).toEqual([
          "new>ready",
          "ready>red",
          "red>green",
          "green>approved",
        ]);
        expect(ledger.item("gap").state).toBe("raised");

        // The orchestrator wrote each step's section, from its result.
        const cl = readFileSync(join(dir, "nail.md"), "utf8");
        expect(cl).toContain(
          "## Tests\n\n- behavior 1: `test/b1.test.mjs`, b1\n",
        );
        expect(cl).toContain("## Code\n\n- `src/value.mjs`\n");
        expect(cl).toContain("## Review\n\n- decision: approve\n");
        expect(readFileSync(join(dir, "gap.md"), "utf8")).toContain(
          "## Raise\n\n- from: da-nail, tests\n",
        );

        // The cl's branch holds the passed work: da-nail's test and da-hammer's code, each in its own commit.
        expect(git(repo, "show", "assembly/nail/head:src/value.mjs")).toBe(
          "export const value = 2;\n",
        );
        expect(
          git(repo, "log", "--format=%s", "main..assembly/nail/head")
            .trim()
            .split("\n"),
        ).toEqual(["da-hammer(nail): code", "da-nail(nail): tests"]);

        // Every attempt's record is kept.
        for (const n of [1, 2, 3])
          await vi.waitFor(
            () =>
              expect(existsSync(join(runs, "nail", String(n), "log"))).toBe(
                true,
              ),
            {
              timeout: 30_000,
            },
          );
      },
    );
  },
);
