---
title: "The code needs its own approval"
paths:
  - src/evaluate.ts
  - src/run.ts
  - src/config.ts
  - src/commands.ts
  - src/dashboard.ts
  - test/review.test.ts
  - test/core.test.ts
  - test/run.test.ts
  - test/commands.test.ts
  - test/layout.test.ts
  - dist/**
criteria:
  - id: needs-review
    text: "A pull request whose spec is approved and which holds code keeps `spectree/phase` pending until the code review passes. The description is `Code review open: <for> of <needed> needed for, <against> against`."
    tests: [test/review.test.ts]
  - id: head-only
    text: "A review counts for the code only when it was made on the pull request's head commit. The review that passed the spec vote on an earlier commit does not count, and a push after a passed code review opens it again."
    tests: [test/review.test.ts]
  - id: passes
    text: "The code review passes when the weighted approvals reach `review.threshold` and no vote against has a weight above zero. `spectree/phase` then succeeds with `Code phase: spec approved, code reviewed (<for> for, <against> against)`."
    tests: [test/review.test.ts]
  - id: author
    text: "With `review.count_author: true` the author counts as one approval at their own weight, so a maintainer's own code passes with nobody else and an outsider's code does not. With `false` the author never counts."
    tests: [test/review.test.ts]
  - id: one-review
    text: "When spec and code arrive in the same commit, one approving review on that commit passes the spec vote and the code review together."
    tests: [test/review.test.ts]
  - id: commands
    text: "`/spectree for` and `/spectree against` count for the code when they were written after the workflow first saw the head commit; `/spectree withdraw` takes the commenter's code vote back."
    tests: [test/review.test.ts]
  - id: off
    text: "With `review.threshold: 0` there is no code review: `spectree/phase` succeeds as soon as the spec is approved and the code is in, with the text it has today."
    tests: [test/review.test.ts]
  - id: config
    text: "`.spectree.yml` accepts `review.threshold` (a number, 0 or more; default 1) and `review.count_author` (true or false; default true). A wrong type and an unknown key under `review` are reported."
    tests: [test/review.test.ts]
  - id: comment
    text: "In the code phase the workflow's comment has a `Code review` table under the spec vote: weighted for and against, the people, and each vote. Its `Next` line says who must approve, or that the pull request can merge."
    tests: [test/review.test.ts]
  - id: page
    text: "On the roadmap page a proposal with code stays under `In code review` while the code review is open, shows its count there, and moves under `Ready to merge` when the review has passed. `roadmap.json` carries the count."
    tests: [test/review.test.ts]
---

Today a vote decides on the spec, and nothing decides on the code. Once the spec is approved, the three checks ask only that the code stays inside the spec's `paths` and that the test files the criteria name exist. They turn green without anyone having read the code. `docs/contributing-with-specs.md` says "From here, reviews are ordinary code review", but no check waits for one. An outside contributor whose spec a maintainer approved can push any code inside the paths and the pull request is ready to merge.

GitHub's own rule "require an approving review" does not close this. It counts the approval that was given for the spec, before any code existed; it cannot count the author, so a project with one maintainer could never merge that maintainer's own work; and it knows nothing of the weights in `ratings`.

This spec adds a second approval, for the code, counted by spectree with the rules it already uses for the vote.

## Two approvals, and what each is tied to

| | Spec approval (exists) | Code approval (new) |
| --- | --- | --- |
| Decides | whether the project wants the change | whether this code may merge |
| Tied to | the text of the spec files | the head commit |
| Resets when | the spec changes | any commit is pushed |
| Survives | every code push, a rebase | nothing; it is given on the final code |
| Passes at | `threshold`, `max_against` | `review.threshold`, no weighted vote against |

They stay two things because they reset on different events. If one approval covered both, every code push would reopen the spec vote, or an approval of the spec would cover code that did not exist yet.

## How the code review is counted

It applies to a pull request that changes specs, whose spec vote has passed, and which holds code: at least one changed file outside the roadmap root that does not match `exempt_paths`. This is the phase spectree already calls `code`.

- **What counts.** Each person's latest review or command. "Approve" and `/spectree for` approve; "Request changes" and `/spectree against` are against; a dismissed review and `/spectree withdraw` are no vote.
- **Only on the head commit.** A review counts when the commit it was made on is the pull request's head. A command counts when it was written, or last edited, after the workflow first saw that head; the workflow keeps the time in its comment, next to the times it keeps for spec versions. So a push, a rebase and a merge of the default branch into the pull request all open the code review again.
- **Weights.** The same as for the vote: 1 with write access, 0 without, or the number in `ratings`.
- **The author.** Counts as one approval at their own weight when `review.count_author` is true, which is the default. A maintainer's own code passes with nobody else, as a maintainer's own spec does. An outsider has weight 0, so their code needs a maintainer. The author's own review or command is never counted, as in the vote.
- **Passing.** Weighted approvals at or above `review.threshold`, and no vote against with a weight above zero.
- **One review can do both.** When spec and code are pushed in one commit, `spectree/phase` fails with "Code before approval", as today. An approving review on that commit passes the spec vote; the same review is on the head commit, so the code review passes with it.
- **Taking over.** A pull request with `Implements: #n` inherits the spec approval of #n and nothing else. Its code needs its own review.

## Settings

```yaml
review:
  threshold: 1        # weighted approvals the code needs; 0 turns the code review off
  count_author: true  # the author counts as one approval, at their own weight
```

| You want | Set |
| --- | --- |
| One maintainer; their own code passes, outside code needs them | Nothing |
| Nobody merges their own code unread | `review.count_author: false` |
| Two maintainers read every change | `review.threshold: 2` |
| The behaviour before this spec | `review.threshold: 0` |

The default is on. A repository that follows `v1` gets the code review with its next run. Maintainers' own pull requests pass as before; an outside contributor's code now waits for a maintainer.

## What people see

- **The check.** The code review is part of `spectree/phase`, so a repository that already requires the three checks needs no new rule.

  | Situation | State | Description |
  | --- | --- | --- |
  | Code review open | pending | `Code review open: 0 of 1 needed for, 0 against` |
  | Code review passed | success | `Code phase: spec approved, code reviewed (1 for, 0 against)` |
  | `review.threshold: 0` | success | `Code phase: the spec is approved and frozen` (today's text) |

  "Only maintainers write the code" and "Code before approval" still fail first.
- **The comment.** Under the spec vote, a second table `Code review: open` or `Code review: passed`, with the same columns, the list of votes, and the line "Counted on commit `<sha>`. A new commit asks for the review again." The `Next` line reads "The spec is frozen. The code needs an approving review of the latest commit from someone whose vote has weight." while open, and "This pull request can merge." when passed.
- **`/spectree status`** needs no change: it repeats the phase check's text.
- **The command help** says that `/spectree for` and `against` are about the code once the spec is approved.
- **The roadmap page.** "In code review" lists a proposal while its code review is open, with `Code: 0 of 1 for, 0 against` in the votes column, under the spec vote, and the hint "Review the code: Approve on the latest commit, or comment `/spectree for`." When the review has passed, the proposal is under "Ready to merge". Each proposal in `roadmap.json` gains `review`: `null` outside the code phase, or `{ "for": 0, "against": 0, "needed": 1, "passed": false }`.

## What changes in the code

- `src/config.ts`: `review: { threshold: number; count_author: boolean }` in `Config` and `DEFAULTS`, read and checked like `demand`.
- `src/evaluate.ts`: `PrInput` gains `onHead: Record<string, boolean>`, which says for each command vote whether it was written on the current head. `evaluatePr` counts the code review with the existing `tally` function, given `review.threshold`, `review.count_author` and a limit of zero against. `PrResult` gains `review: Tally | null` (null outside the code phase and when the review is off) and the phase status and comment above.
- `src/run.ts`: records the first time it saw each head commit in the ledger it keeps for spec digests, and fills `onHead` from it.
- `src/commands.ts`: the help text.
- `src/dashboard.ts`: `nextOf` returns `merge` for a code-phase proposal whose review has passed; `DashPr` gains `review`; the votes column and the hint for the review step.
- Tests in a new file, `test/review.test.ts`. Four existing files change where they assume the old behaviour: `test/core.test.ts` and `test/run.test.ts` expect a green phase check for an outsider's code that nobody approved, and now give the approval; `test/commands.test.ts` reads the ledger, which gains the head commit; `test/layout.test.ts` reads the votes column, which gains the code line.
- `docs/` and `README.md` are updated in the same pull request; they need no spec.

## Not in this spec

- **Pull requests without a spec.** A change waived with the `no-spec` label, by `exempt_authors` or by `on_missing_spec: allow` gets no code review from spectree.
- **Exempt files.** A change to documentation or to `.github/**` inside a spec pull request does not start a code review by itself.
- **An approval that survives a rebase.** Any new head commit asks for the approval again.
- **Who wrote the commits.** The author is the pull request's author. A maintainer who pushes to a contributor's pull request and approves it has approved their own commits.
- **Code owners**, required reviewers per path, and review by an AI (`flow/ai-review`, proposed in #1).
- **A fourth check.** The result is reported in `spectree/phase`.
