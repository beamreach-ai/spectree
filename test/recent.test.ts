import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { DEFAULTS, loadConfig } from "../src/config.ts";
import { type Merge, type PrSummary, buildData, renderHtml } from "../src/dashboard.ts";
import { type PrInput, evaluatePr } from "../src/evaluate.ts";
import type { GitHub } from "../src/github.ts";
import { run } from "../src/run.ts";
import { type Spec, parseSpec } from "../src/tree.ts";

const group = (title: string) => `---\ntitle: ${title}\nkind: group\n---\n`;
const leaf = (title: string) => `---\ntitle: ${title}\npaths: [src/**]\ncriteria:\n  - id: works\n    text: It works.\n    tests: [src/main.py]\n---\nWhy.\n`;
const planned = (title: string) => `---\ntitle: ${title}\nplanned: next\n---\nSome day.\n`;
const FILES: Record<string, string> = {
  "roadmap/search/spec.md": group("Search"),
  "roadmap/search/full/spec.md": leaf("Full index"),
  "roadmap/search/fast/spec.md": leaf("Fast index"),
  "roadmap/search/old/spec.md": leaf("Old thing"),
  "roadmap/search/a/spec.md": planned("Backlog A"),
  "roadmap/search/b/spec.md": planned("Backlog B"),
  "roadmap/search/c/spec.md": leaf("Backlog C, built since"),
};
const MAIN: Record<string, Spec> = {};
for (const [path, text] of Object.entries(FILES)) {
  const id = path.slice("roadmap/".length, -"/spec.md".length);
  MAIN[id] = parseSpec(id, text).spec!;
}
const NOW = "2026-11-30T12:00:00.000Z";
const ago = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const merge = (sha: string, days: number, title: string, added: string[], built: string[] = []): Merge => ({ sha, at: ago(days), title, url: `https://github.com/acme/engine/commit/${sha}`, added, built });
const MERGES = [
  merge("m1", 2, "Fast index (#12)", ["search/fast"]),
  merge("m2", 5, "Import the backlog (#11)", ["search", "search/a", "search/b", "search/c"]),
  merge("m3", 10, "Build the full index (#10)", [], ["search/full"]),
  merge("m4", 45, "Old thing (#3)", ["search/old"]),
  merge("m5", 200, "Ancient", ["search/gone"]),
];
function pr(n: number, title: string, opened: string, over: Partial<PrInput> = {}): PrSummary {
  const files = { [`roadmap/search/p${n}/spec.md`]: leaf(`P${n}`) };
  const input: PrInput = {
    number: n, author: "outsider", headSha: `h${n}`, body: "", labels: [],
    files: Object.keys(files).map((path) => ({ path, status: "added", sha: `s-${path}` })),
    reviews: [], specUnchangedSince: {}, weights: { outsider: 0, maint: 1 }, authorCanWrite: false,
    specContents: files, baseSpecs: MAIN, baseFiles: new Set(["src/main.py"]),
    record: null, implementsRecord: null, now: NOW, ...over,
  };
  return { number: n, title, author: "outsider", url: `https://github.com/acme/engine/pull/${n}`, opened, result: evaluatePr(input, DEFAULTS) };
}
const PRS = [
  pr(20, "Spec: a badge", ago(3)),
  pr(21, "Spec: drafts", ago(60), { reviews: [{ user: "maint", state: "APPROVED", commit: "h21", at: ago(1) }], now: ago(1) }),
  pr(22, "Spec: long ago", ago(70)),
];
const data = (cfg = DEFAULTS, merges: Merge[] | undefined = MERGES, prs = PRS) => buildData(MAIN, prs, cfg, "acme/engine", NOW, { merges });
const days = (n: number) => ({ ...DEFAULTS, dashboard: { ...DEFAULTS.dashboard, recent_days: n } });
const lines = (html: string) =>
  [...(/<ul class="recent">(.*?)<\/ul>/s.exec(html)?.[1] ?? "").matchAll(/<li><span class="muted when">([^<]*)<\/span> <span class="pill (\w+)">([^<]*)<\/span> <a href="([^"]*)">([^<]*)<\/a>(?: <span class="muted">([^<]*)<\/span>)?<\/li>/g)].map((m) => m.slice(1, 7));

