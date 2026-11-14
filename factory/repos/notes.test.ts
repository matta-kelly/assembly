import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { itemsIn, notesAt, notesOf, sectionIn, writeNote } from "./notes.ts";
import { notesRepo } from "./notes.fixture.ts";

const note =
  "---\ntype: cl\nstatus: new\n---\nIntent.\n\n## Promises\n\n- b1\n\t- not an item\n- b2\n\n## Tests\n\nold\n";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "notes-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("notes", () => {
  it("read a section, and its top-level items", () => {
    expect(sectionIn(note, "Tests").trim()).toBe("old");
    expect(itemsIn(note, "Promises")).toEqual(["- b1", "- b2"]);
    expect(sectionIn(note, "Seam")).toBe("");
  });

  it("are read at a commit, never from the working tree: a later commit, or an edit not committed, is not seen", () => {
    const repo = notesRepo({ "_well/n.md": note });
    const later = repo.commit({
      "_well/n.md": "changed\n",
      "_well/m.md": "m\n",
    });
    writeFileSync(join(repo.repo, "_well", "n.md"), "not committed\n");
    const at = notesOf({ notes: repo.first });
    expect(at.text("_well/n.md")).toBe(note);
    expect(at.names("_well")).toEqual(["n.md"]);
    expect(at.text("_well/m.md")).toBe("");
    expect(notesAt(repo.repo, later.commit).text("_well/n.md")).toBe(
      "changed\n",
    );
    rmSync(repo.repo, { recursive: true, force: true });
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
