import { afterEach, describe, expect, it, vi } from "vitest";
import { door, remote } from "./door.ts";

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
      "status",
      "blocked",
      "explain",
      "top",
    ]);
  });

  it("refuses run, door, an unknown verb, anything not factory, and no command", async () => {
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
      expect.stringMatching(/runs only: factory <verb>/),
    );
    expect(err).toHaveBeenCalledWith(
      expect.stringMatching(/the verbs here are submit/),
    );
  });
});
