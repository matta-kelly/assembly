import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { door, remote } from "./door.ts";
import { workVerbs } from "./work.ts";

const through = (command?: string) => {
  const main = vi.fn(async () => 0);
  const env = command === undefined ? {} : { SSH_ORIGINAL_COMMAND: command };
  return { main, code: door(env, main) };
};

afterEach(() => vi.restoreAllMocks());

describe("door", () => {
  it("runs a remote verb with its arguments", async () => {
    const { main, code } = through(
      "factory resume factory-ssh-key-mount ready",
    );
    expect(await code).toBe(0);
    expect(main).toHaveBeenCalledWith([
      "resume",
      "factory-ssh-key-mount",
      "ready",
    ]);
  });

  it("lets every lever and report through, and never run or door", () => {
    expect(remote).toEqual([
      "submit",
      "stop",
      "resume",
      "drop",
      "rebase",
      "go",
      "note",
      "compact",
      "status",
      "blocked",
      "explain",
      "top",
    ]);
  });

  it("takes a verb with or without factory before it", async () => {
    const { main, code } = through("status");
    expect(await code).toBe(0);
    expect(main).toHaveBeenCalledWith(["status"]);
  });

  it("refuses run, door, an unknown verb, a shell, and no command", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const c of [
      "factory run",
      "factory door",
      "factory rm -rf /",
      "ls",
      "bash",
      "",
      undefined,
    ]) {
      const { main, code } = through(c);
      expect(await code).toBe(1);
      expect(main).not.toHaveBeenCalled();
    }
    expect(err).toHaveBeenCalledWith(
      expect.stringMatching(/runs only: <verb> \[args...\], the verbs submit/),
    );
  });

  it("gives work on code only to a caller with a desk, and records each call with its caller, never its stdin", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const main = vi.fn(async () => 0);
    // the laptop's old door: the factory's verbs alone
    expect(await door({ SSH_ORIGINAL_COMMAND: "worktrees" }, main)).toBe(1);
    const home = mkdtempSync(join(tmpdir(), "door-"));
    const log = join(home, "door.log");
    const way = {
      caller: "loke",
      input: async () => "the secret body",
      log,
      desk: { repos: join(home, "repos"), worktrees: join(home, "worktrees") },
    };
    expect(await door({ SSH_ORIGINAL_COMMAND: "worktrees" }, main, way)).toBe(
      0,
    );
    expect(
      await door({ SSH_ORIGINAL_COMMAND: "factory note x da-nail" }, main, way),
    ).toBe(0);
    expect(main).toHaveBeenCalledWith(["note", "x", "da-nail"]);
    const lines = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map(
        (l) =>
          JSON.parse(l) as { caller: string; verb: string; args: string[] },
      );
    expect(lines.map((l) => [l.caller, l.verb, l.args])).toEqual([
      ["loke", "worktrees", []],
      ["loke", "note", ["x", "da-nail"]],
    ]);
    expect(readFileSync(log, "utf8")).not.toContain("secret body");
    expect(workVerbs).not.toContain("run-anything");
    err.mockRestore();
  });
});
