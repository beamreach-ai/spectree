# spectree: v1 spec

Status: version 0.1 built on 17 Nov 2026 (W1 to W7 in code and tests; not yet run on a live repository). Written from the DevOpsDays Barcelona 2026 open space "Challenges 4 OSS" and the design decisions made afterwards.

## 1. What this is

Spectree is a set of GitHub workflows that any open-source repository can attach. With it, a contribution starts as a change to a spec, people vote on the spec, and code is accepted only for a spec that passed the vote. Spec and code merge together.

The problem it answers: AI made code cheap, so maintainers get more pull requests of lower quality, written from partial context or no spec at all, while maintainer time shrinks. A spec change is small and quick to judge. Reviewing intent first means the maintainer reads code only for changes the project already agreed to.

**In v1:** the spec tree, the one-PR two-phase flow, votes with weights, the fixed-rule checks, the dashboard on GitHub Pages, attachment by reusable workflow, and documentation.

**Not in v1:** an AI review of code against the spec (written as a proposed spec in this repo, section 11), contributor karma, a rating shared across repositories, and forges other than GitHub.

## 2. Terms

| Term | Meaning |
|---|---|
| Node | One directory under `roadmap/` that holds a `spec.md` |
| Group | A node that only organises its children. It needs no code |
| Leaf | A node that describes a change to the code |
| Spec PR | A pull request that adds or changes files under `roadmap/` |
| Spec phase | The part of a spec PR's life when it holds spec files only and people vote |
| Code phase | The part after the vote passed, when code is added to the same PR |
| Spec digest | A hash of the spec files a PR changes. An approval belongs to a digest |
| Weight | How much one person's vote counts |

## 3. The spec tree

```
roadmap/
  search/                     group (epic)
    spec.md
    fuzzy-matching/           leaf (task)
      spec.md
    indexing/                 group (task)
      spec.md
      incremental/            leaf (subtask)
        spec.md
```

- Every directory under `roadmap/` with a `spec.md` is a node. Its subdirectories are its children, to any depth.
- A node's id is its path below `roadmap/`, for example `search/indexing/incremental`.
- Level names come from depth and are set in the config. The default is epic, task, subtask, and deeper levels are also called subtask.

### 3.1 `spec.md`

```markdown
---
title: Incremental indexing
kind: leaf            # leaf (default) or group
paths:                # leaf only: what the implementation may touch
  - src/index/**
  - tests/index/**
criteria:             # leaf only: at least one
  - id: only-changed
    text: Only files changed since the last run are re-indexed.
    tests: [tests/index/test_incremental.py]
  - id: same-result
    text: The result equals a full re-index.
    tests: [tests/index/test_incremental.py]
---

Why this is needed, what it does, what it does not do.
```

- `title` is required. `kind` defaults to `leaf`.
- A leaf must have `paths` and at least one criterion. Every criterion has an `id`, a `text` and at least one entry in `tests`.
- A group has neither `paths` nor `criteria`.
- **No status is stored in the file.** Status is worked out from Git and GitHub (section 3.2), so it cannot go stale.

### 3.2 Status

| Status | How it is worked out |
|---|---|
| Proposed | An open spec PR adds or changes the node, and the vote has not passed |
| Approved | The vote passed, and the PR holds no code yet |
| In progress | The vote passed, and the PR holds code |
| Done | The node is in `main` and no open PR changes it |

- A node that is in `main` and is changed by an open PR shows as done, with the open change listed under it in its own status.
- A group's status is a count of its descendants by status, for example "3 done, 1 in progress, 2 proposed".
- A closed, unmerged PR leaves no trace on the roadmap.

## 4. The contribution flow: one PR, two phases

1. **Open.** A contributor opens a PR that changes only files under `roadmap/`. This starts the spec phase.
2. **Vote.** People review the PR. "Approve" is a vote for and "Request changes" is a vote against (section 5).
3. **Approval.** When the vote passes, the workflow writes an approval record (section 5.4), adds the label `spec-approved` and reports the check `spectree/spec` as passed. The spec files are now frozen.
4. **Code.** Code is pushed to the same PR. The repository's normal code review applies and this tool does not replace it.
5. **Merge.** Spec and code reach `main` in one merge.

Rules the checks enforce (section 6):

- Code may not appear in a spec PR before approval.
- After approval, the spec files may not change. A PR whose spec changes after approval goes back to the spec phase, the label is removed and the vote starts again.
- A group node may merge after approval with no code. A leaf may not.
- A PR may change several nodes. One vote covers all of them.

### 4.1 Changing an existing spec

It is the same flow. The PR edits the node's `spec.md`, the vote runs on the change, and the code that makes the change true is added to the same PR.

### 4.2 Someone else writes the code

The approval belongs to the spec digest, not to the PR. A second contributor:

