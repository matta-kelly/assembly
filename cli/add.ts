/**
 * What Matt does to the factory from the command line, each a message through the ledger's one door (apply), as Matt.
 * - add <issue.md>: an issue enters at open, for the factory's planner
 * - submit <issue> [--at <ref>]: an issue with the spec Matt made, read from kinetic at one commit, its cls and its plan
 *   beside it, enters at building: his pass at open and at plan review, so only the build and acceptance run it
 * - approve <issue>: his pass at plan review, for a plan the factory's planner made
 * - replan <issue>: an issue he holds, raised or escalated, back to open, its cls not landed dropped
 * Each is checked whole before anything is written, so a refusal leaves the ledger as it was.
 */

import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Built } from "../main.ts";
import { commitOf, notesAt, read, readAt } from "../effects/notes.ts";
import { kebab, readSpec, specLint, typeOf } from "../process/plan.ts";
import type { Message, Repo } from "../process/step.ts";
import {
  mainRef,
  type Reader,
  readerImage,
  reposOn,
  settingsOf,
} from "../effects/repo.ts";

/** What a command gives back: an exit code, and the lines it prints (to stderr when it refuses). */
export type Done = { code: number; lines: string[] };

const refused = (...lines: string[]): Done => ({ code: 1, lines });
const misused = (line: string): Done => ({ code: 2, lines: [line] });
const said = (word: Message["word"], reason: string): Message => ({
  word,
  reason,
  findings: [],
});

/**
 * What add and submit are given: the repos the issue may change, each by its path, or none, for every repo on crate
 * under `root`, among which its planner picks; and the tags of the dev images the host put on this machine, by repo
 * name. Each repo's image, full suite and setup are read from its main (effects/repo.ts).
 */
export interface Options {
  repos: string[];
  root?: string | undefined;
  dev?: Record<string, string> | undefined;
  read?: Reader | undefined;
  at?: string | undefined;
}

type At = { path: string; name: string; repos: Repo[]; done?: never };

/** The paths of the repos an issue may change: those given, else every repo on crate under the root. */
function given(o: Options): { paths: string[]; done?: never } | { done: Done } {
  const paths = (
    o.repos.length ? o.repos : o.root ? reposOn(o.root, o.read) : []
  ).map((each) => resolve(each));
  if (paths.length) return { paths };
  return {
    done: misused(
      o.root
        ? `no repo on crate under ${o.root}`
        : "an issue needs its repos: --repo, or a root to find every repo on crate under",
    ),
  };
}

/** The repos at `paths`, each with its settings read from its main, or why the issue can't be run. */
function reposFor(
  f: () => Built,
  name: string,
  paths: string[],
  o: Options,
): { repos: Repo[]; done?: never } | { done: Done } {
  const no = (done: Done) => ({ done });
  const repos: Repo[] = [];
  for (const repo of paths) {
    if (!existsSync(join(repo, ".git")))
      return no(refused(`${repo} is not a git repo`));
    const s = settingsOf(repo, o.dev, o.read);
    if (!s.ok) return no(refused(s.error));
    if (repos.some((r) => r.name === s.repo.name))
      return no(
        refused(
          `two repos are named ${s.repo.name}: a cl names its repo by its folder`,
        ),
      );
    repos.push(s.repo);
  }
  if (
    f()
      .ledger.items()
      .some((i) => i.name === name)
  )
    return no(refused(`${name} is in the ledger already`));
  return { repos };
}

/** The issue note at `note`, its name and its repos, or why it can't be one. */
function issueAt(
  f: () => Built,
  note: string,
  o: Options,
): At | { done: Done } {
  const no = (done: Done) => ({ done });
  const repos = given(o);
  if (repos.done) return repos;
  const path = resolve(note);
  const doc = read(path);
  if (!doc)
    return no(
      refused(existsSync(path) ? `${path} is empty` : `no note at ${path}`),
    );
  const type = typeOf(doc);
  if (type === "plan" || type === "cl")
    return no(
      refused(
        `${path} is a ${type}: submit its issue, which brings its plan and cls`,
      ),
    );
  if (type !== "issue")
    return no(
      refused(`${path}: its type is ${type || "not set"}: an issue is needed`),
    );
  const name = basename(path, ".md");
  if (!kebab.test(name))
    return no(refused(`${name}: an issue's name is kebab-case, from its note`));
  const got = reposFor(f, name, repos.paths, o);
  if (got.done) return got;
  return { path, name, repos: got.repos };
}

/** Puts the issue in the ledger at open: one of one repo in that repo's image, one of several in the reader's. */
function enter(f: () => Built, at: At) {
  f().ledger.addIssueAcross({
    name: at.name,
    path: at.path,
    image: readerImage,
    repos: at.repos,
  });
}

