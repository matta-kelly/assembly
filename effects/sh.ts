/** Runs a command on the host: git and podman, for every effect that needs one. */

import { spawn } from "node:child_process";

/** A command's exit code and its output, stdout then stderr. */
export interface Ran {
  code: number;
  out: string; // stdout and stderr, as a person or a model reads them
  stdout: string; // stdout alone: what a command gives back as data
}

/**
 * Runs a command, with `stdin` as its input and `env` as its environment, and gives back its exit code and output. It
 * never throws on a non-zero exit. When `signal` aborts, the command is killed, and it throws.
 */
export function sh(
  command: string,
  args: string[],
  stdin?: string,
  env?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<Ran> {
  return new Promise((resolve, reject) => {
    // No input is no stdin at all: a pipe nobody reads fails with EPIPE when the command exits first.
    const child = spawn(command, args, {
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      ...(env ? { env } : {}),
      ...(signal ? { signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code: code ?? 1, out: stdout + stderr, stdout }),
    );
    if (child.stdin) {
      // A command may exit without reading all its input; its exit code says how it went.
      child.stdin.on("error", () => undefined);
      child.stdin.end(stdin);
    }
  });
}

/** Runs a command that must succeed, and gives back its output. */
export async function must(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const r = await sh(command, args, undefined, env);
  if (r.code !== 0)
    throw new Error(
      `${command} ${args.join(" ")}: exit ${r.code}: ${r.out.slice(-400)}`,
    );
  return r.stdout;
}
