// Publishes the Social media planner's scheduled posts, carousels, reels and
// stories to the Facebook Page, Instagram, the LinkedIn company page and
// TikTok when their time comes. LinkedIn and TikTok connect through
// social-oauth; their tokens are renewed here before they run out.
//
// Who can call it:
//   * pg_cron every 5 minutes, with the header  x-cron-key: <SOCIAL_CRON_KEY>
//     → { "action": "run" }
//   * an admin in the panel (Social media → Accounts) → { "action": "connect" }
//     or { "action": "disconnect" }, and any team member → { "action": "run" }
//
// Secrets:
//   META_SYSTEM_TOKEN  Business Manager system user token (never expires) with
//                      pages_show_list, pages_read_engagement, pages_manage_posts,
//                      instagram_basic, instagram_content_publish, business_management
//   META_PAGE_ID       optional: which Page, if the token can reach several
// The cron key is the Vault secret social_cron_key (read with website.social_cron_key()).
// Deploy with JWT verification off, because pg_cron sends no login:
//   supabase functions deploy social-publish --no-verify-jwt
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { decode, Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { LinkedInError, refreshLinkedIn, toLinkedIn } from "./linkedin.ts";
import { refreshTikTok, TikTokError, tiktokStatus, toTikTok } from "./tiktok.ts";

const GRAPH = "https://graph.facebook.com/v23.0";
const RUPLOAD = "https://rupload.facebook.com/video-upload/v23.0";
const BUDGET_MS = 110_000; // stop starting new work after this, so a run never hits the time limit

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function sameKey(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Media = { url: string; kind: "image" | "video"; alt?: string };
type Post = {
  id: string; format: "post" | "carousel" | "reel" | "story"; platforms: string[]; caption: string;
  overrides: Record<string, Record<string, string>>; media: Media[]; link_url: string;
  scheduled_at: string | null; status: string; results: Record<string, Record<string, string>>;
};
type Target = { page: string; ig: string | null; token: string };
type Done = { id: string; url?: string; note?: string } | { pending: string; note?: string };

// ------------------------------------------------------------------ Graph API
class MetaError extends Error {}

async function graph(path: string, token: string, params: Record<string, unknown> = {}, method = "POST") {
  const url = new URL(path.startsWith("http") ? path : GRAPH + path);
  const init: RequestInit = { method };
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set("access_token", token);
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) body.set(k, typeof v === "string" ? v : JSON.stringify(v));
    body.set("access_token", token);
    init.body = body;
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new MetaError(e.error_user_msg || e.message || `Meta said ${res.status}`);
  }
  return data;
}

