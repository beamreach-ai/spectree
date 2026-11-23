---
title: "What changed lately"
paths:
  - src/dashboard.ts
  - src/run.ts
  - src/github.ts
  - src/config.ts
  - test/recent.test.ts
  - dist/**
criteria:
  - id: entries
    text: "The page lists what changed in the last `dashboard.recent_days` days, newest first: specs that reached the default branch, done or planned as they are today, proposals whose vote passed, and proposals opened. Each line has its date, its kind, a title and a link."
    tests: [test/recent.test.ts]
  - id: one-line-per-commit
    text: "A commit that brought many specs is one line per kind, with the commit's title and the number of specs; a commit that brought one spec is titled with the spec."
    tests: [test/recent.test.ts]
  - id: built
    text: "A planned leaf counts as done on the day a commit removed `planned` from it."
    tests: [test/recent.test.ts]
  - id: pace
    text: "Under the list the page says how many specs were done in the last 30 and the last 90 days."
    tests: [test/recent.test.ts]
  - id: quiet
    text: "With nothing in the window the section is one line that says so, with the pace."
    tests: [test/recent.test.ts]
  - id: setting
    text: "`dashboard.recent_days` is 30 unless set; `0` leaves the section out and reads no commits. When the commits cannot be read the section is left out and the rest of the page is built."
    tests: [test/recent.test.ts]
  - id: json
    text: "roadmap.json carries the same entries and the pace."
    tests: [test/recent.test.ts]
---

The roadmap page looks the same whether the project finished ten specs last week or nothing in a year. A returning visitor cannot see what is new since they last looked, and a newcomer cannot tell whether anybody is working on it.

## What the page shows

A section `Lately`, under the overview:

```
Nov 22  Done      Search, filters and links into the roadmap
Nov 21  Planned   Import the backlog            28 specs
Nov 20  Approved  Spec: drafts
Nov 18  Proposed  Spec: a badge for the README

Specs done: 4 in the last 30 days, 9 in the last 90.
```

- **Done** and **Planned**: a commit on the default branch added the spec's file. The kind is what the spec is today: done, or planned and not built. A commit that removed `planned` from a leaf made it done on that day.
- **Approved**: an open pull request whose vote has passed, dated by the approval.
- **Proposed**: an open pull request still in its vote, dated by its opening. A pull request has one line, for the state it is in.
- **One commit, one line** per kind. If it brought one spec, the line is that spec's title; if more, the commit's first line and `28 specs`. Importing a backlog is one line.
- At most eight lines are shown, then `And 5 more in the last 30 days.`
- **Pace**: specs done in the last 30 and 90 days, whatever the window.
- **Nothing in the window**: `Nothing changed in the last 30 days.` and the pace, on one line.
- Dates are the commit's, the approval's and the pull request's own; nothing is stored in the repository.

## The setting

```yaml
dashboard:
  recent_days: 30   # the default; 0 leaves the section out
```

## What changes in the code

- `src/github.ts`: the commits on the default branch that touched the root since a date, and one commit's files.
- `run` reads the commits of the last 90 days, or of the window if longer, at most the 60 newest, and for each the spec files it added and the leaves it removed `planned` from. `spectree preview` has no commits to read and shows no section.
- `buildData` builds `recent` and `pace`; `renderHtml` the section; `src/config.ts` the setting.
- Tests in a new file, `test/recent.test.ts`.

## Not in this spec

- Specs removed, and proposals closed without merging.
- A feed, and notifications.
- Charts over time.
