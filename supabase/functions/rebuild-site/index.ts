// Starts the "Deploy to GitHub Pages" workflow, so the public site picks up
// what was just saved in the admin panel (about a minute).
// Needs the secrets GITHUB_TOKEN (fine-grained token, this repo only,
// "Actions: read and write") and GITHUB_REPO ("Ena-AW/aw-website").
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "website" } });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(jwt);
  if (!who?.user) return reply(401, { error: "Please sign in again." });
  const { data: me } = await admin.from("profiles").select("id").eq("id", who.user.id).maybeSingle();
  if (!me) return reply(403, { error: "Not a team member." });

  const token = Deno.env.get("GITHUB_TOKEN");
  const repo = Deno.env.get("GITHUB_REPO") || "Ena-AW/aw-website";
  if (!token) return reply(500, { error: "GITHUB_TOKEN is not set in Supabase." });

  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/pages.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "aw-website-admin",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (!res.ok) return reply(502, { error: `GitHub said ${res.status}: ${await res.text()}` });
  return reply(200, { ok: true });
});
