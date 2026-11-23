import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { buildData, renderHtml } from "./dashboard.ts";
import { CONFIG_FILE, readSpecs } from "./run.ts";
import { type Spec, levelName, missingAncestors } from "./tree.ts";

const SOURCE = "beamreach-ai/spectree";
const VERSION = "v1";

export const workflow = (branch: string) => `name: Spectree
on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled, ready_for_review]
  workflow_run:
    workflows: ["Spectree signal"]
    types: [completed]
  push:
    branches: [${branch}]
  schedule:
    - cron: "17 5 * * *"
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: write
  issues: write
  statuses: write
  pages: write
  id-token: write

jobs:
  spectree:
    uses: ${SOURCE}/.github/workflows/spectree.yml@${VERSION}
    # Used only with dashboard.host: cloudflare in .spectree.yml. No other secret is passed.
    secrets:
      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
`;

export const signal = `name: Spectree signal
# A review on a pull request from a fork cannot write the vote count.
# This workflow has no permissions and does nothing; its completion starts "Spectree", which can.
on:
  pull_request_review:
    types: [submitted, edited, dismissed]

permissions: {}

jobs:
  signal:
    runs-on: ubuntu-latest
    steps:
      - run: echo "A review was recorded."
`;

function defaultBranch(dir: string): string {
  try {
    const ref = execFileSync("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return ref.replace(/^origin\//, "") || "main";
  } catch {
    try {
      return execFileSync("git", ["branch", "--show-current"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "main";
    } catch {
      return "main";
    }
  }
}

function init(dir: string): number {
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  const branch = defaultBranch(dir);
  const files: [string, string][] = [
    [join(wf, "spectree.yml"), workflow(branch)],
    [join(wf, "spectree-signal.yml"), signal],
  ];
  for (const [path, text] of files) {
    if (existsSync(path)) console.log(`kept     ${path.slice(dir.length + 1)} (already there)`);
    else {
      writeFileSync(path, text);
      console.log(`created  ${path.slice(dir.length + 1)}`);
    }
  }
  console.log(`
Next:
  1. Commit the two files and push them to ${branch}.
  2. In the repository settings, under Pages, choose "GitHub Actions" as the source.
  3. Optional: add ${CONFIG_FILE} to change the defaults, and mark the spectree checks as required.
  4. Add your first spec under roadmap/<name>/spec.md in a pull request.
Guide: https://github.com/${SOURCE}/blob/main/docs/setup.md`);
  return 0;
}

function load(dir: string) {
  const file = join(dir, CONFIG_FILE);
  const { config, errors } = loadConfig(existsSync(file) ? readFileSync(file, "utf8") : null);
  const { specs, errors: specErrors } = readSpecs(dir, config);
  const known = new Set(Object.keys(specs));
  const all = [...errors.map((e) => `${CONFIG_FILE}: ${e}`), ...specErrors];
  for (const id of known) for (const anc of missingAncestors(id, known)) all.push(`${id}: its parent ${anc} has no spec.md`);
  return { config, specs, errors: [...new Set(all)] };
}

function printTree(specs: Record<string, Spec>, levels: string[]) {
  for (const id of Object.keys(specs).sort()) {
    const depth = id.split("/").length - 1;
    const s = specs[id];
    console.log(`${"  ".repeat(depth)}${id.split("/").pop()}  [${levelName(id, levels)}${s.kind === "group" ? ", group" : ""}]  ${s.title}`);
  }
}

export function main(argv: string[], dir = process.cwd()): number {
  const [cmd, arg] = argv;
  if (cmd === "init") return init(dir);
  if (cmd === "validate" || cmd === "tree" || cmd === "preview") {
    const { config, specs, errors } = load(dir);
    if (cmd === "tree") printTree(specs, config.levels);
    if (cmd === "preview") {
      const out = arg || "_spectree_site";
      mkdirSync(out, { recursive: true });
      const data = buildData(specs, [], config, "local/preview", new Date().toISOString(), {});
      writeFileSync(join(out, "index.html"), renderHtml(data, config));
      writeFileSync(join(out, "roadmap.json"), JSON.stringify(data, null, 2) + "\n");
      console.log(`wrote ${out}/index.html`);
    }
    for (const e of errors) console.error(`error: ${e}`);
    if (cmd === "validate" && !errors.length) console.log(`${Object.keys(specs).length} specs, no problems`);
    return errors.length ? 1 : 0;
  }
  console.log(`spectree: specs as a tree in your repository

  spectree init             add the two workflow files to this repository
  spectree validate         check ${CONFIG_FILE} and every spec.md
  spectree tree             print the spec tree
  spectree preview [dir]    build the dashboard from the local tree (open pull requests are not shown)`);
  return cmd && cmd !== "help" && cmd !== "--help" ? 1 : 0;
}
