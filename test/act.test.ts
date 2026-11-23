import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS } from "../src/config.ts";
import { type PrSummary, TEMPLATE, buildData, renderHtml } from "../src/dashboard.ts";
import { type PrInput, evaluatePr } from "../src/evaluate.ts";
import { inlineMarkdown, linkTarget, renderMarkdown } from "../src/markdown.ts";
import { type Spec, parseSpec } from "../src/tree.ts";

const group = (title: string) => `---\ntitle: ${title}\nkind: group\n---\nAbout ${title}.\n`;
const leaf = (title: string, body = `Why ${title}.`) => `---\ntitle: ${title}\npaths: [src/**]\ncriteria:\n  - id: works\n    text: It works.\n    tests: [tests/test_new.py]\n---\n${body}\n`;
const planned = (title: string, when: string) => `---\ntitle: ${title}\nplanned: ${when}\n---\nSome day.\n`;
function specs(files: Record<string, string>): Record<string, Spec> {
  const out: Record<string, Spec> = {};
  for (const [id, text] of Object.entries(files)) out[id] = parseSpec(id, text).spec!;
  return out;
}
const BODY = `The first paragraph, with **bold**, *italics*, \`code <b>\` and [a guide](docs/guide.md).

## What it does

- one
  - nested [site](https://example.com/a?b=1&c=2)
- two

1. first
2. second

| Part | Meaning |
| --- | --- |
| \`q\` | the search |

> quoted <script>alert(1)</script>

\`\`\`yaml
key: <value>
\`\`\`

<img src=x onerror=alert(1)> and [bad](javascript:alert(1)) and [here](#anchor).`;
const MAIN = specs({ search: group("Search"), "search/full": leaf("Full index", BODY), "search/short": leaf("Short"), "search/later": planned("Later", "later") });
const NOW = "2026-11-30T12:00:00.000Z";
function pr(n: number, files: Record<string, string>, over: Partial<PrInput> = {}): PrSummary {
  const input: PrInput = {
    number: n, author: "outsider", headSha: `h${n}`, body: "", labels: [],
    files: Object.keys(files).map((path) => ({ path, status: path.endsWith("full/spec.md") ? "modified" : "added", sha: `s-${path}` })),
    reviews: [], specUnchangedSince: {}, weights: { outsider: 0, maint: 1 }, authorCanWrite: false,
    specContents: files, baseSpecs: MAIN, baseFiles: new Set(["src/main.py"]),
    record: null, implementsRecord: null, now: NOW, ...over,
  };
  return { number: n, title: `PR ${n}`, author: "outsider", url: `https://github.com/acme/engine/pull/${n}`, opened: NOW, result: evaluatePr(input, DEFAULTS) };
}
const yes = (n: number) => ({ reviews: [{ user: "maint", state: "APPROVED", commit: `h${n}`, at: NOW }] });
const PRS = [
  pr(7, { "roadmap/search/new/spec.md": leaf("New thing") }),
  pr(8, { "roadmap/search/ready/spec.md": leaf("Ready") }, yes(8)),
  pr(9, { "roadmap/search/full/spec.md": leaf("Full index", "A changed body.") }),
];
const data = (prs = PRS, branch = "trunk") => buildData(MAIN, prs, DEFAULTS, "acme/engine", NOW, { branch });
const page = (server = "https://github.com") => renderHtml(data(), DEFAULTS, server);
const detail = (html: string, id: string) => new RegExp(`<li class="node" id="spec-${id}"[^>]*><details[^>]*><summary class="row">.*?</summary><div class="detail">(.*?<p class="actions">.*?</p>)</div>`, "s").exec(html)![1];
const actions = (html: string, id: string) =>
  [...(/<p class="actions">(.*?)<\/p>/s.exec(detail(html, id))?.[1] ?? "").matchAll(/<a href="([^"]*)"(?: title="([^"]*)")?>([^<]*)<\/a>/g)].map((m) => ({ href: m[1].replace(/&amp;/g, "&"), title: m[2] ?? "", text: m[3] }));
const R = "https://github.com/acme/engine";

// dashboard/actions

