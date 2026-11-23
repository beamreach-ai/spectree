// A small Markdown renderer for spec bodies. Everything is escaped first, so no HTML in a spec reaches the page.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Where a link goes: an absolute http(s) or mailto address as it is, a relative path through `resolve`, anything else nowhere. */
export function linkTarget(href: string, resolve: (path: string) => string): string | null {
  const h = href.trim();
  if (/^(https?:\/\/|mailto:)/i.test(h)) return h;
  if (!h || h.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith("//")) return null;
  return resolve(h.replace(/^(\.?\/)+/, ""));
}

export function inlineMarkdown(text: string, resolve: (path: string) => string): string {
  const code: string[] = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g, (_, label, href) => {
    // The address was escaped with the rest of the text; undo that once, and escape it again where it is written.
    const raw = href.replace(/&(amp|lt|gt|quot);/g, (_: string, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"' })[e]!);
    const to = linkTarget(raw, resolve);
    return to ? `<a href="${esc(to)}">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[Number(i)]}</code>`);
}

interface Item {
  indent: number;
  ordered: boolean;
  text: string;
}

function list(items: Item[], resolve: (path: string) => string): string {
  const base = items[0].indent;
  let out = "";
  let tag = "";
  for (let i = 0; i < items.length; ) {
    // A numbered item after bulleted ones, or the reverse, starts a list of its own.
    const want = items[i].ordered ? "ol" : "ul";
    if (want !== tag) out += `${tag ? `</${tag}>` : ""}<${(tag = want)}>`;
    let j = i + 1;
    while (j < items.length && items[j].indent > base) j++;
    out += `<li>${inlineMarkdown(items[i].text, resolve)}${j > i + 1 ? list(items.slice(i + 1, j), resolve) : ""}</li>`;
    i = j;
  }
  return `${out}</${tag}>`;
}

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Headings, paragraphs, lists, tables, quotes and code. `resolve` turns a path in the repository into an address. */
export function renderMarkdown(src: string, resolve: (path: string) => string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const starts = (l: string) => /^(#{1,6}\s|```|>|\|)/.test(l) || ITEM.test(l);
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (h) {
      const level = h[1].length <= 2 ? 4 : h[1].length === 3 ? 5 : 6;
      out.push(`<h${level}>${inlineMarkdown(h[2], resolve)}</h${level}>`);
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(cells(lines[i]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inlineMarkdown(c, resolve)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, k) => `<td>${inlineMarkdown(r[k] ?? "", resolve)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (ITEM.test(line)) {
      const items: Item[] = [];
      for (; i < lines.length; i++) {
        const m = ITEM.exec(lines[i]);
        if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
        else if (lines[i].trim() && /^\s+/.test(lines[i]) && !lines[i].trim().startsWith("```")) items[items.length - 1].text += " " + lines[i].trim();
        else if (!lines[i].trim() && i + 1 < lines.length && (ITEM.test(lines[i + 1]) || /^\s+\S/.test(lines[i + 1])) && !lines[i + 1].trim().startsWith("```")) continue;
        else break;
      }
      out.push(list(items, resolve));
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) body.push(lines[i].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inlineMarkdown(body.join(" "), resolve)}</blockquote>`);
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !(para.length && starts(lines[i])); i++) para.push(lines[i].trim());
    out.push(`<p>${inlineMarkdown(para.join(" "), resolve)}</p>`);
  }
  return out.join("\n");
}
