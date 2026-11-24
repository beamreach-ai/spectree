// Commands in pull-request comments: `/spectree for`, `against`, `withdraw`, `take`, `status`.
import type { Review } from "./tally.ts";

export const COMMANDS = ["for", "against", "withdraw", "take", "status"] as const;
export type CommandName = (typeof COMMANDS)[number] | "unknown";

export interface Command {
  name: CommandName;
  /** What follows the command on its line: the reason of `against`. */
  arg: string;
}

export interface CommandComment {
  id: number;
  user: string;
  body: string;
  /** When the comment was written, or last edited. */
  at: string;
  /** The workflow has already marked it. */
  acked: boolean;
}

/** The command on a comment's first line, or null when the comment is not one. */
export function parseCommand(body: string): Command | null {
  const first = body.replace(/^\s+/, "").split(/\r?\n/)[0];
  const m = /^\/spectree(?:\s+(\S+)(.*))?$/i.exec(first.trim());
  if (!m) return null;
  const word = (m[1] ?? "").toLowerCase();
  const name = (COMMANDS as readonly string[]).includes(word) ? (word as CommandName) : "unknown";
  return { name, arg: (m[2] ?? "").trim() };
}

/** The commit a command vote is recorded under, in place of a review's commit. */
export const commandRef = (id: number) => `comment:${id}`;

/** The votes among the comments, as reviews: `for` approves, `against` requests changes, `withdraw` dismisses. */
export function commandReviews(comments: CommandComment[]): Review[] {
  const state: Record<string, string> = { for: "APPROVED", against: "CHANGES_REQUESTED", withdraw: "DISMISSED" };
  const out: Review[] = [];
  for (const c of comments) {
    const cmd = parseCommand(c.body);
    if (cmd && state[cmd.name]) out.push({ user: c.user, state: state[cmd.name], commit: commandRef(c.id), at: c.at });
  }
  return out;
}

/**
 * When the workflow first saw each spec digest on a pull request. A command counts for the spec as it is now
 * only when it was written after the workflow first saw that spec, so a vote never carries over to a text it was
 * not made on. Both times are the server's and the runner's, never a commit's, which its author can set.
 */
export function sawDigest(seen: Record<string, string>, digest: string, now: string, keep = 20): Record<string, string> {
  if (seen[digest]) return seen;
  const entries = [...Object.entries(seen), [digest, now] as [string, string]];
  return Object.fromEntries(entries.slice(-keep));
}

export function countsNow(c: CommandComment, seen: Record<string, string>, digest: string): boolean {
  const first = seen[digest];
  return first !== undefined && Date.parse(c.at) >= Date.parse(first);
}

/** Who said they will write the code: the latest `take`, unless that person withdrew after it. */
export function takenBy(comments: CommandComment[]): string {
  let who = "";
  for (const c of [...comments].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const cmd = parseCommand(c.body);
    if (cmd?.name === "take") who = c.user;
    else if (cmd?.name === "withdraw" && c.user.toLowerCase() === who.toLowerCase()) who = "";
  }
  return who;
}

export const HELP = [
  "Commands, as the first line of a comment on a spec pull request:",
  "",
  "| Comment | Effect |",
  "|---|---|",
  "| `/spectree for` | a vote for, the same as an approving review. Once the spec is approved, it approves the code |",
  '| `/spectree against <reason>` | a vote against, the same as "Request changes". Once the spec is approved, it is about the code |',
  "| `/spectree withdraw` | takes your vote back |",
  "| `/spectree take` | says you will write the code of an approved spec |",
  "| `/spectree status` | asks for the tally and what the pull request waits for |",
].join("\n");