test("entries: specs that reached the default branch, approvals and openings in the window, newest first", () => {
  const d = data();
  assert.deepEqual(d.recent!.map((e) => [e.kind, e.at, e.title]), [
    ["approved", ago(1), "Spec: drafts"],
    ["done", ago(2), "Fast index"],
    ["proposed", ago(3), "Spec: a badge"],
    ["done", ago(5), "Backlog C, built since"],
    ["planned", ago(5), "Import the backlog (#11)"],
    ["done", ago(10), "Full index"],
  ]);
  const html = renderHtml(d, DEFAULTS);
  assert.ok(html.indexOf("<h2>Overview</h2>") < html.indexOf("<h2>Lately</h2>") && html.indexOf("<h2>Lately</h2>") < html.indexOf("<h2>Open proposals</h2>"));
  assert.deepEqual(lines(html)[0], ["Nov 29", "approved", "Approved", "https://github.com/acme/engine/pull/21", "Spec: drafts", undefined]);
  assert.deepEqual(lines(html)[1], ["Nov 28", "done", "Done", "https://github.com/acme/engine/commit/m1", "Fast index", undefined]);
  assert.deepEqual(lines(html).map((l) => l[2]), ["Approved", "Done", "Proposed", "Done", "Planned", "Done"]);
  assert.ok(!d.recent!.some((e) => e.title === "Spec: long ago" || e.title === "Old thing"), "outside the window");
  assert.ok(data(days(60)).recent!.some((e) => e.title === "Old thing"), "a wider window reaches further back");
});

test("one-line-per-commit: many specs are one line with the commit's title and their number; one spec is its own title", () => {
  const d = data();
  const backlog = d.recent!.filter((e) => e.url.endsWith("/m2"));
  assert.deepEqual(backlog.map((e) => [e.kind, e.title, e.ids]), [
    ["done", "Backlog C, built since", ["search/c"]],
    ["planned", "Import the backlog (#11)", ["search/a", "search/b"]],
  ]);
  assert.ok(!backlog.some((e) => e.ids.includes("search")), "a group is neither done nor planned");
  const row = lines(renderHtml(d, DEFAULTS)).find((l) => l[4] === "Import the backlog (#11)")!;
  assert.deepEqual([row[2], row[5]], ["Planned", "2 specs"]);
  const big = merge("big", 1, "Import 40 specs", Object.keys(MAIN));
  assert.equal(data(DEFAULTS, [big], []).recent!.length, 2, "forty specs in one commit are two lines, done and planned");
  const lots: Merge[] = [];
  for (let i = 0; i < 12; i++) lots.push(merge(`c${i}`, i, `Commit ${i}`, ["search/fast"]));
  const html = renderHtml(data(DEFAULTS, lots, []), DEFAULTS);
  assert.equal(lines(html).length, 8);
  assert.match(html, /<\/ul><p class="muted">And 4 more in the last 30 days\. Specs done: 12 in the last 30 days, 12 in the last 90\.<\/p>/);
});

test("built: a planned leaf is done on the day a commit removed planned from it", () => {
  const e = data().recent!.find((x) => x.url.endsWith("/m3"))!;
  assert.deepEqual([e.kind, e.title, e.ids, e.at], ["done", "Full index", ["search/full"], ago(10)]);
  const still = { ...MAIN, "search/full": { ...MAIN["search/full"], planned: "next" } };
  const d = buildData(still, [], DEFAULTS, "acme/engine", NOW, { merges: [MERGES[2]] });
  assert.deepEqual(d.recent, [], "planned again since: not done");
});

test("pace: specs done in the last 30 and the last 90 days", () => {
  assert.deepEqual(data().pace, { d30: 3, d90: 4 });
  assert.deepEqual(data(days(7)).pace, { d30: 3, d90: 4 }, "whatever the window");
  assert.match(renderHtml(data(), DEFAULTS), /<\/ul><p class="muted">Specs done: 3 in the last 30 days, 4 in the last 90\.<\/p>/);
});

test("quiet: nothing in the window is one line", () => {
  const d = data(days(1), MERGES, []);
  assert.deepEqual(d.recent, []);
  const html = renderHtml(d, days(1));
  assert.match(html, /<h2>Lately<\/h2>\n<p class="muted">Nothing changed in the last 1 day\. Specs done: 3 in the last 30 days, 4 in the last 90\.<\/p>/);
  assert.doesNotMatch(html, /class="recent"/);
});

