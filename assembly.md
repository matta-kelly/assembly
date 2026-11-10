---
type: moc
description: "Root of assembly, the software factory: a deployment of que-pasa that moves an issue through its plan and its cls to accepted. Read for how the factory works as a system, where it meets other systems, what it records, and what is built."
status: active
---
The software factory: a deployment of [[que-pasa]] that moves an issue through its plan and its cls, one cl at a time, to accepted. It is the inner loop of [[kinetic]], as code.
- [[#The model]] what it works on: spec, product, role and message
- [[#The machine]] what moves, and the part that moves it
- [[#An attempt]] one step's life, across a stop
- [[#Seams]] where it meets other systems, and what crosses each
- [[#Records]] what it keeps
- [[#Built]] and [[#Not built]]

- [[point-b]]: what it is for, through [[software-factory-v2]]
- [[software-factory-v2-design]]: the design it follows

---
## The model

Four kinds of thing. Each has its rules in the process, its store behind an effect, and its moves in the engine.
- spec: the notes that say what must be true (the issue, the plan and its cls, in kinetic)
	- the process holds their shapes, and `effects/notes.ts` reads them by path
	- the engine writes only the factory's own plan and cl notes, and each item's `status`. A finding is never written into a note
- product: the files a cl's builders make (its tests and its code, in git)
	- the process's checks judge it: red at an assertion, no test changed, green
	- `effects/git.ts` holds it, and the engine commits and merges it
- role: the instructions one agent works from (`agents/*.md`)
	- a step names its agent and its bin, and `effects/runner.ts` runs it
- message: the record a step ends with, which says what it concluded and who acts next
	- it holds who it is from, the artifact it is about (the issue, the plan, a cl, the tests or the code), its word, and for a finding, what fails and the evidence
	- pass moves the item on. A finding goes up the V to the owner of the artifact it is about: the tests to da-nail, the code to da-hammer, a cl or the plan to the planner, the issue to Matt. Any step can send one
	- a raise is a finding about a spec (a cl, the plan or the issue), and an escalation is a message about the issue
	- `process/table.ts` routes it, as data. The ledger's events hold it, one per message, appended and never edited, and an item's state is read from them
	- each agent's input is its spec, its product, and the messages about its artifacts

## The machine

Four layers, and `main.ts` puts them together. The engine runs the process and calls the effects. The process reaches the effects in two places only, its notes and the tools each agent names. A check asks the engine for what it needs, and the runner is the engine's `Runner`.
- process, what the work is: `process/` and `agents/`. It decides, and touches only its own notes
	- the path: an issue and its cls move from state to state on words (pass, retry, raise, to-tests, to-code, to-plan). `process/table.ts` holds it as data
		- an issue: open → planned (the planner cuts it into cls) → building (plan-review approves) → built (each cl merged into the issue's branch, in plan order) → accepted (issue-review, and the full suite green). A review can send it back to the planner, and so can a cl that raises
		- a cl: waiting (for the cl before it) → ready → red (da-nail's tests) → green (da-hammer's code) → approved (cl-review) → merged. A review can send it back to its tests or its code
		- an item is escalated, for Matt, on its third failed attempt at one state, on its third send-back, or when a move of the orchestrator's own fails
	- a step, one per state: its agent, its result's shape, its check (`process/*.ts`, listed in `process/index.ts`)
		- plan (the plan lints), plan review, nail (red at an assertion), hammer (no test changed, then green), review (still green), accept (the full suite green)
		- a check reads the result and the attempt's worktree, which it asks through a port (`Worktree`: a test run, the changed files, the files there), and gives the word
		- nail and hammer work inside their cut: the planner explored, so they do not. A step's view is its cut's files (`process/plan.ts`'s `viewOf`): its tools read those, write only the ones it changes, and to them nothing else exists. A file the cut did not give is a raise. Code its tests run can still write elsewhere, so an attempt whose worktree changed any other file is a retry (`scope_exceeds_change`), and only the change files are committed. Hammer changes no test file: none its Tests section names, and none its test command runs The cut's test command runs its new test files and the existing ones that test the code it changes
	- the agents (`agents/`): each one's instructions are its role note beside it (it's type role), and each names a bin (plan, implement, review), never a model
- engine, what moves it: `orchestrator/`
	- the state: `ledger.ts`, SQLite, the only state the orchestrator holds: where each item stands, and every move, with its cause
	- the tick: `loop.ts`. It starts attempts, up to `concurrent` at once, the open ones first. It answers each check's worktree, and records its test run
	- the orchestrator's own moves: `advance.ts` (an approved plan's cls, each cl in turn, the merges)
- effects, how it touches the world: `effects/`, each behind a small seam
	- `git.ts` the branches, worktrees, commits and merges · `sandbox.ts` what each container is given (que-pasa's `podman()` makes it) · `tests.ts` a test run, in a container of its own · `setup.ts` a worktree's setup, the same way · `runs.ts` the run folders · `sh.ts` the commands under them
	- `runner.ts` the run, on que-pasa's durable runtime · `models.ts` the bins, after loke's: a default model and a fallback for a retry · `tools.ts` the run's context, and `test`, the cl's test command, for nail and hammer. Every other tool is que-pasa's, after LangChain's Deep Agents, in the sandbox the runner provides each run: `ls`, `read_file`, `glob`, `grep` for every agent; `write_file`, `edit_file` for nail and hammer, over que-pasa's `view` of their cut's files; `execute`, a shell, only for the steps with no view (the planner and the reviews, which only read)
	- `notes.ts` the issue and cl notes · `trace.ts` the record of each attempt
- wiring: `main.ts`. `compose` builds the factory from the other three, under one home (`ledger.db`, `pi.db`, `runs/`). The e2e builds through it
- its ways in: `cli/`, the factory's command line, one module per command, on what `compose` builds (`just factory`)

The chart of the path and its words is drawn with pele, from `process/table.ts` and `orchestrator/advance.ts`.

## An attempt

One step on one item: its run, its sandbox and its worktree are its own, and it lives until it ends.
- begin: the ledger opens it, with its trace's ids
- setup: the issue's `--setup` (such as `npm ci --offline --no-audit --no-fund`, the command its dev image's smoke proves) installs the repo's dependencies into the new worktree from the image's cache, with no network, in a container of its own, once per worktree (`setup.done` in the attempt's folder, forgotten when the worktree is made again), inside the attempt's task, so a tick never waits on it. What it installs must be ignored by git. A failure ends the attempt as a retry with `missing_dependency`, before any agent, and names an image older than the lockfile (npm's ENOTCACHED) or the files it left unignored
- sandbox: a container with no network, the worktree mounted (read-only for a review). The agent's loop runs in the orchestrator and holds the key; its tools work in the sandbox (LangChain's "sandbox as tool"), which comes up on their first call
- run: que-pasa's, with the attempt's id, under the attempt's span, on the bin's model
- check: the step's, on the worktree; its test run in a container of its own
- write and commit: a pass or a send-back writes its section of the note, and a step that edits commits, which moves the item's branch
- end: the attempt span is written, then the ledger moves the item, in one transaction with one event

Across a stop:
- a stopped orchestrator ends nothing: each attempt stays open, and its container, which outlives the orchestrator, stays up
- the next one takes each open attempt up: its sandbox again (kept, started again, or run again on the same worktree), and its run goes on from where it stopped, with no model call redone
- a tool call a crash cut off runs again only if twice is the same as once (`ls`, `read_file`, `write_file`, `glob`, `grep`). For the others (`edit_file`, `execute`, `test`) the model gets `interrupted`
- the time limit is per process

## Seams

- que-pasa, the harness: assembly gives it agents, tools, a model and a context (the attempt) per run; it gives back the result and the usage, keeps the run across a stop, and traces it. A published package, `@mku1tra/que-pasa` on npm, by version range: a new que-pasa reaches assembly when its range moves
- kinetic, the work: the issue and cl notes and their types. kinetic is the spec, assembly is its controller, and the ledger is the status, keyed by the note's name ([[kinetic#Policy]], one fact, one place). Kinetic lints the notes where they live; assembly reads them by path, and writes back only its projections
- evals: the traces and the ledger, read later; scores and labels are their own records, keyed by trace or span id
- the model provider: pi-ai's Fireworks provider. Its key, `FIREWORKS_API_KEY`, comes from the vault (`secrets.toml`, through rbw-run) into the orchestrator's environment only, never a sandbox. `just smoke-model` makes one real call per model the bins name
- the host: git (each item's passed work on `assembly/<name>/head`, each attempt on `assembly/<name>/<n>`, made from the item's branch, else its issue's, else main) and podman. The orchestrator runs in its own image (`orchestrator/Containerfile`: node, git, the podman client) and starts containers through the host's podman socket, with host paths at the same path

## Records

- the ledger (`ledger.db`): items; attempts (state, word, reason, cause, duration, tokens in, out and cached, cost, the result, trace ids, times taken up); events, one per move, with their cause; each cl's planned and actual paths; check runs (command, image, tree, input hash, exit code, duration)
- pi's store (`pi.db`, beside the ledger): que-pasa's runs, so a run goes on after a stop
- run folders, by issue: `runs/<issue>/issue/<n>/` and `runs/<issue>/cl/<cut>/<n>/`, each with the attempt's worktree, its log (the orchestrator's own lines, such as a take-up), and its trace, which holds each tool call
- the trace (`trace.jsonl`): each attempt as one OpenTelemetry trace, OTLP JSON, semconv 1.43.0
	- the attempt span is the root: what only assembly knows (issue, cl, attempt, step, word, cause, cost, the end commit, the sandbox's image and its id), and links to the attempts a review judged. Its ids are made at begin, and it is written at end, so a stop cannot lose it
	- que-pasa's spans under it, live, in the GenAI conventions: an invoke_agent span per process that worked on the run (a resumed one is marked), a chat span per model call, an execute_tool span per tool call, with the messages
	- a check span under it: the check's test run

## Built

- the whole machine, an issue from open to accepted, proven end to end on scripted models, and an attempt taken up after a stop (`just e2e`)
- the factory's command line, `just factory`: `add` a note, by its kinetic type: an issue enters at open, for the factory's planner; a plan made outside the factory (a kinetic plan and its cl notes, each with its test command in its Files), or the lone cl of an issue that takes one (its `belongsTo` the issue), enters with its cls ready and waiting, so only the inner loop and acceptance run them, writing into those notes. Those notes are checked as the factory's own plan is (the cut schema, plan lint), and a raise or a send-back on them goes to Matt, escalated, never to the factory's planner; `run` the loop until a signal stops it (its attempts stay open), `status`, `blocked` (the raised and escalated items, with why) and `explain` an item (its moves, its attempts, their cost and their traces). Its home is `$XDG_STATE_HOME/assembly`
- the repo's dependencies in each attempt: an offline install from its dev image's cache ([[repo#Dev image]]), once per worktree, proven on a que-pasa worktree with `que-pasa-dev:main` (setup in 11 s, then its tests pass, no network)
- the gate: `just check` lints every note against its type, then checks the code: types, eslint, prettier, and the unit tests (podman and git faked). `just e2e` is not in it, since it needs the podman socket

## Not built

- the cl's shape in the nail step: its check wants every new test red at an assertion, so a structure cl, whose tests pass now, can't pass it; and da-nail's tools still fence by the cut's file list, not a sparse checkout of its scope
- the planner's role as written: its result is still the cut of the old cl (files, grounds copied in, Check items by number), which `process/plan.ts` validates, and its envelope does not inline the [[plan]] and [[cl]] type notes its Bar points to
- the cl as kinetic defines it: assembly reads a cl's files and test command from the planner's cut in its ledger, or from the cl's Files section, and fences the agent with que-pasa's view. kinetic's cl holds `scope`, `shape` and `test` in its frontmatter, and the agent works in a sparse checkout of its scope
- the message as [[#The model]] defines it: a step's message is only its word, and its findings are written into the notes' sections (Plan review, Review, Acceptance). The routing is per step (to-tests, to-code, to-plan), not by the artifact's owner, and an agent's input is not built from the messages
- a run on a real model: the model path is proven (`just smoke-model`), but nothing starts a run on a real issue yet
- the command line's `retry`, `replan` and `ask`
- a thinking level per bin: each model runs at its provider's default
- the dev image's tag per lockfile: `--image` names one tag, such as `<repo>-dev:main`, for every attempt; a worktree whose lockfile is newer than it fails its setup, named as such. The exact tag (`dev-image.sh local`) needs skopeo or a build in the orchestrator's image
- a plan's cls in parallel, or a plan across repos: a plan's cls run one at a time, in one repo
- landing an accepted issue's branch: Matt lands it
- check reuse: check runs are recorded with their input hash, but a run is never skipped on it
