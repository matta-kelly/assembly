import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { items, section, setStatus, writeNote } from "./notes.ts";

const note =
  "---\ntype: cl\nstatus: new\n---\nIntent.\n\n## Check\n\n- b1\n\t- not an item\n- b2\n\n## Tests\n\nold\n";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "notes-"));
  file = join(dir, "n.md");
  writeFileSync(file, note);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const doc = () => readFileSync(file, "utf8");

describe("notes", () => {
  it("read a section, and its top-level items", () => {
    expect(section(file, "Tests").trim()).toBe("old");
    expect(items(file, "Check")).toEqual(["- b1", "- b2"]);
    expect(section(file, "Seam")).toBe("");
  });

  it("set a note's status in its frontmatter only", () => {
    setStatus(file, "done");
    expect(doc()).toMatch(/^---\ntype: cl\nstatus: done\n---/);
  });

  it("write a new note, quoting a value that needs it, and refuse one that is there unless told", () => {
    const p = join(dir, "new.md");
    writeNote(p, { type: "plan", belongsTo: "[[is]]" }, "Body.");
    expect(readFileSync(p, "utf8")).toBe(
      '---\ntype: plan\nbelongsTo: "[[is]]"\n---\nBody.\n',
    );
    expect(() => writeNote(p, { type: "plan" }, "Again.")).toThrow(
      /there already/,
    );
    writeNote(p, { type: "plan" }, "Again.", true);
    expect(readFileSync(p, "utf8")).toContain("Again.");
  });

  it("quote a value with a newline or a leading YAML mark, so the frontmatter keeps one line per field", () => {
    const p = join(dir, "cut.md");
    writeNote(p, { description: "two\nlines", status: "- new" }, "Body.");
    expect(readFileSync(p, "utf8")).toBe(
      '---\ndescription: "two\\nlines"\nstatus: "- new"\n---\nBody.\n',
    );
  });
});
