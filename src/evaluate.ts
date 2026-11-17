import picomatch from "picomatch";
import type { Config } from "./config.ts";
import { type ChangedFile, type Review, type Tally, specDigest, tally } from "./tally.ts";
import { type Spec, isSpecFile, missingAncestors, nodeIdOf, parseSpec } from "./tree.ts";

export const LABEL_APPROVED = "spec-approved";
export const LABEL_NO_SPEC = "no-spec";

export interface ApprovalRecord {
  digest: string;
  commit: string;
  at: string;
  /** The PR the vote happened on. */
  pr: number;
  tally: Tally;
}

export interface PrInput {
  number: number;
  author: string;
  headSha: string;
  body: string;
  labels: string[];
  files: ChangedFile[];
  reviews: Review[];
  /** For each review commit: is the spec there the same as at the head? */
  specUnchangedSince: Record<string, boolean>;
  /** Vote weight of the author and every reviewer. */
  weights: Record<string, number>;
  authorCanWrite: boolean;
  /** Content at the head of every changed, not removed `spec.md`. */
  specContents: Record<string, string>;
  /** The nodes in the default branch. */
  baseSpecs: Record<string, Spec>;
  /** Every file in the default branch, or null when it could not be listed. */
  baseFiles: Set<string> | null;
  /** The approval record already written on this PR, if any. */
  record: ApprovalRecord | null;
  /** The record of the PR named by `Implements: #n`, if any. */
  implementsRecord: ApprovalRecord | null;
  now: string;
}

export type Phase = "none" | "missing" | "spec" | "approved" | "code";
export type State = "success" | "failure" | "pending";
export interface Status {
  state: State;
  description: string;
}
export interface NodeChange {
  id: string;
  title: string;
  kind: "leaf" | "group";
  change: "added" | "changed" | "removed";
}

export interface PrResult {
  phase: Phase;
  statuses: { spec: Status; phase: Status; scope: Status };
  /** The record to keep on the PR. Null when the spec is not approved. */
  record: ApprovalRecord | null;
  tally: Tally | null;
  digest: string | null;
  nodes: NodeChange[];
  errors: string[];
  addLabel: boolean;
  removeLabel: boolean;
  close: boolean;
  /** Text for the workflow's one comment on the PR, without the hidden record. Null: leave the PR without a comment. */
  comment: string | null;
}

const ok = (description: string): Status => ({ state: "success", description });
const fail = (description: string): Status => ({ state: "failure", description });
const wait = (description: string): Status => ({ state: "pending", description });
const list = (items: string[], max = 3) => items.slice(0, max).join(", ") + (items.length > max ? ` and ${items.length - max} more` : "");
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const matcher = (globs: string[]) => (globs.length ? picomatch(globs, { dot: true }) : () => false);

export function implementsRef(body: string): number | null {
  const m = /^\s*Implements:\s*#(\d+)\s*$/im.exec(body || "");
  return m ? Number(m[1]) : null;
}

export function tallyLine(t: Tally, cfg: Config): string {
  return `${t.for} of ${cfg.threshold} needed for, ${t.against} against`;
}

