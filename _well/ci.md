---
type: doc
description: "CI: how a change lands on main (git land), the presubmit gate that holds it, checks.yml and its check set, the ruleset, and the rules all three workflows share. Use when landing a change, or setting up or changing a repo's checks."
status: active
---
CI: how a change is checked before it lands, on the dev side. GitHub Actions runs three workflows from `.github/workflows/` (it reads no other folder): `checks.yml` is CI, `dev-image.yml` builds the dev image the checks run in ([[repo#Dev image]]), and `ship.yml` is CD ([[cd]]).

Today only dazoo keeps the gate: `checks.yml` on every push, and the required check in its ruleset. landl-db and lotus-dash have no gate, and run their check at land. Every other repo lands with no check, and its ruleset keeps only the rules against deleting main and force-pushing. [[#The gate]] says the gate as dazoo runs it. The image is still built on main by `ship.yml`, not in `checks.yml` ([[#The check set]]).
- [[#Land a change]] how a change reaches main: `git land`
- [[#The gate]] why main holds only checked commits
- [[#checks.yml]] the workflow: when it runs, and what it runs
- [[#All three workflows]] rules for checks.yml, dev-image.yml and ship.yml

- [[kinetic#The checks]]: the map, a cl to main; [[inner-loop]]: presubmit in the loop
- [[cd]]: the other workflow
- [[tests]]: what the checks run
- [[ci-throughput]]: why CI speed is a product under agent volume

---
## Land a change

*Commit, then `git land`. It is `~/.local/bin/git-land`, from deeotee, so it works in every repo*

- a repo with a remote named `local`, a bare repo on this machine: `git land` takes the repo's lock, rebases onto `local/main` and pushes there, with no check and no call to GitHub. No repo has one today. A rebase conflict stops it: resolve it and `git land` again
	- no check runs, so run `just check` yourself before a land that matters, and on main before a release tag
	- GitHub's main is behind until a sync pushes `local/main` to it. It is a script, not a built step yet
- any other repo: the rest of this section. A repo in `checked` in `git-land` (dazoo, landl-db, lotus-dash) keeps its check. Any other lands with a plain push and no check

The rest of this section is the path through the gate, as dazoo runs it.

- main: the commit on GitHub, `origin/main`. A checkout is a copy and can be behind it: a landing from another machine, or one `git land` could not fast-forward. Read main with `git fetch`, then `git show origin/main:<path>`, or from a workspace made from `origin/main`
- where: code is made in its workspace ([[workspace]]). A note is edited in its vault checkout, checked there (`just check`, the repo's own lint), committed there, and landed from there. `git land` fast-forwards the repo's checkout after it lands, so the checkout never falls behind
- before: fetch, rebase onto origin/main, and run the repo's check (`just check`, or its check script), but not in a submodule's vault checkout
- then: `git land`, from the change's checkout. It is `~/.local/bin/git-land`, from deeotee, so it works in every repo
	- it pushes HEAD to a short branch (`land/<short commit>`). The pre-push hook runs the check, and a failed check pushes nothing; from `~/lot`, lot's hook runs `just check`. In a checkout that is a submodule (for a submodule of lot, its vault checkout), its pushes skip the hook (`--no-verify`), and it says so
	- it waits for `checks` on that commit
	- it pushes the same commit to main, by fast-forward
	- it deletes the branch, and fast-forwards the repo's main checkout to the commit. A checkout with its own commits, or an uncommitted change in the same files, is left as it is, and it says so
	- main moved meanwhile: it rebases and goes again, three times at most
	- a repo with no gate: a plain push to main
- when it stops, it says why, and main has not moved
	- `checks` failed: it prints the run's URL and keeps the branch. Fix it, commit, and `git land` again. A flake: rerun the run (`gh run rerun <id>`), then `git land` again
	- a rebase conflict: resolve it, run the check, and `git land` again
	- main kept moving: a busy repo with a slow run can lose the race three times. `git land` again. A merge queue would fix this, and GitHub has none for a personal account
- by hand, what `git land` does
	- `git push origin HEAD:refs/heads/<branch>`
	- `gh run list -R <owner>/<repo> --commit <sha> --workflow checks.yml` gives the run, and `gh run watch <id> --exit-status` waits for it
	- `git push origin <sha>:main`, then `git push origin --delete <branch>`
- an agent lands the same way, with `git land`. [[assembly]] does not land: Matt lands an accepted issue's branch

## The gate

*Every change joins main through the same gate, in small pieces, often*

- the pattern: trunk-based development under the Not Rocket Science Rule (Graydon Hoare, 2014). Main only ever points at a commit that passed the full check. Rust (bors), Gerrit (fast-forward only, Verified) and Google's presubmit run it
- the rule: main never takes a change that fails the check. Main moves to a change only when it passed, by fast-forward, so the commit on main is the commit that was checked
- the mechanism: a ruleset on main, and no pull requests
	- the ruleset requires `checks` on the exact commit, and also holds a direct push: "commits must first be pushed to another ref where the checks pass" (GitHub's `RequiredStatusChecksParameters`)
	- pull requests are off in each repo: a merge there would make a new commit that no check ran on
	- a ruleset on a private repo needs GitHub Pro; on a public repo it is free
- a red main is still possible: a check that passed once fails on a rerun (a flake, or a check that reads something outside the repo). `checks` runs on main too, so the failed run sends its notice to whoever pushed. The one sink for every alert is [[notification-sink]]

### The ruleset

One JSON for every repo.
- apply it: POST it (`gh api -X POST repos/{owner}/{repo}/rulesets --input <file>`), or PUT it to the existing ruleset when the repo has one named `main` (`gh api -X PUT repos/{owner}/{repo}/rulesets/{id} --input <file>`). Turn pull requests off with it (`gh api -X PATCH repos/{owner}/{repo} -F has_pull_requests=false`)
- `deletion` and `non_fast_forward` keep main's history
- `integration_id` 15368 is GitHub Actions, so only an Actions run can set `checks`
- the JSON:
	```json
	{
	  "name": "main",
	  "target": "branch",
	  "enforcement": "active",
	  "conditions": {
	    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
	  },
	  "bypass_actors": [],
	  "rules": [
	    { "type": "deletion" },
	    { "type": "non_fast_forward" },
	    {
	      "type": "required_status_checks",
	      "parameters": {
	        "strict_required_status_checks_policy": false,
	        "required_status_checks": [
	          { "context": "checks", "integration_id": 15368 }
	        ]
	      }
	    }
	  ]
	}
	```

## checks.yml

*One job, `checks`, on every push, runs the repo's one check command*

- the template: `templates/repo/` in kinetic. Copy `.github/workflows/checks.yml` as it is. In `scripts/check.sh`, fill in the sets, their commands and the path rules. Not every repo uses it yet

### When it runs

- every push to any branch, main included
	- a newer push to a branch other than main cancels the older run. On main a running run is not cancelled; GitHub keeps one waiting run per group, so a newer push replaces a waiting one
	- a run looked for in the first seconds after a push is not there yet
- it always starts: no path filter on the trigger. A required check whose workflow a path filter skips stays pending and blocks main (a job skipped by a condition reports success). So the command skips what a change does not need, not the trigger
- the job is named `checks`. The ruleset requires it by that name, so renaming it unhooks the rule

### One command

- the job calls the repo's check command, the same one a person or an agent runs before landing. Green means the same in both places: the pipeline confirms, it does not discover
- it adds no check of its own, and sets up no toolchain: it runs in the repo's dev image ([[repo#Dev image]]), the same environment as every workspace
	- a job `image` gives the image by digest, so every job of the run uses one image. que's runs `scripts/dev-image.sh ensure`, which builds the image of a commit whose inputs ghcr lacks; basis's, landl's, publicpersona's and que-pasa's run `scripts/dev-image.sh ref`, the commit's image if ghcr has it, else `:main`, so a branch that changes an input runs on `:main` until it lands
	- each check job runs in it (`jobs.<id>.container`), and runs the check as the image's `node`, over a checkout `node` owns: `chown -R node:node "$GITHUB_WORKSPACE" && runuser -u node -- env HOME=/home/node scripts/check.sh`. A job container runs as root, which reads every file (a test of a file it may not open passes) and owns none of the checkout (git refuses it)
	- publicpersona's check drives an image on the host's network, which a job container cannot join, so its pnpm steps run in the dev image by `docker run --network host` (its `IN` prefix)
	- a test that stands in for an engine pins its own `ENGINE`: the job sets `ENGINE` for the check's own containers

### The check set

- cheapest first, and the first failure ends the run
	- format, lint, types
		- notes: one linter (basis), from each root of the repo, each root alone
		- each root lints alone: no repo lints lot's graph, and lot lints only its own notes
	- unit [[tests#Kinds|tests]], then integration tests
	- build: the aim is that the image is built once, here, and pushed to the registry named by its commit (`sha-<short commit>`). Nothing builds it again: CD deploys this image ([[cd]])
		- only this job writes to the registry, with the run's own short-lived token
	- end to end and contract tests, on what was just built
- a repo runs the steps it has: a repo of config and images has no tests, and its lint is validation
- each check sits at the cheapest step that can catch its fault
- only what the change needs, read from the files it changed against origin/main
	- a change to notes and docs alone ends after format and lint
	- the skip is the same on a machine and in the pipeline
	- a file no rule names runs every set, and so does an answer git cannot give, so a missing rule runs more, never less
	- on main, the pipeline runs every set: the full run catches what a skip missed
- under ten minutes
	- a step that cannot meet it is a run of its own, with a budget of its own
	- a run over its budget is a defect: [[speed-up-ci]]
	- the levers: faster lint and type tools, shards for a long test set, a shallow checkout on a job that reads no history, and no check run again on inputs it passed

## All three workflows

- a run of `ship.yml` starts only when a file it reads has changed; the file lists them, and so does `dev-image.yml`. `checks.yml` always starts ([[#When it runs]])
- least rights
	- a job reads the repo and nothing else, unless it says so
	- only a job that pushes an image writes to the registry, with the run's own short-lived token: the runtime image's in `ship.yml`, the dev image's in `dev-image.yml` (and que's `image` job in `checks.yml`). No password is stored
- an action from someone else is pinned to a full commit hash; a tag can be moved to different code
- every job has a time limit: one without its own runs for up to six hours ([[code#^waiting|waiting]])
- runners: GitHub's own, so nothing to patch or keep registered. The check jobs run in the repo's dev image on them ([[#One command]])
	- a runner starts empty, and keeps only what the file asks it to keep
	- free on a public repo; a private repo draws on the account's minutes, 3,000 a month on Pro
	- no self-hosted runner on a public repo: a pull request from a stranger would run code on that machine
- cache: only where restoring is faster than making the thing again, read from the step times
	- dependencies: from the dev image's cache, keyed by the hash of its inputs. An install reads it, and fetches only what it lacks
	- never a build output: it goes stale without a sign
