---
title: Publish the roadmap page to Cloudflare Pages
paths:
  - src/config.ts
  - src/run.ts
  - src/index.ts
  - src/cli.ts
  - action.yml
  - .github/workflows/spectree.yml
  - docs/setup.md
  - test/**
  - dist/**
criteria:
  - id: default-github-pages
    text: "With no `dashboard.host`, the page is published with GitHub Pages, as before."
    tests: [test/core.test.ts]
  - id: cloudflare-config
    text: "`dashboard.host: cloudflare` needs `dashboard.project`, the Cloudflare Pages project; a missing project or an unknown host is reported as a config error."
    tests: [test/core.test.ts]
  - id: outputs
    text: "The action outputs the host and the project, and the reusable workflow deploys to the one that is set."
    tests: [test/run.test.ts]
  - id: init-secrets
    text: "spectree init passes CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to the reusable workflow, and no other secret."
    tests: [test/run.test.ts]
---

A GitHub Pages site from a private repository is public unless the owner pays for GitHub Enterprise Cloud. A private repository's roadmap is then either public or missing.

With `dashboard.host: cloudflare` the same page is deployed to a Cloudflare Pages project instead. Cloudflare Access in front of it can require a GitHub login, which keeps the page private without Enterprise Cloud.

```yaml
dashboard:
  host: cloudflare     # default: github-pages
  project: my-roadmap  # the Cloudflare Pages project
```

The deploy runs in its own job, which gets the Cloudflare token and nothing else, and never sees a pull request's code. The project is created on the first deploy if it does not exist.

Not in this spec: other hosts, and setting up Cloudflare Access, which the setup guide describes.
