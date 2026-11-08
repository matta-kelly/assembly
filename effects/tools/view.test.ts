import { describe, expect, it } from "vitest";
import { files, fromRoot, sees, under, writes } from "./view.ts";

const v = {
  read: ["README", "src/lib/a.ts"],
  change: ["src/b.ts", "test/b.test.ts"],
};

describe("a path, from the repo's root", () => {
  it("takes /work, ./ and folders' trailing slashes as the same path", () => {
    expect(fromRoot("/work")).toBe("");
    expect(fromRoot(".")).toBe("");
    expect(fromRoot("/work/src/b.ts")).toBe("src/b.ts");
    expect(fromRoot("./src//lib/")).toBe("src/lib");
  });

  it("is undefined when it leaves the worktree", () => {
    expect(fromRoot("..")).toBeUndefined();
    expect(fromRoot("src/../../etc/passwd")).toBeUndefined();
    expect(fromRoot("/etc/passwd")).toBeUndefined();
    expect(fromRoot("/workspace/x")).toBeUndefined();
  });
});

describe("the view", () => {
  it("holds its files once each", () => {
    expect(files({ read: ["a", "./a"], change: ["a"] })).toEqual(["a"]);
  });

  it("sees its files, the folders above them and the root, and nothing else", () => {
    for (const p of [
      "README",
      "/work/src/lib/a.ts",
      "src",
      "src/lib/",
      ".",
      "test",
    ])
      expect(sees(v, p), p).toBe(true);
    for (const p of [
      "src/c.ts",
      "src/b.ts.bak",
      "src/li",
      "lib",
      "../README",
      "/etc",
    ])
      expect(sees(v, p), p).toBe(false);
  });

  it("writes only its change files", () => {
    expect(writes(v, "src/b.ts")).toBe(true);
    expect(writes(v, "/work/test/b.test.ts")).toBe(true);
    for (const p of [
      "README",
      "src/lib/a.ts",
      "src",
      ".",
      "src/b.ts.bak",
      "../src/b.ts",
    ])
      expect(writes(v, p), p).toBe(false);
  });

  it("lists what it holds under a folder: its files there, and the folders on the way to the rest", () => {
    expect(under(v, ".")).toEqual(["README", "src/", "test/"]);
    expect(under(v, "src")).toEqual(["src/b.ts", "src/lib/"]);
    expect(under(v, "nope")).toEqual([]);
    expect(under(v, "..")).toEqual([]);
  });
});
