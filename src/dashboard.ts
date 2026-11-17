import type { Config } from "./config.ts";
import type { NodeChange, Phase, PrResult } from "./evaluate.ts";
import { type Spec, levelName } from "./tree.ts";

export type NodeStatus = "done" | "proposed" | "approved" | "in_progress";

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
  /** Open pull requests that add, change or remove this node. */
  open: OpenChange[];
  /** For a group: how many leaves below it have each status. */
  counts: Record<NodeStatus, number>;
  children: DashNode[];
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
  nodes: string[];
}

export interface DashData {
  repository: string;
  generated: string;
  threshold: number;
  levels: string[];
  proposals: DashPr[];
  tree: DashNode[];
}

export interface PrSummary {
  number: number;
  title: string;
  author: string;
  url: string;
  result: PrResult;
}

const statusOf = (phase: Phase): NodeStatus => (phase === "code" ? "in_progress" : phase === "approved" ? "approved" : "proposed");
const zero = (): Record<NodeStatus, number> => ({ done: 0, proposed: 0, approved: 0, in_progress: 0 });

/** The roadmap: the default branch's nodes are done; open spec pull requests add the other three statuses. */
export function buildData(mainSpecs: Record<string, Spec>, prs: PrSummary[], cfg: Config, repository: string, now: string): DashData {
  const flat = new Map<string, DashNode>();
  const make = (id: string, title: string, kind: "leaf" | "group", status: NodeStatus): DashNode => ({
    id, name: id.split("/").pop()!, title, kind, level: levelName(id, cfg.levels), status, open: [], counts: zero(), children: [],
  });
  for (const s of Object.values(mainSpecs)) flat.set(s.id, make(s.id, s.title, s.kind, "done"));

  const proposals: DashPr[] = [];
  for (const p of prs) {
    const r = p.result;
    if (r.phase === "none" || r.phase === "missing") continue;
    const status = statusOf(r.phase);
    proposals.push({
      number: p.number, title: p.title, author: p.author, url: p.url, phase: r.phase, status, valid: r.errors.length === 0,
      for: r.tally?.for ?? 0, against: r.tally?.against ?? 0, forPeople: r.tally?.forPeople ?? 0, againstPeople: r.tally?.againstPeople ?? 0,
      nodes: r.nodes.map((n) => n.id),
    });
    for (const n of r.nodes) {
      let node = flat.get(n.id);
      if (!node) flat.set(n.id, (node = make(n.id, n.title, n.kind, status)));
      node.open.push({ pr: p.number, status, change: n.change });
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
  return { repository, generated: now, threshold: cfg.threshold, levels: cfg.levels, proposals, tree: roots };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const LABEL: Record<NodeStatus, string> = { done: "Done", in_progress: "In progress", approved: "Approved", proposed: "Proposed" };
const ORDER: NodeStatus[] = ["done", "in_progress", "approved", "proposed"];
const pill = (s: NodeStatus, text = LABEL[s]) => `<span class="pill ${s}">${esc(text)}</span>`;

function renderNode(n: DashNode, repoUrl: string, root: string): string {
  const counts = n.kind === "group" ? ORDER.filter((s) => n.counts[s]).map((s) => pill(s, `${n.counts[s]} ${LABEL[s].toLowerCase()}`)).join(" ") : "";
  const open = n.open
    .map((o) => `<a class="pr" href="${repoUrl}/pull/${o.pr}">#${o.pr} ${o.change === "added" ? "" : o.change + ", "}${LABEL[o.status].toLowerCase()}</a>`)
    .join(" ");
  const href = n.status === "done" ? `${repoUrl}/blob/HEAD/${root}/${n.id}/spec.md` : n.open[0] ? `${repoUrl}/pull/${n.open[0].pr}` : "#";
  const head = `<span class="level">${esc(n.level)}</span> <a class="title" href="${href}">${esc(n.title)}</a> <code>${esc(n.name)}</code> ${
    n.kind === "leaf" ? pill(n.status) : counts || pill(n.status)
  } ${n.status === "done" || n.kind === "group" ? open : ""}`;
  if (!n.children.length) return `<li class="node"><div class="row">${head}</div></li>`;
  return `<li class="node"><details open><summary class="row">${head}</summary><ul>${n.children.map((c) => renderNode(c, repoUrl, root)).join("")}</ul></details></li>`;
}

export function renderHtml(data: DashData, cfg: Config, serverUrl = "https://github.com"): string {
  const repoUrl = `${serverUrl}/${data.repository}`;
  const total = zero();
  const walk = (n: DashNode) => {
    if (n.kind === "leaf") total[n.status]++;
    n.children.forEach(walk);
  };
  data.tree.forEach(walk);
  const proposals = data.proposals.length
    ? `<table><thead><tr><th>Pull request</th><th>Status</th><th>For</th><th>Against</th><th>Specs</th></tr></thead><tbody>${data.proposals
        .map(
          (p) =>
            `<tr><td><a href="${p.url}">#${p.number} ${esc(p.title)}</a><div class="muted">by ${esc(p.author)}</div></td><td>${pill(p.status)}${
              p.valid ? "" : ' <span class="pill bad">spec not valid</span>'
            }</td><td>${p.for} of ${data.threshold} <span class="muted">(${p.forPeople} ${p.forPeople === 1 ? "person" : "people"})</span></td><td>${p.against} <span class="muted">(${p.againstPeople})</span></td><td>${p.nodes
              .map((n) => `<code>${esc(n)}</code>`)
              .join(" ")}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p class="muted">No open spec pull requests.</p>`;
  const tree = data.tree.length
    ? `<ul class="tree">${data.tree.map((n) => renderNode(n, repoUrl, cfg.root)).join("")}</ul>`
    : `<p class="muted">No specs yet. Add the first one under <code>${esc(cfg.root)}/</code>.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roadmap: ${esc(data.repository)}</title>
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
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.summary{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}
.pill.done{color:var(--done);background:var(--done-bg)}.pill.in_progress{color:var(--prog);background:var(--prog-bg)}
.pill.approved{color:var(--appr);background:var(--appr-bg)}.pill.proposed{color:var(--prop);background:var(--prop-bg)}
.pill.bad{color:var(--bad);background:var(--bad-bg)}
.box{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 16px;overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:560px}
th,td{text-align:left;padding:10px 12px 10px 0;border-bottom:1px solid var(--line);vertical-align:top;font-size:15px}
th{font-size:13px;color:var(--muted);font-weight:600}tr:last-child td{border-bottom:0}
ul{list-style:none;margin:0;padding:0}
.tree ul{margin-left:11px;padding-left:16px;border-left:1px solid var(--line)}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:7px 0}
summary{cursor:pointer}
.level{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);min-width:56px}
.title{font-weight:600;color:var(--fg)}
.pr{font-size:13px}
footer{margin-top:40px}
</style>
</head>
<body>
<main>
<h1>Roadmap</h1>
<div class="muted"><a href="${repoUrl}">${esc(data.repository)}</a></div>
<div class="summary">${ORDER.map((s) => pill(s, `${total[s]} ${LABEL[s].toLowerCase()}`)).join("")}</div>
<h2>Open proposals</h2>
<div class="box">${proposals}</div>
<h2>Specs</h2>
<div class="box">${tree}</div>
<footer class="muted">Updated ${esc(data.generated.replace("T", " ").replace(/:\d\d(\.\d+)?Z$/, " UTC"))}. A spec is done when it is in the default branch together with its code. Data: <a href="roadmap.json">roadmap.json</a>. Built by <a href="https://github.com/beamreach-ai/spectree">spectree</a>.</footer>
</main>
</body>
</html>
`;
}
