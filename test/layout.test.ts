import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, loadConfig } from "../src/config.ts";
import { type PrSummary, buildData, renderHtml } from "../src/dashboard.ts";
import { type PrInput, evaluatePr } from "../src/evaluate.ts";
import { type Spec, parseSpec } from "../src/tree.ts";

const group = (title: string) => `---\ntitle: ${title}\nkind: group\n---\nAbout ${title}.\n`;
const leaf = (title: string) => `---\ntitle: ${title}\npaths: [src/**]\ncriteria:\n  - id: works\n    text: It works.\n    tests: [tests/test_new.py]\n---\nWhy ${title}.\n`;
const planned = (title: string, when: string) => `---\ntitle: ${title}\nplanned: ${when}\n---\nSome day.\n`;
function specs(files: Record<string, string>): Record<string, Spec> {
  const out: Record<string, Spec> = {};
  for (const [id, text] of Object.entries(files)) out[id] = parseSpec(id, text).spec!;
  return out;
}
const LONG = "A title that goes on for much longer than a row on the roadmap page could ever hold on one line";
const MAIN = specs({
  search: group("Search"),
  "search/full": leaf("Full index"),
  "search/full/fast": leaf("Fast full index"),
  "search/full/soon": planned("Sooner", "now"),
  "search/next": planned("Next thing", "next"),
  "search/later": planned(LONG, "later"),
  "search/pull": planned("On pull", "on customer pull"),
  "search/any": planned("Any time", "true"),
  cli: leaf("Command line"),
});
const NOW = "2026-11-30T12:00:00.000Z";
const ago = (d: number, h = 0) => new Date(Date.parse(NOW) - d * 86_400_000 - h * 3_600_000).toISOString();

function pr(n: number, files: Record<string, string>, opened: string, over: Partial<PrInput> = {}, main = MAIN): PrSummary {
  const input: PrInput = {
    number: n, author: "outsider", headSha: `h${n}`, body: "", labels: [],
    files: Object.keys(files).map((path) => ({ path, status: "added", sha: `s-${path}` })),
    reviews: [], specUnchangedSince: {}, weights: { outsider: 0, maint: 1 }, authorCanWrite: false,
    specContents: files, baseSpecs: main, baseFiles: new Set(["src/main.py"]),
    record: null, implementsRecord: null, now: NOW, ...over,
  };
  return { number: n, title: `PR ${n}`, author: input.author, url: `https://github.com/acme/engine/pull/${n}`, opened, result: evaluatePr(input, DEFAULTS) };
}
/** Approved by a maintainer, the approval recorded `days` ago. */
const approved = (n: number, days: number) => ({ reviews: [{ user: "maint", state: "APPROVED", commit: `h${n}`, at: ago(days) }], now: ago(days) });
const many: Record<string, string> = {};
for (let i = 0; i < 5; i++) many[`roadmap/search/deep/s${i}/spec.md`] = planned(`Deep ${i}`, "later");
many["roadmap/search/deep/spec.md"] = group("Deep");

const PRS = [
  pr(1, { "roadmap/search/a/spec.md": leaf("A") }, ago(2)),
  pr(2, { "roadmap/search/b/spec.md": leaf("B") }, ago(12)),
  pr(3, { "roadmap/search/broken/spec.md": "---\ntitle: Broken\n---\n" }, ago(1)),
  pr(4, { "roadmap/search/c/spec.md": leaf("C") }, ago(40), approved(4, 31)),
  pr(5, { "roadmap/search/d/spec.md": leaf("D") }, ago(40), approved(5, 30)),
  pr(6, { "roadmap/search/e/spec.md": leaf("E"), "src/e.py": "", "tests/test_new.py": "" }, ago(9), approved(6, 3)),
  pr(7, many, ago(0, 5), approved(7, 0)),
  // The author can write, so their own vote passes it: nobody else voted.
  pr(8, { "roadmap/search/f/spec.md": planned("F", "now") }, ago(4), { author: "maint", now: ago(4) }),
];
const data = (cfg = DEFAULTS, prs = PRS, main = MAIN) => buildData(main, prs, cfg, "acme/engine", NOW);
const page = (cfg = DEFAULTS, prs = PRS, main = MAIN) => renderHtml(data(cfg, prs, main), cfg);
const rowOf = (html: string, id: string) => new RegExp(`<li class="node" id="spec-${id}"[^>]*><details[^>]*><summary class="row">(.*?)</summary>(<div class="detail">.*?</div>)`, "s").exec(html)!;