// Reels and video stories: start, hand Meta the video's address, finish.
async function hostedVideo(edge: string, token: string, fileUrl: string, finish: Record<string, unknown>) {
  const start = await graph(edge, token, { upload_phase: "start" });
  const up = await fetch(`${RUPLOAD}/${start.video_id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
  });
  if (!up.ok) throw new MetaError(`Meta could not fetch the video (${up.status}). Check that it is an MP4 and still in the media library.`);
  await graph(edge, token, { upload_phase: "finish", video_id: start.video_id, ...finish });
  return String(start.video_id);
}

// ------------------------------------------------------------------ images for Instagram
// Instagram takes only JPEG photos between 4:5 (tall) and 1.91:1 (wide).
// Anything else is converted once and kept in the media bucket under social/ig/.
function jpegSize(buf: Uint8Array): [number, number] | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return [(buf[i + 7] << 8) | buf[i + 8], (buf[i + 5] << 8) | buf[i + 6]];
    }
    i += 2 + len;
  }
  return null;
}

async function igImage(db: SupabaseClient, url: string, story: boolean): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new MetaError(`The photo ${url} could not be opened (${res.status}).`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const size = jpegSize(buf);
  if (size) {
    const r = size[0] / size[1];
    if (story || (r >= 0.8 && r <= 1.91)) return url;
  }
  const img = await decode(buf);
  if (!(img instanceof Image)) throw new MetaError("Instagram takes photos (JPEG or PNG), not animated GIFs.");
  if (!story) {
    const r = img.width / img.height;
    if (r < 0.8) { const h = Math.round(img.width / 0.8); img.crop(0, Math.round((img.height - h) / 2), img.width, h); }
    else if (r > 1.91) { const w = Math.round(img.height * 1.91); img.crop(Math.round((img.width - w) / 2), 0, w, img.height); }
  }
  if (img.width > 1440) img.resize(1440, Image.RESIZE_AUTO);
  const jpg = await img.encodeJPEG(88);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(url + story))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const path = `social/ig/${hash}.jpg`;
  const { error } = await db.storage.from("media").upload(path, jpg, { contentType: "image/jpeg", upsert: true });
  if (error) throw new MetaError("Could not save the converted photo: " + error.message);
  return db.storage.from("media").getPublicUrl(path).data.publicUrl;
}

// ------------------------------------------------------------------ Facebook
function captionFor(p: Post, net: string) {
  return (p.overrides?.[net]?.caption ?? p.caption ?? "").trim();
}

async function toFacebook(p: Post, t: Target): Promise<Done> {
  const { page, token } = t;
  const media = p.media || [];
  let message = captionFor(p, "facebook");
  const link = (p.overrides?.facebook?.link_url ?? p.link_url ?? "").trim();
  const permalink = async (id: string) =>
    (await graph(`/${id}`, token, { fields: "permalink_url" }, "GET").catch(() => ({}))).permalink_url as string | undefined;

  if (p.format === "story") {
    const m = media[0];
    if (!m) throw new MetaError("A story needs a photo or a video.");
    if (m.kind === "video") {
      const id = await hostedVideo(`/${page}/video_stories`, token, m.url, {});
      return { id, url: `https://www.facebook.com/stories/${page}` };
    }
    const photo = await graph(`/${page}/photos`, token, { url: m.url, published: false });
    const story = await graph(`/${page}/photo_stories`, token, { photo_id: photo.id });
    return { id: String(story.post_id || photo.id), url: `https://www.facebook.com/stories/${page}` };
  }

  if (p.format === "reel") {
    const m = media.find((x) => x.kind === "video");
    if (!m) throw new MetaError("A reel needs a video.");
    const id = await hostedVideo(`/${page}/video_reels`, token, m.url, { video_state: "PUBLISHED", description: message });
    return { id, url: `https://www.facebook.com/reel/${id}` };
  }

  if (link && media.length && !message.includes(link)) message = (message + "\n\n" + link).trim();

  if (!media.length) {
    if (!message && !link) throw new MetaError("Nothing to post: add a caption, a link or a photo.");
    const r = await graph(`/${page}/feed`, token, link ? { message, link } : { message });
    return { id: r.id, url: await permalink(r.id) };
  }

  if (media.length === 1 && media[0].kind === "video") {
    const r = await graph(`/${page}/videos`, token, { file_url: media[0].url, description: message });
    return { id: r.id, url: `https://www.facebook.com/${page}/videos/${r.id}` };
  }

  if (media.length === 1) {
    const r = await graph(`/${page}/photos`, token, { url: media[0].url, caption: message });
    const id = r.post_id || r.id;
    return { id, url: await permalink(id) };
  }

  if (media.some((m) => m.kind === "video")) throw new MetaError("Facebook can't mix videos into a multi-photo post. Use photos only, or post the video on its own.");
  const ids: string[] = [];
  for (const m of media.slice(0, 10)) ids.push((await graph(`/${page}/photos`, token, { url: m.url, published: false })).id);
  const r = await graph(`/${page}/feed`, token, { message, attached_media: ids.map((id) => ({ media_fbid: id })) });
  return { id: r.id, url: await permalink(r.id) };
}

// ------------------------------------------------------------------ Instagram
// Instagram works in two steps: make a "container", wait until Meta has
// processed it, then publish it. Videos can take a few minutes; if one isn't
// ready the container id is kept in results.instagram.pending and the next
// run carries on from there.
async function containerState(id: string, token: string) {
  const r = await graph(`/${id}`, token, { fields: "status_code,status" }, "GET");
  if (r.status_code === "ERROR" || r.status_code === "EXPIRED") throw new MetaError(`Instagram could not process the media: ${r.status || r.status_code}`);
  return r.status_code as string;
}
async function waitReady(id: string, token: string, maxMs: number) {
  const until = Date.now() + maxMs;
  while (true) {
    if ((await containerState(id, token)) === "FINISHED") return true;
    if (Date.now() > until) return false;
    await sleep(4000);
  }
}

