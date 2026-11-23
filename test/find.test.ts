import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, loadConfig } from "../src/config.ts";
import { buildData, renderHtml } from "../src/dashboard.ts";
import { type FindNode, type View, matches, parseView, visible, writeView } from "../src/find.ts";
import { type Spec, parseSpec } from "../src/tree.ts";

const group = (title: string) => `---\ntitle: ${title}\nkind: group\n---\n`;
const leaf = (title: string, why = "Why.") => `---\ntitle: ${title}\npaths: [src/**]\ncriteria:\n  - id: works\n    text: It works.\n    tests: [tests/test_new.py]\n---\n${why}\n`;
const planned = (title: string, when: string) => `---\ntitle: ${title}\nplanned: ${when}\n---\nSome day.\n`;

function specs(files: Record<string, string>): Record<string, Spec> {
  const out: Record<string, Spec> = {};
  for (const [id, text] of Object.entries(files)) out[id] = parseSpec(id, text).spec!;
  return out;
}
const MAIN = specs({
  search: group("Search"),
  "search/full": leaf("Full index", "Builds the <index> from scratch."),
  "search/ranking": planned("Ranking", "later"),
  "search/deep": group("Deep search"),
  "search/deep/voice": planned("Voice", "true"),
  sync: group("Sync"),
  "sync/push": leaf("Push"),
  "sync/pull": planned("Pull", "now"),
  cli: leaf("Command line"),
});
const data = (main = MAIN) => buildData(main, [], DEFAULTS, "acme/engine", "2026-11-21T12:00:00.000Z");
const page = (main = MAIN, cfg = DEFAULTS) => renderHtml(data(main), cfg);

const NODES: FindNode[] = [
  { id: "search", kind: "group", status: "done", horizon: "", text: "search search" },
  { id: "search/full", kind: "leaf", status: "done", horizon: "", text: "full index search/full builds the index from scratch." },
  { id: "search/ranking", kind: "leaf", status: "planned", horizon: "later", text: "ranking search/ranking some day." },
  { id: "search/deep", kind: "group", status: "done", horizon: "", text: "deep search search/deep" },
  { id: "search/deep/voice", kind: "leaf", status: "planned", horizon: "", text: "voice search/deep/voice some day." },
  { id: "searching", kind: "leaf", status: "proposed", horizon: "", text: "searching searching not under search." },
  { id: "sync", kind: "group", status: "done", horizon: "", text: "sync sync" },
  { id: "sync/pull", kind: "leaf", status: "planned", horizon: "now", text: "pull sync/pull some day." },
];
const view = (v: Partial<View> = {}): View => ({ q: "", status: "", horizon: null, top: "", ...v });
const node = (id: string) => NODES.find((n) => n.id === id)!;
const shown = (v: Partial<View>, anchor = "") => visible(NODES, view(v), anchor);
const KNOWN = { statuses: ["done", "in_progress", "approved", "proposed", "planned"], horizons: ["now", "later", ""], tops: ["search", "sync"] };

test("search: every word, whatever the case, in the title, the id or the summary; an empty search matches all", () => {
  assert.ok(matches(node("search/full"), view({ q: "FULL" })), "title");
  assert.ok(matches(node("search/full"), view({ q: "search/fu" })), "id");
  assert.ok(matches(node("search/full"), view({ q: "scratch" })), "summary");
  assert.ok(matches(node("search/full"), view({ q: "  scratch   Index " })), "every word, in any order");
  assert.ok(!matches(node("search/full"), view({ q: "index ranking" })), "one word missing");
  assert.ok(NODES.every((n) => matches(n, view())) && NODES.every((n) => matches(n, view({ q: "   " }))));
});

test("filters: status, horizon and top-level node, combined with the search", () => {
  const ids = (v: Partial<View>) => NODES.filter((n) => n.kind === "leaf" && matches(n, view(v))).map((n) => n.id);
  assert.deepEqual(ids({ status: "planned" }), ["search/ranking", "search/deep/voice", "sync/pull"]);
  assert.deepEqual(ids({ horizon: "later" }), ["search/ranking"]);
  assert.deepEqual(ids({ horizon: "" }), ["search/deep/voice"], "the empty horizon is planned: true, and only planned leaves have it");
  assert.deepEqual(ids({ top: "search" }), ["search/full", "search/ranking", "search/deep/voice"], "under the node, not merely starting with its name");
  assert.deepEqual(ids({ top: "searching" }), ["searching"], "the node itself");
  assert.deepEqual(ids({ top: "search", status: "planned" }), ["search/ranking", "search/deep/voice"]);
  assert.deepEqual(ids({ top: "search", status: "planned", q: "voice" }), ["search/deep/voice"]);
  assert.deepEqual(ids({ status: "done", horizon: "now" }), []);
});

