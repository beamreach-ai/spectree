---
title: "Open proposals as a queue of what waits for whom"
paths:
  - src/dashboard.ts
  - src/run.ts
  - src/config.ts
  - test/layout.test.ts
  - dist/**
criteria:
  - id: steps
    text: "Open spec pull requests are listed under the step they wait for, in the order: needs votes, needs a fix to the spec, approved and waiting for code, in code review, ready to merge. Each is under exactly one step, a step shows how many it holds, and a step with none is not shown."
    tests: [test/layout.test.ts]
  - id: oldest-first
    text: "Within a step, the pull request that has been in it longest is first."
    tests: [test/layout.test.ts]
  - id: age
    text: "A proposal shows how many days ago it was opened and, once its vote has passed, how many days it has been in its step, counted from the approval."
    tests: [test/layout.test.ts]
  - id: stale
    text: "A proposal in its step for more than `dashboard.stale_days` days, 30 unless set, is marked stale; `0` marks none."
    tests: [test/layout.test.ts]
  - id: many-specs
    text: "A proposal with more than three specs shows their number and the node they share, and opens to the list."
    tests: [test/layout.test.ts]
  - id: tally
    text: "The tally is shown in full while the vote is open and whenever someone other than the author voted; otherwise it reads `Approved`."
    tests: [test/layout.test.ts]
  - id: json
    text: "roadmap.json carries, for each proposal, when it was opened, since when it is in its step, both counts of days, and whether it is stale."
    tests: [test/layout.test.ts]
---

`Open proposals` is a table in the order of pull-request numbers. A maintainer comes to it to learn what waits for their vote, a contributor to find approved work nobody is building, and both read every row to find out. The table does not say how long anything has waited. A pull request that adds twenty specs prints twenty ids in one cell, and where the only voter is the author every row reads "1 of 1 for".

## What the page shows

The same table, cut into steps. Each step has a heading row with its name and how many pull requests it holds:

| Step | Who it waits for |
| --- | --- |
| Needs votes | voters |
| Needs a fix to the spec | the author |
| Approved, waiting for code | anyone who will write it |
| In code review | reviewers |
| Ready to merge | a maintainer |

- **Order inside a step:** longest in the step first; equal waits by number.
- **Age:** under the title, `by <author> · opened 12 days ago · 3 days in this step`. The time in the step is counted from the approval for the last three steps, where it differs from the opening; for the first two it is the age and is not repeated. Days are whole days; less than one is `today`.
- **Stale:** a red `stale` mark when the time in the step is more than the setting.
- **Specs:** up to three ids are listed. More become one line, `20 specs in integrations`, naming the deepest node all of them are under, that opens to the ids. With no shared node it reads `20 specs`.
- **Tally:** `1 of 1 for, 0 against` and the voters, as today, while the vote is open, the spec needs a fix, or anyone but the author has voted. In the last three steps, when the author's is the only vote, the cell reads `Approved`.

## The setting

```yaml
dashboard:
  stale_days: 30   # the default; 0 marks nothing as stale
```

A whole number, zero or more; anything else is an error in the settings.

## What changes in the code

- `run` in `src/run.ts` passes each pull request's opening time to the page.
- `buildData` adds `opened`, `since`, `days`, `days_in_step` and `stale` to each proposal. `since` is the time of the approval record for a proposal past its vote, and the opening otherwise.
- `renderHtml` renders the steps; `src/config.ts` reads the setting.
- Tests in a new file, `test/layout.test.ts`.

## Not in this spec

- A view of what waits for one person, which needs a signed-in visitor.
- The time a pull request entered code review: the page has the approval's time and no later one.
