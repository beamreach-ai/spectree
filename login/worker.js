// The sign-in service of a spectree roadmap page: a Cloudflare Worker in one file, with no dependencies.
//
// It turns GitHub's sign-in into a user token for the page, and does nothing else. It stores nothing and logs
// nothing: there is no storage binding and no call that writes to the log in this file. Read it before you deploy it.
//
// Settings (see README.md):
//   GITHUB_CLIENT_ID      the GitHub App's client id
//   GITHUB_CLIENT_SECRET  the GitHub App's client secret (a secret)
//   SIGNING_SECRET        32 random bytes or more, in any text form (a secret)
//   ALLOWED_PAGES         the roadmap pages this service serves, separated by spaces or commas
//   GITHUB_URL            optional; a GitHub server of your own. Default https://github.com

const STATE_MS = 10 * 60_000;
const TICKET_MS = 60_000;
const text = new TextEncoder();

const b64url = (bytes) => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const bytesOf = (s) => {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
};

/** Two keys from the one secret: one signs states, the other encrypts tickets. */
async function keyFor(secret, use) {
  const raw = await crypto.subtle.digest("SHA-256", text.encode(`spectree sign-in ${use}:${secret}`));
  return use === "state"
    ? crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
    : crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function signState(secret, payload) {
  const body = b64url(text.encode(JSON.stringify(payload)));
  return `${body}.${b64url(await crypto.subtle.sign("HMAC", await keyFor(secret, "state"), text.encode(body)))}`;
}

/** The payload of a state this service signed; null for anything else. */
async function readState(secret, state) {
  try {
    const [body, mac, more] = String(state).split(".");
    if (!body || !mac || more !== undefined) return null;
    if (!(await crypto.subtle.verify("HMAC", await keyFor(secret, "state"), bytesOf(mac), text.encode(body)))) return null;
    return JSON.parse(new TextDecoder().decode(bytesOf(body)));
  } catch {
    return null;
  }
}

async function seal(secret, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(secret, "ticket"), text.encode(JSON.stringify(payload))));
  const out = new Uint8Array(iv.length + data.length);
  out.set(iv);
  out.set(data, iv.length);
  return b64url(out);
}

/** The payload of a ticket this service made; null for anything else. */
async function open(secret, ticket) {
  try {
    const all = bytesOf(ticket);
    if (all.length < 13) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await keyFor(secret, "ticket"), all.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

/** The allowed pages, as addresses. A page that is not https is not allowed, whatever the setting says. */
function pagesOf(env) {
  const out = [];
  for (const one of String(env.ALLOWED_PAGES ?? "").split(/[\s,]+/)) {
    try {
      const u = new URL(one);
      if (u.protocol === "https:" && !u.username && !u.password) out.push(u);
    } catch {}
  }
  return out;
}

/** Whether an address is one of the allowed pages: the same origin, and the page's path or, for a path that ends in a slash, a path below it. */
function allowed(address, pages) {
  let u;
  try {
    u = new URL(address);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.hash || address.includes("#")) return false;
  return pages.some((p) => p.origin === u.origin && (u.pathname === p.pathname || (p.pathname.endsWith("/") && u.pathname.startsWith(p.pathname))));
}

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const say = (status, message) => new Response(message + "\n", { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
const redirect = (to) => new Response(null, { status: 302, headers: { ...HEADERS, Location: to } });
const json = (status, body, cors) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...cors, "Content-Type": "application/json" } });

/**
 * Answers one request.
 * @param {Request} request
 * @param {Record<string, string | undefined>} env the settings above
 * @param {typeof fetch} fetch how GitHub is reached; the tests pass a fake GitHub
 * @param {() => number} [now]
 * @returns {Promise<Response>}
 */
export async function handle(request, env, fetch, now = Date.now) {
  for (const key of ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SIGNING_SECRET", "ALLOWED_PAGES"])
    if (!env[key]) return say(500, `The sign-in service is not set up: ${key} is missing.`);
  const github = String(env.GITHUB_URL || "https://github.com").replace(/\/+$/, "");
  const pages = pagesOf(env);
  const url = new URL(request.url);
  const route = url.pathname.slice(url.pathname.lastIndexOf("/"));

  if (route === "/start" && request.method === "GET") {
    const back = url.searchParams.get("return") ?? "";
    const challenge = url.searchParams.get("challenge") ?? "";
    if (!allowed(back, pages)) return say(400, "This page is not on the list of pages that may use this sign-in service.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return say(400, "The challenge is not valid. Start again from the roadmap page.");
    const state = await signState(env.SIGNING_SECRET, { r: back, c: challenge, t: now() });
    return redirect(`${github}/login/oauth/authorize?client_id=${encodeURIComponent(env.GITHUB_CLIENT_ID)}&state=${state}`);
  }

  if (route === "/callback" && request.method === "GET") {
    const state = await readState(env.SIGNING_SECRET, url.searchParams.get("state") ?? "");
    if (!state || typeof state.r !== "string" || typeof state.c !== "string" || typeof state.t !== "number") return say(400, "This sign-in link was not made by this service. Start again from the roadmap page.");
    if (now() - state.t > STATE_MS || state.t > now() + 60_000) return say(400, "This sign-in took longer than ten minutes. Start again from the roadmap page.");
    if (!allowed(state.r, pages)) return say(400, "This page is not on the list of pages that may use this sign-in service.");
    const code = url.searchParams.get("code");
    // The visitor said no at GitHub: back to the page, signed out.
    if (!code) return redirect(`${state.r}#spectree-ticket=`);
    const res = await fetch(`${github}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }).toString(),
    });
    const got = await res.json().catch(() => null);
    if (!got || typeof got.access_token !== "string" || !got.access_token)
      return say(502, `GitHub did not give a token: ${(got && (got.error_description || got.error)) || `it answered ${res.status}`}. Start again from the roadmap page.`);
    // Only the access token goes on. A refresh token, if GitHub sent one, is dropped here.
    const expires = Number(got.expires_in) > 0 ? now() + Number(got.expires_in) * 1000 : 0;
    return redirect(`${state.r}#spectree-ticket=${await seal(env.SIGNING_SECRET, { k: got.access_token, e: expires, c: state.c, t: now() })}`);
  }

  if (route === "/token") {
    const origin = request.headers.get("Origin") ?? "";
    if (!origin || !pages.some((p) => p.origin === origin)) return json(403, { error: "This page is not on the list of pages that may use this sign-in service." }, {});
    const cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: { ...HEADERS, ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" } });
    if (request.method !== "POST") return json(405, { error: "POST only." }, cors);
    const body = await request.json().catch(() => null);
    const ticket = body && typeof body.ticket === "string" ? await open(env.SIGNING_SECRET, body.ticket) : null;
    if (!ticket || typeof ticket.k !== "string" || typeof ticket.c !== "string" || typeof ticket.t !== "number") return json(400, { error: "The ticket is not valid." }, cors);
    if (now() - ticket.t > TICKET_MS || ticket.t > now() + 60_000) return json(400, { error: "The ticket is older than one minute." }, cors);
    const verifier = typeof body.verifier === "string" ? body.verifier : "";
    if (b64url(await crypto.subtle.digest("SHA-256", text.encode(verifier))) !== ticket.c) return json(400, { error: "The verifier does not match." }, cors);
    return json(200, { token: ticket.k, expires_at: ticket.e }, cors);
  }

  return say(404, "spectree sign-in service. Routes: /start, /callback, /token.");
}

export default {
  fetch: (request, env) => handle(request, env, (input, init) => fetch(input, init)),
};