async function publishContainer(p: Post, t: Target, creation: string): Promise<Done> {
  const r = await graph(`/${t.ig}/media_publish`, t.token, { creation_id: creation });
  const first = (p.overrides?.instagram?.first_comment || "").trim();
  if (first && p.format !== "story") await graph(`/${r.id}/comments`, t.token, { message: first }).catch(() => null);
  const info = await graph(`/${r.id}`, t.token, { fields: "permalink" }, "GET").catch(() => ({}));
  return { id: r.id, url: info.permalink || (p.format === "story" ? `https://www.instagram.com/stories/` : undefined) };
}

async function toInstagram(db: SupabaseClient, p: Post, t: Target, deadline: number): Promise<Done> {
  if (!t.ig) throw new MetaError("No Instagram business account is linked to the Facebook Page.");
  const { ig, token } = t;
  const pending = p.results?.instagram?.pending;
  if (pending) {
    const ready = await waitReady(pending, token, Math.max(0, Math.min(60_000, deadline - Date.now())));
    return ready ? publishContainer(p, t, pending) : { pending };
  }

  const media = p.media || [];
  if (!media.length) throw new MetaError("Instagram needs at least one photo or video.");
  const caption = captionFor(p, "instagram");
  const story = p.format === "story";
  const item = async (m: Media, extra: Record<string, unknown>) =>
    m.kind === "video"
      ? { video_url: m.url, ...extra }
      : { image_url: await igImage(db, m.url, story), ...extra };

  let creation: string;
  if (p.format === "carousel" && media.length > 1) {
    const children: string[] = [];
    for (const m of media.slice(0, 10)) {
      const c = await graph(`/${ig}/media`, token, await item(m, m.kind === "video" ? { media_type: "VIDEO", is_carousel_item: true } : { is_carousel_item: true }));
      children.push(c.id);
    }
    for (const c of children) {
      if (!(await waitReady(c, token, 90_000))) throw new MetaError("Instagram took too long to process a carousel video. Try again with a shorter video.");
    }
    creation = (await graph(`/${ig}/media`, token, { media_type: "CAROUSEL", children: children.join(","), caption })).id;
  } else if (story) {
    creation = (await graph(`/${ig}/media`, token, await item(media[0], { media_type: "STORIES" }))).id;
  } else {
    const m = p.format === "reel" ? media.find((x) => x.kind === "video") : media[0];
    if (!m) throw new MetaError("A reel needs a video.");
    creation = (await graph(`/${ig}/media`, token,
      m.kind === "video" ? { media_type: "REELS", video_url: m.url, caption, share_to_feed: true } : await item(m, { caption }))).id;
  }

  const ready = await waitReady(creation, token, Math.max(5_000, Math.min(60_000, deadline - Date.now())));
  return ready ? publishContainer(p, t, creation) : { pending: creation };
}

// ------------------------------------------------------------------ accounts
async function connect(db: SupabaseClient) {
  const sys = Deno.env.get("META_SYSTEM_TOKEN");
  if (!sys) throw new MetaError("META_SYSTEM_TOKEN is not set in Supabase (Edge Functions → Secrets).");
  const want = Deno.env.get("META_PAGE_ID") || "";
  const r = await graph("/me/accounts", sys, {
    fields: "id,name,username,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
    limit: 50,
  }, "GET");
  const pages = (r.data || []) as Array<Record<string, any>>;
  if (!pages.length) throw new MetaError("The token can't see any Facebook Page. In Business settings → System users, assign the Page to the system user, then make a new token.");
  const page = want ? pages.find((x) => x.id === want)
    : pages.length === 1 ? pages[0]
    : pages.find((x) => /atlean/i.test(x.name || ""));
  if (!page) throw new MetaError(`The token can reach several Pages (${pages.map((x) => x.name).join(", ")}). Add the secret META_PAGE_ID with the right one's id.`);
  const igAcc = page.instagram_business_account;

  const save = async (platform: string, external_id: string, name: string, handle: string, avatar: string) => {
    await db.from("social_accounts").delete().eq("platform", platform).neq("external_id", external_id);
    await db.from("social_accounts").delete().eq("platform", platform).is("external_id", null);
    const { data, error } = await db.from("social_accounts").upsert({
      platform, external_id, name, handle, avatar_url: avatar || "", status: "connected",
      connected_at: new Date().toISOString(), expires_at: null,
    }, { onConflict: "platform,external_id" }).select("id").single();
    if (error) throw error;
    const t = await db.from("social_tokens").upsert({ account_id: data.id, access_token: page.access_token, updated_at: new Date().toISOString() });
    if (t.error) throw t.error;
  };
  await save("facebook", page.id, page.name || "", page.username || "", page.picture?.data?.url || "");
  if (igAcc) await save("instagram", igAcc.id, igAcc.name || igAcc.username || "", igAcc.username || "", igAcc.profile_picture_url || "");
  else await db.from("social_accounts").update({ status: "not_connected" }).eq("platform", "instagram");

  return { facebook: page.name, instagram: igAcc ? "@" + igAcc.username : null };
}

