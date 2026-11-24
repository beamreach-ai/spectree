import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { badgeOf } from "./badge.ts";
import { type CommandComment, HELP, commandRef, commandReviews, countsNow, parseCommand, sawDigest, takenBy } from "./commands.ts";
import { type Config, loadConfig } from "./config.ts";
import { type Extra, type Merge, type PrSummary, THREAD_LABEL, buildData, demandOf, renderHtml } from "./dashboard.ts";
import { type ApprovalRecord, type PrInput, type PrResult, LABEL_APPROVED, evaluatePr, implementsRef } from "./evaluate.ts";
import type { GitHub } from "./github.ts";
import { specDigest, weightOf } from "./tally.ts";
import { type Spec, SPEC_FILE, isSpecFile, parseSpec } from "./tree.ts";

export const CONFIG_FILE = ".spectree.yml";
const MARKER = "<!-- spectree -->";
const RECORD = /<!-- spectree-record: (.*?) -->/s;
const SEEN = /<!-- spectree-seen: (.*?) -->/s;
/** In the ledger of first sightings, a head commit is kept under this prefix; the other keys are spec digests. */
const HEAD = "head:";
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

function recordIn(comments: any[], bot: string): { id: number; body: string; record: ApprovalRecord | null; seen: Record<string, string> } | null {
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
  let seen: Record<string, string> = {};
  try {
    const s = SEEN.exec(c.body);
    if (s) seen = JSON.parse(s[1]);
  } catch {
    seen = {};
  }
  return { id: c.id, body: c.body, record, seen };
}

