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
  on_missing_spec: "fail" | "close";
  dashboard: { enabled: boolean; path: string };
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
  dashboard: { enabled: true, path: "" },
};

/** Reads `.roadmap.yml` text. Unknown keys and wrong types are reported, never guessed. */
export function loadConfig(text: string | null): { config: Config; errors: string[] } {
  const errors: string[] = [];
  const config: Config = structuredClone(DEFAULTS);
  if (!text || !text.trim()) return { config, errors };
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    return { config, errors: [`.roadmap.yml is not valid YAML: ${(e as Error).message}`] };
  }
  if (raw === null || raw === undefined) return { config, errors };
  if (typeof raw !== "object" || Array.isArray(raw)) return { config, errors: [".roadmap.yml must be a mapping"] };
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
        if (value === "fail" || value === "close") config.on_missing_spec = value;
        else errors.push("on_missing_spec must be fail or close");
        break;
      case "dashboard": {
        const d = value as Record<string, unknown> | null;
        if (d && typeof d === "object") {
          if (typeof d.enabled === "boolean") config.dashboard.enabled = d.enabled;
          if (typeof d.path === "string") config.dashboard.path = d.path.replace(/^\/+|\/+$/g, "");
        } else errors.push("dashboard must be a mapping");
        break;
      }
      default:
        errors.push(`unknown key: ${key}`);
    }
  }
  return { config, errors };
}
