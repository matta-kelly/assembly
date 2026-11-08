import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Run } from "../../process/step.ts";
import { exec } from "../sandbox.ts";
import {
  edit_file,
  glob,
  grep,
  ls,
  read_file,
  test,
  write_file,
} from "./index.ts";

vi.mock("../sandbox.ts", () => ({ exec: vi.fn() }));
vi.mock("../runs.ts", () => ({ log: vi.fn() }));

const run = { name: "is-b", test: "node --test test/b.test.ts" } as Run;
const view = { read: ["README"], change: ["src/b.ts", "test/b.test.ts"] };
const bound = { context: { run, view } };
const free = { context: { run } };
const ran = (code: number, out: string) => ({ code, out, stdout: out });

/** Calls a tool as que-pasa does: its input, parsed by its schema, and the runtime. */
const call = <
  T extends { schema: { parse(x: unknown): unknown }; run: unknown },
>(
  tool: T,
  input: object,
  runtime: object,
) =>
  (tool.run as (i: unknown, r: unknown) => Promise<string>)(
    tool.schema.parse(input),
    runtime,
  );

beforeEach(() => vi.resetAllMocks());

describe("a bound agent's file tools", () => {
  it("read_file answers a file outside the view as it answers a missing one, word for word", async () => {
    vi.mocked(exec).mockResolvedValue(ran(1, "no such file: src/c.ts\n"));
    const missing = await call(read_file, { path: "src/c.ts" }, free);
    const outside = await call(read_file, { path: "src/c.ts" }, bound);
    expect(outside).toBe(missing);
    expect(exec).toHaveBeenCalledOnce();
  });

  it("read_file reads a file in the view from the sandbox", async () => {
    vi.mocked(exec).mockResolvedValue(ran(0, "     1\ta repo\n"));
    expect(await call(read_file, { path: "README" }, bound)).toBe(
      "     1\ta repo\n",
    );
    expect(vi.mocked(exec).mock.calls[0]?.[2]).toEqual(["README", "0", "2000"]);
  });

  it("ls lists only what the view holds and is there, and a folder outside it as missing", async () => {
    vi.mocked(exec).mockResolvedValue(ran(0, "./\nREADME\nsrc/\n"));
    expect(await call(ls, { path: "." }, bound)).toBe("README\nsrc/");
    // the folder itself, then what the view holds under it, asked of the sandbox
    expect(vi.mocked(exec).mock.calls[0]?.[2]).toEqual(
      ["", "README", "src", "test"].map((p) => p || "."),
    );
    vi.mocked(exec).mockClear();
    expect(await call(ls, { path: "lib" }, bound)).toBe(
      "exit 2\nls: cannot access 'lib': No such file or directory\n",
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("write_file and edit_file write only the change files, and never touch the sandbox for another", async () => {
    expect(
      await call(write_file, { path: "README", content: "x" }, bound),
    ).toMatch(
      /README is not a file this cl changes: it changes src\/b.ts, test\/b.test.ts/,
    );
    expect(
      await call(edit_file, { path: "src/c.ts", old: "a", new: "b" }, bound),
    ).toMatch(/not a file this cl changes/);
    expect(exec).not.toHaveBeenCalled();
    vi.mocked(exec).mockResolvedValue(ran(0, ""));
    expect(
      await call(write_file, { path: "src/b.ts", content: "x" }, bound),
    ).toBe("wrote src/b.ts");
  });

  it("glob and grep look only at the view's files that are there", async () => {
    vi.mocked(exec).mockResolvedValueOnce(ran(0, "README\nsrc/b.ts\n"));
    expect(await call(glob, { pattern: "**/*.ts" }, bound)).toBe("src/b.ts");
    vi.mocked(exec)
      .mockResolvedValueOnce(ran(0, "README\nsrc/b.ts\n"))
      .mockResolvedValueOnce(ran(0, "src/b.ts:1:export const b = 1;\n"));
    expect(await call(grep, { text: "const b" }, bound)).toBe(
      "src/b.ts:1:export const b = 1;\n",
    );
    expect(vi.mocked(exec).mock.calls.at(-1)?.[2]).toEqual([
      "const b",
      "README",
      "src/b.ts",
    ]);
  });
});

describe("a bound agent's paths", () => {
  it("ls lists a file in the view as itself", async () => {
    vi.mocked(exec).mockResolvedValue(ran(0, "README\n"));
    expect(await call(ls, { path: "README" }, bound)).toBe("README");
  });

  it("hands the sandbox the path the view checked, not the one given", async () => {
    vi.mocked(exec).mockResolvedValue(ran(0, ""));
    await call(write_file, { path: "/work/./src/b.ts", content: "x" }, bound);
    expect(vi.mocked(exec).mock.calls[0]?.[2]).toEqual(["src/b.ts"]);
    await call(write_file, { path: "src/b.ts ", content: "x" }, bound);
    expect(vi.mocked(exec).mock.calls[1]?.[2]).toEqual(["src/b.ts"]);
  });

  it("glob and grep find nothing under a folder outside the worktree", async () => {
    expect(await call(glob, { pattern: "**", path: "/etc" }, bound)).toBe(
      "no files match",
    );
    expect(await call(grep, { text: "x", path: "../" }, free)).toBe(
      "no matches",
    );
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("an unbound agent's file tools", () => {
  it("see the whole worktree", async () => {
    vi.mocked(exec).mockResolvedValue(ran(0, "total 0\n"));
    await call(ls, { path: "lib" }, free);
    expect(vi.mocked(exec).mock.calls[0]?.[1]).toBe('ls -la -- "$1"');
    vi.mocked(exec).mockResolvedValueOnce(ran(0, "a.ts\nlib/c.ts\n"));
    expect(await call(glob, { pattern: "**/*.ts" }, free)).toBe(
      "a.ts\nlib/c.ts",
    );
  });
});

describe("test", () => {
  it("runs the cl's test command, and gives back its exit code and output", async () => {
    vi.mocked(exec).mockResolvedValue(ran(1, "AssertionError\n"));
    expect(await call(test, {}, bound)).toBe("exit 1\nAssertionError\n");
    expect(vi.mocked(exec).mock.calls[0]?.[1]).toBe(
      "node --test test/b.test.ts",
    );
  });
});