/** add <issue.md>: an issue at open, which the factory's planner plans. */
export function add(f: () => Built, note: string, o: Options): Done {
  const at = issueAt(f, note, o);
  if (at.done) return at.done;
  enter(f, at);
  return {
    code: 0,
    lines: [
      `added ${at.name}, open, in ${at.repos.map((r) => r.name).join(", ")}`,
    ],
  };
}

/** The folder of the kinetic repo that holds the issues' notes. */
const wellDir = "_well";

/**
 * submit <issue> [--at <ref>]: an issue with the spec Matt made, its note `_well/<issue>.md` in the kinetic repo (the
 * repo named kinetic among the issue's) and its plan and cls beside it. The spec is read with git at the commit `at`
 * (kinetic's server/main when none), never from the working tree, linted against the repo as the factory's own planner's
 * is (specLint), and kept with that commit. It enters at building, with his two passes.
 */
export function submit(f: () => Built, issue: string, o: Options): Done {
  if (!kebab.test(issue))
    return refused(`${issue}: an issue's name is kebab-case`);
  const paths = given(o);
  if (paths.done) return paths.done;
  const got = reposFor(f, issue, paths.paths, o);
  if (got.done) return got.done;
  const kinetic = paths.paths.find((p) => basename(p) === "kinetic");
  if (!kinetic)
    return refused(
      "a submit needs the kinetic repo among the repos: the one named kinetic",
    );
  const ref = o.at ?? mainRef;
  const note = `${wellDir}/${issue}.md`;
  const commit = commitOf(kinetic, ref);
  if (!commit || !readAt(kinetic, commit, note))
    return refused(`no note ${note} at ${ref} in ${kinetic}`);
  const spec = readSpec(note, issue, notesAt(kinetic, commit));
  if (!spec.ok) return refused(...spec.errors);
  const { ledger } = f();
  const lint = specLint(spec.spec, {
    taken: (c) => ledger.items().some((i) => i.name === `${issue}-${c}`),
    repos: got.repos.map((r) => r.name),
  });
  if (lint.word !== "pass") return refused(lint.reason);
  ledger.transaction(() => {
    ledger.addIssueAcross({
      name: issue,
      path: join(kinetic, note),
      image: readerImage,
      repos: got.repos,
    });
    ledger.apply(issue, said("pass", "Matt planned it"), "matt");
    ledger.keepSpec(issue, spec.spec, "matt", commit);
    ledger.apply(issue, said("pass", "Matt approved its plan"), "matt");
  });
  const n = spec.spec.cls.length;
  return {
    code: 0,
    lines: [
      `submitted ${issue}, building, with ${n} ${n === 1 ? "cl" : "cls"}:`,
      ...spec.spec.cls.map(
        (c) => `  ${issue}-${c.name}  phase ${c.phase ?? 1}`,
      ),
    ],
  };
}

/** approve <issue>: Matt's pass at plan review, in place of plan-review's. */
export function approve(f: () => Built, name: string): Done {
  const { ledger } = f();
  const i = ledger.items().find((x) => x.name === name);
  if (!i) return refused(`no item ${name} in the ledger`);
  if (i.state !== "planned")
    return refused(`${name} is ${i.state}: approve takes an issue at planned`);
  if (ledger.open().some((a) => a.name === name))
    return refused(`${name} has an attempt open: plan-review is judging it`);
  ledger.apply(name, said("pass", "Matt approved its plan"), "matt");
  return { code: 0, lines: [`approved ${name}, building`] };
}

/** replan <issue>: an issue Matt holds, back to open, its live cls not landed dropped, and its spec let go. */
export function replan(f: () => Built, name: string): Done {
  const { ledger } = f();
  const i = ledger.items().find((x) => x.name === name);
  if (!i) return refused(`no item ${name} in the ledger`);
  if (i.kind !== "issue" || (i.state !== "raised" && i.state !== "escalated"))
    return refused(
      `${name} is ${i.state}: replan takes an issue that is raised or escalated`,
    );
  if (ledger.open().some((a) => a.name === name))
    return refused(`${name} has an attempt open`);
  const rest = ledger
    .cls(name)
    .filter((c) => !["landed", "dropped"].includes(c.state));
  ledger.transaction(() => {
    for (const c of rest) {
      ledger.apply(c.name, said("drop", "Matt replans its issue"), "matt");
    }
    ledger.dropSpec(name);
    ledger.apply(
      name,
      said("replan", "Matt sends it back to be planned"),
      "matt",
    );
  });
  return {
    code: 0,
    lines: [
      `${name} is open, for the factory's planner`,
      ...rest.map((c) => `  ${c.name}  dropped`),
    ],
  };
}
