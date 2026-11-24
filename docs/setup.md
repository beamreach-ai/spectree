# Setup

For maintainers. Attaching spectree to a repository takes about ten minutes.

## 1. Add the two workflow files

From a checkout of your repository:

```sh
npx github:beamreach-ai/spectree init
```

It creates:

| File | What it does |
|---|---|
| `.github/workflows/spectree.yml` | Calls spectree's reusable workflow. It counts votes, reports the checks and builds the roadmap page |
| `.github/workflows/spectree-signal.yml` | Does nothing, with no permissions. Its completion starts the first workflow after a review |

The second file exists because GitHub gives a read-only token to workflows started by a review on a pull request from a fork. That token cannot write the vote count. The signal workflow finishes, and its completion starts the main workflow with the permissions it needs.

`init` never overwrites a file that is already there. To add the files by hand, copy them from the output of `init` in an empty directory.

Commit both files and push them to your default branch.

## 2. Turn on the roadmap page

In the repository settings, open **Pages** and choose **GitHub Actions** as the source. The page appears at `https://<owner>.github.io/<repo>/` after the next run.

If you skip this step, the checks and the vote count still work. Only the page is missing.

To point visitors at the page, add a badge to the top of your README. It shows how many specs are done, how many proposals are open, and how many are waiting for votes:

```markdown
[![roadmap](https://img.shields.io/endpoint?url=https://<owner>.github.io/<repo>/badge.json)](https://<owner>.github.io/<repo>/)
```

If the repository already publishes a site with GitHub Pages, spectree's page would replace it. Set `dashboard.enabled: false` until spectree can publish under a path of an existing site.

### A private repository: Cloudflare Pages behind a GitHub login

A GitHub Pages site from a private repository is public, unless the owner is on GitHub Enterprise Cloud. Publish the page to Cloudflare Pages instead, and put Cloudflare Access in front of it.

