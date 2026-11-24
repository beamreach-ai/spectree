// The logic of the roadmap page's search and filters. Each function takes and returns plain data and uses nothing
// outside itself and the other functions here, because the page's script is made of their source (see findScript).

/** What the visitor asked for. `horizon` is null when unset and "" for `planned: true`. */
export interface View {
  q: string;
  status: string;
  horizon: string | null;
  top: string;
}

/** The values the page knows; anything else in an address is dropped. */
export interface Known {
  statuses: string[];
  horizons: string[];
  tops: string[];
}

export interface FindNode {
  id: string;
  kind: string;
  status: string;
  horizon: string;
  /** Title, id and summary, in lower case. */
  text: string;
}

export interface Visible {
  /** Whether a search or a filter is set. */
  active: boolean;
  show: string[];
  open: string[];
  matched: number;
  total: number;
  /** What the page says next to the controls; empty when nothing is set. */
  label: string;
}

export function parseView(query: string, known: Known): View {
  const p = new URLSearchParams(query);
  const pick = (key: string, list: string[]) => {
    const v = p.get(key);
    return v !== null && list.includes(v) ? v : null;
  };
  return { q: p.get("q") ?? "", status: pick("status", known.statuses) ?? "", horizon: pick("horizon", known.horizons), top: pick("top", known.tops) ?? "" };
}

/** The query string of a view, without the question mark. A part that is not set is left out. */
export function writeView(view: View): string {
  const p = new URLSearchParams();
  if (view.q.trim()) p.set("q", view.q);
  if (view.status) p.set("status", view.status);
  if (view.horizon !== null) p.set("horizon", view.horizon);
  if (view.top) p.set("top", view.top);
  return p.toString();
}

export function matches(node: FindNode, view: View): boolean {
  for (const word of view.q.toLowerCase().split(/\s+/)) if (word && !node.text.includes(word)) return false;
  if (view.status && node.status !== view.status) return false;
  if (view.horizon !== null && !(node.status === "planned" && node.horizon === view.horizon)) return false;
  if (view.top && node.id !== view.top && !node.id.startsWith(view.top + "/")) return false;
  return true;
}

/** Which nodes to show and which to open. `anchor` is the id of the node the address points at, or "". */
export function visible(nodes: FindNode[], view: View, anchor: string): Visible {
  const ids = new Set(nodes.map((n) => n.id));
  const above = (id: string) => {
    const out: string[] = [];
    for (let i = id.lastIndexOf("/"); i > 0; i = id.lastIndexOf("/", i - 1)) if (ids.has(id.slice(0, i))) out.push(id.slice(0, i));
    return out;
  };
  const active = view.q.trim() !== "" || view.status !== "" || view.horizon !== null || view.top !== "";
  const leaves = nodes.filter((n) => n.kind === "leaf");
  const hits = active ? leaves.filter((n) => matches(n, view)) : leaves;
  const show = new Set(active ? [] : ids);
  const open = new Set<string>();
  if (active)
    for (const n of hits) {
      show.add(n.id);
      for (const a of above(n.id)) show.add(a), open.add(a);
    }
  if (anchor && ids.has(anchor)) {
    show.add(anchor);
    for (const a of above(anchor)) show.add(a), open.add(a);
  }
  const label = !active ? "" : hits.length ? `${hits.length} of ${leaves.length} ${leaves.length === 1 ? "spec" : "specs"}` : "No specs match.";
  return { active, show: [...show], open: [...open], matched: hits.length, total: leaves.length, label };
}

/** The page's script: the functions above, and the few lines that connect them to the controls and the address. */
export function findScript(known: Known): string {
  const json = JSON.stringify(known).replace(/</g, "\\u003c");
  return `${parseView.toString()}
${writeView.toString()}
${matches.toString()}
${visible.toString()}
(function (parseView, writeView, visible) {
  var form = document.getElementById("find");
  if (!form) return;
  var KNOWN = ${json};
  var count = document.getElementById("find-count"), clear = document.getElementById("find-clear");
  var nodes = [].map.call(document.querySelectorAll("li.node"), function (li) {
    var d = li.querySelector(":scope > details");
    return { id: li.id.slice(5), kind: li.dataset.kind, status: li.dataset.status, horizon: li.dataset.horizon, text: li.dataset.text, li: li, details: d, was: d ? d.open : false };
  });
  function anchor() {
    var h = decodeURIComponent(location.hash.slice(1));
    return h.indexOf("spec-") === 0 ? h.slice(5) : "";
  }
  function read() {
    var h = form.elements.horizon ? form.elements.horizon.value : "";
    return { q: form.elements.q.value, status: form.elements.status.value, horizon: h ? h.slice(2) : null, top: form.elements.top.value };
  }
  function fill(v) {
    form.elements.q.value = v.q;
    form.elements.status.value = v.status;
    form.elements.top.value = v.top;
    if (form.elements.horizon) form.elements.horizon.value = v.horizon === null ? "" : "h:" + v.horizon;
  }
  function apply(v) {
    var r = visible(nodes, v, anchor()), show = new Set(r.show), open = new Set(r.open);
    nodes.forEach(function (n) {
      n.li.hidden = !show.has(n.id);
      if (n.details) n.details.open = open.has(n.id) || (!r.active && n.was);
    });
    count.textContent = r.label;
    clear.hidden = !r.active;
  }
  function changed() {
    var v = read(), s = writeView(v);
    history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash);
    apply(v);
  }
  function jump() {
    var a = anchor(), n = a && document.getElementById("spec-" + a);
    if (!n) return;
    var d = n.querySelector(":scope > details");
    if (d) d.open = true;
    var about = n.querySelector(":scope > details > details.about");
    if (about) about.open = true;
    n.scrollIntoView();
  }
  form.hidden = false;
  form.addEventListener("input", changed);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  form.addEventListener("reset", function () { setTimeout(changed, 0); });
  window.addEventListener("hashchange", function () { apply(read()); jump(); });
  var first = parseView(location.search, KNOWN);
  fill(first);
  apply(first);
  jump();
})(${parseView.name}, ${writeView.name}, ${visible.name});`;
}
