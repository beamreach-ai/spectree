import type { Config } from "./config.ts";
import type { NodeChange, Phase, PrResult } from "./evaluate.ts";
import { findScript, writeView } from "./find.ts";
import { renderMarkdown } from "./markdown.ts";
import { type Criterion, type Spec, levelName } from "./tree.ts";

export type NodeStatus = "done" | "planned" | "proposed" | "approved" | "in_progress";

export interface OpenChange {
  pr: number;
  status: NodeStatus;
  change: NodeChange["change"];
}

export interface DashNode {
  id: string;
  name: string;
  title: string;
  kind: "leaf" | "group";
  level: string;
  status: NodeStatus;
  /** For a planned leaf: its horizon, e.g. `now`. */
  horizon: string;
  /** Open pull requests that add, change or remove this node. */
  open: OpenChange[];
  /** For a group: how many leaves below it have each status. */
  counts: Record<NodeStatus, number>;
  /** The first paragraph of the spec's body: what it is for. */
  summary: string;
  /** The default branch's criteria, or the proposed ones for a node that is not there yet. */
  criteria: Criterion[];
  /** The spec's body, as Markdown: the default branch's, or the proposed one for a node that is not there yet. */
  body: string;
  /** Demand: distinct people with a thumbs-up, and with a thumbs-down, on the spec's thread or on the pull request that adds it. */
  up: number;
  down: number;
  /** The address of the spec's thread; empty when nobody has opened it. */
  thread: string;
  children: DashNode[];
}

/** What an open proposal waits for. */
export type NextStep = "fix" | "votes" | "code" | "review" | "merge";

export interface DashVote {
  user: string;
  vote: "for" | "against";
  weight: number;
}

export interface DashPr {
  number: number;
  title: string;
  author: string;
  url: string;
  phase: Phase;
  status: NodeStatus;
  valid: boolean;
  for: number;
  against: number;
  forPeople: number;
  againstPeople: number;
  next: NextStep;
  votes: DashVote[];
  nodes: string[];
  /** When the pull request was opened; empty when not known. */
  opened: string;
  /** When it entered the step it is in: the approval for code, review and merge, the opening otherwise. */
  since: string;
  /** Whole days since it was opened, and since it entered its step. */
  days: number;
  days_in_step: number;
  /** In its step for longer than `dashboard.stale_days`. */
  stale: boolean;
  /** Who said they will write the code; empty when nobody did. */
  taken_by: string;
  /** The code review; null outside the code phase and when the project has none. */
  review: { for: number; against: number; needed: number; passed: boolean } | null;
}

/** One line of the overview: a top-level node, or the whole roadmap. */
export interface OverviewRow {
  /** The node's id; empty for the row of the whole roadmap. */
  id: string;
  title: string;
  /** Leaves in every status. */
  total: number;
  counts: Record<NodeStatus, number>;
  /** Planned leaves per horizon; the empty horizon is `planned: true`. */
  horizons: Record<string, number>;
}

export interface Overview {
  /** The horizons in use, in the order of the columns. */
  horizons: string[];
  rows: OverviewRow[];
  all: OverviewRow;
}

export interface DashData {
  repository: string;
  generated: string;
  threshold: number;
  max_against: number;
  levels: string[];
  /** The default branch, for links that open GitHub's forms. */
  branch: string;
  /** The specs not done that most people want, most wanted first. */
  wanted: { id: string; title: string; up: number }[];
  /** What changed in the last `dashboard.recent_days`, newest first; null when the run could not tell. */
  recent: RecentEntry[] | null;
  /** Specs done in the last 30 and 90 days; null when the run could not tell. */
  pace: { d30: number; d90: number } | null;
  proposals: DashPr[];
  overview: Overview;
  tree: DashNode[];
}

export const THREAD_LABEL = "spectree";
export interface Demand {
  up: number;
  down: number;
}
export interface Thread extends Demand {
  number: number;
  url: string;
}
export interface Merge {
  sha: string;
  at: string;
  title: string;
  url: string;
  /** Ids of the specs the commit added. */
  added: string[];
  /** Ids of the planned leaves the commit turned into built ones. */
  built: string[];
}
/** One line of what changed lately. */
export interface RecentEntry {
  kind: NodeStatus;
  at: string;
  title: string;
  url: string;
  ids: string[];
}
/** What the page needs beyond the specs and the pull requests. */
export interface Extra {
  branch?: string;
  /** Threads by spec id. */
  threads?: Record<string, Thread>;
  /** Reactions on a pull request's description, by its number. */
  reactions?: Record<number, Demand>;
  /** Commits on the default branch that added specs or started building planned ones. Absent when not known. */
  merges?: Merge[];
}
/** GitHub's summary of reactions on a post. One person has one of each, so the counts are people. */
export const demandOf = (reactions: any): Demand => ({ up: Number(reactions?.["+1"] ?? 0), down: Number(reactions?.["-1"] ?? 0) });

/** The file GitHub's new-file form opens with. It is a valid spec as it stands. */
export const TEMPLATE = `---
title: "What it does, in a few words"
paths:
  - src/**
criteria:
  - id: first
    text: "One thing that is true when this is built."
    tests: [test/first.test.ts]
---

Why this is needed, in a paragraph.

Not in this spec: what it leaves out.
`;

