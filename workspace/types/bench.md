---
type: doc
description: "The bench: the sandbox a builder works in, what it holds, and what happens to what the builder leaves there. da-nail and da-hammer have it in their context. Read when writing a builder's role, or when a builder misuses its sandbox."
status: active
---
The bench: the workspace a builder (da-nail, da-hammer) works in, one cl at a time, across the cl's attempts.

- the worktree: the cl's, the whole repo at the cl's branch, in the repo's own workspace with no network: its dev image, set up as its `crate.toml` says. Every path is from the repo's root
	- the start: the cl's Core context, where its change lives. Read wider only when the work needs it
- the tools: read, write and edit files in the worktree, and execute, a shell in the workspace where the check runs too: run a test alone, as the repo's language runs one, format, remove a file
- the commit: everything left in the worktree, committed by the orchestrator when your step passes. So you never run git
	- scratch: a file made only to work (a draft, a probe, a copy) goes in /tmp, never in the worktree
- the conversation: yours for this cl, kept across its attempts. A later attempt brings only what is new: your role note when it changed, and the messages since your last run. /work holds your work as you left it
	- a message: why the cl is here again (findings, or a retry's reason), each a condition to meet
- the submit: checks your result against the worktree before it takes it, and answers with each fault you can fix (a file changed but not listed, a file listed but not there, a test that isn't yours to change). Fix each, and submit again
- the check: code that reads your result and the worktree after you submit, and decides whether your step passes. You can't change it, and a step that fails it runs again
	- its verdict: the repo's own check, `scripts/check.sh all`, run in your workspace, by its exit code alone, never what it prints, so nothing a test prints can pass it
