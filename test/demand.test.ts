import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, loadConfig } from "../src/config.ts";
import { buildData, renderHtml } from "../src/dashboard.ts";
import type { GitHub } from "../src/github.ts";
import { run } from "../src/run.ts";

const GROUP = `---\ntitle: Search\nkind: group\n---\nAbout search.\n`;
const leaf = (title: string) => `---\ntitle: ${title}\npaths: [src/**]\ncriteria:\n  - id: works\n    text: It works.\n    tests: [src/main.py]\n---\nWhy ${title}.\n`;
const planned = (title: string) => `---\ntitle: ${title}\nplanned: next\n---\nSome day.\n`;
const FILES: Record<string, string> = {
  "roadmap/search/spec.md": GROUP,
  "roadmap/search/full/spec.md": leaf("Full index"),
  "roadmap/search/ranking/spec.md": planned("Ranking"),
  "roadmap/search/typos/spec.md": planned("Typos"),
  "roadmap/search/voice/spec.md": planned("Voice"),
  "roadmap/search/maps/spec.md": planned("Maps"),
  "src/main.py": "",
};
const NEW = "roadmap/search/fresh/spec.md";

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "spectree-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const issue = (number: number, title: string, up: number, down = 0, more: any = {}) => ({ number, title, html_url: `https://github.com/acme/engine/issues/${number}`, reactions: { "+1": up, "-1": down }, ...more });

/** A GitHub in memory, with one open pull request that adds a spec, and the issues given. */
function world(issues: any[], prUp = 0, hasLabel = true) {
  const calls: string[] = [];
  const statuses = new Map<string, any[]>();
  const comments: any[] = [];
  const pull = { number: 7, title: "Fresh", user: { login: "outsider" }, head: { sha: "h7" }, body: "", labels: [] as any[], html_url: "https://github.com/acme/engine/pull/7", created_at: "2026-11-20T12:00:00Z" };
  const gh = {
    owner: "acme", repo: "engine",
    openPulls: async () => [pull],
    pullFiles: async () => [{ filename: NEW, status: "added", sha: "s1" }],
    reviews: async () => [],
    comments: async () => comments,
    statuses: async (sha: string) => statuses.get(sha) ?? [],
    canWrite: async (user: string) => user === "maint",
    fileAt: async () => leaf("Fresh"),
    dirTreeSha: async () => "t1",
    setStatus: async (sha: string, context: string, state: string, description: string) => {
      statuses.set(sha, [{ context, state, description }, ...(statuses.get(sha) ?? [])]);
    },
    addComment: async (_n: number, body: string) => void comments.push({ id: 1, body, user: { login: "github-actions[bot]" } }),
    updateComment: async () => {},
    addLabel: async () => {},
    removeLabel: async () => {},
    closePull: async () => {},
    issuesLabeled: async (label: string) => (calls.push(`issues ${label}`), issues.filter((i) => !i.pull_request)),
    issue: async (n: number) => (calls.push(`issue ${n}`), { number: n, reactions: { "+1": prUp, "-1": 1 } }),
    ensureLabel: async (name: string) => void calls.push(hasLabel ? `label ${name} exists` : `label ${name} created`),
    createIssue: async () => void calls.push("issue created"),
  };
  return { gh: gh as unknown as GitHub, calls, statuses, comments };
}
async function sweep(w: ReturnType<typeof world>, config = "") {
  const dir = workspace({ ...FILES, ...(config ? { ".spectree.yml": config } : {}) });
  const log: string[] = [];
  const site = join(dir, "_site");
  await run({ gh: w.gh, workspace: dir, defaultBranch: "main", bot: "github-actions[bot]", siteDir: site, serverUrl: "https://github.com", now: "2026-11-30T12:00:00.000Z", log: (l) => log.push(l) });
  const data = JSON.parse(readFileSync(join(site, "roadmap.json"), "utf8"));
  const nodes: Record<string, any> = {};
  const walk = (n: any) => ((nodes[n.id] = n), n.children.forEach(walk));
  data.tree.forEach(walk);
  return { data, nodes, log, html: readFileSync(join(site, "index.html"), "utf8") };
}
const ISSUES = [
  issue(31, "search/ranking", 4, 1),
  issue(32, "search/typos", 9),
  issue(33, "search/ranking", 50),
  issue(34, "search/full", 7),
  issue(35, "not/a/spec", 3),
  issue(36, "`search/voice`", 2),
  issue(37, "search/fresh", 20),
];