export interface PrSummary {
  number: number;
  title: string;
  author: string;
  url: string;
  /** When the pull request was opened. */
  opened?: string;
  /** Who said, with `/spectree take`, that they will write the code. */
  taken?: string;
  result: PrResult;
}

/** The first paragraph of a spec body that is prose: not a heading, a list, a table or code. */
export function summaryOf(body: string, max = 360): string {
  const para = body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|```|[-*+] |\d+\. |\||>)/.test(p));
  if (!para) return "";
  const flat = para.replace(/\s+/g, " ");
  return flat.length > max ? flat.slice(0, max).replace(/\s+\S*$/, "") + "…" : flat;
}

function nextOf(r: PrResult): NextStep {
  if (r.errors.length) return "fix";
  if (r.phase === "spec") return "votes";
  if (r.phase === "code") return r.review?.passed && r.statuses.phase.state === "success" && r.statuses.scope.state === "success" ? "merge" : "review";
  return r.statuses.phase.state === "pending" ? "code" : "merge";
}

const statusOf = (phase: Phase): NodeStatus => (phase === "code" ? "in_progress" : phase === "approved" ? "approved" : "proposed");
const zero = (): Record<NodeStatus, number> => ({ done: 0, planned: 0, proposed: 0, approved: 0, in_progress: 0 });

const FIRST_HORIZONS = ["now", "next", "later"];
const sum = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

/** The overview's numbers, from the tree's own counts. */
export function overviewOf(roots: DashNode[]): Overview {
  const all: OverviewRow = { id: "", title: "All", total: 0, counts: zero(), horizons: {} };
  const rows = roots.map((root): OverviewRow => {
    const horizons: Record<string, number> = {};
    const walk = (n: DashNode) => {
      if (n.kind === "leaf" && n.status === "planned") horizons[n.horizon] = (horizons[n.horizon] ?? 0) + 1;
      n.children.forEach(walk);
    };
    walk(root);
    for (const s of ORDER) all.counts[s] += root.counts[s];
    for (const [h, v] of Object.entries(horizons)) all.horizons[h] = (all.horizons[h] ?? 0) + v;
    return { id: root.id, title: root.title, total: sum(root.counts), counts: { ...root.counts }, horizons };
  });
  all.total = sum(all.counts);
  // now, next, later; then the others alphabetically; `planned: true` last.
  const rank = (h: string) => (h === "" ? 2 : FIRST_HORIZONS.includes(h) ? 0 : 1);
  const horizons = Object.keys(all.horizons).sort(
    (a, b) => rank(a) - rank(b) || (rank(a) === 0 ? FIRST_HORIZONS.indexOf(a) - FIRST_HORIZONS.indexOf(b) : a < b ? -1 : a > b ? 1 : 0),
  );
  return { horizons, rows, all };
}

/** What changed lately, from the commits that reached the default branch and the open proposals. */
function recentOf(flat: Map<string, DashNode>, proposals: DashPr[], merges: Merge[] | undefined, cfg: Config, now: string): Pick<DashData, "recent" | "pace"> {
  const window = cfg.dashboard.recent_days;
  if (!merges || window <= 0) return { recent: null, pace: null };
  const within = (at: string, days: number) => at !== "" && Date.parse(now) - Date.parse(at) <= days * 86_400_000;
  const recent: RecentEntry[] = [];
  const pace = { d30: 0, d90: 0 };
  for (const m of merges) {
    // A spec the commit added counts as what it is today: done, or planned and waiting to be built.
    const now_ = (status: NodeStatus) => m.added.filter((id) => flat.get(id)?.kind === "leaf" && flat.get(id)!.status === status);
    const done = [...new Set([...now_("done"), ...m.built.filter((id) => flat.get(id)?.status === "done")])];
    if (within(m.at, 30)) pace.d30 += done.length;
    if (within(m.at, 90)) pace.d90 += done.length;
    if (!within(m.at, window)) continue;
    // One commit is one line, however many specs it brought.
    for (const [kind, ids] of [["done", done], ["planned", now_("planned")]] as [NodeStatus, string[]][])
      if (ids.length) recent.push({ kind, at: m.at, title: ids.length === 1 ? flat.get(ids[0])!.title : m.title, url: m.url, ids });
  }
  for (const p of proposals) {
    const past = p.next !== "votes" && p.next !== "fix";
    const at = past ? p.since : p.opened;
    if (within(at, window)) recent.push({ kind: past ? "approved" : "proposed", at, title: p.title, url: p.url, ids: p.nodes });
  }
  recent.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.title < b.title ? -1 : 1));
  return { recent, pace };
}

/** The roadmap: the default branch's nodes are done; open spec pull requests add the other three statuses. */
export function buildData(mainSpecs: Record<string, Spec>, prs: PrSummary[], cfg: Config, repository: string, now: string, extra: Extra = {}): DashData {
  const flat = new Map<string, DashNode>();
  const make = (id: string, title: string, kind: "leaf" | "group", status: NodeStatus, body: string, criteria: Criterion[], horizon = ""): DashNode => ({
    id, horizon, name: id.split("/").pop()!, title, kind, level: levelName(id, cfg.levels), status, open: [], counts: zero(),
    summary: summaryOf(body), criteria, body, up: 0, down: 0, thread: "", children: [],
  });
  for (const s of Object.values(mainSpecs))
    flat.set(s.id, make(s.id, s.title, s.kind, s.planned === null ? "done" : "planned", s.body, s.criteria, s.planned ?? ""));

  const proposals: DashPr[] = [];
  for (const p of prs) {
    const r = p.result;
    if (r.phase === "none" || r.phase === "missing") continue;
    const status = statusOf(r.phase);
    const next = nextOf(r);
    const opened = p.opened ?? "";
    const since = next !== "votes" && next !== "fix" && r.record ? r.record.at : opened;
    const daysSince = (t: string) => (t ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(t)) / 86_400_000)) : 0);
    const stale = cfg.dashboard.stale_days > 0 && daysSince(since) > cfg.dashboard.stale_days;
    proposals.push({
      opened, since, days: daysSince(opened), days_in_step: daysSince(since), stale, taken_by: p.taken ?? "",
      number: p.number, title: p.title, author: p.author, url: p.url, phase: r.phase, status, valid: r.errors.length === 0,
      for: r.tally?.for ?? 0, against: r.tally?.against ?? 0, forPeople: r.tally?.forPeople ?? 0, againstPeople: r.tally?.againstPeople ?? 0,
      next, votes: (r.tally?.votes ?? []).map(({ user, vote, weight }) => ({ user, vote, weight })),
      nodes: r.nodes.map((n) => n.id),
      review: r.review ? { for: r.review.for, against: r.review.against, needed: cfg.review.threshold, passed: r.review.passed } : null,
    });
    for (const n of r.nodes) {
      // A planned leaf takes no code: once its vote passes it is planned, never in progress.
      const own = n.planned !== null && r.phase !== "spec" ? "planned" : status;
      let node = flat.get(n.id);
      if (!node) flat.set(n.id, (node = make(n.id, n.title, n.kind, own, n.body, n.criteria, n.planned ?? "")));
      node.open.push({ pr: p.number, status: own, change: n.change });
    }
  }
  proposals.sort((a, b) => a.number - b.number);

  const roots: DashNode[] = [];
  const ids = [...flat.keys()].sort();
  for (const id of ids) {
    const node = flat.get(id)!;
    const parent = id.includes("/") ? flat.get(id.slice(0, id.lastIndexOf("/"))) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const roll = (n: DashNode): Record<NodeStatus, number> => {
    // A leaf counts itself, and a leaf with specs under it counts them too.
    if (n.kind === "leaf") n.counts[n.status] = 1;
    for (const c of n.children) for (const [k, v] of Object.entries(roll(c))) n.counts[k as NodeStatus] += v;
    return n.counts;
  };
  roots.forEach(roll);
  const wanted: DashData["wanted"] = [];
  if (cfg.demand.enabled) {
    for (const node of flat.values()) {
      const t = extra.threads?.[node.id];
      if (t) node.thread = t.url;
      const d: Demand | undefined = mainSpecs[node.id] ? t : (extra.reactions?.[node.open.find((o) => o.change === "added")?.pr ?? -1] ?? t);
      if (d) (node.up = d.up), (node.down = d.down);
      if (node.up > 0 && node.status !== "done") wanted.push({ id: node.id, title: node.title, up: node.up });
    }
    wanted.sort((a, b) => b.up - a.up || (a.id < b.id ? -1 : 1));
    wanted.length = Math.min(wanted.length, cfg.demand.top);
  }
  return { repository, generated: now, threshold: cfg.threshold, max_against: cfg.max_against, levels: cfg.levels, branch: extra.branch || "main", wanted, ...recentOf(flat, proposals, extra.merges, cfg, now), proposals, overview: overviewOf(roots), tree: roots };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Escaped text with the inline Markdown a spec body uses: `code`, **bold**, [links](...). Links keep their text only. */
const inline = (s: string) =>
  esc(s)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
const LABEL: Record<NodeStatus, string> = { done: "Done", planned: "Planned", in_progress: "In progress", approved: "Approved", proposed: "Proposed" };
const ORDER: NodeStatus[] = ["done", "in_progress", "approved", "proposed", "planned"];
const pill = (s: NodeStatus, text = LABEL[s]) => `<span class="pill ${s}">${esc(text)}</span>`;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const STAGES: NodeStatus[] = ["in_progress", "approved", "proposed"];

function renderOverview(o: Overview, first: string): string {
  if (!o.rows.length) return "";
  // A number links to the tree narrowed to what it counts.
  const num = (n: number, top: string, status: string, horizon: string | null) =>
    `<td class="num">${n ? `<a href="?${esc(writeView({ q: "", status, horizon, top }))}#specs">${n}</a>` : ""}</td>`;
  const row = (r: OverviewRow) => {
    const pct = r.total ? Math.round((r.counts.done / r.total) * 100) : 0;
    const name = r.id ? `<a href="#spec-${esc(r.id)}">${esc(r.title)}</a>` : esc(r.title);
    return `<tr${r.id ? "" : ' class="all"'}><th scope="row">${name}</th><td class="progress"><span class="bar"><span style="width:${pct}%"></span></span> ${r.counts.done} of ${r.total} done</td>${STAGES.map(
      (s) => num(r.counts[s], r.id, s, null),
    ).join("")}${o.horizons.map((h) => num(r.horizons[h] ?? 0, r.id, "", h)).join("")}</tr>`;
  };
  const stages = STAGES.map((s) => `<th class="num stage"${o.horizons.length ? ' rowspan="2"' : ""}>${LABEL[s]}</th>`).join("");
  const span = o.horizons.length ? ' rowspan="2"' : "";
  const planned = o.horizons.length
    ? `<th class="num group" colspan="${o.horizons.length}">Planned</th></tr><tr>${o.horizons.map((h) => `<th class="num">${esc(h || "no horizon")}</th>`).join("")}`
    : "";
  return `<h2>Overview</h2>
<div class="box"><table class="overview"><thead><tr><th${span}>${esc(first)}</th><th${span}>Progress</th>${stages}${planned}</tr></thead><tbody>${o.rows
    .map(row)
    .join("")}${row(o.all)}</tbody></table></div>`;
}

const HORIZON_CLASS: Record<string, string> = { now: "now", next: "next", later: "later" };
const bar = (done: number, total: number) => `<span class="bar"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></span>`;
const STEPS: NextStep[] = ["votes", "fix", "code", "review", "merge"];
const STEP_TITLE: Record<NextStep, string> = {
  votes: "Needs votes",
  fix: "Needs a fix to the spec",
  code: "Approved, waiting for code",
  review: "In code review",
  merge: "Ready to merge",
};
const days = (n: number) => (n === 0 ? "today" : n === 1 ? "1 day" : `${n} days`);

/** The specs of a proposal: listed when few, otherwise a count and the node they share, opening to the list. */
function renderSpecs(nodes: string[]): string {
  const codes = nodes.map((n) => `<code>${esc(n)}</code>`).join(" ");
  if (nodes.length <= 3) return `<div>${codes}</div>`;
  const parts = nodes.map((n) => n.split("/"));
  let shared = 0;
  while (parts.every((p) => p.length > shared + 1 && p[shared] === parts[0][shared])) shared++;
  const where = shared ? ` in <code>${esc(parts[0].slice(0, shared).join("/"))}</code>` : "";
  return `<details class="specs"><summary>${nodes.length} specs${where}</summary>${codes}</details>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RECENT_SHOWN = 8;

function renderRecent(data: DashData, window: number): string {
  if (!data.recent || !data.pace) return "";
  const pace = `Specs done: ${data.pace.d30} in the last 30 days, ${data.pace.d90} in the last 90.`;
  if (!data.recent.length) return `<h2>Lately</h2>\n<p class="muted">Nothing changed in the last ${plural(window, "day")}. ${pace}</p>`;
  const line = (e: RecentEntry) => {
    const d = new Date(e.at);
    return `<li><span class="muted when">${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}</span> ${pill(e.kind)} <a href="${esc(e.url)}">${esc(e.title)}</a>${
      e.ids.length > 1 ? ` <span class="muted">${e.ids.length} specs</span>` : ""
    }</li>`;
  };
  const more = data.recent.length - RECENT_SHOWN;
  return `<h2>Lately</h2>\n<ul class="recent">${data.recent.slice(0, RECENT_SHOWN).map(line).join("")}</ul><p class="muted">${
    more > 0 ? `And ${more} more in the last ${plural(window, "day")}. ` : ""
  }${pace}</p>`;
}

function renderQueue(data: DashData): string {
  if (!data.proposals.length) return `<p class="muted">No open spec pull requests.</p>`;
  const row = (p: DashPr) => {
    const age = p.opened
      ? ` · opened ${p.days ? days(p.days) + " ago" : "today"}${p.days_in_step !== p.days ? ` · ${p.days_in_step ? days(p.days_in_step) : "since today"} in this step` : ""}`
      : "";
    return `<tr><td><a href="${p.url}">#${p.number} ${esc(p.title)}</a><div class="muted">by ${esc(p.author)}${age}${
      p.stale ? ' <span class="pill bad">stale</span>' : ""
    }</div>${renderSpecs(p.nodes)}${p.taken_by && p.next === "code" ? `<div class="muted">Taken by @${esc(p.taken_by)}</div>` : ""}</td><td>${pill(p.status)}${p.valid ? "" : ' <span class="pill bad">spec not valid</span>'}</td><td>${renderVotes(
      p,
      data.threshold,
    )}</td><td>${renderNext(p)}</td></tr>`;
  };
  const groups = STEPS.map((step) => {
    // The one that has waited longest in its step comes first.
    const list = data.proposals.filter((p) => p.next === step).sort((a, b) => b.days_in_step - a.days_in_step || a.number - b.number);
    return list.length ? `<tbody data-step="${step}"><tr class="step"><th colspan="4">${STEP_TITLE[step]} <span class="muted">${list.length}</span></th></tr>${list.map(row).join("")}</tbody>` : "";
  }).join("");
  return `<table class="queue"><thead><tr><th>Pull request</th><th>Status</th><th>Vote</th><th>Waiting for</th></tr></thead>${groups}</table>`;
}

const NEXT: Record<NextStep, string> = {
  fix: "A fix to the spec",
  votes: "Votes",
  code: "Code",
  review: "Code review",
  merge: "Merge",
};
const CONTRIBUTING = "https://github.com/beamreach-ai/spectree/blob/main/docs/contributing-with-specs.md";

interface Ctx {
  repoUrl: string;
  root: string;
  closed: boolean;
  branch: string;
  demand: boolean;
  prs: Map<number, DashPr>;
  threshold: number;
}
const enc = encodeURIComponent;
const newSpecUrl = (c: Pick<Ctx, "repoUrl" | "branch" | "root">, under: string) =>
  `${c.repoUrl}/new/${enc(c.branch)}?filename=${enc(`${c.root}/${under ? under + "/" : ""}new-spec/spec.md`)}&value=${enc(TEMPLATE)}`;

/** The whole body, where the spec stands, and what a visitor can do with it. */
function renderMore(n: DashNode, c: Ctx): string {
  const specPath = `${c.root}/${n.id}/spec.md`;
  const adds = n.open.find((o) => o.change === "added");
  const inMain = !adds;
  const whole =
    n.body.trim() && n.body.replace(/\s+/g, " ").trim() !== n.summary
      ? `<details class="whole"><summary>The whole spec</summary><div class="md">${renderMarkdown(n.body, (p) => `${c.repoUrl}/blob/${enc(c.branch)}/${p}`)}</div></details>`
      : "";
  const stands: string[] = [n.status === "planned" && n.horizon ? `Planned: ${esc(n.horizon)}` : LABEL[n.status]];
  if (adds) stands.push(`proposed in <a href="${c.repoUrl}/pull/${adds.pr}">#${adds.pr}</a>, not in the default branch yet`);
  for (const o of n.open) {
    const p = c.prs.get(o.pr);
    const tally = p ? `: ${p.for} of ${c.threshold} for, ${p.against} against` : "";
    if (o !== adds) stands.push(`<a href="${c.repoUrl}/pull/${o.pr}">#${o.pr}</a> proposes to ${o.change === "removed" ? "remove it" : "change it"}${tally}; the text here is the default branch's`);
    else if (tally) stands.push(`vote${tally}`);
  }
  if (c.demand && (n.up || n.down)) stands.push(`${n.up} 👍${n.down ? `, ${n.down} 👎` : ""}`);
  const act: string[] = [];
  const link = (href: string, text: string, title = "") => act.push(`<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}>${text}</a>`);
  const editUrl = `${c.repoUrl}/edit/${enc(c.branch)}/${specPath}`;
  if (inMain) {
    link(editUrl, "Edit", "Opens GitHub's editor; saving proposes the change in a pull request");
    if (c.demand)
      link(
        n.thread ||
          `${c.repoUrl}/issues/new?title=${enc(n.id)}&labels=${THREAD_LABEL}&body=${enc(`The thread of the spec \`${n.id}\`: ${c.repoUrl}/blob/${c.branch}/${specPath}\n\nA 👍 on this post says you want it. Discussion goes below.`)}`,
        n.thread ? "Discuss or 👍" : "Start its thread",
        "A thumbs-up on the thread's first post says you want this spec",
      );
    link(newSpecUrl(c, n.id), "Add a spec below");
    if (n.kind === "leaf" && n.status === "planned") link(editUrl, "Build this", "Remove planned, add paths and criteria, and bring the code in the same pull request");
  } else {
    link(`${c.repoUrl}/pull/${adds.pr}/files`, "Edit", "The spec is in this pull request; changes go there");
    link(`${c.repoUrl}/pull/${adds.pr}`, c.demand ? "Discuss or 👍" : "Discuss", "A thumbs-up on the pull request's description says you want this spec");
    if (n.kind === "leaf" && n.status === "approved") link(`${c.repoUrl}/pull/${adds.pr}`, "Take it", `Write the code in that pull request, or in your own whose description says Implements: #${adds.pr}`);
  }
  return `${whole}<p class="muted stands">${stands.join(" · ")}</p><p class="actions">${act.join(" ")}</p>`;
}