test("groups: shown and open when a leaf under them is shown, hidden otherwise", () => {
  const r = shown({ q: "voice" });
  assert.deepEqual(r.show.sort(), ["search", "search/deep", "search/deep/voice"]);
  assert.deepEqual(r.open.sort(), ["search", "search/deep"]);
  assert.ok(!shown({ q: "sync" }).show.includes("search"), "a group is not searched: it stays only for its leaves");
  const none = shown({});
  assert.equal(none.active, false);
  assert.equal(none.show.length, NODES.length, "nothing set: everything is shown");
  assert.deepEqual(none.open, [], "and nothing is opened beyond what the page rendered");
});

test("count: how many leaves are shown out of how many, and a message when none are", () => {
  assert.deepEqual([shown({ status: "planned" }).matched, shown({ status: "planned" }).total], [3, 5]);
  assert.equal(shown({ status: "planned" }).label, "3 of 5 specs");
  assert.equal(shown({ q: "nothing like this" }).label, "No specs match.");
  assert.deepEqual(shown({ q: "nothing like this" }).show, []);
  assert.equal(shown({}).label, "");
  assert.match(page(), /<span class="muted" id="find-count" aria-live="polite"><\/span><button type="reset" id="find-clear" hidden>Clear<\/button>/);
});

test("url: a query string and a view turn into each other; unset parts are left out and unknown values dropped", () => {
  const full = "q=vote+weight&status=planned&horizon=now&top=sync";
  assert.deepEqual(parseView("?" + full, KNOWN), { q: "vote weight", status: "planned", horizon: "now", top: "sync" });
  assert.equal(writeView(parseView(full, KNOWN)), full);
  assert.equal(writeView(view()), "");
  assert.equal(writeView(view({ q: "  " })), "");
  assert.equal(writeView(view({ top: "sync" })), "top=sync");
  assert.equal(writeView(view({ horizon: "" })), "horizon=", "planned: true is present and empty");
  assert.deepEqual(parseView("horizon=", KNOWN), view({ horizon: "" }));
  assert.deepEqual(parseView("", KNOWN), view());
  assert.deepEqual(parseView("status=finished&horizon=someday&top=nowhere&other=1", KNOWN), view());
  for (const v of [view({ q: "a&b=c d" }), view({ status: "in_progress", horizon: "later" }), view({ top: "search", horizon: "" })])
    assert.deepEqual(parseView(writeView(v), KNOWN), v);
});

test("anchor: the node the address names is shown with its groups open, whatever is set", () => {
  const r = shown({ status: "done" }, "search/deep/voice");
  assert.ok(["search/deep/voice", "search/deep", "search", "search/full"].every((id) => r.show.includes(id)));
  assert.ok(r.open.includes("search/deep") && r.open.includes("search"));
  assert.equal(r.matched, 1, "the count is of what matched, not of what the anchor added");
  const plain = shown({}, "search/deep/voice");
  assert.deepEqual(plain.open.sort(), ["search", "search/deep"], "with nothing set, its groups are opened too");
  assert.deepEqual(shown({ q: "pull" }, "no/such/node").show.sort(), ["sync", "sync/pull"], "an unknown anchor changes nothing");
});

test("closed: groups are rendered closed above dashboard.collapse_over leaves, 40 unless set, never with 0", () => {
  assert.equal(DEFAULTS.dashboard.collapse_over, 40);
  const cfg = (n: number) => ({ ...DEFAULTS, dashboard: { ...DEFAULTS.dashboard, collapse_over: n } });
  const opened = (html: string) => (html.match(/<details open>/g) ?? []).length;
  assert.equal(data().overview.all.total, 6);
  assert.equal(opened(page()), 3, "six leaves: the three groups are open");
  assert.equal(opened(page(MAIN, cfg(6))), 3, "not more than the setting");
  assert.equal(opened(page(MAIN, cfg(5))), 0, "more than the setting");
  assert.equal(opened(page(MAIN, cfg(0))), 3, "0 never closes");
  const many: Record<string, string> = { big: group("Big") };
  for (let i = 0; i < 41; i++) many[`big/s${i}`] = leaf(`Spec ${i}`);
  assert.equal(opened(page(specs(many))), 0, "41 leaves with the default");
  delete many["big/s40"];
  assert.equal(opened(page(specs(many))), 1, "40 leaves with the default");
  assert.equal(loadConfig("dashboard: {collapse_over: 100}").config.dashboard.collapse_over, 100);
  assert.deepEqual(loadConfig("dashboard: {collapse_over: 0}").errors, []);
  for (const bad of ["-1", "2.5", "many", "true"]) assert.match(loadConfig(`dashboard: {collapse_over: ${bad}}`).errors[0], /collapse_over must be a whole number, 0 or more/);
});

