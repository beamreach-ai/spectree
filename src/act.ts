// The roadmap page's sign-in and buttons. As in find.ts, each function uses nothing outside itself and the other
// functions here, because the page's script is made of their source (see actScript).

/** One request to the GitHub API. */
export interface Write {
  url: string;
  method: "POST";
  body: Record<string, string>;
}

/** What the page shows after a write. */
export interface Outcome {
  ok: boolean;
  /** `Sent as @login`, or GitHub's message when it refused. */
  text: string;
  /** The address of the comment a vote made; empty for a thumbs-up and for a refusal. */
  url: string;
  note: string;
  /** GitHub no longer accepts the token. */
  signOut: boolean;
}

export interface Signed {
  token: string;
  /** Milliseconds since 1970; 0 when the token does not expire. */
  expires_at: number;
  login: string;
}

/** What the session needs from the browser; the tests give it their own. */
export interface Env {
  signIn: string;
  api: string;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<any> }>;
  subtle: { digest(algorithm: string, data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> };
  random: (bytes: number) => Uint8Array;
  now: () => number;
}

/** The API of a GitHub server: api.github.com, or `/api/v3` on a server of one's own. */
export const apiOf = (serverUrl: string) => (serverUrl === "https://github.com" ? "https://api.github.com" : `${serverUrl.replace(/\/+$/, "")}/api/v3`);

/** The comment a vote button posts. Null for a vote against without a reason: nothing is sent. */
export function voteRequest(api: string, repository: string, pr: number | string, vote: string, reason: string): Write | null {
  const why = reason.replace(/\s+/g, " ").trim();
  if (vote !== "for" && vote !== "against") return null;
  if (vote === "against" && !why) return null;
  return { url: `${api}/repos/${repository}/issues/${Number(pr)}/comments`, method: "POST", body: { body: vote === "for" ? "/spectree for" : `/spectree against ${why}` } };
}

/** The thumbs-up on a spec's thread, or on the pull request of a spec that is only proposed. */
export function wantRequest(api: string, repository: string, issue: number | string): Write {
  return { url: `${api}/repos/${repository}/issues/${Number(issue)}/reactions`, method: "POST", body: { content: "+1" } };
}

/** How the visitor voted, from the logins the page lists (comma-separated); "" when they did not. */
export function votedBy(login: string, forList: string, againstList: string): string {
  const me = login.toLowerCase();
  const has = (list: string) => list.toLowerCase().split(",").includes(me);
  return !me ? "" : has(forList) ? "for" : has(againstList) ? "against" : "";
}

