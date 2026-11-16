// The apply form on every job page posts here. This function checks the
// application and forwards it, CV included, to Atleable, which puts it in the
// job's pipeline (Applied stage). Applications never go to Workable.
//
// Browser → website-apply (this function, public) → Atleable
//   POST https://aw-ats-458449481561.europe-west1.run.app/api/website/applications
//   with the header X-Website-Key, which never reaches the browser.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ATLEABLE_WEBSITE_KEY   the key Atleable expects in X-Website-Key (required)
//   ATLEABLE_APPLY_URL     optional, to point at another Atleable address
//   TURNSTILE_SECRET       Cloudflare Turnstile secret key; when set, every
//                          application must pass the anti-bot check
// Deploy with JWT verification off, because candidates are not signed in:
//   supabase functions deploy website-apply --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ATLEABLE_URL = Deno.env.get("ATLEABLE_APPLY_URL") ||
  "https://aw-ats-458449481561.europe-west1.run.app/api/website/applications";
const MAX_CV = 10 * 1024 * 1024;
const CV_TYPES = /\.(pdf|docx?)$/i;

// Pages allowed to send applications (the live site, the GitHub Pages preview, local preview).
const ORIGINS = [/^https:\/\/(www\.)?atleanworld\.com$/, /^https:\/\/ena-aw\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.some((re) => re.test(origin)) ? origin : "https://atleanworld.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const fail = (status: number, error: string, field?: string) => reply(status, field ? { error, field } : { error });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "Use POST.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "The form could not be read. Please try again.");
  }
  const text = (name: string) => String(form.get(name) ?? "").trim();

  // Bots fill in every field, people never see this one.
  if (text("website")) return reply(201, { created: true });

  // ---- basic checks (Atleable checks again and has the final say)
  const jobId = text("job_id");
  if (!/^\d+$/.test(jobId)) return fail(422, "This job can’t take applications here.", "job_id");
  const name = text("name");
  if (name.length < 2 || name.length > 120) return fail(422, "Please enter your full name.", "name");
  const email = text("email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return fail(422, "Please enter a valid email address.", "email");
  const phone = text("phone").replace(/[\s().-]/g, "");
  if (!/^\+\d{6,16}$/.test(phone)) return fail(422, "Please enter your phone number with the country code.", "phone");
  const linkedin = text("linkedin_url");
  if (linkedin && !/^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/in\/[^\s]+$/i.test(linkedin)) {
    return fail(422, "Use your LinkedIn profile link (linkedin.com/in/…) or leave it empty.", "linkedin_url");
  }
  const cv = form.get("cv");
  if (!(cv instanceof File) || cv.size === 0) return fail(422, "Please attach your CV.", "cv");
  if (!CV_TYPES.test(cv.name)) return fail(422, "Your CV must be a PDF or Word file (.pdf, .doc, .docx).", "cv");
  if (cv.size > MAX_CV) return fail(413, "Your CV is larger than 10 MB. Please send a smaller file.", "cv");
  if (text("consent") !== "true") return fail(422, "Please tick the box to agree to how we use your data.", "consent");

  // ---- anti-bot check (Cloudflare Turnstile), when its secret is set
  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET");
  if (turnstileSecret) {
    const token = text("cf-turnstile-response");
    if (!token) return fail(422, "Please complete the security check.", "captcha");
    const check = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: turnstileSecret, response: token, remoteip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "" }),
    }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!check.success) return fail(422, "The security check failed. Please try again.", "captcha");
  }

  // ---- the job must be published on the website (so the form can't target other Atleable jobs)
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "website" } });
  const { data: job } = await db.from("jobs").select("id").eq("atleable_id", jobId).eq("status", "published").maybeSingle();
  if (!job) return fail(409, "Sorry, this job is no longer open for applications.", "job_id");

  const key = Deno.env.get("ATLEABLE_WEBSITE_KEY");
  if (!key) {
    console.error("ATLEABLE_WEBSITE_KEY is not set");
    return fail(503, "Applications are paused for a moment. Please try again later.");
  }

  // ---- forward to Atleable
  const out = new FormData();
  out.set("job_id", jobId);
  out.set("name", name);
  out.set("email", email);
  out.set("phone", phone);
  if (linkedin) out.set("linkedin_url", linkedin);
  const answers = text("answers");
  if (answers) out.set("answers", answers);
  out.set("consent", "true");
  out.set("consent_text", text("consent_text").slice(0, 2000));
  out.set("consent_at", text("consent_at") || new Date().toISOString());
  out.set("cv", cv, cv.name);

  const send = () => fetch(ATLEABLE_URL, { method: "POST", headers: { "X-Website-Key": key }, body: out });
  let res: Response;
  try {
    res = await send();
    if (res.status === 502) res = await send();   // the CV couldn't be stored: Atleable asks for one retry
  } catch (e) {
    console.error("atleable unreachable", e);
    return fail(502, "We couldn’t send your application just now. Please try again in a minute.");
  }
  const body = await res.json().catch(() => ({}));

  if (res.ok) return reply(res.status === 201 ? 201 : 200, { created: body.created !== false, application_id: body.application_id });
  console.error("atleable said", res.status, body);
  if (res.status === 422 || res.status === 413) return fail(res.status, body.error || "Please check the form.", body.field);
  if (res.status === 404 || res.status === 409) return fail(409, "Sorry, this job is no longer open for applications.", "job_id");
  // 401 / 503 / anything else: our setup, not the candidate's fault
  return fail(502, "We couldn’t send your application just now. Please try again in a minute.");
});
