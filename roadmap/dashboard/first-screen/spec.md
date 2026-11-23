---
title: "A first screen for a newcomer and a fresh repository"
paths:
  - src/dashboard.ts
  - test/layout.test.ts
  - dist/**
criteria:
  - id: steps
    text: "The page opens with three steps, Propose, Vote and Build, that say where specs live, how to vote, the vote a spec needs, and that the code follows in the same pull request, with a link to the guide."
    tests: [test/layout.test.ts]
  - id: closed
    text: "The steps can be closed, and the page's script keeps that in the browser's own storage under `spectree-how` and nowhere else."
    tests: [test/layout.test.ts]
  - id: empty
    text: "A repository with no specs and no open proposal shows what a spec is and the two commands that check a tree, and no overview, no proposals and no search."
    tests: [test/layout.test.ts]
  - id: proposals-only
    text: "A repository with no specs and an open proposal shows the proposal."
    tests: [test/layout.test.ts]
---

The page opens with one paragraph of seven sentences on how the project takes changes. A newcomer has to read all of it to find the one thing they came for, and a returning visitor scrolls past it every time. On a repository that has just adopted spectree the rest of the page is an empty table and the words "No specs yet".

## What the page shows

- **Three steps** in place of the paragraph, side by side, stacked on a narrow screen:
  1. **Propose.** Every change starts as a spec under the root, proposed in a pull request.
  2. **Vote.** Approve is for, Request changes is against; the votes a spec needs, from the settings; who weighs what.
  3. **Build.** After the vote the code is added to the same pull request.

  Under them, the link to the guide. The words are the paragraph's, unchanged.
- **Closing them.** The steps sit under a heading, "How changes are made here", that closes and opens them. The page remembers a visitor's choice in the browser's local storage, key `spectree-how`. Nothing is sent anywhere, and with scripts off the steps are open.
- **A fresh repository**, with no specs in the default branch and no open spec pull request: under `Specs`, what a spec is in two sentences, and

  ```
  npx github:beamreach-ai/spectree validate
  npx github:beamreach-ai/spectree tree
  ```

  The overview, `Open proposals` and the search are left out, because there is nothing for them to show.

## What changes in the code

- `renderHtml` in `src/dashboard.ts`: the steps, the empty state, and a few lines added to the page's one script.
- Tests in a new file, `test/layout.test.ts`. That nothing scrolls sideways at 390 px is checked by hand with `spectree preview`.

## Not in this spec

- A button that opens GitHub's form for a new spec; that is `dashboard/actions`.
- Translations of the page.
