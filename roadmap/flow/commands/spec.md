---
title: "Vote and act with a comment"
paths:
  - src/commands.ts
  - src/run.ts
  - src/github.ts
  - src/cli.ts
  - src/dashboard.ts
  - test/commands.test.ts
  - dist/**
criteria:
  - id: parse
    text: "A comment is a command when its first line is `/spectree` and a word: `for`, `against`, `withdraw`, `take` or `status`, in any case. Any other word is an unknown command, and `/spectree` later in a comment is not a command."
    tests: [test/commands.test.ts]
  - id: votes
    text: "`/spectree for` counts as an approving review, `/spectree against` as a review that requests changes, and `/spectree withdraw` takes the commenter's vote back. Weights apply as they do to reviews."
    tests: [test/commands.test.ts]
  - id: latest
    text: "A person has one vote: their latest review or command, whichever is newer. An edited comment counts from its edit."
    tests: [test/commands.test.ts]
  - id: reset
    text: "A command counts only if it was written after the workflow first saw the spec as it is now, so a change to the spec resets command votes as it resets reviews. The time is kept in the workflow's comment and is never a commit's date."
    tests: [test/commands.test.ts]
  - id: take
    text: "`/spectree take` names the commenter as the one who will write the code; the roadmap page shows it on a proposal that waits for code, and `/spectree withdraw` by the same person takes it back."
    tests: [test/commands.test.ts]
  - id: answer
    text: "The workflow marks a command it acted on with a reaction, answers `/spectree status` with the three checks' texts, and answers an unknown command with the list of commands; each once."
    tests: [test/commands.test.ts]
  - id: signal
    text: "The signal workflow that `spectree init` writes runs on comments as well as on reviews, with no permissions."
    tests: [test/commands.test.ts]
---

A vote is a pull-request review: Approve is for, Request changes is against. GitHub stores it and ties it to a commit, which is why spectree uses it. A newcomer does not know that a review is a vote, and has to find the "Files changed" tab to give one. Mitchell Hashimoto's vouch shows another way in: one comment, where the conversation already is.

## The commands

A comment on a spec pull request whose first line is one of:

| Comment | Effect |
| --- | --- |
| `/spectree for` | a vote for, the same as an approving review |
| `/spectree against <reason>` | a vote against, the same as "Request changes" |
| `/spectree withdraw` | takes the commenter's vote back, and their `take` |
| `/spectree take` | says the commenter will write the code of the approved spec |
| `/spectree status` | the workflow answers with the texts of its three checks |

Anything after the first line is ordinary comment text.

## How a command vote is counted

- **Same rules as a review.** A command vote goes through the same count: one vote per person, their latest; the author's own vote is counted by `count_author` and not by a command; weights come from write access and `ratings`.
- **Reviews and commands together.** The newer of a person's latest review and latest command is their vote. `/spectree withdraw` after an approving review leaves that person with no vote.
- **A change to the spec resets it.** A review is tied to a commit, and counts while the spec at that commit is the spec now. A comment is tied to nothing, so the workflow keeps, in its own comment on the pull request, the time it first saw each version of the spec (the digest of the spec files). A command counts for the current version only if it was written, or last edited, after that time. Votes made on an earlier text do not carry over. If the spec returns to an earlier version, the votes made on that version count again, as reviews do.
- **No commit dates.** Both times come from GitHub's record of the comment and from the workflow's own clock. A commit's date is set by its author and is not used.
- **A narrow gap.** A command written in the seconds between a push that changes the spec and the workflow's run for that push is not counted, because the workflow cannot tell which text it was made on. It gets no mark; writing it again counts.

## What the workflow answers

- A vote that counts, a `take` and a `withdraw` get an 👀 reaction on the comment.
- `/spectree status` gets a reply: the descriptions of `spectree/spec`, `spectree/phase` and `spectree/scope`.
- An unknown command gets a reply with the table of commands and a 😕 reaction.
- A comment that already carries one of these reactions is not answered again.

## On the roadmap page

- A proposal that waits for code shows `Taken by @name`.
- The hint under "Votes" names the two vote commands next to the review.

## The signal workflow

Comments, like reviews, cannot start a workflow that may write when the pull request comes from a fork. The signal workflow, which has no permissions and does nothing, now also runs on `issue_comment` (created, edited); its completion starts the main workflow as before. `spectree init` writes the new file, and this repository's own copy changes with it. A repository that set spectree up earlier adds the two lines by hand or runs `spectree init` again; until then commands are counted at the next push, review or daily run.

## What changes in the code

- `src/commands.ts`, new: `parseCommand`, `commandReviews`, `sawDigest`, `countsNow`, `takenBy`.
- `run` in `src/run.ts`: reads commands from the comments it already fetches, adds them to the reviews, keeps the first-seen times in its comment, and answers.
- `src/github.ts`: adding a reaction to a comment.
- `src/cli.ts` and `.github/workflows/spectree-signal.yml`: the trigger.
- `src/dashboard.ts`: `Taken by`, and the hint.
- Tests in a new file, `test/commands.test.ts`.

## Not in this spec

- Commands on issues, and commands that change a spec's text.
- Running the main workflow only for comments that are commands; it runs on every comment.
- A `take` that expires.
