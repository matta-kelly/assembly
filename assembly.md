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
- the roles: the method that meets a state, each an agent's instructions, in `workspace/agents/`: [[daworks/assembly/workspace/agents/planner|planner]], [[daworks/assembly/workspace/agents/plan-review|plan-review]], [[daworks/assembly/workspace/agents/da-nail|da-nail]], [[daworks/assembly/workspace/agents/da-hammer|da-hammer]], [[daworks/assembly/workspace/agents/cl-review|cl-review]], [[daworks/assembly/workspace/agents/issue-review|issue-review]]
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
		- a finding: a fault in one artifact (the issue, the plan, a cl, its tests or its code), with what fails, its evidence and where. A check hands back all it found, in one pass
		- the owner: who made the artifact, and so who fixes it. The tests are da-nail's, the code da-hammer's, a cl and the plan the planner's, the issue Matt's
		- back: a finding goes up the V to its artifact's owner. Findings about several artifacts go to the highest one's owner, since its fix can change the rest
		- raise: a back about a spec (a cl, the plan or the issue), never settled below. A cl's raise holds its issue for Matt, who fixes the notes where the fault is, its cl, its plan or the intent, and resumes it, and the outcome is said: re-scope, split or drop
		- escalation: the item goes to Matt on its third retry at one state, its third round back, or a move no rule covers, and the work it holds up waits until he answers
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
				- status: set by hand, or projected one way by a controller from its own record, keyed by the note's name. Not built: the factory reads notes with its own parser (`process/plan.ts`), not basis
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
- the machine moves an issue through the V, from open to accepted; met is Matt's

## The split

