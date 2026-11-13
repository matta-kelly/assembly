---
type: type
---
The approach, in one or two sentences: how the cls, in order, keep the issue's promises. A known way to cut a kind of change gives a ready order ([[playbook#Cutting a change]]); when none fits, build one, and say so.

---
## Phases

The refinement of the issue: the cls replace its promises with smaller ones ([[terms#promise]]), and the phases show how they combine, so that meeting all of them meets the issue (stepwise refinement: Wirth, 1971; Lamport, *A Science of Concurrent Programs*, ch. 6). Dependent CLs are split and ordered "at a high level before diving into coding" ([Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)), because "a bad line of a plan could lead to hundreds of bad lines of code" ([HumanLayer](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md)).
- a phase: a group of cls that need nothing from each other, so they can be built side by side: no two change the same code, and none needs what another promises. Two cls that must change the same code go in different phases, and each phase's reason says why its cls stay apart. Order is only between phases: a phase starts once every cl of the phases before it has landed (a partial order: Lamport, 1978). Inside a phase, cls are parallel, or a set (the same change in many places: SWE at Google, ch. 22). Each cl holds its `phase`, and this list names the same cls in the same phases
- a hard line: where a cut must fall, whatever the design. A cl lands in one repo, through one review, and ships alone, so a part in another repo, for another reviewer or deployed apart is its own cut. Work that is not code (access, accounts, shares) is no cut: it is a step done by hand, checked by a read
- a cut: the cls meet at seams ([[terms#seam]]), each an interface between cuts: what one side promises the other, and what neither touches. Cut along decisions hidden behind an interface, not along the steps of a flow ([Parnas, 1972](https://dl.acm.org/doi/10.1145/361598.361623))
- a cl ([[cl]]): a contract: its promises, its phase and its seam. It has its own intent and promises that can fail, fits one review, and leaves main working once it lands ([[changelist#Good CL]]). If you can't write a cut's promises, the cut is wrong
- the boundary: the plan stops at each cut's surface. It names the seams and what each cl promises, never the cases or the build inside, which are its builders'
- the proof: every promise of the issue is kept by a cl, and every cl serves one. A cl that serves nothing is scope the issue did not ask for. A seam's promise is in the Promises of the cl that creates the seam, and each issue promise's test in the Promises of the cl that completes it ([[kinetic#Policy]], the promise rule)
- every assumption stands on shown ground: the code or a probe's output, never a summary of them
- the list: a line for each phase, what it builds and why it comes where it does, and under it a line for each of its cls, what it hides and what crosses to the others

- Phase 1: what it builds, and why it comes first
	- [[<issue>-<cut>]]: what it hides, and what crosses to the others
- Phase 2: what it builds, and what it needs from phase 1
	- [[<issue>-<cut>]]: what it hides, and what crosses to the others

## Does not fit

What could not be made to fit, said plainly: a seam it could not prove, a cut it could not check, an issue promise no cl keeps. Removed when everything fits. plan-review judges the plan against the issue's Intent and promises before any cl starts, and reads this first, because it is where forcing shows up. The plan is done when its issue is met, not when its last cl lands.
