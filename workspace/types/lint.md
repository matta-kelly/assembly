---
type: doc
description: "Lint: the check on code that does not run it, its anatomy, what it holds and how it grows. Use when adding a rule or setting up lint in a repo."
status: active
---
Lint: a check on code that does not run it. The cheapest check there is.

- [[spine#The checks]]: the map, a gate of the cl's check
- [[code]]: the rules lint holds
- [[agent-verification]]: lint as a check the agent cannot change

---
- anatomy
	- the linter: a program that parses the code into a syntax tree and walks it (ESLint for TypeScript, Ruff for Python)
	- the config: a file in the repo that lists the rules that are on
	- a rule: a small function that looks for one pattern in the tree
	- the preset: the rules the linter ships with. A repo starts from it
- what it holds: every Code rule a machine can state
	- the preset's rules, plus our own: most as config (a banned import, a banned path), a few as custom rules
	- what lint cannot state goes to review
- a lock on the agent, not only style: it holds structure (layout, banned imports, one pattern per problem), and the agent that writes the code does not change its config or its rules
- where it runs: in the pre-commit hook, and as the first step of the check command, so before push and first in CI
- how it grows: from mistakes review catches twice ([[add-a-lint-rule]])
