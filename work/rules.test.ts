// The lint rules between a plan and its cls, each on a root that fails it and one that passes.
import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintRoot } from "@mku1tra/basis";

const schema = JSON.stringify(import.meta.resolve("./src/schema.ts"));
const basis = JSON.stringify(import.meta.resolve("@mku1tra/basis"));

const note = (fields: Record<string, string>, body = "Body.") =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n${body}\n`;
const issue = note(
  {
    type: "issue",
    description: '"An issue."',
    kind: "feature",
    priority: "P2",
    status: "new",
  },
  "Intent.\n\n## Done\n\n- a claim\n",
);
const plan = note({
  type: "plan",
  description: '"A plan."',
  belongsTo: '"[[is]]"',
  status: "active",
});
const cl = (phase: number | undefined, checkout: string[], plan = "is-plan") =>
  note({
    type: "cl",
    description: '"A cl."',
    belongsTo: `"[[${plan}]]"`,
    status: "new",
    ...(phase === undefined ? {} : { phase: String(phase) }),
    shape: "{change: behavior, checked: repo}",
    checkout: JSON.stringify(checkout),
    test: "npm test",
  });

/** The problems of a root holding `notes` beside the issue and its plan, by rule. */
async function problems(
  notes: Record<string, string>,
  planFile = "is-plan.md",
) {
  const folder = await mkdtemp(join(tmpdir(), "work-rules-"));
  try {
    const files: Record<string, string> = {
      "package.json": '{ "type": "module" }\n',
      "basis.config.ts": `import { defineSchema } from ${basis};\nimport work from ${schema};\nexport default { schema: defineSchema({ name: "fixture", types: {}, imports: [work], notes: new URL("./", import.meta.url) }) };\n`,
      "is.md": issue,
      [planFile]: plan,
      ...notes,
    };
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(folder, path, ".."), { recursive: true });
      await writeFile(join(folder, path), text);
    }
    return (await lintRoot(folder)).problems.map(
      (p) => `${p.rule} ${p.path} ${p.message}`,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("a plan and cls that fit pass: phases 1, 1, 2", async () => {
  assert.deepEqual(
    await problems({
      "is-a.md": cl(1, ["src/a.ts"]),
      "is-b.md": cl(1, ["src/b/"]),
      "is-c.md": cl(2, ["src/a.ts"]),
    }),
    [],
  );
});

test("a plan whose phases have a gap fails work/phases", async () => {
  const found = await problems({
    "is-a.md": cl(1, ["a.ts"]),
    "is-c.md": cl(3, ["c.ts"]),
  });
  assert.equal(found.length, 1);
  assert.match(found[0]!, /^work\/phases .*no cl in phase 2/);
});

test("a cl of a plan with no phase fails work/phases", async () => {
  const found = await problems({
    "is-a.md": cl(1, ["a.ts"]),
    "is-b.md": cl(undefined, ["b.ts"]),
  });
  assert.equal(found.length, 1);
  assert.match(found[0]!, /^work\/phases .*no phase: is-b/);
});

test("a plan not named for its issue fails work/plan-name", async () => {
  const found = await problems(
    { "x-a.md": cl(1, ["a.ts"], "x-plan") },
    "x-plan.md",
  );
  assert.deepEqual(found.map((f) => f.split(" ")[0]).sort(), [
    "work/cl-name",
    "work/plan-name",
  ]);
});

test("a cl not named for its issue fails work/cl-name", async () => {
  const found = await problems({ "other-a.md": cl(1, ["a.ts"]) });
  assert.equal(found.length, 1);
  assert.match(found[0]!, /^work\/cl-name .*named is-<cut>/);
});
