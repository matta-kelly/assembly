---
type: doc
description: "An issue note: one need and the state of done that meets it: its first line, its Intent, its Done and its Non-goals. Use when writing an issue, cutting one into cls, or judging whether one is met."
status: active
---
An issue note: one piece of work, as the need it serves and the state that meets it. The main signal: every plan, CL and review is judged against it. Its type is [[issue]], whose note is the blank form a new one starts from.
- [[#First line]] what it gets done
- [[#Intent]] the work, shaped: what validation is judged against
- [[#Done]] the state that meets the intent: what verification is judged against
- [[#Non-goals]] what it will not do

- [[plan-note]]: how it is cut into cls, when it takes more than one
- [[changelist]]: one of those cls

---
## First line

What this issue gets done, in one line: one sentence of done, said as what is true after.

## Intent

The work, shaped: the problem it answers and the rough form of the answer, solved enough to see whole and bounded enough to know where it stops (shaping: Singer, *Shape Up*, 2019). The main elements and how they connect, never the details, which are the plan's.

What validation (was it the right thing) is judged against. Every plan, CL and result is validated against it, and where one disagrees, the intent wins. It is never criteria: no list of done captures a need in full, and the gap is why the intent wins, and why a person validates.

## Done

The state that meets the intent: what verification (was it built right) is judged against. The top of the V for one piece of work: a [[plan-note]] refines it into cls, every CL points to it by name ("Updates <name>" for a step, "Fixes <name>" on the last), and acceptance checks it on the way up ([Google Issue Tracker](https://developers.google.com/issue-tracker/concepts/issues)).

- a state, not an activity: "X is true", never "do X"
- it can fail: a claim nothing could falsify is no check
- it says where it is checked, set by where the claim lives and how long it must hold
	- in the code, from then on: the acceptance test, on main. CI keeps it from then on
		- one CL: that CL's tests, in its cl note
		- more than one CL: each item's test, carried by the cl that completes it ([[kinetic#Policy]], the promise rule). The [[plan-note]] names that cl
	- in the running system, once: proven where it runs, read from the running system after deploy (a request, a query, a log line). Main proves the code, not the fleet. Skipped only for code that runs nowhere
	- in the running system, from then on: kept, by a monitor that keeps checking it, and where it alerts. Only when the claim can break again after met
- the test of a good list: someone who did not write it can check every item without asking

## Non-goals

What this issue will not do, said plainly. The fence for review: work past it is scope the issue did not ask for, and a shrink inside it is a raise, never quiet.
