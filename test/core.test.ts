import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, loadConfig } from "../src/config.ts";
import { type PrInput, evaluatePr, implementsRef } from "../src/evaluate.ts";
import { specDigest, tally } from "../src/tally.ts";
import { levelName, missingAncestors, nodeIdOf, parseSpec } from "../src/tree.ts";

const LEAF = `---
title: Incremental indexing
paths:
  - src/index/**
  - tests/index/**
criteria:
  - id: only-changed
    text: Only changed files are re-indexed.
    tests: [tests/index/test_incremental.py]
---
Why and what.
`;
const GROUP = `---\ntitle: Search\nkind: group\n---\nEverything about search.\n`;

const spec = (path: string, sha = "s1", status = "added") => ({ path, status, sha });
const code = (path: string, status = "added") => ({ path, status, sha: "c-" + path });

function pr(over: Partial<PrInput> = {}): PrInput {
  return {
    number: 7, author: "outsider", headSha: "head1", body: "", labels: [],
    files: [spec("roadmap/search/incremental/spec.md")],
    reviews: [], specUnchangedSince: {}, weights: { outsider: 0, maint: 1, fan: 0 }, authorCanWrite: false,
    specContents: { "roadmap/search/incremental/spec.md": LEAF },
    baseSpecs: { search: parseSpec("search", GROUP).spec! },
    baseFiles: new Set(["README.md", "src/main.py"]),
    record: null, implementsRecord: null, now: "2026-11-17T12:00:00Z",
    ...over,
  };
}
const approve = (user: string, commit = "head1", at = "2026-11-17T10:00:00Z") => ({ user, state: "APPROVED", commit, at });
const reject = (user: string, commit = "head1", at = "2026-11-17T10:00:00Z") => ({ user, state: "CHANGES_REQUESTED", commit, at });

test("config: defaults, overrides and errors", () => {
  assert.deepEqual(loadConfig(null).config, DEFAULTS);
  const { config, errors } = loadConfig("threshold: 2\nimplementation: maintainers\nratings: {Alex: 5}\n");
  assert.equal(config.threshold, 2);
  assert.equal(config.implementation, "maintainers");
  assert.equal(config.ratings.alex, 5);
  assert.deepEqual(errors, []);
  assert.match(loadConfig("treshold: 2").errors[0], /unknown key: treshold/);
  assert.match(loadConfig("implementation: anyone").errors[0], /contributors or maintainers/);
});

test("config: the page goes to GitHub Pages unless dashboard.host says cloudflare, which needs a project", () => {
  assert.equal(DEFAULTS.dashboard.host, "github-pages");
  assert.equal(loadConfig("dashboard: {enabled: true}").config.dashboard.host, "github-pages");
  const cf = loadConfig("dashboard: {host: cloudflare, project: acme-roadmap}");
  assert.deepEqual(cf.errors, []);
  assert.equal(cf.config.dashboard.host, "cloudflare");
  assert.equal(cf.config.dashboard.project, "acme-roadmap");
  assert.match(loadConfig("dashboard: {host: cloudflare}").errors[0], /needs dashboard.project/);
  assert.match(loadConfig("dashboard: {host: netlify}").errors[0], /github-pages or cloudflare/);
  assert.match(loadConfig("dashboard: {host: cloudflare, project: Acme_Roadmap}").errors[0], /lowercase/);
  assert.match(loadConfig("dashboard: {hots: cloudflare}").errors[0], /unknown key: dashboard.hots/);
});

test("tree: a leaf needs paths and criteria with tests; a group needs neither", () => {
  assert.equal(parseSpec("a", LEAF).spec!.kind, "leaf");
  assert.equal(parseSpec("a", GROUP).spec!.kind, "group");
  assert.match(parseSpec("a", "no header").errors[0], /must start with a header/);
  assert.match(parseSpec("a", "---\nkind: leaf\n---\n").errors.join("|"), /title is required.*needs paths.*at least one criterion/);
  assert.match(parseSpec("a", "---\ntitle: T\nkind: group\npaths: [x]\n---\n").errors[0], /a group has no paths/);
  assert.match(parseSpec("a", "---\ntitle: T\npaths: [x]\ncriteria:\n  - id: c\n    text: t\n---\n").errors[0], /needs tests/);
  assert.match(parseSpec("a", "---\ntitle: T\nstatus: done\nkind: group\n---\n").errors[0], /unknown header key "status"/);
});

