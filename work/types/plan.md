---
type: type
---
The approach, in one or two sentences: how the cls, in order, meet the issue's Done. A known way to cut a kind of change gives a ready order ([[playbook#Cutting a change]]); when none fits, build one, and say so.

---
## Phases

The refinement of the issue: the cls replace its Done with smaller specs, and the phases show how they combine, so that meeting all of them meets the issue (stepwise refinement: Wirth, 1971; Lamport, *A Science of Concurrent Programs*, ch. 6). Dependent CLs are split and ordered "at a high level before diving into coding" ([Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)), because "a bad line of a plan could lead to hundreds of bad lines of code" ([HumanLayer](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md)).
- a phase: a group of cls that need nothing from each other, so they can be built side by side: no two change the same code, and none requires another's ensures. Two cls that must change the same code go in different phases, and each phase's reason says why its cls stay apart. Order is only between phases: a phase starts once every cl of the phases before it has landed (a partial order: Lamport, 1978). Inside a phase, cls are parallel, or a set (the same change in many places: SWE at Google, ch. 22). Each cl holds its `phase`, and this list names the same cls in the same phases
- a hard line: where a cut must fall, whatever the design. A cl lands in one repo, through one review, and ships alone, so a part in another repo, for another reviewer or deployed apart is its own cut. Work that is not code (access, accounts, shares) is no cut: it is a step done by hand, checked by a read
- a cut: the cls meet at seams, each an interface between cuts: what one side promises the other, and what neither touches. Cut along decisions hidden behind an interface, not along the steps of a flow ([Parnas, 1972](https://dl.acm.org/doi/10.1145/361598.361623))
- a cl ([[cl]]): a contract: what it ensures, requires and must keep. It has its own intent and a check that can fail, fits one review, and leaves main working once it lands ([[changelist#Good CL]]). If you can't write a cut's check, the cut is wrong
- the proof: every Done item is met by a cl, and every cl meets one. A cl that meets nothing is scope the issue did not ask for. A seam's promise is in the Check of the cl that creates the seam, and each Done item's test in the Check of the cl that completes it ([[kinetic#Policy]], the promise rule)
- every claim stands on shown ground: the code or a probe's output, never a summary of them
- the list: a line for each phase, what it builds and why it comes where it does, and under it a line for each of its cls, what it hides and what crosses to the others

- Phase 1: what it builds, and why it comes first
	- [[<issue>-<cut>]]: what it hides, and what crosses to the others
- Phase 2: what it builds, and what it needs from phase 1
	- [[<issue>-<cut>]]: what it hides, and what crosses to the others

## Does not fit

What could not be made to fit, said plainly: a seam it could not prove, a cut it could not check, a Done item no cl meets. Removed when everything fits. plan-review judges the plan against the issue's Intent and Done before any cl starts, and reads this first, because it is where forcing shows up. The plan is done when its issue is met, not when its last cl lands.
