---
type: doc
description: "The terms of the work: intent, promise, seam, case and test, each with one meaning in every note and role. Every agent has it in its context. Use when writing or reading any spec, role or check, or when a word seems to mean two things."
status: active
---
The terms of the work: each names one thing of the V, in one sense, in every note, role and check. A promise goes down the V and is kept on the way up; a case never goes down.
- [[#intent]] the need
- [[#promise]] what a unit guarantees
- [[#seam]] where two cuts meet
- [[#case]] one way a promise is kept or broken
- [[#test]] the check on a case
- [[#shape]] the kind of change a cl is
- [[#retired words]] the words these replace

- [[issue]], [[plan]], [[cl]]: the states that hold these terms
- [[spine#The V]]: the levels they move through

---
## intent

intent: the need a piece of work serves, as the problem and the rough form of its answer. A person validates against it, and where a promise disagrees with it, the intent wins. An issue holds it, and a cl's first line is the intent of its cut.

## promise

promise: a guarantee a unit makes to the level above, said as an outcome at the unit's boundary, never as how it is built or what to test ("any guarantee that a system makes about how it will respond to a series of inputs while in a particular state": [SWE at Google, ch. 12](https://abseil.io/resources/swe-book/html/ch12.html)). It can fail, so it has a test.
- its home: an issue's Done, a cl's Promises
- one rule, one promise: never a promise for each kind of input, since the kinds are its cases
- its source: what it serves, one level up. An issue's promise serves its intent; a cl's promise serves an issue's promise, a seam, or the cl's own intent
- its altitude: the level of its source, which sets the kind of its test ([[tests#Kinds]]). A promise is tested at the altitude of its source, not of the cl that carries it
	- system: a promise of the issue. Tested end to end, or read from the running system
	- seam: the promise that a seam holds. Tested at the interface: integration or contract
	- unit: a promise a cl makes for its own intent. Tested where its logic is decided
- the trace: every test serves a case, every case a promise, every promise its source, up to the intent. A thing with no trace is scope nobody asked for, so it goes
- Held by: plan-review on the way down; cl-review and issue-review on the way up

## seam

seam: an interface between two cuts: what crosses it (its names, types and shapes) and what one side promises the other. The planner names it, and the cl that creates it promises that it holds.

## case

case: one way a promise could be kept or broken: a class of input, a boundary, a failure of an outside thing. Found from the promise, never from the code, by whoever tests or checks it: da-nail, and cl-review on its own. Never written on the way down: a spec that lists cases leaves its tester only a list to fill.

## test

test: a check that fails when the code gets its case wrong ([[tests#A good test]]). One test holds as many cases as it can, each at its own assertion or row.

## shape

shape: the kind of change a cl is, its `shape.change` (Beck, *Tidy First?*). An adjective of the change, never a thing beside a promise.
- behavior: a change that makes a promise true that was false
- structure: a change that keeps every promise as it is

## retired words

retired words: the words used before these, each read as a promise: Done item, claim, a cl's ensures, and behavior as a thing. A role's own contract keeps requires and ensures (Meyer).