type Accounts = { meta: Target | null; linkedin: { urn: string; token: string } | null; tiktok: { token: string } | null; problems: string[] };

async function accounts(db: SupabaseClient): Promise<Accounts> {
  const out: Accounts = { meta: null, linkedin: null, tiktok: null, problems: [] };
  const load = async () => {
    const { data } = await db.from("social_accounts")
      .select("id,platform,external_id,status,social_tokens(access_token,refresh_token,expires_at,refresh_expires_at)")
      .eq("status", "connected");
    return (data || []) as Array<Record<string, any>>;
  };
  let rows = await load();
  if (!rows.some((r) => r.platform === "facebook") && Deno.env.get("META_SYSTEM_TOKEN")) {
    try { await connect(db); rows = await load(); } // first run after the token was saved
    catch (e) { out.problems.push("Meta: " + (e as Error).message); }
  }
  const tokOf = (r: any) => (Array.isArray(r?.social_tokens) ? r.social_tokens[0] : r?.social_tokens) || null;

  const fb = rows.find((r) => r.platform === "facebook");
  const igRow = rows.find((r) => r.platform === "instagram");
  if (fb && tokOf(fb)?.access_token) out.meta = { page: fb.external_id, ig: igRow?.external_id || null, token: tokOf(fb).access_token };

  // LinkedIn (60-day token) and TikTok (24-hour token): renew a day ahead.
  const soon = Date.now() + 24 * 3600_000;
  for (const platform of ["linkedin", "tiktok"] as const) {
    const r = rows.find((x) => x.platform === platform);
    const t = tokOf(r);
    if (!r || !t?.access_token) continue;
    let access = t.access_token as string;
    const expires = t.expires_at ? new Date(t.expires_at).getTime() : Infinity;
    if (expires < soon + (platform === "tiktok" ? 0 : 6 * 24 * 3600_000)) {
      try {
        if (!t.refresh_token) throw new Error("no refresh token");
        const n = platform === "linkedin" ? await refreshLinkedIn(t.refresh_token) : await refreshTikTok(t.refresh_token);
        access = n.access_token;
        const at = (s?: number) => (s ? new Date(Date.now() + s * 1000).toISOString() : null);
        await db.from("social_tokens").update({
          access_token: n.access_token, refresh_token: n.refresh_token || t.refresh_token,
          expires_at: at(n.expires_in), refresh_expires_at: at((n as any).refresh_token_expires_in || (n as any).refresh_expires_in) || t.refresh_expires_at,
          updated_at: new Date().toISOString(),
        }).eq("account_id", r.id);
      } catch (e) {
        if (expires < Date.now()) {
          await db.from("social_accounts").update({ status: "expired" }).eq("id", r.id);
          out.problems.push(`${platform}: sign-in expired, reconnect it (${(e as Error).message})`);
          continue;
        }
      }
    }
    if (platform === "linkedin") out.linkedin = { urn: r.external_id, token: access };
    else out.tiktok = { token: access };
  }
  return out;
}

