import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type Env, actScript, apiOf, challengeOf, outcome, returnAddress, session, startUrl, ticketOf, votedBy, voteRequest, wantRequest } from "../src/act.ts";
import { type Config, DEFAULTS, loadConfig } from "../src/config.ts";
import { type PrSummary, buildData, renderHtml } from "../src/dashboard.ts";
import { type PrInput, evaluatePr } from "../src/evaluate.ts";
import { type Spec, parseSpec } from "../src/tree.ts";

type Handle = (request: Request, env: Record<string, string | undefined>, fetch: (url: string, init?: any) => Promise<Response>, now?: () => number) => Promise<Response>;
const WORKER = "../login/worker.js";
const { handle } = (await import(WORKER)) as { handle: Handle };
const WORKER_SOURCE = readFileSync(new URL(WORKER, import.meta.url), "utf8");

// The page

const SIGN_IN = "https://login.acme.dev";
const PAGE = "https://acme.github.io/engine/";
const API = "https://api.github.com";
const REPO = "acme/engine";
const NOW = "2026-11-30T12:00:00.000Z";
const ON: Config = { ...DEFAULTS, dashboard: { ...DEFAULTS.dashboard, sign_in: SIGN_IN } };

const group = (title: string) => `---\ntitle: ${title}\nkind: group\n---\nAbout ${title}.\n`;
const leaf = (title: string) => `---\ntitle: ${title}\npaths: [src/**, tests/**]\ncriteria:\n  - id: works\n    text: It works.\n    tests: [tests/test_new.py]\n---\nWhy ${title}.\n`;
const MAIN: Record<string, Spec> = {};
for (const [id, text] of Object.entries({ search: group("Search"), "search/full": leaf("Full index"), "search/short": leaf("Short") })) MAIN[id] = parseSpec(id, text).spec!;

function input(n: number, id: string, over: Partial<PrInput> = {}): PrInput {
  const path = `roadmap/search/${id}/spec.md`;
  return {
    number: n, author: "outsider", headSha: `h${n}`, body: "", labels: [], files: [{ path, status: "added", sha: `s${n}` }],
    reviews: [], specUnchangedSince: {}, weights: { outsider: 0, maint: 1, fan: 0 }, authorCanWrite: false,
    specContents: { [path]: leaf(id) }, baseSpecs: MAIN, baseFiles: new Set(["src/main.py"]),
    record: null, implementsRecord: null, now: NOW, ...over,
  };
}
const summary = (i: PrInput): PrSummary => ({ number: i.number, title: `PR ${i.number}`, author: i.author, url: `https://github.com/${REPO}/pull/${i.number}`, opened: NOW, result: evaluatePr(i, DEFAULTS) });
const approve = (commit: string, user = "maint") => ({ user, state: "APPROVED", commit, at: NOW });
const CODE = [{ path: "src/new.py", status: "added", sha: "c1" }, { path: "tests/test_new.py", status: "added", sha: "c2" }];
/** One proposal in each step. */
function proposals(): PrSummary[] {
  const votes = input(7, "voting", { reviews: [approve("h7", "fan"), { user: "critic", state: "CHANGES_REQUESTED", commit: "h7", at: NOW }], weights: { outsider: 0, maint: 1, fan: 0, critic: 0 } });
  const fix = input(8, "broken");
  fix.specContents = { "roadmap/search/broken/spec.md": "---\nkind: leaf\n---\n" };
  const code = input(9, "approved", { reviews: [approve("h9")] });
  const record = evaluatePr(input(10, "coding", { reviews: [approve("h10")] }), DEFAULTS).record!;
  const coding = (n: number, id: string, reviews: PrInput["reviews"]) => {
    const base = input(n, id);
    const rec = evaluatePr({ ...base, reviews: [approve(`h${n}`)] }, DEFAULTS).record!;
    return { ...base, headSha: `head${n}`, record: rec, files: [...base.files, ...CODE], reviews };
  };
  assert.notEqual(record, null);
  return [votes, fix, code, coding(10, "coding", []), coding(11, "ready", [approve("head11")])].map(summary);
}
const DATA = buildData(MAIN, proposals(), DEFAULTS, REPO, NOW, { branch: "main", threads: { "search/full": { number: 31, url: `https://github.com/${REPO}/issues/31`, up: 2, down: 0 } } });
const page = (cfg: Config = ON, server?: string) => renderHtml(DATA, cfg, server);
const step = (html: string, name: string) => new RegExp(`<tbody data-step="${name}">(.*?)</tbody>`, "s").exec(html)?.[1] ?? "";
const node = (html: string, id: string) => new RegExp(`<li class="node" id="spec-${id}".*?<p class="actions">(.*?)</p>`, "s").exec(html)![1];

