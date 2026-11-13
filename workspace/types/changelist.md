---
type: doc
description: "A changelist (CL): one self-contained change to main, what a good one is, its kinds, its note (the cl: its Promises, Seam and Checkout), and its parts: workspace, branch and commits. Use when cutting, making or judging a CL."
status: active
---
A changelist (CL): one self-contained change, submitted to main or under review ([Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)). Every change to the code is a CL, because every change is reviewed (SWE at Google, ch. 9). The name is Google's; other organisations call it a change, a patch or a pull request.

Like an issue, a CL is a piece of intent plus the check that says it is met: its intent is one sentence of done, and its check is a test for each of its promises ([[terms#promise]]). It is a leaf of its issue, or a confirmed cut of its issue's plan ([[plan]]). Its input is its cl note: the cut, with every file and fact the CL needs ([[#The cl note]]).
- [[#Good CL]] what a CL must be
- [[#Kinds]] what a CL does to promises, and so to its tests
- [[#The cl note]] its spec: its promises, its phase and its seam
- [[#Parts]] workspace, branch, commits
- [[#Joining main]] the review and the gate

- [[spine#The checks]]: the map, a cl landed on main
- [[issue]]: where a CL comes from
- [[plan]]: how CLs are cut from an issue, and how they link
- [[cl]]: the type of its note
- [[daworks/assembly/workspace/agents/cl-review|review]]: how one is reviewed

---
## Good CL

- one thing: "a minimal change that addresses just one thing", usually one part of a feature, not the whole feature. One sentence of done
- small: around 100 lines, easy to review. When unsure, too small beats too large
- tested: it carries its own tests, one for each promise it adds or changes ([[terms#promise]], [[tests]])
- understood alone: everything the reviewer needs is in the CL, its description, the codebase, or a CL they already reviewed
- stands alone: "the system will continue to work well for its users and for the developers after the CL is checked in"
- a refactor is its own CL, apart from features and fixes
- a new API comes with a use of it, in the same CL
- one worker at a time: you, or the factory's agents. The tests and the code have different authors: da-nail and da-hammer
- an issue can take more than one CL

## Kinds

What the CL does to promises, and so to their tests. The commit type names the kind

- refactor (`refactor`): no test changes. The tests that exist still pass
- feature (`feat`): new tests only, written first and kept
- fix (`fix`): adds the missing test, written first and kept
- a changed promise: existing tests change. This is the only kind where that should happen, and the most expensive. The test author changes them, and names each one with the promise that changed it
- no promises
	- `test`: each test that stays is seen to fail; no code changes
	- `ci`, `chore`: the checks accept it, the real run proves it, and a smoke check watches it after
	- `docs`: the format and lint checks, and review

## The cl note

The spec of one CL, written before any of it is built, as a contract (Design by Contract: Hoare, 1969; Meyer, 1986): its Promises section holds its promises, its `phase` what must land before it, its Seam what it keeps. The body that meets it is its builders'. Its type is [[cl]], whose type note says what each part holds: its first line, its Promises, its Seam and its Checkout.

## Parts

- issue: what it comes from ([[issue]]). The commit message points to it: "Updates #n" for a step, "Fixes #n" on the last
- workspace ([[workspace]]): one worktree per CL, on a short branch from origin/main
	- never from local main or another workspace
	- it lives until the CL lands on main, then it is removed ([[workspace]])
- branch: one per change, made from `origin/main`
	- named `type/what-changes`
	- the tests are committed before the code
- commits: [Conventional Commits](https://www.conventionalcommits.org) form
	- `type(scope): what changed`
		- types: `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`
	- the commit message carries what a pull request carried: what and why, the decisions, the checks
	- a decision: a choice between ways, with the other way and why it is worse. A new pattern is one, written with the pattern it did not use
	- no attribution lines from agents

## Joining main

- in: the local diff, reviewed before the push ([[daworks/assembly/workspace/agents/cl-review|review]])
- the gate: one command before the push runs the full check ([[ci]]); then presubmit runs it on a clean machine and builds the artifact. Main moves to the change only when presubmit passes ([[ci]])
