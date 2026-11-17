import { createHash } from "node:crypto";
import type { Config } from "./config.ts";

export interface ChangedFile {
  path: string;
  /** GitHub's status: added, modified, removed, renamed, ... */
  status: string;
  /** Git blob id of the file's content. */
  sha: string;
}

/** A hash of the spec files a PR changes. It depends on content only, so it survives a rebase and a squash. */
export function specDigest(specFiles: ChangedFile[]): string {
  const lines = specFiles
    .map((f) => `${f.status === "removed" ? "D" : "M"} ${f.path} ${f.status === "removed" ? "-" : f.sha}`)
    .sort();
  return "sha256:" + createHash("sha256").update(lines.join("\n")).digest("hex");
}

export interface Review {
  user: string;
  /** APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING */
  state: string;
  /** The commit the review was made on. */
  commit: string;
  at: string;
}

export interface Vote {
  user: string;
  vote: "for" | "against";
  weight: number;
  author?: boolean;
}

export interface Tally {
  passed: boolean;
  for: number;
  against: number;
  forPeople: number;
  againstPeople: number;
  votes: Vote[];
}

export function weightOf(user: string, canWrite: boolean, cfg: Config): number {
  const override = cfg.ratings[user.toLowerCase()];
  return override !== undefined ? override : canWrite ? 1 : 0;
}

/**
 * Counts the vote. Each person's latest counting review is their vote; a dismissed review withdraws it;
 * a review made on a commit whose spec differs from the current one does not count.
 */
export function tally(
  reviews: Review[],
  opts: { author: string; weight: (user: string) => number; specUnchangedSince: (commit: string) => boolean; cfg: Config },
): Tally {
  const latest = new Map<string, Review>();
  const counting = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);
  for (const r of [...reviews].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!counting.has(r.state)) continue;
    if (r.user.toLowerCase() === opts.author.toLowerCase()) continue;
    latest.set(r.user.toLowerCase(), r);
  }
  const votes: Vote[] = [];
  if (opts.cfg.count_author) votes.push({ user: opts.author, vote: "for", weight: opts.weight(opts.author), author: true });
  for (const r of latest.values()) {
    if (r.state === "DISMISSED") continue;
    if (!opts.specUnchangedSince(r.commit)) continue;
    votes.push({ user: r.user, vote: r.state === "APPROVED" ? "for" : "against", weight: opts.weight(r.user) });
  }
  votes.sort((a, b) => a.user.toLowerCase().localeCompare(b.user.toLowerCase()));
  const sum = (v: "for" | "against") => votes.filter((x) => x.vote === v).reduce((n, x) => n + x.weight, 0);
  const count = (v: "for" | "against") => votes.filter((x) => x.vote === v).length;
  const f = sum("for");
  const a = sum("against");
  return { passed: f >= opts.cfg.threshold && a <= opts.cfg.max_against, for: f, against: a, forPeople: count("for"), againstPeople: count("against"), votes };
}