// A browser tab and the sign-in service, for the tests

const ENV = { GITHUB_CLIENT_ID: "Iv1.client", GITHUB_CLIENT_SECRET: "app-secret", SIGNING_SECRET: "a signing secret of some length", ALLOWED_PAGES: `${PAGE} https://roadmap.acme.dev/` };
const TOKEN = "ghu_TheVisitorsToken";
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}
function world(o: { expires_in?: number; status?: number; answer?: unknown } = {}) {
  let clock = Date.parse(NOW);
  const now = () => clock;
  const github: Call[] = [];
  const api: Call[] = [];
  const service: Call[] = [];
  /** GitHub's token route, as the service sees it. */
  const fakeGitHub = async (url: string, init: any = {}) => {
    github.push({ url, method: init.method, headers: init.headers, body: String(init.body ?? "") });
    return Response.json(new URLSearchParams(init.body).get("code") === "good" ? { access_token: TOKEN, expires_in: o.expires_in ?? 28800, refresh_token: "ghr_never_passed_on", token_type: "bearer" } : { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." });
  };
  const serve = (request: Request) => handle(request, ENV, fakeGitHub, now);
  const store = new Map<string, string>();
  const env: Env = {
    signIn: SIGN_IN, api: API, subtle: webcrypto.subtle, now,
    random: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    fetch: async (url, init) => {
      const call = { url, method: init.method, headers: init.headers, body: init.body ?? "" };
      if (url.startsWith(SIGN_IN)) {
        service.push(call);
        return serve(new Request(url, { method: init.method, headers: { ...init.headers, Origin: new URL(PAGE).origin }, body: init.body }));
      }
      api.push(call);
      if (url === `${API}/user`) return Response.json({ login: "Ann" });
      return Response.json(o.answer ?? { html_url: `https://github.com/${REPO}/pull/7#issuecomment-1`, body: "/spectree for" }, { status: o.status ?? 201 });
    },
  };
  /** Follows a sign-in from the page through GitHub and back; returns each address the browser visits. */
  async function signIn(s: ReturnType<typeof session>, href: string, code = "good") {
    const start = await s.begin(href);
    const toGitHub = await serve(new Request(start));
    const authorize = new URL(toGitHub.headers.get("Location")!);
    const callback = `${SIGN_IN}/callback?code=${code}&state=${authorize.searchParams.get("state")}`;
    const back = await serve(new Request(callback));
    const arrived = back.headers.get("Location") ?? "";
    const done = arrived ? await s.finish(arrived.slice(arrived.indexOf("#"))) : null;
    return { start, authorize, callback, back, arrived, done };
  }
  return { env, store, github, api, service, serve, signIn, now, tick: (ms: number) => void (clock += ms) };
}
const get = (w: ReturnType<typeof world>, path: string, headers: Record<string, string> = {}) => w.serve(new Request(SIGN_IN + path, { headers }));
const exchange = (w: ReturnType<typeof world>, body: unknown, origin: string | null = new URL(PAGE).origin) =>
  w.serve(new Request(`${SIGN_IN}/token`, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) }));
const CHALLENGE = await challengeOf("a verifier", webcrypto.subtle);
/** A ticket for the verifier "a verifier", straight from the service. */
async function ticketFor(w: ReturnType<typeof world>, back = PAGE) {
  const to = await get(w, `/start?return=${encodeURIComponent(back)}&challenge=${CHALLENGE}`);
  const state = new URL(to.headers.get("Location")!).searchParams.get("state")!;
  const res = await get(w, `/callback?code=good&state=${state}`);
  return { state, ticket: (res.headers.get("Location") ?? "").split("#spectree-ticket=")[1] };
}

