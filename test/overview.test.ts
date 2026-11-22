import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS } from "../src/config.ts";
import { type DashNode, type PrSummary, buildData, renderHtml } from "../src/dashboard.ts";
import { type PrInput, evaluatePr } from "../src/evaluate.ts";
import { type Spec, parseSpec } from "../src/tree.ts";

const group = (title: string) => `---\ntitle: ${title}\nkind: group\n---\n`;
const leaf = (title: string) => `---\ntitle: ${title}\npaths: [src/**]\ncriteria:\n  - id: works\n    text: It works.\n    tests: [tests/test_new.py]\n---\nWhy.\n`;
const planned = (title: string, when: string) => `---\ntitle: ${title}\nplanned: ${when}\n---\nSome day.\n`;

function specs(files: Record<string, string>): Record<string, Spec> {
  const out: Record<string, Spec> = {};
  for (const [id, text] of Object.entries(files)) {
    const r = parseSpec(id, text);
    assert.deepEqual(r.errors, []);
    out[id] = r.spec!;
  }
  return out;
}

const MAIN = specs({
  search: group("Search"),
  "search/full": leaf("Full index"),
  "search/ranking": planned("Ranking", "later"),
  "search/synonyms": planned("Synonyms", "now"),
  "search/typos": planned("Typos", "on customer pull"),
  "search/voice": planned("Voice", "true"),
  sync: group("Sync"),
  "sync/push": leaf("Push"),
  "sync/pull": planned("Pull", "next"),
  "sync/merge": planned("Merge", "now"),
  "sync/audit": planned("Audit", "after launch"),
  cli: leaf("Command line"),
});

function pr(n: number, files: Record<string, string>, over: Partial<PrInput> = {}): PrSummary {
  const input: PrInput = {
    number: n, author: "outsider", headSha: `h${n}`, body: "", labels: [],
    files: Object.keys(files).map((path) => ({ path, status: "added", sha: `s-${path}` })),
    reviews: [], specUnchangedSince: {}, weights: { outsider: 0, maint: 1 }, authorCanWrite: false,
    specContents: files, baseSpecs: MAIN, baseFiles: new Set(["src/main.py"]),
    record: null, implementsRecord: null, now: "2026-11-21T12:00:00Z", ...over,
  };
  return { number: n, title: `PR ${n}`, author: "outsider", url: `https://github.com/acme/engine/pull/${n}`, result: evaluatePr(input, DEFAULTS) };
}
const yes = (n: number) => ({ reviews: [{ user: "maint", state: "APPROVED", commit: `h${n}`, at: "2026-11-21T10:00:00Z" }] });

const PRS = [
  pr(1, { "roadmap/search/incremental/spec.md": leaf("Incremental") }),
  pr(2, { "roadmap/search/quick/spec.md": leaf("Quick") }, yes(2)),
  pr(3, { "roadmap/sync/fast/spec.md": leaf("Fast"), "src/fast.py": "", "tests/test_new.py": "" }, yes(3)),
  // A planned leaf whose vote is open is proposed; one whose vote passed is planned.
  pr(4, { "roadmap/sync/offline/spec.md": planned("Offline", "now") }),
  pr(5, { "roadmap/sync/share/spec.md": planned("Share", "next") }, yes(5)),
];

const data = () => buildData(MAIN, PRS, DEFAULTS, "acme/engine", "2026-11-21T12:00:00.000Z");
const page = (d = data()) => renderHtml(d, DEFAULTS);
/** The overview table's rows, each a list of its cells' text. */
function table(html: string): string[][] {
  const t = /<table class="overview">.*?<\/table>/s.exec(html);
  if (!t) return [];
  return [...t[0].matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gs)].map((c) => c[1].replace(/<[^>]+>/g, "").trim()));
}
const body = (html: string) => table(html).slice(2);

test("rows: one per top-level node in the tree's order, then All; a top-level leaf is a row; no specs, no overview", () => {
  const d = data();
  assert.deepEqual(d.overview.rows.map((r) => r.id), d.tree.map((n) => n.id));
  assert.deepEqual(body(page(d)).map((r) => r[0]), ["Command line", "Search", "Sync", "All"]);
  assert.equal(d.overview.rows[0].total, 1, "a top-level leaf counts itself");
  const empty = buildData({}, [], DEFAULTS, "acme/engine", "2026-11-21T12:00:00.000Z");
  assert.deepEqual(empty.overview.rows, []);
  assert.doesNotMatch(page(empty), /Overview|class="overview"/);
});

test("status-counts: each row's numbers are the tree's, and All is their sum", () => {
  const d = data();
  const [cli, search, sync] = d.overview.rows;
  assert.deepEqual(search.counts, { done: 1, planned: 4, proposed: 1, approved: 1, in_progress: 0 });
  assert.deepEqual(sync.counts, { done: 1, planned: 4, proposed: 1, approved: 0, in_progress: 1 });
  assert.deepEqual(cli.counts, { done: 1, planned: 0, proposed: 0, approved: 0, in_progress: 0 });
  for (const [i, r] of d.overview.rows.entries()) {
    assert.deepEqual(r.counts, d.tree[i].counts);
    assert.equal(r.total, Object.values(d.tree[i].counts).reduce((a, b) => a + b, 0));
  }
  assert.deepEqual(d.overview.all.counts, { done: 3, planned: 8, proposed: 2, approved: 1, in_progress: 1 });
  assert.equal(d.overview.all.total, 15);
  // Progress, In progress, Approved, Proposed.
  assert.deepEqual(body(page(d)).map((r) => r.slice(1, 5)), [
    ["1 of 1 done", "", "", ""],
    ["1 of 7 done", "", "1", "1"],
    ["1 of 7 done", "1", "", "1"],
    ["3 of 15 done", "1", "1", "2"],
  ]);
});

