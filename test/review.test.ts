import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { HELP, commandReviews } from "../src/commands.ts";
import { type Config, DEFAULTS, loadConfig } from "../src/config.ts";
import { type PrSummary, buildData, renderHtml } from "../src/dashboard.ts";
import { type PrInput, evaluatePr } from "../src/evaluate.ts";
import type { GitHub } from "../src/github.ts";
import { run } from "../src/run.ts";
import { parseSpec } from "../src/tree.ts";

const GROUP = "---\ntitle: Search\nkind: group\n---\n";
const LEAF = "---\ntitle: Fresh\npaths: [src/**, tests/**]\ncriteria:\n  - id: works\n    text: It works.\n    tests: [tests/test_fresh.py]\n---\nWhy.\n";
const SPEC = "roadmap/search/fresh/spec.md";
const SPEC_FILE = { path: SPEC, status: "added", sha: "s1" };
const CODE_FILES = [{ path: "src/fresh.py", status: "added", sha: "c1" }, { path: "tests/test_fresh.py", status: "added", sha: "c2" }];
const at = (hm: string) => `2026-11-30T${hm}:00Z`;
const approve = (user: string, commit: string, when = at("10:00")) => ({ user, state: "APPROVED", commit, at: when });
const reject = (user: string, commit: string, when = at("10:00")) => ({ user, state: "CHANGES_REQUESTED", commit, at: when });
const review = (cfg: Partial<Config["review"]>): Config => ({ ...DEFAULTS, review: { ...DEFAULTS.review, ...cfg } });

function pr(over: Partial<PrInput> = {}): PrInput {
  return {
    number: 7, author: "outsider", headSha: "head1", body: "", labels: [], files: [SPEC_FILE],
    reviews: [], specUnchangedSince: {}, weights: { outsider: 0, maint: 1, maint2: 1, fan: 0 }, authorCanWrite: false,
    specContents: { [SPEC]: LEAF }, baseSpecs: { search: parseSpec("search", GROUP).spec! }, baseFiles: new Set(["src/main.py"]),
    record: null, implementsRecord: null, now: at("12:00"), ...over,
  };
}
/** The spec was approved on head1. The code arrives on head2. */
const RECORD = evaluatePr(pr({ reviews: [approve("maint", "head1")] }), DEFAULTS).record!;
const coding = (over: Partial<PrInput> = {}) => pr({ headSha: "head2", record: RECORD, files: [SPEC_FILE, ...CODE_FILES], ...over });
const phase = (input: PrInput, cfg = DEFAULTS) => {
  const s = evaluatePr(input, cfg).statuses.phase;
  return [s.state, s.description];
};

test("needs-review: approved spec and code keep the phase check pending until the code review passes", () => {
  assert.notEqual(RECORD, null);
  const r = evaluatePr(coding(), DEFAULTS);
  assert.equal(r.phase, "code");
  assert.deepEqual([r.statuses.spec.state, r.statuses.scope.state], ["success", "success"], "everything else is green");
  assert.deepEqual(phase(coding()), ["pending", "Code review open: 0 of 1 needed for, 0 against"]);
  assert.equal(evaluatePr(pr({ record: RECORD }), DEFAULTS).review, null, "no code, no code review");
});

test("head-only: a review counts for the code only on the head commit; a push opens the review again", () => {
  const spec = approve("maint", "head1");
  assert.equal(phase(coding({ reviews: [spec] }))[0], "pending", "the approval of the spec is not an approval of the code");
  const code = approve("maint", "head2", at("11:00"));
  assert.equal(phase(coding({ reviews: [spec, code] }))[0], "success");
  assert.deepEqual(phase(coding({ headSha: "head3", reviews: [spec, code] })), ["pending", "Code review open: 0 of 1 needed for, 0 against"]);
  // A review on a commit with the same spec is still a spec vote, never a code approval.
  assert.equal(phase(coding({ headSha: "head3", reviews: [code], specUnchangedSince: { head2: true } }))[0], "pending");
});