// dashboard/rows

test("one-line: a row holds the title with its tooltip; the level and the id are inside", () => {
  const [, row, detail] = rowOf(page(), "search/later");
  assert.ok(row.startsWith(`<a class="title" title="${LONG}" href="https://github.com/acme/engine/blob/HEAD/roadmap/search/later/spec.md">${LONG}</a>`));
  assert.doesNotMatch(row, /class="level"|<code>/);
  assert.ok(detail.startsWith('<div class="detail"><p class="muted where"><span class="level">task</span> <code>search/later</code></p><p>Some day.</p>'));
  assert.ok(rowOf(page(), "search")[2].includes('<span class="level">epic</span> <code>search</code>'), "a group opens to the same line");
  assert.doesNotMatch(page(), /class="row plain"/, "every row opens");
});

test("horizon: a planned leaf shows its horizon as a marker of its own class", () => {
  const html = page();
  const mark = (id: string) => /<span class="pill[^"]*">[^<]*<\/span>/.exec(rowOf(html, id)[1])![0];
  assert.equal(mark("search/full/soon"), '<span class="pill hz hz-now">now</span>');
  assert.equal(mark("search/next"), '<span class="pill hz hz-next">next</span>');
  assert.equal(mark("search/later"), '<span class="pill hz hz-later">later</span>');
  assert.equal(mark("search/pull"), '<span class="pill hz hz-other">on customer pull</span>');
  assert.equal(mark("search/any"), '<span class="pill hz hz-other">Planned</span>');
  assert.equal(mark("cli"), '<span class="pill done">Done</span>');
});

test("group-row: a bar, done of total, pills for what is in flight, and the number planned", () => {
  const row = rowOf(page(), "search")[1];
  // 2 done, 1 in progress, 3 approved (two of them leaves to build), 2 proposed (the broken one has no node), 11 planned.
  const c = data().tree.find((n) => n.id === "search")!.counts;
  assert.deepEqual(c, { done: 2, in_progress: 1, approved: 2, proposed: 2, planned: 11 });
  assert.ok(row.includes('<span class="bar"><span style="width:11%"></span></span><span class="muted">2 of 18 done</span> <span class="pill in_progress">1 in progress</span> <span class="pill approved">2 approved</span> <span class="pill proposed">2 proposed</span> <span class="muted">11 planned</span>'), row);
  assert.doesNotMatch(row, /class="pill done"|class="pill planned"/);
  const quiet = rowOf(renderHtml(buildData(specs({ g: group("G"), "g/a": leaf("A") }), [], DEFAULTS, "acme/engine", NOW), DEFAULTS), "g")[1];
  assert.match(quiet, /1 of 1 done<\/span>/);
  assert.doesNotMatch(quiet, /pill|planned/, "nothing in flight and nothing planned: only the bar and the count");
});

test("nested: a leaf with specs under it counts itself and them", () => {
  const d = buildData(MAIN, [], DEFAULTS, "acme/engine", NOW);
  const leaves = Object.values(MAIN).filter((s) => s.kind === "leaf").length;
  assert.equal(leaves, 8);
  assert.equal(d.overview.all.total, leaves);
  const full = d.tree.find((n) => n.id === "search")!.children.find((n) => n.id === "search/full")!;
  assert.deepEqual([full.kind, full.children.length], ["leaf", 2]);
  assert.deepEqual(full.counts, { done: 2, in_progress: 0, approved: 0, proposed: 0, planned: 1 });
  assert.deepEqual(d.overview.rows.find((r) => r.id === "search")!.horizons, { now: 1, next: 1, later: 1, "on customer pull": 1, "": 1 });
});

// dashboard/first-screen