test("tree: ids, ancestors and level names", () => {
  assert.equal(nodeIdOf("roadmap", "roadmap/search/indexing/spec.md"), "search/indexing");
  assert.equal(nodeIdOf("roadmap", "roadmap/README.md"), null);
  assert.equal(nodeIdOf("roadmap", "src/x.py"), null);
  assert.deepEqual(missingAncestors("a/b/c", new Set(["a"])), ["a/b"]);
  assert.equal(levelName("a", DEFAULTS.levels), "epic");
  assert.equal(levelName("a/b/c/d", DEFAULTS.levels), "subtask");
});

test("digest: depends on content, not on order", () => {
  const a = specDigest([spec("roadmap/a/spec.md", "1"), spec("roadmap/b/spec.md", "2")]);
  assert.equal(a, specDigest([spec("roadmap/b/spec.md", "2"), spec("roadmap/a/spec.md", "1")]));
  assert.notEqual(a, specDigest([spec("roadmap/a/spec.md", "1"), spec("roadmap/b/spec.md", "3")]));
  assert.notEqual(specDigest([spec("roadmap/a/spec.md", "1")]), specDigest([spec("roadmap/a/spec.md", "1", "removed")]));
});

test("tally: latest review wins, dismissed withdraws, stale does not count, author counts", () => {
  const opts = { author: "maint", weight: (u: string) => (u === "maint" || u === "m2" ? 1 : 0), specUnchangedSince: (c: string) => c === "head1", cfg: DEFAULTS };
  assert.equal(tally([], opts).passed, true, "a sole maintainer approves their own spec");
  assert.equal(tally([], { ...opts, cfg: { ...DEFAULTS, count_author: false } }).passed, false);
  assert.equal(tally([reject("m2")], opts).passed, false);
  assert.equal(tally([reject("m2", "head1", "1"), approve("m2", "head1", "2")], opts).passed, true);
  assert.equal(tally([reject("m2", "old")], opts).passed, true, "a vote on an older spec does not count");
  assert.equal(tally([{ user: "m2", state: "DISMISSED", commit: "head1", at: "3" }], opts).against, 0);
  const t = tally([approve("fan"), reject("fan2")], { ...opts, author: "outsider" });
  assert.deepEqual([t.for, t.against, t.forPeople, t.againstPeople, t.passed], [0, 0, 2, 1, false]);
});