test("thread: the labelled issue titled with the spec's id, the first one opened; others are ignored and logged", async () => {
  const r = await sweep(world([...ISSUES].reverse()));
  assert.equal(r.nodes["search/ranking"].thread, "https://github.com/acme/engine/issues/31", "#33 has the same title and came later");
  assert.equal(r.nodes["search/ranking"].up, 4);
  assert.equal(r.nodes["search/voice"].thread, "https://github.com/acme/engine/issues/36", "an id in backticks is the id");
  assert.equal(r.nodes["search/maps"].thread, "");
  assert.deepEqual(r.log.filter((l) => l.includes("matches no spec")), ['thread #35 "not/a/spec" matches no spec; ignored']);
});

test("count: a spec in the default branch counts its thread, a proposed one its pull request; thumbs-down is beside, not subtracted", async () => {
  const r = await sweep(world(ISSUES, 6));
  assert.deepEqual([r.nodes["search/ranking"].up, r.nodes["search/ranking"].down], [4, 1]);
  assert.deepEqual([r.nodes["search/fresh"].up, r.nodes["search/fresh"].down], [6, 1], "the pull request's, not the 20 on a thread with its id");
  assert.deepEqual([r.nodes["search/maps"].up, r.nodes["search/maps"].down], [0, 0]);
  assert.deepEqual([r.nodes["search"].up, r.nodes["search"].down], [0, 0], "a group has its own thread and does not add up its leaves");
});

test("no-effect: demand changes no vote, no check and no status", async () => {
  const quiet = world([], 0);
  const loud = world(ISSUES, 500);
  const a = await sweep(quiet);
  const b = await sweep(loud);
  assert.deepEqual(loud.statuses.get("h7"), quiet.statuses.get("h7"));
  assert.equal(loud.statuses.get("h7")!.find((s) => s.context === "spectree/spec").state, "pending");
  assert.equal(loud.comments[0].body, quiet.comments[0].body);
  const strip = (d: any) => JSON.stringify(d.proposals) + JSON.stringify(d.overview);
  assert.equal(strip(b.data), strip(a.data));
  assert.equal(b.nodes["search/fresh"].status, "proposed");
  assert.equal(b.nodes["search/ranking"].status, "planned");
});

test("page: demand on the row, and a link to the thread or to the filled-in new-issue form", async () => {
  const { html } = await sweep(world(ISSUES, 6));
  const li = (id: string) => new RegExp(`<li class="node" id="spec-${id}"[^>]*><details[^>]*><summary class="row">(.*?)</summary><div class="detail">(.*?)</div>(<ul>|</details>)`, "s").exec(html)!;
  assert.match(li("search/ranking")[1], /<span class="want" title="4 people want this">👍 4<\/span>/);
  assert.match(li("search/ranking")[2], /<p class="muted stands">Planned: next · 4 👍, 1 👎<\/p>/);
  assert.match(li("search/ranking")[2], /<a href="https:\/\/github.com\/acme\/engine\/issues\/31" title="[^"]*">Discuss or 👍<\/a>/);
  assert.doesNotMatch(li("search/maps")[1], /class="want"/);
  const start = /<a href="([^"]*)" title="[^"]*">Start its thread<\/a>/.exec(li("search/maps")[2])![1].replace(/&amp;/g, "&");
  const u = new URL(start);
  assert.equal(u.origin + u.pathname, "https://github.com/acme/engine/issues/new");
  assert.deepEqual([u.searchParams.get("title"), u.searchParams.get("labels")], ["search/maps", "spectree"]);
  assert.match(u.searchParams.get("body")!, /The thread of the spec `search\/maps`: https:\/\/github.com\/acme\/engine\/blob\/main\/roadmap\/search\/maps\/spec.md\n\nA 👍 on this post says you want it/);
  assert.match(li("search/fresh")[1], /👍 6/);
  assert.match(li("search/fresh")[2], /<a href="https:\/\/github.com\/acme\/engine\/pull\/7" title="[^"]*">Discuss or 👍<\/a>/);
});