function renderDetail(n: DashNode, c: Ctx): string {
  const where = `<p class="muted where"><span class="level">${esc(n.level)}</span> <code>${esc(n.id)}</code></p>`;
  const summary = n.summary ? `<p>${inline(n.summary)}</p>` : "";
  const criteria = n.criteria.length
    ? `<ol class="criteria">${n.criteria
        .map((c) => `<li><span>${inline(c.text)}</span> <span class="muted">Tested in ${c.tests.map((t) => `<code>${esc(t)}</code>`).join(", ")}</span></li>`)
        .join("")}</ol>`
    : "";
  return `<div class="detail">${where}${summary}${criteria}${renderMore(n, c)}</div>`;
}

function renderFind(data: DashData): string {
  if (!data.tree.length) return "";
  const option = (value: string, text: string) => `<option value="${esc(value)}">${esc(text)}</option>`;
  const o = data.overview;
  const horizon = o.horizons.length
    ? `<select name="horizon" aria-label="Horizon">${option("", "Any horizon")}${o.horizons.map((h) => option(`h:${h}`, h || "no horizon")).join("")}</select>`
    : "";
  return `<form class="find" id="find" role="search" hidden><input type="search" name="q" placeholder="Search specs…" aria-label="Search specs" autocomplete="off"><select name="status" aria-label="Status">${option(
    "",
    "Any status",
  )}${ORDER.map((s) => option(s, LABEL[s])).join("")}</select>${horizon}<select name="top" aria-label="${esc(data.levels[0] ?? "spec")}">${option(
    "",
    `Any ${data.levels[0] ?? "spec"}`,
  )}${o.rows.map((r) => option(r.id, r.title)).join("")}</select><span class="muted" id="find-count" aria-live="polite"></span><button type="reset" id="find-clear" hidden>Clear</button></form>`;
}

