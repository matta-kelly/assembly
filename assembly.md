---
type: moc
description: "Root of assembly, the software factory: a deployment of que-pasa that moves an issue through its plan and its cls to accepted. Read for how the factory works as a system, where it meets other systems, what it records, and what is built."
status: active
---
The software factory: a deployment of [[que-pasa]] that moves an issue through its plan and its cls, one cl at a time, to accepted. It is [[shit-sdlc]] as code.
- [[#The machine]] what moves, and the part that moves it
- [[#An attempt]] one step's life, across a stop
- [[#Seams]] where it meets other systems, and what crosses each
- [[#Records]] what it keeps
- [[#Built]] and [[#Not built]]

- [[point-b]]: what it is for, through [[software-factory-v2]]
- [[software-factory-v2-design]]: the design it follows

---
## The machine

The path: an issue and its cls move from state to state on words (pass, retry, raise, to-tests, to-code, to-plan). `orchestrator/table.ts` holds it as data
- an issue: open → planned (the planner cuts it into cls) → building (plan-review approves) → built (each cl merged into the issue's branch, in plan order) → accepted (issue-review, and the full suite green). A review can send it back to the planner, and so can a cl that raises
- a cl: waiting (for the cl before it) → ready → red (da-nail's tests) → green (da-hammer's code) → approved (cl-review) → merged. A review can send it back to its tests or its code
- an item is escalated, for Matt, on its third failed attempt at one state, on its third send-back, or when a move of the orchestrator's own fails

What moves them, each part at the point it acts:
- the state: where each item stands, and every move, with its cause: `orchestrator/ledger.ts`, SQLite, the only state the orchestrator holds
- the tick: starts attempts, up to `concurrent` at once, the open ones first: `orchestrator/loop.ts`
- a step, one per state: its agent, its result's shape, its check: `process/*.ts`
	- plan (the plan lints), plan review, nail (red at an assertion), hammer (no test changed, then green), review (still green), accept (the full suite green)
	- the agent and what it may touch: `agents/` (each one's instructions are a note beside it, of assembly's type instructions) and `tools/` (`ls`, `read_file`, `write_file`, `edit_file`, `execute`, after LangChain's Deep Agents; the reviewers only read and run)
	- the model it runs on: `orchestrator/models.ts`, the bins after loke's: an agent names its kind of work (plan, implement, review), and its bin names the model, a default and a fallback for a retry
	- its sandbox, worktree and commits: `orchestrator/start.ts`
	- its run: `orchestrator/runner.ts`, on que-pasa's durable runtime
- the orchestrator's own moves: an approved plan's cls, each cl in turn, the merges: `orchestrator/advance.ts`
- the record of each attempt: `orchestrator/trace.ts`

The chart of the path and its words is drawn with pele, from `orchestrator/table.ts` and `advance.ts`.

## An attempt

One step on one item: its run, its sandbox and its worktree are its own, and it lives until it ends.
- begin: the ledger opens it, with its trace's ids
- sandbox: a container with no network, the worktree mounted (read-only for a review). The agent's loop runs in the orchestrator and holds the key; its tools exec into the sandbox (LangChain's "sandbox as tool")
- run: que-pasa's, with the attempt's id, under the attempt's span, on the bin's model
- check: the step's, on the worktree; its test run in a container of its own
- write and commit: a pass or a send-back writes its section of the note, and a step that edits commits, which moves the item's branch
- end: the attempt span is written, then the ledger moves the item, in one transaction with one event

Across a stop:
- a stopped orchestrator ends nothing: each attempt stays open, and its container, which outlives the orchestrator, stays up
- the next one takes each open attempt up: its sandbox again (kept, started again, or run again on the same worktree), and its run goes on from where it stopped, with no model call redone
- a tool call a crash cut off runs again only if twice is the same as once (`ls`, `read_file`, `write_file`). For the others the model gets `interrupted`
- the time limit is per process

## Seams

- que-pasa, the harness: assembly gives it agents, tools, a model and a context (the attempt) per run; it gives back the result and the usage, keeps the run across a stop, and traces it. A `file:` dependency on `../que-pasa`, copied in (`install-links`); `just que-pasa` builds and copies it again
- kinetic, the work: the issue and cl notes and their types. Kinetic lints them where they live, and assembly reads and writes them by path
- evals: the traces and the ledger, read later; scores and labels are their own records, keyed by trace or span id
- the model provider: pi-ai's Fireworks provider. Its key, `FIREWORKS_API_KEY`, comes from the vault (`secrets.toml`, through rbw-run) into the orchestrator's environment only, never a sandbox. `just smoke-model` makes one real call per model the bins name
- the host: git (each item's passed work on `assembly/<name>/head`, each attempt on `assembly/<name>/<n>`, made from the item's branch, else its issue's, else main) and podman. The orchestrator runs in its own image (`orchestrator/Containerfile`: node, git, the podman client) and starts containers through the host's podman socket, with host paths at the same path

## Records

- the ledger (`ledger.db`): items; attempts (state, word, reason, cause, duration, tokens in, out and cached, cost, the result, trace ids, times taken up); events, one per move, with their cause; each cl's planned and actual paths; check runs (command, image, tree, input hash, exit code, duration)
- pi's store (`pi.db`, beside the ledger): que-pasa's runs, so a run goes on after a stop
- run folders, by issue: `runs/<issue>/issue/<n>/` and `runs/<issue>/cl/<cut>/<n>/`, each with the attempt's worktree, its log (each tool call), and its trace
- the trace (`trace.jsonl`): each attempt as one OpenTelemetry trace, OTLP JSON, semconv 1.43.0
	- the attempt span is the root: what only assembly knows (issue, cl, attempt, step, word, cause, cost, the end commit, the sandbox's image and its id), and links to the attempts a review judged. Its ids are made at begin, and it is written at end, so a stop cannot lose it
	- que-pasa's spans under it, live, in the GenAI conventions: an invoke_agent span per process that worked on the run (a resumed one is marked), a chat span per model call, an execute_tool span per tool call, with the messages
	- a check span under it: the check's test run

## Built

- the whole machine, an issue from open to accepted, proven end to end on scripted models, and an attempt taken up after a stop (`just e2e`)
- the gate: `just check` lints every note against its type, then checks the code: types, eslint, prettier, and the unit tests (podman and git faked). `just e2e` is not in it, since it needs the podman socket
- only on this machine: the pipeline cannot install que-pasa until it is published

## Not built

- a run on a real model: the model path is proven (`just smoke-model`), but nothing starts a run on a real issue yet
- a command to add an issue and run the loop
- a thinking level per bin: each model runs at its provider's default
- the repo's dependencies in the sandbox: it has no network, so a repo that needs packages needs an image that holds them ([[warm-image]])
- landing an accepted issue's branch: Matt lands it
- check reuse: check runs are recorded with their input hash, but a run is never skipped on it
- not checked: that the hammer changed only the files the cl names
