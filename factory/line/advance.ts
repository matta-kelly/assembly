/**
 * The orchestrator's own moves: bookkeeping that starts nothing, decided by code from the ledger, each tick. Each goes
 * through the ledger's one door (apply), as the orchestrator.
 * - an issue building whose cls have all ended is built
 * - a built issue whose cls have all landed is accepted: the factory lands cls, and an issue is done when they are. One
 *   with a dropped cl waits at built for the operator, whose go accepts it
 * A waiting cl starts only at the operator's go (`start`). The issue's land writes its planner's spec as notes
 * (writePlan) and lands them on the notes' main.
 */

import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  clFields,
  clNote,
  clNotesOf,
  clPath,
  type PlanSpec,
  planNote,
  planPath,
  plannedOf,
  type Spec,
} from "../stations/plan.ts";
import type { Message } from "./step.ts";
import type { Item, Ledger } from "./ledger.ts";
import { mainOf } from "../repos/git.ts";
import { commitOf, type Notes, notesAt, writeNote } from "../repos/notes.ts";
import type { Reader } from "../repos/repo.ts";
import type { Registry } from "../repos/registry.ts";
import { move } from "../repos/move.ts";
import { runOf } from "../runs/runs.ts";
import { ends } from "./table.ts";

const link = (name: string) => `[[${name}]]`;

/** A message from the orchestrator, with no findings unless it relays some. */
const say = (
  word: Message["word"],
  reason: string,
  findings: Message["findings"] = [],
): Message => ({ word, reason, findings });

/**
 * Writes the spec the issue's planner last made as notes, in the notes worktree at `root`: the plan note, when it has
 * a plan, and a cl note per cut. The notes of its cls not landed go first, and so does a plan note the new spec has
 * none for: the new plan replaces them. The issue's land commits what it wrote.
 */
export function writePlan(ledger: Ledger, issue: Item, root: string) {
  const s = plannedOf(ledger, issue.name);
  if (!s) throw new Error(`${issue.name} has no plan to land`);
  const at = (path: string) => join(root, path);
  const landed = new Set(
    ledger
      .cls(issue.name)
      .filter((c) => c.state === "landed")
      .map((c) => c.name),
  );
  for (const name of clNotesOf(notesAt(root, "HEAD"), issue.note, issue.name))
    if (!landed.has(name)) rmSync(at(join(dirname(issue.note), `${name}.md`)));
  const plan = at(planPath(issue.note, issue.name));
  if (s.plan)
    writeNote(
      plan,
      {
        type: "plan",
        description: `The plan of ${issue.name}: why its cls are cut and ordered as they are. Read to see how ${issue.name} is cut.`,
        belongsTo: link(issue.name),
        status: "active",
      },
      planNote(issue.name, s as Spec & { plan: PlanSpec }),
      true,
    );
  else if (existsSync(plan)) rmSync(plan);
  for (const c of s.cls)
    writeNote(
      at(clPath(issue.note, issue.name, c.name)),
      clFields(issue.name, c, Boolean(s.plan)),
      clNote(c),
      true,
    );
}

/**
 * Brings an issue's cls in the ledger to its spec in the notes: a cl note not in the ledger goes in, after every cl
 * there, in its phase's order, with its phase and its repo, phase 1 ready and the rest waiting. With `drop`, a cl whose note is gone and that
 * has not landed is dropped. Every other cl keeps its state. Gives back the cls it added.
 */
export function reconcile(
  ledger: Ledger,
  issue: Item,
  s: Spec,
  drop = false,
): string[] {
  const had = ledger.cls(issue.name);
  const names = new Set(s.cls.map((c) => `${issue.name}-${c.name}`));
  if (drop)
    for (const c of had)
      if (!names.has(c.name) && !ends.includes(c.state))
        ledger.apply(c.name, say("drop", "its note is gone"), "operator");
  const seq = Math.max(0, ...had.map((c) => c.seq));
  const added: string[] = [];
  // In the plan's order: by phase, then as the notes list them.
  const byPhase = [...s.cls].sort((a, b) => (a.phase ?? 1) - (b.phase ?? 1));
  for (const c of byPhase) {
    const name = `${issue.name}-${c.name}`;
    if (had.some((h) => h.name === name)) continue;
    const phase = c.phase ?? 1;
    // Its repo: the one it names, of the issue's several, or the issue's one. The spec lint holds that it is there.
    const repo = issue.repos.find((p) => basename(p) === c.repo) ?? issue.repo;
    ledger.addCl(
      {
        name,
        issue: issue.name,
        seq: seq + added.length + 1,
        phase,
        note: clPath(issue.note, issue.name, c.name),
        repo,
      },
      "waiting",
    );
    added.push(name);
  }
  return added;
}

/** The notes at the notes repo's main as it is now: fetched, and read at its commit. */
export async function notesNow(repo: string): Promise<Notes> {
  const main = await mainOf(repo);
  const commit = commitOf(repo, main);
  if (!commit) throw new Error(`the notes repo ${repo} has no ${main}`);
  return notesAt(repo, commit);
}