test("most-wanted: specs not done, most wanted first, at most demand.top; absent without demand", async () => {
  const r = await sweep(world(ISSUES, 6));
  assert.deepEqual(r.data.wanted, [
    { id: "search/typos", title: "Typos", up: 9 },
    { id: "search/fresh", title: "Fresh", up: 6 },
    { id: "search/ranking", title: "Ranking", up: 4 },
  ]);
  assert.ok(!r.data.wanted.some((w: any) => w.id === "search/full"), "7 want it, and it is done");
  assert.match(r.html, /<h2>Most wanted<\/h2>\n<ol class="wanted"><li><a href="#spec-search\/typos">Typos<\/a> <span class="want">👍 9<\/span><\/li><li><a href="#spec-search\/fresh">Fresh<\/a>/);
  assert.ok(r.html.indexOf("<h2>Most wanted</h2>") < r.html.indexOf("<h2>Overview</h2>"));
  assert.deepEqual((await sweep(world(ISSUES, 6), "demand: {top: 5}")).data.wanted.map((w: any) => w.id), ["search/typos", "search/fresh", "search/ranking", "search/voice"]);
  assert.deepEqual((await sweep(world(ISSUES, 6), "demand: {top: 1}")).data.wanted.map((w: any) => w.id), ["search/typos"]);
  const tie = await sweep(world([issue(1, "search/voice", 2), issue(2, "search/maps", 2)]));
  assert.deepEqual(tie.data.wanted.map((w: any) => w.id), ["search/maps", "search/voice"], "ties by id");
  for (const none of [await sweep(world([])), await sweep(world(ISSUES, 6), "demand: {top: 0}")]) {
    assert.deepEqual(none.data.wanted, []);
    assert.doesNotMatch(none.html, /Most wanted/);
  }
});

test("settings: demand.enabled false reads nothing and shows nothing; demand.top is a whole number", async () => {
  const w = world(ISSUES, 6);
  const r = await sweep(w, "demand: {enabled: false}");
  assert.deepEqual(w.calls, []);
  assert.deepEqual([r.nodes["search/ranking"].up, r.nodes["search/ranking"].thread, r.data.wanted], [0, "", []]);
  assert.doesNotMatch(r.html, /class="want"|Most wanted|Start its thread|issues\/new|👍/);
  assert.deepEqual([DEFAULTS.demand.enabled, DEFAULTS.demand.top], [true, 3]);
  assert.equal(loadConfig("demand: {top: 10}").config.demand.top, 10);
  assert.match(loadConfig("demand: {top: -1}").errors[0], /demand.top must be a whole number, 0 or more/);
  assert.match(loadConfig("demand: {enabled: 1}").errors[0], /demand.enabled must be true or false/);
  assert.match(loadConfig("demand: {weights: true}").errors[0], /unknown key: demand.weights/);
  assert.match(loadConfig("demand: 3").errors[0], /demand must be a mapping/);
});

test("lazy: the label is made when missing, and no issue is ever created", async () => {
  const fresh = world([], 0, false);
  await sweep(fresh);
  assert.deepEqual(fresh.calls.filter((c) => c.startsWith("label")), ["label spectree created"]);
  const used = world(ISSUES, 6);
  await sweep(used);
  assert.deepEqual(used.calls, ["issue 7", "label spectree exists", "issues spectree"]);
  assert.ok(!fresh.calls.includes("issue created") && !used.calls.includes("issue created"));
  // A repository where the issues cannot be read still gets its page.
  const broken = world([]);
  (broken.gh as any).issuesLabeled = async () => {
    throw new Error("403 Resource not accessible");
  };
  const r = await sweep(broken);
  assert.ok(r.log.some((l) => l.startsWith("::warning::demand could not be read: 403")));
  assert.equal(r.nodes["search/ranking"].status, "planned");
});

test("json: each spec's thumbs, its thread, and the most wanted list", () => {
  const specs = Object.fromEntries(Object.entries({ a: planned("A"), b: planned("B") }).map(([id, t]) => [id, { id, title: id.toUpperCase(), kind: "leaf" as const, paths: [], criteria: [], planned: "next", body: t }]));
  const d = JSON.parse(JSON.stringify(buildData(specs, [], DEFAULTS, "acme/engine", "2026-11-30T12:00:00.000Z", { threads: { a: { number: 3, url: "u3", up: 2, down: 1 } } })));
  assert.deepEqual([d.tree[0].up, d.tree[0].down, d.tree[0].thread], [2, 1, "u3"]);
  assert.deepEqual([d.tree[1].up, d.tree[1].down, d.tree[1].thread], [0, 0, ""]);
  assert.deepEqual(d.wanted, [{ id: "a", title: "A", up: 2 }]);
  assert.match(renderHtml(d, DEFAULTS), /Most wanted/);
});
