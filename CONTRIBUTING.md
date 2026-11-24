# Contributing to spectree

spectree is built with spectree, so a change here starts as a spec, not as code.

1. **Propose a spec.** Open a pull request that adds or changes a `spec.md` under `roadmap/` and nothing else. The [roadmap page](https://beamreach-ai.github.io/spectree/) has a "Propose a spec" button that opens the form with a template.
2. **The vote.** Maintainers vote with a review, or with a comment `/spectree for` or `/spectree against`. Anyone may vote; a maintainer's vote decides.
3. **Add the code** to the same pull request once the vote has passed. Stay inside the `paths` of your spec and add the tests its criteria name.
4. **The code review.** The code needs a maintainer's approval on its latest commit.

The full guide, with the spec format, is [docs/contributing-with-specs.md](docs/contributing-with-specs.md).

## What needs no spec

Documentation (`*.md`) and files under `.github/`. For another small fix, open the pull request and ask for the `no-spec` label.

## To say you want something

You do not have to write anything. Open a spec on the roadmap page, follow its thread, and add a 👍. The page lists the most wanted specs.

## Working on the code

```sh
npm ci
npm test
npm run typecheck
npm run build     # dist/ is committed; CI fails when it is out of date
```

CI uses Node 24. The tests are TypeScript files that Node runs directly.
