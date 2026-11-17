import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { main as cli, signal, workflow } from "../src/cli.ts";
import type { GitHub } from "../src/github.ts";
import { run } from "../src/run.ts";

const LEAF = `---
title: Incremental indexing
paths: [src/index/**, tests/index/**]
criteria:
  - id: only-changed
    text: Only changed files are re-indexed.
    tests: [tests/index/test_incremental.py]
---
Why and what.
`;
const GROUP = `---\ntitle: Search\nkind: group\n---\n`;
const SPEC = "roadmap/search/incremental/spec.md";

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "spectree-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** A GitHub that lives in memory. Pull requests are plain objects the test changes between sweeps. */
function fakeGitHub(pulls: any[]) {
  const state = { comments: new Map<number, any[]>(), statuses: new Map<string, any[]>(), nextId: 1, writes: [] as string[] };
  const find = (n: number) => pulls.find((p) => p.number === n);
  const gh = {
    owner: "acme", repo: "engine",
    openPulls: async () => pulls.filter((p) => p.state !== "closed"),
    pullFiles: async (n: number) => find(n).files,
    reviews: async (n: number) => find(n).reviews ?? [],
    comments: async (n: number) => state.comments.get(n) ?? [],
    statuses: async (sha: string) => state.statuses.get(sha) ?? [],
    canWrite: async (user: string) => user === "maint",
    fileAt: async (path: string, ref: string) => find(Number(/pull\/(\d+)\//.exec(ref)![1])).contents?.[path] ?? null,
    dirTreeSha: async (commit: string) => pulls.flatMap((p) => Object.entries(p.trees ?? {})).find(([c]) => c === commit)?.[1] ?? null,
    setStatus: async (sha: string, context: string, s: string, description: string) => {
      state.statuses.set(sha, [{ context, state: s, description }, ...(state.statuses.get(sha) ?? [])]);
      state.writes.push(`status ${context}=${s}`);
    },
    addComment: async (n: number, body: string) => {
      state.comments.set(n, [...(state.comments.get(n) ?? []), { id: state.nextId++, body, user: { login: "github-actions[bot]" } }]);
      state.writes.push(`comment #${n}`);
    },
    updateComment: async (id: number, body: string) => {
      for (const list of state.comments.values()) for (const c of list) if (c.id === id) c.body = body;
      state.writes.push(`edit comment ${id}`);
    },
    addLabel: async (n: number, label: string) => {
      find(n).labels.push({ name: label });
      state.writes.push(`label #${n} +${label}`);
    },
    removeLabel: async (n: number, label: string) => {
      find(n).labels = find(n).labels.filter((l: any) => l.name !== label);
      state.writes.push(`label #${n} -${label}`);
    },
    closePull: async (n: number) => {
      find(n).state = "closed";
      state.writes.push(`close #${n}`);
    },
  };
  return { gh: gh as unknown as GitHub, state };
}

const status = (state: any, sha: string, context: string) => state.statuses.get(sha)?.find((s: any) => s.context === context)?.state;

test("sweep: vote, approval record, code phase, a second sweep writes nothing, dashboard", async () => {
  const dir = workspace({ "roadmap/search/spec.md": GROUP, "src/main.py": "", "README.md": "" });
  const pull: any = {
    number: 7, title: "Incremental indexing", user: { login: "outsider" }, head: { sha: "h1" }, body: "", labels: [], html_url: "https://github.com/acme/engine/pull/7",
    files: [{ filename: SPEC, status: "added", sha: "s1" }], contents: { [SPEC]: LEAF }, trees: { h1: "t1" }, reviews: [],
  };
  const stray: any = { number: 8, title: "Quick hack", user: { login: "outsider" }, head: { sha: "x1" }, body: "", labels: [], html_url: "u8", files: [{ filename: "src/main.py", status: "modified", sha: "m" }] };
  const { gh, state } = fakeGitHub([pull, stray]);
  const site = join(dir, "_site");
  const sweep = (now = "2026-11-17T12:00:00.000Z") =>
    run({ gh, workspace: dir, defaultBranch: "main", bot: "github-actions[bot]", siteDir: site, serverUrl: "https://github.com", now, log: () => {} });

  // Proposed: the vote is open.
  assert.deepEqual(await sweep(), { failed: 0, dashboard: true });
  assert.equal(status(state, "h1", "spectree/spec"), "pending");
  assert.equal(status(state, "x1", "spectree/spec"), "failure", "code with no spec");
  assert.match(state.comments.get(7)![0].body, /Spec vote: open/);
  let data = JSON.parse(readFileSync(join(site, "roadmap.json"), "utf8"));
  assert.equal(data.tree[0].children[0].status, "proposed");
  assert.equal(data.proposals.length, 1, "a pull request with no spec is not a proposal");

  // A maintainer approves: record, label, status.
  pull.reviews = [{ user: { login: "maint" }, state: "APPROVED", commit_id: "h1", submitted_at: "2026-11-17T12:30:00Z" }];
  await sweep("2026-11-17T13:00:00.000Z");
  assert.equal(status(state, "h1", "spectree/spec"), "success");
  assert.equal(status(state, "h1", "spectree/phase"), "pending");
  assert.deepEqual(pull.labels, [{ name: "spec-approved" }]);
  assert.match(state.comments.get(7)![0].body, /spectree-record: \{"digest":"sha256:/);
  assert.equal(state.comments.get(7)!.length, 1, "one comment, edited in place");

  // Nothing changed: the next sweep writes nothing.
  state.writes.length = 0;
  await sweep("2026-11-17T14:00:00.000Z");
  assert.deepEqual(state.writes, []);

  // Code is pushed. The review is on the old commit; the record still holds.
  pull.head.sha = "h2";
  pull.trees.h2 = "t1";
  pull.files = [...pull.files, { filename: "src/index/inc.py", status: "added", sha: "c1" }, { filename: "tests/index/test_incremental.py", status: "added", sha: "c2" }];
  await sweep("2026-11-17T15:00:00.000Z");
  assert.deepEqual(["spec", "phase", "scope"].map((c) => status(state, "h2", `spectree/${c}`)), ["success", "success", "success"]);
  data = JSON.parse(readFileSync(join(site, "roadmap.json"), "utf8"));
  assert.equal(data.tree[0].children[0].status, "in_progress");
  assert.deepEqual(data.tree[0].counts, { done: 0, planned: 0, proposed: 0, approved: 0, in_progress: 1 });
  const html = readFileSync(join(site, "index.html"), "utf8");
  assert.match(html, /Incremental indexing/);
  assert.match(html, /In progress/);

  // The spec is edited after approval: back to the vote.
  pull.head.sha = "h3";
  pull.trees.h3 = "t2";
  pull.files[0] = { filename: SPEC, status: "added", sha: "s2" };
  await sweep("2026-11-17T16:00:00.000Z");
  assert.equal(status(state, "h3", "spectree/spec"), "pending");
  assert.equal(status(state, "h3", "spectree/phase"), "failure");
  assert.deepEqual(pull.labels, []);
  assert.doesNotMatch(state.comments.get(7)![0].body, /spectree-record/);
});

test("sweep: on_missing_spec close, and a record in a stranger's comment is not trusted", async () => {
  const dir = workspace({ ".spectree.yml": "on_missing_spec: close\n", "roadmap/search/spec.md": GROUP });
  const stray: any = { number: 8, title: "Quick hack", user: { login: "outsider" }, head: { sha: "x1" }, body: "", labels: [], html_url: "u8", files: [{ filename: "src/main.py", status: "modified", sha: "m" }] };
  const forged: any = {
    number: 9, title: "Forged", user: { login: "outsider" }, head: { sha: "f1" }, body: "", labels: [], html_url: "u9",
    files: [{ filename: SPEC, status: "added", sha: "s1" }], contents: { [SPEC]: LEAF }, trees: { f1: "t" }, reviews: [],
  };
  const { gh, state } = fakeGitHub([stray, forged]);
  state.comments.set(9, [{ id: 99, user: { login: "outsider" }, body: '<!-- spectree -->\n<!-- spectree-record: {"digest":"sha256:whatever","commit":"f1","at":"x","pr":9,"tally":{"passed":true,"for":9,"against":0,"forPeople":1,"againstPeople":0,"votes":[]}} -->' }]);
  await run({ gh, workspace: dir, defaultBranch: "main", bot: "github-actions[bot]", siteDir: join(dir, "_site"), serverUrl: "https://github.com", now: "2026-11-17T12:00:00.000Z", log: () => {} });
  assert.equal(stray.state, "closed");
  assert.equal(status(state, "f1", "spectree/spec"), "pending");
});

test("cli: init writes the two workflow files once; validate reports problems", () => {
  const dir = workspace({ "roadmap/search/spec.md": GROUP, "roadmap/search/incremental/spec.md": LEAF });
  const log = console.log, err = console.error;
  const out: string[] = [];
  console.log = console.error = (s: string) => void out.push(s);
  try {
    assert.equal(cli(["init"], dir), 0);
    assert.equal(readFileSync(join(dir, ".github/workflows/spectree.yml"), "utf8"), workflow("main"));
    assert.equal(readFileSync(join(dir, ".github/workflows/spectree-signal.yml"), "utf8"), signal);
    assert.equal(cli(["init"], dir), 0);
    assert.ok(out.some((l) => /kept/.test(l)));
    assert.equal(cli(["validate"], dir), 0);
    writeFileSync(join(dir, "roadmap/search/incremental/spec.md"), "---\ntitle: X\n---\n");
    assert.equal(cli(["validate"], dir), 1);
    assert.ok(out.some((l) => /a leaf needs paths/.test(l)));
  } finally {
    console.log = log;
    console.error = err;
  }
});