test("steps: Propose, Vote and Build, with the vote a spec needs and the guide", () => {
  const cfg = { ...DEFAULTS, threshold: 2, max_against: 1, root: "specs" };
  const html = renderHtml(buildData(MAIN, [], cfg, "acme/engine", NOW), cfg);
  const how = /<details class="how" id="how" open><summary>How changes are made here<\/summary>(.*?)<\/details>/s.exec(html)![1];
  const steps = [...how.matchAll(/<li><strong>(\w+)\.<\/strong> (.*?)<\/li>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(steps.map((s) => s[0]), ["Propose", "Vote", "Build"]);
  assert.match(steps[0][1], /starts as a spec under <code>specs\/<\/code>, proposed in a pull request/);
  assert.match(steps[1][1], /Approve is for, Request changes is against\. A spec passes with 2 weighted votes for and at most 1 against\./);
  assert.match(steps[2][1], /the code is added to the same pull request/);
  assert.match(how, /<a href="https:\/\/github.com\/beamreach-ai\/spectree\/blob\/main\/docs\/contributing-with-specs.md">How to propose a spec and vote<\/a>/);
  assert.ok(html.indexOf('id="how"') < html.indexOf("<h2>Overview</h2>"));
  assert.doesNotMatch(html, /<p class="intro">/);
});

test("closed: the page's script remembers a closed steps box in the browser, and nowhere else", () => {
  const js = /<script>(.*?)<\/script>/s.exec(page())![1];
  assert.match(js, /localStorage\.getItem\("spectree-how"\) === "closed"\) how\.open = false/);
  assert.match(js, /how\.addEventListener\("toggle", function \(\) \{ localStorage\.setItem\("spectree-how", how\.open \? "open" : "closed"\); \}\)/);
  assert.equal(js.match(/localStorage/g)!.length, 2);
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|sendBeacon|document\.cookie/);
  assert.doesNotThrow(() => new Function(js));
});

test("empty: no specs and no proposals shows what a spec is and how to check a tree, and nothing else", () => {
  const html = renderHtml(buildData({}, [], DEFAULTS, "acme/engine", NOW), DEFAULTS);
  assert.match(html, /<div class="empty"><p><strong>No specs yet\.<\/strong> A spec is a file, <code>roadmap\/&lt;name&gt;\/spec\.md<\/code>/);
  assert.match(html, /<pre>npx github:beamreach-ai\/spectree validate\nnpx github:beamreach-ai\/spectree tree<\/pre>/);
  assert.doesNotMatch(html, /<h2>Overview<\/h2>|<h2>Open proposals<\/h2>|<form|<script|class="queue"/);
  assert.match(html, /id="how" open/, "the steps are still there");
});