The issue goes down the left side, each level a state, made by one role and checked by another before the next starts. A state is the bar, its type note what good looks like; a role is the method that meets it ([[terms]]).
- [[issue]]: a need and the promises that meet it, born from a signal (a bug, an idea, a breakage). Made by Matt
- [[plan]]: the issue cut into cls, only when it takes more than one. Made by the [[daworks/assembly/workspace/agents/planner|planner]], from a known way to cut its kind of change ([[playbook#Cutting a change]]); checked by [[daworks/assembly/workspace/agents/plan-review|plan-review]] before any cl starts
- [[cl]]: one cut at its surface, its promises, seam and context, the spec its builders work from alone. Made and checked with its plan

## The build

The point of the V and the right side up to main: each cl built in its own [[workspace]], one worktree of the whole repo on the cl's branch, its Core context where its builders start. The method follows the cl's shape ([[playbook#Building a cut]]).
- the tests: made by [[daworks/assembly/workspace/agents/da-nail|da-nail]], from the cl's promises, before any code
- the code: made by [[daworks/assembly/workspace/agents/da-hammer|da-hammer]], until the tests pass, never changing one
- the verdict: [[daworks/assembly/workspace/agents/cl-review|cl-review]]'s, then the dock lands it ([[#The dock]])
- the whole: judged by [[daworks/assembly/workspace/agents/issue-review|issue-review]] on main. The machine runs the split and the build as code, and reaches verified, never met

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

- dev image: the toolchain and the package cache, which every bench starts from
- services: what runs beside the work, from `pod.yaml`. Not built ([[workspace-on-crate]])
- check: `check.sh`, the one inspection, the same at every bench and at the dock

## The bench

[[workspace]]: where one job is done, a branch, a worktree and a running copy of the repo's environment, made for the job and removed after. The same bench for Matt and for an attempt.

- worktree: the item's one checkout, the whole repo, beside its attempts' folders (`runs/<issue>/cl/<cut>/work`, `runs/<issue>/issue/work`), which every attempt of the item works in. Removed when the item ends ([[#The plant]], the sweep)
	- a cl's: on its branch, `assembly/<cl>/head`, made from main when the cl first needs it
	- an issue's: detached, moved to main as it is now at each attempt. An issue of several repos holds one per repo, at `work/<repo>`
- container: the dev image with the worktree mounted, rootless and capped
- network: its own. An attempt's has no way out
- setup: an offline install from the image's cache, once per worktree ([[#One job]])

## The paperwork

The model: the four things that travel with a job, each with its rules in the process, its store behind an effect, and its moves in the engine.

- spec: the notes that say what must be true: the issue, the plan and its cls, in kinetic, the notes repo. The only spec: the ledger holds no copy of it
	- types: [[issue]], [[plan]] and [[cl]], with [[objective]] and the abstract [[work]], in `work/`: the package `@mku1tra/work`, which holds the types and no notes. A graph that holds work imports it, so work is in any repo, with or without the factory
	- shapes: held by the process. `effects/notes.ts` reads them at a commit of the notes' main, never from a working tree
	- the commit: each attempt fetches the notes' main as it starts and pins its commit on the attempt, so its note, a cl's test command and every review's input are the spec as it was then, and an edit is read by the next attempt
	- writes: the engine writes only the notes of a spec the factory's planner made, in kinetic's format, and lands them on the notes' main as the issue's land ([[#The dock]]). No note's `status` is written: the ledger is the status. A finding is never written into a note
	- Matt's spec: his own notes on the notes' main, which the engine reads and never writes
- product: the files a cl's builders make, its tests and its code, in git
	- judged by: the process's checks. Red at an assertion, no test changed, green
	- held by: `effects/git.ts`. The engine commits it, and lands it on main ([[#The dock]])
- role: the instructions one agent works from (`workspace/agents/*.md`)
	- run by: `effects/runner.ts`, from the agent and the bin its step names
- message: the record a step ends with, saying what it concluded and who acts next (`process/step.ts`'s `Message`)
	- its parts: a word, why in one line, a failure's cause, its findings, and notes for the next step
	- its words: pass, retry or back from a step; pass, drop, escalate or resume from the orchestrator or Matt
	- its sender: on its event. An attempt as it ends, the orchestrator, or Matt
	- the rules a message follows ([[#Policy]], backpressure): the finding, the owner, back, the raise, escalation and the record. Each is held here
	- finding: `process/step.ts`'s `Finding`, its `about` the artifact
	- pass: moves the item on
	- retry: runs its step again
	- back: a sender is any step. An agent hands back findings in place of its done result; a check can too (a red suite at acceptance)
		- raise: a cl's escalates its issue to Matt, with its findings, whoever made the spec (`advance.ts`). He fixes the notes, and resumes it
		- escalation: none of an escalated issue's cls starts an attempt, and a raised cl blocks the phases after it, until Matt answers
	- routing: `process/table.ts`, as data: each move, `owner`, the state of each artifact's owner, and the highest artifact a back's findings name
	- the one door: `ledger.apply`, which every message goes through, whoever sends it
	- the record: the ledger's events, one per message, appended and never edited. An item's state is their projection, moved in the same transaction
	- an agent's input: its spec, then its messages, the one that brought the item to its state and each since (`ledger.inbox`). Its product it reads in the worktree

## The plant

The machine: what moves jobs from station to station, in four layers put together by `main.ts`. The engine runs the process and calls the effects; the process reaches the effects only through its notes and the tools each agent names.

- process: what the work is (`process/`, `workspace/`). It decides, and touches only its own notes
	- the path: the states an item moves through on messages, held as data in `process/table.ts`
		- an issue's repos: the ones its cls may change. By default every repo on crate under `ASSEMBLY_REPOS` (lot when it is not set; a git repo with a `server` remote) but the notes repo, and the planner picks among them; `factory submit --repo` narrows them. Each repo's image, full suite and setup are read from the item's worktree at each attempt (`effects/repo.ts`): its image is its `crate.toml`'s, with `dev` its dev image, which crate makes from the worktree (`crate dev-image local`) in the orchestrator, from the host's install mounted read-only there, so a repo with no copy of the script is taken; its full suite `scripts/check.sh all`; its setup `npm ci --offline` when it has a lockfile. A repo not on crate breaks the item's contract (`contract_invalid`); crate's failure is a dependency (`missing_dependency`)
			- a cl: names its repo, one of the issue's, when the issue has several, and runs, sets up and lands in it. A change across repos is a cl per repo
			- the issue's own steps: each repo at `/work/<repo>`, in a plain Node image, since they only read; acceptance runs each repo's full suite
		- an issue: open → planned (the planner cuts it) → approved (plan-review approves it) → building (its plan and cl notes landed on the notes' main) → built (each cl landed on main, phase by phase) → accepted (the full suite green on main, and issue-review). Acceptance closes the issue and never gates the code, which is on main already. A review can send it back to the planner, and so can a plan land the notes' check refuses. An issue Matt submits with his cl notes enters at building
		- a cl: waiting (for the phases before its own) → ready → red (da-nail's tests) → green (da-hammer's code, or da-nail's tests that pass at once: the code there already meets them) → approved (cl-review) → landed (on main). A review can send it back to its tests or its code, and so can the land
		- Matt's levers: stop, his escalate of any item that moves; resume, an item he holds back to a station of its kind (a cl's ready, red, green or approved; an issue's open, approved, building or built), by default where it was, with a fresh budget: its attempts and rounds count from his move. An issue resumed at building takes its cls from its notes at main: a new cl note adds a cl, a gone one drops its cl, and its held cls go back; and drop, an item he lets go, which ends undone, an issue with its cls not ended, its record kept
	- a step: one per state, with its agent, its result's shape and its check (`process/*.ts`, listed in `process/index.ts`)
		- the steps: plan (the issue has promises in Done, and the spec lints: kinetic's rules, and the repo's), plan review, nail (the tests run to an assertion: red to hammer, green to review), hammer (no test changed, then green), review (still green), accept (the full suite green)
		- a check: reads the result and the attempt's worktree through a port (`Worktree`: a test run, the changed files, the files there), and gives the message
		- the builders: nail and hammer, in the cl's one worktree, the whole repo. The cl's Core context is where its change lives: they start there, and read wider only when the work needs it. The instruction holds their tokens, and `factory top` shows them
			- a path of the Core context: a file or a folder, a plain path from the repo's root
			- the commit: every change the attempt made
			- hammer: changes no test file, none da-nail wrote and none its test command runs
			- a test run: one op (`effects/tests.ts`'s `runTests`), for the agent's `test` tool and the step's check alike, on the cl's worktree with the attempt's change, so the tree a test sees is the tree a pass commits
	- the land: an approved item's attempt, code with no agent (`effects/land.ts`): a cl's onto its repo's main, an issue's plan onto the notes' main. Its moves are in [[#The dock]]
	- an agent: its instructions in its role note beside it, and the bin it names (plan, implement, review), never a model
	- the workspace: what the agents are made of (`workspace/`), apart from the machine that runs them. Not the bench ([[workspace]])
		- `agents/`: each agent's role note, and its code beside it
		- `tools/`: `test`, the cl's test command, for nail and hammer: the factory's one tool of its own
			- que-pasa's tools: every other one, after LangChain's Deep Agents, in the sandbox the runner gives each run
			- for every agent: `ls`, `read_file`, `glob`, `grep`
			- for nail and hammer: `write_file`, `edit_file`, in the cl's worktree
			- for the planner and the reviews: `execute`, a shell. They only read
		- `types/`: the factory's own notes that a role works to and is judged against. The work's are type notes, in `work/types/`
			- in its context: que-pasa's memory middleware reads an agent's types once, when its conversation is made, keeps them with it, and adds them to the system prompt before each model call (`workspace/agents/types.ts`)
			- every agent: [[terms]] first, the one vocabulary, and each state it reads or makes
			- the builders: da-nail [[cl]] and [[tests]], da-hammer [[cl]] and [[code]]. cl-review: [[code]], [[tests]] and [[changelist]], the same text its builders have, and [[cl]]
			- the planner and plan-review: [[issue]], [[plan]], [[cl]], [[changelist]] and [[playbook]]
			- issue-review: [[issue]], [[plan]] and [[cl]]
			- Held by: `types.test.ts`, each type an agent names is a note there. Memory leaves out a source that is not there, and says nothing
			- a work type: its type note, the definition itself, so an agent and a person who writes a note read the same text
- engine: what moves it (`orchestrator/`)
	- the ledger: `ledger.ts`, SQLite, the orchestrator's only state: where each item stands, and every message
	- the tick: `loop.ts`. Sweeps, then starts attempts, up to `concurrent` at once, the open ones first; readies each (its worktree, its notes' commit, its settings, its setup), answers each check's worktree, and records its test run
	- the lands: `loop.ts` too. One per approved item, as an attempt, and the lands onto one main one at a time, each after the one before it
	- the sweep: at open and on each tick, in the notes repo and every repo the ledger names (`effects/git.ts`). A live item, one not ended or with an attempt open, keeps its worktree and its branch; every other worktree under the runs folder and every other `assembly/` branch goes. One rule covers an item's end, a crash between moves, and an older scheme's leftovers. A worktree outside the runs folder is never touched
	- the orchestrator's own moves: `advance.ts`, each through `ledger.apply`. A building issue with no cl left to land reads its notes at the notes' main: each cl note not in the ledger goes in, in its phase's order, phase 1 ready and the rest waiting; with none to add, the issue is built. Each phase starts once the one before has landed (and, for a cl whose repo depends on a package a landed cl made, once that version is on npm, asked through `effects/registry.ts`: the cl stays waiting with the reason as a retry, written once per reason, a failed ask is a reason too, and a wait past the factory's `waitLimitMs` (30 minutes when not set) escalates the issue). A released cl's worktree is moved onto every version it needs first, each its own commit (`effects/move.ts`, the one container with the network), and set up again, so its attempts run its new lockfile, in a dev image made from it. A move that fails escalates the issue, with the command's output, and the cl waits. A cl that raises, or is escalated, escalates its issue
- effects: how it touches the world (`effects/`), each behind a small seam
	- `git.ts`: each item's worktree and branch, its commits, main as the land target has it, and the sweep
	- `land.ts`: the land, an approved item onto its main, from its worktree: a push that crate checks, or `git land` for a repo not on crate
	- `move.ts`: a released cl's worktree onto the version it waited for, in a container with the network, committed on its branch as `build(deps): <package> to <version>`
	- `sandbox.ts`: what each container is given. que-pasa's `podman()` makes it
	- `tests.ts`: a test run, in a container of its own
	- `setup.ts`: a worktree's setup, the same way
	- `runs.ts`: the run folders. `sh.ts`: the commands under them
	- `runner.ts`: the run, on que-pasa's durable runtime: one conversation per agent on an item, and its context, which its tools read
	- `models.ts`: the bins, a default model and a fallback for a retry
	- `notes.ts`: the notes, read at a commit of the notes' main. `trace.ts`: the record of each attempt
- wiring: `main.ts`. `compose` builds the factory from the other three, on its notes repo, and the world the loop waits on (`npmRegistry`, `gitReader`, `landedTags`; a test stands its registry in through `Factory.registry`), under one home (`ledger.db`, `pi.db`, `runs/`). The e2e builds through it
- the command line: `cli/`, one module per command, on what `compose` builds (`just factory`)

## One job

An attempt: one step on one item, at the item's bench. Its run and its sandbox are its own, and it lives until it ends.

- begin: the ledger opens it, with its trace's ids
- ready: the item's worktree made or kept, the notes' main fetched and its commit pinned on the attempt (a taken-up attempt keeps its own), and the repo's settings read from the worktree. A failure is a retry before any agent, with its cause
- setup: the repo's setup installs its dependencies into the worktree from the [[repo#Dev image|dev image]]'s cache, with no network, in a container of its own, inside the attempt's task, so a tick never waits on it
	- once per worktree: `setup.done` in the item's folder, beside the worktree, forgotten when the worktree is made again, an issue's moves to a new main, or a move changes a cl's lockfile
	- what it installs: ignored by git
	- a failure: a retry with `missing_dependency`, before any agent. It names an image older than the lockfile (npm's ENOTCACHED), or the files it left unignored
- sandbox: a container with no network, the worktree mounted (read-only for a review), up on its tools' first call. The agent's loop runs in the orchestrator and holds the key (LangChain's "sandbox as tool")
- run: que-pasa's, one input on the agent's conversation on the item (`<item>/<agent>`), with the attempt's number as its id, under the attempt's span, on the bin's model
	- the conversation: made by the agent's first run on the item, and kept across its attempts, so the agent remembers what it read, wrote and was told. Its context lives as long as it: the item, the agent, the item's folder, read-only or not
	- the input: the first run's, its spec and its messages; a later run's, only what is new: a review's input again, the note when it changed, and the messages since the agent's last run
	- the attempt's run: written to the item's folder before each run (`<agent>.run.json`), where the sandbox and the test tool read it
- check: the step's, on the worktree. Its test run in a container of its own
- commit: a pass of a step that edits, on the item's branch, titled as crate reads a release. No note is written
- any other end of a step that edits: its change stays in the worktree, uncommitted, and the cl's next attempt goes on from it
- end: the attempt span is written, then the ledger moves the item, in one transaction with one event, its message
- across a stop
	- a stopped orchestrator: ends nothing. Each attempt stays open, and its container stays up
	- the next one: takes each open attempt up. Its sandbox again (kept, started again, or run again on the same worktree), and its run goes on from where it stopped, with no model call redone
	- a cut-off tool call: runs again only if twice is the same as once (`ls`, `read_file`, `write_file`, `glob`, `grep`). For `edit_file`, `execute` and `test`, the model gets `interrupted`
	- the time limit: per process

## The dock

[[ci]]: final inspection into the warehouse, main.

- the gate: the check passes on the exact commit, then main moves by fast-forward
- the land target: the remote a cl lands on: `server`, main's bare repo guarded by crate ([[repo#Platform]]), when the repo has it; else `local`, a bare repo on this machine; else `origin`. Main is its main, fetched as each attempt starts
- the land: each approved cl onto main, as Matt, with `git land`, in the cl's worktree (`effects/land.ts`)
	- landed already: a cl whose change main holds passes as it is (`git cherry`, which compares changes, not commits), so a land a stop cut off is safe to run again
	- through crate's merge queue (`server`): `git land` puts the branch in the queue and waits for crate's verdict. crate checks it on top of the changes ahead of it and picks it onto main, so the land neither rebases nor tests, and main may hold the change as a commit of its own
		- does not apply on main and the changes ahead: a back about the plan (`restack_conflict`), with the files, since keeping the cls of one phase apart is the plan's work
		- refused by the check: a back about the code (`check_failed`), with the check's output
		- left the queue, or no verdict: a retry
	- through `git land` to a repo's gate, for a repo not on crate
		- rebase: the cl's branch onto main. A conflict is a back about the plan (`restack_conflict`)
		- retest: the cl's test command on the rebased tree, when main moved under it. A red is a back about the code (`check_failed`), and the branch stays on the rebased tree, so da-hammer works on the code main will hold
		- push: `git land`, through the repo's gate. A land it refuses is a retry
	- landed: the cl's branch is the commit main took, and the ledger keeps that commit, which its version tags are read from, and the files it changed
	- an issue's plan: its land writes the plan and cl notes its planner made on the issue's branch of the notes repo, from main as it is now, replacing the notes of its cls not landed, commits them as `docs(<issue>): its plan`, and lands them as a cl lands, so the notes' own check lints them. A refusal is a back about the plan, to the planner
- the identity: Matt's
	- the author: his name, from the host's git config
	- the push: to `server`, over SSH as the server's git user; to GitHub through `git land`, his GH_TOKEN from the orchestrator's environment (on the laptop, the vault's, through rbw-run; on the server, the service's), set as gh's credential for the push alone
- after the dock: [[cd]] ships main onto a node, outside the plant

## Seams

Where it meets other systems, and what crosses each.

- [[que-pasa]]: the harness. assembly gives it agents, each with its tools and its middleware, a conversation per agent on each item, a model per run; it gives back the result and the usage, keeps the conversation and the run across a stop, and traces it. `@mku1tra/que-pasa` on npm, by version range
- [[kinetic]]: the work, the notes repo (`ASSEMBLY_NOTES`, else kinetic among the clones). The spec is kinetic's, of the types of `@mku1tra/work`, which kinetic imports from npm; assembly is its controller, and the ledger is the status, keyed by the note's name. Kinetic lints the notes where they live; assembly reads them at a commit of its main, pinned on each attempt, and writes only the notes of a spec its planner made, which land on its main as any change does
- evals: the traces and the ledger, read later. Scores and labels are their own records, keyed by trace or span id
- the model provider: pi-ai's Fireworks provider. Its key, `FIREWORKS_API_KEY`, reaches the orchestrator only, never a sandbox, through its environment: `scripts/factory.sh run` refuses to start without it. On the laptop `just factory run` fills it from the vault (`secrets.toml`, through rbw-run); on the server the factory's service fills it. `just smoke-model` makes one real call per model
- the server: monkeybusiness, where the factory runs, declared in [[dazoo]] (`nodes/mutable/monkeybusiness/assembly/`)
	- the account: `assembly`, its own user. Its home holds the clones of the repos on crate (`ASSEMBLY_REPOS`, `~/repos`), the notes repo among them (`ASSEMBLY_NOTES`), and the factory's home (`ASSEMBLY_HOME`). It cannot read or write `core`'s files, and its key reaches `core`'s repos for git alone
	- the service: a user service of the account, `factory.sh run` at a release, the tag crate makes on a land (`v<x.y.z>`). dazoo's `version` file names it, and a commit to it checks the tag out and restarts the factory on it
	- its keys: the model key and the GitHub token, sealed in dazoo, unsealed by root into the account's `keys.env`, which the service reads
	- the laptop: reaches it over ssh when `ASSEMBLY_SERVER` is set (`assembly@monkeybusiness`). The laptop's key is forced through `factory-ssh.sh`, which lets through only the commands Matt gives (submit, stop, resume, drop, status, blocked, explain, top), never `run`
- the host: git and podman
	- branches: each item's work on `assembly/<name>/head`: a cl's passed work in its repo, an issue's plan in the notes repo. A live item has its branch and its worktree, and nothing else under `assembly/` stays
	- the orchestrator: its own image (`orchestrator/Containerfile`: node, git, gh, skopeo, the podman client, and the host's git-land and crate mounted read-only), starting containers through the host's podman socket, with host paths at the same path

## Records

What it keeps.

- the ledger (`ledger.db`): where each item stands, and the record of its attempts. No content: the spec is the notes, the product the branches
	- items: with its note's path, a cl's phase, an issue's repos, and the commit main took once landed
	- attempts: state, word, reason, cause, duration, tokens in, out and cached, cost, the result, trace ids, times taken up, and the commit of the notes it read: with the note's path, the exact spec it saw
	- events: one per message, with who sent it, its word, reason, cause, findings and notes, and the move it made
	- paths: the files each cl changed, once landed
	- check runs: command, image, tree, input hash, exit code, duration
- pi's store (`pi.db`): que-pasa's conversations and runs, so a run goes on after a stop
- a run folder: per item, by issue (`runs/<issue>/issue/`, `runs/<issue>/cl/<cut>/`), with its worktree (`work/`, and an issue's `notes/` for its plan's land), its setup's mark, each agent's attempt going on (`<agent>.run.json`), and a folder per attempt (`<n>/`) with its log and its trace. The folders stay when the worktree goes
- the trace (`trace.jsonl`): each attempt as one OpenTelemetry trace, OTLP JSON, semconv 1.43.0
	- the attempt span: the root, holding what only assembly knows (issue, cl, attempt, step, word, cause, cost, the end commit, the sandbox's image and id), and links to the attempts a review judged. Made at begin, written at end, so a stop cannot lose it
	- que-pasa's spans: under it, live, in the GenAI conventions. An invoke_agent span per process on the run, a chat span per model call, an execute_tool span per tool call, with the messages
	- a check span: under it, the check's test run

## Built

- the machine: an issue from open to accepted, proven end to end on scripted models, its plan landed on a real notes repo, with an attempt taken up after a stop, its cls landed through crate's merge queue, and nothing of the issue left behind once accepted (`just e2e`)
- the factory on the server: the service at the release dazoo names, moved by a commit to it; on real models, a cl built, reviewed and landed through crate; Matt's resume; and the sweep, which took away an older scheme's branches and worktrees
- the command line: `scripts/factory.sh`, which `just factory` calls and the gate tests without `just`: its home `$ASSEMBLY_HOME`, else `$XDG_STATE_HOME/assembly`, its repos from `$ASSEMBLY_REPOS`, else lot, and its notes repo `$ASSEMBLY_NOTES`, else kinetic among the repos
	- on the laptop: `ASSEMBLY_SERVER` set runs the verb on the server over ssh, with its exit code and output
	- each command: a message through the one door, as Matt
	- `submit <issue> [--repo <path>]...`: the issue's note, `_well/<issue>.md`, as the notes' main holds it now, read with git, never from a working tree
		- with cl notes that belong to it: Matt's spec, whole, each cl new, its fields from its frontmatter and the plan's Phases naming exactly its cls in their phases, and checked by spec lint, as the planner's spec is. It enters at building
		- with none: it enters at open, for the planner
	- `stop <item>`: his escalate of an item that moves. Its open attempt finishes, and nothing new starts on it, or on an issue's cls
	- `resume <item> [<state>]`: an item he holds, escalated or raised, to a station of its kind, by default where it was ([[#The plant]], Matt's levers)
	- `drop <item>`: an item he lets go, dropped, an issue with its cls not ended. It refuses while an attempt is open on it
	- `run`: the loop, until a signal stops it. Its attempts stay open. It needs crate's install, which makes each attempt's dev image
	- `status`, `blocked` (the raised and escalated items, with why) and `explain` (an item's note, messages, attempts, costs, the notes' commit each attempt read, and traces)
	- `top`: the factory live, redrawn every 2s until `q`: each issue with its phase and spend, each cl with its state, its attempts and the one open now, and the tokens and cost of each role. Over ssh it asks for a terminal
- the dependencies in an attempt: an offline install from the dev image's cache, once per worktree, proven on a que-pasa worktree (setup in 11 s, then its tests pass, no network)
- the gate: `just check`, linting every note against its type, then types, eslint, prettier and the unit tests, then `scripts/factory.test.sh` (podman, ssh and rbw-run faked; git is real), so a fault in the recipe fails the check. `just e2e` is not in it, since it needs the podman socket

## Not built

- the cl's shape in nail: every new test must be red at an assertion, so a structure cl, whose tests pass now, cannot pass
- an issue whole on the server: from submit to accepted, with no step from Matt. A cl has landed there, never a whole issue
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
