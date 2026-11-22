import type { Config } from "./config.ts";
import type { NodeChange, Phase, PrResult } from "./evaluate.ts";
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
  proposals: DashPr[];
  overview: Overview;
  tree: DashNode[];
}

export interface PrSummary {
  number: number;
  title: string;
  author: string;
  url: string;
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
  if (r.phase === "code") return "review";
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

/** The roadmap: the default branch's nodes are done; open spec pull requests add the other three statuses. */
export function buildData(mainSpecs: Record<string, Spec>, prs: PrSummary[], cfg: Config, repository: string, now: string): DashData {
  const flat = new Map<string, DashNode>();
  const make = (id: string, title: string, kind: "leaf" | "group", status: NodeStatus, body: string, criteria: Criterion[], horizon = ""): DashNode => ({
    id, horizon, name: id.split("/").pop()!, title, kind, level: levelName(id, cfg.levels), status, open: [], counts: zero(),
    summary: summaryOf(body), criteria, children: [],
  });
  for (const s of Object.values(mainSpecs))
    flat.set(s.id, make(s.id, s.title, s.kind, s.planned === null ? "done" : "planned", s.body, s.criteria, s.planned ?? ""));

  const proposals: DashPr[] = [];
  for (const p of prs) {
    const r = p.result;
    if (r.phase === "none" || r.phase === "missing") continue;
    const status = statusOf(r.phase);
    proposals.push({
      number: p.number, title: p.title, author: p.author, url: p.url, phase: r.phase, status, valid: r.errors.length === 0,
      for: r.tally?.for ?? 0, against: r.tally?.against ?? 0, forPeople: r.tally?.forPeople ?? 0, againstPeople: r.tally?.againstPeople ?? 0,
      next: nextOf(r), votes: (r.tally?.votes ?? []).map(({ user, vote, weight }) => ({ user, vote, weight })),
      nodes: r.nodes.map((n) => n.id),
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
    if (n.kind === "leaf" || !n.children.length) {
      if (n.kind === "leaf") n.counts[n.status] = 1;
      return n.counts;
    }
    for (const c of n.children) for (const [k, v] of Object.entries(roll(c))) n.counts[k as NodeStatus] += v;
    return n.counts;
  };
  roots.forEach(roll);
  return { repository, generated: now, threshold: cfg.threshold, max_against: cfg.max_against, levels: cfg.levels, proposals, overview: overviewOf(roots), tree: roots };
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
  const num = (n: number) => `<td class="num">${n || ""}</td>`;
  const row = (r: OverviewRow) => {
    const pct = r.total ? Math.round((r.counts.done / r.total) * 100) : 0;
    const name = r.id ? `<a href="#spec-${esc(r.id)}">${esc(r.title)}</a>` : esc(r.title);
    return `<tr${r.id ? "" : ' class="all"'}><th scope="row">${name}</th><td class="progress"><span class="bar"><span style="width:${pct}%"></span></span> ${r.counts.done} of ${r.total} done</td>${STAGES.map(
      (s) => num(r.counts[s]),
    ).join("")}${o.horizons.map((h) => num(r.horizons[h] ?? 0)).join("")}</tr>`;
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

const NEXT: Record<NextStep, string> = {
  fix: "A fix to the spec",
  votes: "Votes",
  code: "Code",
  review: "Code review",
  merge: "Merge",
};
const CONTRIBUTING = "https://github.com/beamreach-ai/spectree/blob/main/docs/contributing-with-specs.md";

function renderDetail(n: DashNode): string {
  if (!n.summary && !n.criteria.length) return "";
  const summary = n.summary ? `<p>${inline(n.summary)}</p>` : "";
  const criteria = n.criteria.length
    ? `<ol class="criteria">${n.criteria
        .map((c) => `<li><span>${inline(c.text)}</span> <span class="muted">Tested in ${c.tests.map((t) => `<code>${esc(t)}</code>`).join(", ")}</span></li>`)
        .join("")}</ol>`
    : "";
  return `<div class="detail">${summary}${criteria}</div>`;
}

function renderNode(n: DashNode, repoUrl: string, root: string): string {
  const counts = n.kind === "group" ? ORDER.filter((s) => n.counts[s]).map((s) => pill(s, `${n.counts[s]} ${LABEL[s].toLowerCase()}`)).join(" ") : "";
  const open = n.open
    .map((o) => `<a class="pr" href="${repoUrl}/pull/${o.pr}">#${o.pr} ${o.change === "added" ? "" : o.change + ", "}${LABEL[o.status].toLowerCase()}</a>`)
    .join(" ");
  // A node that an open pull request adds is not in the default branch yet, whatever its status.
  const inMain = (n.status === "done" || n.status === "planned") && !n.open.some((o) => o.change === "added");
  const href = inMain ? `${repoUrl}/blob/HEAD/${root}/${n.id}/spec.md` : n.open[0] ? `${repoUrl}/pull/${n.open[0].pr}` : "#";
  const many = n.criteria.length ? `<span class="muted">${plural(n.criteria.length, "criterion", "criteria")}</span>` : "";
  const head = `<span class="level">${esc(n.level)}</span> <a class="title" href="${href}">${esc(n.title)}</a> <code>${esc(n.name)}</code> ${
    n.kind === "leaf" ? pill(n.status, n.status === "planned" && n.horizon ? `Planned: ${n.horizon}` : LABEL[n.status]) : counts || pill(n.status)
  } ${inMain || n.kind === "group" ? open : ""} ${many}`;
  const detail = renderDetail(n);
  const kids = n.children.length ? `<ul>${n.children.map((c) => renderNode(c, repoUrl, root)).join("")}</ul>` : "";
  if (!detail && !kids) return `<li class="node" id="spec-${esc(n.id)}"><div class="row plain">${head}</div></li>`;
  return `<li class="node" id="spec-${esc(n.id)}"><details${kids ? " open" : ""}><summary class="row">${head}</summary>${detail}${kids}</details></li>`;
}

function renderVotes(p: DashPr, threshold: number): string {
  const who = (v: "for" | "against") =>
    p.votes
      .filter((x) => x.vote === v)
      .map((x) => `@${esc(x.user)}${x.weight === 1 ? "" : ` (weight ${x.weight})`}`)
      .join(", ");
  const lines = [`<div>${p.for} of ${threshold} for, ${p.against} against</div>`];
  if (who("for")) lines.push(`<div class="muted">For: ${who("for")}</div>`);
  if (who("against")) lines.push(`<div class="muted">Against: ${who("against")}</div>`);
  return lines.join("");
}

function renderNext(p: DashPr): string {
  const hint: Record<NextStep, string> = {
    fix: "The spec has problems. The vote starts when it is valid.",
    votes: `<a href="${p.url}/files">Review the spec</a>: Approve is for, Request changes is against.`,
    code: "The spec is approved and frozen. The code goes in this pull request, or in another with <code>Implements: #" + p.number + "</code>.",
    review: "The code is in. It is reviewed like any other code.",
    merge: "Nothing left. It can merge.",
  };
  return `<div class="next">${NEXT[p.next]}</div><div class="muted">${hint[p.next]}</div>`;
}

export function renderHtml(data: DashData, cfg: Config, serverUrl = "https://github.com"): string {
  const repoUrl = `${serverUrl}/${data.repository}`;
  const name = data.repository.split("/").pop()!;
  const first = data.levels[0] ? data.levels[0][0].toUpperCase() + data.levels[0].slice(1) : "Spec";
  const proposals = data.proposals.length
    ? `<table><thead><tr><th>Pull request</th><th>Status</th><th>Vote</th><th>Waiting for</th></tr></thead><tbody>${data.proposals
        .map(
          (p) =>
            `<tr><td><a href="${p.url}">#${p.number} ${esc(p.title)}</a><div class="muted">by ${esc(p.author)}</div><div>${p.nodes
              .map((n) => `<code>${esc(n)}</code>`)
              .join(" ")}</div></td><td>${pill(p.status)}${p.valid ? "" : ' <span class="pill bad">spec not valid</span>'}</td><td>${renderVotes(
              p,
              data.threshold,
            )}</td><td>${renderNext(p)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p class="muted">No open spec pull requests.</p>`;
  const tree = data.tree.length
    ? `<ul class="tree">${data.tree.map((n) => renderNode(n, repoUrl, cfg.root)).join("")}</ul>`
    : `<p class="muted">No specs yet. Add the first one under <code>${esc(cfg.root)}/</code>.</p>`;
  const against = data.max_against === 0 ? "none against" : `at most ${data.max_against} against`;
  const intro = `Every change to ${esc(name)} starts as a spec under <code>${esc(cfg.root)}/</code>, proposed in a pull request. People vote with reviews: Approve is for, Request changes is against. A spec passes with ${plural(
    data.threshold,
    "weighted vote",
  )} for and ${against}. People with write access weigh 1, and everyone else's vote is shown. After the vote, the code is added to the same pull request and spec and code merge together. <a href="${CONTRIBUTING}">How to propose a spec and vote</a>.`;
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
.intro{max-width:720px;margin:12px 0 0}
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
.next{font-weight:600}
ul{list-style:none;margin:0;padding:0}
.tree ul{margin-left:4px;padding-left:16px;border-left:1px solid var(--line)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:7px 0}
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
table:not(.overview) td{width:auto;padding:3px 0;border:0}table:not(.overview) tr{padding:10px 0;border-bottom:1px solid var(--line)}table:not(.overview) tr:last-child{border-bottom:0}}
</style>
</head>
<body>
<main>
<h1>${esc(name)} roadmap</h1>
<div class="muted"><a href="${repoUrl}">${esc(data.repository)}</a></div>
<p class="intro">${intro}</p>
${renderOverview(data.overview, first)}
<h2>Open proposals</h2>
<div class="box">${proposals}</div>
<h2>Specs</h2>
<div class="box">${tree}</div>
<footer class="muted">Updated ${esc(data.generated.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC"))}. A spec is done when it is in the default branch together with its code. A planned spec is agreed and not built yet. Data: <a href="roadmap.json">roadmap.json</a>. Built by <a href="https://github.com/beamreach-ai/spectree">spectree</a>.</footer>
</main>
</body>
</html>
`;
}