test("setting: dashboard.sign_in is an https URL, empty by default; without it the page has no buttons, no sign-in and no script for them", () => {
  assert.equal(DEFAULTS.dashboard.sign_in, "");
  assert.deepEqual(loadConfig("dashboard: {sign_in: 'https://login.acme.dev/'}"), { config: ON, errors: [] }, "the slash at the end is dropped");
  assert.equal(loadConfig("dashboard: {sign_in: 'https://acme.dev/login'}").config.dashboard.sign_in, "https://acme.dev/login");
  for (const bad of ["http://login.acme.dev", "login.acme.dev", "javascript:alert(1)", "https://user:pw@acme.dev", "https://acme.dev/?x=1", "7", "true"]) {
    const { config, errors } = loadConfig(`dashboard: {sign_in: '${bad}'}`.replace(/'(7|true)'/, "$1"));
    assert.deepEqual([config.dashboard.sign_in, errors], ["", ["dashboard.sign_in must be an https URL, the address of the sign-in service"]], bad);
  }
  assert.deepEqual(loadConfig("dashboard: {sign_in: ''}"), { config: DEFAULTS, errors: [] });

  const off = page(DEFAULTS);
  for (const part of ["Content-Security-Policy", "data-act", 'class="acts"', 'id="me"', "Sign in", "Want this", "spectree-ticket", "sessionStorage", "function session"])
    assert.ok(!off.includes(part), `no ${part} in the page without the setting`);
  assert.match(off, /Discuss or 👍<\/a>/, "the links are today's");
  // Everything the setting adds is in these parts; without them the page with the setting is the page without it.
  const on = page();
  const script = /<script>(.*)<\/script>/s.exec(on)![1];
  const offScript = /<script>(.*)<\/script>/s.exec(off)![1];
  assert.ok(script.startsWith(offScript), "the script of the page is today's, with the buttons' script after it");
  assert.equal(script.slice(offScript.length), actScript(SIGN_IN, REPO, API) + "\n");
});

