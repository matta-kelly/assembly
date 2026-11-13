/**
 * The orchestrator's own moves: the ones no agent makes, decided by code from the ledger, each tick. Each goes through
 * the ledger's one door (apply), as the orchestrator.
 * - an issue building with no cl left to land: its notes at the notes' main are read, and each cl note not in the
 *   ledger goes in, with its phase. With none to add, and its cls all landed or dropped, the issue is built, and its
 *   acceptance starts
 * - a phase starts once every cl of the phases before it has landed on main, and all its cls start together. A cl
 *   whose repo depends on a package a landed cl made waits until that version is on npm, with why as its last message;
 *   a wait past its limit escalates the issue
 * - a cl that raised, or is escalated, escalates its issue, its message and findings with it: Matt fixes the notes and
 *   resumes it
 * The issue's land writes its planner's spec as notes (writePlan) and lands them on the notes' main.
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
  readSpec,
  type Spec,
} from "../process/plan.ts";
import type { Message } from "../process/step.ts";
import type { Item, Ledger } from "./ledger.ts";
import { mainOf } from "../effects/git.ts";
import { commitOf, type Notes, notesAt, writeNote } from "../effects/notes.ts";
import type { Reader } from "../effects/repo.ts";
import type { Registry } from "../effects/registry.ts";
import { move } from "../effects/move.ts";
import { runOf } from "../effects/runs.ts";
import { forgetSetup } from "../effects/setup.ts";
import { ends } from "../process/table.ts";

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
        ledger.apply(c.name, say("drop", "its note is gone"), "matt");
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
      phase === 1 ? "ready" : "waiting",
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

const live = (c: Item) => c.state !== "dropped" && c.state !== "raised";

/**
 * Makes one item's move. A move that fails (notes that do not read as a spec) escalates the item, with why: the
 * factory cannot fix it, and the other items go on.
 */
async function guarded(ledger: Ledger, item: Item, move: () => unknown) {
  try {
    await move();
  } catch (e) {
    ledger.apply(
      item.name,
      say(
        "escalate",
        `the orchestrator's move failed: ${(e as Error).message.slice(0, 400)}`,
      ),
      "orchestrator",
    );
  }
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
  /** The longest a cl waits for a version, counted from the land that made it: 30 minutes when not set. */
  limitMs?: number;
}

/** The wait limit when the factory sets none. */
const defaultLimitMs = 30 * 60_000;

/** Why a cl still waits for a version, and what it waits for: its package and version, and when the land made it. */
interface Hold {
  reason: string;
  package?: string;
  version?: string;
  since?: number;
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
): Promise<{ moved: Moved[]; held?: Hold }> {
  const moved = await wanted(ledger, cl, world);
  for (const m of moved) {
    if (!(await world.registry.published(m.package, m.version)))
      return {
        moved,
        held: {
          reason: `${m.package}@${m.version}, made by ${m.landed}, is not on npm yet`,
          package: m.package,
          version: m.version,
          ...(m.since === undefined ? {} : { since: m.since }),
        },
      };
  }
  return { moved };
}

/**
 * Moves a released cl's worktree onto the version it needs, so its attempts run on it: their dev image is made from the
 * worktree, and its setup runs again. A failure escalates its issue, with the command's output, and leaves the cl
 * waiting. Gives back whether the cl may start.
 */
async function released(
  ledger: Ledger,
  cl: Item,
  m: Moved,
  world: World,
): Promise<boolean> {
  try {
    const tree = runOf(cl, 0, world.runs);
    await move(tree, m.package, m.version, world.registry.url);
    forgetSetup(tree);
    return true;
  } catch (e) {
    ledger.apply(
      cl.issue,
      say(
        "escalate",
        `${cl.name} could not move to ${m.package}@${m.version}: ${(e as Error).message.slice(0, 400)}`,
      ),
      "orchestrator",
    );
    return false;
  }
}

/**
 * Keeps a waiting cl waiting, with why. The reason is written when it differs from the last one written, so many ticks
 * for one reason leave one message. A wait past its limit escalates the cl's issue, once.
 */