test("passes: approvals reach review.threshold and no vote against has weight", () => {
  const ok = approve("maint", "head2");
  assert.deepEqual(phase(coding({ reviews: [ok] })), ["success", "Code phase: spec approved, code reviewed (1 for, 0 against)"]);
  assert.deepEqual(phase(coding({ reviews: [ok, reject("maint2", "head2")] })), ["pending", "Code review open: 1 of 1 needed for, 1 against"]);
  assert.equal(phase(coding({ reviews: [ok, reject("fan", "head2")] }))[0], "success", "a vote against with weight 0 is shown and does not block");
  assert.equal(phase(coding({ reviews: [approve("fan", "head2")] }))[0], "pending", "an approval with weight 0 does not pass it");
  const two = review({ threshold: 2 });
  assert.deepEqual(phase(coding({ reviews: [ok] }), two), ["pending", "Code review open: 1 of 2 needed for, 0 against"]);
  assert.equal(phase(coding({ reviews: [ok, approve("maint2", "head2")] }), two)[0], "success");
  // A person's latest review is their vote.
  assert.equal(phase(coding({ reviews: [ok, reject("maint", "head2", at("11:00"))] }))[0], "pending");
  assert.equal(phase(coding({ reviews: [ok, { user: "maint", state: "DISMISSED", commit: "head2", at: at("11:00") }] }))[0], "pending");
  // The other failures come first.
  assert.equal(phase(coding({ reviews: [ok] }), { ...DEFAULTS, implementation: "maintainers" })[0], "failure");
});

test("author: counts at their own weight when review.count_author is true, never when it is false", () => {
  const own = coding({ author: "maint", authorCanWrite: true });
  assert.deepEqual(phase(own), ["success", "Code phase: spec approved, code reviewed (1 for, 0 against)"], "a maintainer's own code passes with nobody else");
  assert.equal(phase(coding())[0], "pending", "an outsider weighs 0");
  const strict = review({ count_author: false });
  assert.deepEqual(phase(own, strict), ["pending", "Code review open: 0 of 1 needed for, 0 against"]);
  assert.equal(phase({ ...own, reviews: [approve("maint2", "head2")] }, strict)[0], "success");
  assert.equal(phase({ ...own, reviews: [approve("maint", "head2")] }, strict)[0], "pending", "the author's own review is never counted");
  // The spec vote keeps its own setting.
  assert.equal(evaluatePr(pr({ author: "maint" }), strict).statuses.spec.state, "success");
});

test("one-review: spec and code in one commit pass on one approving review of that commit", () => {
  const both = pr({ files: [SPEC_FILE, ...CODE_FILES] });
  let r = evaluatePr(both, DEFAULTS);
  assert.deepEqual([r.statuses.spec.state, r.statuses.phase.state], ["pending", "failure"]);
  assert.match(r.statuses.phase.description, /Code before approval/);
  assert.equal(r.review, null);
  r = evaluatePr({ ...both, reviews: [approve("maint", "head1")] }, DEFAULTS);
  assert.deepEqual([r.statuses.spec.state, r.statuses.phase.state, r.statuses.scope.state], ["success", "success", "success"]);
  assert.equal(r.review!.passed, true);
});

