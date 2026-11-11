---
type: doc
description: "CI: the stations a change passes, from its workspace to a released version: local, presubmit, the merge queue (crate's hooks on the server, git land, the gate and its ruleset), postsubmit and release, and the rules every workflow keeps. Use when landing a change, or setting up or changing a repo's checks or release."
status: active
---
CI: the line of stations a change passes, from its workspace to a released version. Each station is crate's shared code, run on the server that holds main, running a part the repo owns ([[repo#Platform]]). A repo not on crate yet runs its stations in GitHub Actions. Off the line, the dev image is built when its inputs change ([[repo#Dev image]]); after it, [[cd]] runs the version.
- [[#Local]] the check, by the change's author, in its workspace
- [[#Presubmit]] the same check, on the change, before main takes it
- [[#Merge queue]] the gate: main moves only to a commit checked on the tree it becomes
- [[#Postsubmit]] the checks too slow for the queue, on main
- [[#Release]] a new version from main, by the repo's ship kind
- [[#Every workflow]] rules every workflow file keeps

- [[kinetic#The checks]]: the map, a cl to main; [[assembly#The dock]]: how a cl reaches it
- [[landing-flow]]: the queue, postsubmit and release, as built next
- [[tests]]: what the checks run
- [[ci-throughput]]: why CI speed is a product under agent volume

---
## Local

*The check, run by its author in the change's workspace before it lands: `scripts/check.sh` (`just check`), the command every station runs*

- while working: the change's own tests. The full check runs once, before the land ([[workspace#Run]])
- shared: nothing but the runner. The repo owns the sets, their commands and the path rules

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

## Presubmit

*The same check, on the change's branch, so the commit main takes is the commit that was checked*

- on crate: presubmit and the merge queue are one run, crate's pre-receive hook on the server ([[#Merge queue]]). On crate: que-pasa, basis, kinetic, lot, assembly, homepage, media-stack and deeotee
- not on crate: `checks.yml` in GitHub Actions, below. dazoo keeps it as a required check. landl-db and lotus-dash run their check at land. Every other repo lands with no check, and its ruleset keeps only the rules against deleting main and force-pushing

### checks.yml

*For a repo not on crate: one job, `checks`, on every push, runs the repo's one check command*

- the source: basis's `checks.yml`, copied as it is, until the platform's reusable workflow replaces the copies ([[repo#Platform]]). In `scripts/check.sh`, fill in the sets, their commands and the path rules. Not every repo uses it yet

#### When it runs

- every push to any branch, main included
	- a newer push to a branch other than main cancels the older run. On main a running run is not cancelled; GitHub keeps one waiting run per group, so a newer push replaces a waiting one
	- a run looked for in the first seconds after a push is not there yet
- it always starts: no path filter on the trigger. A required check whose workflow a path filter skips stays pending and blocks main (a job skipped by a condition reports success). So the command skips what a change does not need, not the trigger
- the job is named `checks`. The ruleset requires it by that name, so renaming it unhooks the rule

#### One command

- the job calls the repo's check command, the same one a person or an agent runs before landing. Green means the same in both places: the pipeline confirms, it does not discover
- it adds no check of its own, and sets up no toolchain: it runs in the repo's dev image ([[repo#Dev image]]), the same environment as every workspace
	- a job `image` gives the image by digest, so every job of the run uses one image. que's runs `scripts/dev-image.sh ensure`, which builds the image of a commit whose inputs ghcr lacks; basis's, landl's, publicpersona's and que-pasa's run `scripts/dev-image.sh ref`, the commit's image if ghcr has it, else `:main`, so a branch that changes an input runs on `:main` until it lands
	- each check job runs in it (`jobs.<id>.container`), and runs the check as the image's `node`, over a checkout `node` owns: `chown -R node:node "$GITHUB_WORKSPACE" && runuser -u node -- env HOME=/home/node scripts/check.sh`. A job container runs as root, which reads every file (a test of a file it may not open passes) and owns none of the checkout (git refuses it)
	- publicpersona's check drives its runtime image, so its steps run in the dev image by `docker run` on the job's own network, `publicpersona-ci` (its `IN` prefix), and reach the site by name ([[repo#Environment]])
	- a test that stands in for an engine pins its own `ENGINE`: the job sets `ENGINE` for the check's own containers

## Merge queue

*Main moves only to a commit whose check passed on the exact tree it becomes, and a change reaches main by no other way*

- crate: each repo on crate keeps main in a bare repo on monkeybusiness (`~/git/<repo>.git`), and crate's pre-receive hook checks every push to it ([github.com/matta-kelly/crate](https://github.com/matta-kelly/crate))
	- the queue: one push per repo at a time, under the repo's lock
	- the tree: git takes only a fast-forward of main, so the tree checked is the tree main becomes. A push that waited while main moved is sent back to rebase
	- the check: the repo's `scripts/check.sh`, in the image its `crate.toml` names, as `node`, with `CHECK_BASE` the old main, so only the sets a change touched run. Its checkout, packages and image stay warm between pushes. Past its time limit (`timeout` in `crate.toml`, 900 s by default) it is stopped
	- red: git refuses the push, and the pusher gets the check's output. Main has not moved
	- after: crate's post-receive copies main to GitHub, with the repo's own deploy key
	- the server: declared in [[dazoo]] (`nodes/mutable/monkeybusiness/crate/`), and applied by dazoo-sync through `crate apply`
- a repo not on crate: `git land` rebases, waits for presubmit on the rebased commit, and fast-forwards GitHub's main

### Land a change

*Commit, then `git land`. It is `~/.local/bin/git-land`, from deeotee, so it works in every repo*

- a repo with a remote named `server`, every repo on crate: `git land` fetches `server/main`, rebases onto it, and pushes there, where crate checks it. A refusal prints the check's output; fix it, commit, and `git land` again. Main moved during the push: it rebases and goes again, three times at most. After a land it fast-forwards the repo's main checkout to `server/main`
	- by hand: `git push server HEAD:main`
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
- an agent lands the same way, with `git land`, and so does [[assembly#The dock|assembly]]: each approved cl, as Matt

### The gate

*Every change joins main through the same gate, in small pieces, often*

- the pattern: trunk-based development under the Not Rocket Science Rule (Graydon Hoare, 2014). Main only ever points at a commit that passed the full check. Rust (bors), Gerrit (fast-forward only, Verified) and Google's presubmit run it
- the rule: main never takes a change that fails the check. Main moves to a change only when it passed, by fast-forward, so the commit on main is the commit that was checked
- the mechanism: a ruleset on main, and no pull requests
	- on crate: the ruleset restricts every update of main, and only deploy keys bypass it, so only the server's copy reaches GitHub's main ([[#The ruleset]])
	- the ruleset requires `checks` on the exact commit, and also holds a direct push: "commits must first be pushed to another ref where the checks pass" (GitHub's `RequiredStatusChecksParameters`)
	- pull requests are off in each repo: a merge there would make a new commit that no check ran on
	- a ruleset on a private repo needs GitHub Pro; on a public repo it is free
	- a private repo with no ruleset: a pre-push hook in `.githooks/` runs the check command, and refuses a push straight to main. The check command sets `core.hooksPath` to it. Not enforced past `--no-verify`
- a red main is still possible: a check that passed once fails on a rerun (a flake, or a check that reads something outside the repo). `checks` runs on main too, so the failed run sends its notice to whoever pushed. The one sink for every alert is [[notification-sink]]

#### The ruleset

Two JSONs: one for a repo on crate, one for a repo gated by GitHub Actions.
- on crate: `deletion` and `non_fast_forward` keep main's history, and `update` refuses every push to main but a deploy key's, the server's copy
	```json
	{
	  "name": "main",
	  "target": "branch",
	  "enforcement": "active",
	  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
	  "bypass_actors": [ { "actor_type": "DeployKey", "bypass_mode": "always" } ],
	  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "update" } ]
	}
	```
- gated by GitHub Actions: the rest of this section
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

## Postsubmit

*The checks too slow for the queue, run on each new commit of main. A red one is reverted first*

- Not built: `checks.yml` runs every set on main, and a red run only sends its notice ([[#The gate]], [[landing-flow]])

## Release

*A land to main makes a new version, and the repo's ship kind releases it, with no hand step*

- the version: crate's post-receive, after the copy to GitHub ([[repo#Platform]])
	- the bump: semver (SemVer 2.0), read from the types of the commits since the package's last version tag (Conventional Commits 1.0). The strongest wins
		- a breaking change (`feat!:`, or a `BREAKING CHANGE:` footer): major
		- `feat`: minor
		- `fix`, `perf`: patch
		- any other type: no version
	- before 1.0.0: each bump one place down, as npm's caret reads a 0.x version (`^0.30.0` takes 0.30.x only): a breaking change bumps minor, and `feat` bumps patch (release-please's `bump-minor-pre-major` and `bump-patch-for-minor-pre-major`). A package leaves 0.x only by a `v1.0.0` tag made by hand
	- the tag: the truth, never committed back. `v<version>` for the package at the root, `<folder>-v<version>` for one in a folder (`crate.toml`'s `packages`), each counting only the commits that touch its folder
	- the copy: every version tag to GitHub, by the repo's deploy key, which the version-tag ruleset lets through
- the ship kinds, `crate.toml`'s `ship`
	- a package (`npm`): published by the repo's `publish.yml` on the version tag, by npm's trusted publishing: no token, with provenance. It runs the check set, sets `package.json`'s version from the tag, and publishes. que-pasa and basis
	- an image: built once, in presubmit, tagged by its commit, and released by a tag ([[cd#ship.yml]])
	- nothing: no `ship`, no versions. A semantic or config repo, whose land is its release
- Not built: the image kind on crate. que's `ship.yml` builds its image on main, not in presubmit, and que publishes on a `v*` tag pushed by hand ([[landing-flow]])

## Every workflow

- a run of any workflow but `checks.yml` starts only when a file it reads has changed, and the file lists them. `checks.yml` always starts ([[#When it runs]])
- least rights
	- a job reads the repo and nothing else, unless it says so
	- only a job that pushes an image writes to the registry, with the run's own short-lived token: the runtime image's in `ship.yml` or `publish.yml`, the dev image's in `dev-image.yml` (and que's `image` job in `checks.yml`). No password is stored
- an action from someone else is pinned to a full commit hash; a tag can be moved to different code
- every job has a time limit: one without its own runs for up to six hours ([[code#^waiting|waiting]])
- runners: GitHub's own, so nothing to patch or keep registered. The check jobs run in the repo's dev image on them ([[#One command]])
	- a runner starts empty, and keeps only what the file asks it to keep
	- free on a public repo; a private repo draws on the account's minutes, 3,000 a month on Pro
	- no self-hosted runner on a public repo: a pull request from a stranger would run code on that machine
- cache: only where restoring is faster than making the thing again, read from the step times
	- dependencies: from the dev image's cache, keyed by the hash of its inputs. An install reads it, and fetches only what it lacks
	- never a build output: it goes stale without a sign