test("proposals-only: no specs and an open proposal shows the proposal", () => {
  const one = [pr(1, { "roadmap/first/spec.md": leaf("First") }, ago(1), {}, {})];
  const html = renderHtml(buildData({}, one, DEFAULTS, "acme/engine", NOW), DEFAULTS);
  assert.match(html, /<h2>Open proposals<\/h2>/);
  assert.match(html, /#1 PR 1/);
  assert.doesNotMatch(html, /class="empty"/);
});

// dashboard/attention

const steps = (html: string) =>
  [...html.matchAll(/<tbody data-step="(\w+)"><tr class="step"><th colspan="4">([^<]*) <span class="muted">(\d+)<\/span><\/th><\/tr>(.*?)<\/tbody>/gs)].map((m) => ({
    step: m[1], title: m[2], count: Number(m[3]), prs: [...m[4].matchAll(/<tr><td><a href="[^"]*">#(\d+) /g)].map((x) => Number(x[1])),
  }));

test("steps: each proposal under the one step it waits for, in order, with counts; empty steps are left out", () => {
  const s = steps(page());
  assert.deepEqual(s.map((x) => [x.step, x.title, x.count]), [
    ["votes", "Needs votes", 2], ["fix", "Needs a fix to the spec", 1], ["code", "Approved, waiting for code", 2], ["review", "In code review", 1], ["merge", "Ready to merge", 2],
  ]);
  assert.deepEqual(s.flatMap((x) => x.prs).sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  const few = steps(page(DEFAULTS, [PRS[0], PRS[5]]));
  assert.deepEqual(few.map((x) => x.step), ["votes", "review"]);
  assert.match(page(DEFAULTS, []), /<p class="muted">No open spec pull requests\.<\/p>/);
});

test("oldest-first: within a step, the longest in it comes first, then the lower number", () => {
  const s = Object.fromEntries(steps(page()).map((x) => [x.step, x.prs]));
  assert.deepEqual(s.votes, [2, 1]);
  assert.deepEqual(s.code, [4, 5], "both opened 40 days ago; #4 was approved a day earlier");
  assert.deepEqual(s.merge, [8, 7]);
  const tie = steps(page(DEFAULTS, [pr(9, { "roadmap/search/y/spec.md": leaf("Y") }, ago(2)), pr(3, { "roadmap/search/x/spec.md": leaf("X") }, ago(2))]));
  assert.deepEqual(tie[0].prs, [3, 9]);
});

test("age: days since it was opened, and since the approval once the vote has passed", () => {
  const html = page();
  const line = (n: number) => new RegExp(`#${n} PR ${n}</a><div class="muted">(.*?)</div>`).exec(html)![1];
  assert.equal(line(1), "by outsider · opened 2 days ago");
  assert.equal(line(3), "by outsider · opened 1 day ago");
  assert.equal(line(6), "by outsider · opened 9 days ago · 3 days in this step");
  assert.equal(line(7), "by outsider · opened today");
  assert.equal(line(8), "by maint · opened 4 days ago", "approved the moment it opened: the step is as old as the pull request");
  const unknown = renderHtml(buildData(MAIN, [{ ...PRS[0], opened: undefined }], DEFAULTS, "acme/engine", NOW), DEFAULTS);
  assert.match(unknown, /#1 PR 1<\/a><div class="muted">by outsider<\/div>/);
});

test("stale: in its step for more than dashboard.stale_days, 30 unless set; 0 marks none", () => {
  assert.equal(DEFAULTS.dashboard.stale_days, 30);
  const stale = (cfg = DEFAULTS) => data(cfg).proposals.filter((p) => p.stale).map((p) => p.number);
  assert.deepEqual(stale(), [4], "31 days in the step; #5 has exactly 30");
  const cfg = (n: number) => ({ ...DEFAULTS, dashboard: { ...DEFAULTS.dashboard, stale_days: n } });
  assert.deepEqual(stale(cfg(2)), [2, 4, 5, 6, 8]);
  assert.deepEqual(stale(cfg(0)), []);
  assert.match(page(), /#4 PR 4<\/a><div class="muted">by outsider · opened 40 days ago · 31 days in this step <span class="pill bad">stale<\/span><\/div>/);
  assert.equal(page().match(/>stale</g)!.length, 1);
  assert.equal(loadConfig("dashboard: {stale_days: 7}").config.dashboard.stale_days, 7);
  for (const bad of ["-1", "1.5", "soon"]) assert.match(loadConfig(`dashboard: {stale_days: ${bad}}`).errors[0], /stale_days must be a whole number, 0 or more/);
});

test("many-specs: more than three become a count and the node they share, opening to the list", () => {
  const html = page();
  const cell = /#7 PR 7<\/a><div class="muted">.*?<\/div>(.*?)<\/td>/s.exec(html)![1];
  assert.ok(cell.startsWith('<details class="specs"><summary>6 specs in <code>search</code></summary><code>search/deep</code> <code>search/deep/s0</code>'), cell);
  assert.match(html, /#1 PR 1<\/a><div class="muted">.*?<\/div><div><code>search\/a<\/code><\/div>/);
  const apart: Record<string, string> = {};
  for (const top of ["a", "b", "c", "d"]) apart[`roadmap/${top}/spec.md`] = planned(top, "later");
  assert.match(page(DEFAULTS, [pr(9, apart, ago(1))]), /<details class="specs"><summary>4 specs<\/summary>/);
});

test("tally: in full while the vote is open or someone else voted; otherwise Approved", () => {
  const html = page();
  const vote = (n: number) => new RegExp(`#${n} PR ${n}</a>.*?</td><td>.*?</td><td>(.*?)</td>`, "s").exec(html)![1];
  assert.equal(vote(1), '<div>0 of 1 for, 0 against</div><div class="muted">For: @outsider (weight 0)</div>');
  assert.equal(vote(3), '<div>0 of 1 for, 0 against</div><div class="muted">For: @outsider (weight 0)</div>');
  assert.equal(vote(6), '<div>Spec: 1 of 1 for, 0 against</div><div class="muted">For: @maint, @outsider (weight 0)</div><div>Code: 1 of 1 for, 0 against</div>');
  assert.equal(vote(8), "<div>Approved</div>");
});

test("json: each proposal carries when it was opened, since when it is in its step, the days and stale", () => {
  const p = Object.fromEntries((JSON.parse(JSON.stringify(data())).proposals as any[]).map((x) => [x.number, x]));
  assert.deepEqual([p[6].opened, p[6].since, p[6].days, p[6].days_in_step, p[6].stale], [ago(9), ago(3), 9, 3, false]);
  assert.deepEqual([p[1].opened, p[1].since, p[1].days, p[1].days_in_step, p[1].stale], [ago(2), ago(2), 2, 2, false]);
  assert.deepEqual([p[4].days, p[4].days_in_step, p[4].stale], [40, 31, true]);
  assert.deepEqual([p[7].days, p[7].days_in_step], [0, 0]);
});