1. branches from the approved PR's branch, or copies its spec files unchanged;
2. opens a new PR with `Implements: #<number of the approved PR>` in the description.

The check loads the approval record from the named PR and compares its digest with the spec files in the new PR. If they match, the new PR starts in the code phase. The original PR is closed when the new one merges.

### 4.3 Who may write code

Set by `implementation` in the config:

| Value | Who may push code in the code phase |
|---|---|
| `contributors` (default) | Anyone |
| `maintainers` | Only people with write access. A code-phase PR from anyone else fails `spectree/phase` with a comment that explains the spec flow |

### 4.4 Pull requests with no spec

A PR that changes code and belongs to no approved spec fails `spectree/spec`. Exceptions:

- every changed file matches `exempt_paths` (default: `**/*.md` outside `roadmap/`, `.github/**`);
- the author is in `exempt_authors` (default: `dependabot[bot]`, `renovate[bot]`);
- a maintainer added the label `no-spec`.

`on_missing_spec` decides what happens: `fail` (default) reports the failed check and one comment, and `close` also closes the PR.

## 5. Votes

### 5.1 A vote is a pull-request review

- "Approve" counts for. "Request changes" counts against. "Comment" does not count.
- Each person has one vote: their latest review that counts.
- A vote counts only if the spec files did not change between the commit the review was made on and the PR's current head. A change to the spec resets the votes.
- A dismissed review is a withdrawn vote.
- GitHub stores reviews with the PR, with author, time and comments. Nothing else stores votes.

### 5.2 Weights

- A person with write, maintain or admin access to the repository has weight 1.
- Everyone else has weight 0. Their votes are shown in the tally and do not decide the outcome.
- `ratings` in the config overrides the weight of named users. This is the place a karma system connects later.

### 5.3 When the vote passes

The vote passes when both are true:

- the weighted sum of votes for is at least `threshold` (default 1);
- the weighted sum of votes against is at most `max_against` (default 0).

GitHub does not let an author review their own PR. With `count_author: true` (default), the author counts as one vote for, at their own weight. A sole maintainer can therefore approve their own spec, and a team that wants a second person sets `threshold: 2`.

### 5.4 The approval record

One comment on the PR, written and updated by the workflow, shows the live tally:

```
Spec vote: passed
For      2 weighted (7 people)
Against  0 weighted (1 person)
Approved at commit 4f2a9c1, spec digest sha256:9b1d...
```

The same comment holds the record as JSON in a hidden block: digest, commit, time, and each voter with vote and weight. The checks trust a record only in a comment written by the workflow's own account.

**Spec digest:** SHA-256 over the sorted list of (path, Git blob id) for every file under `roadmap/` that differs from the merge base. It survives a rebase and a squash, because it depends on file content and not on commit ids.

## 6. Checks

Three commit statuses on every PR. Each has a one-line description that says what to do next.

| Check | Fails when |
|---|---|
| `spectree/spec` | The tree is invalid (section 3.1); the vote has not passed; or the PR changes code and belongs to no approved spec (section 4.4) |
| `spectree/phase` | Code is present before approval; a leaf has no code at merge time; `implementation: maintainers` and the code author has no write access |
| `spectree/scope` | A changed file outside `roadmap/` matches none of the `paths` of the PR's leaf nodes; or a file named in a criterion's `tests` does not exist at the PR's head |

- `spectree/scope` is the v1 answer to "does the code do what the spec says". It proves the change stays inside the declared area and that every criterion names a test that exists. Whether those tests pass is the repository's own CI.
- A maintainer makes the checks binding by marking them as required in branch protection. The setup guide shows how.

## 7. The dashboard

- A static page built by the workflow and published with GitHub Pages at `https://<owner>.github.io/<repo>/` (or under `dashboard.path`).
- It shows the tree with each node's status, and for every open spec PR: phase, live tally, author and link.
- It is rebuilt on a push to `main`, on every PR event, on every review, and once a day.
- The same data is published beside it as `roadmap.json`.
- The vote comment on each PR also shows the subtree that PR changes, as text.

## 8. Attaching it to a repository

No submodule and no copied code. The maintainer:

1. runs `npx github:beamreach-ai/spectree init`, or copies two files by hand:
   - `.github/workflows/spectree.yml`: calls the reusable workflow `beamreach-ai/spectree/.github/workflows/spectree.yml@v1`;
   - `.github/workflows/spectree-signal.yml`: a workflow with no permissions that only reports that a review happened (section 9 says why);
2. turns on GitHub Pages with "GitHub Actions" as the source;
3. optionally adds `.spectree.yml`.

Updates arrive through the `v1` tag.

### 8.1 `.spectree.yml`

Every key is optional. The values below are the defaults.