test("flow: propose, early code, approval, spec change resets, scope, merge-ready", () => {
  // 2. An outsider proposes a leaf.
  let r = evaluatePr(pr(), DEFAULTS);
  assert.equal(r.phase, "spec");
  assert.equal(r.statuses.spec.state, "pending");
  assert.match(r.statuses.spec.description, /0 of 1 needed for/);
  assert.equal(r.statuses.phase.state, "success");
  assert.deepEqual(r.nodes.map((n) => [n.id, n.change]), [["search/incremental", "added"]]);

  // 3. Code before approval.
  r = evaluatePr(pr({ files: [spec("roadmap/search/incremental/spec.md"), code("src/index/inc.py")] }), DEFAULTS);
  assert.equal(r.statuses.phase.state, "failure");
  assert.match(r.statuses.phase.description, /Code before approval/);

  // A fan's vote shows and does not decide.
  r = evaluatePr(pr({ reviews: [approve("fan")] }), DEFAULTS);
  assert.equal(r.record, null);
  assert.equal(r.tally!.forPeople, 2);

  // 4. A maintainer approves.
  r = evaluatePr(pr({ reviews: [approve("maint")] }), DEFAULTS);
  assert.equal(r.phase, "approved");
  assert.equal(r.statuses.spec.state, "success");
  assert.equal(r.statuses.phase.state, "pending", "a leaf needs its code before merge");
  assert.equal(r.addLabel, true);
  const record = r.record!;
  assert.equal(record.commit, "head1");

  // 5. The spec is edited: the record no longer matches and the old vote is stale.
  const edited = pr({ headSha: "head2", files: [spec("roadmap/search/incremental/spec.md", "s2")], reviews: [approve("maint")], record, labels: ["spec-approved"] });
  r = evaluatePr(edited, DEFAULTS);
  assert.equal(r.phase, "spec");
  assert.equal(r.record, null);
  assert.equal(r.removeLabel, true);
  r = evaluatePr({ ...edited, reviews: [approve("maint"), approve("maint", "head2", "2026-11-17T11:00:00Z")] }, DEFAULTS);
  assert.equal(r.phase, "approved");

  // 6. Code, with one file outside the paths and the test missing.
  const coding = pr({ headSha: "head3", record, reviews: [], files: [spec("roadmap/search/incremental/spec.md"), code("src/index/inc.py"), code("src/other.py")] });
  r = evaluatePr(coding, DEFAULTS);
  assert.equal(r.phase, "code");
  assert.equal(r.statuses.spec.state, "success", "the record holds although no review is on the new commit");
  assert.match(r.statuses.scope.description, /1 file outside the spec's paths: src\/other.py/);
  r = evaluatePr({ ...coding, files: [spec("roadmap/search/incremental/spec.md"), code("src/index/inc.py")] }, DEFAULTS);
  assert.match(r.statuses.scope.description, /1 test named by the spec does not exist/);
  r = evaluatePr({ ...coding, files: [spec("roadmap/search/incremental/spec.md"), code("src/index/inc.py"), code("tests/index/test_incremental.py")] }, DEFAULTS);
  assert.deepEqual([r.statuses.spec.state, r.statuses.phase.state, r.statuses.scope.state], ["success", "success", "success"]);

  // "Request changes" in the code phase is code review, not a vote.
  r = evaluatePr({ ...coding, reviews: [reject("maint", "head3")], files: [spec("roadmap/search/incremental/spec.md"), code("src/index/inc.py"), code("tests/index/test_incremental.py")] }, DEFAULTS);
  assert.equal(r.statuses.spec.state, "success");
});

test("flow: a group merges without code; an invalid tree stops the vote", () => {
  let r = evaluatePr(pr({ author: "maint", authorCanWrite: true, files: [spec("roadmap/billing/spec.md")], specContents: { "roadmap/billing/spec.md": GROUP } }), DEFAULTS);
  assert.deepEqual([r.phase, r.statuses.phase.state, r.statuses.phase.description], ["approved", "success", "Spec approved. A group needs no code"]);
  r = evaluatePr(pr({ author: "maint", files: [spec("roadmap/billing/invoices/spec.md")], specContents: { "roadmap/billing/invoices/spec.md": LEAF } }), DEFAULTS);
  assert.equal(r.statuses.spec.state, "failure");
  assert.match(r.errors[0], /its parent billing has no spec.md/);
  assert.equal(r.record, null, "an invalid spec is never approved");
  r = evaluatePr(pr({ author: "maint", files: [spec("roadmap/search/spec.md", "x", "removed")], baseSpecs: { search: parseSpec("search", GROUP).spec!, "search/a": parseSpec("search/a", LEAF).spec! }, specContents: {} }), DEFAULTS);
  assert.match(r.errors[0], /cannot be removed while search\/a exists/);
});

test("flow: who may write code", () => {
  const record = evaluatePr(pr({ reviews: [approve("maint")] }), DEFAULTS).record!;
  const coding = pr({ record, files: [spec("roadmap/search/incremental/spec.md"), code("src/index/inc.py"), code("tests/index/test_incremental.py")] });
  const cfg = { ...DEFAULTS, implementation: "maintainers" as const };
  assert.equal(evaluatePr(coding, cfg).statuses.phase.state, "failure");
  assert.equal(evaluatePr({ ...coding, authorCanWrite: true }, cfg).statuses.phase.state, "success");
});

test("flow: taking over an approved spec with Implements", () => {
  assert.equal(implementsRef("Adds it.\n\nImplements: #7\n"), 7);
  assert.equal(implementsRef("implements #7"), null);
  const record = evaluatePr(pr({ reviews: [approve("maint")] }), DEFAULTS).record!;
  const taker = pr({ number: 9, author: "second", weights: { second: 0 }, implementsRecord: record, files: [spec("roadmap/search/incremental/spec.md"), code("src/index/inc.py"), code("tests/index/test_incremental.py")] });
  let r = evaluatePr(taker, DEFAULTS);
  assert.equal(r.phase, "code");
  assert.match(r.statuses.spec.description, /\(in #7\)/);
  r = evaluatePr({ ...taker, files: [spec("roadmap/search/incremental/spec.md", "changed"), code("src/index/inc.py")] }, DEFAULTS);
  assert.equal(r.phase, "spec", "a changed spec does not inherit the approval");
});

test("flow: pull requests with no spec", () => {
  const noSpec = (over: Partial<PrInput>) => evaluatePr(pr({ files: [code("src/main.py", "modified")], specContents: {}, ...over }), DEFAULTS);
  let r = noSpec({});
  assert.deepEqual([r.phase, r.statuses.spec.state, r.close], ["missing", "failure", false]);
  assert.match(r.comment!, /no approved spec/);
  assert.equal(evaluatePr(pr({ files: [code("src/main.py")], specContents: {} }), { ...DEFAULTS, on_missing_spec: "close" }).close, true);
  assert.equal(noSpec({ author: "dependabot[bot]" }).statuses.spec.state, "success");
  assert.equal(noSpec({ labels: ["no-spec"] }).statuses.spec.state, "success");
  r = noSpec({ files: [code("docs/guide.md"), code(".github/workflows/ci.yml")] });
  assert.deepEqual([r.phase, r.statuses.spec.state, r.comment], ["none", "success", null]);
});

const PLANNED = `---\ntitle: Offline search\nplanned: next\n---\nAgreed, not built.\n`;

test("planned: a planned leaf needs no paths, no criteria and no code; code for it is out of scope", () => {
  const parsed = parseSpec("search/offline", PLANNED);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.spec!.planned, "next");
  assert.equal(parseSpec("a", "---\ntitle: T\nplanned: true\n---\n").spec!.planned, "");
  assert.equal(parseSpec("a", LEAF).spec!.planned, null);
  assert.match(parseSpec("a", "---\ntitle: T\nkind: group\nplanned: now\n---\n").errors[0], /a group cannot be planned/);

  const file = "roadmap/search/offline/spec.md";
  const base = { files: [spec(file)], specContents: { [file]: PLANNED }, reviews: [approve("maint")] };
  const only = evaluatePr(pr(base), DEFAULTS);
  assert.equal(only.phase, "approved");
  assert.equal(only.statuses.phase.state, "success");
  assert.match(only.statuses.phase.description, /planned leaf needs no code/);
  assert.match(only.comment!, /can merge/);

  const withCode = evaluatePr(pr({ ...base, files: [spec(file), code("src/offline.py")] }), DEFAULTS);
  assert.equal(withCode.statuses.scope.state, "failure");
});

test("existing code: a leaf whose tests are all in the default branch can merge without code", () => {
  const baseFiles = new Set(["README.md", "src/index/a.py", "tests/index/test_incremental.py"]);
  const r = evaluatePr(pr({ reviews: [approve("maint")], baseFiles }), DEFAULTS);
  assert.equal(r.statuses.phase.state, "success");
  assert.match(r.statuses.phase.description, /describes existing code/);
  const fresh = evaluatePr(pr({ reviews: [approve("maint")] }), DEFAULTS);
  assert.equal(fresh.statuses.phase.state, "pending");
});

test("on_missing_spec allow: code without a spec passes and gets no comment", () => {
  const r = evaluatePr(pr({ files: [code("src/main.py", "modified")], specContents: {} }), { ...DEFAULTS, on_missing_spec: "allow" });
  assert.equal(r.statuses.spec.state, "success");
  assert.equal(r.comment, null);
  assert.equal(r.phase, "none");
});
