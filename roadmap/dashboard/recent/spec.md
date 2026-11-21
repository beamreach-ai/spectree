---
title: "What changed lately"
planned: next
---

The page looks the same whether the project shipped ten specs last week or nothing in a year. A returning visitor cannot see what is new, and a newcomer cannot tell whether the project is alive.

A strip near the top, for the last 30 days: specs done, specs approved, specs newly proposed, each with its date and a link. Below it, one line on pace: specs done in the last 30 and 90 days.

Acceptance, to become criteria when this is built:

- "Done" comes from the merge that brought the spec to the default branch; "approved" from the approval record; "proposed" from the pull request's opening.
- The window is a setting, `recent_days`, 30 by default.
- With nothing in the window the strip says so in one line and takes no more space.
- The first import of a backlog (many planned specs in one merge) is shown as one entry, not hundreds.
- `roadmap.json` carries the same entries.

Not in this spec: a feed (RSS or Atom) and notifications.
