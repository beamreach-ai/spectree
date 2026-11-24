/** A small GitHub REST client. It only reads pull requests as data; nothing here runs or checks out their code. */
export class GitHub {
  private api: string;
  private token: string;
  readonly owner: string;
  readonly repo: string;
  constructor(token: string, repository: string, api = "https://api.github.com") {
    this.token = token;
    this.api = api.replace(/\/+$/, "");
    [this.owner, this.repo] = repository.split("/");
  }

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any; link: string | null }> {
    const url = path.startsWith("http") ? path : `${this.api}/repos/${this.owner}/${this.repo}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "spectree",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, link: res.headers.get("link") };
  }

  private async get(path: string): Promise<any> {
    const r = await this.call("GET", path);
    if (r.status >= 400) throw new Error(`GET ${path}: ${r.status} ${r.data?.message ?? ""}`);
    return r.data;
  }

  private async write(method: string, path: string, body?: unknown): Promise<any> {
    const r = await this.call(method, path, body);
    if (r.status >= 400) throw new Error(`${method} ${path}: ${r.status} ${r.data?.message ?? ""}`);
    return r.data;
  }

  private async all(path: string): Promise<any[]> {
    const out: any[] = [];
    let next: string | null = path + (path.includes("?") ? "&" : "?") + "per_page=100";
    while (next) {
      const r = await this.call("GET", next);
      if (r.status >= 400) throw new Error(`GET ${next}: ${r.status} ${r.data?.message ?? ""}`);
      out.push(...r.data);
      const m: RegExpExecArray | null = r.link ? /<([^>]+)>;\s*rel="next"/.exec(r.link) : null;
      next = m ? m[1] : null;
    }
    return out;
  }

  openPulls = (base: string) => this.all(`/pulls?state=open&base=${encodeURIComponent(base)}`);
  pull = (n: number) => this.get(`/pulls/${n}`);
  pullFiles = (n: number) => this.all(`/pulls/${n}/files`);
  reviews = (n: number) => this.all(`/pulls/${n}/reviews`);
  comments = (n: number) => this.all(`/issues/${n}/comments`);
  /** Issues, open and closed, that carry a label. Pull requests are left out. */
  issuesLabeled = async (label: string) => (await this.all(`/issues?state=all&labels=${encodeURIComponent(label)}`)).filter((i) => !i.pull_request);
  issue = (n: number) => this.get(`/issues/${n}`);
  /** Commits on a branch that touch a path, newest first, since a time. */
  commitsSince = (path: string, since: string, branch: string) =>
    this.all(`/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&since=${encodeURIComponent(since)}`);
  commit = (sha: string) => this.get(`/commits/${sha}`);
  addReaction = (commentId: number, content: string) => this.write("POST", `/issues/comments/${commentId}/reactions`, { content });
  /** Creates the label when the repository does not have it. */
  async ensureLabel(name: string, color: string, description: string): Promise<void> {
    const r = await this.call("GET", `/labels/${encodeURIComponent(name)}`);
    if (r.status === 404) await this.write("POST", "/labels", { name, color, description });
  }
  statuses = (sha: string) => this.all(`/commits/${sha}/statuses`);

  /** True when the user may push to the repository. */
  async canWrite(user: string): Promise<boolean> {
    const r = await this.call("GET", `/collaborators/${encodeURIComponent(user)}/permission`);
    if (r.status >= 400) return false;
    return r.data?.permission === "admin" || r.data?.permission === "write";
  }

  /** A file's text at a ref, or null when it does not exist there. */
  async fileAt(path: string, ref: string): Promise<string | null> {
    const r = await this.call("GET", `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
    if (r.status === 404) return null;
    if (r.status >= 400) throw new Error(`reading ${path} at ${ref}: ${r.status}`);
    return typeof r.data?.content === "string" ? Buffer.from(r.data.content, "base64").toString("utf8") : null;
  }

  /** The Git tree id of a directory at a commit: equal ids mean identical content. Null when the commit or directory is not there. */
  async dirTreeSha(commit: string, dir: string): Promise<string | null> {
    let r = await this.call("GET", `/git/commits/${commit}`);
    if (r.status >= 400) return null;
    let tree: string = r.data.tree.sha;
    for (const part of dir.split("/")) {
      r = await this.call("GET", `/git/trees/${tree}`);
      if (r.status >= 400) return null;
      const entry = (r.data.tree as any[]).find((e) => e.path === part && e.type === "tree");
      if (!entry) return null;
      tree = entry.sha;
    }
    return tree;
  }

  setStatus = (sha: string, context: string, state: string, description: string, target_url?: string) =>
    this.write("POST", `/statuses/${sha}`, { state, context, description: description.slice(0, 140), ...(target_url ? { target_url } : {}) });
  addComment = (n: number, body: string) => this.write("POST", `/issues/${n}/comments`, { body });
  updateComment = (id: number, body: string) => this.write("PATCH", `/issues/comments/${id}`, { body });
  addLabel = (n: number, label: string) => this.write("POST", `/issues/${n}/labels`, { labels: [label] });
  async removeLabel(n: number, label: string): Promise<void> {
    const r = await this.call("DELETE", `/issues/${n}/labels/${encodeURIComponent(label)}`);
    if (r.status >= 400 && r.status !== 404) throw new Error(`removing label ${label} from #${n}: ${r.status}`);
  }
  closePull = (n: number) => this.write("PATCH", `/pulls/${n}`, { state: "closed" });
}
