# How it works

The rules behind spectree, for people who want to check them. The design and its reasons are in [SPEC.md](../SPEC.md).

## Status

No file stores a status. Each run works it out:

| Status | Rule |
|---|---|
| Done | The node is in the default branch |
| Planned | The node is in the default branch and its header has `planned` |
| Proposed | An open pull request adds or changes the node, and the vote has not passed |
| Approved | The vote passed, and the pull request holds no code |
| In progress | The vote passed, and the pull request holds code |

A node that is done and is being changed by an open pull request stays done, with the open change listed beside it. A group shows how many leaves below it have each status.

## What counts as a vote

- The latest review of each person, if it is "Approve" or "Request changes".
- A dismissed review is a withdrawn vote.
- A review counts only if the spec directory at the commit it was made on is identical to the spec directory now. Spectree compares Git tree ids, so this is exact.
- Merging or rebasing onto a default branch whose `roadmap/` changed also resets the votes, because the directory is no longer identical.

The vote passes when the weighted votes for reach `threshold` and the weighted votes against do not exceed `max_against`.

## The approval record

When the vote passes, spectree writes a record into its own comment on the pull request: the spec digest, the commit, the time and every vote with its weight.

- **The digest** is a SHA-256 over the sorted list of the spec files the pull request changes, with the Git blob id of each. It depends on content only, so it survives a rebase and a squash.
- **After approval** the reviews are no longer counted. On each run, spectree computes the digest again. If it equals the recorded one, the approval holds. If not, the record is dropped, the label is removed and the vote starts again.
- **Taking over** uses the same record: a pull request with `Implements: #n` inherits the approval of #n when its digest equals the one recorded there.

A record is trusted only in a comment written by the workflow's own account. A record pasted into a comment by anyone else is ignored.

## The checks

| Check | Passes when |
|---|---|
| `spectree/spec` | The changed specs are valid and the vote passed. Or the pull request needs no spec |
| `spectree/phase` | No code before approval. A leaf has code before merge, unless it is planned or every test it names is already in the default branch. In `maintainers` mode, the code's author has write access |
| `spectree/scope` | Every changed file outside `roadmap/` matches a path of a leaf in the pull request, and every test file named by a criterion exists |

Exempt files are not counted as code and are not checked against the paths.

`spectree/scope` proves that the change stays inside the declared area and that the named tests exist. It does not judge whether the code meets the criteria. Whether the tests pass is your own CI, and whether they test the right thing is code review.

## Security model

The workflow runs with write permissions on pull requests from forks, so it follows three rules:

1. **It never checks out or runs a pull request's code.** It checks out the default branch. Pull requests are read through the GitHub API: the file list, the content of changed `spec.md` files, the reviews. All of it is treated as data.
2. **The settings come from the default branch.** A pull request cannot lower the threshold or exempt itself.
3. **Only people with write access can move the outcome.** Weights come from repository permissions or from `ratings` in the default branch. The `no-spec` label and commit statuses can only be set by people with triage or write access.

## Limits in version 0.1

- Each run looks at every open pull request against the default branch. This is simple and correct, and it uses more API calls on repositories with hundreds of open pull requests.
- The original pull request is not closed automatically after someone else's take-over merges.
- A repository that already publishes a GitHub Pages site cannot also publish the roadmap page.
- Only GitHub is supported.
