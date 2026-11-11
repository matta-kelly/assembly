---
type: doc
description: "How code is written here: design, layout, naming, writing and running. Use when writing or reviewing code."
status: active
---
How code is written.
- [[#Why]] why good code matters more with agents
- [[#Design]] what a piece of code is
- [[#Layout]] where it lives
- [[#Naming]] what a thing is called
- [[#Writing]] how it reads
- [[#Running]] how it behaves

- [[kinetic#The build]]: the map, the bar for what a cl writes
- [[lint]]: holds every rule here a machine can state

---
## Why

- code is what agents copy: every pattern in the tree acts as an instruction
- so good is consistent before it is clever
- a janitor run on a schedule, off trunk, fixes names and modules that drifted, so agents copy good patterns ([[backpressure]]). Not built

## Design

*what a piece of code is*

- simple design: Kent Beck's four rules, in order of priority
	- passes the tests
	- shows its intent
	- no duplication: of knowledge, not of text; wait for the third case before abstracting
	- fewest parts: nothing the change did not ask for
- modules: deep, not wide (Ousterhout, *A Philosophy of Software Design*)
	- a small interface with a lot behind it
	- a caller need not know how it works
- one way per thing
	- each problem has one pattern in the repo
	- a migration is finished or not started. A half migration is two patterns

## Layout

*where it lives*

- a feature in one folder
	- a route or a component owns its helpers, its state and its tests, beside it
	- no `lib` folder and no `utils` folder. A helper is beside the one thing that uses it
	- a helper with a second user is written again beside that user. The third user is the time to share it
	- so one listing of a folder shows an agent all of a feature, and a diff shows its reach
	- held by a lint rule in each repo
- shared primitives: what many features share (a button, a style token, the client of an API) is in a folder named for what it is

## Naming

*what a thing is called* (Ousterhout, *A Philosophy of Software Design*, ch. 14)

- a name says what the thing is for
- precise: the name rules out what the thing is not
- consistent: one name means one thing everywhere, and one thing has one name
- findable: files and folders are named for `ls` and `grep`. No generic names (`default`, `index`, `helpers`, `misc`)

## Writing

*how it reads*

- style: the language's own guide (PEP 8, Effective Go, Google's style guides)
	- applied by the formatter and the linter, never argued in review
- comments: say why, never what (PEP 8; Martin, *Clean Code*; Ousterhout)
	- none say what the code is not, or what it used to be
	- no commented-out code
- dead code is deleted, not left: it gets copied
	- what changed, and what it replaced, goes in the commit message

## Running

*how it behaves*

- config comes from the environment ([Twelve-Factor](https://12factor.net))
	- checked when the app starts. The app does not start without it
- waiting: anything that waits has a time limit (Nygard, *Release It!*) ^waiting
	- passing the limit is a failure
	- the failure says what it was waiting for
	- holds for a step in a test, a job in the pipeline, and a command an agent runs
- failure: a client of an outside thing reports failure one way. The caller maps each failure to one answer
