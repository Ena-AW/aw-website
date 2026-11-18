// LinkedIn company page publishing (Posts, Images and Videos APIs).
// Needs the Community Management API product on the LinkedIn app.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const LI_VERSION = Deno.env.get("LINKEDIN_VERSION") || "202606";
const API = "https://api.linkedin.com/rest";

export class LinkedInError extends Error {}
type Media = { url: string; kind: "image" | "video"; alt?: string };
export type LiPost = { format: string; caption: string; media: Media[]; link_url: string; title?: string };
export type LiAccount = { urn: string; token: string };

function headers(token: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, "LinkedIn-Version": LI_VERSION, "X-Restli-Protocol-Version": "2.0.0", ...extra };
}
async function call(token: string, path: string, body?: unknown, method = "POST") {
  const res = await fetch(API + path, {
    method,
    headers: headers(token, body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return { message: text }; } })() : {};
  if (!res.ok) {
    if (res.status === 401) throw new LinkedInError("LinkedIn signed us out. Reconnect LinkedIn in Social media → Accounts.");
    throw new LinkedInError(data.message || `LinkedIn said ${res.status}`);
  }
  return { data, headers: res.headers };
}

// LinkedIn's "little" text format treats these characters as markup.
function little(text: string) {
  return text.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => "\\" + c)
    // #hashtags become real LinkedIn hashtags
    .replace(/\\#([\p{L}\p{N}_]+)/gu, "{hashtag|\\#|$1}");
}

async function uploadImage(acc: LiAccount, url: string) {
  const init = await call(acc.token, "/images?action=initializeUpload", { initializeUploadRequest: { owner: acc.urn } });
  const { uploadUrl, image } = init.data.value;
  const file = await fetch(url);
  if (!file.ok) throw new LinkedInError(`The photo ${url} could not be opened (${file.status}).`);
  const put = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${acc.token}` }, body: await file.arrayBuffer() });
  if (!put.ok) throw new LinkedInError(`LinkedIn didn't accept the photo (${put.status}).`);
  return image as string;
}

async function uploadVideo(acc: LiAccount, url: string) {
  const file = await fetch(url);
  if (!file.ok) throw new LinkedInError(`The video ${url} could not be opened (${file.status}).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const init = await call(acc.token, "/videos?action=initializeUpload", {
    initializeUploadRequest: { owner: acc.urn, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false },
  });
  const v = init.data.value;
  const etags: string[] = [];
  for (const part of v.uploadInstructions) {
    const res = await fetch(part.uploadUrl, { method: "PUT", body: bytes.slice(part.firstByte, part.lastByte + 1) });
    if (!res.ok) throw new LinkedInError(`LinkedIn didn't accept part of the video (${res.status}).`);
    etags.push(res.headers.get("etag") || "");
  }
  await call(acc.token, "/videos?action=finalizeUpload", {
    finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken || "", uploadedPartIds: etags },
  });
  // Wait until LinkedIn has processed it (usually seconds for short videos).
  for (let i = 0; i < 20; i++) {
    const s = await call(acc.token, `/videos/${encodeURIComponent(v.video)}`, undefined, "GET").catch(() => null);
    const status = s?.data?.status;
    if (status === "AVAILABLE") break;
    if (status === "PROCESSING_FAILED") throw new LinkedInError("LinkedIn couldn't process the video. Try an MP4 under 10 minutes.");
    await new Promise((r) => setTimeout(r, 3000));
  }
  return v.video as string;
}

async function linkTitle(url: string) {
  try {
    const html = await (await fetch(url, { redirect: "follow" })).text();
    const m = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
    return m ? m[1].replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim() : new URL(url).hostname;
  } catch { return url; }
}

export async function toLinkedIn(_db: SupabaseClient, acc: LiAccount, p: LiPost) {
  if (p.format === "story") throw new LinkedInError("LinkedIn has no stories.");
  const media = p.media || [];
  const base: Record<string, unknown> = {
    author: acc.urn,
    commentary: little(p.caption || ""),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  const video = media.find((m) => m.kind === "video");
  if (video && (p.format === "reel" || media.length === 1)) {
    base.content = { media: { id: await uploadVideo(acc, video.url), title: (p.title || p.caption || "Video").split("\n")[0].slice(0, 200) } };
  } else if (media.length > 1) {
    if (media.some((m) => m.kind === "video")) throw new LinkedInError("LinkedIn can't mix videos into a multi-photo post. Use photos only.");
    const ids = [];
    for (const m of media.slice(0, 20)) ids.push({ id: await uploadImage(acc, m.url), altText: (m.alt || "").slice(0, 4086) });
    base.content = { multiImage: { images: ids } };
  } else if (media.length === 1) {
    base.content = { media: { id: await uploadImage(acc, media[0].url), altText: (media[0].alt || "").slice(0, 4086) } };
  } else if (p.link_url) {
    base.content = { article: { source: p.link_url, title: await linkTitle(p.link_url) } };
  } else if (!p.caption.trim()) {
    throw new LinkedInError("Nothing to post: add a caption, a link or a photo.");
  }
  if (p.link_url && media.length && !p.caption.includes(p.link_url)) base.commentary = little((p.caption + "\n\n" + p.link_url).trim());

  const r = await call(acc.token, "/posts", base);
  const id = r.headers.get("x-restli-id") || r.headers.get("x-linkedin-id") || "";
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : undefined };
}

// LinkedIn access tokens last 60 days; refresh tokens (when LinkedIn gives one) a year.
export async function refreshLinkedIn(refresh: string) {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: refresh,
      client_id: Deno.env.get("LINKEDIN_CLIENT_ID") || "", client_secret: Deno.env.get("LINKEDIN_CLIENT_SECRET") || "",
    }),
  });
  const t = await res.json();
  if (!res.ok || !t.access_token) throw new LinkedInError(t.error_description || "LinkedIn wouldn't renew the sign-in.");
  return t as { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number };
}
