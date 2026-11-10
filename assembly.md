---
type: moc
description: "Root of assembly, the software factory: a deployment of que-pasa that moves an issue through its plan and its cls to accepted. Read for how the factory works as a system, where it meets other systems, what it records, and what is built."
status: active
---
assembly: the software factory, a deployment of [[que-pasa]] that takes an issue through [[kinetic]]'s process, its plan and its cls, one cl at a time, to accepted, then to main. Its notes follow one job through the plant: where it is built, where it is done, what it carries, what moves it, one run of it, and where it leaves.

- [[point-b]]: what it is for, through [[software-factory-v2]]
- [[software-factory-v2-design]]: the design it follows

---
## The product line

[[repo]]: what the factory builds in, one repo and the environment it defines once.

- dev image: the toolchain and the package cache, which every bench starts from
- services: what runs beside the work, from `pod.yaml`. Not built ([[workspace-services]])
- check: `check.sh`, the one inspection, the same at every bench and at the dock

## The bench

[[workspace]]: where one job is done, a branch, a worktree and a running copy of the repo's environment, made for the job and removed after. The same bench for Matt and for an attempt.

- worktree: its own checkout
- container: the dev image with the worktree mounted, rootless and capped
- network: its own. An attempt's has no way out
- setup: an offline install from the image's cache, once per worktree ([[#One job]])

## The paperwork

The model: the four things that travel with a job, each with its rules in the process, its store behind an effect, and its moves in the engine.

- spec: the notes that say what must be true: the issue, the plan and its cls, in kinetic
	- shapes: held by the process. `effects/notes.ts` reads them by path
	- writes: the engine writes only the factory's own plan and cl notes, and each item's `status`. A finding is never written into a note
- product: the files a cl's builders make, its tests and its code, in git
	- judged by: the process's checks. Red at an assertion, no test changed, green
	- held by: `effects/git.ts`. The engine commits and merges it
- role: the instructions one agent works from (`agents/*.md`)
	- run by: `effects/runner.ts`, from the agent and the bin its step names
