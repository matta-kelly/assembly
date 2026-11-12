---
type: moc
description: "Root of assembly, the software factory: a deployment of que-pasa that moves an issue through its plan and its cls to accepted. Read for how the factory works as a system, where it meets other systems, what it records, and what is built."
status: active
---
assembly: the software factory, a deployment of [[que-pasa]] that takes an issue through [[kinetic]]'s process, its plan and its cls, phase by phase, each cl onto main, to accepted. Its notes follow one job through the plant: where it is built, where it is done, what it carries, what moves it, one run of it, and where it leaves.

- [[point-b]]: what it is for, through [[software-factory-v2]]
- [[software-factory-v2-design]]: the design it follows
- the types: what a role works to and is judged against, each a note in `workspace/types/`
	- [[tests]]: what a test is, its kinds, and what a good one is
	- [[code]]: how code is written here
	- [[changelist]]: one self-contained change to main, and what a good one is
	- [[playbook]]: a proven way to do one kind of change
	- [[lint]]: the check on code that does not run it
	- [[issue-note]], [[plan-note]]: what an issue note and a plan note hold

---
## The product line

[[repo]]: what the factory builds in, a repo and the environment it defines once. An issue may change several, a cl one.

- dev image: the toolchain and the package cache, which every bench starts from
- services: what runs beside the work, from `pod.yaml`. Not built ([[workspace-on-crate]])
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
	- shapes: held by the process. `effects/notes.ts` reads them by path, or from a git commit
	- writes: the engine writes only the notes of a spec the factory's planner made, in kinetic's format. No note's `status` is written: the ledger is the status. A finding is never written into a note
	- Matt's spec: his own notes, which the engine reads at one kinetic commit and never writes
	- the kept spec: the ledger keeps each issue's spec with who made it, the planner's passed result or the one Matt submitted, and the commit a submitted one was read at (`specs`)