// ------------------------------------------------------------------ scheduled in Meta
// Posts scheduled directly in Meta Business Suite for the Facebook Page are
// copied into the planner (source 'meta'), so the calendar shows everything
// that is coming. They are read-only: Meta publishes them, never this function.
// Meta's API does not list Instagram posts scheduled in Business Suite.
async function syncMeta(db: SupabaseClient, t: Target) {
  const r = await graph(`/${t.page}/scheduled_posts`, t.token, {
    fields: "id,message,scheduled_publish_time,full_picture,attachments{media_type,media{image{src}},subattachments{media{image{src}}},unshimmed_url}",
    limit: 100,
  }, "GET");
  const list = (r.data || []) as Array<Record<string, any>>;
  const seen: string[] = [];
  for (const x of list) {
    const when = typeof x.scheduled_publish_time === "number"
      ? new Date(x.scheduled_publish_time * 1000).toISOString()
      : new Date(x.scheduled_publish_time).toISOString();
    const att = x.attachments?.data?.[0];
    const subs = (att?.subattachments?.data || []).map((a: any) => a.media?.image?.src).filter(Boolean);
    const pics: string[] = subs.length ? subs : [att?.media?.image?.src || x.full_picture].filter(Boolean);
    const isVideo = /video/i.test(att?.media_type || "");
    seen.push(x.id);
    const { error } = await db.from("social_posts").upsert({
      source: "meta", external_id: x.id,
      title: "", format: pics.length > 1 ? "carousel" : "post", platforms: ["facebook"],
      caption: x.message || "", media: pics.map((u) => ({ url: u, kind: isVideo ? "video" : "image" })),
      link_url: att?.unshimmed_url || "", scheduled_at: when, status: "scheduled",
    }, { onConflict: "source,external_id" });
    if (error) console.error("meta sync", x.id, error.message);
  }
  // Copies that Meta no longer lists: published if their time has passed, otherwise cancelled there.
  const { data: mine } = await db.from("social_posts").select("id,external_id,scheduled_at").eq("source", "meta").eq("status", "scheduled");
  for (const m of mine || []) {
    if (seen.includes(m.external_id)) continue;
    if (m.scheduled_at && new Date(m.scheduled_at).getTime() <= Date.now() + 60_000) {
      await db.from("social_posts").update({ status: "published", results: { facebook: { id: m.external_id, url: `https://www.facebook.com/${m.external_id}` } } }).eq("id", m.id);
    } else {
      await db.from("social_posts").delete().eq("id", m.id);
    }
  }
  return list.length;
}

// ------------------------------------------------------------------ TikTok
// TikTok publishes in the background: the first run starts it, later runs
// check until TikTok says it is done.
async function tiktokPublish(db: SupabaseClient, token: string, p: Post, prev?: Record<string, string>): Promise<Done> {
  let id = prev?.pending, note = prev?.note;
  if (!id) {
    const r = await toTikTok(token, { format: p.format, caption: p.caption, media: p.media || [], overrides: p.overrides },
      (url) => igImage(db, url, true));
    id = r.publish_id;
    if (r.privacy !== "PUBLIC_TO_EVERYONE") note = "Posted as private: TikTok hasn't approved the app for public posts yet.";
  }
  for (let i = 0; i < 5; i++) {
    const s = await tiktokStatus(token, id);
    if (s.done) return { id: s.id!, url: `https://www.tiktok.com/video/${s.id}`, ...(note ? { note } : {}) };
    await sleep(4000);
  }
  return { pending: id, ...(note ? { note } : {}) };
}

