# The sign-in service

The roadmap page is a static file. To put **For**, **Against** and **👍 Want this** buttons on it, the page needs the visitor's GitHub token, and GitHub gives one only to a server that holds an application's secret. This directory is that server: one Cloudflare Worker, [`worker.js`](worker.js), with no dependencies.

It turns GitHub's sign-in into a token for the page and does nothing else. It never sees a vote, has no storage, and writes nothing to its log. Whoever runs it could change it to keep tokens, so run your own, and read the file first; it is about 170 lines.

Without it the roadmap page works as before, with links to GitHub in place of buttons.

## What you need

- A Cloudflare account. The free plan is enough.
- The right to register a GitHub App for the repository's owner.

## 1. Deploy the Worker

```sh
cp -r login my-login && cd my-login        # or work in a copy of this directory
# edit wrangler.toml: name, and ALLOWED_PAGES = the address of your roadmap page, with the slash at the end
npx wrangler deploy
```

Wrangler prints the address, for example `https://roadmap-login.acme.workers.dev`. Until step 3 it answers every request with "not set up".

## 2. Register the GitHub App

Under the owner's **Settings → Developer settings → GitHub Apps → New GitHub App**:

| Setting | Value |
| --- | --- |
| Homepage URL | The roadmap page |
| Callback URL | `<the Worker's address>/callback` |
| Expire user authorization tokens | On |
| Request user authorization (OAuth) during installation | Off |
| Webhook | Not active |
| Repository permissions | **Issues**: Read and write. **Pull requests**: Read and write. Nothing else |
| Where can this GitHub App be installed? | Only on this account |

Create it, then **Install App** on the repository, and only on that repository. Copy the **Client ID** and generate a **client secret**.

A token from this App can comment, react and review as the visitor, in the repositories where the App is installed, for eight hours. It cannot read or push code.

## 3. Give the Worker its settings

```sh
# in wrangler.toml: GITHUB_CLIENT_ID = "<the Client ID>"
npx wrangler secret put GITHUB_CLIENT_SECRET     # paste the client secret
openssl rand -base64 48 | npx wrangler secret put SIGNING_SECRET
npx wrangler deploy
```

| Setting | Meaning |
| --- | --- |
| `GITHUB_CLIENT_ID` | The App's client id |
| `GITHUB_CLIENT_SECRET` | The App's client secret. A secret |
| `SIGNING_SECRET` | Signs the state and encrypts the ticket. A secret. Changing it ends sign-ins that are under way and nothing else |
| `ALLOWED_PAGES` | The roadmap pages the service serves, separated by spaces. A page whose path ends in `/` covers what is below it |
| `GITHUB_URL` | Optional. A GitHub server of your own; the default is `https://github.com` |

## 4. Turn the buttons on

In `.spectree.yml` on the default branch:

```yaml
dashboard:
  sign_in: https://roadmap-login.acme.workers.dev
```

The page has the buttons after its next rebuild.

## How a sign-in goes

| Route | Does |
| --- | --- |
| `GET /start?return=<page>&challenge=<c>` | Checks `return` against `ALLOWED_PAGES` and redirects to GitHub, with a signed state that holds the page, the challenge and the time |
| `GET /callback?code=…&state=…` | Checks the state's signature and that it is at most ten minutes old, exchanges the code for the visitor's token, and redirects to the page with `#spectree-ticket=<ticket>`: the token, encrypted |
| `POST /token` with `{ticket, verifier}` | Returns `{token, expires_at}` when the ticket is at most one minute old and the SHA-256 of `verifier` is the challenge. Answers only the origins of `ALLOWED_PAGES` |

The page makes the verifier and keeps it in the tab; the service sees only its hash until the last step. So what travels in an address is never the token, and a ticket copied from an address is useless without the tab that started the sign-in.

## Before you turn it on

- **A maintainer's token can decide a vote.** The page carries a Content-Security-Policy that lets only its own script run and lets it reach only GitHub's API and this service. Spec text from strangers is escaped before it reaches the page.
- **GitHub Pages shares one origin per owner.** Every project site of `acme` is on `acme.github.io`, and the token is in `sessionStorage`, which another site on that origin could read in the same tab. If the owner publishes pages it does not control, give the roadmap page a custom domain, or publish it with `dashboard.host: cloudflare`.
- **To take it away**, remove `dashboard.sign_in`; to end every session at once, revoke the App's user tokens in its settings.
