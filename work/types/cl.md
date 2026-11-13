---
type: type
---
The cut's intent, in one line: one sentence of done, said as what is true after its CL lands.

---
## Promises

The cl's promises ([[terms#promise]]): what is true once it lands, each an outcome at the cut's boundary that can fail. Few, each at the altitude of its source. The cases are its tester's, and the build inside the boundary is its builders'.

- a promise: one outcome, said as what holds and for whom. Never how it is built, never an input or a test to write: a line that reads as a test case is a case written too soon ([[terms#case]])
- its source: what it serves, which sets the kind of its test ([[terms#promise]], its altitude)
	- an issue's promise it completes: its test, written red first by this cl, at the system altitude ([[spine#Policy]], the promise rule)
	- a seam it creates: the promise that the seam holds, at its surface
	- its own intent: a unit promise, where its logic is decided
- by shape ([[terms#shape]]): behavior, each promise false before and true after; structure, each promise true before and after, by the test files that pin it
- an outside thing: a cut that asks one, or waits on one, promises what holds when it fails, how long a wait may last, and where the reason is kept. These are outcomes the design decides, so they are promises; how the failure is caught is a case

## Seam

What it keeps: the decision the cut hides from the other cls, what it must not change, and what crosses to them: the names, types and shapes the other side reads.

## Checkout

The cl's context on disk: its `checkout` is the paths its builders get, as a git sparse checkout, so they start from what the planner already found and spend no turns finding it. It fences exploration, not edits.

- the paths: every file or folder conceivably relevant to the cut. Err wide: an extra path costs tokens, a missing one costs a raise
- each path: one line, what it is and why it is here: "`orchestrator/ledger.ts`: the ledger, where an attempt's record is kept"
- the exemplar: one file in the checkout its builders should write like, since a model of good code in the repo carries further than any rule
- a fact from outside the code: a probe's output or a doc, written here with its source
- a gap: a raise, not a search. A builder that needs a path the checkout does not hold raises it and stops, and the planner widens the checkout