/** Decides everything about one pull request from data already fetched. No side effects. */
export function evaluatePr(input: PrInput, cfg: Config): PrResult {
  const exempt = matcher(cfg.exempt_paths);
  const inRoot = (p: string) => p.startsWith(cfg.root + "/");
  const specFiles = input.files.filter((f) => inRoot(f.path));
  const codeFiles = input.files.filter((f) => !inRoot(f.path) && !exempt(f.path));
  const na = ok("Not applicable");
  const base: PrResult = {
    phase: "none", statuses: { spec: na, phase: na, scope: na }, record: null, tally: null, digest: null, nodes: [], errors: [],
    addLabel: false, removeLabel: input.labels.includes(LABEL_APPROVED), close: false, comment: null,
  };

  // A pull request that touches no spec.
  if (!specFiles.length) {
    if (!codeFiles.length) return { ...base, statuses: { spec: ok("No spec needed: only exempt files changed"), phase: na, scope: na } };
    if (cfg.exempt_authors.some((a) => a.toLowerCase() === input.author.toLowerCase()))
      return { ...base, statuses: { spec: ok(`No spec needed: ${input.author} is exempt`), phase: na, scope: na } };
    if (input.labels.includes(LABEL_NO_SPEC))
      return { ...base, statuses: { spec: ok(`No spec needed: a maintainer added the ${LABEL_NO_SPEC} label`), phase: na, scope: na } };
    return {
      ...base,
      phase: "missing",
      statuses: { spec: fail("This change has no approved spec. Propose the spec first"), phase: na, scope: na },
      close: cfg.on_missing_spec === "close",
      comment: [
        "**This pull request changes code that has no approved spec.**",
        "",
        `This project accepts code only for a spec that passed a vote. To continue, add the spec under \`${cfg.root}/\` in this pull request and remove the code until the vote passes, or take over an approved spec with \`Implements: #<number>\` in the description.`,
        "",
        `A maintainer can waive this for a small fix with the \`${LABEL_NO_SPEC}\` label.`,
      ].join("\n"),
    };
  }

  // A spec pull request.
  const errors: string[] = [];
  const headSpecs: Record<string, Spec> = {};
  const nodes: NodeChange[] = [];
  for (const f of specFiles) {
    if (!isSpecFile(cfg.root, f.path)) continue;
    const id = nodeIdOf(cfg.root, f.path)!;
    const before = input.baseSpecs[id];
    if (f.status === "removed") {
      if (before) nodes.push({ id, title: before.title, kind: before.kind, change: "removed" });
      continue;
    }
    const content = input.specContents[f.path];
    if (content === undefined) {
      errors.push(`${f.path}: could not be read`);
      continue;
    }
    const parsed = parseSpec(id, content);
    errors.push(...parsed.errors);
    if (parsed.spec) {
      headSpecs[id] = parsed.spec;
      nodes.push({ id, title: parsed.spec.title, kind: parsed.spec.kind, change: before ? "changed" : "added" });
    }
  }
  const removed = new Set(nodes.filter((n) => n.change === "removed").map((n) => n.id));
  const known = new Set([...Object.keys(input.baseSpecs).filter((id) => !removed.has(id)), ...Object.keys(headSpecs)]);
  for (const id of Object.keys(headSpecs))
    for (const anc of missingAncestors(id, known)) errors.push(`${id}: its parent ${anc} has no spec.md`);
  for (const id of removed)
    for (const other of known) if (other.startsWith(id + "/")) errors.push(`${id}: cannot be removed while ${other} exists`);
  nodes.sort((a, b) => a.id.localeCompare(b.id));

  const digest = specDigest(specFiles);
  const live = tally(input.reviews, {
    author: input.author,
    weight: (u) => input.weights[u.toLowerCase()] ?? 0,
    specUnchangedSince: (c) => c === input.headSha || input.specUnchangedSince[c] === true,
    cfg,
  });

  let record: ApprovalRecord | null = null;
  if (!errors.length) {
    if (input.record && input.record.digest === digest) record = input.record;
    else if (input.implementsRecord && input.implementsRecord.digest === digest) record = input.implementsRecord;
    else if (live.passed) record = { digest, commit: input.headSha, at: input.now, pr: input.number, tally: live };
  }
  const approved = record !== null;
  const shown = record ? record.tally : live;
  const hasCode = codeFiles.length > 0;
  const leaves = nodes.filter((n) => n.kind === "leaf");
  const phase: Phase = approved ? (hasCode ? "code" : "approved") : "spec";

  const spec: Status = errors.length
    ? fail(`The spec is not valid: ${errors[0]}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""}`)
    : approved
      ? ok(`Vote passed: ${shown.for} for, ${shown.against} against${record!.pr !== input.number ? ` (in #${record!.pr})` : ""}`)
      : wait(`Vote open: ${tallyLine(live, cfg)}`);

  let phaseStatus: Status;
  if (!approved && hasCode) phaseStatus = fail(`Code before approval: remove ${plural(codeFiles.length, "file")} until the vote passes`);
  else if (!approved) phaseStatus = ok("Spec phase: waiting for the vote");
  else if (hasCode && cfg.implementation === "maintainers" && !input.authorCanWrite)
    phaseStatus = fail("In this project only maintainers write the code for an approved spec");
  else if (hasCode) phaseStatus = ok("Code phase: the spec is approved and frozen");
  else if (leaves.length) phaseStatus = wait("Spec approved. Add the code to this pull request");
  else phaseStatus = ok("Spec approved. A group needs no code");

  let scope: Status = ok(hasCode ? "Checked" : "No code yet");
  if (hasCode && !errors.length) {
    const allowedGlobs = leaves.flatMap((n) => [...(headSpecs[n.id]?.paths ?? []), ...(input.baseSpecs[n.id]?.paths ?? [])]);
    const allowed = matcher(allowedGlobs);
    const outside = codeFiles.filter((f) => !allowed(f.path)).map((f) => f.path);
    const missingTests: string[] = [];
    if (input.baseFiles) {
      const gone = new Set(input.files.filter((f) => f.status === "removed").map((f) => f.path));
      const present = new Set([...input.baseFiles].filter((p) => !gone.has(p)));
      for (const f of input.files) if (f.status !== "removed") present.add(f.path);
      for (const id of Object.keys(headSpecs))
        for (const c of headSpecs[id].criteria)
          for (const t of c.tests) {
            const hit = picomatch(t, { dot: true });
            if (![...present].some((p) => hit(p))) missingTests.push(`${t} (${id}, criterion ${c.id})`);
          }
    }
    if (outside.length) scope = fail(`${plural(outside.length, "file")} outside the spec's paths: ${list(outside)}`);
    else if (missingTests.length) scope = fail(`${plural(missingTests.length, "test")} named by the spec ${missingTests.length === 1 ? "does" : "do"} not exist: ${list(missingTests, 2)}`);
    else scope = ok(`${plural(codeFiles.length, "file")} inside the spec's paths, every criterion names an existing test`);
  }

  const next = errors.length
    ? "Fix the spec. The vote starts when it is valid."
    : phase === "spec"
      ? hasCode
        ? "Remove the code from this pull request until the vote passes."
        : 'Vote with a review: "Approve" is for, "Request changes" is against.'
      : phase === "approved"
        ? leaves.length
          ? "The spec is frozen. Add the code to this pull request."
          : "This pull request can merge."
        : "The spec is frozen. The code goes through normal review.";
  const votes = shown.votes.length
    ? shown.votes.map((v) => `- ${v.vote === "for" ? "For" : "Against"}: @${v.user}, weight ${v.weight}${v.author ? " (author)" : ""}`)
    : ["- No votes yet"];
  const comment = [
    `**Spec vote: ${errors.length ? "not started" : approved ? "passed" : "open"}**`,
    "",
    "| | Weighted | People |",
    "|---|---|---|",
    `| For | ${shown.for} of ${cfg.threshold} needed | ${shown.forPeople} |`,
    `| Against | ${shown.against} (at most ${cfg.max_against}) | ${shown.againstPeople} |`,
    "",
    ...votes,
    "",
    ...(errors.length ? ["**Problems in the spec:**", ...errors.map((e) => `- ${e}`), ""] : []),
    ...(nodes.length ? ["**Specs in this pull request:**", ...nodes.map((n) => `- \`${n.id}\` (${n.kind}, ${n.change}): ${n.title}`), ""] : []),
    ...(record ? [`Approved at commit ${record.commit.slice(0, 7)}${record.pr !== input.number ? ` in #${record.pr}` : ""}, spec digest \`${record.digest.slice(0, 19)}\`.`, ""] : []),
    `**Next:** ${next}`,
  ].join("\n");

  return {
    phase, statuses: { spec, phase: phaseStatus, scope }, record, tally: shown, digest, nodes, errors,
    addLabel: approved && !input.labels.includes(LABEL_APPROVED),
    removeLabel: !approved && input.labels.includes(LABEL_APPROVED),
    close: false, comment,
  };
}
