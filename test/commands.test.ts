import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { signal } from "../src/cli.ts";
import { type CommandComment, HELP, commandReviews, countsNow, parseCommand, sawDigest, takenBy } from "../src/commands.ts";
import type { GitHub } from "../src/github.ts";
import { run } from "../src/run.ts";

const GROUP = "---\ntitle: Search\nkind: group\n---\n";
const LEAF = "---\ntitle: Fresh\npaths: [src/**]\ncriteria:\n  - id: works\n    text: It works.\n    tests: [tests/test_fresh.py]\n---\nWhy.\n";
const SPEC = "roadmap/search/fresh/spec.md";
const at = (hm: string) => `2026-11-30T${hm}:00Z`;

/** A GitHub in memory with one pull request, #7 by an outsider, that adds a spec. The test adds comments and reviews between sweeps. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "spectree-"));
  for (const [path, text] of Object.entries({ "roadmap/search/spec.md": GROUP, "src/main.py": "" })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const pull: any = { number: 7, title: "Fresh", user: { login: "outsider" }, head: { sha: "h1" }, body: "", labels: [], html_url: "https://github.com/acme/engine/pull/7", created_at: at("11:00") };
  const w = {
    dir, pull, specSha: "s1", comments: [] as any[], reviews: [] as any[], statuses: new Map<string, any[]>(), reactions: [] as string[], nextId: 100,
    say(user: string, body: string, when: string) {
      const c = { id: w.nextId++, user: { login: user }, body, created_at: when, updated_at: when, reactions: { eyes: 0, confused: 0 } };
      w.comments.push(c);
      return c;
    },
    review(user: string, state: string, when: string) {
      w.reviews.push({ user: { login: user }, state, commit_id: pull.head.sha, submitted_at: when });
    },
    /** The author changes the spec. */
    push(sha: string, specSha: string) {
      pull.head.sha = sha;
      w.specSha = specSha;
    },
    spec: () => w.statuses.get(pull.head.sha)?.find((s) => s.context === "spectree/spec"),
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
    pullFiles: async () => [{ filename: SPEC, status: "added", sha: w.specSha }],
    reviews: async () => w.reviews,
    comments: async () => w.comments,
    statuses: async (sha: string) => w.statuses.get(sha) ?? [],
    canWrite: async (user: string) => user === "maint" || user === "maint2",
    fileAt: async () => LEAF,
    dirTreeSha: async (commit: string) => `tree-${commit === pull.head.sha ? w.specSha : commit}`,
    setStatus: async (sha: string, context: string, state: string, description: string) => void w.statuses.set(sha, [{ context, state, description }, ...(w.statuses.get(sha) ?? [])]),
    addComment: async (_n: number, body: string) => void w.comments.push({ id: w.nextId++, body, user: { login: "github-actions[bot]" }, created_at: "", updated_at: "" }),
    updateComment: async (id: number, body: string) => void (w.comments.find((c) => c.id === id).body = body),
    addLabel: async (_n: number, label: string) => void pull.labels.push({ name: label }),
    removeLabel: async (_n: number, label: string) => void (pull.labels = pull.labels.filter((l: any) => l.name !== label)),
    closePull: async () => {},
    addReaction: async (id: number, content: string) => {
      w.reactions.push(`${id} ${content}`);
      w.comments.find((c) => c.id === id).reactions[content]++;
    },
  };
  return w;
}
const cc = (id: number, user: string, body: string, when: string): CommandComment => ({ id, user, body, at: when, acked: false });

test("parse: /spectree and a word on the first line, in any case; anything else is not a command or an unknown one", () => {
  assert.deepEqual(parseCommand("/spectree for"), { name: "for", arg: "" });
  assert.deepEqual(parseCommand("  /SpecTree AGAINST it leaves out the hard part \n\nand more text"), { name: "against", arg: "it leaves out the hard part" });
  for (const name of ["withdraw", "take", "status"]) assert.equal(parseCommand(`/spectree ${name}`)!.name, name);
  assert.equal(parseCommand("/spectree approve")!.name, "unknown");
  assert.equal(parseCommand("/spectree")!.name, "unknown");
  assert.equal(parseCommand("I think\n/spectree for"), null, "not on the first line");
  assert.equal(parseCommand("please /spectree for"), null);
  assert.equal(parseCommand("/spectreefor"), null);
  assert.equal(parseCommand("> /spectree for"), null, "a quoted command is not one");
});

