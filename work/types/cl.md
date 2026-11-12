---
type: type
---
The cut's intent, in one line: one sentence of done, said as what is true after its CL lands.

---
## Check

What it ensures: its promises, each one a future test ([[changelist#Behavior]]). Each promise can fail: a promise nothing could break is no check.

- behavior: given, when, then. It fails before the change and passes after
- structure: what stays green before and after, by its test files. When the tests themselves are what changes, the code stays as it is, and the mutation score holds
- a seam it creates: a promise that the seam holds, at its surface
- a Done item it completes: that item's test, which this cl writes red first ([[kinetic#Policy]], the promise rule)
- the whole behavior: a cut that asks an outside thing, waits, or says why it did a thing has a promise for each ([[code#Running]]). A promise left out is built by nobody, so the review finds it after the code
	- the failed ask: what happens when the outside thing fails, or does not answer
	- the limit: how long a wait may last, and what passing it does
	- the record: where a reason or a result is kept, and who reads it there

## Seam

What it keeps: the decision the cut hides from the other cls, what it must not change, and what crosses to them: the names, types and shapes the other side reads.

## Checkout

The cl's context on disk: its `checkout` is the paths its builders get, as a git sparse checkout, so they start from what the planner already found and spend no turns finding it. It fences exploration, not edits.

- the paths: every file or folder conceivably relevant to the cut. Err wide: an extra path costs tokens, a missing one costs a raise
- each path: one line, what it is and why it is here: "`orchestrator/ledger.ts`: the ledger, where an attempt's record is kept"
- the exemplar: one file in the checkout its builders should write like, since a model of good code in the repo carries further than any rule
- a fact from outside the code: a probe's output or a doc, written here with its source
- a gap: a raise, not a search. A builder that needs a path the checkout does not hold raises it and stops, and the planner widens the checkout
