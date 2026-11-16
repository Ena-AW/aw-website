// Copies Atleable's jobs into the website (website.sync_atleable_jobs) and,
// when something changed, starts the "Deploy to GitHub Pages" workflow.
//
// Who can call it:
//   * GitHub Actions every 15 minutes and Atleable itself (after a job is saved),
//     with the header  x-sync-key: <ATLEABLE_SYNC_KEY>
//   * the admin panel's "Sync from Atleable" button (a signed-in team member).
//
// POST https://<project>.supabase.co/functions/v1/atleable-sync
// Body (optional): { "rebuild": "auto" | "always" | "never" }   default "auto"
// Reply: { "added": 2, "updated": 1, "closed": 0, "rebuilt": true }
//
// Secrets: ATLEABLE_SYNC_KEY (any long random string), GITHUB_TOKEN and
// GITHUB_REPO (the same ones website-rebuild uses).
// Deploy with JWT verification off, because the key callers send no login:
//   supabase functions deploy atleable-sync --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Constant-time comparison, so the key can't be guessed from response times.
function sameKey(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "website" } });

  // A machine caller with the shared key, or a signed-in website team member.
  const key = Deno.env.get("ATLEABLE_SYNC_KEY") || "";
  if (!sameKey(req.headers.get("x-sync-key") || "", key)) {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    if (!who?.user) return reply(401, { error: "Send x-sync-key, or sign in." });
    const { data: me } = await admin.from("profiles").select("id").eq("id", who.user.id).maybeSingle();
    if (!me) return reply(403, { error: "Not a team member." });
  }

  const body = await req.json().catch(() => ({}));
  const mode = ["always", "never"].includes(body?.rebuild) ? body.rebuild : "auto";

  const { data: result, error } = await admin.rpc("sync_atleable_jobs");
  if (error) return reply(500, { error: error.message });
  const changes = (result.added || 0) + (result.updated || 0) + (result.closed || 0);

  let rebuilt = false;
  if (mode === "always" || (mode === "auto" && changes > 0)) {
    const token = Deno.env.get("GITHUB_TOKEN");
    const repo = Deno.env.get("GITHUB_REPO") || "Ena-AW/aw-website";
    if (!token) return reply(500, { ...result, rebuilt, error: "GITHUB_TOKEN is not set in Supabase." });
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/pages.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "aw-website-atleable-sync",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (!res.ok) return reply(502, { ...result, rebuilt, error: `GitHub said ${res.status}: ${await res.text()}` });
    rebuilt = true;
  }
  return reply(200, { ...result, rebuilt });
});