function renderNode(n: DashNode, c: Ctx): string {
  const { repoUrl, root, closed } = c;
  const total = ORDER.reduce((a, s) => a + n.counts[s], 0);
  const counts =
    n.kind === "group"
      ? `${bar(n.counts.done, total)}<span class="muted">${n.counts.done} of ${total} done</span> ${STAGES.filter((s) => n.counts[s])
          .map((s) => pill(s, `${n.counts[s]} ${LABEL[s].toLowerCase()}`))
          .join(" ")}${n.counts.planned ? ` <span class="muted">${n.counts.planned} planned</span>` : ""}`
      : "";
  const mark =
    n.status !== "planned" ? pill(n.status) : `<span class="pill hz hz-${HORIZON_CLASS[n.horizon] ?? "other"}">${esc(n.horizon || "Planned")}</span>`;
  const open = n.open
    .map((o) => `<a class="pr" href="${repoUrl}/pull/${o.pr}">#${o.pr} ${o.change === "added" ? "" : o.change + ", "}${LABEL[o.status].toLowerCase()}</a>`)
    .join(" ");
  // A node that an open pull request adds is not in the default branch yet, whatever its status.
  const inMain = (n.status === "done" || n.status === "planned") && !n.open.some((o) => o.change === "added");
  const href = inMain ? `${repoUrl}/blob/HEAD/${root}/${n.id}/spec.md` : n.open[0] ? `${repoUrl}/pull/${n.open[0].pr}` : "#";
  const many = n.criteria.length ? `<span class="muted">${plural(n.criteria.length, "criterion", "criteria")}</span>` : "";
  const head = `<a class="title" title="${esc(n.title)}" href="${href}">${esc(n.title)}</a> ${n.kind === "leaf" ? mark : counts} ${
    inMain || n.kind === "group" ? open : ""
  } ${many}${c.demand && n.up ? ` <span class="want" title="${plural(n.up, "person wants", "people want")} this">👍 ${n.up}</span>` : ""}`;
  const detail = renderDetail(n, c);
  const kids = n.children.length ? `<ul>${n.children.map((k) => renderNode(k, c)).join("")}</ul>` : "";
  const text = `${n.title} ${n.id} ${n.summary}`.toLowerCase();
  const li = `<li class="node" id="spec-${esc(n.id)}" data-kind="${n.kind}" data-status="${n.status}" data-horizon="${esc(n.horizon)}" data-text="${esc(text)}">`;
  return `${li}<details${kids && !closed ? " open" : ""}><summary class="row">${head}</summary>${detail}${kids}</details></li>`;
}

