// Connects the LinkedIn company page and the TikTok account (OAuth sign-in).
//
//   POST { "platform": "linkedin" | "tiktok", "return_to": "https://…/admin/" }
//        from the admin panel (an admin's login) → { "url": "<sign-in page>" }
//   GET  ?code=…&state=…   LinkedIn or TikTok sends the admin back here after
//        they agree; the account and tokens are saved and the browser goes
//        back to the admin's Social media → Accounts view.
//
// Redirect URL to register in both developer apps:
//   https://<project>.supabase.co/functions/v1/social-oauth
// Secrets: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_ORG_ID (optional,
// when the admin manages several company pages), TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET.
// Deploy with JWT verification off (the providers' redirect carries no login):
//   supabase functions deploy social-oauth --no-verify-jwt
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const LI_VERSION = Deno.env.get("LINKEDIN_VERSION") || "202606";
const LI_SCOPES = "r_organization_social w_organization_social rw_organization_admin";
const TT_SCOPES = "user.info.basic,video.upload,video.publish";
const SITE = (Deno.env.get("SITE_URL") || "https://atleanworld.com").replace(/\/+$/, "");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function selfUrl() {
  return `${Deno.env.get("SUPABASE_URL")!.replace(/\/+$/, "")}/functions/v1/social-oauth`;
}
function back(returnTo: string, params: Record<string, string>) {
  const base = returnTo && /^https:\/\//.test(returnTo) ? returnTo : `${SITE}/admin/`;
  const q = new URLSearchParams(params).toString();
  return new Response(null, { status: 302, headers: { Location: `${base.split("#")[0]}#social/accounts?${q}` } });
}
const inSeconds = (s?: number) => (s ? new Date(Date.now() + s * 1000).toISOString() : null);

async function saveAccount(db: SupabaseClient, platform: string, acc: {
  external_id: string; name: string; handle: string; avatar_url: string;
  access_token: string; refresh_token?: string | null; expires_at?: string | null; refresh_expires_at?: string | null;
}) {
  await db.from("social_accounts").delete().eq("platform", platform).neq("external_id", acc.external_id);
  await db.from("social_accounts").delete().eq("platform", platform).is("external_id", null);
  const { data, error } = await db.from("social_accounts").upsert({
    platform, external_id: acc.external_id, name: acc.name, handle: acc.handle, avatar_url: acc.avatar_url,
    status: "connected", connected_at: new Date().toISOString(), expires_at: acc.refresh_expires_at || acc.expires_at || null,
  }, { onConflict: "platform,external_id" }).select("id").single();
  if (error) throw error;
  const t = await db.from("social_tokens").upsert({
    account_id: data.id, access_token: acc.access_token, refresh_token: acc.refresh_token || null,
    expires_at: acc.expires_at || null, refresh_expires_at: acc.refresh_expires_at || null, updated_at: new Date().toISOString(),
  });
  if (t.error) throw t.error;
}

// ------------------------------------------------------------------ LinkedIn
async function linkedinFinish(db: SupabaseClient, code: string) {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: selfUrl(),
      client_id: Deno.env.get("LINKEDIN_CLIENT_ID")!, client_secret: Deno.env.get("LINKEDIN_CLIENT_SECRET")!,
    }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || `LinkedIn said ${res.status}`);

  const h = { Authorization: `Bearer ${tok.access_token}`, "LinkedIn-Version": LI_VERSION, "X-Restli-Protocol-Version": "2.0.0" };
  const aclRes = await fetch("https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED", { headers: h });
  const acl = await aclRes.json();
  if (!aclRes.ok) throw new Error(acl.message || `LinkedIn said ${aclRes.status} when listing your company pages`);
  const orgs: string[] = (acl.elements || []).map((e: any) => String(e.organization || e.organizationTarget || "")).filter(Boolean);
  if (!orgs.length) throw new Error("This LinkedIn profile isn't an admin of any company page.");

  const pages = [];
  for (const urn of orgs.slice(0, 20)) {
    const id = urn.split(":").pop()!;
    const r = await fetch(`https://api.linkedin.com/rest/organizations/${id}`, { headers: h });
    const o = r.ok ? await r.json() : {};
    pages.push({ id, urn, name: o.localizedName || "", vanity: o.vanityName || "" });
  }
  const want = Deno.env.get("LINKEDIN_ORG_ID") || "";
  const page = want ? pages.find((p) => p.id === want)
    : pages.length === 1 ? pages[0]
    : pages.find((p) => /atlean/i.test(p.name));
  if (!page) throw new Error(`This profile manages several company pages (${pages.map((p) => p.name || p.id).join(", ")}). Add the secret LINKEDIN_ORG_ID with the right one's number.`);

  await saveAccount(db, "linkedin", {
    external_id: page.urn, name: page.name, handle: page.vanity, avatar_url: "",
    access_token: tok.access_token, refresh_token: tok.refresh_token || null,
    expires_at: inSeconds(tok.expires_in), refresh_expires_at: inSeconds(tok.refresh_token_expires_in),
  });
  return page.name || "LinkedIn page";
}

