import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS } from "../src/config.ts";
import { type PrSummary, buildData, renderHtml, summaryOf } from "../src/dashboard.ts";
import { type PrInput, evaluatePr } from "../src/evaluate.ts";
import { parseSpec } from "../src/tree.ts";

const GROUP = `---\ntitle: Search\nkind: group\n---\n## Why\n\nEverything about **search**, in one place.\n`;
const DONE = `---
title: Full index
paths: [src/index/**]
criteria:
  - id: all
    text: Every file is indexed.
    tests: [tests/index/test_full.py]
---
Builds the index from scratch. See [the design](docs/index.md).
`;
const PROPOSED = `---
title: Incremental indexing
paths: [src/index/**]
criteria:
  - id: only-changed
    text: Only changed files are re-indexed.
    tests: [tests/index/test_incremental.py]
---
Re-indexing everything takes an hour.
`;
const PLANNED = `---\ntitle: Ranking\nplanned: later\n---\nBetter ranking, some day.\n`;

const base = { search: parseSpec("search", GROUP).spec!, "search/full": parseSpec("search/full", DONE).spec! };

function pr(n: number, files: Record<string, string>, over: Partial<PrInput> = {}): PrSummary {
  const input: PrInput = {
    number: n, author: "outsider", headSha: `h${n}`, body: "", labels: [],
    files: Object.keys(files).map((path) => ({ path, status: "added", sha: `s-${path}` })),
    reviews: [], specUnchangedSince: {}, weights: { outsider: 0, maint: 1, fan: 0 }, authorCanWrite: false,
    specContents: files, baseSpecs: base, baseFiles: new Set(["src/main.py", "tests/index/test_full.py"]),
    record: null, implementsRecord: null, now: "2026-11-21T12:00:00Z", ...over,
  };
  return { number: n, title: `PR ${n}`, author: input.author, url: `https://github.com/acme/engine/pull/${n}`, result: evaluatePr(input, DEFAULTS) };
}
const vote = (user: string, state: string, commit: string) => ({ user, state, commit, at: "2026-11-21T10:00:00Z" });

function fixture(cfg = DEFAULTS) {
  const open = pr(7, { "roadmap/search/incremental/spec.md": PROPOSED }, { reviews: [vote("fan", "APPROVED", "h7"), vote("critic", "CHANGES_REQUESTED", "h7")] });
  const approved = pr(8, { "roadmap/search/ranking/spec.md": PLANNED }, { reviews: [vote("maint", "APPROVED", "h8")] });
  const broken = pr(9, { "roadmap/search/broken/spec.md": "---\ntitle: Broken\n---\n" });
  const coding = pr(10, { "roadmap/search/fast/spec.md": PROPOSED.replace("Incremental indexing", "Fast"), "src/index/fast.py": "" }, { reviews: [vote("maint", "APPROVED", "h10")] });
  const waiting = pr(11, { "roadmap/search/quick/spec.md": PROPOSED.replace("Incremental indexing", "Quick") }, { reviews: [vote("maint", "APPROVED", "h11")] });
  return buildData(base, [open, approved, broken, coding, waiting], cfg, "acme/engine", "2026-11-21T12:00:00Z");
}

test("details: a leaf carries its purpose and criteria, from the default branch or from the pull request", () => {
  const data = fixture();
  const search = data.tree[0];
  assert.equal(search.summary, "Everything about **search**, in one place.", "a heading is skipped");
  const full = search.children.find((c) => c.id === "search/full")!;
  assert.equal(full.summary, "Builds the index from scratch. See [the design](docs/index.md).");
  assert.deepEqual(full.criteria, [{ id: "all", text: "Every file is indexed.", tests: ["tests/index/test_full.py"] }]);
  const inc = search.children.find((c) => c.id === "search/incremental")!;
  assert.equal(inc.status, "proposed");
  assert.equal(inc.criteria[0].id, "only-changed", "a proposed leaf shows its proposed criteria");

  const html = renderHtml(data, DEFAULTS);
  assert.match(html, /<details><summary class="row">.*Full index.*1 criterion/);
  assert.match(html, /<li><span>Every file is indexed\.<\/span> <span class="muted">Tested in <code>tests\/index\/test_full\.py<\/code>/);
  assert.match(html, /<p>Everything about <strong>search<\/strong>, in one place\.<\/p>/);
  assert.match(html, /See the design\./, "a link keeps its text");
  assert.match(html, /Only changed files are re-indexed\./);
});

