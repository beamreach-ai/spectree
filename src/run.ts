import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { badgeOf } from "./badge.ts";
import { type Config, loadConfig } from "./config.ts";
import { type PrSummary, buildData, renderHtml } from "./dashboard.ts";
import { type ApprovalRecord, type PrInput, type PrResult, LABEL_APPROVED, evaluatePr, implementsRef } from "./evaluate.ts";
import type { GitHub } from "./github.ts";
import { weightOf } from "./tally.ts";
import { type Spec, SPEC_FILE, isSpecFile, parseSpec } from "./tree.ts";

export const CONFIG_FILE = ".spectree.yml";
const MARKER = "<!-- spectree -->";
const RECORD = /<!-- spectree-record: (.*?) -->/s;
const CONTEXTS = { spec: "spectree/spec", phase: "spectree/phase", scope: "spectree/scope" } as const;
const SKIP = new Set([".git", "node_modules"]);

/** Every file in a checkout, relative paths. Stops at `limit` and returns null: scope then skips the test-file check. */
export function listFiles(dir: string, limit = 200_000): Set<string> | null {
  const out = new Set<string>();
  const walk = (rel: string): boolean => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!walk(p)) return false;
      } else if (out.add(p).size > limit) return false;
    }
    return true;
  };
  return walk("") ? out : null;
}

/** The nodes in a checkout, and what is wrong with them. */
export function readSpecs(dir: string, cfg: Config): { specs: Record<string, Spec>; errors: string[] } {
  const specs: Record<string, Spec> = {};
  const errors: string[] = [];
  const root = join(dir, cfg.root);
  if (!existsSync(root)) return { specs, errors };
  const walk = (rel: string) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const id = rel ? `${rel}/${e.name}` : e.name;
      const file = join(root, id, SPEC_FILE);
      if (existsSync(file)) {
        const parsed = parseSpec(id, readFileSync(file, "utf8"));
        errors.push(...parsed.errors);
        if (parsed.spec) specs[id] = parsed.spec;
      } else if (rel || readdirSync(join(root, id)).length) errors.push(`${id}: the directory has no ${SPEC_FILE}`);
      walk(id);
    }
  };
  walk("");
  return { specs, errors };
}

function recordIn(comments: any[], bot: string): { id: number; body: string; record: ApprovalRecord | null } | null {
  const mine = comments.filter((c) => c.user?.login === bot && typeof c.body === "string" && c.body.startsWith(MARKER));
  if (!mine.length) return null;
  const c = mine[mine.length - 1];
  const m = RECORD.exec(c.body);
  let record: ApprovalRecord | null = null;
  if (m) {
    try {
      record = JSON.parse(m[1]);
    } catch {
      record = null;
    }
  }
  return { id: c.id, body: c.body, record };
}

function commentBody(r: PrResult): string | null {
  if (r.comment === null) return null;
  return [MARKER, r.comment, ...(r.record ? ["", `<!-- spectree-record: ${JSON.stringify(r.record)} -->`] : [])].join("\n");
}

export interface RunOptions {
  gh: GitHub;
  workspace: string;
  defaultBranch: string;
  bot: string;
  siteDir: string;
  serverUrl: string;
  now: string;
  log: (line: string) => void;
}

