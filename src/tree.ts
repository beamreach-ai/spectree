import { parse } from "yaml";

export interface Criterion {
  id: string;
  text: string;
  tests: string[];
}

export interface Spec {
  /** Path below the root, e.g. `search/indexing/incremental`. */
  id: string;
  title: string;
  kind: "leaf" | "group";
  paths: string[];
  criteria: Criterion[];
  /** Set on a leaf that is agreed but not built. The text is the horizon, e.g. `now`, `next`, `later`; empty when none was given. */
  planned: string | null;
  body: string;
}

export const SPEC_FILE = "spec.md";

/** The node a file under the root belongs to: its directory, relative to the root. Null for files directly in the root. */
export function nodeIdOf(root: string, filePath: string): string | null {
  const prefix = root + "/";
  if (!filePath.startsWith(prefix)) return null;
  const rest = filePath.slice(prefix.length);
  const slash = rest.lastIndexOf("/");
  return slash < 0 ? null : rest.slice(0, slash);
}

export function isSpecFile(root: string, filePath: string): boolean {
  return filePath.startsWith(root + "/") && filePath.endsWith("/" + SPEC_FILE) && nodeIdOf(root, filePath) !== null;
}

export function specPath(root: string, id: string): string {
  return `${root}/${id}/${SPEC_FILE}`;
}

const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "");

/** Parses one `spec.md`. Errors are complete sentences a contributor can act on. */
export function parseSpec(id: string, content: string): { spec: Spec | null; errors: string[] } {
  const errors: string[] = [];
  const at = `${id}/${SPEC_FILE}`;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!m) return { spec: null, errors: [`${at}: the file must start with a header between two --- lines`] };
  let head: unknown;
  try {
    head = parse(m[1]);
  } catch (e) {
    return { spec: null, errors: [`${at}: the header is not valid YAML (${(e as Error).message.split("\n")[0]})`] };
  }
  if (!head || typeof head !== "object" || Array.isArray(head)) return { spec: null, errors: [`${at}: the header must be a mapping`] };
  const h = head as Record<string, unknown>;
  const title = typeof h.title === "string" ? h.title.trim() : "";
  if (!title) errors.push(`${at}: title is required`);
  const kind = h.kind === undefined ? "leaf" : h.kind;
  if (kind !== "leaf" && kind !== "group") errors.push(`${at}: kind must be leaf or group`);
  const known = new Set(["title", "kind", "paths", "criteria", "planned"]);
  for (const k of Object.keys(h)) if (!known.has(k)) errors.push(`${at}: unknown header key "${k}"`);

  let paths: string[] = [];
  const criteria: Criterion[] = [];
  let planned: string | null = null;
  if (h.planned !== undefined && h.planned !== false) {
    if (h.planned === true) planned = "";
    else if (typeof h.planned === "string" && h.planned.trim()) planned = h.planned.trim();
    else errors.push(`${at}: planned must be true or a short text such as now, next or later`);
  }
  if (kind === "group") {
    if (planned !== null) errors.push(`${at}: a group cannot be planned; mark its leaves`);
    if (h.paths !== undefined) errors.push(`${at}: a group has no paths`);
    if (h.criteria !== undefined) errors.push(`${at}: a group has no criteria`);
  } else if (kind === "leaf") {
    if (strList(h.paths) && h.paths.length) paths = h.paths;
    else if (planned !== null && h.paths === undefined) paths = [];
    else errors.push(`${at}: a leaf needs paths, a list of the files the implementation may touch`);
    if (Array.isArray(h.criteria) && h.criteria.length) {
      const seen = new Set<string>();
      h.criteria.forEach((c: unknown, i: number) => {
        const where = `${at}: criterion ${i + 1}`;
        if (!c || typeof c !== "object") return void errors.push(`${where} must have id, text and tests`);
        const o = c as Record<string, unknown>;
        const cid = typeof o.id === "string" ? o.id.trim() : "";
        const text = typeof o.text === "string" ? o.text.trim() : "";
        if (!cid) errors.push(`${where} needs an id`);
        else if (seen.has(cid)) errors.push(`${where}: id "${cid}" is used twice`);
        seen.add(cid);
        if (!text) errors.push(`${where} needs a text`);
        if (!strList(o.tests) || !o.tests.length) errors.push(`${where} needs tests, a list with at least one test file`);
        criteria.push({ id: cid, text, tests: strList(o.tests) ? o.tests : [] });
      });
    } else if (!(planned !== null && h.criteria === undefined)) errors.push(`${at}: a leaf needs at least one criterion`);
  }
  if (errors.length) return { spec: null, errors };
  return { spec: { id, title, kind: kind as "leaf" | "group", paths, criteria, planned, body: m[2].trim() }, errors };
}

/** Every ancestor of a node must itself be a node. `known` holds all node ids after the change. */
export function missingAncestors(id: string, known: Set<string>): string[] {
  const missing: string[] = [];
  const parts = id.split("/");
  for (let i = 1; i < parts.length; i++) {
    const anc = parts.slice(0, i).join("/");
    if (!known.has(anc)) missing.push(anc);
  }
  return missing;
}

export function levelName(id: string, levels: string[]): string {
  const depth = id.split("/").length;
  return levels[Math.min(depth, levels.length) - 1];
}
