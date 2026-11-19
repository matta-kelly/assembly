---
type: doc
description: "The bench: the sandbox a builder works in, what it holds, and what happens to what the builder leaves there. da-nail and da-hammer have it in their context. Read when writing a builder's role, or when a builder misuses its sandbox."
status: active
---
The bench: the sandbox a builder (da-nail, da-hammer) works in, one cl at a time, across the cl's attempts.

- /work: the cl's worktree, the whole repo at the cl's branch, in a container with no network
	- the start: the cl's Core context, where its change lives. Read wider only when the work needs it
- the tools: read, write and edit files in /work, and test, which runs the cl's test command on /work with your changes
- the commit: everything left in /work, committed by the orchestrator when your step passes. So you never run git
	- scratch: a file made only to work (a draft, a probe, a copy) goes in /tmp, never in /work
- the conversation: yours for this cl, kept across its attempts. A later attempt brings only what is new: your role note when it changed, and the messages since your last run. /work holds your work as you left it
	- a message: why the cl is here again (findings, or a retry's reason), each a condition to meet
- the check: code that reads your result and /work after you submit, and decides whether your step passes. You can't change it, and a step that fails it runs again