- product: the files a cl's builders make, its tests and its code, in git
	- judged by: the process's checks. Red at an assertion, no test changed, green
	- held by: `effects/git.ts`. The engine commits it, and lands it on main ([[#The dock]])
- role: the instructions one agent works from (`workspace/agents/*.md`)
	- run by: `effects/runner.ts`, from the agent and the bin its step names
- message: the record a step ends with, saying what it concluded and who acts next (`process/step.ts`'s `Message`)
	- its parts: a word, why in one line, a failure's cause, its findings, and notes for the next step
	- its words: pass, retry or back from a step; pass, drop, escalate or replan from the orchestrator or Matt
	- its sender: on its event. An attempt as it ends, the orchestrator, or Matt
	- finding: a fault in one artifact (the issue, the plan, a cl, its tests or its code), with what fails, its evidence and where
	- pass: moves the item on
	- retry: runs its step again
	- back: goes up the V to the owner of the artifact its findings are about. Several artifacts: the highest one's owner
		- the owners: the tests are da-nail's, the code da-hammer's, a cl or the plan the planner's, the issue Matt's
		- a sender: any step. An agent hands back findings in place of its done result; a check can too (a red suite at acceptance)
		- raise: a back about a spec (a cl, the plan or the issue). A cl's raise goes to its issue, relayed by the orchestrator (`advance.ts`)
		- escalation: the item goes to Matt, on its third retry at one state, its third round back, or a move the table has no row for. None of an escalated issue's cls starts an attempt, and a raised cl blocks the phases after it, until Matt answers
	- routing: `process/table.ts`, as data
	- the one door: `ledger.apply`, which every message goes through, whoever sends it
	- the record: the ledger's events, one per message, appended and never edited. An item's state is their projection, moved in the same transaction
	- an agent's input: its spec, then its messages, the one that brought the item to its state and each since (`ledger.inbox`). Its product it reads in the worktree

## The plant

The machine: what moves jobs from station to station, in four layers put together by `main.ts`. The engine runs the process and calls the effects; the process reaches the effects only through its notes and the tools each agent names.

- process: what the work is (`process/`, `workspace/`). It decides, and touches only its own notes
	- the path: the states an item moves through on messages, held as data in `process/table.ts`
		- an issue's repos: the ones its cls may change. By default every repo on crate under `ASSEMBLY_REPOS` (lot when it is not set; a git repo with a `server` remote), and the planner picks among them; `factory add --repo` narrows them. Each repo's image, full suite and setup are read from its main (`effects/repo.ts`): its image is its `crate.toml`'s, with `dev` its dev image, which crate makes in the orchestrator from the host's install mounted read-only there, so a repo with no copy of the script is taken: `crate dev-image local` at the repo's checkout when it is at the commit, else `crate dev-image ref --rev` for a commit on main, whose image may be in the registry, else `crate dev-image local` at a temporary checkout at the commit; its full suite `scripts/check.sh all`; its setup `npm ci --offline` when it has a lockfile
			- a cl: names its repo, one of the issue's, when the issue has several, and runs, sets up and lands in it. A change across repos is a cl per repo
			- the issue's own steps: each repo at `/work/<repo>`, in a plain Node image, since they only read; acceptance runs each repo's full suite
		- an issue: open → planned (the planner cuts it) → building (plan-review approves, or Matt does) → built (each cl landed on main, phase by phase) → accepted (the full suite green on main, and issue-review). Acceptance closes the issue and never gates the code, which is on main already. A review or a cl's raise can send it back to the planner. An issue Matt submits passes open and planned by his passes
		- a cl: waiting (for the phases before its own) → ready → red (da-nail's tests) → green (da-hammer's code) → approved (cl-review) → landed (on main). A review can send it back to its tests or its code, and so can the land
	- a step: one per state, with its agent, its result's shape and its check (`process/*.ts`, listed in `process/index.ts`)
		- the steps: plan (the issue has Done items, and the spec lints: kinetic's rules, and the repo's), plan review, nail (red at an assertion), hammer (no test changed, then green), review (still green), accept (the full suite green)
		- a check: reads the result and the attempt's worktree through a port (`Worktree`: a test run, the changed files, the files there), and gives the message
		- a bound step: nail's and hammer's. The attempt's worktree is a sparse checkout of the cl's checkout (`effects/git.ts`), so only its paths are on disk, and to them nothing else exists. The planner explored, so they do not
			- a file outside the checkout: a raise
			- a path of the checkout: a file or a folder, a plain path from the repo's root
			- the commit: every change the attempt made. The checkout fences exploration, not edits
			- hammer: changes no test file, none da-nail wrote and none its test command runs
			- a test run: one op (`effects/tests.ts`'s `runTests`), for the agent's `test` tool and the step's check alike
				- the cl's full worktree: `runs/<issue>/cl/<cut>/full`, made once and set up once, where every test run happens
				- the tree: the attempt's HEAD with its change is put there first, so the tree a test sees is the tree a pass commits
	- the land: an approved cl's attempt, code with no agent (`effects/land.ts`). Its moves are in [[#The dock]]
	- an agent: its instructions in its role note beside it, and the bin it names (plan, implement, review), never a model
	- the workspace: what the agents are made of (`workspace/`), apart from the machine that runs them. Not the bench ([[workspace]])
		- `agents/`: each agent's role note, and its code beside it
		- `tools/`: `test`, the cl's test command, for nail and hammer: the factory's one tool of its own
			- que-pasa's tools: every other one, after LangChain's Deep Agents, in the sandbox the runner gives each run
			- for every agent: `ls`, `read_file`, `glob`, `grep`
			- for nail and hammer: `write_file`, `edit_file`, in their sparse checkout
			- for the planner and the reviews: `execute`, a shell. They are not bound, and only read
		- `types/`: the notes a role works to and is judged against
			- in its context: que-pasa's memory middleware reads an agent's types once, when a run is made, keeps them with the run, and adds them to the system prompt before each model call (`workspace/agents/types.ts`)
			- the builders: da-nail [[tests]], da-hammer [[code]]. cl-review: [[code]], [[tests]] and [[changelist]], the same text its builders have
			- the planner and plan-review: [[issue-note]], [[plan-note]], [[changelist]], which holds what a cl note is, and [[playbook]]
			- issue-review: [[issue-note]]
			- Held by: `types.test.ts`, each type an agent names is a note there. Memory leaves out a source that is not there, and says nothing
			- kinetic's type notes: [[issue]], [[plan]] and [[cl]] are the blank forms a new note starts from. Their words are here, since a type note stays with its schema, in kinetic, where no agent's memory reads
- engine: what moves it (`orchestrator/`)
	- the ledger: `ledger.ts`, SQLite, the orchestrator's only state: where each item stands, and every message
	- the tick: `loop.ts`. Starts attempts, up to `concurrent` at once, the open ones first; answers each check's worktree, and records its test run
	- the lands: `loop.ts` too. One per approved cl, as an attempt, and the lands of one repo one at a time, each after the one before it
	- the orchestrator's own moves: `advance.ts`, each through `ledger.apply`. A building issue's cls from its spec, each phase once the one before has landed (and, for a cl whose repo depends on a package a landed cl made, once that version is on npm, asked through `effects/registry.ts`: the cl stays waiting with the reason as a retry, written once per reason, a failed ask is a reason too, and a wait past the factory's `waitLimitMs` (30 minutes when not set) escalates the issue). A released cl's repo is moved onto every version it needs first, each its own commit (`effects/move.ts`, the one container with the network), and takes the dev image of the last commit, so its attempts run in an image of its new lockfile; the issue's repo entry takes the same image, so its own steps and acceptance run the new lockfile too. A move or an image that fails escalates the issue, with the command's output, and the cl waits. Then the issue built, and the relay of a raise
- effects: how it touches the world (`effects/`), each behind a small seam
	- `git.ts`: branches, worktrees and commits, and main as the land target has it
	- `land.ts`: the land, an approved cl onto main: a push that crate checks, or `git land` for a repo not on crate
	- `move.ts`: a released cl's repo onto the version it waited for, in a container with the network, committed on its branch as `build(deps): <package> to <version>`
	- `sandbox.ts`: what each container is given. que-pasa's `podman()` makes it
	- `tests.ts`: a test run, in a container of its own
	- `setup.ts`: a worktree's setup, the same way
	- `runs.ts`: the run folders. `sh.ts`: the commands under them
	- `runner.ts`: the run, on que-pasa's durable runtime, and the run's context, which its tools read
	- `models.ts`: the bins, a default model and a fallback for a retry
	- `notes.ts`: the issue and cl notes. `trace.ts`: the record of each attempt
- wiring: `main.ts`. `compose` builds the factory from the other three, and the world the loop waits on (`npmRegistry`, `gitReader`, `landedTags`; a test stands its registry in through `Factory.registry`), under one home (`ledger.db`, `pi.db`, `runs/`). The e2e builds through it
- the command line: `cli/`, one module per command, on what `compose` builds (`just factory`)

## One job

An attempt: one step on one item, at one bench. Its run, its sandbox and its worktree are its own, and it lives until it ends.

- begin: the ledger opens it, with its trace's ids
- setup: the repo's setup installs its dependencies into the new worktree from the [[repo#Dev image|dev image]]'s cache, with no network, in a container of its own, inside the attempt's task, so a tick never waits on it
	- once per worktree: `setup.done` in the attempt's folder, forgotten when the worktree is made again
	- a bound attempt: its sparse worktree holds no install. The cl's full worktree, where its tests run, is set up once in its place (`full.setup/setup.done`)
	- what it installs: ignored by git
	- a failure: a retry with `missing_dependency`, before any agent. It names an image older than the lockfile (npm's ENOTCACHED), or the files it left unignored
- sandbox: a container with no network, the worktree mounted (read-only for a review), up on its tools' first call. The agent's loop runs in the orchestrator and holds the key (LangChain's "sandbox as tool")
- run: que-pasa's, with the attempt's id, under the attempt's span, on the bin's model
- check: the step's, on the worktree. Its test run in a container of its own, on the cl's full worktree for a bound attempt
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
- the land target: the remote a cl lands on: `server`, main's bare repo guarded by crate ([[repo#Platform]]), when the repo has it; else `local`, a bare repo on this machine; else `origin`. Main is its main, fetched as each attempt starts
- the land: each approved cl onto main, as Matt, on the cl's full worktree (`effects/land.ts`)
	- rebase: the cl's branch onto main. A conflict is a back about the plan (`restack_conflict`), since keeping the cls of one phase apart is the plan's work
	- landed already: a cl whose change main holds passes as it is, so a land a stop cut off is safe to run again
	- through crate (`server`): a plain push to main. crate's hook runs the repo's check on the exact tree main becomes, so the land runs no test of its own
		- refused by the check: a back about the code (`check_failed`), with the check's output, and the cl's branch moves to the rebased tree, so da-hammer works on the code main will hold
		- main moved while the push waited: fetch, rebase and push again, three times at most, then a retry
	- through `git land`, for a repo not on crate
		- retest: the cl's test command on the rebased tree, when main moved under it. A red is a back about the code (`check_failed`), and the branch moves as above
		- push: `git land`, through the repo's gate. A land it refuses is a retry
	- landed: the cl's branch is the commit main took, its note is done, and the files it changed are kept
- the identity: Matt's
	- the author: his name, from the host's git config
	- the push: to `server`, over SSH as the server's git user; to GitHub through `git land`, his GH_TOKEN from the vault through rbw-run, set as gh's credential for the push alone
- after the dock: [[cd]] ships main onto a node, outside the plant

## Seams

Where it meets other systems, and what crosses each.

- [[que-pasa]]: the harness. assembly gives it agents, each with its tools and its middleware, a model and a context per run; it gives back the result and the usage, keeps the run across a stop, and traces it. `@mku1tra/que-pasa` on npm, by version range
- [[kinetic]]: the work. The spec is kinetic's, assembly is its controller, and the ledger is the status, keyed by the note's name. Kinetic lints the notes where they live; assembly reads them from a commit, and writes only the notes of a spec its planner made
- evals: the traces and the ledger, read later. Scores and labels are their own records, keyed by trace or span id
- the model provider: pi-ai's Fireworks provider. Its key, `FIREWORKS_API_KEY`, comes from the vault (`secrets.toml`, through rbw-run) into the orchestrator only, never a sandbox. `just smoke-model` makes one real call per model
- the server: the machine the factory runs on, with its repos cloned under its home. `just factory` there runs the verb in place, over the clones under `ASSEMBLY_REPOS` and the home `ASSEMBLY_HOME`; a laptop reaches it over ssh when `ASSEMBLY_SERVER` is set (`assembly@monkeybusiness`). dazoo sets both, and checks out the release tag, the one crate makes (`v<x.y.z>`)
- the host: git and podman
	- branches: each cl's passed work on `assembly/<name>/head`, each attempt on `assembly/<name>/<n>`, made from a cl's own branch, else from main
	- the orchestrator: its own image (`orchestrator/Containerfile`: node, git, gh, skopeo, the podman client, and the host's git-land and crate mounted read-only), starting containers through the host's podman socket, with host paths at the same path

## Records

What it keeps.

- the ledger (`ledger.db`)
	- items: with a cl's phase
	- attempts: state, word, reason, cause, duration, tokens in, out and cached, cost, the result, trace ids, times taken up
	- events: one per message, with who sent it, its word, reason, cause, findings and notes, and the move it made
	- specs: an issue's spec, and who made it
	- paths: the files each cl changed, once landed
	- check runs: command, image, tree, input hash, exit code, duration
- pi's store (`pi.db`): que-pasa's runs, so a run goes on after a stop
- a run folder: per attempt, by issue (`runs/<issue>/issue/<n>/`, `runs/<issue>/cl/<cut>/<n>/`), with its worktree, its log and its trace
- the trace (`trace.jsonl`): each attempt as one OpenTelemetry trace, OTLP JSON, semconv 1.43.0
	- the attempt span: the root, holding what only assembly knows (issue, cl, attempt, step, word, cause, cost, the end commit, the sandbox's image and id), and links to the attempts a review judged. Made at begin, written at end, so a stop cannot lose it
	- que-pasa's spans: under it, live, in the GenAI conventions. An invoke_agent span per process on the run, a chat span per model call, an execute_tool span per tool call, with the messages
	- a check span: under it, the check's test run

## Built

- the machine: an issue from open to accepted, proven end to end on scripted models, with an attempt taken up after a stop (`just e2e`)
- the command line: `scripts/factory.sh`, which `just factory` calls and the gate tests without `just`: its home `$ASSEMBLY_HOME`, else `$XDG_STATE_HOME/assembly`, and its repos from `$ASSEMBLY_REPOS`, else lot
	- on the laptop: `ASSEMBLY_SERVER` set runs the verb on the server over ssh, with its exit code and output. A note path is refused there: the server reads its notes from git, and `submit` takes an issue's name
	- each command: a message through the one door, as Matt
	- `add`: an issue, which enters at open, for the planner
	- `submit <issue> [--at <ref>]`: an issue with the spec Matt made, its cls and its plan beside it in kinetic's format, as kinetic's repo holds them at one commit (its `server/main` when none is given)
		- where it enters: building, by his passes at open and plan review. Only the build and acceptance run it, and they write no note
		- its notes: read with git at the commit, never from the working tree, whole, each cl's fields from its frontmatter and the plan's Phases naming exactly its cls in their phases, and checked by spec lint, as the planner's spec is
		- a raise or a send-back on it: goes to Matt, escalated, never to the planner
	- `approve`: an issue at planned, his pass in place of plan-review's
	- `replan`: an issue he holds, raised or escalated, back to open, its cls not landed dropped
	- `run`: the loop, until a signal stops it. Its attempts stay open
	- `status`, `blocked` (the raised and escalated items, with why) and `explain` (an item's messages, attempts, costs and traces)
- the dependencies in an attempt: an offline install from the dev image's cache, once per worktree, proven on a que-pasa worktree (setup in 11 s, then its tests pass, no network)
- the gate: `just check`, linting every note against its type, then types, eslint, prettier and the unit tests, then `scripts/factory.test.sh` (podman, ssh and rbw-run faked; git is real), so a fault in the recipe fails the check. `just e2e` is not in it, since it needs the podman socket

## Not built

- the cl's shape in nail: every new test must be red at an assertion, so a structure cl, whose tests pass now, cannot pass
- a run on a real model: the path is proven (`just smoke-model`), and nothing starts one on a real issue yet
- the command line's `retry` and `ask`
- a thinking level per bin: each model runs at its provider's default
- a tested push, for a repo not on crate: when main moves between the land's retest and `git land`'s push, `git land` rebases again with no test. A repo on crate has none: crate checks the tree main becomes
- a land of landl-db or lotus-dash: `git land` runs lot's lint for them, and the orchestrator's image has no `just`, so their lands retry and escalate
- check reuse: runs are recorded with their input hash, and never skipped on it