test("details: a planned leaf whose vote passed is planned, not in progress", () => {
  const ranking = fixture().tree[0].children.find((c) => c.id === "search/ranking")!;
  assert.equal(ranking.status, "planned");
  assert.equal(ranking.horizon, "later");
  const html = renderHtml(fixture(), DEFAULTS);
  assert.match(html, /href="https:\/\/github.com\/acme\/engine\/pull\/8">Ranking</, "not in the default branch yet: the link goes to the pull request");
});

test("next step: each proposal says what it waits for and who voted", () => {
  const data = fixture();
  const next = Object.fromEntries(data.proposals.map((p) => [p.number, p.next]));
  assert.deepEqual(next, { 7: "votes", 8: "merge", 9: "fix", 10: "review", 11: "code" });
  const p7 = data.proposals.find((p) => p.number === 7)!;
  assert.deepEqual(
    p7.votes.map((v) => [v.user, v.vote, v.weight]),
    [["critic", "against", 0], ["fan", "for", 0], ["outsider", "for", 0]],
  );

  const html = renderHtml(data, DEFAULTS);
  assert.match(html, /<div class="next">Votes<\/div><div class="muted"><a href="https:\/\/github.com\/acme\/engine\/pull\/7\/files">Review the spec<\/a>/);
  assert.match(html, /For: @fan \(weight 0\), @outsider \(weight 0\)/);
  assert.match(html, /Against: @critic \(weight 0\)/);
  assert.match(html, /<div class="next">Code<\/div>.*Implements: #11/);
  assert.match(html, /<div class="next">A fix to the spec<\/div>/);
  assert.match(html, /<div class="next">Code review<\/div>/);
  assert.match(html, /<div class="next">Merge<\/div>/);
});

test("intro: how the project takes changes, the vote it needs, and how to take part", () => {
  const cfg = { ...DEFAULTS, threshold: 2, max_against: 1 };
  const html = renderHtml(fixture(cfg), cfg);
  assert.match(html, /<h1>engine roadmap<\/h1>/);
  assert.match(html, /Every change to engine starts as a spec under <code>roadmap\/<\/code>/);
  assert.match(html, /A spec passes with 2 weighted votes for and at most 1 against\./);
  assert.match(html, /<a href="https:\/\/github.com\/beamreach-ai\/spectree\/blob\/main\/docs\/contributing-with-specs.md">How to propose a spec and vote<\/a>/);
  assert.match(renderHtml(fixture(), DEFAULTS), /passes with 1 weighted vote for and none against/);
});

test("json: roadmap.json carries criteria, next steps and votes", () => {
  const json = JSON.parse(JSON.stringify(fixture()));
  assert.equal(json.max_against, 0);
  assert.equal(json.tree[0].children.find((c: any) => c.id === "search/full").criteria[0].text, "Every file is indexed.");
  assert.equal(json.proposals[0].next, "votes");
  assert.equal(json.proposals[0].votes.length, 3);
});

test("summary: the first prose paragraph, flattened and cut at a word", () => {
  assert.equal(summaryOf("## Why\n\n- a list\n\n```\ncode\n```\n\nThe real\nparagraph.\n\nMore."), "The real paragraph.");
  assert.equal(summaryOf(""), "");
  const long = summaryOf("word ".repeat(200), 20);
  assert.ok(long.endsWith("…") && long.length <= 21, long);
});