function renderVotes(p: DashPr, threshold: number): string {
  const who = (v: "for" | "against") =>
    p.votes
      .filter((x) => x.vote === v)
      .map((x) => `@${esc(x.user)}${x.weight === 1 ? "" : ` (weight ${x.weight})`}`)
      .join(", ");
  // Once the vote has passed with nobody but the author voting, the numbers say nothing.
  const code = p.review ? `<div>Code: ${p.review.for} of ${p.review.needed} for, ${p.review.against} against</div>` : "";
  if (p.next !== "votes" && p.next !== "fix" && p.votes.every((v) => v.user === p.author)) return `<div>${code ? "Spec approved" : "Approved"}</div>${code}`;
  const lines = [`<div>${code ? "Spec: " : ""}${p.for} of ${threshold} for, ${p.against} against</div>`];
  if (who("for")) lines.push(`<div class="muted">For: ${who("for")}</div>`);
  if (who("against")) lines.push(`<div class="muted">Against: ${who("against")}</div>`);
  return lines.join("") + code;
}

function renderNext(p: DashPr): string {
  const hint: Record<NextStep, string> = {
    fix: "The spec has problems. The vote starts when it is valid.",
    votes: `<a href="${p.url}/files">Review the spec</a>: Approve is for, Request changes is against. Or comment <code>/spectree for</code> or <code>/spectree against</code> on the pull request.`,
    code: "The spec is approved and frozen. The code goes in this pull request, or in another with <code>Implements: #" + p.number + "</code>.",
    review: p.review
      ? `<a href="${p.url}/files">Review the code</a>: Approve on the latest commit, or comment <code>/spectree for</code>.`
      : "The code is in. It is reviewed like any other code.",
    merge: "Nothing left. It can merge.",
  };
  return `<div class="next">${NEXT[p.next]}</div><div class="muted">${hint[p.next]}</div>`;
}