function commentBody(r: PrResult, seen: Record<string, string>): string | null {
  if (r.comment === null) return null;
  return [
    MARKER,
    r.comment,
    ...(r.record ? ["", `<!-- spectree-record: ${JSON.stringify(r.record)} -->`] : []),
    ...(Object.keys(seen).length ? [`<!-- spectree-seen: ${JSON.stringify(seen)} -->`] : []),
  ].join("\n");
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
  const extra: Extra = { branch: o.defaultBranch, threads: {}, reactions: {} };
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
      const onHead: Record<string, boolean> = {};
      let implementsRecord: ApprovalRecord | null = null;
      // Comments that are commands, the workflow's own left out.
      const commands: CommandComment[] = comments
        .filter((c: any) => c.user?.login && c.user.login !== o.bot && typeof c.body === "string" && parseCommand(c.body))
        .map((c: any) => ({
          id: c.id as number, user: c.user.login as string, body: c.body as string, at: (c.updated_at ?? c.created_at ?? o.now) as string,
          acked: (c.reactions?.eyes ?? 0) > 0 || (c.reactions?.confused ?? 0) > 0,
        }));
      let seen: Record<string, string> = own?.seen ?? {};
      const counted = new Set<number>();
      if (touchesRoot) {
        // The spec as it is now, and when the workflow first saw it. A command made before that was made on another text.
        const digest = specDigest(files.filter((f: { path: string }) => f.path.startsWith(cfg.root + "/")));
        seen = sawDigest(seen, digest, o.now);
        for (const c of commands) if ((specUnchangedSince[commandRef(c.id)] = countsNow(c, seen, digest))) counted.add(c.id);
        // The same for the head commit, which is what a code review is given on. Only the current head is kept.
        const headKey = HEAD + head;
        if (!seen[headKey]) seen = { ...Object.fromEntries(Object.entries(seen).filter(([k]) => !k.startsWith(HEAD))), [headKey]: o.now };
        for (const c of commands) if ((onHead[commandRef(c.id)] = countsNow(c, seen, headKey))) counted.add(c.id);
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
        reviews.push(...commandReviews(commands));
        for (const u of new Set([author, ...reviews.map((r) => r.user)])) weights[u.toLowerCase()] = weightOf(u, await writer(u), cfg);
        const ref = implementsRef(pull.body ?? "");
        if (ref && ref !== n) implementsRecord = recordIn(await o.gh.comments(ref), o.bot)?.record ?? null;
      }

      const result = evaluatePr(
        {
          number: n, author, headSha: head, body: pull.body ?? "", labels: (pull.labels ?? []).map((l: any) => l.name), files, reviews,
          specUnchangedSince, onHead, weights, authorCanWrite: await writer(author), specContents, baseSpecs: main.specs, baseFiles,
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
      const body = commentBody(result, touchesRoot ? seen : {});
      if (body !== null) {
        if (!own) await o.gh.addComment(n, body);
        else if (own.body !== body) await o.gh.updateComment(own.id, body);
      }
      if (result.addLabel) await o.gh.addLabel(n, LABEL_APPROVED);
      if (result.removeLabel) await o.gh.removeLabel(n, LABEL_APPROVED);
      if (result.close) await o.gh.closePull(n);
      // Each command is answered once: a mark on the comment, and a reply where it asked for one.
      for (const c of touchesRoot ? commands.filter((x) => !x.acked) : []) {
        const cmd = parseCommand(c.body)!;
        try {
          if (cmd.name === "unknown") {
            await o.gh.addComment(n, `@${c.user} that is not a command spectree knows.\n\n${HELP}`);
            await o.gh.addReaction(c.id, "confused");
          } else if (cmd.name === "status") {
            const s = result.statuses;
            await o.gh.addComment(n, `@${c.user} where #${n} stands:\n\n- Spec: ${s.spec.description}\n- Phase: ${s.phase.description}\n- Scope: ${s.scope.description}`);
            await o.gh.addReaction(c.id, "eyes");
          } else if (cmd.name === "take" || cmd.name === "withdraw" || counted.has(c.id)) await o.gh.addReaction(c.id, "eyes");
        } catch (e) {
          o.log(`::warning::#${n}: the command in comment ${c.id} could not be answered: ${(e as Error).message}`);
        }
      }
      o.log(`#${n} ${result.phase}: spec ${result.statuses.spec.state}, phase ${result.statuses.phase.state}, scope ${result.statuses.scope.state}`);
      if (cfg.demand.enabled && cfg.dashboard.enabled && touchesRoot) {
        try {
          extra.reactions![n] = demandOf((await o.gh.issue(n)).reactions);
        } catch (e) {
          o.log(`::warning::#${n}: demand could not be read: ${(e as Error).message}`);
        }
      }
      summaries.push({ number: n, title: pull.title, author, url: pull.html_url, opened: pull.created_at ?? "", taken: touchesRoot ? takenBy(commands) : "", result });
    } catch (e) {
      failed++;
      o.log(`::error::#${n}: ${(e as Error).message}`);
    }
  }

  if (cfg.dashboard.enabled) {
    if (cfg.demand.enabled) {
      // A spec's thread is the issue labelled spectree whose title is the spec's id. The first one opened wins.
      try {
        await o.gh.ensureLabel(THREAD_LABEL, "5b4bb5", "The thread of a spec: discussion, and a thumbs-up to say you want it");
        const open = new Set(summaries.flatMap((s) => s.result.nodes.map((x) => x.id)));
        for (const i of (await o.gh.issuesLabeled(THREAD_LABEL)).sort((a: any, b: any) => a.number - b.number)) {
          const id = String(i.title ?? "").trim().replace(/^`|`$/g, "");
          if (!main.specs[id] && !open.has(id)) o.log(`thread #${i.number} "${id}" matches no spec; ignored`);
          else if (!extra.threads![id]) extra.threads![id] = { number: i.number, url: i.html_url, ...demandOf(i.reactions) };
        }
      } catch (e) {
        o.log(`::warning::demand could not be read: ${(e as Error).message}`);
      }
    }
    // What reached the default branch lately: the commits that touched the root, and the specs each one added or started building.
    const days = Math.max(90, cfg.dashboard.recent_days);
    if (cfg.dashboard.recent_days > 0) {
      try {
        const merges: Merge[] = [];
        const since = new Date(Date.parse(o.now) - days * 86_400_000).toISOString();
        for (const c of (await o.gh.commitsSince(cfg.root, since, o.defaultBranch)).slice(0, 60)) {
          const full = await o.gh.commit(c.sha);
          const added: string[] = [];
          const built: string[] = [];
          for (const f of full.files ?? []) {
            if (!isSpecFile(cfg.root, f.filename)) continue;
            const id = f.filename.slice(cfg.root.length + 1, -SPEC_FILE.length - 1);
            if (f.status === "added") added.push(id);
            else if (f.status === "modified" && /^-planned:/m.test(f.patch ?? "") && !/^\+planned:/m.test(f.patch ?? "")) built.push(id);
          }
          if (added.length || built.length)
            merges.push({ sha: c.sha, at: full.commit?.committer?.date ?? "", title: String(full.commit?.message ?? "").split("\n")[0], url: full.html_url ?? "", added, built });
        }
        extra.merges = merges;
      } catch (e) {
        o.log(`::warning::recent changes could not be read: ${(e as Error).message}`);
      }
    }
    const data = buildData(main.specs, summaries, cfg, `${o.gh.owner}/${o.gh.repo}`, o.now, extra);
    const dir = cfg.dashboard.path ? join(o.siteDir, cfg.dashboard.path) : o.siteDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), renderHtml(data, cfg, o.serverUrl));
    writeFileSync(join(dir, "roadmap.json"), JSON.stringify(data, null, 2) + "\n");
    writeFileSync(join(dir, "badge.json"), JSON.stringify(badgeOf(data)) + "\n");
    o.log(`dashboard: ${Object.keys(main.specs).length} specs in ${o.defaultBranch}, ${data.proposals.length} open proposals`);
  }
  return { failed, dashboard: cfg.dashboard.enabled, host: cfg.dashboard.host, project: cfg.dashboard.project };
}
