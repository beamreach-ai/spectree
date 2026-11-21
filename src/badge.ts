import type { DashData, DashNode } from "./dashboard.ts";

/** The shields.io endpoint format: https://shields.io/badges/endpoint-badge */
export interface Badge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

/** A badge for the README: specs done, proposals open, and whether any proposal waits for votes. */
export function badgeOf(data: DashData): Badge {
  let done = 0;
  const walk = (n: DashNode) => {
    if (n.kind === "leaf" && n.status === "done") done++;
    n.children.forEach(walk);
  };
  data.tree.forEach(walk);
  const open = data.proposals.length;
  const voting = data.proposals.filter((p) => p.phase === "spec").length;
  const parts = [`${done} done`, `${open} open`];
  if (voting) parts.push(`${voting} ${voting === 1 ? "needs" : "need"} votes`);
  return { schemaVersion: 1, label: "roadmap", message: parts.join(" · "), color: voting ? "blueviolet" : "brightgreen" };
}