test("overview-links: a number links to the view it counts; All leaves the node out; zero and the progress text link nowhere", () => {
  const html = page();
  const t = /<table class="overview">.*?<\/table>/s.exec(html)![0];
  const rows = [...t.matchAll(/<tr[^>]*><th scope="row">.*?<\/tr>/gs)].map((r) => [...r[0].matchAll(/<td class="num">(.*?)<\/td>/g)].map((c) => c[1]));
  // Columns: In progress, Approved, Proposed, then the horizons now, later, no horizon.
  assert.deepEqual(data().overview.horizons, ["now", "later", ""]);
  const no = ["", "", ""];
  assert.deepEqual(rows[0], [...no, ...no], "cli has one done leaf and nothing else");
  assert.deepEqual(rows[1], [...no, "", '<a href="?horizon=later&amp;top=search#specs">1</a>', '<a href="?horizon=&amp;top=search#specs">1</a>']);
  assert.deepEqual(rows[2], [...no, '<a href="?horizon=now&amp;top=sync#specs">1</a>', "", ""]);
  assert.deepEqual(rows[3], [...no, '<a href="?horizon=now#specs">1</a>', '<a href="?horizon=later#specs">1</a>', '<a href="?horizon=#specs">1</a>']);
  assert.match(html, /<h2 id="specs">Specs<\/h2>/);
  assert.doesNotMatch(t, /<a[^>]*>\d+ of \d+ done/);
  const d = data();
  d.overview.rows[1].counts.proposed = 2;
  assert.ok(renderHtml(d, DEFAULTS).includes('<td class="num"><a href="?status=proposed&amp;top=search#specs">2</a></td>'), "a status column links by status");
});

test("controls: a search box and the lists, hidden until the page's script shows them", () => {
  const html = page();
  const form = /<form class="find" id="find" role="search" hidden>.*?<\/form>/s.exec(html)![0];
  assert.ok(html.indexOf('<h2 id="specs">') < html.indexOf(form) && html.indexOf(form) < html.indexOf('<ul class="tree">'), "between the heading and the tree");
  assert.match(form, /<input type="search" name="q" placeholder="Search specs…"/);
  const options = (name: string) => [...new RegExp(`<select name="${name}"[^>]*>(.*?)</select>`, "s").exec(form)![1].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options("status"), [["", "Any status"], ["done", "Done"], ["in_progress", "In progress"], ["approved", "Approved"], ["proposed", "Proposed"], ["planned", "Planned"]]);
  assert.deepEqual(options("horizon"), [["", "Any horizon"], ["h:now", "now"], ["h:later", "later"], ["h:", "no horizon"]]);
  assert.deepEqual(options("top"), [["", "Any epic"], ["cli", "Command line"], ["search", "Search"], ["sync", "Sync"]]);
  assert.match(html, /form\.hidden = false;/, "the script shows the controls");
  const plain = page(specs({ cli: leaf("Command line") }));
  assert.doesNotMatch(plain, /<select name="horizon"/, "no planned leaf, no horizon list");
  assert.doesNotMatch(renderHtml(buildData({}, [], DEFAULTS, "acme/engine", "2026-11-21T12:00:00.000Z"), DEFAULTS), /<form|<script/, "no specs, no controls");
  assert.doesNotMatch(html.replace(/<script>.*?<\/script>/s, ""), /<li class="node"[^>]* hidden/, "without the script every node is shown");
});

test("self-contained: the script is in the page, loads nothing, and reads the nodes' attributes", () => {
  const html = page();
  const scripts = [...html.matchAll(/<script([^>]*)>(.*?)<\/script>/gs)];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][1], "", "no src");
  const js = scripts[0][2];
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|import\(|\.src\s*=/);
  assert.doesNotThrow(() => new Function(js), "the script parses");
  assert.ok(html.includes('<li class="node" id="spec-search/full" data-kind="leaf" data-status="done" data-horizon="" data-text="full index search/full builds the &lt;index&gt; from scratch.">'));
  assert.ok(html.includes('<li class="node" id="spec-search/ranking" data-kind="leaf" data-status="planned" data-horizon="later" data-text="ranking search/ranking some day.">'));
  assert.ok(html.includes('<li class="node" id="spec-search" data-kind="group"'));
  // The page runs the functions the tests above run: its script holds their source and what they need to know.
  assert.ok(js.includes('var KNOWN = {"statuses":["done","in_progress","approved","proposed","planned"],"horizons":["now","later",""],"tops":["cli","search","sync"]};'));
  const run = new Function(`${js.slice(0, js.indexOf("(function (parseView"))}; return { parseView, writeView, matches, visible };`)() as typeof import("../src/find.ts");
  assert.deepEqual(run.visible(NODES, run.parseView("status=planned&top=search", KNOWN), ""), shown({ status: "planned", top: "search" }));
  assert.equal(run.writeView(view({ horizon: "" })), "horizon=");
});
