---
type: doc
description: "Playbook: a proven way to do one kind of change, at one level: how to cut it into cls (the plan), or how to build one cut (a cl). How to choose one, the catalog at each level with when it fits, its phases and its checks, and poteto-mode's playbooks mapped in. Use when cutting or building a change, or reviewing whether the right method was used."
status: active
---
Playbook: a proven way to do one kind of change, at one level. At the plan, it says how to cut the change: its phases, and what each phase proves. At a cl, it says how to build the one cut. It is optional: small work needs none, and an issue of one cl is its own plan.

- [[#Choosing one]] what an expert would do, before cutting
- [[#Cutting a change]] the plan's catalog: known ways to cut
- [[#Building a cut]] the cl's catalog: poteto-mode's playbooks, mapped in

- [[kinetic#The split]], [[kinetic#The build]]: the map, at the plan and the cl
- [[plan]], [[cl]]: what a playbook's phases and cuts become; a playbook's Out meets their bar
- [[daworks/assembly/workspace/agents/planner|planner]], [[daworks/assembly/workspace/agents/plan-review|plan-review]]: the roles that use them

---
## Choosing one

Before cutting, ask what an expert in this kind of change would do ([[mkultra/loke/skills/be-ambitious/SKILL|be-ambitious]]'s frame), then pick a playbook, or none, and say which.
- the kind of change: what the work is, not what the issue calls it
- the raw material: the code it touches, its callers, the tests that pin it
- the method that kind of change calls for: a playbook below
- what would prove it right: the checks the issue's Done demands, which the playbook's phases must make pass
- none fits, or the work is small: cut without one, and say so. A playbook is never forced

## Cutting a change

Each one: when it fits, the phases it gives, what each phase proves, and its source. The planner routes with it; plan-review checks the pattern fits and was followed.

- adding behavior
	- tracer bullet, or walking skeleton: new behavior across layers, or a change that creates seams
		- phases: the thinnest slice that runs end to end through every seam, then each widening, behind seams already there
		- checks: the slice's end-to-end test and each seam's promise from the first phase, on the wiring; each widening adds its behaviors, and the one that completes a Done item carries its test
		- source: Hunt and Thomas, *The Pragmatic Programmer*; Cockburn, "Walking Skeleton"; Freeman and Pryce, *GOOS*
	- repro first: a bug
		- phases: the failing regression test, then the fix
		- checks: red at the repro, then green; the test stays as the promise
		- source: SWE at Google, ch. 12
- preparing the ground
	- preparatory refactoring: behavior that is hard to add as the code stands
		- phases: structure cls that make the change easy, then the behavior cl that makes the easy change
		- checks: the suite green before and after each structure cl; the behavior's tests red then green
		- source: Fowler, *Refactoring* (2nd ed.); Beck, *Tidy First?*
	- characterization tests: code to change that no test pins
		- phases: tests that pin what the code does now, then the change
		- checks: each pinning test passes on today's code and kills a mutant; then the change's own checks
		- source: Feathers, *Working Effectively with Legacy Code*
- changing a contract
	- expand and contract: an interface or schema its callers use
		- phases: add the new beside the old, move each caller, remove the old
		- checks: both work in the expand phase; no caller of the old remains before the contract phase
		- source: Sato, "Parallel Change" (martinfowler.com)
	- branch by abstraction: an implementation swapped on trunk
		- phases: an abstraction over the old, the new behind it, the switch, the old removed
		- checks: the suite green at each phase, against both implementations while both exist
		- source: Hammant, "Branch by Abstraction"
- replacing
	- strangler fig: a system replaced while it runs
		- phases: a facade, then one route at a time to the new, then the old retired
		- checks: each route proven on the running system as it moves
		- source: Fowler, "Strangler Fig Application"
- at scale
	- a large-scale change: the same edit in many places
		- phases: the tool or pattern, then the edit as a set of cls in one phase, side by side
		- checks: each cl green alone; the set adds up to no place left
		- source: SWE at Google, ch. 22

## Building a cut

A cl's playbook follows its shape. These are poteto-mode's, p-stack's router (`mkultra/loke/ext-plugins/pstack/skills/poteto-mode/SKILL.md`), each opened by path at `playbooks/<name>.md`. Borrowed: pinned in `plugins.lock.json` and run as they are, never edited; an update is a pin bump.

- behavior: Feature (new or changed behavior, from a named data shape), Bug fix (reproduce, root-cause, fix with runtime evidence), Visual parity (UI equivalence)
- structure: Refactoring (rename, extract, inline, dedupe, move, behavior kept)
- a measure: Perf issue (one slowness, against a baseline), Hillclimb (one metric, loop by loop, one commit per win)
- a decision: Prototype, a throwaway sketch that settles a design fork by observing it
- knowing, not changing: Investigation, Runtime forensics, Trace forensics. Their deliverable is understanding: the planner's probes use them
- not run here, since kinetic does the job another way
	- Multi-phase plan: the plan, cut by [[#Cutting a change]]
	- Opening a PR, Babysit, Shipping: the CL lands through [[assembly#The dock|the dock]] and [[ci]]
	- Autonomous run, Orchestrate, Autopilot-full, Autopilot-stack, Session pickup, Pause safely, Worktree cleanup: the controller's work ([[assembly]])
	- Authoring a skill, Eval: changes to agents, outside the cl loop
- the edge: p-stack is written for Cursor and pull requests, so each name is mapped here, not in its files (an anti-corruption layer: Evans, *Domain-Driven Design*)
	- where poteto-mode and [[kinetic]] disagree, kinetic wins: it holds the intent and the checks
	- a PR is a CL; `Task` and `poteto-agent` are a subagent of this harness; a model slug is the model this harness gives the role; `AskQuestion` is asking the operator
	- `cursor-team-kit` and Bugbot are not installed: skip the step and say so
