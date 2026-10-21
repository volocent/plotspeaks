// The account connector's own host (account.plotspeaks.com; account-dev.plotspeaks.com on dev).
// @cloudflare/workers-oauth-provider serves the OAuth protocol there (discovery, /token, /register)
// and protects /mcp; this file is its "default handler": the /authorize page, Google sign-in on this
// host, a consent page naming the app that asks, and a short page for anyone who opens the address.
// plotspeaks.com/mcp is untouched: it has no sign-in, and no OAuth metadata is served on that host.
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { currentUser, finishSignIn, startSignIn, signInConfigured, type AuthEnv } from "./auth";

export type AccountEnv = AuthEnv & { OAUTH_PROVIDER?: OAuthHelpers };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = (title: string, body: string, headers?: Headers) => {
  const h = new Headers(headers);
  h.set("content-type", "text/html; charset=utf-8");
  h.set("cache-control", "no-store");
  h.set("x-robots-tag", "noindex");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Plot Speaks</title>
<style>:root{color-scheme:light dark;--bg:#FBF7F0;--ink:#12355B;--muted:#4b5d73;--accent:#EF7726;--card:#fff}@media (prefers-color-scheme:dark){:root{--bg:#0E1A2B;--ink:#F3EEE6;--muted:#a9b6c6;--card:#15253B}}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 system-ui,sans-serif}main{max-width:32rem;margin:0 auto;padding:48px 20px}h1{font-family:Georgia,serif;font-size:1.7rem;line-height:1.2}
.card{background:var(--card);border-radius:18px;padding:22px;box-shadow:0 10px 30px -18px rgba(0,0,0,.4)}.muted{color:var(--muted);font-size:.95rem}
button,.btn{display:inline-block;border:0;border-radius:999px;padding:13px 22px;font:700 1rem system-ui,sans-serif;background:var(--accent);color:#fff;text-decoration:none;cursor:pointer}.ghost{background:transparent;color:var(--ink);border:1.5px solid currentColor}
form{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}</style></head><body><main>${body}</main></body></html>`, { headers: h });
};

const CONSENT_SESSION_SECONDS = 15 * 60;
const startAgain = (why?: string) => html("Couldn't connect", `<h1>That connection didn't finish.</h1><p>Start again from your assistant: remove the Plot Speaks connector there, add it again, and sign in.</p>${why ? `<p class="muted">${esc(why.slice(0, 200))}</p>` : ""}`);

export async function accountSite(request: Request, env: AccountEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/auth/google/start") return startSignIn(request, env);
  // On this host the sign-in only has to last until the consent page is answered.
  if (url.pathname === "/auth/google/callback") return finishSignIn(request, env, CONSENT_SESSION_SECONDS);
  const oauth = env.OAUTH_PROVIDER;
  if (url.pathname === "/authorize" && oauth) {
    if (!signInConfigured(env)) return html("Not available yet", `<h1>Sign-in isn't switched on yet.</h1><p>Use <strong>https://plotspeaks.com/mcp</strong> for now: it needs no sign-in.</p>`);
    let authReq;
    try { authReq = await oauth.parseAuthRequest(request); } catch (e) {
      return html("Couldn't connect", `<h1>That connection request didn't work.</h1><p class="muted">${esc(String((e as Error).message ?? e).slice(0, 200))}</p>`);
    }
    const user = await currentUser(request, env);
    if (!user) {
      // Sign in with Google on this host first, then come straight back to this same request.
      return Response.redirect(`${url.origin}/auth/google/start?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    }
    if (request.method === "GET") {
      try {
        const facts = await oauth.describeConsent(authReq);
        const t = await oauth.beginConsent(authReq);
        // The app's name is whatever it registered as; where the tokens go is the part to trust, so
        // it is shown plainly, with a warning for a local (loopback) address.
        const where = facts.clientDomain ? `${esc(facts.redirectHost)} (registered by ${esc(facts.clientDomain)})` : esc(facts.redirectHost || facts.redirectUri);
        const loop = facts.redirectIsLoopback ? `<p class="muted"><strong>This sends the sign-in to a program on this computer.</strong> Only allow it if you just started connecting an app here yourself.</p>` : "";
        return html("Connect your account", `<div class="card"><h1>Let ${esc(facts.clientName)} use your Plot Speaks account?</h1>
<p>Signed in as <strong>${esc(user.name || user.email || "you")}</strong>. ${esc(facts.clientName)} will be able to start stories and games for you and read what you've played, so it can suggest something new and remember your trivia and campaigns.</p>
<p class="muted">The connection goes to <strong>${where}</strong>. If you didn't just ask your assistant to connect Plot Speaks, press Cancel. You can disconnect it any time in that app, or delete your Plot Speaks account at plotspeaks.com/account.</p>${loop}
<form method="post"><input type="hidden" name="handle" value="${esc(t.handle)}"><button name="decision" value="allow">Allow</button><button class="ghost" name="decision" value="deny">Cancel</button></form></div>`, t.headers);
      } catch (e) { return startAgain(String((e as Error).message ?? e)); }
    }
    // A double click, the Back button, or a page left open too long all reuse a handle the library
    // has already spent: that is a "start again", never a 500.
    try {
      const form = await request.formData();
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "allow") {
        const denied = await oauth.denyConsent(request, handle);
        const h = new Headers(denied.headers); h.set("location", denied.redirectTo);
        return new Response(null, { status: 302, headers: h });
      }
      const approved = await oauth.approveConsent(request, handle);
      const done = await oauth.completeAuthorization({ request: approved.request, userId: user.id, metadata: { label: user.email ?? user.id }, scope: approved.request.scope, props: { userId: user.id } });
      const h = new Headers(approved.headers); h.set("location", done.redirectTo);
      return new Response(null, { status: 302, headers: h });
    } catch (e) { return startAgain(String((e as Error).message ?? e)); }
  }
  return html("Plot Speaks with your account", `<h1>This is the Plot Speaks connector with your account.</h1>
<p>Add <strong>${esc(url.origin)}/mcp</strong> as a connector in your assistant, and sign in with Google when it asks. Plot Speaks then remembers what you've played.</p>
<p class="muted">Don't want an account? Use https://plotspeaks.com/mcp: it needs no sign-in. More at <a href="https://plotspeaks.com/connect">plotspeaks.com/connect</a>.</p>`);
}