test("horizon-columns: now, next, later, the others alphabetically, no horizon last; none without planned leaves", () => {
  const d = data();
  assert.deepEqual(d.overview.horizons, ["now", "next", "later", "after launch", "on customer pull", ""]);
  const head = table(page(d));
  assert.deepEqual(head[0].slice(2), ["In progress", "Approved", "Proposed", "Planned"]);
  assert.deepEqual(head[1], ["now", "next", "later", "after launch", "on customer pull", "no horizon"]);
  const none = buildData(specs({ cli: leaf("Command line") }), [], DEFAULTS, "acme/engine", "2026-11-21T12:00:00.000Z");
  assert.deepEqual(none.overview.horizons, []);
  const rows = table(page(none));
  assert.deepEqual(rows[0].slice(1), ["Progress", "In progress", "Approved", "Proposed"]);
  assert.equal(rows.length, 3, "one heading row, the node, and All");
  assert.doesNotMatch(page(none), />Planned</);
});

test("horizon-counts: planned leaves per horizon, adding up to the tree's planned count", () => {
  const d = data();
  const [cli, search, sync] = d.overview.rows;
  assert.deepEqual(search.horizons, { later: 1, now: 1, "on customer pull": 1, "": 1 });
  // sync/offline is still voted on, so it is proposed; sync/share passed its vote, so it is planned for next.
  assert.deepEqual(sync.horizons, { next: 2, now: 1, "after launch": 1 });
  assert.deepEqual(cli.horizons, {});
  for (const [i, r] of d.overview.rows.entries()) assert.equal(Object.values(r.horizons).reduce((a, b) => a + b, 0), d.tree[i].counts.planned);
  assert.deepEqual(d.overview.all.horizons, { now: 2, next: 2, later: 1, "after launch": 1, "on customer pull": 1, "": 1 });
  assert.deepEqual(body(page(d)).map((r) => r.slice(5)), [
    ["", "", "", "", "", ""],
    ["1", "", "1", "", "1", "1"],
    ["1", "2", "", "1", "", ""],
    ["2", "2", "1", "1", "1", "1"],
  ]);
});

test("progress: a bar filled to done over total in whole percent, with the text", () => {
  const html = page();
  const widths = [...html.matchAll(/<span class="bar"><span style="width:(\d+)%"><\/span><\/span> (\d+) of (\d+) done/g)].map((m) => m.slice(1, 4).map(Number));
  assert.deepEqual(widths, [[100, 1, 1], [14, 1, 7], [14, 1, 7], [20, 3, 15]]);
});

test("zero: a cell whose number is zero is empty", () => {
  const html = page();
  assert.doesNotMatch(/<table class="overview">.*?<\/table>/s.exec(html)![0], /<td class="num">0<\/td>/);
  assert.match(html, /<td class="num"><\/td>/);
});

test("jump: a row's title links to the node's row in the tree, and every node has an anchor", () => {
  const d = data();
  const html = page(d);
  for (const r of d.overview.rows) assert.ok(html.includes(`<th scope="row"><a href="#spec-${r.id}">${r.title}</a></th>`), r.id);
  const ids: string[] = [];
  const walk = (n: DashNode) => (ids.push(n.id), n.children.forEach(walk));
  d.tree.forEach(walk);
  assert.equal(ids.length, 17);
  for (const id of ids) assert.equal(html.split(`<li class="node" id="spec-${id}">`).length, 2, id);
  assert.doesNotMatch(html, /<tr class="all"><th scope="row"><a/, "All links nowhere");
});

test("replaces-pills: the overview stands where the total pills stood", () => {
  const html = page();
  assert.doesNotMatch(html, /class="summary"/);
  assert.doesNotMatch(html, /\d+ (done|planned|proposed|approved|in progress)<\/span>\s*<span class="pill [a-z_]+">\d+ [a-z ]+<\/span>\s*<h2>/);
  const at = (s: string) => html.indexOf(s);
  assert.ok(at('<p class="intro">') < at("<h2>Overview</h2>") && at("<h2>Overview</h2>") < at("<h2>Open proposals</h2>"));
  assert.equal(html.split('<table class="overview">').length, 2);
});

test("json: roadmap.json carries the overview, and the page is rendered from it", () => {
  const d = JSON.parse(JSON.stringify(data())) as ReturnType<typeof data>;
  assert.deepEqual(Object.keys(d.overview), ["horizons", "rows", "all"]);
  assert.deepEqual(Object.keys(d.overview.all), ["id", "title", "total", "counts", "horizons"]);
  assert.equal(d.overview.all.id, "");
  d.overview.horizons = ["later"];
  d.overview.rows = [{ id: "x/y", title: "Only <this>", total: 40, counts: { done: 10, planned: 3, proposed: 0, approved: 0, in_progress: 27 }, horizons: { later: 3 } }];
  const rows = table(page(d));
  assert.deepEqual(rows[1], ["later"]);
  assert.deepEqual(rows[2], ["Only &lt;this&gt;", "10 of 40 done", "27", "", "", "3"]);
});