/** One sweep: every open pull request against the default branch is evaluated and updated, then the dashboard is built. */
export async function run(o: RunOptions): Promise<{ failed: number; dashboard: boolean; host: string; project: string }> {
  const cfgFile = join(o.workspace, CONFIG_FILE);
  const { config: cfg, errors: cfgErrors } = loadConfig(existsSync(cfgFile) ? readFileSync(cfgFile, "utf8") : null);
  for (const e of cfgErrors) o.log(`::warning file=${CONFIG_FILE}::${e}`);
  const main = readSpecs(o.workspace, cfg);
  for (const e of main.errors) o.log(`::warning::${cfg.root}/${e}`);
  const baseFiles = listFiles(o.workspace);
  const canWrite = new Map<string, boolean>();
  const writer = async (user: string) => {
    const k = user.toLowerCase();
    if (!canWrite.has(k)) canWrite.set(k, await o.gh.canWrite(user));
    return canWrite.get(k)!;
  };

  const summaries: PrSummary[] = [];
  let failed = 0;
  for (const pull of await o.gh.openPulls(o.defaultBranch)) {
    const n: number = pull.number;
    try {
      const author: string = pull.user.login;
      const head: string = pull.head.sha;
      const files = (await o.gh.pullFiles(n)).map((f: any) => ({ path: f.filename as string, status: f.status as string, sha: f.sha as string }));
      const comments = await o.gh.comments(n);
      const own = recordIn(comments, o.bot);
      const touchesRoot = files.some((f: { path: string }) => f.path.startsWith(cfg.root + "/"));

      let reviews: PrInput["reviews"] = [];
      const specUnchangedSince: Record<string, boolean> = {};
      const specContents: Record<string, string> = {};
      const weights: Record<string, number> = {};
      let implementsRecord: ApprovalRecord | null = null;
      if (touchesRoot) {
        reviews = (await o.gh.reviews(n))
          .filter((r: any) => r.user?.login && r.submitted_at)
          .map((r: any) => ({ user: r.user.login as string, state: r.state as string, commit: r.commit_id as string, at: r.submitted_at as string }));
        const headTree = await o.gh.dirTreeSha(head, cfg.root);
        for (const c of new Set(reviews.map((r) => r.commit)))
          specUnchangedSince[c] = c === head || (headTree !== null && (await o.gh.dirTreeSha(c, cfg.root)) === headTree);
        for (const f of files)
          if (isSpecFile(cfg.root, f.path) && f.status !== "removed") {
            const text = await o.gh.fileAt(f.path, `refs/pull/${n}/head`);
            if (text !== null) specContents[f.path] = text;
          }
        for (const u of new Set([author, ...reviews.map((r) => r.user)])) weights[u.toLowerCase()] = weightOf(u, await writer(u), cfg);
        const ref = implementsRef(pull.body ?? "");
        if (ref && ref !== n) implementsRecord = recordIn(await o.gh.comments(ref), o.bot)?.record ?? null;
      }

      const result = evaluatePr(
        {
          number: n, author, headSha: head, body: pull.body ?? "", labels: (pull.labels ?? []).map((l: any) => l.name), files, reviews,
          specUnchangedSince, weights, authorCanWrite: await writer(author), specContents, baseSpecs: main.specs, baseFiles,
          record: own?.record ?? null, implementsRecord, now: o.now,
        },
        cfg,
      );

      const existing = await o.gh.statuses(head);
      for (const key of ["spec", "phase", "scope"] as const) {
        const s = result.statuses[key];
        const last = existing.find((e: any) => e.context === CONTEXTS[key]);
        if (!last || last.state !== s.state || last.description !== s.description.slice(0, 140)) await o.gh.setStatus(head, CONTEXTS[key], s.state, s.description, pull.html_url);
      }
      const body = commentBody(result);
      if (body !== null) {
        if (!own) await o.gh.addComment(n, body);
        else if (own.body !== body) await o.gh.updateComment(own.id, body);
      }
      if (result.addLabel) await o.gh.addLabel(n, LABEL_APPROVED);
      if (result.removeLabel) await o.gh.removeLabel(n, LABEL_APPROVED);
      if (result.close) await o.gh.closePull(n);
      o.log(`#${n} ${result.phase}: spec ${result.statuses.spec.state}, phase ${result.statuses.phase.state}, scope ${result.statuses.scope.state}`);
      summaries.push({ number: n, title: pull.title, author, url: pull.html_url, result });
    } catch (e) {
      failed++;
      o.log(`::error::#${n}: ${(e as Error).message}`);
    }
  }

  if (cfg.dashboard.enabled) {
    const data = buildData(main.specs, summaries, cfg, `${o.gh.owner}/${o.gh.repo}`, o.now);
    const dir = cfg.dashboard.path ? join(o.siteDir, cfg.dashboard.path) : o.siteDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), renderHtml(data, cfg, o.serverUrl));
    writeFileSync(join(dir, "roadmap.json"), JSON.stringify(data, null, 2) + "\n");
    writeFileSync(join(dir, "badge.json"), JSON.stringify(badgeOf(data)) + "\n");
    o.log(`dashboard: ${Object.keys(main.specs).length} specs in ${o.defaultBranch}, ${data.proposals.length} open proposals`);
  }
  return { failed, dashboard: cfg.dashboard.enabled, host: cfg.dashboard.host, project: cfg.dashboard.project };
}