- message: the record a step ends with, saying what it concluded and who acts next (`process/step.ts`'s `Message`)
	- its parts: a word (pass, retry or back), why in one line, a failure's cause, its findings, and notes for the next step. It is from the attempt it ends
	- finding: a fault in one artifact (the issue, the plan, a cl, its tests or its code), with what fails, its evidence and where
	- pass: moves the item on
	- retry: runs its step again
	- back: goes up the V to the owner of the artifact its findings are about. Several artifacts: the highest one's owner
		- the owners: the tests are da-nail's, the code da-hammer's, a cl or the plan the planner's, the issue Matt's
		- a sender: any step. An agent hands back findings in place of its done result; a check can too (a red suite at acceptance)
		- raise: a back about a spec (a cl, the plan or the issue). A cl's raise goes to its issue, relayed by the orchestrator (`advance.ts`)
		- escalation: the item goes to Matt, on its third retry at one state, its third round back, or a move the table has no row for
	- routing: `process/table.ts`, as data
	- the record: the ledger's events, one per message, appended and never edited. An item's state is their projection, moved in the same transaction
	- an agent's input: its spec, then its messages, the one that brought the item to its state and each since (`ledger.inbox`). Its product it reads in the worktree

## The plant

The machine: what moves jobs from station to station, in four layers put together by `main.ts`. The engine runs the process and calls the effects; the process reaches the effects only through its notes and the tools each agent names.

- process: what the work is (`process/`, `agents/`). It decides, and touches only its own notes
	- the path: the states an item moves through on messages, held as data in `process/table.ts`
		- an issue: open → planned (the planner cuts it) → building (plan-review approves) → built (each cl merged into the issue's branch, in plan order) → accepted (issue-review, and the full suite green). A review or a cl's raise can send it back to the planner
		- a cl: waiting (for the cl before it) → ready → red (da-nail's tests) → green (da-hammer's code) → approved (cl-review) → merged. A review can send it back to its tests or its code
	- a step: one per state, with its agent, its result's shape and its check (`process/*.ts`, listed in `process/index.ts`)
		- the steps: plan (the plan lints), plan review, nail (red at an assertion), hammer (no test changed, then green), review (still green), accept (the full suite green)
		- a check: reads the result and the attempt's worktree through a port (`Worktree`: a test run, the changed files, the files there), and gives the message
		- a view: the files of a step's cut (`process/plan.ts`'s `viewOf`). Nail's and hammer's tools read those, write only the ones they change, and see nothing else. The planner explored, so they do not
			- a file outside the view: a raise
			- a worktree that changed any other file: a retry (`scope_exceeds_change`). Only the change files are committed
			- hammer: changes no test file, none da-nail wrote and none its test command runs
			- the test command: runs the cut's new test files and the existing ones that test the code it changes
	- an agent: its instructions in its role note beside it, and the bin it names (plan, implement, review), never a model
- engine: what moves it (`orchestrator/`)
	- the ledger: `ledger.ts`, SQLite, the orchestrator's only state: where each item stands, and every message
	- the tick: `loop.ts`. Starts attempts, up to `concurrent` at once, the open ones first; answers each check's worktree, and records its test run
	- the orchestrator's own moves: `advance.ts`. An approved plan's cls, each cl in turn, the merges
- effects: how it touches the world (`effects/`), each behind a small seam
	- `git.ts`: branches, worktrees, commits and merges
	- `sandbox.ts`: what each container is given. que-pasa's `podman()` makes it
	- `tests.ts`: a test run, in a container of its own
	- `setup.ts`: a worktree's setup, the same way
	- `runs.ts`: the run folders. `sh.ts`: the commands under them
	- `runner.ts`: the run, on que-pasa's durable runtime
	- `models.ts`: the bins, a default model and a fallback for a retry
	- `tools.ts`: the run's context, and `test`, the cl's test command, for nail and hammer
		- que-pasa's tools: every other one, after LangChain's Deep Agents, in the sandbox the runner gives each run
		- for every agent: `ls`, `read_file`, `glob`, `grep`
		- for nail and hammer: `write_file`, `edit_file`, over que-pasa's `view` of their cut
		- for the planner and the reviews: `execute`, a shell. They have no view, and only read
	- `notes.ts`: the issue and cl notes. `trace.ts`: the record of each attempt
- wiring: `main.ts`. `compose` builds the factory from the other three, under one home (`ledger.db`, `pi.db`, `runs/`). The e2e builds through it
- the command line: `cli/`, one module per command, on what `compose` builds (`just factory`)

## One job

An attempt: one step on one item, at one bench. Its run, its sandbox and its worktree are its own, and it lives until it ends.

- begin: the ledger opens it, with its trace's ids
- setup: the issue's `--setup` installs the repo's dependencies into the new worktree from the [[repo#Dev image|dev image]]'s cache, with no network, in a container of its own, inside the attempt's task, so a tick never waits on it
	- once per worktree: `setup.done` in the attempt's folder, forgotten when the worktree is made again
	- what it installs: ignored by git
	- a failure: a retry with `missing_dependency`, before any agent. It names an image older than the lockfile (npm's ENOTCACHED), or the files it left unignored
- sandbox: a container with no network, the worktree mounted (read-only for a review), up on its tools' first call. The agent's loop runs in the orchestrator and holds the key (LangChain's "sandbox as tool")
- run: que-pasa's, with the attempt's id, under the attempt's span, on the bin's model
- check: the step's, on the worktree. Its test run in a container of its own
- commit: a pass of a step that edits, as `<agent>(<item>)`, which moves the item's branch. No note is written
- end: the attempt span is written, then the ledger moves the item, in one transaction with one event, its message
- across a stop
	- a stopped orchestrator: ends nothing. Each attempt stays open, and its container stays up
	- the next one: takes each open attempt up. Its sandbox again (kept, started again, or run again on the same worktree), and its run goes on from where it stopped, with no model call redone
	- a cut-off tool call: runs again only if twice is the same as once (`ls`, `read_file`, `write_file`, `glob`, `grep`). For `edit_file`, `execute` and `test`, the model gets `interrupted`
	- the time limit: per process

## The dock

[[ci]]: final inspection into the warehouse, main.

- the gate: the check passes on the exact commit, then main moves by fast-forward
- landing: Matt lands an accepted issue's branch. Not built in the factory ([[landing-flow]])
- after the dock: [[cd]] ships main onto a node, outside the plant

## Seams

Where it meets other systems, and what crosses each.

- [[que-pasa]]: the harness. assembly gives it agents, tools, a model and a context per run; it gives back the result and the usage, keeps the run across a stop, and traces it. `@mku1tra/que-pasa` on npm, by version range
- [[kinetic]]: the work. The spec is kinetic's, assembly is its controller, and the ledger is the status, keyed by the note's name. Kinetic lints the notes where they live; assembly reads them by path, and writes back only its projections
- evals: the traces and the ledger, read later. Scores and labels are their own records, keyed by trace or span id
- the model provider: pi-ai's Fireworks provider. Its key, `FIREWORKS_API_KEY`, comes from the vault (`secrets.toml`, through rbw-run) into the orchestrator only, never a sandbox. `just smoke-model` makes one real call per model
- the host: git and podman
	- branches: each item's passed work on `assembly/<name>/head`, each attempt on `assembly/<name>/<n>`, made from the item's branch, else its issue's, else main
	- the orchestrator: its own image (`orchestrator/Containerfile`: node, git, the podman client), starting containers through the host's podman socket, with host paths at the same path

## Records

What it keeps.

- the ledger (`ledger.db`)
	- items
	- attempts: state, word, reason, cause, duration, tokens in, out and cached, cost, the result, trace ids, times taken up
	- events: one per message, with its word, reason, cause, findings and notes, and the move it made
	- each cl's planned and actual paths
	- check runs: command, image, tree, input hash, exit code, duration
- pi's store (`pi.db`): que-pasa's runs, so a run goes on after a stop
- a run folder: per attempt, by issue (`runs/<issue>/issue/<n>/`, `runs/<issue>/cl/<cut>/<n>/`), with its worktree, its log and its trace
- the trace (`trace.jsonl`): each attempt as one OpenTelemetry trace, OTLP JSON, semconv 1.43.0
	- the attempt span: the root, holding what only assembly knows (issue, cl, attempt, step, word, cause, cost, the end commit, the sandbox's image and id), and links to the attempts a review judged. Made at begin, written at end, so a stop cannot lose it
	- que-pasa's spans: under it, live, in the GenAI conventions. An invoke_agent span per process on the run, a chat span per model call, an execute_tool span per tool call, with the messages
	- a check span: under it, the check's test run

## Built

- the machine: an issue from open to accepted, proven end to end on scripted models, with an attempt taken up after a stop (`just e2e`)
- the command line: `just factory`, its home `$XDG_STATE_HOME/assembly`
	- `add`: a note, by its kinetic type. An issue enters at open, for the planner. A plan made outside the factory, or an issue's lone cl, enters with its cls ready, checked as the factory's own plan is; a raise or a send-back on it goes to Matt, never to the planner
	- `run`: the loop, until a signal stops it. Its attempts stay open
	- `status`, `blocked` (the raised and escalated items, with why) and `explain` (an item's messages, attempts, costs and traces)
- the dependencies in an attempt: an offline install from the dev image's cache, once per worktree, proven on a que-pasa worktree (setup in 11 s, then its tests pass, no network)
- the gate: `just check`, linting every note against its type, then types, eslint, prettier and the unit tests (podman and git faked). `just e2e` is not in it, since it needs the podman socket

## Not built

- the cl's shape in nail: every new test must be red at an assertion, so a structure cl, whose tests pass now, cannot pass. Its tools fence by the cut's file list, not a sparse checkout of its scope
- the planner's role as written: its result is still the old cut (files, grounds copied in, Check items by number), and its envelope does not inline the [[plan]] and [[cl]] type notes
- the cl as kinetic defines it: assembly reads a cl's files and test command from the planner's cut or the cl's Files. kinetic's cl holds `scope`, `shape` and `test` in its frontmatter, for a sparse checkout
- a run on a real model: the path is proven (`just smoke-model`), and nothing starts one on a real issue yet
- the command line's `retry`, `replan` and `ask`
- a thinking level per bin: each model runs at its provider's default
- the dev image's tag per lockfile: `--image` names one tag for every attempt, so a newer lockfile fails setup. The exact tag (`dev-image.sh local`) needs skopeo or a build in the orchestrator's image
- parallel cls, or a plan across repos: one cl at a time, in one repo
- landing: Matt lands an accepted issue's branch ([[#The dock]])
- check reuse: runs are recorded with their input hash, and never skipped on it
