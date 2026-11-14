/**
 * `remove`: takes a file out of /work, the cl's worktree, for nail and hammer. Whatever /work holds is the cl's change,
 * so a builder that can add and edit a file can remove one too: a scratch file it left, or a file its cl retires. What
 * a builder may touch is its step's check, at its hand-in, which counts a removed file as touched (factory/stations/hammer.ts).
 */

import { lstatSync, rmSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { defineTool, type Runtime } from "@mku1tra/que-pasa/define";
import { z } from "zod";
import { type Context, current } from "../../factory/runs/runs.ts";

/** The path inside the worktree that `path` names, as /work/<path> or from the repo's root, or undefined for none. */
export function inWork(path: string): string | undefined {
  const rel = normalize(path.replace(/^\/work(\/|$)/, ""));
  if (!rel || rel === "." || isAbsolute(rel) || rel.startsWith(".."))
    return undefined;
  // git's own, never the change's
  if (rel === ".git" || rel.startsWith(".git/")) return undefined;
  return rel;
}

export const remove = defineTool({
  name: "remove",
  description:
    "Removes one file from /work, the cl's worktree, so it is no longer in the change: a path under /work, or one from the repo's root. A file only, never a folder.",
  schema: z.object({
    path: z.string().describe("the file to remove, under /work"),
  }),
  // Replay-safe: a file removed twice is removed.
  run: async ({ path }, runtime: Runtime<Context>) => {
    const rel = inWork(path);
    if (!rel) return `Error: ${path} is not a file in /work`;
    const at = join(current(runtime.context).work, rel);
    let isDir: boolean;
    try {
      isDir = lstatSync(at).isDirectory();
    } catch {
      return `Error: no file ${path}`;
    }
    if (isDir) return `Error: ${path} is a folder; remove takes a file`;
    rmSync(at);
    return `Removed ${path}`;
  },
});
