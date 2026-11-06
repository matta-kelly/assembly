---
type: moc
description: "Root of assembly, the software factory: a deployment of que-pasa that moves one small change (a cl) through the inner loop. Read for what assembly is, what is built, and where each part goes."
status: active
---
The software factory: a deployment of que-pasa that moves a change through the inner loop, one cl at a time.
- [[#Built]] what exists
- [[#Not built]] the parts in the design that do not exist yet

- [[que-v2-design]]: the design it follows
- `../que-pasa`: the harness it runs on

---
## Built

- the engine of the inner loop, ready to approved, proven end to end with stub agents (`just e2e`)
	- `orchestrator/`: the ledger (SQLite: items, attempts, events), the transition table (ready, red, green, approved, and the send-backs), start (run folder, worktree, Podman with its mounts) and the loop (tick, finish)
		- each cl's passed work is on its branch, `assembly/<cl>/head`. Each attempt is a branch of its own, `assembly/<cl>/<n>`, made from it, and a pass moves the cl's branch to it
	- `process/`: the step type and the raise shape, and the three steps, each with its done shape and check
		- nail (ready to red): one test per behavior, then red at an assertion
		- hammer (red to green): no test changed, then green
		- review (green to approved): approve, or back to the tests or the code with findings, at most two rounds. Its worktree is read-only
	- `orchestrator/Containerfile`: the orchestrator's image (node, git, the podman client). The orchestrator never runs on the host: it starts containers through the host's podman socket, with host paths mounted at the same path
- the cl a change moves through is kinetic's type: kinetic lints each cl where it lives, and assembly reads it by path when it runs
- the gate: `just check` lints every note against its type, then checks the code: types, eslint, prettier, and the unit tests (podman and git faked). `just e2e` runs the inner loop with real containers; it is not in the gate, since it needs the podman socket

## Not built

- the agents: da-nail, da-hammer and cl-review as pi in the repo's image, in `agents/`. Stubs stand in for them
- the model proxy, and pi-durable in the container
- a command to add a cl and run the loop
- the plan step, and landing an approved cl
- not checked: that the hammer changed only the files the cl names, and that the old tests still pass (CI's)
