import { parse } from "yaml";

export interface Config {
  root: string;
  levels: string[];
  implementation: "contributors" | "maintainers";
  threshold: number;
  max_against: number;
  count_author: boolean;
  ratings: Record<string, number>;
  exempt_paths: string[];
  exempt_authors: string[];
  on_missing_spec: "fail" | "close" | "allow";
  demand: { enabled: boolean; top: number };
  dashboard: { enabled: boolean; path: string; host: "github-pages" | "cloudflare"; project: string; collapse_over: number; stale_days: number };
}

export const DEFAULTS: Config = {
  root: "roadmap",
  levels: ["epic", "task", "subtask"],
  implementation: "contributors",
  threshold: 1,
  max_against: 0,
  count_author: true,
  ratings: {},
  exempt_paths: ["**/*.md", ".github/**"],
  exempt_authors: ["dependabot[bot]", "renovate[bot]"],
  on_missing_spec: "fail",
  demand: { enabled: true, top: 3 },
  dashboard: { enabled: true, path: "", host: "github-pages", project: "", collapse_over: 40, stale_days: 30 },
};

/** Reads `.spectree.yml` text. Unknown keys and wrong types are reported, never guessed. */
export function loadConfig(text: string | null): { config: Config; errors: string[] } {
  const errors: string[] = [];
  const config: Config = structuredClone(DEFAULTS);
  if (!text || !text.trim()) return { config, errors };
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    return { config, errors: [`.spectree.yml is not valid YAML: ${(e as Error).message}`] };
  }
  if (raw === null || raw === undefined) return { config, errors };
  if (typeof raw !== "object" || Array.isArray(raw)) return { config, errors: [".spectree.yml must be a mapping"] };
  const r = raw as Record<string, unknown>;
  const strList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  for (const [key, value] of Object.entries(r)) {
    switch (key) {
      case "root":
        if (typeof value === "string" && value.trim()) config.root = value.replace(/^\/+|\/+$/g, "");
        else errors.push("root must be a directory name");
        break;
      case "levels":
        if (strList(value) && (value as string[]).length) config.levels = value as string[];
        else errors.push("levels must be a list of names");
        break;
      case "implementation":
        if (value === "contributors" || value === "maintainers") config.implementation = value;
        else errors.push("implementation must be contributors or maintainers");
        break;
      case "threshold":
      case "max_against":
        if (typeof value === "number" && value >= 0) config[key] = value;
        else errors.push(`${key} must be a number, 0 or more`);
        break;
      case "count_author":
        if (typeof value === "boolean") config.count_author = value;
        else errors.push("count_author must be true or false");
        break;
      case "ratings":
        if (value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((x) => typeof x === "number"))
          config.ratings = Object.fromEntries(Object.entries(value as Record<string, number>).map(([u, w]) => [u.toLowerCase(), w]));
        else errors.push("ratings must map user names to numbers");
        break;
      case "exempt_paths":
      case "exempt_authors":
        if (strList(value)) config[key] = value as string[];
        else errors.push(`${key} must be a list`);
        break;
      case "on_missing_spec":
        if (value === "fail" || value === "close" || value === "allow") config.on_missing_spec = value;
        else errors.push("on_missing_spec must be fail, close or allow");
        break;
      case "demand": {
        const d = value as Record<string, unknown> | null;
        if (d && typeof d === "object" && !Array.isArray(d)) {
          for (const k of Object.keys(d)) if (!["enabled", "top"].includes(k)) errors.push(`unknown key: demand.${k}`);
          if (d.enabled !== undefined) {
            if (typeof d.enabled === "boolean") config.demand.enabled = d.enabled;
            else errors.push("demand.enabled must be true or false");
          }
          if (d.top !== undefined) {
            if (typeof d.top === "number" && Number.isInteger(d.top) && d.top >= 0) config.demand.top = d.top;
            else errors.push("demand.top must be a whole number, 0 or more");
          }
        } else errors.push("demand must be a mapping");
        break;
      }
      case "dashboard": {
        const d = value as Record<string, unknown> | null;
        if (d && typeof d === "object") {
          if (typeof d.enabled === "boolean") config.dashboard.enabled = d.enabled;
          if (typeof d.path === "string") config.dashboard.path = d.path.replace(/^\/+|\/+$/g, "");
          for (const k of Object.keys(d)) if (!["enabled", "path", "host", "project", "collapse_over", "stale_days"].includes(k)) errors.push(`unknown key: dashboard.${k}`);
          if (d.host !== undefined) {
            if (d.host === "github-pages" || d.host === "cloudflare") config.dashboard.host = d.host;
            else errors.push("dashboard.host must be github-pages or cloudflare");
          }
          if (d.collapse_over !== undefined) {
            if (typeof d.collapse_over === "number" && Number.isInteger(d.collapse_over) && d.collapse_over >= 0) config.dashboard.collapse_over = d.collapse_over;
            else errors.push("dashboard.collapse_over must be a whole number, 0 or more");
          }
          if (d.stale_days !== undefined) {
            if (typeof d.stale_days === "number" && Number.isInteger(d.stale_days) && d.stale_days >= 0) config.dashboard.stale_days = d.stale_days;
            else errors.push("dashboard.stale_days must be a whole number, 0 or more");
          }
          if (d.project !== undefined) {
            if (typeof d.project === "string" && /^[a-z0-9][a-z0-9-]{0,57}$/.test(d.project)) config.dashboard.project = d.project;
            else errors.push("dashboard.project must be a Cloudflare Pages project name: lowercase letters, digits and dashes");
          }
          if (config.dashboard.host === "cloudflare" && !config.dashboard.project) errors.push("dashboard.host cloudflare needs dashboard.project, the Cloudflare Pages project");
        } else errors.push("dashboard must be a mapping");
        break;
      }
      default:
        errors.push(`unknown key: ${key}`);
    }
  }
  return { config, errors };
}
