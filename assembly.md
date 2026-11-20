---
type: moc
description: "Root of assembly, the software factory: the process every change moves through, from a signal to met (its policy, the V, the split, the build and the checks), and the machine that runs it, a deployment of que-pasa. Read for how a change is made and checked, how the factory works as a system, where it meets other systems, what it records, and what is built."
status: active
---
assembly: the software factory. The process every change moves through, from a signal to met, its intent verified and validated at every level, and the machine that runs it: a deployment of [[que-pasa]] that takes an issue through its plan and its cls, phase by phase, each cl onto main, to accepted.
- the method: what the factory does, apart from the machine that does it
	- [[#Policy]] what the process is for, and what it never trades: verification and validation at its core
	- [[#The V]] each level split on the way down, checked on the way up
	- [[#The split]] the issue into a plan and its cls
	- [[#The build]] each cl built
	- [[#The checks]] each level's check, in the order the work meets them
- the machine: one job through the plant
	- [[#The product line]] the repo it builds in
	- [[#The bench]] where one job is done
	- [[#The paperwork]] what travels with a job, and the rules a message follows
	- [[#The plant]] what moves jobs from station to station
	- [[#One job]] one attempt, from begin to end
	- [[#The dock]] main, and the land onto it
	- [[#Seams]] where it meets other systems
	- [[#Records]] what it keeps
	- [[#Built]], [[#Not built]] what exists, and what does not yet
- [[#Sources]] what the method rests on

- [[point-b]]: what it is for, through [[software-factory-v2]]
- the states: the bar, what good looks like at each level, each a note an agent has in its context
	- the work's: [[issue]], [[plan]] and [[cl]], the type notes of `@mku1tra/work`, in `work/types/`
	- the factory's, in `workspace/types/`: [[tests]] and [[code]], what the change is judged by; [[changelist]], one change to main; [[playbook]], a proven way to cut or build one kind of change; [[lint]], the check that does not run code
	- [[terms]]: the words they are written in, each with one meaning
	- [[bench]]: the sandbox a builder works in, and what happens to what it leaves there
- the roles: the method that meets a state, each an agent's instructions, in `workspace/agents/`: [[daworks/assembly/workspace/agents/planner|planner]], [[daworks/assembly/workspace/agents/plan-review|plan-review]], [[daworks/assembly/workspace/agents/da-nail|da-nail]], [[daworks/assembly/workspace/agents/da-hammer|da-hammer]], [[daworks/assembly/workspace/agents/cl-review|cl-review]]
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
		- done: a unit is done when its own check holds, not when its parts say so. Held by: a CL's gate, and the issue's Done, read from the running system
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
		- a finding: a fault in one artifact (the issue, the plan, a cl, its tests or its code), with what fails, its evidence and where. A check hands back all it found, in one pass
		- the owner: who made the artifact, and so who fixes it. The tests are da-nail's, the code da-hammer's, a cl and the plan the planner's, the issue the operator's
		- back: a finding goes up the V to its artifact's owner. Findings about several artifacts go to the highest one's owner, since its fix can change the rest
		- raise: a back about a spec (a cl, the plan or the issue), never settled below. A cl's raise holds its issue for the operator, who fixes the notes where the fault is, its cl, its plan or the intent, and resumes it, and the outcome is said: re-scope, split or drop
		- escalation: the item goes to the operator on its third retry at one state, its third round back, or a move no rule covers, and the work it holds up waits until the operator answers
		- spawn: a new issue, outside this one, only when the issue would still be met without it. A piece the issue's Done needs stays in its plan
		- from the running system: what [[operate]] finds false comes in as a new issue
		- the record: every message, whoever sends it, goes through one door and is kept, never edited
		- the ratchet: a finding that comes back becomes a lens, then a lint or a test. Not built
		- Held by: [[#The paperwork]], which runs each rule as code
- the properties: what must hold of the system, read as a [[state-machine]], each held by a check, a review or a person
	- liveness: what must happen in the end
		- met or dropped: every issue in progress ends one or the other, and a change to its intent is raised, never made quietly. Held by: a budget of three rounds at each level, then escalation. Across levels, nothing
		- fairness: a step that stays possible is taken
	- safety: what must never happen
		- invariants: true in every state
			- main: every commit on it passed the full check and a review, by one path. Held by: [[ci]]'s gate, crate, which checks the tree main becomes on every push to a repo on it, and the [[repo]]'s ruleset, which refuses any other push. Not built: a tested push from [[#The dock|the dock]] for a repo not on crate
			- isolation: a change never touches another's work. Held by: its [[workspace]]
			- one owner: open work has at most one worker. Held by: the ledger, where an item has at most one attempt open, and each of its agents one conversation
			- one fact, one place: each fact has one home, and data flows one way. Held by: basis/merge and `just check`
				- a work note: the spec. Its frontmatter holds the facts a machine acts on, typed in `schema.ts`; its body is prose that no code parses
				- status: set by hand, or projected one way by a controller from its own record, keyed by the note's name. Not built: the factory reads notes with its own parser (`factory/stations/plan.ts`), not basis
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
    ├── the split: down the left side (issue → plan → cls): most often written outside the factory, by the operator's agent; else the planner, checked by plan-review
    ├── the build: the point, and up to main (each cl: da-nail, da-hammer, cl-review, then the dock)
    └── acceptance: the top of the right side (deploy, prove, validate, keep)
```

- across: each level on the left is paired with its check on the right, and designs it. So the whole is checked by the level above, and each level below stays small
- the top of the right side is validation, the right thing; the levels below it are verification, built right
- [[objective]]: above the V, an end state met when its key results are. Issues hang under it
- the machine moves an issue through the V, from open to accepted; met is the operator's

## The split

The issue goes down the left side, each level a state, made by one role and checked by another before the next starts. A state is the bar, its type note what good looks like; a role is the method that meets it ([[terms]]).
- [[issue]]: a need and the promises that meet it, born from a signal (a bug, an idea, a breakage). Made by the operator
- [[plan]]: the issue cut into cls, only when it takes more than one. Made most often outside the factory, by the operator's agent; else by the [[daworks/assembly/workspace/agents/planner|planner]], from a known way to cut its kind of change ([[playbook#Cutting a change]]); checked by [[daworks/assembly/workspace/agents/plan-review|plan-review]] before any cl starts
- [[cl]]: one cut at its surface, its promises, seam and context, the spec its builders work from alone. Made and checked with its plan

## The build

The point of the V and the right side up to main: each cl built in its own [[workspace]], one worktree of the whole repo on the cl's branch, its Core context where its builders start. The method follows the cl's shape ([[playbook#Building a cut]]).
- the tests: made by [[daworks/assembly/workspace/agents/da-nail|da-nail]], from the cl's promises, before any code
- the code: made by [[daworks/assembly/workspace/agents/da-hammer|da-hammer]], until the tests pass, never changing one
- the verdict: [[daworks/assembly/workspace/agents/cl-review|cl-review]]'s, then the dock lands it ([[#The dock]])
- the whole: the issue, accepted once each of its cls has landed: the factory lands cls, and the issue is done when they are. The machine runs the split and the build as code, and reaches verified, never met: its Done in the running system is the operator's

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

## The product line

[[repo]]: what the factory builds in, a repo and the environment it defines once. An issue may change several, a cl one.

- dev image: the toolchain and the package cache, warm, which every bench starts from. crate makes it from the repo's `crate.toml`
- services: what runs beside the work, from `pod.yaml`. Not built ([[workspace-on-crate]])
- check: `check.sh`, the one inspection, the same at every bench and at the dock

## The bench

[[workspace]]: where one job is done, a branch, a worktree and a running copy of the repo's environment, made for the job and removed after. The same bench for the operator and for an attempt.

- worktree: the item's one checkout, the whole repo, beside its attempts' folders, named for the item (`runs/<issue>/cl/<cut>/<cl>`, `runs/<issue>/issue/<issue>`), which every attempt of the item works in. Removed when the item ends ([[#The plant]], the sweep)
	- a cl's: on its branch, `assembly/<cl>/head`, made from main when the cl first needs it
	- an issue's: detached, moved to main as it is now at each attempt. An issue of several repos holds one per repo, at `<repo>/<issue>` in its folder
- workspace: crate's attempt workspace on the worktree (`crate up --attempt`), named `<repo>-<folder>`: its tools member, the dev image with the worktree, its setup and its services, all from the repo's `crate.toml`. The factory knows nothing of how a repo runs
- network: its own. An attempt's has no way out

## The paperwork

The model: the four things that travel with a job, each with its rules in the process, its store behind an effect, and its moves in the engine.

- spec: the notes that say what must be true: the issue, the plan and its cls, in kinetic, the notes repo. The only spec: the ledger holds no copy of it
	- types: [[issue]], [[plan]] and [[cl]], with [[objective]] and the abstract [[work]], in `work/`: the package `@mku1tra/work`, which holds the types and no notes. A graph that holds work imports it, so work is in any repo, with or without the factory
	- shapes: held by the process. `factory/repos/notes.ts` reads them at a commit of the notes' main, never from a working tree
	- the commit: each attempt fetches the notes' main as it starts and pins its commit on the attempt, so its note and every review's input are the spec as it was then, and an edit is read by the next attempt
	- writes: the engine writes only the notes of a spec the factory's planner made, in kinetic's format, and lands them on the notes' main as the issue's land ([[#The dock]]). No note's `status` is written: the ledger is the status. A finding is never written into a note
	- the operator's spec: the operator's own notes on the notes' main, which the engine reads and never writes
- product: the files a cl's builders make, its tests and its code, in git
	- judged by: the process's checks. Red at an assertion, no test changed, green
	- held by: `factory/repos/git.ts`. The engine commits it, and lands it on main ([[#The dock]])
- role: the instructions one agent works from (`workspace/agents/*.md`)
	- run by: `factory/runs/runner.ts`, from the agent and the bin its step names
- message: the record a step ends with, saying what it concluded and who acts next (`factory/line/step.ts`'s `Message`)
	- its parts: a word, why in one line, a failure's cause, its findings, and notes for the next step
	- its words: pass, retry or back from a step; pass, drop, escalate or resume from the orchestrator or the operator
	- its sender: on its event. An attempt as it ends, the orchestrator, or the operator
	- the rules a message follows ([[#Policy]], backpressure): the finding, the owner, back, the raise, escalation and the record. Each is held here
	- finding: `factory/line/step.ts`'s `Finding`, its `about` the artifact
	- pass: moves the item on
	- retry: runs its step again
	- back: a sender is any step. An agent hands back findings in place of its done result; a check can too (a red suite)
		- raise: a cl's parks it for the operator, raised, with its findings, whoever made the spec. The operator fixes the notes, and resumes it
		- escalation: none of an escalated issue's cls starts an attempt, until the operator answers
	- routing: `factory/line/table.ts`, as data: each move, `owner`, the state of each artifact's owner, and the highest artifact a back's findings name
	- an agent's output: its submit tool, its one way out. Its form is its step's result, done or back, each exit described by where it takes the item and what it is for, written from the routing (`workspace/agents/submit.ts`). A role note says only that its output goes through submit, so an exit used wrong is fixed in the form, not in a role note
	- the one door: `ledger.apply`, which every message goes through, whoever sends it
	- the record: the ledger's events, one per message, appended and never edited. An item's state is their projection, moved in the same transaction
	- an agent's input: its spec, then its messages, the one that brought the item to its state and each since (`ledger.inbox`). Its product it reads in the worktree

## The plant

The machine: what moves jobs from station to station. Its code is in two folders, after que-pasa's layout: `workspace/`, who the agents are, and `factory/`, the host that runs them on the line. Inside it, four layers put together by `factory/main.ts`. The engine runs the process and calls the effects; the process reaches the effects only through its notes and the tools each agent names.

- process: what the work is (`factory/stations/`, `factory/line/table.ts` and `step.ts`, `workspace/`). It decides, and touches only its own notes
	- the inner loop: the one part that runs on its own, a cl from ready to landed (`factory/line/table.ts`, `inner`). Every step outside it, an issue's and a waiting cl's start, runs only when the operator says go, once, and its item waits again where it ends. The factory never starts work outside the inner loop: what runs next, and when, is the operator's, or the project manager's on top of it
	- the path: the states an item moves through on messages, held as data in `factory/line/table.ts`
		- an issue's repos: the ones its cls may change. By default every repo on crate under `ASSEMBLY_REPOS` (lot when it is not set; a git repo with a `server` remote) but the notes repo, and the planner picks among them; `factory submit --repo` narrows them. Each repo's full suite, `scripts/check.sh all`, is read from the item's worktree at each attempt (`factory/repos/repo.ts`). How it runs is its `crate.toml`'s, and crate's. A repo not on crate breaks the item's contract (`contract_invalid`); a workspace that does not come up is a dependency (`missing_dependency`)
			- a cl: names its repo, one of the issue's, when the issue has several, and runs, sets up and lands in it. A change across repos is a cl per repo
			- the issue's own steps: each repo's worktree read in place, with no shell, since they only read
		- an issue: open → planned (the planner cuts it) → approved (plan-review approves it) → building (its plan and cl notes landed on the notes' main) → built (each cl ended) → accepted (each cl landed: the orchestrator's move; with a cl dropped, the operator's go). Each step before building runs at the operator's go. A review's back leaves the issue at the planner's station, waiting for the operator's go, and so does a plan land the notes' check refuses. The main path: an issue the operator submits with its cl notes enters at building, past the planner and plan-review
		- a cl: waiting (for the operator's go) → ready → red (da-nail's tests) → green (da-hammer's code, or da-nail's tests that pass at once: the code there already meets them) → approved (cl-review) → landed (on main). A review can send it back to its tests or its code, and so can the land
		- the operator's levers: go, the next step of an item outside the inner loop, once: a waiting cl starts, a building issue's cl notes go in, waiting, and an issue's step runs (`factory/cli/levers.ts`); stop, the operator's escalate of any item that moves; resume, a held item back to a station of its kind (a cl's ready, red, green or approved; an issue's open, approved, building or built), by default where it was, with a fresh budget: its attempts and rounds count from the operator's move. An issue resumed at building takes its cls from its notes at main: a new cl note adds a cl, a gone one drops its cl, and its held cls go back; and drop, an item the operator lets go, which ends undone, an issue with its cls not ended, its record kept; and rebase, a held cl put on main as it is now, its uncommitted change with it, as one move or none: a conflict changes nothing, and is the operator's to judge; and note, the operator's message to an agent's conversation on an item, which its next run reads, starting none: the loop delivers it through que-pasa's note, since only its process opens the conversations; and compact, a compaction of an agent's conversation on an item, by default the agent of its last attempt: the loop asks for it through que-pasa's compact, for the same reason: a runtime opened in another process would take up the runs going on, and pi's summary is a task of the process that opens the conversation
	- a step: one per state, with its agent, its result's shape and its check (`factory/stations/*.ts`, listed in `factory/stations/index.ts`)
		- the steps: plan (the issue has promises in Done, and the spec lints: kinetic's rules, and the repo's), plan review, nail (each listed test file there, then the full suite by the cl's shape: a behavior cl's red goes to hammer, and green to review; a structure cl's tests pin the code as it is, so green goes to hammer for the refactor, and red back to nail), hammer (no test file changed, then the full suite green), review (the full suite still green)
		- a gate: a step's quick, exact checks of a result against the worktree (`factory/line/gate.ts`), each fault one its agent can fix: a builder's change is exactly the files it lists, a listed test file is there, hammer leaves da-nail's tests as they are, and a step that only reads leaves its worktree as the attempt began. It runs at the agent's submit, through que-pasa's `accept`, which answers each fault and lets the run go on, at most 3 times; and again in the loop before the check, where a fault left is a retry with its cause
		- a check: reads the result and the attempt's worktree through a port (`Worktree`: a test run, the changed files, the files there), and gives the message
		- the builders: nail and hammer, in the cl's one worktree, the whole repo. The cl's Core context is the entry points of its change: they start there, and read on through the code each promise runs, as deep as it goes. The instruction holds their tokens, and `factory top` shows them
			- a path of the Core context: a file or a folder, a plain path from the repo's root
			- the commit: every change the attempt made
			- hammer: changes no test file da-nail listed
			- a test run: the repo's full suite, `scripts/check.sh all`, in the attempt's workspace (`crate run`), on the worktree with the attempt's change, so the tree a test sees is the tree a pass commits. Its exit code is the verdict, never its output (Bazel's test contract). Main is green and da-nail changes only tests, so a red at nail is its tests (`factory/runs/workspace.ts`'s `runIn`)
				- a single test: the agent's own, in its shell, in the same workspace. The factory runs none
	- the land: an approved item's attempt, code with no agent (`factory/repos/land.ts`): a cl's onto its repo's main, an issue's plan onto the notes' main. Its moves are in [[#The dock]]
	- an agent: its instructions in its role note beside it, and the bin it names (plan, implement, review), never a model
		- its compaction: que-pasa's compaction middleware, last among its own, at its bin's limit (`compactAt`), with one default of what the summary keeps: the spec, the findings still open, what is built and committed, what was tried and failed and why, and the next step, and not the output of a tool call already acted on (`workspace/agents/compaction.ts`). Each agent gets it from its bin, in `workspace/agents/index.ts`
	- the workspace: what the agents are made of (`workspace/`), apart from the machine that runs them. Not the bench ([[workspace]])
		- `agents/`: each agent's role note, and its code beside it
		- the tools: que-pasa's, after LangChain's Deep Agents, in the sandbox the runner gives each run: the attempt's workspace, through `crate run`. The factory has none of its own
			- for every agent: `ls`, `read_file`, `glob`, `grep`, on the worktree, with paths from the repo's root
			- for nail and hammer: `write_file`, `edit_file`, in the cl's worktree
			- for every agent of one repo: `execute`, a shell in its workspace: to run a test, format, remove a file. A builder's verdict is its step's check, never a command it ran. A step that only reads and leaves its worktree changed fails, and the worktree is put back
		- `types/`: the factory's own notes that a role works to and is judged against. The work's are type notes, in `work/types/`
			- in its context: que-pasa's memory middleware reads an agent's types once, when its conversation is made, keeps them with it, and adds them to the system prompt before each model call (`workspace/agents/types.ts`)
			- every agent: [[terms]] first, the one vocabulary, and each state it reads or makes
			- the builders: da-nail [[cl]] and [[tests]], da-hammer [[cl]] and [[code]]. cl-review: [[code]], [[tests]] and [[changelist]], the same text its builders have, and [[cl]]
			- the planner and plan-review: [[issue]], [[plan]], [[cl]], [[changelist]] and [[playbook]]
			- Held by: `types.test.ts`, each type an agent names is a note there. Memory leaves out a source that is not there, and says nothing
			- a work type: its type note, the definition itself, so an agent and a person who writes a note read the same text
- engine: what moves it (`factory/line/`)
	- the ledger: `ledger.ts`, SQLite in WAL mode, the orchestrator's only state: where each item stands, and every message. The loop writes it while a lever or top reads it: a read never waits, and a write waits up to `busyMs` for another
	- the tick: `loop.ts`. Sweeps, then starts attempts, up to `concurrent` at once, the open ones first; readies each (its worktree, its notes' commit, its settings, its setup), answers each check's worktree, and records its test run
	- the lands: `loop.ts` too. One per approved item, as an attempt, and the lands onto one main one at a time, each after the one before it
	- the sweep: at open and on each tick, in the notes repo and every repo the ledger names (`factory/repos/git.ts`). A live item, one not ended or with an attempt open, keeps its worktree and its branch; every other worktree under the runs folder and every other `assembly/` branch goes. One rule covers an item's end, a crash between moves, and an older scheme's leftovers. A worktree outside the runs folder is never touched
	- the orchestrator's own moves: `advance.ts`, bookkeeping that starts nothing: a building issue whose cls have all ended is built. A waiting cl's start is the operator's go (`start`): its worktree moves onto every version its repo needs from its issue's landed cls first, each its own commit (`factory/repos/move.ts`, the one container with the network), so its attempts run its new lockfile, in a dev image crate makes from it. A version not on npm yet, asked through `factory/repos/registry.ts`, or a move that fails, leaves it waiting, and the go says why
- effects: how it touches the world, each behind a small seam: `factory/repos/`, git, the land, the notes and versions; `factory/runs/`, what an attempt runs in
	- `git.ts`: each item's worktree and branch, its commits, main as the land target has it, and the sweep
	- `land.ts`: the land, an approved item onto its main, from its worktree: a push that crate checks, or `git land` for a repo not on crate
	- `move.ts`: a released cl's worktree onto the version it waited for, in a container with the network, committed on its branch as `build(deps): <package> to <version>`
	- `workspace.ts`: the attempt's workspace, crate's: up, down, the agent's sandbox, and a test run, each through crate
	- `runs.ts`: the run folders. `factory/sh.ts`: the commands under them all
	- `runner.ts`: the run, on que-pasa's durable runtime: one conversation per agent on an item, and its context, which its tools read
	- `models.ts`: the bins, a default model, a fallback for a retry, and the context its agents compact at (150k tokens for each bin)
	- `notes.ts`: the notes, read at a commit of the notes' main. `trace.ts`: the record of each attempt
- wiring: `factory/main.ts`. `compose` builds the factory from the other three, on its notes repo, and the world the loop waits on (`npmRegistry`, `gitReader`, `landedTags`; a test stands its registry in through `Factory.registry`), under one home (`ledger.db`, `pi.db`, `runs/`). The e2e builds through it
- the command line: `factory/cli/`, one module per command, on what `compose` builds (`just factory`)

## One job

An attempt: one step on one item, at the item's bench. Its run and its workspace are its own, and it lives until it ends.

- begin: the ledger opens it, with its trace's ids
- ready: the item's worktree made or kept, the notes' main fetched and its commit pinned on the attempt (a taken-up attempt keeps its own), and the repo's settings read from the worktree. A failure is a retry before any agent, with its cause
- workspace: `crate up --attempt` on the worktree, inside the attempt's task, so a tick never waits on it: crate's dev image, its `[tools] setup` and its network with no way out. A failure is a retry with `missing_dependency`, before any agent. The agent's loop runs in the orchestrator and holds the key (LangChain's "sandbox as tool"); its tools run in the workspace
- run: que-pasa's, one input on the agent's conversation on the item (`<item>/<agent>`), with the attempt's number as its id, under the attempt's span, on the bin's model
	- the conversation: made by the agent's first run on the item, and kept across its attempts, so the agent remembers what it read, wrote and was told. Its context lives as long as it: the item, the agent, the item's folder, read-only or not
		- its compaction: past its bin's limit, after a model response, its older part is summarized and its recent part kept, so a long conversation stays under the limit; the operator's `compact` asks for the same by hand
	- the input: the first run's, its spec and its messages; a later run's, only what is new: a review's input again, the note when it changed, and the messages since the agent's last run
	- the attempt's run: written to the item's folder before each run (`<agent>.run.json`), where the sandbox reads it
- check: the step's, on the worktree. Its test run in the attempt's workspace
- commit: a pass of a step that edits, on the item's branch, titled as crate reads a release. No note is written
- any other end of a step that edits: its change stays in the worktree, uncommitted, and the cl's next attempt goes on from it
- end: the attempt span is written, then the ledger moves the item, in one transaction with one event, its message, and the workspace goes (`crate down`)
- across a stop
	- a stopped orchestrator: ends nothing. Each attempt stays open, and its workspace stays up
	- the next one: takes each open attempt up. Its workspace again (`crate up` changes nothing on one that is up), and its run goes on from where it stopped, with no model call redone
	- a cut-off tool call: runs again only if twice is the same as once (`ls`, `read_file`, `write_file`, `glob`, `grep`). For `edit_file` and `execute`, the model gets `interrupted`
	- the time limit: per process

## The dock

[[ci]]: final inspection into the warehouse, main.

- the gate: the check passes on the exact commit, then main moves by fast-forward
- the land target: the remote a cl lands on: `server`, main's bare repo guarded by crate ([[repo#Platform]]), when the repo has it; else `local`, a bare repo on this machine; else `origin`. Main is its main, fetched as each attempt starts
- the land: each approved cl onto main, as the operator, in the cl's worktree (`factory/repos/land.ts`)
	- landed already: a cl whose change main holds passes as it is, so a land a stop cut off is safe to run again. On crate, the server's `refs/landed/<its sha>` says so exactly; elsewhere, `git land` finds nothing to land
	- through crate's merge queue (`server`): `crate land`, the queue's own client, puts the branch in the queue and waits for crate's verdict. The commit main took is its `refs/landed/<sha>`. crate checks it on top of the changes ahead of it and picks it onto main, so the land neither rebases nor tests, and main may hold the change as a commit of its own
		- does not apply on main and the changes ahead: a back about the plan (`restack_conflict`), with the files, since keeping the cls of one phase apart is the plan's work
		- refused by the check: a back about the code (`check_failed`), with the check's output
		- left the queue, or no verdict: a retry
	- through `git land` to a repo's gate, for a repo not on crate
		- rebase: the cl's branch onto main. A conflict is a back about the plan (`restack_conflict`)
		- retest: the repo's full suite on the rebased tree, when main moved under it. A red is a back about the code (`check_failed`), and the branch stays on the rebased tree, so da-hammer works on the code main will hold
		- push: `git land`, through the repo's gate. A land it refuses is a retry
	- landed: the cl's branch is the commit main took, and the ledger keeps that commit, which its version tags are read from, and the files it changed
	- an issue's plan: its land writes the plan and cl notes its planner made on the issue's branch of the notes repo, from main as it is now, replacing the notes of its cls not landed, commits them as `docs(<issue>): its plan`, and lands them as a cl lands, so the notes' own check lints them. A refusal is a back about the plan, to the planner
- the identity: the operator's
	- the author: the name in the host's git config
	- the push: to `server`, over SSH as the server's git user; to GitHub through `git land`, the GH_TOKEN from the orchestrator's environment (on the laptop, the vault's, through rbw-run; on the server, the service's), set as gh's credential for the push alone
- after the dock: [[cd]] ships main onto a node, outside the plant

## Seams

Where it meets other systems, and what crosses each.

- [[que-pasa]]: the harness. assembly gives it agents, each with its tools and its middleware, a conversation per agent on each item, a model per run; it gives back the result and the usage, keeps the conversation and the run across a stop, and traces it. `@mku1tra/que-pasa` on npm, by version range
- [[kinetic]]: the work, the notes repo (`ASSEMBLY_NOTES`, else kinetic among the clones). The spec is kinetic's, of the types of `@mku1tra/work`, which kinetic imports from npm; assembly is its controller, and the ledger is the status, keyed by the note's name. Kinetic lints the notes where they live; assembly reads them at a commit of its main, pinned on each attempt, and writes only the notes of a spec its planner made, which land on its main as any change does
- evals: the traces and the ledger, read later. Scores and labels are their own records, keyed by trace or span id
- the model provider: pi-ai's Fireworks provider. Its key, `FIREWORKS_API_KEY`, reaches the orchestrator only, never a sandbox, through its environment: `factory run` refuses to start without it. The server's Quadlet fills it from the account's `keys.env`. `just smoke-model` makes one real call per model
- the server: monkeybusiness, where the factory runs, declared in [[dazoo]] (`nodes/mutable/monkeybusiness/users/assembly/`)
	- the account: `assembly`, its own user. Its home holds the clones of the repos on crate (`ASSEMBLY_REPOS`, `~/repos`), the notes repo among them (`ASSEMBLY_NOTES`), and the factory's home (`ASSEMBLY_HOME`). It cannot read or write `core`'s files, and its key reaches `core`'s repos for git alone
	- the image: `factory/Containerfile`, the factory's tools and then its code at a release, the tag crate makes on a land (`v<x.y.z>`), its entrypoint the command line. The account's Quadlet builds it from its clone at that tag (`assembly.build`, which names the release: the one deploy lever)
	- the service: a Quadlet of the account (`assembly.container`), the image running `factory run`, with the account's repos, the factory's home, the podman socket, crate's install, the ssh key and known hosts, and the git identity mounted. A commit to either Quadlet file rebuilds and restarts it
	- its keys: the model key and the GitHub token, sealed in dazoo, unsealed by root into the account's `keys.env`, which the service reads
	- the laptop: reaches it over ssh (`just factory <verb>`). The laptop's key is forced into `factory door` in the running factory's container (`factory/cli/door.ts`), which lets through only the remote verbs (submit, stop, resume, drop, rebase, go, note, compact, status, blocked, explain, top), never `run`. The verbs live beside the command line, so there is one list
- the host: git and podman
	- branches: each item's work on `assembly/<name>/head`: a cl's passed work in its repo, an issue's plan in the notes repo. A live item has its branch and its worktree, and nothing else under `assembly/` stays
	- the orchestrator: its own image (`factory/Containerfile`: node, git, gh, skopeo, the podman client, the factory's code, and the host's crate mounted read-only), starting containers through the host's podman socket, with host paths at the same path

## Records

What it keeps.

- the ledger (`ledger.db`): where each item stands, and the record of its attempts. No content: the spec is the notes, the product the branches
	- items: with its note's path, a cl's phase, an issue's repos, and the commit main took once landed
	- attempts: state, word, reason, cause, duration, tokens in, out and cached, cost, the result, trace ids, times taken up, and the commit of the notes it read: with the note's path, the exact spec it saw
	- events: one per message, with who sent it, its word, reason, cause, findings and notes, and the move it made
	- paths: the files each cl changed, once landed
	- check runs: command, image, tree, input hash, exit code, duration
	- the operator's notes and compactions: each with its item and agent, and how the loop delivered or asked for it, or pending
- pi's store (`pi.db`): que-pasa's conversations and runs, so a run goes on after a stop
- a run folder: per item, by issue (`runs/<issue>/issue/`, `runs/<issue>/cl/<cut>/`), with its worktree (`work/`, and an issue's `notes/` for its plan's land), its setup's mark, each agent's attempt going on (`<agent>.run.json`), and a folder per attempt (`<n>/`) with its log and its trace. The folders stay when the worktree goes
- the trace (`trace.jsonl`): each attempt as one OpenTelemetry trace, OTLP JSON, semconv 1.43.0
	- the attempt span: the root, holding what only assembly knows (issue, cl, attempt, step, word, cause, cost, the end commit, the sandbox's image and id), and links to the attempts a review judged. Made at begin, written at end, so a stop cannot lose it
	- que-pasa's spans: under it, live, in the GenAI conventions. An invoke_agent span per process on the run, a chat span per model call, an execute_tool span per tool call, with the messages
	- a check span: under it, the check's test run

## Built

- the machine: an issue from open to accepted, proven end to end on scripted models, its plan landed on a real notes repo, with an attempt taken up after a stop, its cls landed through crate's merge queue, and nothing of the issue left behind once accepted (`just e2e`)
- the factory on the server: the service at the release dazoo names, moved by a commit to it; on real models, a cl built, reviewed and landed through crate; the operator's resume; and the sweep, which took away an older scheme's branches and worktrees
- the command line: `factory`, the image's entrypoint: its home `$ASSEMBLY_HOME`, else `$XDG_STATE_HOME/assembly`, its repos from `$ASSEMBLY_REPOS`, and its notes repo `$ASSEMBLY_NOTES`, else kinetic among the repos
	- on the laptop: `just factory <verb>` runs the verb on the server through its door, with its exit code and output
	- each command: a message through the one door, as the operator
	- `submit <issue> [--repo <path>]...`: the issue's note, `_well/<issue>.md`, as the notes' main holds it now, read with git, never from a working tree
		- with cl notes that belong to it: the operator's spec, whole, each cl new, its fields from its frontmatter and the plan's Phases naming exactly its cls in their phases, and checked by spec lint, as the planner's spec is. It enters at building: the main path. Its cls go in at the operator's go
		- with none: it enters at open, for the planner
	- `go <item>`: the next step of an item outside the inner loop, once ([[#The plant]], the inner loop). A waiting cl starts, or says why it can't yet; a building issue's cl notes at the notes' main go in, waiting; an issue at open, planned, approved or built runs that step at the loop's next tick
	- `stop <item>`: the operator's escalate of an item that moves. Its open attempt finishes, and nothing new starts on it, or on an issue's cls
	- `resume <item> [<state>]`: a held item, escalated or raised, to a station of its kind, by default where it was ([[#The plant]], the operator's levers)
	- `drop <item>`: an item the operator lets go, dropped, an issue with its cls not ended. It refuses while an attempt is open on it
	- `note <item> <agent>`: the operator's message, from stdin, to the agent's conversation on the item, for an agent whose step has had an attempt on it. The loop's next tick delivers it, once, and `explain` shows it, delivered or pending
	- `compact <item> [<agent>]`: a compaction of the agent's conversation on the item, by default the agent of its last attempt, for an agent whose step has had an attempt on it. The loop's next tick asks for it, and `explain` shows it, asked or pending
	- `rebase <cl>`: a held cl's branch on main as the land target has it now, with its worktree's change, or nothing and the conflicting files. A move is a message that keeps the cl where it is
	- `run`: the loop, until a signal stops it. Its attempts stay open. It needs crate's install, which makes each attempt's workspace
	- `status`, `blocked` (the raised and escalated items, with why) and `explain` (an item's note, messages, attempts, costs, the notes' commit each attempt read, and traces)
	- `top`: the factory live, redrawn every 2s until `q`: each issue with its phase and spend, each cl with its state, its attempts and the one open now, and the tokens and cost of each role on the item on screen (the item with an open attempt, else the one that moved last: a cl, or the issue at its own steps). Over ssh it asks for a terminal
- the attempt's workspace: crate's, from a repo's own `crate.toml`, its setup offline from a dev image made for a lockfile no image had, proven end to end (`factory/runs/workspace.e2e.test.ts`)
- the gate: `just check`, linting every note against its type, then types, eslint, prettier and the unit tests. `just e2e` is not in it, since it needs the podman socket

## Not built

- an issue whole on the server: from submit to accepted, with no step from the operator. A cl has landed there, never a whole issue
- an agent's conversation across attempts in que-pasa's runtime: proven in the unit tests only, on a stand-in runner
- the command line's `ask`
- a thinking level per bin: each model runs at its provider's default
- a tested push, for a repo not on crate: when main moves between the land's retest and `git land`'s push, `git land` rebases again with no test. A repo on crate has none: crate checks the tree main becomes
- a land of landl-db or lotus-dash: `git land` runs lot's lint for them, and the orchestrator's image has no `just`, so their lands retry and escalate
- check reuse: runs are recorded with their input hash, and never skipped on it

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
