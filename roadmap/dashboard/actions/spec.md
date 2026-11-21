---
title: "Act on a spec from the roadmap page"
planned: next
---

The page can be read and not used. To propose a spec, change one, discuss one or start building one, a person has to know the directory layout, the header format and the pull-request flow. Each of these is a link GitHub already supports.

At the top of the page: **Propose a spec**. It opens GitHub's new-file form under the root, with a template of the header and the body.

On every spec:

- **Edit**: GitHub's edit form for its `spec.md`, which ends in a pull request. For a spec in an open pull request, the link goes to that pull request's file.
- **Discuss**: the spec's thread (`flow/demand`), or the pull request while the spec is in one.
- **Add a spec below**: the new-file form under this node, with the template.
- **Build this**, on a planned leaf: the edit form with a note on what to change (remove `planned`, add `paths` and `criteria`).
- **Take it**, on an approved spec waiting for code: how to open a pull request with `Implements:`.

Acceptance, to become criteria when this is built:

- Every link is a plain URL to the repository's host; the page holds no token and makes no API call.
- The template passes `spectree validate` once its placeholders are filled.
- Actions that do not apply to a spec's status are not shown.
- Links use the server URL of the run, so they work on GitHub Enterprise Server.

Not in this spec: editing or voting inside the page itself, which would need a signed-in visitor and a server.
