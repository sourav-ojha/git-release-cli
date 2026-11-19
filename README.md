# @sourav/git-release-cli

Reusable CLI that prepares production releases from Git history: it cuts a timestamped release branch at an exact commit, generates categorized release notes from Conventional Commits, pushes the branch and opens a GitHub Pull Request against your production branch.

The **release engine** is generic; each project only supplies a small JSON **configuration** file, which can live anywhere (even outside the repository).

## Installation

```bash
npm install -g @sourav/git-release-cli
```

Provides the `release-cli` command.

## Prerequisites

- Node.js 20+
- Git
- [GitHub CLI](https://cli.github.com) (`gh`), only needed when creating pull requests
- An authenticated `gh` session:

```bash
gh auth login
```

The tool never reads or stores GitHub tokens; authentication is entirely delegated to `gh`.

## Quick start

```bash
release-cli init                                          # writes release.config.json (dry-run enabled)
release-cli release --config ./release.config.json --dry-run   # preview
release-cli release --config ./release.config.json --no-dry-run # real release (asks for confirmation)
```

`release.config.json` ships with `"dryRun": true`. A real release needs `"dryRun": false` in the config or `--no-dry-run` on the command line.

Pin the release to a commit (must be in the base branch history):

```bash
release-cli release --config ./release.config.json --commit abc123def456
```

Override config values:

```bash
release-cli release --config ./release.config.json \
  --base-branch dev --production-branch main --commit abc123def456
```

### Command reference

| Command | Purpose |
|---|---|
| `release-cli release --config <file>` | Run (or preview) a release |
| `release-cli init [-o file] [--force]` | Write a starter config; never overwrites without confirmation |
| `release-cli config --config <file>` | Validate and print the effective configuration |

`release` options: `--config <path>` (required), `--commit <hash>`, `--base-branch`, `--production-branch`, `--dry-run`, `--no-dry-run`, `--no-push` (implies `--no-pr`), `--no-pr`, `-y/--yes` (skip confirmation), `-C/--cwd <path>` (repository directory, default: current directory), `--verbose`, `--help`, `--version`. CLI flags override the config file. There is no implicit config lookup: `--config` is always required.

## External configuration

Keep every project's config in one place, outside the repositories:

```text
~/release-configs/
├── project-a.json
├── project-b.json
└── project-c.json
```

```bash
cd ~/code/project-a
release-cli release --config ~/release-configs/project-a.json
```

Relative `--config` paths resolve from the directory you invoke the command in (`~/` is expanded too).

## Configuration reference

Unknown properties are rejected, so typos fail loudly. Do not put credentials in this file.

```json
{
  "release": { "baseBranch": "dev", "productionBranch": "main", "branchPrefix": "release", "branchTimestampFormat": "YYYYMMDD-HHmmss", "productionMergeStyle": "merge" },
  "pullRequest": { "title": "Release: {date}", "draft": false, "labels": ["release"], "reviewers": [], "assignees": [], "includeCommitAuthors": false },
  "git": { "remote": "origin", "fetchBeforeRelease": true, "requireCleanWorkingTree": true },
  "changelog": { "includeMerges": false },
  "options": { "dryRun": true, "pushBranch": true, "createPullRequest": true }
}
```

| Property | Default | Notes |
|---|---|---|
| `release.baseBranch` | **required** | Development branch the release is cut from. Letters, digits, `. _ - /`. |
| `release.productionBranch` | **required** | PR target. Must differ from `baseBranch`. |
| `release.branchPrefix` | `release` | Release branch is `<prefix>/<timestamp>`. |
| `release.branchTimestampFormat` | `YYYYMMDD-HHmmss` | Tokens `YYYY MM DD HH mm ss` (local time); separators `- _ .`; must include `YYYY`, `MM`, `DD`. |
| `release.productionMergeStyle` | `merge` | `merge`: production must be an ancestor of the cutoff. `squash`: for repos whose release PRs are squash-merged into production (production is never an ancestor of base). Ancestry is replaced by a content check (abort if the release would revert a production-only change) and commits already listed in production squash-commit messages are left out of the notes. |
| `pullRequest.title` | `Release: {date}` | Placeholders `{date}` (e.g. `19 November 2026`), `{branch}`, `{commit}` (7-char cutoff). Unknown placeholders are rejected. |
| `pullRequest.draft` | `false` | Create a draft PR. |
| `pullRequest.labels` | `[]` | Labels must already exist in the GitHub repo. |
| `pullRequest.reviewers` / `assignees` | `[]` | GitHub logins (or `org/team` for reviewers). |
| `pullRequest.includeCommitAuthors` | `false` | Append `— Author` to changelog entries. |
| `git.remote` | `origin` | Remote used for fetch, push, and as the source of truth for base/production. |
| `git.fetchBeforeRelease` | `true` | `git fetch <remote>` before a real run. |
| `git.requireCleanWorkingTree` | `true` | Fail on any uncommitted or untracked file. |
| `changelog.includeMerges` | `false` | Include merge commits in notes. |
| `options.dryRun` | `true` | Preview only. |
| `options.pushBranch` | `true` | Push the release branch. |
| `options.createPullRequest` | `true` | Open a PR; requires `pushBranch`. |

A JSON Schema for editors is in `schemas/release-config.schema.json`.

## Changelog categories

Release notes come from `git log <production>..<cutoff>` (not from GitHub PRs), so commits already in production are never listed. Sections appear in this order, empty ones omitted:

Breaking Changes · Features (`feat`) · Bug Fixes (`fix`) · Performance Improvements (`perf`) · Code Refactoring (`refactor`) · Documentation (`docs`) · Tests (`test`) · Build System (`build`) · CI/CD (`ci`) · Maintenance (`chore`) · Code Style (`style`) · Reverts (`revert`) · Other Changes

- `feat(auth): add SSO login` renders as `- **auth:** Add SSO login (abc1234)`.
- Breaking changes (`feat!:`, `fix(api)!:`, or a `BREAKING CHANGE:` footer) are listed only under **Breaking Changes**, with the footer text.
- Non-conventional and unknown-type commits go to **Other Changes**; nothing is dropped. Merge commits are skipped unless `changelog.includeMerges` is true.

## Release workflow

1. Parse arguments, load and validate config (CLI overrides applied first).
2. Verify the Git repository and (optionally) a clean working tree.
3. Verify the remote, and `gh` installation/authentication/repository when a PR is requested.
4. Fetch the remote (real runs only).
5. Resolve `<remote>/<base>` and `<remote>/<production>`; confirm both exist on the remote and match local tracking refs.
6. Resolve the cutoff: `--commit` (validated hex, must exist) or the latest base commit. It is printed.
7. Validate ancestry (below), compute the range, generate notes and the branch name; check the branch is free locally and remotely.
8. Print the full plan. Stop here in dry-run.
9. Ask for confirmation (or `--yes`).
10. `git branch --no-track <branch> <cutoff>`, then `git push --set-upstream <remote> refs/heads/<branch>:refs/heads/<branch>`, then `gh pr create`.
11. Print a summary and the PR URL.

The release branch is created **without switching** your current branch (`git branch`, not `git switch -c`), so your checkout and working tree are never disturbed. It points at exactly the cutoff commit.

## Safety model

- **Dry-run** (default in starter config, and the schema default) never creates branches, pushes, creates PRs, fetches, or touches files. It reads local refs plus read-only `ls-remote` queries, and warns when remote-tracking refs may be stale.
- **Ancestry:** the production branch must be an ancestor of the cutoff (`git merge-base --is-ancestor`), otherwise the PR would drop production-only commits; the cutoff must also be in the base branch history. Violations abort before anything is created.
- **Shallow repositories:** if ancestry cannot be proven, the run fails (run `git fetch --unshallow`). Checks are never skipped.
- **Detached HEAD** is fine, since no branch switch happens; it is noted in the plan.
- **No overwrites:** an existing local or remote branch with the generated name aborts the run. Pushes never force.
- **Empty range:** previewable, but a real run refuses ("Nothing to release").
- **Pull requests:** an existing open PR for the same head/base is reported and reused (no duplicate). A merged PR for the head aborts; a closed one produces a warning and a new PR. PR bodies are passed through a private temp file that is always removed. PRs are never merged and branches never deleted.
- **Partial failures:** if the branch exists but a later step fails, the error names the failed step and lists what was left in place. Nothing is rolled back automatically.
- Processes are spawned with argument arrays (no shell), with timeouts; config never holds secrets.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Not a Git repository` | Run inside the repo or pass `-C <path>`. |
| `Branch "x" was not found on remote` | Check names; `git fetch <remote>`; verify `git.remote`. |
| `differs from the remote` | Local tracking ref is stale; enable `fetchBeforeRelease` or fetch manually. |
| `Production branch ... is not an ancestor` | Production has commits the cutoff lacks. Merge production into the base branch, or choose a later cutoff. |
| `shallow repository` | `git fetch --unshallow`. |
| `Working tree has uncommitted changes` | Commit or stash, or set `requireCleanWorkingTree` to `false`. |
| `already exists locally/on remote` | Branch names are per-second; retry, or change prefix/format. |
| `GitHub CLI is not authenticated` | `gh auth login`. |
| `gh ... could not resolve this repository` | Ensure the remote is on GitHub; with several remotes run `gh repo set-default`. |
| Label/reviewer error after push | The branch stays pushed; create the PR manually or fix the label and re-run (a new branch is cut). |
| `Confirmation required but no interactive terminal` | Pass `--yes`. |
| Config error exit code `2` | See the listed property paths. |

Use `--verbose` to log every Git and `gh` invocation.

## Development

```bash
git clone <repo> && cd git-release-cli
npm install
npm run lint
npm test                    # unit tests
npm run test:integration    # temp-repo integration tests (fake gh, no network)
npm pack --dry-run          # inspect published files
node src/cli.js --help      # run locally
npm link                    # expose `release-cli` globally from source
```

Regenerate the JSON schema after changing `src/config/schema.js`: `node scripts/generate-schema.js` (a test fails when it is stale).

### Publishing (manual)

```bash
npm test && npm run test:integration && npm run lint
npm version patch            # or minor / major; updates package.json and tags
npm pack --dry-run
npm publish --access public  # requires npm login and the @sourav scope
```

## License

MIT