```yaml
root: roadmap
levels: [epic, task, subtask]
implementation: contributors      # or maintainers
threshold: 1
max_against: 0
count_author: true
ratings: {}                       # user: weight
exempt_paths: ["**/*.md", ".github/**"]
exempt_authors: ["dependabot[bot]", "renovate[bot]"]
on_missing_spec: fail             # or close
dashboard:
  enabled: true
  path: ""
```

## 9. How the workflows run

- The main workflow runs on `pull_request_target`, on `workflow_run` of the signal workflow, on a push to `main` and on a daily schedule. It holds the write permissions: statuses, comments, labels, Pages.
- **It never checks out or runs code from a pull request.** It reads the PR's files, reviews and permissions through the GitHub API and treats them as data. This is what makes it safe to give it write permissions on PRs from forks.
- A review on a PR from a fork starts workflows with a read-only token, which cannot write the tally. So the signal workflow does nothing but finish, and its completion starts the main workflow with write permissions.
- The config is always read from `main`, never from the PR, so a PR cannot lower the threshold for itself.
- Implementation: one TypeScript action in this repository, with the tree, the digest, the tally and the checks as plain functions that have unit tests.

## 10. Documentation

| Page | For | Content |
|---|---|---|
| `README.md` | Everyone | The problem, the flow in one diagram, a link to the live dashboard of this repo |
| `docs/setup.md` | Maintainers | Attaching it, Pages, branch protection, the config reference |
| `docs/contributing-with-specs.md` | Contributors | Proposing a spec, voting, adding code, taking over an approved spec. A repo can link it from its own CONTRIBUTING |
| `docs/walkthrough.md` | Both | One real change followed from spec PR to merge, with screenshots |
| `docs/how-it-works.md` | The curious | Status rules, the digest, the security model |

## 11. This repo uses itself

- This repository has its own `roadmap/` tree. Each work package below is a leaf in it.
- The AI review of code against the spec is written as a spec, `roadmap/flow/ai-review/spec.md`, and left as an open spec PR. It shows as "proposed" on the dashboard, which makes the dashboard a live example from the first day.

## 12. Work packages

| # | Package | Done when |
|---|---|---|
| W1 | Tree: parse, validate, status rules, digest | Unit tests cover every rule in sections 3 and 5.4 |
| W2 | Tally and approval record | A test repo shows the comment, the label and `spectree/spec` for: pass, fail, vote reset by a spec change, author counted |
| W3 | `spectree/phase` and `spectree/scope` | Each failure in the section 6 table is produced once on the test repo |
| W4 | Take-over by `Implements:` and PRs with no spec | Section 4.2 and each exception of 4.4 shown on the test repo |
| W5 | Reusable workflows, signal workflow, `init` | A fresh repo is attached with the two files and nothing else, and a PR from a fork gets its tally |
| W6 | Dashboard on Pages | The test repo's page shows all four statuses and a live tally |
| W7 | Documentation | A person who has not seen the project attaches it to a repo using `docs/setup.md` alone |
| W8 | Own roadmap and the AI review spec PR | Section 11 is true on the public repo |
| W9 | Attach it to `beamreach-ai/compass` as the first real project | Compass has the two workflow files and a `roadmap/` tree, its dashboard is live, and the checks report without blocking (not marked as required) until a maintainer turns them on |

Order: W1, then W2 and W3, then W4 and W5, then W6, W7, W8, W9. The first version to show outside Beamreach is W1 to W3, W5 and the dashboard (W6) on a test repo, with the README.

## 13. Acceptance

One recording on a fresh public test repository, with a second GitHub account that has no write access:

1. The repo is attached with the two files.
2. The outside account opens a spec PR for a new leaf. The dashboard shows it as proposed.
3. The outside account pushes code early. `spectree/phase` fails.
4. The code is removed, the maintainer approves, and the tally comment shows the vote passed.
5. The outside account edits the spec. The vote resets. The maintainer approves again.
6. Code is pushed, one file outside `paths`. `spectree/scope` fails. The file is removed and it passes.
7. The PR merges. The dashboard shows the node as done.
8. A code PR with no spec is opened and fails `spectree/spec`.

## 14. Open questions

1. **Repository home and licence.** Proposed: `beamreach-ai/spectree`, public, Apache 2.0, the same as Compass.
2. **A repo that already uses GitHub Pages.** The dashboard would replace its site. Options: publish under a path of the existing site, or offer the dashboard only as `roadmap.json` plus a page the repo builds in. To decide when the first such repo appears.
3. **A minimum voting time.** A `min_hours` setting would stop a maintainer approving before anyone else saw the spec. Left out of v1 unless someone asks for it.
4. **Branch protection that dismisses reviews on a new push.** With it on, every push in the code phase dismisses the votes in GitHub's own view. The approval record is not affected, because it was written at approval. To confirm in W2 on the test repo.