// ------------------------------------------------------------------ publishing
async function publishDue(db: SupabaseClient, acc: Accounts, deadline: number) {
  const t = acc.meta;
  // Posts left in "publishing" by a run that crashed go back in the queue after 15 minutes.
  await db.from("social_posts").update({ status: "scheduled" })
    .eq("status", "publishing").is("source", null).lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString());

  const { data: due } = await db.from("social_posts").select("*")
    .eq("status", "scheduled").is("source", null).lte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(10);
  const out: Array<{ id: string; status: string }> = [];

  for (const p of (due || []) as Post[]) {
    if (Date.now() > deadline) break;
    const claim = await db.from("social_posts").update({ status: "publishing" }).eq("id", p.id).eq("status", "scheduled").select("id");
    if (!claim.data?.length) continue; // another run took it

    const results: Record<string, Record<string, string>> = { ...(p.results || {}) };
    let waiting = false, failed = false;
    for (const net of p.platforms || []) {
      if (results[net]?.id) continue; // already out (a retry after another network failed)
      const name = ({ facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok" } as Record<string, string>)[net] || net;
      const missing = (net === "facebook" && !t) || (net === "instagram" && !t?.ig) || (net === "linkedin" && !acc.linkedin) || (net === "tiktok" && !acc.tiktok);
      if (missing) { results[net] = { error: `${name} isn't connected, so it was skipped.` }; continue; }
      try {
        let r: Done;
        if (net === "facebook") r = await toFacebook(p, t!);
        else if (net === "instagram") r = await toInstagram(db, { ...p, results }, t!, deadline);
        else if (net === "linkedin") r = await toLinkedIn(db, acc.linkedin!, { format: p.format, caption: captionFor(p, "linkedin"), media: p.media || [], link_url: p.overrides?.linkedin?.link_url ?? p.link_url ?? "" });
        else r = await tiktokPublish(db, acc.tiktok!.token, p, results.tiktok);
        if ("pending" in r) { results[net] = { pending: r.pending, ...(r.note ? { note: r.note } : {}) }; waiting = true; }
        else results[net] = { id: r.id, ...(r.url ? { url: r.url } : {}), ...(r.note ? { note: r.note } : {}) };
      } catch (e) {
        failed = true;
        const known = e instanceof MetaError || e instanceof LinkedInError || e instanceof TikTokError;
        results[net] = { error: known ? (e as Error).message : `Something went wrong: ${(e as Error).message}` };
      }
    }
    const status = waiting ? "scheduled" : failed ? "failed" : "published";
    await db.from("social_posts").update({ status, results }).eq("id", p.id);
    out.push({ id: p.id, status });
  }
  return out;
}

// ------------------------------------------------------------------ entry
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  const started = Date.now();
  const deadline = started + BUDGET_MS;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "website" } });
  const body = await req.json().catch(() => ({}));
  const action = body.action || "run";

  // Who is calling?
  let role: "cron" | "admin" | "staff" | null = null;
  const cronKey = req.headers.get("x-cron-key") || "";
  if (cronKey) {
    const { data: want } = await db.rpc("social_cron_key");
    if (sameKey(cronKey, String(want || ""))) role = "cron";
  } else {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = jwt ? await db.auth.getUser(jwt) : { data: null };
    if (who?.user) {
      const { data: me } = await db.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
      if (me) role = me.role === "admin" ? "admin" : "staff";
    }
  }
  if (!role) return reply(401, { error: "Please sign in again." });

  try {
    if (action === "connect") {
      if (role !== "admin") return reply(403, { error: "Only admins can connect accounts." });
      return reply(200, { ok: true, connected: await connect(db) });
    }
    if (action === "disconnect") {
      if (role !== "admin") return reply(403, { error: "Only admins can disconnect accounts." });
      const which = body.platform === "linkedin" || body.platform === "tiktok" ? [body.platform] : ["facebook", "instagram"];
      const { data: accs } = await db.from("social_accounts").select("id").in("platform", which);
      const ids = (accs || []).map((a: any) => a.id);
      if (ids.length) {
        await db.from("social_tokens").delete().in("account_id", ids);
        await db.from("social_accounts").update({ status: "not_connected" }).in("id", ids);
      }
      return reply(200, { ok: true });
    }
    if (action !== "run") return reply(400, { error: "Unknown action." });

    const acc = await accounts(db);
    const t = acc.meta;
    const fromMeta = t ? await syncMeta(db, t).catch((e) => { console.error("meta sync", e); return (e as Error).message; }) : 0;
    const any = !!(t || acc.linkedin || acc.tiktok);
    const published = any ? await publishDue(db, acc, deadline) : [];
    return reply(200, {
      ok: true, connected: { meta: !!t, linkedin: !!acc.linkedin, tiktok: !!acc.tiktok },
      problems: acc.problems, scheduled_in_meta: fromMeta, published,
    });
  } catch (e) {
    return reply(e instanceof MetaError ? 400 : 500, { error: (e as Error).message });
  }
});