// ------------------------------------------------------------------ TikTok
async function tiktokFinish(db: SupabaseClient, code: string) {
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: Deno.env.get("TIKTOK_CLIENT_KEY")!, client_secret: Deno.env.get("TIKTOK_CLIENT_SECRET")!,
      code, grant_type: "authorization_code", redirect_uri: selfUrl(),
    }),
  });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || `TikTok said ${res.status}`);
  const scopes = String(tok.scope || "");
  if (!scopes.includes("video.publish")) throw new Error("TikTok didn't grant posting (video.publish). Add the Content Posting API with Direct Post to the app, then connect again.");

  const u = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  }).then((r) => r.json()).catch(() => ({}));
  const user = u?.data?.user || {};
  await saveAccount(db, "tiktok", {
    external_id: tok.open_id || user.open_id, name: user.display_name || "TikTok", handle: "",
    avatar_url: user.avatar_url || "",
    access_token: tok.access_token, refresh_token: tok.refresh_token,
    expires_at: inSeconds(tok.expires_in), refresh_expires_at: inSeconds(tok.refresh_expires_in),
  });
  return user.display_name || "TikTok";
}

// ------------------------------------------------------------------ entry
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "website" } });

  // Step 1: the admin panel asks where to send the admin to sign in.
  if (req.method === "POST") {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = jwt ? await db.auth.getUser(jwt) : { data: null };
    if (!who?.user) return json(401, { error: "Please sign in again." });
    const { data: me } = await db.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
    if (me?.role !== "admin") return json(403, { error: "Only admins can connect accounts." });

    const body = await req.json().catch(() => ({}));
    const platform = body.platform;
    if (platform !== "linkedin" && platform !== "tiktok") return json(400, { error: "Unknown network." });
    if (platform === "linkedin" && !(Deno.env.get("LINKEDIN_CLIENT_ID") && Deno.env.get("LINKEDIN_CLIENT_SECRET")))
      return json(400, { error: "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET aren't set in Supabase yet." });
    if (platform === "tiktok" && !(Deno.env.get("TIKTOK_CLIENT_KEY") && Deno.env.get("TIKTOK_CLIENT_SECRET")))
      return json(400, { error: "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET aren't set in Supabase yet." });

    const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    await db.from("social_oauth_states").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
    const ins = await db.from("social_oauth_states").insert({ state, platform, user_id: who.user.id, return_to: String(body.return_to || "") });
    if (ins.error) return json(500, { error: ins.error.message });

    const url = platform === "linkedin"
      ? "https://www.linkedin.com/oauth/v2/authorization?" + new URLSearchParams({
          response_type: "code", client_id: Deno.env.get("LINKEDIN_CLIENT_ID")!, redirect_uri: selfUrl(), state, scope: LI_SCOPES })
      : "https://www.tiktok.com/v2/auth/authorize/?" + new URLSearchParams({
          client_key: Deno.env.get("TIKTOK_CLIENT_KEY")!, response_type: "code", scope: TT_SCOPES, redirect_uri: selfUrl(), state });
    return json(200, { url });
  }

  // Step 2: LinkedIn or TikTok sends the admin back here.
  if (req.method === "GET") {
    const u = new URL(req.url);
    const state = u.searchParams.get("state") || "";
    const { data: st } = state ? await db.from("social_oauth_states").select("*").eq("state", state).maybeSingle() : { data: null };
    if (!st) return back("", { error: "That sign-in link has expired. Click Connect again." });
    await db.from("social_oauth_states").delete().eq("state", state);
    if (Date.now() - new Date(st.created_at).getTime() > 3600_000) return back(st.return_to, { error: "That sign-in took too long. Click Connect again." });

    const err = u.searchParams.get("error_description") || u.searchParams.get("error");
    if (err) return back(st.return_to, { error: `${st.platform === "linkedin" ? "LinkedIn" : "TikTok"}: ${err}` });
    const code = u.searchParams.get("code");
    if (!code) return back(st.return_to, { error: "No sign-in code came back. Click Connect again." });

    try {
      const name = st.platform === "linkedin" ? await linkedinFinish(db, code) : await tiktokFinish(db, code);
      return back(st.return_to, { connected: st.platform, name });
    } catch (e) {
      return back(st.return_to, { error: (e as Error).message });
    }
  }
  return json(405, { error: "Use GET or POST." });
});