test("votes: for, against and withdraw count as reviews do, with the same weights", async () => {
  assert.deepEqual(
    commandReviews([cc(1, "a", "/spectree for", at("12:01")), cc(2, "b", "/spectree against why", at("12:02")), cc(3, "c", "/spectree withdraw", at("12:03")), cc(4, "d", "/spectree take", at("12:04")), cc(5, "e", "hello", at("12:05"))]),
    [
      { user: "a", state: "APPROVED", commit: "comment:1", at: at("12:01") },
      { user: "b", state: "CHANGES_REQUESTED", commit: "comment:2", at: at("12:02") },
      { user: "c", state: "DISMISSED", commit: "comment:3", at: at("12:03") },
    ],
  );
  const w = world();
  await w.sweep(at("12:00"));
  assert.equal(w.spec().state, "pending");
  w.say("fan", "/spectree for", at("12:01"));
  await w.sweep(at("12:02"));
  assert.equal(w.spec().description, "Vote open: 0 of 1 needed for, 0 against", "someone without write access weighs 0");
  assert.match(w.bot()[0].body, /For: @fan, weight 0/);
  w.say("maint", "/spectree for\n\nLooks right to me.", at("12:03"));
  await w.sweep(at("12:04"));
  assert.equal(w.spec().description, "Vote passed: 1 for, 0 against");
  assert.deepEqual(w.pull.labels, [{ name: "spec-approved" }]);

  const no = world();
  await no.sweep(at("12:00"));
  no.say("maint", "/spectree for", at("12:01"));
  no.say("maint2", "/spectree against it is too wide", at("12:02"));
  await no.sweep(at("12:03"));
  assert.equal(no.spec().description, "Vote open: 1 of 1 needed for, 1 against");
  assert.match(no.bot()[0].body, /Against: @maint2, weight 1/);
});

test("latest: one vote per person, the newer of their review and their command; an edit counts from its edit", async () => {
  const w = world();
  await w.sweep(at("12:00"));
  w.review("maint", "APPROVED", at("12:01"));
  await w.sweep(at("12:02"));
  assert.equal(w.spec().state, "success");

  const b = world();
  await b.sweep(at("12:00"));
  b.review("maint", "APPROVED", at("12:01"));
  b.say("maint", "/spectree withdraw", at("12:05"));
  await b.sweep(at("12:06"));
  assert.equal(b.spec().description, "Vote open: 0 of 1 needed for, 0 against", "the command is newer than the review");
  b.review("maint", "APPROVED", at("12:10"));
  await b.sweep(at("12:11"));
  assert.equal(b.spec().state, "success", "and a newer review wins over the command");

  const c = world();
  await c.sweep(at("12:00"));
  const vote = c.say("maint", "/spectree against", at("12:01"));
  await c.sweep(at("12:02"));
  assert.equal(c.spec().description, "Vote open: 0 of 1 needed for, 1 against");
  vote.body = "/spectree for";
  vote.updated_at = at("12:07");
  await c.sweep(at("12:08"));
  assert.equal(c.spec().state, "success", "the edited comment is the vote");
});

test("reset: a command counts only if written after the workflow first saw the spec as it is now", async () => {
  let seen = sawDigest({}, "d1", at("12:00"));
  assert.deepEqual(seen, { d1: at("12:00") });
  assert.equal(sawDigest(seen, "d1", at("13:00")), seen, "the first time stays");
  seen = sawDigest(seen, "d2", at("12:30"));
  const vote = cc(1, "maint", "/spectree for", at("12:10"));
  assert.equal(countsNow(vote, seen, "d1"), true);
  assert.equal(countsNow(vote, seen, "d2"), false, "made before d2 existed");
  assert.equal(countsNow(cc(2, "maint", "/spectree for", at("12:30")), seen, "d2"), true);
  assert.equal(countsNow(vote, seen, "d3"), false, "a spec the workflow has not seen");
  let many: Record<string, string> = {};
  for (let i = 0; i < 30; i++) many = sawDigest(many, `d${i}`, at("12:00"));
  assert.deepEqual([Object.keys(many).length, Object.keys(many)[0]], [20, "d10"]);

  const w = world();
  await w.sweep(at("12:00"));
  const vote7 = w.say("maint", "/spectree for", at("12:05"));
  await w.sweep(at("12:06"));
  assert.equal(w.spec().state, "success");
  // The ledger also keeps when the head commit was first seen, for the code review; this test reads the spec versions.
  const ledger = () => Object.fromEntries(Object.entries(JSON.parse(/<!-- spectree-seen: (.*?) -->/.exec(w.bot()[0].body)![1])).filter(([k]) => !k.startsWith("head:")));
  assert.deepEqual(Object.values(ledger()), [at("12:00")], "kept in the workflow's comment, with the workflow's time");

  // The author changes the spec, and gives the commit any date they like: it is not read.
  w.push("h2", "s2");
  await w.sweep(at("12:20"));
  assert.equal(w.spec().description, "Vote open: 0 of 1 needed for, 0 against", "the vote was on another text");
  assert.deepEqual(Object.values(ledger()), [at("12:00"), at("12:20")]);
  assert.deepEqual(w.pull.labels, []);
  // Said again, it counts.
  w.say("maint", "/spectree for", at("12:25"));
  await w.sweep(at("12:26"));
  assert.equal(w.spec().state, "success");
  // Back to the first text: the first vote was made on it, and counts again, as a review would.
  w.comments.pop();
  w.push("h3", "s1");
  await w.sweep(at("12:40"));
  assert.equal(w.spec().state, "success");
  assert.equal(vote7.reactions.eyes, 1);

  // Written between the push and the workflow's run for it: not counted, and not marked.
  const gap = world();
  await gap.sweep(at("12:00"));
  gap.push("h2", "s2");
  const early = gap.say("maint", "/spectree for", at("12:01"));
  await gap.sweep(at("12:02"));
  assert.equal(gap.spec().state, "pending");
  assert.equal(early.reactions.eyes, 0);
});

