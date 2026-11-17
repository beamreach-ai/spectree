import { appendFileSync, readFileSync } from "node:fs";
import { GitHub } from "./github.ts";
import { run } from "./run.ts";

/** Entry point of the GitHub Action. It expects a checkout of the default branch in GITHUB_WORKSPACE, never of a pull request. */
async function main() {
  const env = process.env;
  const input = (name: string) => (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
  const token = input("token") || env.GITHUB_TOKEN || "";
  const repository = env.GITHUB_REPOSITORY || "";
  if (!token || !repository) throw new Error("spectree needs a token and GITHUB_REPOSITORY");
  let defaultBranch = input("default_branch");
  if (!defaultBranch && env.GITHUB_EVENT_PATH) {
    try {
      defaultBranch = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")).repository?.default_branch ?? "";
    } catch {
      defaultBranch = "";
    }
  }
  const result = await run({
    gh: new GitHub(token, repository, env.GITHUB_API_URL || "https://api.github.com"),
    workspace: env.GITHUB_WORKSPACE || process.cwd(),
    defaultBranch: defaultBranch || "main",
    bot: input("bot") || "github-actions[bot]",
    siteDir: input("site_dir") || "_spectree_site",
    serverUrl: env.GITHUB_SERVER_URL || "https://github.com",
    now: new Date().toISOString(),
    log: (line) => console.log(line),
  });
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `dashboard=${result.dashboard}\n`);
  if (result.failed) process.exitCode = 1;
}

main().catch((e) => {
  console.log(`::error::${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