/** GitHub's answer to a write, as the page shows it. */
export function outcome(status: number, json: any, login: string): Outcome {
  if (status >= 200 && status < 300) {
    const url = json && typeof json.html_url === "string" && json.html_url.indexOf("https://") === 0 && json.body ? json.html_url : "";
    return { ok: true, text: `Sent as @${login}`, url, note: "The page shows it after its next rebuild.", signOut: false };
  }
  const said = json && typeof json.message === "string" && json.message ? json.message : `GitHub answered ${status}`;
  if (status === 401) return { ok: false, text: "Your sign-in has ended. Sign in again.", url: "", note: "", signOut: true };
  return { ok: false, text: `GitHub refused: ${said}`, url: "", note: "", signOut: false };
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The challenge of a verifier: its SHA-256. The service gets the challenge first and the verifier last. */
export async function challengeOf(verifier: string, subtle: Env["subtle"]): Promise<string> {
  return b64url(new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** An address split into what the service returns to and the anchor, which the tab keeps. */
export function returnAddress(href: string): { address: string; hash: string } {
  const i = href.indexOf("#");
  return i < 0 ? { address: href, hash: "" } : { address: href.slice(0, i), hash: href.slice(i) };
}

export function startUrl(signIn: string, address: string, challenge: string): string {
  return `${signIn}/start?return=${encodeURIComponent(address)}&challenge=${challenge}`;
}

/** The ticket in an address's fragment; null when the fragment is something else. "" is a sign-in that was cancelled. */
export function ticketOf(hash: string): string | null {
  const key = "#spectree-ticket=";
  return hash.indexOf(key) === 0 ? hash.slice(key.length) : null;
}

/** Who is signed in, and the three things the page does with it. The token lives in `storage` and nowhere else. */
export function session(env: Env) {
  const TOKEN = "spectree-token";
  const PENDING = "spectree-sign-in";
  const read = (key: string): any => {
    try {
      return JSON.parse(env.storage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  };
  const signOut = () => env.storage.removeItem(TOKEN);
  const who = (): Signed | null => {
    const t = read(TOKEN);
    if (!t || typeof t.token !== "string" || typeof t.login !== "string") return null;
    if (t.expires_at && t.expires_at <= env.now()) {
      signOut();
      return null;
    }
    return t;
  };
  const headers = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" });

  /** Where to send a visitor who is not signed in. The verifier and the anchor stay in this tab. */
  async function begin(href: string): Promise<string> {
    const verifier = b64url(env.random(32));
    const at = returnAddress(href);
    env.storage.setItem(PENDING, JSON.stringify({ verifier, hash: at.hash }));
    return startUrl(env.signIn, at.address, await challengeOf(verifier, env.subtle));
  }

  /** On arrival: null when the address holds no ticket; otherwise the anchor to put back, and what went wrong. */
  async function finish(hash: string): Promise<{ hash: string; error: string } | null> {
    const ticket = ticketOf(hash);
    if (ticket === null) return null;
    const pending = read(PENDING);
    env.storage.removeItem(PENDING);
    const back = pending && typeof pending.hash === "string" ? pending.hash : "";
    if (!ticket) return { hash: back, error: "" };
    if (!pending || typeof pending.verifier !== "string") return { hash: back, error: "This sign-in was not started in this tab. Sign in again." };
    try {
      const res = await env.fetch(`${env.signIn}/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket, verifier: pending.verifier }) });
      const got = await res.json().catch(() => null);
      if (res.status !== 200 || !got || typeof got.token !== "string") return { hash: back, error: `Sign-in failed: ${(got && got.error) || `the service answered ${res.status}`}` };
      const user = await env.fetch(`${env.api}/user`, { method: "GET", headers: headers(got.token) });
      const me = await user.json().catch(() => null);
      if (user.status !== 200 || !me || typeof me.login !== "string") return { hash: back, error: "Sign-in failed: GitHub did not say who you are." };
      env.storage.setItem(TOKEN, JSON.stringify({ token: got.token, expires_at: Number(got.expires_at) || 0, login: me.login }));
      return { hash: back, error: "" };
    } catch {
      return { hash: back, error: "Sign-in failed: the sign-in service could not be reached." };
    }
  }

  /** One write, as the visitor. Null when nobody is signed in: nothing is sent. */
  async function send(write: Write): Promise<Outcome | null> {
    const t = who();
    if (!t) return null;
    try {
      const res = await env.fetch(write.url, { method: write.method, headers: headers(t.token), body: JSON.stringify(write.body) });
      const r = outcome(res.status, await res.json().catch(() => null), t.login);
      if (r.signOut) signOut();
      return r;
    } catch {
      return { ok: false, text: "GitHub could not be reached. Try again.", url: "", note: "", signOut: false };
    }
  }

  return { who, signOut, begin, finish, send };
}

/** The page's script: the functions above, and the lines that connect them to the buttons. */
export function actScript(signIn: string, repository: string, api = "https://api.github.com"): string {
  const json = JSON.stringify({ signIn, repository, api }).replace(/</g, "\\u003c");
  const fns = [voteRequest, wantRequest, votedBy, outcome, b64url, challengeOf, returnAddress, startUrl, ticketOf, session];
  return `${fns.map((f) => f.toString()).join("\n")}
(function (session, voteRequest, wantRequest, votedBy) {
  var me = document.getElementById("me");
  if (!me || !window.crypto || !crypto.subtle) return;
  var C = ${json};
  var s = session({
    signIn: C.signIn, api: C.api, storage: sessionStorage, subtle: crypto.subtle,
    fetch: function (url, init) { return fetch(url, init); },
    random: function (n) { return crypto.getRandomValues(new Uint8Array(n)); },
    now: function () { return Date.now(); }
  });
  var problem = "";
  function el(tag, text, attrs) {
    var e = document.createElement(tag);
    e.textContent = text;
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    return e;
  }
  function paint() {
    var t = s.who();
    me.textContent = "";
    if (t) me.append("@" + t.login + " · ", el("button", "Sign out", { type: "button", "data-act": "sign-out" }));
    else me.append(el("button", "Sign in with GitHub", { type: "button", "data-act": "sign-in" }));
    if (problem) me.append(" ", el("span", problem, { class: "muted", role: "alert" }));
    me.hidden = false;
    [].forEach.call(document.querySelectorAll(".acts"), function (box) {
      box.hidden = false;
      var mine = box.querySelector(".mine");
      if (!mine) return;
      var v = t ? votedBy(t.login, box.dataset.for || "", box.dataset.against || "") : "";
      mine.textContent = v ? "You voted " + v : "";
    });
  }
  function go() {
    s.begin(location.href).then(function (url) { location.assign(url); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("button[data-act]") : null;
    if (!b) return;
    var act = b.dataset.act, box = b.closest(".acts");
    if (act === "sign-out") { s.signOut(); problem = ""; return paint(); }
    if (act === "sign-in" || !s.who()) return go();
    var write;
    if (act === "want") write = wantRequest(C.api, C.repository, box.dataset.issue);
    else {
      var reason = act === "against" ? prompt("Why are you against it? The reason is posted with your vote.") || "" : "";
      write = voteRequest(C.api, C.repository, box.dataset.pr, act, reason);
    }
    if (!write) return;
    var said = box.querySelector(".said");
    var buttons = [].slice.call(box.querySelectorAll("button"));
    buttons.forEach(function (x) { x.disabled = true; });
    s.send(write).then(function (r) {
      buttons.forEach(function (x) { x.disabled = false; });
      if (!r) return go();
      said.textContent = "";
      if (!r.ok) {
        said.textContent = r.text;
        if (r.signOut) paint();
        return;
      }
      buttons.forEach(function (x) { x.remove(); });
      var mine = box.querySelector(".mine");
      if (mine) mine.textContent = "";
      said.append(r.url ? el("a", r.text, { href: r.url }) : r.text, " " + r.note);
    });
  });
  s.finish(location.hash).then(function (r) {
    if (r) {
      problem = r.error;
      history.replaceState(null, "", location.pathname + location.search + r.hash);
      if (r.hash) window.dispatchEvent(new Event("hashchange"));
    }
    paint();
  });
})(${session.name}, ${voteRequest.name}, ${wantRequest.name}, ${votedBy.name});`;
}
