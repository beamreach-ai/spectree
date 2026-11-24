---
title: "Vote from the roadmap page"
paths:
  - src/config.ts
  - src/dashboard.ts
  - src/act.ts
  - login/**
  - test/sign-in.test.ts
  - dist/**
criteria:
  - id: setting
    text: "`dashboard.sign_in` is the address of a sign-in service, an https URL. It is empty by default, and with it empty the page has no sign-in link, no buttons and no script for them, and is byte for byte what it is today."
    tests: [test/sign-in.test.ts]
  - id: buttons
    text: "With `dashboard.sign_in` set, a proposal that waits for votes has the buttons `For` and `Against`, and a spec that has a thread or an open pull request has the button `👍 Want this`. No other step of a proposal has a button, and the code review has none."
    tests: [test/sign-in.test.ts]
  - id: writes
    text: "`For` posts the comment `/spectree for` on the proposal's pull request, `Against` asks for a reason and posts `/spectree against <reason>`, and `Want this` adds a thumbs-up to the spec's thread, or to the pull request of a spec that is only proposed. Each is one request from the visitor's browser to the GitHub API with the visitor's own token."
    tests: [test/sign-in.test.ts]
  - id: signed-out
    text: "A visitor who is not signed in and presses a button is sent to the sign-in service and comes back to the same address, filters and anchor included; the button is not pressed for them."
    tests: [test/sign-in.test.ts]
  - id: who
    text: "A signed-in visitor sees their login and `Sign out`. A proposal they have voted on says `You voted for` or `You voted against`, read from the votes the page already lists."
    tests: [test/sign-in.test.ts]
  - id: feedback
    text: "After a write the button is replaced by `Sent as @login`, with a link to the comment for a vote, and the note that the page shows it after its next rebuild. A write that GitHub refuses shows GitHub's message and leaves the button."
    tests: [test/sign-in.test.ts]
  - id: token-handling
    text: "The token is kept in `sessionStorage` and nowhere else, is never put in an address, and is removed by `Sign out` and when GitHub answers 401."
    tests: [test/sign-in.test.ts]
  - id: csp
    text: "With `dashboard.sign_in` set, the page carries a Content-Security-Policy that allows its one inline script by hash, connections only to the GitHub API and the sign-in service, and no other script, frame, form target or base address."
    tests: [test/sign-in.test.ts]
  - id: service-flow
    text: "The sign-in service has three routes. `/start` redirects to GitHub with a signed state that holds the return address and the visitor's challenge. `/callback` exchanges GitHub's code for a user token and redirects back with a ticket, the token encrypted. `/token` returns the token for a ticket and the verifier whose SHA-256 is the challenge."
    tests: [test/sign-in.test.ts]
  - id: service-refuses
    text: "The service refuses a return address that is not in its list of allowed pages, a state it did not sign or that is older than ten minutes, a ticket older than one minute, and a verifier that does not match. It answers cross-origin requests only from the allowed pages, stores nothing, and never writes a token or a ticket to its log."
    tests: [test/sign-in.test.ts]
---

To vote on a spec today, a visitor leaves the roadmap page, finds the pull request, and either opens "Files changed" to give a review or knows to type `/spectree for`. To say they want a spec, they open its thread and find the reaction menu. The page shows the tally and stops there.

This spec puts the buttons on the page. It does not move the votes anywhere: a press writes the same comment or reaction on GitHub that the visitor could have written by hand, as the visitor. GitHub stays the only place votes are stored, and the checks keep reading only GitHub.

## Why it needs a service

The page is a static file. To write to GitHub as the visitor it needs the visitor's token, and GitHub hands one out only to a server that holds an application's secret; it also does not answer a browser's request on that route. So one small piece runs outside the repository: a **sign-in service** that turns GitHub's sign-in into a token for the page. It does nothing else. It never sees a vote, and it stores nothing.

A project that does not run the service sets nothing and loses nothing: the page is what it is today.

## The parts

### 1. A GitHub App, registered by the project

| Setting | Value |
| --- | --- |
| Callback URL | `<sign-in service>/callback` |
| Repository permissions | Issues: read and write. Pull requests: read and write. Nothing else |
| Expire user authorization tokens | On (GitHub's eight hours) |
| Installed on | The repository |

A token from this App can do, as the visitor, what the App's permissions and the visitor's own rights both allow, in the repositories where the App is installed: comment, react, and review. It cannot read or push code.

### 2. The sign-in service, `login/`

A Cloudflare Worker in one file, `login/worker.js`, with `login/README.md` on how to deploy it. Its settings are the App's client id and secret, a signing secret, and `ALLOWED_PAGES`, the list of roadmap page addresses it serves.

| Route | Does |
| --- | --- |
| `GET /start?return=<page address>&challenge=<c>` | Checks `return` against `ALLOWED_PAGES`. Redirects to GitHub's authorization page with a state that holds `return`, `challenge` and the time, signed with HMAC-SHA-256 |
| `GET /callback?code=<code>&state=<state>` | Checks the state's signature and that it is at most ten minutes old. Exchanges the code for a user token. Redirects to `return` with `#spectree-ticket=<ticket>`. The ticket is the token, its expiry and the challenge, encrypted with AES-GCM under the signing secret |
| `POST /token` with `ticket` and `verifier` | Decrypts the ticket, checks that it is at most one minute old and that SHA-256 of `verifier` is its challenge, and returns `{token, expires_at}`. Answers only the origins of `ALLOWED_PAGES` |

The challenge and verifier are made by the page, per sign-in. They are why the token never appears in an address: what comes back in the address is a ticket that is useless without the verifier, which stays in the tab that started the sign-in.

### 3. The setting

```yaml
dashboard:
  sign_in: https://roadmap-login.acme.workers.dev   # empty: no buttons
```

Anything that is not an https URL is reported and ignored.

### 4. The page

- **Top right:** `Sign in with GitHub`, or `@login · Sign out`.
- **Open proposals, under "Needs votes":** `For` and `Against` beside today's hint. `Against` asks for a reason in a prompt and does nothing when it is left empty.
- **In the tree:** `👍 Want this` in a spec's action line, where `Discuss or 👍` is today. A spec with neither a thread nor a pull request keeps `Start its thread`.
- **No button approves code.** "In code review" keeps its link to the pull request's files. An approval of code should come from someone looking at the code.
- **After a press:** the button becomes `Sent as @login`, linking to the comment. The tally on the page changes when the workflow rebuilds it: within minutes for a vote, because a comment starts the workflow, and at the next run for a thumbs-up, because GitHub has no event for a reaction.
- **Signed out:** a press starts the sign-in and returns to the same address. The visitor presses again; nothing is sent without a press made while signed in.
- **The script** is in a new file, `src/act.ts`, built like `src/find.ts`: functions that are tested directly, and one function that returns the text of the inline script. It is added to the page only when `dashboard.sign_in` is set.

## Security

This feature puts a token that can vote into a web page, so the limits are part of the spec.

- **What a stolen token can do.** Comment, react and review as the visitor on the repositories where the App is installed, for at most eight hours. For a maintainer that includes a vote that decides. It cannot touch code.
- **The page's own content.** Spec text in open pull requests is written by strangers. It is already escaped (`dashboard/spec-view`, criterion `no-html`). The Content-Security-Policy is the second barrier: a script that got into the page would not run, and could not send a token anywhere but GitHub and the sign-in service.
- **Where the token lives.** `sessionStorage`: one tab, gone when it closes. On GitHub Pages all of an owner's project sites share one origin, `owner.github.io`, so another site of the same owner could read it in the same tab. A project that publishes untrusted content there should use a custom domain or the Cloudflare host for its roadmap page before it turns this on.
- **The service.** It can be used only from the pages in `ALLOWED_PAGES`, a state cannot be forged or replayed after ten minutes, and a ticket caught from an address is useless without the verifier and after one minute.
- **Trust.** Whoever runs the service could change it to keep tokens. That is why each project runs its own, and why the source is one file.

## What changes in the code

- `src/config.ts`: `dashboard.sign_in`, a string, checked as an https URL.
- `src/act.ts`, new: the page's sign-in and buttons. `actScript(signIn, repository)` returns the inline script; the request each button makes, the challenge, and the handling of answers are functions of their own.
- `src/dashboard.ts`: the sign-in link, the buttons, `data-` attributes they read (the pull request's number, the thread's number), and the Content-Security-Policy with the script's hash.
- `login/worker.js`, new: `handle(request, env, fetch)`, which the tests call with a fake GitHub. `login/README.md` and `login/wrangler.toml`.
- Tests in a new file, `test/sign-in.test.ts`.
- `docs/setup.md` gets a section on registering the App and deploying the service.

## Not in this spec

- **A shared sign-in service** run by spectree for every project.
- **Votes kept outside GitHub**, and votes by people without a GitHub account.
- **Approving code from the page.**
- **A vote on a spec that has no open pull request.** A planned spec can be wanted with a thumbs-up, as today.
- **Starting a thread from the page**; it stays a link to GitHub's form.
- **Live tallies.** The page shows what the last run of the workflow saw.
- **Turning it on for spectree's own page.** That needs an App and a deployed service, and is a decision for after this merges.