function hold(ledger: Ledger, cl: Item, h: Hold, world: World) {
  const last = ledger.events(cl.name).findLast((e) => e.word === "retry");
  if (last?.reason !== h.reason)
    ledger.apply(cl.name, say("retry", h.reason), "orchestrator");
  if (h.since === undefined) return;
  const waited = Date.now() - h.since;
  if (waited <= (world.limitMs ?? defaultLimitMs)) return;
  if (ledger.item(cl.issue).state === "escalated") return;
  const what = h.package
    ? `waits for ${h.package}@${h.version} to be on npm`
    : `cannot ask what it waits for (${h.reason})`;
  ledger.apply(
    cl.issue,
    say(
      "escalate",
      `${cl.name} ${what}: ${Math.floor(waited / 60_000)} min, past its limit`,
    ),
    "orchestrator",
  );
}

export async function advance(ledger: Ledger, world: World) {
  // The notes at main, read once a tick, and only when an issue building has no cl left to land.
  let notes: Notes | undefined;
  for (const issue of ledger.inState("building"))
    await guarded(ledger, issue, async () => {
      const cls = ledger.cls(issue.name);
      if (cls.some((c) => !ends.includes(c.state))) return;
      notes ??= await notesNow(world.notes);
      const read = readSpec(notes, issue.note, issue.name);
      if (!read.ok) throw new Error(read.errors.join("; "));
      // Built once every cl of its notes is in the ledger and has landed or is dropped.
      if (!reconcile(ledger, issue, read.spec).length)
        ledger.apply(
          issue.name,
          say("pass", "its cls have all landed"),
          "orchestrator",
        );
    });

  // A phase starts once every cl of the phases before it has landed or been dropped: a raised cl has not landed.
  for (const cl of ledger.inState("waiting")) {
    // An issue escalated waits for Matt: its waiting cls move nothing, and start nothing.
    if (ledger.inState("escalated").some((e) => e.name === cl.issue)) continue;
    const before = ledger
      .cls(cl.issue)
      .filter(
        (c) =>
          c.state !== "dropped" &&
          (c.phase ?? 1) < (cl.phase ?? 1) &&
          c.state !== "landed",
      );
    if (before.length) continue;
    // A failed ask is a reason too: the cl waits and the others go on. Its limit counts from the last land before the cl.
    const since = Math.max(
      ...ledger
        .cls(cl.issue)
        .filter((c) => live(c) && (c.phase ?? 1) < (cl.phase ?? 1))
        .map((c) => landedAt(ledger, c) ?? -Infinity),
    );
    let moved: Moved[] = [];
    let held: Hold | undefined;
    try {
      ({ moved, held } = await versionFor(ledger, cl, world));
    } catch (e) {
      held = {
        reason: (e as Error).message.slice(0, 400),
        ...(Number.isFinite(since) ? { since } : {}),
      };
    }
    if (held) {
      hold(ledger, cl, held, world);
      continue;
    }
    // Its worktree takes each version it needs, each its own commit, before its first attempt. A move that fails
    // escalates the issue, and the cl waits.
    let allMoved = true;
    for (const m of moved)
      if (!(await released(ledger, cl, m, world))) {
        allMoved = false;
        break;
      }
    if (!allMoved) continue;
    ledger.apply(
      cl.name,
      say(
        "pass",
        `phase ${cl.phase ?? 1} starts: the phases before it have landed`,
      ),
      "orchestrator",
    );
  }

  // A cl held for Matt holds its issue: the raise's message, or the escalation, goes to the issue, with its findings.
  for (const cl of ledger
    .items()
    .filter(
      (c) =>
        c.kind === "cl" && (c.state === "raised" || c.state === "escalated"),
    )) {
    if (ledger.item(cl.issue).state !== "building") continue;
    const last = ledger.events(cl.name).at(-1);
    ledger.apply(
      cl.issue,
      say(
        "escalate",
        `${cl.name} is ${cl.state}${last?.reason ? `: ${last.reason}` : ""}`,
        last?.findings ?? [],
      ),
      "orchestrator",
    );
  }
}
