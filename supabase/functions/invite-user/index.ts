// Admins add or remove team members from the admin panel's Users tab.
// POST { action: "invite", email, full_name, role, redirect_to }
// POST { action: "remove", id }
// Runs with the service role key, which never leaves Supabase.
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
  if (req.method !== "POST") return reply(405, { error: "POST only" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "website" } });

  // Who is asking? Must be a signed-in admin.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(jwt);
  if (!who?.user) return reply(401, { error: "Please sign in again." });
  const { data: me } = await admin.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
  if (me?.role !== "admin") return reply(403, { error: "Only admins can manage users." });

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request" }); }

  if (body.action === "invite") {
    const email = String(body.email || "").trim().toLowerCase();
    const role = body.role === "admin" ? "admin" : "editor";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: "That email address doesn't look right." });

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: body.redirect_to || undefined,
      data: { full_name: body.full_name || "" },
    });
    if (error) return reply(400, { error: error.message });
    const { error: pErr } = await admin.from("profiles").upsert({
      id: data.user.id, email, full_name: body.full_name || "", role,
    });
    if (pErr) return reply(500, { error: pErr.message });
    return reply(200, { ok: true, id: data.user.id });
  }

  if (body.action === "remove") {
    if (!body.id || body.id === who.user.id) return reply(400, { error: "You can't remove yourself." });
    const { error } = await admin.auth.admin.deleteUser(body.id);   // the profile goes with it (on delete cascade)
    if (error) return reply(400, { error: error.message });
    return reply(200, { ok: true });
  }

  return reply(400, { error: "Unknown action" });
});