test("propose: a link to the new-file form on the default branch, with a template that is a valid spec", () => {
  const href = /<a class="button" href="([^"]*)">Propose a spec<\/a>/.exec(page())![1].replace(/&amp;/g, "&");
  const u = new URL(href);
  assert.equal(u.origin + u.pathname, `${R}/new/trunk`);
  assert.equal(u.searchParams.get("filename"), "roadmap/new-spec/spec.md");
  assert.equal(u.searchParams.get("value"), TEMPLATE);
  const parsed = parseSpec("new-spec", TEMPLATE);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual([parsed.spec!.kind, parsed.spec!.paths.length, parsed.spec!.criteria.length], ["leaf", 1, 1]);
  assert.match(renderHtml(buildData({}, [], DEFAULTS, "acme/engine", NOW), DEFAULTS), /Propose a spec<\/a>/, "on a fresh repository too");
});

test("in-default-branch: Edit and Add a spec below; Build this on a planned leaf", () => {
  const html = page();
  const full = actions(html, "search/full");
  assert.deepEqual(full.map((a) => a.text), ["Edit", "Start its thread", "Add a spec below"]);
  assert.equal(full[0].href, `${R}/edit/trunk/roadmap/search/full/spec.md`);
  const below = new URL(full[2].href);
  assert.equal(below.origin + below.pathname, `${R}/new/trunk`);
  assert.deepEqual([below.searchParams.get("filename"), below.searchParams.get("value")], ["roadmap/search/full/new-spec/spec.md", TEMPLATE]);
  const later = actions(html, "search/later");
  assert.deepEqual(later.map((a) => a.text), ["Edit", "Start its thread", "Add a spec below", "Build this"]);
  assert.equal(later[3].href, `${R}/edit/trunk/roadmap/search/later/spec.md`);
  assert.match(later[3].title, /Remove planned, add paths and criteria/);
  assert.deepEqual(actions(html, "search").map((a) => a.text), ["Edit", "Start its thread", "Add a spec below"], "a group too");
});

