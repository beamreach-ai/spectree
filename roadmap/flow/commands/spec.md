---
title: "Vote and act with a comment"
planned: next
---

A vote is a pull-request review: "Approve" is for, "Request changes" is against. That is exact and stored by GitHub, but a newcomer does not know that a review is a vote, a review needs the "Files changed" tab, and GitHub does not let an author review their own pull request. Mitchell Hashimoto's vouch shows the alternative: act with one comment where the conversation already is.

A comment on a spec pull request whose first line is a command:

| Comment | Effect |
|---|---|
| `/spectree for` | A vote for, the same as an approving review |
| `/spectree against <reason>` | A vote against, the same as "Request changes" |
| `/spectree withdraw` | Takes the commenter's vote back |
| `/spectree take` | On an approved spec: says the commenter will write the code, shown on the roadmap page |
| `/spectree status` | The workflow answers with the tally and what the pull request waits for |

Acceptance, to become criteria when this is built:

- A person has one vote: their latest review or command, whichever is newer.
- A command vote is reset by a change to the spec, as a review is.
- A command counts only as the first line of a comment, and an edited comment counts at its edit time.
- The workflow marks a command it acted on with a reaction, and answers an unknown command with the list.
- Weights apply to commands as they do to reviews.
- The signal workflow starts the main workflow on comments, with no permissions of its own.

Not in this spec: commands on issues, and commands that change the spec's text.