/** A run against a GitHub in memory that has commits and no open pull requests. */
async function sweep(config: string, commits: "ok" | "broken" = "ok") {
  const dir = mkdtempSync(join(tmpdir(), "spectree-"));
  for (const [path, text] of Object.entries({ ...FILES, "src/main.py": "", ...(config ? { ".spectree.yml": config } : {}) })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const calls: string[] = [];
  const detail: Record<string, any> = {
    m1: { files: [{ filename: "roadmap/search/fast/spec.md", status: "added" }, { filename: "src/fast.py", status: "added" }] },
    m3: { files: [{ filename: "roadmap/search/full/spec.md", status: "modified", patch: "@@ -1,3 +1,8 @@\n title: Full index\n-planned: next\n+paths: [src/**]" }] },
    m6: { files: [{ filename: "roadmap/search/a/spec.md", status: "modified", patch: "@@\n-planned: later\n+planned: next" }, { filename: "roadmap/README.md", status: "added" }] },
  };
  const gh = {
    owner: "acme", repo: "engine",
    openPulls: async () => [],
    ensureLabel: async () => {},
    issuesLabeled: async () => [],
    commitsSince: async (path: string, since: string, branch: string) => {
      calls.push(`commits ${path} ${since} ${branch}`);
      if (commits === "broken") throw new Error("502");
      return [{ sha: "m1" }, { sha: "m6" }, { sha: "m3" }];
    },
    commit: async (sha: string) => ({ ...detail[sha], html_url: `https://github.com/acme/engine/commit/${sha}`, commit: { message: `Title of ${sha}\n\nBody.`, committer: { date: ago(sha === "m1" ? 2 : 10) } } }),
  };
  const log: string[] = [];
  const site = join(dir, "_site");
  await run({ gh: gh as unknown as GitHub, workspace: dir, defaultBranch: "trunk", bot: "github-actions[bot]", siteDir: site, serverUrl: "https://github.com", now: NOW, log: (l) => log.push(l) });
  return { calls, log, data: JSON.parse(readFileSync(join(site, "roadmap.json"), "utf8")), html: readFileSync(join(site, "index.html"), "utf8") };
}

test("setting: 30 days unless set; 0 reads nothing and shows nothing; unreadable commits leave the section out", async () => {
  assert.equal(DEFAULTS.dashboard.recent_days, 30);
  assert.equal(loadConfig("dashboard: {recent_days: 7}").config.dashboard.recent_days, 7);
  for (const bad of ["-1", "1.5", "week"]) assert.match(loadConfig(`dashboard: {recent_days: ${bad}}`).errors[0], /recent_days must be a whole number, 0 or more/);

  const r = await sweep("");
  assert.deepEqual(r.calls, [`commits roadmap ${ago(90)} trunk`], "the root, 90 days back, on the default branch");
  assert.deepEqual(r.data.recent.map((e: any) => [e.kind, e.title, e.url, e.ids]), [
    ["done", "Fast index", "https://github.com/acme/engine/commit/m1", ["search/fast"]],
    ["done", "Full index", "https://github.com/acme/engine/commit/m3", ["search/full"]],
  ]);
  assert.ok(!r.data.recent.some((e: any) => e.url.endsWith("/m6")), "a horizon that changed, and a file that is not a spec, are not news");
  assert.deepEqual((await sweep("dashboard: {recent_days: 120}")).calls, [`commits roadmap ${ago(120)} trunk`]);

  const off = await sweep("dashboard: {recent_days: 0}");
  assert.deepEqual([off.calls, off.data.recent, off.data.pace], [[], null, null]);
  assert.doesNotMatch(off.html, /Lately/);

  const broken = await sweep("", "broken");
  assert.deepEqual([broken.data.recent, broken.data.pace], [null, null]);
  assert.doesNotMatch(broken.html, /Lately/);
  assert.match(broken.html, /<h2>Overview<\/h2>/);
  assert.ok(broken.log.includes("::warning::recent changes could not be read: 502"));
  assert.doesNotMatch(renderHtml(buildData(MAIN, [], DEFAULTS, "local/preview", NOW, {}), DEFAULTS), /Lately/, "a preview has no commits to read");
});

test("json: roadmap.json carries the entries and the pace", () => {
  const d = JSON.parse(JSON.stringify(data()));
  assert.deepEqual(Object.keys(d.recent[0]), ["kind", "at", "title", "url", "ids"]);
  assert.deepEqual(d.recent[0], { kind: "approved", at: ago(1), title: "Spec: drafts", url: "https://github.com/acme/engine/pull/21", ids: ["search/p21"] });
  assert.deepEqual(d.pace, { d30: 3, d90: 4 });
});
