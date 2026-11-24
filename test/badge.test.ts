import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { badgeOf } from "../src/badge.ts";
import type { DashData, DashNode, DashPr } from "../src/dashboard.ts";
import type { GitHub } from "../src/github.ts";
import { run } from "../src/run.ts";

const node = (id: string, status: DashNode["status"], kind: DashNode["kind"] = "leaf", children: DashNode[] = []): DashNode => ({
  id, name: id, title: id, kind, level: "epic", status, horizon: "", open: [],
  counts: { done: 0, planned: 0, proposed: 0, approved: 0, in_progress: 0 }, summary: "", criteria: [], children, body: "", up: 0, down: 0, thread: "",
});
const NEXT = { spec: "votes", approved: "code", code: "review" } as const;
const proposal = (number: number, phase: "spec" | "approved" | "code", next: DashPr["next"] = NEXT[phase]): DashPr => ({
  number, title: "", author: "", url: "", phase, status: "proposed", valid: next !== "fix", for: 0, against: 0, forPeople: 0, againstPeople: 0,
  next, votes: [], nodes: [], opened: "", since: "", days: 0, days_in_step: 0, stale: false, taken_by: "", review: null,
});
// Only the tree and the proposals are read by the badge.
const data = (proposals: DashPr[]): DashData => ({
  repository: "acme/engine", generated: "", threshold: 1, max_against: 0, levels: ["epic"], proposals,
  tree: [node("search", "done", "group", [node("search/full", "done"), node("search/fast", "in_progress")]), node("ranking", "planned"), node("docs", "done")],
} as unknown as DashData);

test("badge: the shields.io endpoint format, with specs done and proposals open", () => {
  assert.deepEqual(badgeOf(data([proposal(3, "code"), proposal(4, "approved")])), {
    schemaVersion: 1, label: "roadmap", message: "2 done · 2 open", color: "brightgreen",
  });
});

test("badge: a proposal waiting for votes is named and changes the colour", () => {
  const one = badgeOf(data([proposal(3, "spec"), proposal(4, "code")]));
  assert.equal(one.message, "2 done · 2 open · 1 needs votes");
  assert.equal(one.color, "blueviolet");
  assert.equal(badgeOf(data([proposal(3, "spec"), proposal(5, "spec")])).message, "2 done · 2 open · 2 need votes");
  assert.equal(badgeOf(data([proposal(3, "spec", "fix")])).color, "brightgreen", "a spec that is not valid waits for a fix, not for votes");
});

test("badge: the sweep publishes badge.json beside the page", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spectree-"));
  const gh = { owner: "acme", repo: "engine", openPulls: async () => [] } as unknown as GitHub;
  const site = join(dir, "_site");
  await run({ gh, workspace: dir, defaultBranch: "main", bot: "b", siteDir: site, serverUrl: "https://github.com", now: "2026-11-21T00:00:00Z", log: () => {} });
  assert.deepEqual(JSON.parse(readFileSync(join(site, "badge.json"), "utf8")), { schemaVersion: 1, label: "roadmap", message: "0 done · 0 open", color: "brightgreen" });
});