/**
 * What the orchestrator's moves need of the world: where the items' folders are, the notes repo, its repos' files, the
 * tags a land put on main, and the registry.
 */
export interface World {
  runs: string; // the run folders: each item's worktree is in its own, and a move commits in its cl's
  notes: string; // the notes repo, whose main holds the spec: kinetic
  registry: Registry;
  reader: Reader;
  /** The version tags the land target of `repo` holds on `commit`, the commit main took for a landed cl. */
  tags(repo: string, commit: string): Promise<string[]>;
}

/** A version a waiting cl's repo takes from a landed cl of its issue: the package, the version, and the land's time. */
interface Moved {
  package: string;
  version: string;
  landed: string;
  since?: number;
}

/** A version tag crate puts on a commit: `v<version>` for the package at `.`, `<folder>-v<version>` for one in a folder. */
const versionTag = /^(?:(.+)-)?v(\d+\.\d+\.\d+\S*)$/;

/** The package names a repo's `package.json` depends on, runtime or dev. */
function dependsOn(reader: Reader, repo: string): Set<string> {
  const json = reader.file(repo, "package.json");
  if (json === undefined) return new Set();
  const p = JSON.parse(json) as Record<string, Record<string, string>>;
  return new Set([
    ...Object.keys(p.dependencies ?? {}),
    ...Object.keys(p.devDependencies ?? {}),
  ]);
}

/** When a landed cl landed, in ms. */
function landedAt(ledger: Ledger, cl: Item): number | undefined {
  const land = ledger.events(cl.name).findLast((e) => e.to_state === "landed");
  return land && Date.parse(land.at);
}

/**
 * The versions a waiting cl's repo needs from landed cls of its issue: each landed version tag whose package the repo
 * depends on, runtime or dev, in the order the lands and their tags come. Every one is moved.
 */
async function wanted(
  ledger: Ledger,
  cl: Item,
  world: World,
): Promise<Moved[]> {
  const needs = dependsOn(world.reader, cl.repo);
  if (!needs.size) return [];
  const moved: Moved[] = [];
  for (const landed of ledger.cls(cl.issue)) {
    if (landed.state !== "landed" || !landed.landed) continue;
    for (const tag of await world.tags(landed.repo, landed.landed)) {
      const [, folder, version] = versionTag.exec(tag) ?? [];
      if (!version) continue;
      const json = world.reader.file(
        landed.repo,
        folder ? `${folder}/package.json` : "package.json",
      );
      if (json === undefined) continue;
      const name = (JSON.parse(json) as { name?: string }).name;
      if (!name || !needs.has(name)) continue;
      const since = landedAt(ledger, landed);
      moved.push({
        package: name,
        version,
        landed: landed.name,
        ...(since === undefined ? {} : { since }),
      });
    }
  }
  return moved;
}

/**
 * Every version a waiting cl moves to, or why it still waits: one ask of the registry per version it needs, and no
 * move until every one of them is on npm. The moves run in the order wanted gives them.
 */
async function versionFor(
  ledger: Ledger,
  cl: Item,
  world: World,
): Promise<{ moved: Moved[]; held?: string }> {
  const moved = await wanted(ledger, cl, world);
  for (const m of moved) {
    if (!(await world.registry.published(m.package, m.version)))
      return {
        moved,
        held: `${m.package}@${m.version}, made by ${m.landed}, is not on npm yet`,
      };
  }
  return { moved };
}

export function advance(ledger: Ledger) {
  for (const issue of ledger.inState("building")) {
    const cls = ledger.cls(issue.name);
    if (cls.length && cls.every((c) => ends.includes(c.state)))
      ledger.apply(
        issue.name,
        say("pass", "its cls have all ended"),
        "orchestrator",
      );
  }
  for (const issue of ledger.inState("built")) {
    const cls = ledger.cls(issue.name);
    if (cls.length && cls.every((c) => c.state === "landed"))
      ledger.apply(
        issue.name,
        say("pass", "its cls have all landed on main"),
        "orchestrator",
      );
  }
}

/**
 * Starts a waiting cl, as the operator's go asks: its worktree moves onto each version its repo needs from its issue's
 * landed cls, each its own commit, then it is ready, and its inner loop runs. Gives back why it can't start yet: a
 * version not on npm yet, or a move that failed, with its output. A cl that can't start stays waiting.
 */
export async function start(
  ledger: Ledger,
  cl: Item,
  world: World,
): Promise<string | undefined> {
  let found;
  try {
    found = await versionFor(ledger, cl, world);
  } catch (e) {
    return `what it needs could not be read: ${(e as Error).message.slice(0, 400)}`;
  }
  const { moved, held } = found;
  if (held) return held;
  for (const m of moved) {
    try {
      await move(
        runOf(cl, 0, world.runs),
        m.package,
        m.version,
        world.registry.url,
      );
    } catch (e) {
      return `it could not move to ${m.package}@${m.version}: ${(e as Error).message.slice(0, 400)}`;
    }
  }
  ledger.apply(cl.name, say("pass", "the operator starts it"), "operator");
  return undefined;
}
