---
type: doc
description: "The spine: the process every change moves through, from a signal to met, its intent verified and validated at every level: its policy, the V, the split, the build and the checks. assembly runs it as code. Use when starting or reviewing any change, or when a state, a role or a check must agree with the whole."
status: active
---
The spine: the process every change moves through, from a signal to met. Verification and validation at every level keep what runs aligned with the intent, and that is what lets the parts compose.
- [[#Policy]] what the process is for, and what it never trades: verification and validation at its core
- [[#The V]] each level split on the way down, checked on the way up
- [[#The split]] the issue into a plan and its cls
- [[#The build]] each cl built
- [[#The checks]] each level's check, in the order the work meets them
- [[#Sources]] what it rests on

- [[terms]]: the words it is written in
- [[assembly]]: the factory, which runs it as code
- [[kinetic]]: the work that moves through it, as notes

---
## Policy

What the system is for, and the rules it never trades.

- the North Star: the stance every rule here serves
	- entropy: the real cost of code, since what is left stale, half done or done two ways is copied by every agent after. So when the right thing is clear, it goes in this change
	- intent: the need a piece of work serves. Where a spec disagrees with it, the intent wins
	- generated code: a black-box artifact, judged by empirical evaluation like any ML model
	- side by side: each step done with an agent, trying to do better than it, so the process improves from what it gets right and what it misses
- verification and validation: the core, the two checks that keep what runs aligned with what was meant
	- verification: the check that it was built right. What was built matches what was specified; a test answers it
	- validation: the check that it was the right thing. What was specified matches what was needed; a person answers it
	- the pairing: each level split on the way down and checked on the way up by the side that split it, the [[#The V|V]]
	- composability: each level a closed unit, with a need, a done and a check that can fail
		- done: a unit is done when its own check holds, not when its parts say so. Held by: the issue's acceptance, a CL's gate
		- the seam: what composes is the check, never the method. The method inside a unit is free
		- one shape: a plan composes CLs and an issue composes its plan, so one rule covers every level
	- the promise rule: each promise ([[terms#promise]]) is tested once, by the cl that makes it, at the altitude of its source, which sets the kind of its test ([[tests#Kinds]]). It is the rule that makes the V compose, at any size
		- a seam: tested by the cl that creates it
		- an issue promise: tested by the cl that completes it, red first, end to end or on the running system. The plan names that cl before any cl starts
		- the line: promises go down the V, cases never do. Each level writes what holds at its surface and leaves the inside to the level below ([[terms#case]])
		- composition: the parts' promises, with their seams, imply the whole, so a level tests only what its parts cannot show (assume-guarantee: Abadi and Lamport)
		- order: the outer promise is written before the work inside it (outside-in: Freeman and Pryce), and a change with seams builds them first, thin and end to end, then fills behind them (walking skeleton: Cockburn)
		- the shape it forces: none. One cl is its own seam and Done; a cut too big for one cl is an issue of its own, under the same rule
	- [[backpressure]]: each check pushing a miss back to the level that owns it, so the work reconciles toward the intent
		- raise: back up to the plan or the issue, never settled below. The plan first, the issue only when the intent itself was wrong, and the outcome said: re-scope, split or drop
		- spawn: a new issue, outside this one, only when the issue would still be met without it. A piece the issue's Done needs stays in its plan
		- back: what [[operate]] finds false comes in as a new issue
		- the ratchet: a finding that comes back becomes a lens, then a lint or a test. Not built
- the properties: what must hold of the system, read as a [[state-machine]], each held by a check, a review or a person
	- liveness: what must happen in the end
		- met or dropped: every issue in progress ends one or the other, and a change to its intent is raised, never made quietly. Held by: a budget of three rounds at each level. Across levels, nothing
		- fairness: a step that stays possible is taken
	- safety: what must never happen
		- invariants: true in every state
			- main: every commit on it passed the full check and a review, by one path. Held by: [[ci]]'s presubmit, the [[repo]]'s ruleset and pre-push hook. Not built: the gate outside dazoo, and a tested push from [[assembly#The dock|the dock]]
			- isolation: a change never touches another's work. Held by: its [[workspace]]
			- one owner: open work has at most one worker. Held by: the claim, status `in-progress`, set by [[assembly]]
			- one fact, one place: each fact has one home, and data flows one way. Held by: basis/merge and `just check`
				- a work note: the spec. Its frontmatter holds the facts a machine acts on, typed in `schema.ts`; its body is prose that no code parses
				- status: set by hand, or projected one way by a controller from its own record, keyed by the note's name. Not built: [[assembly]]'s ledger copies a note's facts, and reads notes with its own parser
				- a view: computed from `belongsTo` and status, never kept by hand
		- order: true of every step
			- fixed at entry: a level's intent and check are fixed where work enters it, and inside it the agent is trusted. Held by: validation of the plan
			- the alarm channel: a finding that changes a level's intent goes to the level that owns it, never settled below (Beer's algedonic signal). Held by: the agent raises it, and review
			- tests first: tests are committed before the code. Held by: review, from the commit order ([[tests#Characteristics]])

## The V

Each level splits the work on the way down, and designs the check it will face on the way up; each loop owns one stretch (the V-model).

```
  Issue: Intent, Done ─────────────────────────────── Acceptance: verified, proven, validated, kept
    │  ╲                                                ╱  ▲
    │   Plan: seams, phases ────────────── Integration: seam promises
    │     ╲                                  ╱
    │      cl: Promises, Seam ─── cl check: red → green, gates, review
    │        ╲                    ╱
    │          build: nail → hammer
    │
    ├── the split: down the left side (issue → plan → cls): the planner, checked by plan-review
    ├── the build: the point, and up to main (each cl: da-nail, da-hammer, cl-review, then the dock)
    └── acceptance: the top of the right side (deploy, prove, validate, keep)
```

- across: each level on the left is paired with its check on the right, and designs it. So the whole is checked by the level above, and each level below stays small
- the top of the right side is validation, the right thing; the levels below it are verification, built right
- [[objective]]: above the V, an end state met when its key results are. Issues hang under it
- [[assembly]] moves an issue through the V, from open to accepted; met is Matt's

## The split

The issue goes down the left side, into a plan and its cls: the [[daworks/assembly/workspace/agents/planner|planner]] cuts it, and plan-review checks the cut before any cl starts.
- [[issue]]: a need, and the state of done that meets it. Born from a signal: a bug, an idea, a breakage
- [[plan]]: how the issue is cut into cls, only when it takes more than one. Written as an argument: the approach, why the phases are ordered as they are, the seams, the trace to the issue's Done, and what does not fit
	- phases: the order. A phase is a set of cls that need nothing from each other, and the phases run in order. Each cl holds its `phase`, and the plan's phases are computed from them
	- the way to cut: a known pattern for the kind of change, or none, said ([[playbook#Cutting a change]])
	- the planner makes it, working backward from the issue's Done
- [[cl]]: one cut, the spec its builders work from alone
	- shape: behavior (its check fails before and passes after) or structure (its check passes before and after), checked in the repo or on the running system
	- checkout: every path conceivably relevant to the cut, as git sparse-checkout patterns: what its builders get on disk, so they start from what the planner found

## The build

Each cl is built in its own [[workspace]]: a sparse checkout of the cl's checkout, with its tests run in a full checkout.
- [[daworks/assembly/workspace/agents/da-nail|da-nail]] writes its tests from the cl, before any code; [[daworks/assembly/workspace/agents/da-hammer|da-hammer]] writes the code that makes them pass, and never changes a test; [[daworks/assembly/workspace/agents/cl-review|cl-review]] judges it; then the dock lands it ([[assembly#The dock]])
- the method follows the cl's shape ([[playbook#Building a cut]])
- [[assembly]], the factory: the split and the build as code. It can reach verified, never met

## The checks

Each level of the V has a check, met in this order.

- the cl's check: what a CL must pass before it lands. Each one can fail: red first, or a mutant it kills
	- the gates: the checks the repo runs on every change, in its [[repo#Environment|environment]]
		- [[tests]]: run the code and assert what it does
		- [[lint]]: checks the code without running it
		- simplicity: a score for duplication and complexity that never gets worse. Not built
	- [[cl-review]]: a review in a fresh context, by an agent that did not build it
	- breaker: an agent that tries to break the running change. Not built
	- running-system check: e2e against a preview deploy of the change, with its proof (screenshots, a recording) left on the change. Not built
- landing: the CL joins main through [[ci]], which builds its artifact
	- the CL: its [[changelist|commits]], at the bar of [[code]], each naming its issue
	- a red: goes back to the build. The same intent failing, not a new issue
	- a flake: a red that passes on a rerun with no change. A new issue for the check
- integration: each seam's promise, tested by the cl that creates the seam, and green on main from then on
- acceptance: the issue's Done, met once its CLs are deployed
	- verified: its acceptance tests pass on main, each carried by the cl that completed its promise. For an issue of one CL, that CL's tests
	- proven: the running system shows the intent holds, read from it, not from the code. [[cd]] keeps main running only once it is healthy
	- validated: a person agrees the intent is met. No test can do it
- dropped: an issue closed unmet, said in the open
- kept: a [[operate|monitor]] keeps checking an intent that can break again

## Sources

- [Software Engineering at Google](https://abseil.io/resources/swe-book/html/toc.html)
- [Google Engineering Practices](https://google.github.io/eng-practices/): [the change author's guide](https://google.github.io/eng-practices/review/developer/), [the reviewer's guide](https://google.github.io/eng-practices/review/reviewer/)
- HumanLayer, agentic workflows where the plan is the expensive piece: [Advanced Context Engineering for Coding Agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md), [Select a workflow for the task](https://docs.humanlayer.com/guide/skills-workflows)
- p-stack, trust inside and verify against the real thing: [[mkultra/loke/ext-plugins/pstack/README|pstack]], and its [[mkultra/loke/ext-plugins/pstack/docs/guide/README|guide]]
- the V-model: each level of the split paired with its check
- Stafford Beer, *Brain of the Firm* (1972): the algedonic signal
- Kent Beck, *Tidy First?*: a change is behavior or structure, never both
- Martín Abadi and Leslie Lamport, "Composing Specifications" (1993): assume-guarantee, the parts' promises imply the whole
- Steve Freeman and Nat Pryce, *Growing Object-Oriented Software, Guided by Tests* (2009): outside-in, the double loop, and the walking skeleton
- Alistair Cockburn, "Walking Skeleton": the thinnest end-to-end slice through every part, first
