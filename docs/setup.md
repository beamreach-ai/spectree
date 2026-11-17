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

If the repository already publishes a site with GitHub Pages, spectree's page would replace it. Set `dashboard.enabled: false` until spectree can publish under a path of an existing site.

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
on_missing_spec: fail             # fail, or close the pull request as well
dashboard:
  enabled: true
  path: ""                        # publish the page under this path
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

## 4. Make the checks binding (optional)

Until you do this, the checks report and do not block a merge.

In the repository settings, open **Branches** (or **Rules**), protect the default branch, and add these as required status checks:

- `spectree/spec`
- `spectree/phase`
- `spectree/scope`

Leave "Dismiss stale pull request approvals when new commits are pushed" off, or accept that GitHub's own review list will show the votes as dismissed during the code phase. The spec approval is not affected: it was recorded when the vote passed.

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

The workflow file points at the `v1` tag, which moves forward with compatible releases. Nothing to do.

## Removing

Delete the two workflow files. The `roadmap/` directory is plain Markdown and stays readable without spectree.