1. In Cloudflare, create an API token with the permission **Account → Cloudflare Pages → Edit**. Add two repository secrets: `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID` (on the right of the account's overview page).
2. Check that `.github/workflows/spectree.yml` passes them. `init` writes this; add it by hand to a file from an older `init`:

   ```yaml
   jobs:
     spectree:
       uses: beamreach-ai/spectree/.github/workflows/spectree.yml@v1
       secrets:
         CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
         CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
   ```

3. In `.spectree.yml`:

   ```yaml
   dashboard:
     host: cloudflare
     project: acme-roadmap   # lowercase letters, digits and dashes
   ```

   The next run creates the project and publishes the page at `https://acme-roadmap.pages.dev`. Leave GitHub Pages off.
4. Make it private. In Cloudflare Zero Trust, add GitHub under **Settings → Authentication → Login methods**. Then add an application under **Access → Applications**: type **Self-hosted**, domain `acme-roadmap.pages.dev`, and a policy that allows the people who may see it, for example an **Include** rule on **GitHub organization** `acme`, or on their emails. Add a second application with the domain `*.acme-roadmap.pages.dev`, so that each deploy's own preview address is covered as well. Until this step is done, the page is public.

The deploy runs in a job of its own, which receives the two Cloudflare secrets and nothing else. A failed deploy is reported in the run and does not fail the checks.

### Vote buttons on the page

By default the page links to GitHub for every action. It can carry buttons instead: **For** and **Against** on a proposal that waits for votes, and **👍 Want this** on a spec. A press writes the same comment or thumbs-up on GitHub that the visitor could write by hand, as the visitor. Votes stay on GitHub, and no button approves code.

A static page cannot sign a visitor in to GitHub by itself, so this needs two things that you run:

1. **A sign-in service**: one Cloudflare Worker file, [`login/worker.js`](../login/worker.js). It stores nothing.
2. **A GitHub App** with read and write access to issues and pull requests, installed on the repository.

[`login/README.md`](../login/README.md) has the steps, about ten minutes in all. Then set the service's address:

```yaml
dashboard:
  sign_in: https://roadmap-login.acme.workers.dev
```

With the setting, the page carries a Content-Security-Policy: only its own script runs, and it reaches only GitHub's API and your service. The visitor's token stays in the browser tab, for at most eight hours. Read "Before you turn it on" in that README first if the repository's owner publishes other sites on the same `github.io` address.

## 3. Change the defaults (optional)

Add `.spectree.yml` to the root of the repository. Every key is optional, and these are the defaults:

```yaml
root: roadmap                     # where the spec tree lives
levels: [epic, task, subtask]     # names for depth 1, 2, 3 and deeper
implementation: contributors      # who may write code for an approved spec: contributors or maintainers
threshold: 1                      # weighted votes for that a spec needs
max_against: 0                    # weighted votes against that a spec survives
count_author: true                # the author counts as one vote for
ratings: {}                       # vote weight per user, e.g. {alex: 5}
exempt_paths: ["**/*.md", ".github/**"]             # changes here need no spec
exempt_authors: ["dependabot[bot]", "renovate[bot]"]
on_missing_spec: fail             # fail, close the pull request as well, or allow code without a spec
review:
  threshold: 1                    # weighted approvals the code needs, on its latest commit; 0 turns the code review off
  count_author: true              # the author of the code counts as one approval, at their own weight
dashboard:
  enabled: true
  path: ""                        # publish the page under this path
  host: github-pages              # or cloudflare, for a private repository (see section 2)
  project: ""                     # with host cloudflare: the Cloudflare Pages project
  collapse_over: 40               # with more specs than this, the page opens with its groups closed; 0 never closes them
  stale_days: 30                  # a proposal this long in one step is marked stale; 0 marks none
  recent_days: 30                 # the window of "Lately" on the page; 0 leaves it out
  sign_in: ""                     # the address of your sign-in service: puts vote buttons on the page (see section 2)
demand:
  enabled: true                   # count thumbs-up on a spec's thread as demand, and show it on the page
  top: 3                          # how many specs "Most wanted" lists; 0 hides it
```

The settings are read from the default branch. A pull request cannot change them for itself.

### Who decides

| You want | Set |
|---|---|
| One maintainer decides alone | Nothing. A maintainer's own spec passes on their own vote |
| A second maintainer must agree | `threshold: 2` |
| One maintainer's objection does not block | `max_against: 1` |
| A trusted contributor's vote counts | `ratings: {their-login: 1}` |
| Only maintainers write code; outsiders write specs | `implementation: maintainers` |

### Who approves the code

The spec vote decides whether the project wants a change. The code then needs its own approval, counted on the latest commit of the pull request.

| You want | Set |
|---|---|
| One maintainer: your own code passes, outside code needs your approval | Nothing |
| Nobody merges their own code unread | `review.count_author: false` |
| Two maintainers read every change | `review.threshold: 2` |
| No code review by spectree | `review.threshold: 0` |

A pull request that needs no spec (the `no-spec` label, `exempt_authors`, only exempt files) gets no code review from spectree.

## 4. Make the checks binding (optional)

Until you do this, the checks report and do not block a merge.

In the repository settings, open **Branches** (or **Rules**), protect the default branch, and add these as required status checks:

- `spectree/spec`
- `spectree/phase`
- `spectree/scope`

You do not need GitHub's own "Require approvals" rule: `spectree/phase` waits for the code review, and it can count a sole maintainer's own code, which GitHub's rule cannot. If you turn on "Dismiss stale pull request approvals when new commits are pushed", GitHub's review list shows the votes as dismissed during the code phase. The spec approval is not affected: it was recorded when the vote passed.

## 5. Add your first spec

Open a pull request that adds one file, for example `roadmap/search/spec.md`:

```markdown
---
title: Search
kind: group
---

What search should become.
```

A group only organises its children, so it needs no code and can merge when the vote passes. A leaf, the default kind, describes a change to the code. See [contributing-with-specs.md](contributing-with-specs.md) for the leaf format.

### Bringing an existing project in

- **Features you already built:** write each as a leaf whose criteria name tests that exist. Such a leaf merges without code and shows as done.
- **While you try it:** set `on_missing_spec: allow`. Pull requests without a spec pass as before, and pull requests with a spec get the vote and the checks.
- **Your backlog:** write each item as a leaf with `planned: now`, `planned: next` or `planned: later`. It needs only a title and shows as planned.

Check the tree locally at any time:

```sh
npx github:beamreach-ai/spectree validate
npx github:beamreach-ai/spectree tree
```

## Small fixes without a spec

A pull request needs no spec when:

- every file it changes matches `exempt_paths`;
- its author is in `exempt_authors`;
- a maintainer adds the label `no-spec`.

## Updating

Voting with a comment (`/spectree for`) needs the signal workflow to run on comments. `spectree init` writes it that way since November 2026. A repository set up before that adds these lines under `on:` in `.github/workflows/spectree-signal.yml`, or runs `spectree init` again:

```yaml
  issue_comment:
    types: [created, edited]
```

The code review arrived in November 2026 and is on by default. Maintainers' own pull requests pass as before; an outside contributor's code now waits for a maintainer's approval on its latest commit. `review.threshold: 0` brings the earlier behaviour back.

The workflow file points at the `v1` tag. The tag moves by itself to every commit on spectree's main branch that passes its tests, so a change to the checks or to the roadmap page reaches your repository with its next run. Nothing to do.

## Removing

Delete the two workflow files. The `roadmap/` directory is plain Markdown and stays readable without spectree.
