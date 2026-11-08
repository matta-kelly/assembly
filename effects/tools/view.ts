/**
 * A bound agent's view of the worktree: its cut's files, and the folders on the way to them. A path outside the view
 * is not refused; to the agent it does not exist, so its tools answer as they would for a missing path. A path that
 * leaves the worktree is never in a view.
 */

import { posix } from "node:path";
import type { View } from "../../process/step.ts";

/**
 * A path as the agent gives it (from /work, or relative to it), as a path from the repo's root: "" for the root, and
 * undefined for a path that leaves the worktree.
 */
export function fromRoot(path: string): string | undefined {
  let p = path.trim();
  if (p === "/work") p = ".";
  else if (p.startsWith("/work/")) p = p.slice("/work/".length);
  if (posix.isAbsolute(p)) return undefined;
  const n = posix.normalize(p).replace(/\/+$/, "");
  if (n === ".." || n.startsWith("../")) return undefined;
  return n === "." ? "" : n;
}

/** Every file of the view, from the repo's root, once each. */
export function files(v: View): string[] {
  return [
    ...new Set(
      [...v.read, ...v.change].map(fromRoot).filter((f): f is string => !!f),
    ),
  ];
}

/** Whether the path is in the view: one of its files, or a folder above one. */
export function sees(v: View, path: string): boolean {
  const p = fromRoot(path);
  if (p === undefined) return false;
  if (p === "") return true;
  return files(v).some((f) => f === p || f.startsWith(`${p}/`));
}

/** Whether the agent may write the path: one of the change files. */
export function writes(v: View, path: string): boolean {
  const p = fromRoot(path);
  return !!p && v.change.map(fromRoot).includes(p);
}

/**
 * What the view holds directly under a folder: each of its files there, and each folder on the way to one deeper,
 * with a trailing slash. From the repo's root, sorted.
 */
export function under(v: View, folder: string): string[] {
  const p = fromRoot(folder);
  if (p === undefined) return [];
  const prefix = p ? `${p}/` : "";
  const out = new Set<string>();
  for (const f of files(v)) {
    if (!f.startsWith(prefix)) continue;
    const [first, ...rest] = f.slice(prefix.length).split("/");
    out.add(`${prefix}${first}${rest.length ? "/" : ""}`);
  }
  return [...out].sort();
}
