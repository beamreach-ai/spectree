---
title: "Act on a spec from the roadmap page"
paths:
  - src/dashboard.ts
  - src/run.ts
  - src/cli.ts
  - test/act.test.ts
  - dist/**
criteria:
  - id: propose
    text: "The page has a `Propose a spec` link to the host's new-file form on the default branch, with the file name under the root and a template as its content. The template is a valid spec as it stands."
    tests: [test/act.test.ts]
  - id: in-default-branch
    text: "A spec in the default branch offers `Edit`, to the host's editor for its `spec.md`, and `Add a spec below`, to the new-file form under its directory. A planned leaf also offers `Build this`, to the same editor."
    tests: [test/act.test.ts]
  - id: in-pull-request
    text: "A spec that an open pull request adds offers `Edit`, to that pull request's files, and `Discuss`, to the pull request. An approved leaf waiting for code also offers `Take it`, which names `Implements: #n`."
    tests: [test/act.test.ts]
  - id: plain-links
    text: "Every action is a plain link to the repository on the server the run came from, on the repository's default branch; the page holds no token and its script calls nothing."
    tests: [test/act.test.ts]
---

The roadmap page can be read and not used. To propose a spec, change one or start building one, a person has to know where specs live, what a header looks like and how the pull-request flow goes. GitHub already has a form for each of these steps; the page does not link to any of them.

## What the page shows

- **Propose a spec**, a button under the page's title. It opens GitHub's new-file form on the default branch with the name `<root>/new-spec/spec.md` and this content:

  ```
  ---
  title: "What it does, in a few words"
  paths:
    - src/**
  criteria:
    - id: first
      text: "One thing that is true when this is built."
      tests: [test/first.test.ts]
  ---

  Why this is needed, in a paragraph.

  Not in this spec: what it leaves out.
  ```

  The person renames `new-spec`, fills it in, and GitHub's form ends in a pull request.
- **On a spec in the default branch**, at the end of what its row opens to:
  - `Edit`: GitHub's editor for the spec's file.
  - `Add a spec below`: the new-file form with the name `<root>/<id>/new-spec/spec.md` and the template.
  - `Build this`, on a planned leaf: the editor, with a tooltip that says what to change: remove `planned`, add `paths` and `criteria`.
- **On a spec that an open pull request adds:**
  - `Edit`: the pull request's files.
  - `Discuss`: the pull request.
  - `Take it`, on an approved leaf that waits for code: the pull request, with a tooltip that says the code goes there or in a pull request whose description says `Implements: #<n>`.
- The thread link, `Discuss or 👍`, is in `flow/demand`.

## What changes in the code

- `run` passes the default branch's name to the page; `spectree preview` uses `main`. `roadmap.json` carries it as `branch`.
- `renderHtml` and the detail of a node in `src/dashboard.ts`. The template is exported so that the test can check it with the parser.
- Tests in a new file, `test/act.test.ts`.

## Not in this spec

- Editing or voting inside the page, which needs a signed-in visitor and a server.
- Forges other than GitHub and GitHub Enterprise Server.