/** A GitHub in memory with one pull request by an outsider: a spec and its code in one commit. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "spectree-"));
  for (const [path, text] of Object.entries({ "roadmap/search/spec.md": GROUP, "src/main.py": "" })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const pull: any = { number: 7, title: "Fresh", user: { login: "outsider" }, head: { sha: "h1" }, body: "", labels: [], html_url: "https://github.com/acme/engine/pull/7", created_at: at("11:00") };
  const w = {
    pull, comments: [] as any[], reviews: [] as any[], statuses: new Map<string, any[]>(), nextId: 100,
    say(user: string, body: string, when: string) {
      const c = { id: w.nextId++, user: { login: user }, body, created_at: when, updated_at: when, reactions: { eyes: 0, confused: 0 } };
      w.comments.push(c);
      return c;
    },
    check: (name: string) => w.statuses.get(pull.head.sha)?.find((s) => s.context === `spectree/${name}`),
    bot: () => w.comments.filter((c) => c.user.login === "github-actions[bot]"),
    async sweep(now: string) {
      const site = join(dir, "_site");
      await run({ gh: gh as unknown as GitHub, workspace: dir, defaultBranch: "main", bot: "github-actions[bot]", siteDir: site, serverUrl: "https://github.com", now, log: () => {} });
      return { data: JSON.parse(readFileSync(join(site, "roadmap.json"), "utf8")), html: readFileSync(join(site, "index.html"), "utf8") };
    },
  };
  const gh = {
    owner: "acme", repo: "engine",
    openPulls: async () => [pull],
    pullFiles: async () => [SPEC_FILE, ...CODE_FILES].map((f) => ({ filename: f.path, status: f.status, sha: f.sha })),
    reviews: async () => w.reviews,
    comments: async () => w.comments,
    statuses: async (sha: string) => w.statuses.get(sha) ?? [],
    canWrite: async (user: string) => user === "maint" || user === "maint2",
    fileAt: async () => LEAF,
    dirTreeSha: async () => "tree-s1",
    setStatus: async (sha: string, context: string, state: string, description: string) => void w.statuses.set(sha, [{ context, state, description }, ...(w.statuses.get(sha) ?? [])]),
    addComment: async (_n: number, body: string) => void w.comments.push({ id: w.nextId++, body, user: { login: "github-actions[bot]" }, created_at: "", updated_at: "" }),
    updateComment: async (id: number, body: string) => void (w.comments.find((c) => c.id === id).body = body),
    addLabel: async (_n: number, label: string) => void pull.labels.push({ name: label }),
    removeLabel: async (_n: number, label: string) => void (pull.labels = pull.labels.filter((l: any) => l.name !== label)),
    closePull: async () => {},
    addReaction: async (id: number, content: string) => void w.comments.find((c) => c.id === id).reactions[content]++,
    issue: async () => ({ reactions: {} }),
    issuesLabeled: async () => [],
    ensureLabel: async () => {},
    commitsSince: async () => [],
    commit: async () => ({}),
  };
  return w;
}

test("commands: for and against count for the code when written after the workflow first saw the head commit; withdraw takes it back", async () => {
  const votes = commandReviews([{ id: 1, user: "maint", body: "/spectree for", at: at("11:00"), acked: false }]);
  assert.equal(phase(coding({ reviews: votes, onHead: { "comment:1": true } }))[0], "success");
  assert.equal(phase(coding({ reviews: votes, onHead: { "comment:1": false } }))[0], "pending");
  assert.equal(phase(coding({ reviews: votes, specUnchangedSince: { "comment:1": true } }))[0], "pending", "a vote on the spec's text is not an approval of the code");
  assert.match(HELP, /Once the spec is approved, it approves the code/);

  const w = world();
  await w.sweep(at("12:00"));
  assert.equal(w.check("phase").state, "failure", "code before approval");
  const first = w.say("maint", "/spectree for", at("12:05"));
  await w.sweep(at("12:06"));
  assert.deepEqual([w.check("spec").state, w.check("phase").description], ["success", "Code phase: spec approved, code reviewed (1 for, 0 against)"]);
  assert.equal(first.reactions.eyes, 1);

  // A push: the command was written before the workflow saw the new head.
  w.pull.head.sha = "h2";
  await w.sweep(at("12:10"));
  assert.deepEqual([w.check("spec").state, w.check("phase").description], ["success", "Code review open: 0 of 1 needed for, 0 against"]);
  const ledger = Object.keys(JSON.parse(/<!-- spectree-seen: (.*?) -->/.exec(w.bot()[0].body)![1]));
  assert.deepEqual(ledger.filter((k) => k.startsWith("head:")), ["head:h2"], "only the current head is kept");
  w.say("maint2", "/spectree against it leaks", at("12:12"));
  w.say("maint", "/spectree for", at("12:15"));
  await w.sweep(at("12:16"));
  assert.equal(w.check("phase").description, "Code review open: 1 of 1 needed for, 1 against");
  w.say("maint2", "/spectree withdraw", at("12:20"));
  await w.sweep(at("12:21"));
  assert.equal(w.check("phase").state, "success");
  w.say("maint", "/spectree withdraw", at("12:25"));
  await w.sweep(at("12:26"));
  assert.equal(w.check("phase").description, "Code review open: 0 of 1 needed for, 0 against");
});

test("off: with review.threshold 0 the phase check succeeds as soon as the code is in, with today's text", () => {
  const off = review({ threshold: 0 });
  assert.deepEqual(phase(coding(), off), ["success", "Code phase: the spec is approved and frozen"]);
  const r = evaluatePr(coding(), off);
  assert.equal(r.review, null);
  assert.doesNotMatch(r.comment!, /Code review/);
  assert.match(r.comment!, /The code goes through normal review/);
});

test("config: review.threshold and review.count_author, with their defaults and errors", () => {
  assert.deepEqual(loadConfig(null).config.review, { threshold: 1, count_author: true });
  const { config, errors } = loadConfig("review: {threshold: 2, count_author: false}");
  assert.deepEqual([config.review, errors], [{ threshold: 2, count_author: false }, []]);
  assert.equal(loadConfig("review: {threshold: 0}").config.review.threshold, 0);
  assert.equal(loadConfig("review: {threshold: 0}").config.review.count_author, true, "a key left out keeps its default");
  assert.match(loadConfig("review: {threshold: -1}").errors[0], /review.threshold must be a number, 0 or more/);
  assert.match(loadConfig("review: {threshold: two}").errors[0], /review.threshold must be a number, 0 or more/);
  assert.match(loadConfig("review: {count_author: 1}").errors[0], /review.count_author must be true or false/);
  assert.match(loadConfig("review: {treshold: 2}").errors[0], /unknown key: review.treshold/);
  assert.match(loadConfig("review: 2").errors[0], /review must be a mapping/);
  assert.equal(loadConfig("review: {threshold: two}").config.review.threshold, 1, "a wrong value keeps the default");
});

test("comment: a Code review table under the spec vote, and a Next line that says who must approve or that it can merge", () => {
  const open = evaluatePr(coding({ reviews: [approve("fan", "head2")] }), DEFAULTS).comment!;
  assert.ok(open.indexOf("**Spec vote: passed**") < open.indexOf("**Code review: open**"), open);
  assert.match(open, /\*\*Code review: open\*\*\n\n\| \| Weighted \| People \|\n\|---\|---\|---\|\n\| For \| 0 of 1 needed \| 2 \|\n\| Against \| 0 \(at most 0\) \| 0 \|\n\n- For: @fan, weight 0\n- For: @outsider, weight 0 \(author\)\n/);
  assert.match(open, /Counted on commit head2\. A new commit asks for the review again\./);
  assert.match(open, /\*\*Next:\*\* The spec is frozen\. The code needs an approving review of the latest commit from someone whose vote has weight\.$/);
  const passed = evaluatePr(coding({ reviews: [approve("maint", "head2")] }), DEFAULTS).comment!;
  assert.match(passed, /\*\*Code review: passed\*\*/);
  assert.match(passed, /- For: @maint, weight 1\n/);
  assert.match(passed, /\*\*Next:\*\* This pull request can merge\.$/);
  assert.doesNotMatch(evaluatePr(pr({ record: RECORD }), DEFAULTS).comment!, /Code review/, "no table before the code is in");
});

