// TikTok publishing (Content Posting API, Direct Post).
// Videos are uploaded from here in chunks. Photo posts are pulled by TikTok
// from the media bucket, whose address must be verified in the TikTok app
// (URL properties). Until TikTok audits the app, posts can only be private.
const API = "https://open.tiktokapis.com/v2";

export class TikTokError extends Error {}
type Media = { url: string; kind: "image" | "video"; alt?: string };
export type TtPost = { format: string; caption: string; media: Media[]; overrides?: Record<string, Record<string, string>> };

async function call(token: string, path: string, body: unknown) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  const code = data?.error?.code;
  if (!res.ok || (code && code !== "ok")) {
    if (code === "access_token_invalid" || res.status === 401) throw new TikTokError("TikTok signed us out. Reconnect TikTok in Social media → Accounts.");
    if (code === "unaudited_client_can_only_post_to_private_accounts") throw new TikTokError("TikTok hasn't approved the app yet, so it can only post to a private account. Set the TikTok account to private to test, or wait for TikTok's review.");
    throw new TikTokError(data?.error?.message || `TikTok said ${res.status}${code ? " (" + code + ")" : ""}`);
  }
  return data.data || {};
}

// TikTok asks apps to check the creator's settings right before each post.
async function creator(token: string) {
  const c = await call(token, "/post/publish/creator_info/query/", {});
  const opts: string[] = c.privacy_level_options || [];
  const privacy = opts.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : opts[0] || "SELF_ONLY";
  return { privacy, maxSeconds: c.max_video_post_duration_sec as number | undefined, comments: !c.comment_disabled };
}

export async function toTikTok(token: string, p: TtPost, jpeg: (url: string) => Promise<string>) {
  if (p.format === "story") throw new TikTokError("TikTok stories can't be posted by apps.");
  const media = p.media || [];
  if (!media.length) throw new TikTokError("TikTok needs a video or photos.");
  const caption = (p.overrides?.tiktok?.caption ?? p.caption ?? "").trim();
  const c = await creator(token);
  const video = media.find((m) => m.kind === "video");

  if (video) {
    const file = await fetch(video.url);
    if (!file.ok) throw new TikTokError(`The video ${video.url} could not be opened (${file.status}).`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const size = bytes.length;
    const MB = 1024 * 1024;
    // one chunk up to 64 MB; above that 10 MB chunks, the last one taking the rest
    const chunk = size <= 64 * MB ? size : 10 * MB;
    const count = size <= 64 * MB ? 1 : Math.floor(size / chunk);
    const init = await call(token, "/post/publish/video/init/", {
      post_info: {
        title: caption.slice(0, 2200), privacy_level: c.privacy,
        disable_comment: !c.comments, disable_duet: false, disable_stitch: false,
      },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count },
    });
    for (let i = 0; i < count; i++) {
      const start = i * chunk;
      const end = i === count - 1 ? size - 1 : start + chunk - 1;
      const res = await fetch(init.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end}/${size}` },
        body: bytes.slice(start, end + 1),
      });
      if (!res.ok) throw new TikTokError(`TikTok didn't accept the video upload (${res.status}).`);
    }
    return { publish_id: init.publish_id as string, privacy: c.privacy };
  }

  const photos = [];
  for (const m of media.slice(0, 35)) photos.push(await jpeg(m.url));
  const [first, ...rest] = caption.split("\n");
  const init = await call(token, "/post/publish/content/init/", {
    post_info: {
      title: (first || "").slice(0, 90), description: (rest.join("\n").trim() || caption).slice(0, 4000),
      privacy_level: c.privacy, disable_comment: !c.comments, auto_add_music: true,
    },
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: photos },
    post_mode: "DIRECT_POST",
    media_type: "PHOTO",
  });
  return { publish_id: init.publish_id as string, privacy: c.privacy };
}

// PUBLISH_COMPLETE → done; FAILED → error; anything else → still processing.
export async function tiktokStatus(token: string, publishId: string) {
  const s = await call(token, "/post/publish/status/fetch/", { publish_id: publishId });
  if (s.status === "FAILED") throw new TikTokError(`TikTok couldn't publish it: ${s.fail_reason || "unknown reason"}.`);
  if (s.status === "PUBLISH_COMPLETE") {
    const ids = s.publicaly_available_post_id || s.publicly_available_post_id || [];
    return { done: true, id: String(ids[0] || publishId) };
  }
  return { done: false };
}

// TikTok access tokens last 24 hours; refresh tokens a year.
export async function refreshTikTok(refresh: string) {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: Deno.env.get("TIKTOK_CLIENT_KEY") || "", client_secret: Deno.env.get("TIKTOK_CLIENT_SECRET") || "",
      grant_type: "refresh_token", refresh_token: refresh,
    }),
  });
  const t = await res.json();
  if (!res.ok || !t.access_token) throw new TikTokError(t.error_description || "TikTok wouldn't renew the sign-in.");
  return t as { access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number };
}