test("buttons: For and Against on a proposal that waits for votes, Want this on a spec with a thread or a pull request, and none elsewhere", () => {
  const html = page();
  const votes = step(html, "votes");
  assert.match(votes, /<div class="acts" data-pr="7"[^>]*hidden><button type="button" data-act="for">For<\/button> <button type="button" data-act="against">Against<\/button>/);
  for (const other of ["fix", "code", "review", "merge"]) {
    assert.notEqual(step(html, other), "", `there is a proposal under ${other}`);
    assert.ok(!step(html, other).includes("<button"), `no button under ${other}`);
  }
  assert.match(step(html, "review"), /Review the code<\/a>/, "the code review keeps its link to the files");

  assert.match(node(html, "search/full"), /<span class="acts" data-issue="31" hidden><button type="button" data-act="want">👍 Want this<\/button>/, "a spec with a thread: the thread");
  assert.match(node(html, "search/voting"), /<span class="acts" data-issue="7" hidden><button type="button" data-act="want">👍 Want this<\/button>/, "a spec that is only proposed: its pull request");
  assert.match(node(html, "search/short"), /Start its thread<\/a>/);
  assert.ok(!node(html, "search/short").includes("<button"), "neither a thread nor a pull request: no button");
  assert.ok(!node(html, "search").includes("<button"));
  assert.deepEqual([...new Set([...html.matchAll(/<button type="button" data-act="([^"]*)"/g)].map((m) => m[1]))].sort(), ["against", "for", "want"]);
  assert.equal([...html.matchAll(/data-act="(for|against)"/g)].length, 2, "one pair, on the one proposal that waits for votes");
  assert.ok(!renderHtml(DATA, { ...ON, demand: { ...ON.demand, enabled: false } }).includes("Want this"), "no thumbs-up where the project does not count them");
});

test("writes: each button is one request to the GitHub API with the visitor's own token", async () => {
  assert.deepEqual(voteRequest(API, REPO, "7", "for", ""), { url: `${API}/repos/acme/engine/issues/7/comments`, method: "POST", body: { body: "/spectree for" } });
  assert.deepEqual(voteRequest(API, REPO, 7, "against", "  too wide\n in scope "), { url: `${API}/repos/acme/engine/issues/7/comments`, method: "POST", body: { body: "/spectree against too wide in scope" } });
  assert.equal(voteRequest(API, REPO, 7, "against", "   "), null, "against without a reason sends nothing");
  assert.equal(voteRequest(API, REPO, 7, "approve", ""), null);
  assert.deepEqual(wantRequest(API, REPO, "31"), { url: `${API}/repos/acme/engine/issues/31/reactions`, method: "POST", body: { content: "+1" } });
  assert.equal(apiOf("https://github.com"), API);
  assert.equal(apiOf("https://git.acme.dev/"), "https://git.acme.dev/api/v3");

  const w = world();
  const s = session(w.env);
  await w.signIn(s, PAGE);
  w.api.length = 0;
  await s.send(voteRequest(API, REPO, 7, "for", "")!);
  assert.equal(w.api.length, 1, "one request");
  assert.deepEqual([w.api[0].url, w.api[0].method, w.api[0].body], [`${API}/repos/acme/engine/issues/7/comments`, "POST", '{"body":"/spectree for"}']);
  assert.equal(w.api[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(w.service.length, 1, "the sign-in service saw the sign-in and no vote");
});

test("signed-out: a press sends the visitor to the sign-in service and back to the same address, and sends nothing for them", async () => {
  const w = world();
  const s = session(w.env);
  assert.equal(s.who(), null);
  assert.equal(await s.send(wantRequest(API, REPO, 31)), null, "nothing is sent while signed out");
  assert.deepEqual([w.api, w.service], [[], []]);

  const href = `${PAGE}?q=index&status=planned#spec-search/full`;
  assert.deepEqual(returnAddress(href), { address: `${PAGE}?q=index&status=planned`, hash: "#spec-search/full" });
  assert.deepEqual(returnAddress(PAGE), { address: PAGE, hash: "" });
  const flow = await w.signIn(s, href);
  const start = new URL(flow.start);
  assert.equal(start.origin + start.pathname, `${SIGN_IN}/start`);
  assert.equal(start.searchParams.get("return"), `${PAGE}?q=index&status=planned`, "filters included");
  assert.equal(flow.start, startUrl(SIGN_IN, `${PAGE}?q=index&status=planned`, start.searchParams.get("challenge")!));
  assert.ok(flow.arrived.startsWith(`${PAGE}?q=index&status=planned#spectree-ticket=`));
  assert.deepEqual(flow.done, { hash: "#spec-search/full", error: "" }, "the anchor comes back from the tab");
  assert.equal(s.who()?.login, "Ann");
  assert.deepEqual(w.api.map((c) => `${c.method} ${c.url}`), [`GET ${API}/user`], "signing in writes nothing");
  assert.match(actScript(SIGN_IN, REPO), /if \(act === "sign-in" \|\| !s\.who\(\)\) return go\(\);/, "the page's click handler leaves before it builds a request");
});

test("who: the visitor's login, Sign out, and how they voted, from the votes the page lists", async () => {
  const w = world();
  const s = session(w.env);
  await w.signIn(s, PAGE);
  assert.deepEqual(s.who(), { token: TOKEN, expires_at: w.now() + 28800_000, login: "Ann" });

  const box = /<div class="acts" data-pr="7" data-for="([^"]*)" data-against="([^"]*)"/.exec(page())!;
  assert.deepEqual([box[1], box[2]], ["fan,outsider", "critic"], "the voters the page lists; the author counts for their own spec");
  assert.equal(votedBy("Fan", box[1], box[2]), "for");
  assert.equal(votedBy("critic", box[1], box[2]), "against");
  assert.equal(votedBy("ann", box[1], box[2]), "");
  assert.equal(votedBy("fa", "fan,fanny", ""), "", "a whole login, not a part of one");
  assert.equal(votedBy("", "", ""), "");
  const script = actScript(SIGN_IN, REPO);
  for (const part of ['"Sign in with GitHub"', '"Sign out"', '"You voted " + v', '"@" + t.login']) assert.ok(script.includes(part), part);
});

test("feedback: Sent as @login with a link to the comment; a refusal shows GitHub's message and keeps the button", async () => {
  const comment = { html_url: `https://github.com/${REPO}/pull/7#issuecomment-1`, body: "/spectree for" };
  assert.deepEqual(outcome(201, comment, "Ann"), { ok: true, text: "Sent as @Ann", url: comment.html_url, note: "The page shows it after its next rebuild.", signOut: false });
  assert.deepEqual(outcome(200, { id: 5, content: "+1" }, "Ann"), { ok: true, text: "Sent as @Ann", url: "", note: "The page shows it after its next rebuild.", signOut: false }, "a thumbs-up has no address");
  assert.equal(outcome(201, { html_url: "javascript:alert(1)", body: "x" }, "Ann").url, "", "only an https address becomes a link");
  assert.deepEqual(outcome(403, { message: "Resource not accessible by integration" }, "Ann"), { ok: false, text: "GitHub refused: Resource not accessible by integration", url: "", note: "", signOut: false });
  assert.equal(outcome(500, null, "Ann").text, "GitHub refused: GitHub answered 500");

  const w = world({ status: 403, answer: { message: "Resource not accessible by integration" } });
  const s = session(w.env);
  await w.signIn(s, PAGE);
  const r = await s.send(voteRequest(API, REPO, 7, "for", "")!);
  assert.deepEqual([r!.ok, r!.text], [false, "GitHub refused: Resource not accessible by integration"]);
  assert.equal(s.who()?.login, "Ann", "still signed in");
  const sent = await session(world().env).send(wantRequest(API, REPO, 31));
  assert.equal(sent, null);
  const script = actScript(SIGN_IN, REPO);
  // In the page: a refusal writes the message and returns before the buttons are removed.
  assert.ok(script.indexOf("said.textContent = r.text;") < script.indexOf("x.remove()"), "the buttons stay on a refusal");
  assert.match(script, /el\("a", r\.text, \{ href: r\.url \}\)/);
  assert.ok(!script.includes("innerHTML"), "what GitHub answers is written as text");
});

test("token-handling: the token is in sessionStorage only, never in an address, and gone on Sign out and on 401", async () => {
  const w = world();
  const s = session(w.env);
  const flow = await w.signIn(s, `${PAGE}#spec-search`);
  assert.deepEqual([...w.store.keys()], ["spectree-token"], "one entry; the verifier is gone once it is used");
  for (const address of [flow.start, flow.authorize.href, flow.callback, flow.arrived]) assert.ok(!address.includes(TOKEN), address);
  assert.ok(![...w.service, ...w.api].some((c) => c.url.includes(TOKEN)), "not in the address of any request");
  s.signOut();
  assert.deepEqual([[...w.store.keys()], s.who()], [[], null]);

  const refused = world({ status: 401, answer: { message: "Bad credentials" } });
  const s2 = session(refused.env);
  await refused.signIn(s2, PAGE);
  const r = await s2.send(wantRequest(API, REPO, 31));
  assert.deepEqual([r!.ok, r!.signOut, r!.text], [false, true, "Your sign-in has ended. Sign in again."]);
  assert.deepEqual([[...refused.store.keys()], s2.who()], [[], null], "401 removes it");

  const late = world({ expires_in: 60 });
  const s3 = session(late.env);
  await late.signIn(s3, PAGE);
  late.tick(61_000);
  assert.deepEqual([s3.who(), [...late.store.keys()]], [null, []], "a token past its time is removed");

  const script = actScript(SIGN_IN, REPO);
  assert.match(script, /storage: sessionStorage/);
  for (const other of ["localStorage", "document.cookie", "indexedDB"]) assert.ok(!script.includes(other), other);
  assert.equal(ticketOf("#spectree-ticket=abc"), "abc");
  assert.equal(ticketOf("#spec-search"), null);
  assert.match(script, /history\.replaceState\(null, "", location\.pathname \+ location\.search \+ r\.hash\)/, "the ticket leaves the address as soon as it is read");
});

test("csp: the page's one inline script by hash, connections to the GitHub API and the sign-in service only", () => {
  const html = page();
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)![1];
  const scripts = [...html.matchAll(/<script[^>]*>(.*?)<\/script>/gs)];
  assert.equal(scripts.length, 1, "one script");
  assert.equal(scripts[0][0].slice(0, 8), "<script>", "inline, with no src");
  const rules = Object.fromEntries(csp.split("; ").map((r) => [r.slice(0, r.indexOf(" ")), r.slice(r.indexOf(" ") + 1)]));
  assert.deepEqual(rules, {
    "default-src": "'none'",
    "script-src": `'sha256-${createHash("sha256").update(scripts[0][1]).digest("base64")}'`,
    "style-src": "'unsafe-inline'",
    "img-src": "'self' data:",
    "connect-src": "https://api.github.com https://login.acme.dev",
    "form-action": "'none'",
    "base-uri": "'none'",
  });
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script>"), "the policy comes before the script");
  assert.ok(!/<[^>]+\son[a-z]+\s*=/i.test(html.replace(scripts[0][0], "")), "no handler in an attribute");
  assert.ok(!/\beval\(|new Function\(/.test(scripts[0][1]));
  const own = /content="([^"]*)"/.exec(page({ ...ON, dashboard: { ...ON.dashboard, sign_in: "https://acme.dev/login" } }, "https://git.acme.dev"))![1];
  assert.match(own, /connect-src https:\/\/git\.acme\.dev https:\/\/acme\.dev;/, "a GitHub server of one's own, and the service's origin");
  // A page with no specs yet still has the policy and the script.
  const empty = renderHtml(buildData({}, [], DEFAULTS, REPO, NOW), ON);
  const only = /<script>(.*)<\/script>/s.exec(empty)![1];
  assert.ok(empty.includes(`'sha256-${createHash("sha256").update(only).digest("base64")}'`));
});

test("service-flow: /start redirects to GitHub with a signed state, /callback returns a ticket, /token returns the token for the verifier", async () => {
  const w = world();
  const to = await get(w, `/start?return=${encodeURIComponent(PAGE + "?q=a")}&challenge=${CHALLENGE}`);
  assert.equal(to.status, 302);
  const authorize = new URL(to.headers.get("Location")!);
  assert.equal(authorize.origin + authorize.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(authorize.searchParams.get("client_id"), "Iv1.client");
  const state = authorize.searchParams.get("state")!;
  const [payload, mac] = state.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { r: PAGE + "?q=a", c: CHALLENGE, t: w.now() }, "the return address, the challenge and the time");
  assert.equal(Buffer.from(mac, "base64url").length, 32, "an HMAC-SHA-256");

  const back = await get(w, `/callback?code=good&state=${state}`);
  assert.equal(back.status, 302);
  assert.equal(w.github.length, 1);
  assert.deepEqual([w.github[0].url, w.github[0].method], ["https://github.com/login/oauth/access_token", "POST"]);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(w.github[0].body)), { client_id: "Iv1.client", client_secret: "app-secret", code: "good" });
  const [address, ticket] = back.headers.get("Location")!.split("#spectree-ticket=");
  assert.equal(address, PAGE + "?q=a");
  assert.ok(ticket.length > 40 && !ticket.includes(TOKEN) && !Buffer.from(ticket, "base64url").toString("latin1").includes(TOKEN), "the token is encrypted in the ticket");
  const again = await get(w, `/callback?code=good&state=${state}`);
  assert.notEqual(again.headers.get("Location"), back.headers.get("Location"), "a ticket is never the same twice");

  const res = await exchange(w, { ticket, verifier: "a verifier" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://acme.github.io");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await res.json(), { token: TOKEN, expires_at: w.now() + 28800_000 });

  const no = await get(w, `/callback?state=${state}&error=access_denied`);
  assert.equal(no.headers.get("Location"), `${PAGE}?q=a#spectree-ticket=`, "a visitor who said no comes back signed out");
  const failed = await get(w, `/callback?code=stale&state=${state}`);
  assert.equal(failed.status, 502);
  assert.match(await failed.text(), /GitHub did not give a token: The code passed is incorrect or expired\./);
  assert.equal((await get(w, "/")).status, 404);
  assert.match(await (await handle(new Request(`${SIGN_IN}/start`), { ...ENV, SIGNING_SECRET: "" }, async () => Response.json({}))).text(), /not set up: SIGNING_SECRET is missing/);
});

test("service-refuses: other pages, forged or old states, old tickets, wrong verifiers and other origins; nothing stored, nothing logged", async () => {
  const logged: unknown[][] = [];
  const real = { ...console };
  for (const k of ["log", "info", "warn", "error", "debug"] as const) console[k] = (...a: unknown[]) => void logged.push(a);
  try {
    const w = world();
    const start = (back: string, challenge = CHALLENGE) => get(w, `/start?return=${encodeURIComponent(back)}&challenge=${challenge}`);
    for (const ok of [PAGE, `${PAGE}index.html?q=a`, "https://roadmap.acme.dev/"]) assert.equal((await start(ok)).status, 302, ok);
    for (const bad of ["https://evil.example/engine/", "https://acme.github.io/", "https://acme.github.io/engine-fork/", "https://acme.github.io/engine", "http://acme.github.io/engine/", `${PAGE}#spec-a`, "https://acme.github.io.evil.example/engine/", "https://acme.github.io/engine/../other/", "//acme.github.io/engine/", ""]) {
      const res = await start(bad);
      assert.equal(res.status, 400, bad);
      assert.match(await res.text(), /not on the list of pages/);
    }
    assert.equal((await start(PAGE, "short")).status, 400, "a challenge that is not a SHA-256");

    const { state, ticket } = await ticketFor(w);
    const [payload, mac] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ r: "https://evil.example/", c: CHALLENGE, t: w.now() })).toString("base64url");
    const elsewhere = new URL((await handle(new Request(`${SIGN_IN}/start?return=${encodeURIComponent(PAGE)}&challenge=${CHALLENGE}`), { ...ENV, SIGNING_SECRET: "another secret" }, async () => Response.json({}), w.now)).headers.get("Location")!).searchParams.get("state")!;
    for (const bad of [`${forged}.${mac}`, `${payload}.${mac.slice(0, -2)}AA`, payload, "", "a.b.c", elsewhere]) {
      const res = await get(w, `/callback?code=good&state=${bad}`);
      assert.equal(res.status, 400, bad);
      assert.match(await res.text(), /not made by this service/);
    }
    const calls = w.github.length;
    w.tick(10 * 60_000);
    assert.equal((await get(w, `/callback?code=good&state=${state}`)).status, 302, "ten minutes: still good");
    w.tick(1000);
    const old = await get(w, `/callback?code=good&state=${state}`);
    assert.equal(old.status, 400);
    assert.match(await old.text(), /longer than ten minutes/);
    assert.equal(w.github.length, calls + 1, "GitHub is not asked for a refused state");

    const fresh = (await ticketFor(w)).ticket;
    assert.deepEqual([(await exchange(w, { ticket: fresh, verifier: "another verifier" })).status, await (await exchange(w, { ticket: fresh, verifier: "another verifier" })).json()], [400, { error: "The verifier does not match." }]);
    assert.equal((await exchange(w, { ticket: fresh })).status, 400, "no verifier");
    assert.equal((await exchange(w, { ticket: fresh.slice(0, -4) + "AAAA", verifier: "a verifier" })).status, 400, "a ticket that was changed");
    assert.equal((await exchange(w, { ticket: "not a ticket", verifier: "a verifier" })).status, 400);
    assert.equal((await exchange(w, null)).status, 400);
    w.tick(60_000);
    assert.equal((await exchange(w, { ticket: fresh, verifier: "a verifier" })).status, 200, "one minute: still good");
    w.tick(1000);
    assert.deepEqual(await (await exchange(w, { ticket: fresh, verifier: "a verifier" })).json(), { error: "The ticket is older than one minute." });
    assert.ok(ticket);

    const now = (await ticketFor(w)).ticket;
    for (const origin of ["https://evil.example", "https://acme.github.io.evil.example", "null", null]) {
      const res = await exchange(w, { ticket: now, verifier: "a verifier" }, origin);
      assert.deepEqual([res.status, res.headers.get("Access-Control-Allow-Origin")], [403, null], String(origin));
      assert.ok(!(await res.text()).includes(TOKEN));
    }
    const preflight = (origin: string) => w.serve(new Request(`${SIGN_IN}/token`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } }));
    assert.deepEqual([(await preflight("https://roadmap.acme.dev")).status, (await preflight("https://roadmap.acme.dev")).headers.get("Access-Control-Allow-Origin")], [204, "https://roadmap.acme.dev"]);
    assert.equal((await preflight("https://evil.example")).status, 403);
    assert.equal((await get(w, "/token", { Origin: "https://acme.github.io" })).status, 405);
    for (const res of [await get(w, `/start?return=${encodeURIComponent(PAGE)}&challenge=${CHALLENGE}`), await get(w, `/callback?code=good&state=${(await ticketFor(w)).state}`)])
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), null, "the redirects answer no other origin's script");
  } finally {
    Object.assign(console, real);
  }
  assert.deepEqual(logged, [], "nothing was written to the log");
  assert.ok(!/console\s*\./.test(WORKER_SOURCE), "the file has no call that writes to the log");
  for (const store of [".put(", "caches", "KV", "DurableObject", "D1", "R2", "globalThis."]) assert.ok(!WORKER_SOURCE.includes(store), `the file uses no ${store}`);
  assert.match(readFileSync(new URL("../login/wrangler.toml", import.meta.url), "utf8"), /\[observability\]\nenabled = false/);
  assert.ok(!/kv_namespaces|d1_databases|r2_buckets|durable_objects/.test(readFileSync(new URL("../login/wrangler.toml", import.meta.url), "utf8")), "no storage binding");
});