test("take: names who will write the code, shown on a proposal that waits for code; withdraw takes it back", async () => {
  assert.equal(takenBy([cc(1, "fan", "/spectree take", at("12:01"))]), "fan");
  assert.equal(takenBy([cc(1, "fan", "/spectree take", at("12:01")), cc(2, "dev", "/spectree take", at("12:02"))]), "dev", "the latest");
  assert.equal(takenBy([cc(2, "dev", "/spectree take", at("12:02")), cc(1, "fan", "/spectree take", at("12:01")), cc(3, "fan", "/spectree withdraw", at("12:03"))]), "dev", "someone else's withdraw changes nothing");
  assert.equal(takenBy([cc(1, "fan", "/spectree take", at("12:01")), cc(3, "Fan", "/spectree withdraw", at("12:03"))]), "");

  const w = world();
  await w.sweep(at("12:00"));
  w.say("fan", "/spectree take", at("12:01"));
  let r = await w.sweep(at("12:02"));
  assert.equal(r.data.proposals[0].taken_by, "fan");
  assert.doesNotMatch(r.html, /Taken by/, "the vote is still open: there is nothing to write yet");
  assert.match(r.html, /Or comment <code>\/spectree for<\/code> or <code>\/spectree against<\/code> on the pull request\./);
  w.say("maint", "/spectree for", at("12:03"));
  r = await w.sweep(at("12:04"));
  assert.equal(r.data.proposals[0].next, "code");
  assert.match(r.html, /<div class="muted">Taken by @fan<\/div>/);
  w.say("fan", "/spectree withdraw", at("12:05"));
  r = await w.sweep(at("12:06"));
  assert.equal(r.data.proposals[0].taken_by, "");
  assert.doesNotMatch(r.html, /Taken by/);
});

test("answer: a mark on a command acted on, a reply to status and to an unknown command, each once", async () => {
  const w = world();
  await w.sweep(at("12:00"));
  const vote = w.say("maint", "/spectree for", at("12:01"));
  const ask = w.say("fan", "/spectree status", at("12:01"));
  const odd = w.say("fan", "/spectree approve", at("12:01"));
  const chat = w.say("fan", "What does /spectree do?", at("12:01"));
  await w.sweep(at("12:02"));
  assert.deepEqual(w.reactions.sort(), [`${vote.id} eyes`, `${ask.id} eyes`, `${odd.id} confused`].sort());
  assert.equal(chat.reactions.eyes + chat.reactions.confused, 0);
  const replies = () => w.bot().slice(1).map((c) => c.body);
  assert.equal(replies().length, 2);
  // The status asked for is the one this run worked out: the vote in the same sweep has passed.
  assert.equal(replies()[0], "@fan where #7 stands:\n\n- Spec: Vote passed: 1 for, 0 against\n- Phase: Spec approved. Add the code to this pull request\n- Scope: No code yet");
  assert.equal(replies()[1], `@fan that is not a command spectree knows.\n\n${HELP}`);
  assert.match(HELP, /`\/spectree for`.*`\/spectree against <reason>`.*`\/spectree withdraw`.*`\/spectree take`.*`\/spectree status`/s);
  await w.sweep(at("12:03"));
  await w.sweep(at("12:04"));
  assert.equal(replies().length, 2, "answered once");
  assert.equal(w.reactions.length, 3);
  assert.equal(w.bot()[0].body.startsWith("<!-- spectree -->"), true);
  assert.ok(replies().every((b) => !b.startsWith("<!-- spectree -->")), "a reply is never taken for the workflow's own comment");
});

test("signal: the signal workflow runs on comments as well as reviews, with no permissions", () => {
  assert.match(signal, /on:\n  pull_request_review:\n    types: \[submitted, edited, dismissed\]\n(  #.*\n)?  issue_comment:\n    types: \[created, edited\]\n/);
  assert.match(signal, /\npermissions: \{\}\n/);
  assert.doesNotMatch(signal, /secrets|checkout|GITHUB_TOKEN/);
  assert.equal(readFileSync(new URL("../.github/workflows/spectree-signal.yml", import.meta.url), "utf8"), signal, "this repository runs the file init writes");
});
