# spectree

Specs as a tree in your repository. A contribution starts as a spec, people vote on it, and code is accepted only for a spec that passed the vote. Spec and code merge together, in one pull request.

## Why

AI made code cheap. Open-source maintainers now get more pull requests of lower quality, written from partial context or from no spec at all, while their time shrinks. Reading a 600-line pull request to find out the project never wanted the feature is the expensive way to say no.

A spec is short. With spectree the maintainer first reads what a change is meant to do and decides on that. Code is reviewed only for changes the project already agreed to, and a check confirms the code stays inside what the spec allowed.

## How it works

```
1. Spec phase     A pull request adds roadmap/<feature>/spec.md and nothing else.
2. Vote           "Approve" is a vote for. "Request changes" is a vote against.
3. Approval       The vote passes. The spec is frozen.
4. Code phase     Code is pushed to the same pull request and reviewed as usual.
5. Merge          Spec and code reach the default branch together.
```

- **The roadmap is a directory tree.** Every directory under `roadmap/` with a `spec.md` is a node: epics, tasks, subtasks, to any depth.
- **Votes are pull-request reviews**, or a comment that says `/spectree for` or `/spectree against`. GitHub stores them. Maintainers' votes have weight 1 and everyone else's have weight 0 by default, so outside votes are visible and maintainers decide.
- **Three checks** report on every pull request:
  - `spectree/spec`: is there an approved spec?
  - `spectree/phase`: is code arriving only after approval?
  - `spectree/scope`: does the code stay inside the paths the spec named, and does every acceptance criterion name a test that exists?
- **A roadmap page** on GitHub Pages shows every spec as done, in progress, approved, proposed or planned. It opens with an overview by area and horizon and what changed lately, lists open proposals by what they wait for, and can be searched and filtered. Each spec opens to its whole text and links to GitHub's forms to edit it, build it or propose one below it.
- **Demand is separate from the vote.** Anyone can add a 👍 to a spec's thread; the page shows the count and the most wanted specs. It never changes a vote.
- **No status is stored in any file.** It is worked out from the default branch and the open pull requests, so it cannot go stale.

## Add it to your repository

```sh
npx github:beamreach-ai/spectree init
```

This writes two small workflow files. Commit them, turn on GitHub Pages with "GitHub Actions" as the source, and open your first spec pull request. Everything has a default; a `.spectree.yml` changes them. The full steps are in [docs/setup.md](docs/setup.md).

## A spec

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
---

Why this is needed, what it does, and what it does not do.
```

## Documentation

- [Setup](docs/setup.md): for maintainers. Attaching it, the settings, making the checks required.
- [Contributing with specs](docs/contributing-with-specs.md): for contributors. Proposing, voting, adding code, taking over an approved spec.
- [How it works](docs/how-it-works.md): status rules, the approval record, the security model.
- [SPEC.md](SPEC.md): the design of version 1.

## This repository uses it

spectree's own features are specs under [roadmap/](roadmap/).

## Status

Version 0.1. The rules are covered by tests that run the whole flow against a simulated GitHub. It has not yet run on a live repository; the first one will be this repository.

## Origin

The idea came out of an open-space session on the challenges of open source at DevOpsDays Barcelona 2026.

## Licence

Apache 2.0.
