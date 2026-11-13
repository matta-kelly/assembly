---
type: doc
description: "Tests: what a test is, the kinds, what a good test is and the runner config per language. Use when writing, judging or cutting tests."
status: active
---
A test checks one promise, on its cases: in this situation, when this happens, that is the result.
- [[#Characteristics]] what a test is
- [[#Kinds]] size, scope, and where each runs
- [[#A good test]] the bar every test meets
- [[#Cases]] which inputs a test takes
- [[#Runner config]] per language

- [[assembly#The checks]]: the map, a gate of the cl's check
- [[terms#promise|promise]] and [[terms#case|case]]: what a test checks, and on what
- [[daworks/assembly/workspace/agents/da-nail|da-nail]]: who writes a cl's tests
- [[agent-verification]]: the checks an agent cannot change; [[backpressure]]: a check as a force on the work

---
## Characteristics

- a test checks one promise ([[terms#promise]]). The acceptance test of a change checks the promise that says it is done
- it comes from the promise, never from reading the code
- one promise each: "And" in the name means two tests
- executable documentation: "if you want to know what the code does in a particular case, look at the test for that case"
- a check the agent that writes the code cannot change: da-nail commits it before the code, and da-hammer never edits it
- types before tests: a state the types make impossible to write needs no test

## Kinds

- Two axes: size is what a test touches, scope is how much code it covers ([SWE at Google, ch. 11](https://abseil.io/resources/swe-book/html/ch11.html)). A method sits on top of either.
- size
	- small: one process. No network, no disk, no sleep. Milliseconds
	- medium: one machine. It can use localhost, and a real database in a container
	- large: more than one machine, and real services. Slow, and the least reliable. Ours are the smoke checks
	- the aim is about 80% small, 15% medium, 5% large
- scope: how much code a test covers. It follows the part of the code where the promise is decided, which the promise's altitude names ([[terms#promise]]) (Cockburn, *Hexagonal Architecture*)
	- unit → logic: the part that decides, and touches nothing outside the process
		- one piece of logic, alone
		- one test per decision this repo's code makes; what the language, the platform or a library decides gets none
		- a field or a link declared in a basis type is basis's decision: the lint holds it, and it gets no test. A rule is code, and gets one
	- integration → adapter: the part that talks to one outside thing
		- one adapter, against its outside thing
		- the outside thing decides (a database, a queue): the real one, started by the test command
		- the outside thing only answers (an API that is read): its real responses, captured from the live service and replayed
	- smoke → the live outside thing: does it still answer as the recording says ^smoke
		- the other half of a replayed integration test: every recording gets one, written in the same change
		- it also covers the journeys that need real data, which end to end leaves out
		- a few real calls, from a place that can reach the service; large, so never in the check command
		- after a deploy (the ship run ends with them), and on a schedule; never in the gate
		- a failure tells the owner and blocks no push: the fault is outside the code
	- end to end → wiring: the parts put together, behind the real entry point
		- the built system, through its real entry point, the way a user would
		- one test per main journey; it shows the parts are connected, not that the rules are right
		- never depends on a live outside thing
	- contract → border: a surface another system depends on
		- the shape the border must keep: the fields, the format, the exit code
	- no kind repeats another
- method: how a test makes its inputs and its expected result, on any scope
	- property: a rule over a whole domain, on generated inputs ([[#A good test]])
	- deterministic simulation: the system runs under a seeded scheduler that puts in faults (a lost message, a crash, a slow disk). A failing seed replays the same run
	- differential (parity): for a refactor. The new code and a pinned baseline take the same inputs through the public surface, and every observable result must match
- where each runs
	- small and medium: in the check command, so before the push ([[ci]]) and in presubmit ([[ci]])
	- large: after the push
	- end to end and contract tests are medium when hermetic (one machine, no live outside thing), so they run before the push ([SWE at Google, ch. 14](https://abseil.io/resources/swe-book/html/ch14.html))

## A good test

- its expected result comes from the promise
- it goes through the public surface, and checks the result, not the steps
- it is named for the promise: "does X when Y"
- straight-line: no loops, no conditions, expected values written out
	- the exception: a property-based test, for a rule over a whole domain ("sorting never loses an element"). Only next to at least one plain example test, which says what the promise is
	- a table: one rule over many inputs is one test. Its rows are the inputs and their expected results, written out, a row for each class of input and each boundary. The loop reads the rows and decides nothing (table-driven tests: Cheney, "Prefer table driven tests")
- it stands alone: it builds what it needs, and passes run alone or in any order (a fresh fixture: Meszaros, *xUnit Test Patterns*)
	- so it runs in parallel with the rest: names, ports and folders of its own, and its settings passed to what it starts, never set on the shared process. A medium test spends its time waiting on a container, so the suite takes as long as its slowest test, not their sum (Go's `t.Parallel()`, pytest-xdist)
		- a limit (a timeout, a retry count) keeps its real value: only the test of that limit shortens it, since a short limit fails at random under the load of a parallel suite
- DAMP, not DRY: clear beats free of repetition
- seen to fail: before the code exists, or by breaking the code once on purpose
	- each case at its own assertion: a failure ends a test, so a case after it was never seen. A case is a test, or a row of a table, never a second block in one test
- the only test that fails for at least one fault put in the code
- it changes only when its promise changes; it goes only when another test fails for every fault it catches
	- a changed promise makes old tests false, and they change with it, before the code: one that expects the old result, and one whose setup builds what the new promise forbids
- a unit test that needs a fake: its subject is not logic
- if you liked it, you should have put a test on it: what has no test is not protected (Google's "Beyoncé rule")

## Cases

- the real data first, then what the source does (drops cells, empty), then what people do (spaces, case)
- each case that decides something (blank, trim, case) is named, and put in its layer: landing copies, proc normalizes
- the edges every input has, thought through for each one. Not a test each: an edge the code decides on gets a test, the rest are examples in a test that holds them, and an edge that can't happen gets nothing
	- size: empty, one, many, too big
	- shape: malformed, special bytes (NUL, newline, quotes, `$(...)`)
	- what is already there: a file, record or secret that is overwritten, kept or refused
	- the source fails: it gives nothing, or the step before it fails
	- the place: a path that is missing, unreadable or relative
- fewest tests: a case goes into a test that holds it; a new test only when none can
- factors: the things a promise varies by (which repo, which push, which name). Each is tested once, where it is decided, and two together only where they interact. Never every combination (pairwise testing: Kuhn, Kacker and Lei, NIST SP 800-142)
- no natural test (docs, config, style): the check command, or a look at the result

## Runner config

*each repo uses the standard of its own language, and nothing of ours is laid over it*

- Next.js
	- unit: Vitest
		- config: `vitest.config.mts`, at the repo root
		- command: `pnpm test`
		- files: `*.test.ts` and `*.test.tsx`, beside the code they test; never in a `__tests__/` folder
		- cannot test an `async` Server Component; those are covered end to end
	- end to end: Playwright
		- config: `playwright.config.ts`, added by `pnpm create playwright`
		- command: `npx playwright test`
		- files: `tests/*.spec.ts`
		- runs against the production build, not the dev server
	- contract: Playwright, in the same config, against the built image
- Python
	- pytest
		- command: `pytest`
		- files: `test_*.py` or `*_test.py`, holding functions named `test_*`
		- in a `tests/` folder beside `src/`, or inside the package; the docs allow both, and neither is chosen here
- integration tests run under the unit runner, in no folder of their own
- a language gets an entry when a repo in it first needs tests
- a test file that no runner finds is not a test
