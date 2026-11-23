# Contributing with specs

For contributors to a project that uses spectree. In such a project, a change starts as a spec. You write the code after the project agreed to the spec, in the same pull request.

## 1. Propose a spec

Open a pull request that adds or changes files under `roadmap/` and **nothing else**. Each feature is a directory with a `spec.md`:

```
roadmap/
  search/
    spec.md                 an epic: a group that organises its children
    incremental/
      spec.md               your new task
```

`roadmap/search/incremental/spec.md`:

```markdown
---
title: Incremental indexing
paths:
  - src/index/**
  - tests/index/**
criteria:
  - id: only-changed
    text: Only files changed since the last run are re-indexed.
    tests: [tests/index/test_incremental.py]
  - id: same-result
    text: The result equals a full re-index.
    tests: [tests/index/test_incremental.py]
---

Why this is needed, what it does, and what it does not do.
```

| Field | Meaning |
|---|---|
| `title` | One line. Required |
| `kind` | `leaf` (default) for a change to the code, `group` for a node that only organises others |
| `paths` | The files your implementation may touch. Globs are allowed |
| `criteria` | What must be true when it is done. Each has an `id`, a `text` and the test files that will prove it |
| `planned` | `true`, or a horizon such as `now`, `next` or `later`. The leaf is a roadmap entry: it needs no paths, no criteria and no code. Remove the field in the pull request that builds it |

The parent directory must already be a node, or be added in the same pull request.

A text that contains a colon needs quotes: `text: "One vote per person: the latest."`

## 2. The vote

- A reviewer votes for with **Approve** and against with **Request changes**.
- A comment can vote too, when its first line is a command: `/spectree for`, `/spectree against <reason>`, or `/spectree withdraw` to take your vote back. Any other comment is not a vote. `/spectree status` asks the workflow where the pull request stands.
- Anyone may vote. Each vote has a weight. By default maintainers have weight 1 and everyone else 0, so your vote is shown and the maintainers decide.
- You count as one vote for your own spec, at your own weight.
- If you change the spec, the votes start again, because people voted on the earlier text.

The workflow keeps one comment on the pull request with the current count and what happens next.

### Saying you want a spec

A vote decides whether the project agrees to a spec. Wanting one is separate, and open to everyone: on the roadmap page, open the spec and follow **Discuss or 👍** (or **Start its thread**), then add a 👍 to the first post. For a spec that is still a proposal, add the 👍 to the pull request's description. The page shows the count and lists the most wanted specs. It never changes a vote.

## 3. Add the code

When the vote passes, the pull request gets the label `spec-approved` and the spec is frozen.

- Push the code to the same pull request.
- Stay inside the `paths` of your spec. A file outside them fails the check `spectree/scope`.
- Add every test file your criteria name.
- Do not edit the spec. If the spec turns out to be wrong, change it, and the vote starts again.

From here, reviews are ordinary code review.

Some projects set `implementation: maintainers`. There, only maintainers write the code, and your part ends with the approved spec.

## 4. Merge

Spec and code merge together. Your feature then shows as done on the project's roadmap page.

## Taking over an approved spec

To tell others you are writing the code of an approved spec, comment `/spectree take` on its pull request. The roadmap page then shows your name on it. `/spectree withdraw` takes it back.

If a spec is approved and its author does not write the code, you can:

1. Start a branch from their pull request's branch, or copy the spec files unchanged.
2. Add the code.
3. Open a pull request with this line in the description: `Implements: #123`, where 123 is the approved pull request.

Your pull request inherits the approval, as long as the spec files are identical to the approved ones.

## Changing an existing feature

It is the same flow. Edit that feature's `spec.md`, wait for the vote, then change the code in the same pull request.

## Small fixes

Documentation and workflow files need no spec. For another small fix, open the pull request and ask a maintainer for the `no-spec` label.

## What the checks mean

| Check | Waiting | Failed |
|---|---|---|
| `spectree/spec` | The vote is open | The spec is not valid, or the code has no approved spec |
| `spectree/phase` | The spec is approved and needs its code | Code arrived before approval |
| `spectree/scope` | | A file is outside the spec's paths, or a test named by a criterion does not exist |

Each check's description says what to do next.
