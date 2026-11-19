---
type: type
---
The cut's intent, in one line: one sentence of done, said as what is true after its CL lands.

---
## Promises

The cl's promises ([[terms#promise]]): what is true once it lands, each an outcome at the cut's boundary that can fail. Few, each at the altitude of its source. The cases are its tester's, and the build inside the boundary is its builders'.

- the measure: enough and no more, so the intent is met and the builders keep their judgement. Over-specified, a cl caps the code at what its writer foresaw; under-specified, the builders guess
	- enough: kept together, the promises and the direction meet the cut's intent. Nothing across its seam is left for two builders to invent
	- no more: no promise says how or lists a case, and the direction steers, never dictates. The rest is its builders', the reshape of the code the change touches included, so the change reads as if it was always there
- a promise: one outcome, said as what holds and for whom. Never how it is built, never an input or a test to write: a line that reads as a test case is a case written too soon ([[terms#case]]). A line no wrong program would break is no promise: it is a direction, or the bar every change meets
- its source: what it serves, which sets the kind of its test ([[terms#promise]], its altitude)
	- an issue's promise it completes: its test, written red first by this cl, at the system altitude ([[assembly#Policy]], the promise rule)
	- a seam it creates: the promise that the seam holds, at its surface
	- its own intent: a unit promise, where its logic is decided
- by shape ([[terms#shape]]): behavior, each promise false before and true after; structure, each promise true before and after, by the test files that pin it
- an outside thing: a cut that asks one, or waits on one, promises what holds when it fails, how long a wait may last, and where the reason is kept. These are outcomes the design decides, so they are promises; how the failure is caught is a case

## Direction

The shape this change should take, where the bar ([[code]], [[tests]]) alone doesn't say it. Judged by cl-review, never tested. Empty when the bar says enough.

- a direction: one choice of shape, said as what the change is like ("one app model with two scopes"), never as the steps to get there
- never the bar again: what holds of every change (integrated, no dead code, one way per thing) is judged on every cl, written or not

## Seam

What it keeps: the decision the cut hides from the other cls, what it must not change, and what crosses to them: the names, types and shapes the other side reads.

## Core context

Where its builders start: the paths its writer found, so they spend no turns finding them again. A starting point, not a wall: they read wider when the work needs it.

- the paths: every file or folder conceivably relevant to the cut, from the repo's root. Err wide: an extra path costs tokens, a missing one costs turns
- each path: one line, what it is and why it is here: "`factory/line/ledger.ts`: the ledger, where an attempt's record is kept"
- the exemplar: one file of these its builders should write like, since a model of good code in the repo carries further than any rule
- a fact from outside the code: a probe's output or a doc, written here with its source
- a gap: a path the work needs and the core context lacks. Its builders read it where it is, and say so in their notes