test("page: In code review while the code review is open, with its count; Ready to merge when it passed; roadmap.json carries the count", () => {
  const summary = (n: number, input: PrInput): PrSummary => ({ number: n, title: `PR ${n}`, author: input.author, url: `https://github.com/acme/engine/pull/${n}`, opened: at("09:00"), result: evaluatePr(input, DEFAULTS) });
  const other = { path: "roadmap/search/other/spec.md", status: "added", sha: "s9" };
  const prs = [
    summary(1, coding({ number: 1 })),
    summary(2, coding({ number: 2, reviews: [approve("maint", "head2")] })),
    summary(3, pr({ number: 3, files: [other], specContents: { [other.path]: LEAF } })),
  ];
  const data = buildData({ search: parseSpec("search", GROUP).spec! }, prs, DEFAULTS, "acme/engine", at("12:00"));
  const p = Object.fromEntries(data.proposals.map((x) => [x.number, x]));
  assert.deepEqual([p[1].next, p[1].review], ["review", { for: 0, against: 0, needed: 1, passed: false }]);
  assert.deepEqual([p[2].next, p[2].review], ["merge", { for: 1, against: 0, needed: 1, passed: true }]);
  assert.deepEqual([p[3].next, p[3].review], ["votes", null]);
  assert.deepEqual(JSON.parse(JSON.stringify(data)).proposals[0].review, { for: 0, against: 0, needed: 1, passed: false });

  const html = renderHtml(data, DEFAULTS);
  const step = (name: string) => new RegExp(`<tbody data-step="${name}">(.*?)</tbody>`, "s").exec(html)![1];
  assert.match(step("review"), /In code review <span class="muted">1<\/span>/);
  assert.match(step("review"), /#1 PR 1<\/a>/);
  assert.match(step("review"), /<div>Code: 0 of 1 for, 0 against<\/div>/);
  assert.match(step("review"), /<a href="https:\/\/github\.com\/acme\/engine\/pull\/1\/files">Review the code<\/a>: Approve on the latest commit, or comment <code>\/spectree for<\/code>\./);
  assert.match(step("merge"), /Ready to merge <span class="muted">1<\/span>/);
  assert.match(step("merge"), /#2 PR 2<\/a>.*<div>Code: 1 of 1 for, 0 against<\/div>/s);
  assert.doesNotMatch(step("votes"), /Code:/);

  // With the code review off, a proposal with code stays under In code review, as before.
  const off = { ...DEFAULTS, review: { threshold: 0, count_author: true } };
  const old = buildData({}, [{ ...prs[0], result: evaluatePr(coding(), off) }], off, "acme/engine", at("12:00"));
  assert.deepEqual([old.proposals[0].next, old.proposals[0].review], ["review", null]);
  assert.match(renderHtml(old, off), /The code is in\. It is reviewed like any other code\./);
});

test("spec-change: an edited spec reopens the vote and stops the code review; one approval of the new commit passes both", () => {
  const edited = { ...SPEC_FILE, sha: "s2" };
  // The spec was approved on head1 and the code on head2. On head3 the spec's text is another.
  const before = [approve("maint", "head1"), approve("maint", "head2", at("11:00"))];
  const changed = coding({ headSha: "head3", files: [edited, ...CODE_FILES], reviews: before, labels: ["spec-approved"] });
  let r = evaluatePr(changed, DEFAULTS);
  assert.deepEqual([r.statuses.spec.state, r.statuses.spec.description], ["pending", "Vote open: 0 of 1 needed for, 0 against"]);
  assert.deepEqual([r.statuses.phase.state, r.record, r.review, r.removeLabel], ["failure", null, null, true]);
  assert.match(r.statuses.phase.description, /Code before approval/);
  assert.doesNotMatch(r.comment!, /Code review/);
  // One approval of the new commit, with the code still in the pull request.
  r = evaluatePr({ ...changed, reviews: [...before, approve("maint", "head3", at("11:30"))] }, DEFAULTS);
  assert.deepEqual([r.statuses.spec.state, r.statuses.phase.state, r.statuses.scope.state], ["success", "success", "success"]);
  assert.equal(r.review!.passed, true);
  // Put back as it was approved: the vote on that text counts again; the code is on a new commit and waits.
  r = evaluatePr(coding({ headSha: "head4", record: null, reviews: before, specUnchangedSince: { head1: true, head2: true } }), DEFAULTS);
  assert.deepEqual([r.statuses.spec.state, r.statuses.phase.description], ["success", "Code review open: 0 of 1 needed for, 0 against"]);
});