test("in-pull-request: Edit goes to the pull request's files, Discuss to it; Take it on an approved leaf", () => {
  const html = page();
  const fresh = actions(html, "search/new");
  assert.deepEqual(fresh.map((a) => [a.text, a.href]), [["Edit", `${R}/pull/7/files`], ["Discuss or 👍", `${R}/pull/7`]]);
  const ready = actions(html, "search/ready");
  assert.deepEqual(ready.map((a) => a.text), ["Edit", "Discuss or 👍", "Take it"]);
  assert.equal(ready[2].href, `${R}/pull/8`);
  assert.match(ready[2].title, /Implements: #8/);
  assert.deepEqual(actions(html, "search/full").map((a) => a.text)[0], "Edit", "a spec a pull request changes is still in the default branch");
});

test("plain-links: every action is a link to the repository on the run's server and default branch", () => {
  const server = "https://git.example.corp";
  const html = page(server);
  const all = ["search", "search/full", "search/short", "search/later", "search/new", "search/ready"].flatMap((id) => actions(html, id));
  assert.equal(all.length, 3 + 3 + 3 + 4 + 2 + 3);
  for (const a of all) assert.ok(a.href.startsWith(`${server}/acme/engine/`), a.href);
  for (const a of all.filter((x) => /\/(edit|new)\//.test(x.href))) assert.match(a.href, /\/(edit|new)\/trunk[/?]/);
  assert.equal(JSON.parse(JSON.stringify(data())).branch, "trunk");
  assert.equal(buildData(MAIN, [], DEFAULTS, "acme/engine", NOW).branch, "main", "main when the run does not say");
  const js = /<script>(.*?)<\/script>/s.exec(html)![1];
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|sendBeacon|token/i);
});

// dashboard/spec-view

const resolve = (p: string) => `R/${p}`;
test("markdown: headings, paragraphs, nested lists, tables, quotes, code, and inline marks", () => {
  const html = renderMarkdown(BODY, resolve);
  assert.match(html, /^<p>The first paragraph, with <strong>bold<\/strong>, <em>italics<\/em>, <code>code &lt;b&gt;<\/code> and <a href="R\/docs\/guide.md">a guide<\/a>\.<\/p>/);
  assert.match(html, /<h4>What it does<\/h4>/);
  assert.match(html, /<ul><li>one<ul><li>nested <a href="https:\/\/example.com\/a\?b=1&amp;c=2">site<\/a><\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<table><thead><tr><th>Part<\/th><th>Meaning<\/th><\/tr><\/thead><tbody><tr><td><code>q<\/code><\/td><td>the search<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<blockquote>quoted &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/blockquote>/);
  assert.match(html, /<pre><code>key: &lt;value&gt;<\/code><\/pre>/);
  assert.equal(renderMarkdown("# One\n### Three\n###### Six", resolve), "<h4>One</h4>\n<h5>Three</h5>\n<h6>Six</h6>");
  assert.equal(renderMarkdown("a\nb\n\nc", resolve), "<p>a b</p>\n<p>c</p>");
  assert.equal(inlineMarkdown("2 * 3 * 4 and a_b_c", resolve), "2 * 3 * 4 and a_b_c", "stars with spaces are not italics");
  const whole = /<details class="whole"><summary>The whole spec<\/summary><div class="md">(.*?)<\/div><\/details>/s.exec(detail(page(), "search/full"))![1];
  assert.equal(whole, renderMarkdown(BODY, (p) => `${R}/blob/trunk/${p}`));
});

test("no-html: tags show as text, and only http, https, mailto and repository paths become links", () => {
  const html = renderMarkdown(BODY, resolve);
  assert.doesNotMatch(html, /<img|<script|javascript:|onerror=alert\(1\)>/);
  assert.match(html, /<p>&lt;img src=x onerror=alert\(1\)&gt; and bad and here\.<\/p>$/);
  assert.equal(linkTarget("https://a.example/x", resolve), "https://a.example/x");
  assert.equal(linkTarget("mailto:a@example.com", resolve), "mailto:a@example.com");
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example/x", "#top", ""]) assert.equal(linkTarget(bad, resolve), null, bad);
  assert.equal(inlineMarkdown('[x](https://a.example/"onmouseover="alert(1))', resolve), '<a href="https://a.example/&quot;onmouseover=&quot;alert(1)">x</a>', "a quote in an address cannot close the attribute");
  assert.doesNotMatch(detail(page(), "search/full"), /<img|<script[ >]/);
});

test("relative-links: a path in the repository opens on the host, on the default branch", () => {
  assert.equal(linkTarget("docs/guide.md", resolve), "R/docs/guide.md");
  assert.equal(linkTarget("./docs/guide.md", resolve), "R/docs/guide.md");
  assert.equal(linkTarget("/docs/guide.md", resolve), "R/docs/guide.md");
  assert.ok(detail(page(), "search/full").includes(`<a href="${R}/blob/trunk/docs/guide.md">a guide</a>`));
});

test("stands: status or horizon, the proposing pull request with its vote, and proposed changes", () => {
  const html = page();
  const stands = (id: string) => /<p class="muted stands">(.*?)<\/p>/s.exec(detail(html, id))![1];
  assert.equal(stands("search/short"), "Done");
  assert.equal(stands("search/later"), "Planned: later");
  assert.equal(stands("search/new"), `Proposed · proposed in <a href="${R}/pull/7">#7</a>, not in the default branch yet · vote: 0 of 1 for, 0 against`);
  assert.equal(stands("search/ready"), `Approved · proposed in <a href="${R}/pull/8">#8</a>, not in the default branch yet · vote: 1 of 1 for, 0 against`);
  assert.equal(stands("search/full"), `Done · <a href="${R}/pull/9">#9</a> proposes to change it: 0 of 1 for, 0 against; the text here is the default branch's`);
  assert.ok(detail(html, "search/full").includes("The first paragraph") && !detail(html, "search/full").includes("A changed body."));
});

test("short: a spec that is one paragraph has no separate whole view", () => {
  const html = page();
  assert.doesNotMatch(detail(html, "search/short"), /class="whole"/);
  assert.match(detail(html, "search/short"), /<p>Why Short\.<\/p>/);
  assert.match(detail(html, "search/full"), /class="whole"/);
});

test("json: roadmap.json carries each spec's body as Markdown", () => {
  const d = JSON.parse(JSON.stringify(data()));
  const kids = Object.fromEntries(d.tree[0].children.map((c: any) => [c.id, c]));
  assert.equal(kids["search/full"].body, BODY);
  assert.equal(kids["search/new"].body, "Why New thing.");
  assert.equal(d.tree[0].body, "About Search.");
});