export function renderHtml(data: DashData, cfg: Config, serverUrl = "https://github.com"): string {
  const repoUrl = `${serverUrl}/${data.repository}`;
  const name = data.repository.split("/").pop()!;
  const first = data.levels[0] ? data.levels[0][0].toUpperCase() + data.levels[0].slice(1) : "Spec";
  // A large roadmap opens with its groups closed.
  const over = cfg.dashboard.collapse_over;
  const closed = over > 0 && data.overview.all.total > over;
  const known = { statuses: ORDER as string[], horizons: data.overview.horizons, tops: data.overview.rows.map((r) => r.id) };
  const ctx: Ctx = {
    repoUrl, root: cfg.root, closed, branch: data.branch, demand: cfg.demand.enabled, threshold: data.threshold,
    prs: new Map(data.proposals.map((p) => [p.number, p])),
  };
  const wanted = data.wanted.length
    ? `<h2>Most wanted</h2>\n<ol class="wanted">${data.wanted
        .map((w) => `<li><a href="#spec-${esc(w.id)}">${esc(w.title)}</a> <span class="want">👍 ${w.up}</span></li>`)
        .join("")}</ol>`
    : "";
  const proposals = renderQueue(data);
  const fresh = !data.tree.length && !data.proposals.length;
  const tree = data.tree.length
    ? `<ul class="tree">${data.tree.map((n) => renderNode(n, ctx)).join("")}</ul>`
    : `<div class="empty"><p><strong>No specs yet.</strong> A spec is a file, <code>${esc(cfg.root)}/&lt;name&gt;/spec.md</code>, that says what one part of the project does and names the tests that prove it. Add the first one in a pull request.</p><p>To check the tree on your machine:</p><pre>npx github:beamreach-ai/spectree validate
npx github:beamreach-ai/spectree tree</pre></div>`;
  const against = data.max_against === 0 ? "none against" : `at most ${data.max_against} against`;
  const intro = `<details class="how" id="how" open><summary>How changes are made here</summary><ol class="steps"><li><strong>Propose.</strong> Every change to ${esc(
    name,
  )} starts as a spec under <code>${esc(cfg.root)}/</code>, proposed in a pull request.</li><li><strong>Vote.</strong> People vote with reviews: Approve is for, Request changes is against. A spec passes with ${plural(
    data.threshold,
    "weighted vote",
  )} for and ${against}. People with write access weigh 1, and everyone else's vote is shown.</li><li><strong>Build.</strong> After the vote, the code is added to the same pull request and spec and code merge together.</li></ol><p class="muted"><a href="${CONTRIBUTING}">How to propose a spec and vote</a>.</p></details>`;
  // Remembers, in this browser only, that the visitor closed the steps.
  const howScript = `(function () {
  var how = document.getElementById("how");
  if (!how) return;
  try {
    if (localStorage.getItem("spectree-how") === "closed") how.open = false;
    how.addEventListener("toggle", function () { localStorage.setItem("spectree-how", how.open ? "open" : "closed"); });
  } catch (e) {}
})();`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} roadmap</title>
<meta name="description" content="The roadmap of ${esc(data.repository)}: every spec, its status, and the open proposals with their votes.">
<style>
:root{--bg:#fbfcfd;--fg:#14202b;--muted:#5b6b79;--line:#dce4ea;--card:#fff;--link:#00699f;
--done:#1d7a4f;--done-bg:#e3f4ea;--prog:#8a5a00;--prog-bg:#fdf0d2;--appr:#00699f;--appr-bg:#e1f1fa;--prop:#5b4bb5;--prop-bg:#ece9fb;--bad:#a8323a;--bad-bg:#fbe6e7}
@media (prefers-color-scheme:dark){:root{--bg:#0e151b;--fg:#e6edf2;--muted:#93a3b1;--line:#263340;--card:#141d25;--link:#6cc4f0;
--done:#7fd3a6;--done-bg:#12301f;--prog:#f0c26a;--prog-bg:#33270d;--appr:#6cc4f0;--appr-bg:#0f2a3a;--prop:#b3a8f5;--prop-bg:#231f45;--bad:#f09aa0;--bad-bg:#3a1619}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:28px;margin:0 0 4px}
h2{font-size:18px;margin:36px 0 12px}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
.muted{color:var(--muted);font-size:14px}
.how{margin:16px 0 0}.how>summary{font-weight:600;font-size:14px;color:var(--muted)}.how>summary::before{content:"▸ "}.how[open]>summary::before{content:"▾ "}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:10px 0 6px;padding:0;list-style:none;counter-reset:step}
.steps li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-size:14px}
.how p{margin:0}
@media (max-width:720px){.steps{grid-template-columns:1fr}}
.empty pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow-x:auto;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.queue .step th{padding-top:16px;font-size:14px;color:var(--fg);border-bottom:1px solid var(--line)}.queue tbody:first-of-type .step th{padding-top:6px}
.specs summary{font-size:14px;color:var(--muted)}.specs summary::before{content:"▸ "}.specs[open] summary::before{content:"▾ "}
.hz{color:var(--muted);background:var(--line)}.hz::before{content:"● ";font-size:10px;vertical-align:1px}
.hz-now{color:var(--done);background:var(--done-bg)}.hz-next{color:var(--appr);background:var(--appr-bg)}.hz-later{color:var(--muted);background:var(--line)}.hz-other{color:var(--prog);background:var(--prog-bg)}
.where{margin:4px 0}
.button{display:inline-block;padding:6px 14px;border-radius:8px;background:var(--link);color:var(--bg);font-weight:600;font-size:15px}.button:hover{text-decoration:none;opacity:.9}
.want{font-size:13px;white-space:nowrap}
.recent li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;padding:4px 0}.recent .when{min-width:52px}
.wanted{margin:0;padding-left:24px;list-style:decimal}.wanted li{margin:4px 0}
.actions{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:14px}.actions a{font-weight:600}
.stands{margin:8px 0 4px}
.whole>summary{font-size:14px;font-weight:600;color:var(--link)}.whole>summary::before{content:"▸ "}.whole[open]>summary::before{content:"▾ "}
.md{font-size:15px;overflow-x:auto}.md h4,.md h5,.md h6{margin:14px 0 4px;font-size:15px}.md ul,.md ol,.tree .md ul{margin:6px 0;padding-left:22px;list-style:revert;border-left:0}.md li{margin:3px 0}
.md pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow-x:auto}.md pre code{color:var(--fg)}
.md table{min-width:0;width:auto}.md th,.md td{padding:6px 14px 6px 0;font-size:14px;width:auto}.md td:first-child,.md td:last-child{width:auto}
.md blockquote{margin:6px 0;padding-left:12px;border-left:3px solid var(--line);color:var(--muted)}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}
.pill.done{color:var(--done);background:var(--done-bg)}.pill.in_progress{color:var(--prog);background:var(--prog-bg)}
.pill.approved{color:var(--appr);background:var(--appr-bg)}.pill.proposed{color:var(--prop);background:var(--prop-bg)}
.pill.planned{color:var(--muted);background:var(--line)}
.pill.bad{color:var(--bad);background:var(--bad-bg)}
.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 16px;overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:640px}
th,td{text-align:left;padding:10px 12px 10px 0;border-bottom:1px solid var(--line);vertical-align:top;font-size:15px}
th{font-size:13px;color:var(--muted);font-weight:600}tr:last-child td{border-bottom:0}
td:first-child{width:38%}td:last-child{width:32%}
.overview{min-width:560px}.overview th,.overview td,.overview td:last-child{width:auto;padding-right:16px;vertical-align:middle}
.overview tbody th{font-size:15px;color:var(--fg);border-bottom:1px solid var(--line)}
.overview .num{text-align:right;font-variant-numeric:tabular-nums}.overview .group{text-align:center;border-bottom:0;padding-bottom:0}
.overview .progress{white-space:nowrap;color:var(--muted);font-size:14px;width:1%}.overview .stage{white-space:nowrap;width:1%}
.overview .all th,.overview .all td{font-weight:600;border-bottom:0}
.bar{display:inline-block;width:96px;height:8px;margin-right:8px;border-radius:4px;background:var(--line);overflow:hidden;vertical-align:middle}
.bar span{display:block;height:100%;background:var(--done)}
.node{scroll-margin-top:12px}
.overview td a{display:block;color:inherit}
.find{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px}.find[hidden],.find [hidden]{display:none}
.find input,.find select,.find button{font:inherit;font-size:15px;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px;max-width:100%}
.find input{flex:1 1 220px;min-width:0}.find select{max-width:240px}.find button{cursor:pointer;color:var(--link)}
.next{font-weight:600}
ul{list-style:none;margin:0;padding:0}
.tree ul{margin-left:4px;padding-left:16px;border-left:1px solid var(--line)}
.row{display:flex;align-items:center;gap:6px 8px;padding:7px 0}.row>*{flex:none}
.row .title{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .bar{width:56px;margin-right:0}
@media (max-width:640px){.row{flex-wrap:wrap}.row .title{flex-basis:100%}}
.row.plain{padding-left:15px}
summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}
summary.row::before{content:"";width:0;height:0;margin-right:2px;border-left:5px solid var(--muted);border-top:4px solid transparent;border-bottom:4px solid transparent;transition:transform .15s}
details[open]>summary.row::before{transform:rotate(90deg)}
.level{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);min-width:56px}
.title{font-weight:600;color:var(--fg)}
.pr{font-size:13px}
.detail{margin:0 0 10px 15px;padding:2px 0 4px 14px;border-left:2px solid var(--line);font-size:15px;max-width:760px}
.detail p{margin:6px 0}
.criteria{margin:6px 0;padding-left:20px}.criteria li{margin:4px 0}.criteria .muted{display:block;font-size:13px}
footer{margin-top:40px}
@media (max-width:640px){table:not(.overview),table:not(.overview) tbody,table:not(.overview) tr,table:not(.overview) td{display:block}table:not(.overview) thead{display:none}table:not(.overview){min-width:0}
table:not(.overview) th{display:block;border:0}table:not(.overview) td{width:auto;padding:3px 0;border:0}table:not(.overview) tr{padding:10px 0;border-bottom:1px solid var(--line)}table:not(.overview) tr:last-child{border-bottom:0}}
</style>
</head>
<body>
<main>
<h1>${esc(name)} roadmap</h1>
<div class="muted"><a href="${repoUrl}">${esc(data.repository)}</a></div>
<p><a class="button" href="${esc(newSpecUrl(ctx, ""))}">Propose a spec</a></p>
${intro}
${wanted}
${renderOverview(data.overview, first)}
${renderRecent(data, cfg.dashboard.recent_days)}
${fresh ? "" : `<h2>Open proposals</h2>\n<div class="box">${proposals}</div>`}
<h2 id="specs">Specs</h2>
${renderFind(data)}
<div class="box">${tree}</div>
<footer class="muted">Updated ${esc(data.generated.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC"))}. A spec is done when it is in the default branch together with its code. A planned spec is agreed and not built yet. Data: <a href="roadmap.json">roadmap.json</a>. Built by <a href="https://github.com/beamreach-ai/spectree">spectree</a>.</footer>
</main>
${data.tree.length ? `<script>\n${findScript(known)}\n${howScript}\n</script>` : ""}
</body>
</html>
`;
}
