require("dotenv").config();

// ── AI MOCK MODE ──
// Sätt MOCK_AI=true i .env för att pausa alla Claude-anrop.
// Befintliga fallbacks i varje endpoint tar vid — inga API-kostnader.
if (process.env.MOCK_AI === 'true') {
  const _fetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (typeof url === 'string' && url.includes('api.anthropic.com')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ content: [{ text: "" }] })
      });
    }
    return _fetch(url, options);
  };
  console.log("[MOCK_AI] Claude-anrop pausade — returnerar tomma svar.");
}

// ── ANTHROPIC TIMEOUT ──
// Wrap globalThis.fetch so every call to api.anthropic.com gets a 30 s
// AbortSignal.timeout if the caller didn't already pass a `signal`.
// Prevents hung Claude requests from tying up server workers.
// Composes cleanly with the MOCK_AI wrapper above (this runs outermost).
// The meta-agent at line ~5447 passes its own 60 s AbortController and is
// left untouched by the `!options.signal` guard.
if (!globalThis.__anthropicTimeoutInstalled) {
  globalThis.__anthropicTimeoutInstalled = true;
  const _origFetch = globalThis.fetch;
  globalThis.fetch = (url, options = {}) => {
    if (typeof url === 'string' && url.includes('api.anthropic.com') && !options.signal) {
      return _origFetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
    }
    return _origFetch(url, options);
  };
}

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cron = require("node-cron");
const CryptoJS = require("crypto-js");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const Sentry = require("@sentry/node");
const multer = require("multer");
const pdfParse = require("pdf-parse");

// ── SENTRY ──
// No-op when SENTRY_DSN is not set — safe to leave initialized always.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version || undefined,
  });
}

// ── UNIVERSELLA AGENT-GUARDRAILS ──
// Appenderas automatiskt till alla agent-systemprompter vid laddning.
// Systemprincip: ingen fabricering, ingen klinisk tolkning mot normgruppsintervall.
const AGENT_GUARDRAILS = `
---

### UNIVERSELLA REGLER (icke-förhandlingsbara)

**1. Ingen fabricering.**
Du refererar aldrig till data, värden, mönster, siffror eller händelser som inte finns i inputen du fått. Om inputen inte innehåller något — säg "jag vet inte" eller hoppa över det. Påhittade uppgifter som låter auktoritativa är det värsta felet du kan göra. Exempel på vad du ALDRIG gör: påstå "du sover under 5 timmar per natt" när det inte står i datan; beskriva "historiskt mönster X" när inga historiska data finns; hitta på specifika datum eller siffror.

**2. Ingen klinisk tolkning mot normgruppsintervall.**
Du uttalar dig aldrig om kliniska eller fysiologiska värden (T-score, referensintervall för blodmarkörer, hormonnivåer, DNA-sjukdomsrisker) är "lågt", "högt", "normalt", "bra" eller "dåligt" i klinisk mening. Du får beskriva värdet och dess enhet. Du får jämföra mot användarens egen tidigare baseline. Men inte mot normgrupp. Klinisk tolkning är läkarens roll. Forsyne är inte ett diagnostiskt system.

**3. Personlig baseline är tillåtet och förväntat.**
"Din HRV är 15 procent under ditt eget snitt" är en observation du ska göra. "Din HRV är låg" är en klinisk påståendeform du inte ska göra. Skillnaden: baseline-jämförelser kräver personens egna mönster, inte extern norm. Sport-science-prestationsbegrepp (snabb/långsam muskelfiber, aerob/anaerob kapacitet) får användas när det stöds av inputdata.
`.trim();

// Load agent system prompts — alla får AGENT_GUARDRAILS appenderat automatiskt
const AGENTS = {};
["2_checkin","3_insights","4_prediction","5_datasources","9_balance","6_blood","7_dna","8_nutrition","10_journal"].forEach(name => {
  const file = path.join(__dirname, "agents", `agent_${name}.md`);
  if (fs.existsSync(file)) AGENTS[name.split("_")[0]] = fs.readFileSync(file, "utf8") + "\n\n" + AGENT_GUARDRAILS;
});

// Load meta agent system prompt
const META_PROMPT = (() => {
  const f = path.join(__dirname, "prompts", "meta_agent.md");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
})();

// Språkregler som injiceras i alla insikts-prompter
const SPRAKREGLER = `
SPRÅKREGLER — dessa är hårdare än allt annat i prompten:

Ordet "diskrepans" är förbjudet. Skriv det aldrig. Inte en gång. Inte i något fält.
Istället: beskriv vad som faktiskt händer. "Sömnen var bra men energin stannade på 4" — inte "det är en diskrepans".

Förbjudna ord och fraser (skriv aldrig):
- diskrepans
- korrelation (i text till användaren)
- data indikerar
- baserat på dina mätvärden
- systemet har identifierat
- klassisk (som i "klassisk signal", "klassiskt mönster")
- troligtvis inte slumpen

Upprepningsförbud: ett och samma ord eller en och samma fras får förekomma max en gång per svar. Inget undantag.

Flow: varje mening tar läsaren ett steg framåt. Mening 2 upprepar aldrig vad mening 1 redan sagt — den lägger till något nytt. Om du inte har något nytt att tillföra: avsluta meningen tidigare.

Ton: direkt och specifik. Inte tröstande. Inte klinisk. Skriv som om du redan vet — för det gör du.
`;

// Post-processing: ersätt förbjudna ord om de ändå slinter igenom
function sanera(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/\bdiskrepans\b/gi, "skillnad")
    .replace(/\bkorrelation\b/gi, "samband")
    .replace(/\bdata indikerar\b/gi, "det visar")
    .replace(/\bbaserat på dina mätvärden\b/gi, "")
    .replace(/\bsystemet har identifierat\b/gi, "systemet ser")
    .replace(/\btroligtvis inte slumpen\b/gi, "inte slumpmässigt");
}

function saneraParsed(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = typeof v === "string" ? sanera(v) : v;
  }
  return result;
}

// Load onboarding system prompt
const ONBOARDING_SYSTEM = (() => {
  const file = path.join(__dirname, "forsyne_agent_prompt.md");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "Du är Forsyne onboarding-intelligens. Ge personliga, specifika insikter baserade på användarens svar. Aldrig generiskt.";
})();

const app = express();

// ── SUPABASE ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── ENCRYPTION (AES-256) ──
const ENC_KEY = process.env.ENCRYPTION_KEY;

function encrypt(text) {
  if (!text || typeof text !== "string" || !ENC_KEY) return text;
  return CryptoJS.AES.encrypt(text, ENC_KEY).toString();
}

function decrypt(ciphertext) {
  if (!ciphertext || typeof ciphertext !== "string" || !ENC_KEY) return ciphertext;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENC_KEY);
    return bytes.toString(CryptoJS.enc.Utf8) || ciphertext;
  } catch { return ciphertext; }
}

// Encrypt sensitive onboarding free-text fields before DB save
function encryptProfile(data) {
  if (!data || !ENC_KEY) return data;
  const d = { ...data };
  if (d.q1_1)  d.q1_1  = encrypt(d.q1_1);   // varför de är här
  if (d.q2_11) d.q2_11 = encrypt(d.q2_11);  // vad som förändrade dem
  return d;
}

function decryptProfile(data) {
  if (!data || !ENC_KEY) return data;
  const d = { ...data };
  if (d.q1_1)  d.q1_1  = decrypt(d.q1_1);
  if (d.q2_11) d.q2_11 = decrypt(d.q2_11);
  return d;
}

// Decrypt freetext checkin fields on read
function decryptCheckin(row) {
  if (!row || !ENC_KEY) return row;
  return {
    ...row,
    reflection:      row.reflection      ? decrypt(row.reflection)      : row.reflection,
    personal_answer: row.personal_answer ? decrypt(row.personal_answer) : row.personal_answer
  };
}
function decryptCheckins(rows) { return (rows || []).map(decryptCheckin); }

// ── MULTER — in-memory only, no disk writes ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// ── FIT FILE PARSER ──
const { default: FitParser } = require('fit-file-parser');

function parseFitBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const fp = new FitParser({ force: true, mode: 'list', elapsedRecordField: false });
    fp.parse(buffer, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function toDateStr(val) {
  if (!val) return null;
  if (typeof val === 'string') return val.slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return null;
}

async function normalizeFitFiles(fileResults) {
  // fileResults: [{ name, buffer }]
  // Actual FIT structure (verified against Garmin Venu 2 Monitor files):
  //   Monitor files: data.stress[] → { stress_level_time, stress_level_value (0-100, -1=unknown), body_battery (0-100), field_two (HRV ms) }
  //   Sleep files:   data.sleep_levels[] or data.sleep_level[] → { start_time, sleep_level (0=unmeasurable,1=awake,2=light,3=deep,5=rem), event_timestamp }

  const sleepByDate    = {}; // date → summary object
  const stressByDate   = {}; // date → { stress:[], bb:[], hrv:[] }
  const activityByDate = {}; // date → [session, ...]

  for (const { name, buffer } of fileResults) {
    let data;
    try { data = await parseFitBuffer(buffer); } catch(e) { continue; }

    const lname = name.toLowerCase();
    const isSleep   = /^g[0-9a-f]/i.test(lname) || lname.includes('sleep');
    const isMonitor = /^m[0-9a-f]/i.test(lname) || lname.includes('monitor');

    // ── SLEEP FILES ──
    // G*.fit on Garmin Venu 2 only has session start/stop events — no stage data
    // Stage data (REM/deep/light) is computed server-side by Garmin and not stored locally
    if (isSleep) {
      const evts = data.events || [];
      const fid  = (data.file_ids || [])[0];
      const startEvt = evts.find(e => e.event_type === 'start');
      const stopEvt  = evts.find(e => e.event_type === 'stop_all' || e.event_type === 'stop');
      const startTs  = startEvt?.timestamp;
      const endTs    = stopEvt?.timestamp || fid?.time_created;
      if (!startTs || !endTs) continue;
      const dateKey  = toDateStr(endTs); // use wake-up date as the key
      if (!dateKey) continue;
      const total_min = Math.round((new Date(endTs) - new Date(startTs)) / 60000);
      if (total_min < 60 || total_min > 900) continue; // sanity check
      sleepByDate[dateKey] = {
        date: dateKey,
        total_min,
        deep_min:  null,
        rem_min:   null,
        light_min: null,
        awake_min: null,
        avg_hrv:   null,
        avg_spo2:  null,
      };
    }

    // ── ACTIVITY FILES ──
    const isActivity = /^\d{4}-\d{2}-\d{2}/i.test(lname) || lname.includes('activity');
    if (isActivity) {
      const sessions = data.sessions || [];
      for (const s of sessions) {
        const dateKey = toDateStr(s.start_time);
        if (!dateKey || !s.sport) continue;
        const startIso = s.start_time instanceof Date
          ? s.start_time.toISOString()
          : (typeof s.start_time === 'string' ? s.start_time : null);
        const entry = {
          date:          dateKey,
          start_time:    startIso,                            // ISO timestamp — used as dedup key for multi-session days
          sport:         s.sport || null,
          sub_sport:     s.sub_sport || null,
          name:          s.sport_profile_name || null,
          duration_min:  s.total_elapsed_time ? Math.round(s.total_elapsed_time / 60) : null,
          calories:      s.total_calories || null,
          distance_m:    s.total_distance ? Math.round(s.total_distance) : null,
          avg_hr:        s.avg_heart_rate || null,
          max_hr:        s.max_heart_rate || null,
        };
        if (!activityByDate[dateKey]) activityByDate[dateKey] = [];
        activityByDate[dateKey].push(entry);
      }
    }

    // ── MONITOR FILES ──
    // data.stress[] has stress_level_value, body_battery, and field_two (HRV) per minute
    if (isMonitor) {
      const recs = data.stress || [];
      for (const rec of recs) {
        const ts = rec.stress_level_time || rec.timestamp;
        if (!ts) continue;
        const d = toDateStr(ts);
        if (!d) continue;
        if (!stressByDate[d]) stressByDate[d] = { stress: [], bb: [], hrv: [] };

        const sv = rec.stress_level_value ?? null;
        if (sv != null && sv >= 0 && sv <= 100) stressByDate[d].stress.push(sv);

        const bb = rec.body_battery ?? null;
        if (bb != null && bb >= 0 && bb <= 100) stressByDate[d].bb.push(bb);

        // field_two appears to be HRV in ms (range 0-130 typical)
        const hrv = rec.field_two ?? null;
        if (hrv != null && hrv > 0 && hrv <= 250) stressByDate[d].hrv.push(hrv);
      }
    }
  }

  // Aggregate monitor data per day
  const stress = [], hrv = [], body_battery = [];
  for (const [date, d] of Object.entries(stressByDate)) {
    const mean = arr => arr.length ? Math.round(arr.reduce((s,v)=>s+v,0)/arr.length) : null;

    if (d.stress.length) {
      stress.push({
        date,
        avg_stress:      mean(d.stress),
        max_stress:      Math.max(...d.stress),
        high_stress_min: Math.round(d.stress.filter(v=>v>75).length),
        rest_stress_min: Math.round(d.stress.filter(v=>v<=25).length),
      });
    }
    if (d.bb.length) {
      body_battery.push({
        date,
        start_of_day: d.bb[0],
        end_of_day:   d.bb[d.bb.length - 1],
        charged:      Math.max(...d.bb),
        drained:      Math.max(...d.bb) - Math.min(...d.bb),
      });
    }
    if (d.hrv.length) {
      hrv.push({ date, avg_hrv: mean(d.hrv) });
    }
  }

  // Inject sleep HRV from monitor data where available
  const hrvMap = Object.fromEntries(hrv.map(r => [r.date, r.avg_hrv]));
  const sleep  = Object.values(sleepByDate).map(r => ({ ...r, avg_hrv: r.avg_hrv || hrvMap[r.date] || null }));

  // Flatten activities to array sorted by date desc
  const activities = Object.values(activityByDate).flat().sort((a,b) => b.date.localeCompare(a.date));

  const last7 = arr => [...arr].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,7);
  const mean7 = (arr, f) => { const v=arr.map(r=>r[f]).filter(x=>x!=null); return v.length ? Math.round(v.reduce((s,x)=>s+x,0)/v.length) : null; };

  const s7=last7(sleep), st7=last7(stress), h7=last7(hrv), b7=last7(body_battery);

  return {
    _source: 'garmin_fit',
    _type:   'wearable',
    _updated: new Date().toISOString(),
    sleep, stress, hrv, body_battery, activities,
    avg_sleep_7d:        mean7(s7,  'total_min'),
    avg_deep_sleep_7d:   mean7(s7,  'deep_min'),
    avg_hrv_7d:          mean7(h7,  'avg_hrv'),
    avg_stress_7d:       mean7(st7, 'avg_stress'),
    latest_body_battery: b7[0]?.end_of_day || b7[0]?.charged || null,
    latest_hrv:          h7[0]?.avg_hrv    || null,
    latest_sleep_min:    s7[0]?.total_min  || null,
    latest_activity:     activities[0]     || null,
  };
}

// ── RATE LIMITERS ──
const authLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "För många förfrågningar. Försök igen om en minut." }
});

const journalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "För många journal-uppladdningar. Försök igen om en timme." }
});

const checkinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "För många check-ins. Försök igen om en timme." }
});

const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "För många anmälningar från denna IP." }
});

// ── MIDDLEWARE ──
// Security headers via helmet.
// CSP disabled for now — the existing HTML files use inline <script> / <style>;
// re-enabling CSP requires adding nonces or hashes per-page. Track as tech-debt.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: "2mb" }));

// Static files with cache headers
// JS/CSS: 1 hour (revalidate on deploy via ETag)
// Images: 7 days (rarely change)
// HTML: no-cache (always fresh for auth redirects to work)
app.use(express.static(__dirname, {
  setHeaders(res, filePath) {
    if (/\.html$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(webp|png|jpg|jpeg|svg|ico|woff2?)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
    }
  }
}));

app.get("/", (req, res) => res.sendFile(__dirname + "/landing.html"));

// ── HTTPS redirect in production ──
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] !== "https" && process.env.NODE_ENV === "production") {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});

// ── AUTH MIDDLEWARE ──
async function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ingen token" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Ogiltig token" });
  req.user = { id: user.id, email: user.email };
  next();
}

// OAuth-start routes can't send Authorization header (browser redirect).
// Accept token from ?token= query param and redirect on failure instead of JSON 401.
async function authForOAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.query.token;
  if (!token) return res.redirect("/wearables.html?error=not_authenticated");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.redirect("/wearables.html?error=not_authenticated");
  req.user = { id: user.id, email: user.email };
  next();
}

// ── AUTH ROUTES ──
app.get("/api/me", authLimiter, auth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

// ── PROFILE ──
app.get("/api/profile", auth, async (req, res) => {
  const { data: p, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", req.user.id)
    .single();
  if (error && error.code !== "PGRST116") return res.status(500).json({ error: error.message });
  if (!p) return res.json(null);
  res.json({ data: decryptProfile(p.data || {}), analysis: p.analysis, created_at: p.created_at });
});

app.post("/api/profile", auth, async (req, res) => {
  const { data, analysis } = req.body;
  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: req.user.id, data: encryptProfile(data), analysis, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── CHECKINS ──
app.get("/api/checkins", auth, async (req, res) => {
  const { data: rows, error } = await supabase
    .from("checkins")
    .select("*")
    .eq("user_id", req.user.id)
    .order("date", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(decryptCheckins(rows));
});

app.get("/api/daily-data", auth, async (req, res) => {
  const { data, error } = await supabase
    .from("daily_data")
    .select("*")
    .eq("user_id", req.user.id)
    .order("date", { ascending: false })
    .limit(1)
    .single();
  if (error) return res.status(404).json({ error: "No daily data" });
  res.json(data);
});

app.post("/api/checkin", auth, checkinLimiter, async (req, res) => {
  const { date, energy, focus, stress, sleep, motivation, moods, reflection, personal_answer, analysis } = req.body;
  const { error } = await supabase
    .from("checkins")
    .upsert(
      { user_id: req.user.id, date, energy, focus, stress, sleep, motivation, moods: moods || [],
        reflection: encrypt(reflection), personal_answer: encrypt(personal_answer), analysis },
      { onConflict: "user_id,date" }
    );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── CHECKIN V2 — ONE QUESTION AT A TIME ──

app.post("/api/checkin/questions", auth, checkinLimiter, async (req, res) => {
  const { phase, goal } = req.body || {};
  // Fetch profile + recent data for Claude
  const [profileRes, checkinsRes, predRes] = await Promise.all([
    supabase.from("profiles").select("data").eq("user_id", req.user.id).single(),
    supabase.from("checkins").select("*").eq("user_id", req.user.id).order("date", { ascending: false }).limit(3),
    supabase.from("daily_data").select("*").eq("user_id", req.user.id).order("date", { ascending: false }).limit(1)
  ]);

  const profile   = decryptProfile(profileRes.data?.data || {});
  const checkins  = decryptCheckins(checkinsRes.data);
  const latestDay = predRes.data?.[0]       || null;

  const latest = checkins[0];
  const rev = [...checkins];
  let streak = 0;
  for (const c of rev) { if (c.stress >= 7 && c.sleep <= 5) streak++; else break; }
  const varselActive = streak >= 2;

  const contextMsg = `
DAGENS DATUM: ${new Date().toISOString().split("T")[0]}

ANVÄNDARENS PROFIL (urval):
Namn: ${profile.q3_1 || "Okänt"}
Motivation hit: ${profile.q1_1 || "—"}
Relation till vila: ${profile.q2_9 || "—"}
Sömnmönster: ${profile.q6_1 || "—"}
Träning: ${profile.q7_1 || "—"} pass/vecka

${latest ? `SENASTE CHECK-IN (${latest.date}):
Energi ${latest.energy}/10 · Sömn ${latest.sleep}/10 · Stress ${latest.stress}/10 · Fokus ${latest.focus}/10 · Motivation ${latest.motivation}/10
Humör: ${(latest.moods||[]).join(", ") || "—"}
Reflektion: "${latest.reflection || "—"}"` : "INGEN TIDIGARE CHECK-IN — detta är dag 1."}

${varselActive ? `⚠ VARSEL AKTIVT — Stress ≥7 och sömn ≤5 upprepade ${streak} dagar i rad.` : ""}

${latestDay ? `SENASTE DAGLIGA DATA: PSI ${latestDay.psi || "—"}` : ""}

${phase ? `AKTUELL FAS: ${phase}` : ""}${goal ? `\nMÅL: ${goal}` : ""}

Generera 3 check-in-frågor för idag. Svara EXAKT i detta JSON-format:
{
  "questions": [
    {"id": "q1", "text": "...", "type": "scale", "based_on": "kort förklaring varför just denna fråga"},
    {"id": "q2", "text": "...", "type": "yesno", "based_on": "..."},
    {"id": "q3", "text": "...", "type": "freetext", "based_on": "..."}
  ]
}

Typer: "scale" (1-5), "yesno" (ja/nej), "freetext" (fri text, alltid valfri).
Regler:
- Frågorna ska vara omöjliga att ha fått utan just den här personens data
- Direkta, konkreta frågor — inga långa meningar
- Om varsel är aktivt, inkludera minst en varsel-fråga
- Sista frågan (q3) ska alltid vara freetext
`.trim();

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: AGENTS["2"] || "Du är Forsyne dagliga check-in agent. Generera personaliserade frågor. Svara alltid i JSON.",
        messages: [{ role: "user", content: contextMsg }]
      })
    });

    const apiData = await resp.json();
    const text = apiData?.content?.[0]?.text || "";
    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      parsed = { questions: [
        { id: "q1", text: "Hur är din energinivå just nu, på en skala 1–5?", type: "scale", based_on: "Daglig kalibrering" },
        { id: "q2", text: "Sov du bra i natt?", type: "yesno", based_on: "Sömnkvalitet" },
        { id: "q3", text: "Är det något annat systemet bör veta om idag?", type: "freetext", based_on: "Fri reflektion" }
      ]};
    }

    // Always prepend fixed mood question
    if (parsed.questions) {
      parsed.questions.unshift({ id: "mood", text: "Hur är ditt humör just nu?", type: "scale", based_on: "Daglig humörskalibrering" });
    }
    // Always append fixed output-tracking questions
    if (parsed.questions) {
      parsed.questions.push(
        { id: "kognitiv_belastning", text: "Hur hög var den kognitiva belastningen idag?", type: "scale", based_on: "Output-tracking — mentalt arbete" },
        { id: "aktiv_aterhamtning",  text: "Har du haft aktiv återhämtning idag?",         type: "yesno",  based_on: "Output-tracking — återhämtning" }
      );
    }
    res.json(parsed);
  } catch(e) {
    console.error("checkin/questions error:", e);
    res.json({ questions: [
      { id: "mood", text: "Hur är ditt humör just nu?", type: "scale", based_on: "Daglig humörskalibrering" },
      { id: "q1", text: "Hur är din energinivå just nu, på en skala 1–5?", type: "scale", based_on: "Daglig kalibrering" },
      { id: "q2", text: "Sov du bra i natt?", type: "yesno", based_on: "Sömnkvalitet" },
      { id: "q3", text: "Är det något annat systemet bör veta om idag?", type: "freetext", based_on: "Fri reflektion" }
    ]});
  }
});

app.post("/api/checkin/submit", auth, checkinLimiter, async (req, res) => {
  const { answers = {} } = req.body;
  const today = new Date().toISOString().split("T")[0];

  // Map answers to structured fields (best-effort)
  const energy               = typeof answers.q1 === "number" ? answers.q1 * 2 : null; // scale 1-5 → 1-10
  const sleep                = typeof answers.q2 === "boolean" ? (answers.q2 ? 8 : 4) : null;
  const reflectionPlain      = typeof answers.q3 === "string" ? answers.q3 : null;
  const stress               = typeof answers.stress === "number" ? answers.stress : null;
  const mood                 = typeof answers.mood === "number" ? answers.mood * 2 : null; // scale 1-5 → 1-10
  const kognitiv_belastning  = typeof answers.kognitiv_belastning === "number" ? answers.kognitiv_belastning * 2 : null; // 1-5 → 2-10
  const aktiv_aterhamtning   = typeof answers.aktiv_aterhamtning === "boolean" ? answers.aktiv_aterhamtning : null;

  const { error } = await supabase
    .from("checkins")
    .upsert({
      user_id: req.user.id,
      date: today,
      energy, sleep,
      stress, focus: null, motivation: null,
      mood,
      moods: [],
      reflection:           encrypt(reflectionPlain),
      personal_answer:      encrypt(JSON.stringify(answers)),
      analysis:             null,
      kognitiv_belastning,
      aktiv_aterhamtning
    }, { onConflict: "user_id,date" });

  if (error) {
    console.error('[checkin/submit] DB error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }

  // Evaluate pending signals against this check-in (fire-and-forget)
  evaluatePendingSignals(req.user.id, today, energy, stress).catch(() => {});
  verifyConcretePredictions(req.user.id, sleep, energy).catch(() => {});

  // Trigger analysis async (fire-and-forget)
  const _base = `http://localhost:${process.env.PORT || 3000}`;
  const _auth = { "Content-Type": "application/json", "Authorization": req.headers.authorization };
  fetch(`${_base}/api/analyze`, { method: "POST", headers: _auth }).catch(() => {});

  // Auto-trigger Agent 3 (insights) + meta-agent after check-in (fire-and-forget)
  fetch(`${_base}/api/agent/insights/generate`, {
    method: "POST", headers: _auth, body: JSON.stringify({ context: "post_checkin" })
  }).catch(() => {});
  fetch(`${_base}/api/agent/meta/run`, {
    method: "POST", headers: _auth
  }).catch(() => {});

  res.json({ ok: true });
});

// ── MANUAL SLEEP LOGGING ──
// Backfill / quick log when wearable data isn't available.
// Upserts only the `sleep` column on checkins(user_id, date) — preserves
// any other fields already filled in for that day.
app.post("/api/sleep/manual", auth, checkinLimiter, async (req, res) => {
  const { date, hours } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Ogiltig date — ska vara YYYY-MM-DD" });
  }
  const h = Number(hours);
  if (!Number.isFinite(h) || h < 0.5 || h > 14) {
    return res.status(400).json({ error: "Ogiltig hours — ska vara mellan 0.5 och 14" });
  }
  const { error } = await supabase
    .from("checkins")
    .upsert({ user_id: req.user.id, date, sleep: h }, { onConflict: "user_id,date" });
  if (error) {
    console.error('[sleep/manual] DB error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

// ── MANUAL OBJECTIVE STRESS (Garmin-equivalent) ──
// Adds/replaces an entry in integrations.data.stress[] for a given date,
// tagged with _source:'manual' so it can be distinguished from FIT-imported
// data later. Agents read this same array, so the value flows naturally.
app.post("/api/stress/manual", auth, checkinLimiter, async (req, res) => {
  const { date, avg_stress, max_stress } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Ogiltig date — ska vara YYYY-MM-DD" });
  }
  const avg = Number(avg_stress);
  if (!Number.isFinite(avg) || avg < 0 || avg > 100) {
    return res.status(400).json({ error: "Ogiltig avg_stress — ska vara 0-100" });
  }
  const max = max_stress != null ? Number(max_stress) : null;

  const { data: existing } = await supabase
    .from("integrations").select("data")
    .eq("user_id", req.user.id).eq("provider", "garmin").single();

  const prevData = existing?.data || {};
  const prevStress = prevData.stress || [];
  const newEntry = {
    date,
    avg_stress: Math.round(avg),
    max_stress: (max != null && max >= 0 && max <= 100) ? Math.round(max) : null,
    high_stress_min: null,
    rest_stress_min: null,
    _source: 'manual',
  };
  const merged = prevStress.filter(s => s.date !== date);
  merged.push(newEntry);
  merged.sort((a, b) => b.date.localeCompare(a.date));

  const { error } = await supabase
    .from("integrations")
    .upsert({
      user_id: req.user.id, provider: "garmin",
      data: { ...prevData, stress: merged },
      last_synced: new Date().toISOString(),
    }, { onConflict: "user_id,provider" });

  if (error) {
    console.error('[stress/manual] DB error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

// ── SUBJECTIVE STRESS (how it FELT — same path as a check-in field) ──
// Upserts only the `stress` column on checkins(user_id, date).
app.post("/api/stress/subjective", auth, checkinLimiter, async (req, res) => {
  const { date, score } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Ogiltig date — ska vara YYYY-MM-DD" });
  }
  const s = Number(score);
  if (!Number.isFinite(s) || s < 1 || s > 10) {
    return res.status(400).json({ error: "Ogiltig score — ska vara 1-10" });
  }
  const { error } = await supabase
    .from("checkins")
    .upsert({ user_id: req.user.id, date, stress: s }, { onConflict: "user_id,date" });
  if (error) {
    console.error('[stress/subjective] DB error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

// ── SUBJECTIVE ENERGY (how it FELT) ──
// Upserts only the `energy` column on checkins(user_id, date).
app.post("/api/energy/subjective", auth, checkinLimiter, async (req, res) => {
  const { date, score } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Ogiltig date — ska vara YYYY-MM-DD" });
  }
  const s = Number(score);
  if (!Number.isFinite(s) || s < 1 || s > 10) {
    return res.status(400).json({ error: "Ogiltig score — ska vara 1-10" });
  }
  const { error } = await supabase
    .from("checkins")
    .upsert({ user_id: req.user.id, date, energy: s }, { onConflict: "user_id,date" });
  if (error) {
    console.error('[energy/subjective] DB error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

// ── MANUAL RESTING HR (Garmin-equivalent) ──
// Adds/replaces an entry in integrations.data.resting_hr[] for a given date.
// Resting HR is one of the highest-signal recovery markers — drops when
// well-recovered, rises with stress, illness, or under-recovery.
app.post("/api/resting-hr/manual", auth, checkinLimiter, async (req, res) => {
  const { date, bpm } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Ogiltig date — ska vara YYYY-MM-DD" });
  }
  const v = Number(bpm);
  if (!Number.isFinite(v) || v < 30 || v > 150) {
    return res.status(400).json({ error: "Ogiltig bpm — ska vara 30-150" });
  }

  const { data: existing } = await supabase
    .from("integrations").select("data")
    .eq("user_id", req.user.id).eq("provider", "garmin").single();

  const prevData = existing?.data || {};
  const prevRHR = prevData.resting_hr || [];
  const newEntry = { date, bpm: Math.round(v), _source: 'manual' };
  const merged = prevRHR.filter(r => r.date !== date);
  merged.push(newEntry);
  merged.sort((a, b) => b.date.localeCompare(a.date));

  const { error } = await supabase
    .from("integrations")
    .upsert({
      user_id: req.user.id, provider: "garmin",
      data: { ...prevData, resting_hr: merged },
      last_synced: new Date().toISOString(),
    }, { onConflict: "user_id,provider" });

  if (error) {
    console.error('[resting-hr/manual] DB error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

// ── MANUAL BODY BATTERY (Garmin-equivalent) ──
// Adds/replaces an entry in integrations.data.body_battery[] for a given
// date. Expects start_of_day (morning) and optionally end_of_day (evening)
// values, both 0-100.
app.post("/api/body-battery/manual", auth, checkinLimiter, async (req, res) => {
  const { date, start_of_day, end_of_day } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Ogiltig date — ska vara YYYY-MM-DD" });
  }
  const start = Number(start_of_day);
  if (!Number.isFinite(start) || start < 0 || start > 100) {
    return res.status(400).json({ error: "Ogiltig start_of_day — ska vara 0-100" });
  }
  const end = end_of_day != null && end_of_day !== '' ? Number(end_of_day) : null;
  if (end != null && (!Number.isFinite(end) || end < 0 || end > 100)) {
    return res.status(400).json({ error: "Ogiltig end_of_day — ska vara 0-100" });
  }

  const { data: existing } = await supabase
    .from("integrations").select("data")
    .eq("user_id", req.user.id).eq("provider", "garmin").single();

  const prevData = existing?.data || {};
  const prevBB = prevData.body_battery || [];

  const charged = end != null ? Math.max(start, end) : start;
  const drained = end != null ? Math.max(0, start - end) : null;
  const newEntry = {
    date,
    start_of_day: Math.round(start),
    end_of_day: end != null ? Math.round(end) : null,
    charged: Math.round(charged),
    drained: drained != null ? Math.round(drained) : null,
    _source: 'manual',
  };
  const merged = prevBB.filter(b => b.date !== date);
  merged.push(newEntry);
  merged.sort((a, b) => b.date.localeCompare(a.date));

  const { error } = await supabase
    .from("integrations")
    .upsert({
      user_id: req.user.id, provider: "garmin",
      data: { ...prevData, body_battery: merged },
      last_synced: new Date().toISOString(),
    }, { onConflict: "user_id,provider" });

  if (error) {
    console.error('[body-battery/manual] DB error:', JSON.stringify(error));
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

// ── CONVERSATIONS ──
app.get("/api/conversations/:agentId", auth, async (req, res) => {
  const { data: row } = await supabase
    .from("conversations")
    .select("messages")
    .eq("user_id", req.user.id)
    .eq("agent_id", req.params.agentId)
    .single();
  res.json(row?.messages || []);
});

app.post("/api/conversations/:agentId", auth, async (req, res) => {
  const { messages } = req.body;
  const { error } = await supabase
    .from("conversations")
    .upsert(
      { user_id: req.user.id, agent_id: req.params.agentId, messages, updated_at: new Date().toISOString() },
      { onConflict: "user_id,agent_id" }
    );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.get("/api/conversations", auth, async (req, res) => {
  const { data: rows } = await supabase
    .from("conversations")
    .select("agent_id, messages")
    .eq("user_id", req.user.id);
  const result = {};
  (rows || []).forEach(r => { result[r.agent_id] = r.messages || []; });
  res.json(result);
});

// ── WELCOME EMAIL ──
app.post("/api/send-welcome", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Ogiltig e-post" });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: "Email ej konfigurerat" });

  const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const appUrl = process.env.APP_URL && process.env.APP_URL !== "http://localhost:3000"
    ? process.env.APP_URL
    : `${proto}://${req.headers.host}`;

  const html = `<!DOCTYPE html>
<html lang="sv"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0F1210;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:300;color:#F2F0EA;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0F1210;">
  <tr><td align="center" style="padding:60px 20px;">
    <table width="540" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;width:100%;">
      <tr><td style="padding-bottom:48px;text-align:center;">
        <span style="font-family:Georgia,serif;font-size:15px;font-weight:400;letter-spacing:0.22em;color:#F2F0EA;text-transform:uppercase;">Forsyne</span>
      </td></tr>
      <tr><td style="padding-bottom:48px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:1px;background:rgba(242,240,234,0.06);font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
      <tr><td style="padding-bottom:24px;">
        <span style="font-family:Georgia,serif;font-size:32px;font-weight:300;line-height:1.2;color:#F2F0EA;display:block;">Välkommen.</span>
        <span style="font-family:Georgia,serif;font-size:32px;font-weight:300;font-style:italic;line-height:1.2;color:#CCC9BF;display:block;">Modellen börjar nu.</span>
      </td></tr>
      <tr><td style="padding-bottom:40px;">
        <p style="font-size:14px;color:#8A8E89;line-height:1.85;margin:0;font-weight:300;">
          Ditt konto är skapat. Onboardingen tar 15–20 minuter och bygger din personliga modell —
          inte baserat på genomsnitt, utan på hur just du fungerar.
        </p>
      </td></tr>
      <tr><td style="padding-bottom:40px;">
        <table cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#D6CFC0;">
          <a href="${appUrl}/onboarding.html" style="display:inline-block;padding:14px 40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:#0F1210;text-decoration:none;white-space:nowrap;">Starta onboarding</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding-bottom:48px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:1px;background:rgba(242,240,234,0.06);font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
      <tr><td style="padding-bottom:12px;text-align:center;">
        <p style="font-size:11px;color:#5B7FA6;line-height:1.8;margin:0;">Din data är krypterad, privat och tillhör bara dig. · Forsyne säljer aldrig data.</p>
      </td></tr>
      <tr><td style="text-align:center;">
        <p style="font-size:10px;color:#4a4e49;line-height:1.8;margin:0;">© 2026 Forsyne</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Forsyne <briefing@forsyne.se>",
        to: email,
        subject: "Välkommen till Forsyne",
        html
      })
    });
    const d = await r.json();
    if (d.id) return res.json({ ok: true });
    return res.status(500).json({ error: d.message || "Kunde inte skicka mail" });
  } catch (e) {
    return res.status(500).json({ error: "Serverfel vid mailutskick" });
  }
});

// ── JOURNAL ──

app.get("/api/journal", auth, async (req, res) => {
  const { data: rows, error } = await supabase
    .from("journal_entries")
    .select("id, name, date, insight, created_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(rows || []);
});

app.post("/api/journal/upload", auth, journalLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Ingen fil uppladdad" });

  let text = "";
  try {
    if (req.file.mimetype === "application/pdf") {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text?.slice(0, 8000) || "";
    } else {
      text = req.file.buffer.toString("utf8").slice(0, 8000);
    }
  } catch(e) {
    text = "";
  }

  let insight = null;
  if (text.length > 50) {
    try {
      const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 150,
          system: "Du är Forsyne journal-analysator. Läs journaltexten och lyft den mest intressanta psykologiska eller beteendemässiga observationen i 1–2 meningar. Direkt, ärlig ton. Aldrig generisk.",
          messages: [{ role: "user", content: `JOURNAL:\n${text}\n\nLyft den viktigaste observationen i 1–2 meningar.` }]
        })
      });
      const aiData = await aiResp.json();
      insight = aiData?.content?.[0]?.text?.trim() || null;
    } catch(e) { /* insight stays null */ }
  }

  const { data: row, error } = await supabase
    .from("journal_entries")
    .insert({
      user_id: req.user.id,
      name: req.file.originalname,
      date: new Date().toISOString().split("T")[0],
      content: encrypt(text),
      insight,
      created_at: new Date().toISOString()
    })
    .select("id, name, date, insight")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, id: row.id, name: row.name, date: row.date, insight: row.insight });
});

app.delete("/api/journal/:id", auth, async (req, res) => {
  const { error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", req.params.id)
    .eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  AGENT 6 — BLODPROVER & HORMONER
// ════════════════════════════════════════════════════════

app.post("/api/blood/upload", auth, journalLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Ingen fil uppladdad" });

  let text = "";
  try {
    if (req.file.mimetype === "application/pdf") {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text?.slice(0, 12000) || "";
    } else {
      text = req.file.buffer.toString("utf8").slice(0, 12000);
    }
  } catch(e) { text = ""; }

  if (text.length < 30) return res.status(400).json({ error: "Kunde inte läsa filen — kontrollera att den innehåller text." });

  // Fetch user context for the agent
  const { data: profileRow } = await supabase.from("profiles").select("data").eq("user_id", req.user.id).single();
  const profile = profileRow?.data || {};
  const { data: recentCheckins } = await supabase.from("checkins").select("date,energy,sleep,stress").eq("user_id", req.user.id).order("date", { ascending: false }).limit(7);
  const { data: intRows } = await supabase.from("integrations").select("provider,data").eq("user_id", req.user.id);
  const intMap = {};
  (intRows || []).forEach(i => { intMap[i.provider] = i.data || {}; });

  const avg7 = f => recentCheckins?.length ? (recentCheckins.reduce((s,x)=>s+(x[f]||0),0)/recentCheckins.length).toFixed(1) : "—";

  const contextMsg = `
BLODPROVSTEXT:
${text}

ANVÄNDARPROFIL:
Namn: ${profile.q3_1 || "—"} · Ålder: ${profile.q3_2 || "—"} · Kön: ${profile.q3_3 || "—"}
Träningsnivå: ${profile.q7_1 || "—"}

SENASTE 7 DAGARS CHECK-INS (snitt):
Energi: ${avg7('energy')}/10 · Sömn: ${avg7('sleep')}/10 · Stress: ${avg7('stress')}/10

${intMap.dexcom?.avg_glucose_7d ? `DEXCOM: Glukossnitt 7d: ${intMap.dexcom.avg_glucose_7d} mg/dL · Tid i målzon 7d: ${intMap.dexcom.time_in_range_7d}%` : ""}
${intMap.garmin?.avg_hrv_7d ? `GARMIN: HRV snitt 7d: ${intMap.garmin.avg_hrv_7d} ms · Stress snitt 7d: ${intMap.garmin.avg_stress_7d}` : ""}
${intMap.dna?.nyckelinsikter ? `DNA-INSIKTER: ${intMap.dna.nyckelinsikter.join(" · ")}` : ""}

Analysera blodprovet och returnera EXAKT i JSON-formatet från din instruktion. Inga kommentarer utanför JSON.`.trim();

  try {
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: (AGENTS["6"] || "Du är Forsyne blodprovsagent. Analysera biomarkörer och returnera strukturerad JSON.") + "\n\n" + SPRAKREGLER,
        messages: [{ role: "user", content: contextMsg }]
      })
    });
    const aiData = await aiResp.json();
    const txt = aiData?.content?.[0]?.text || "";
    let parsed;
    try { const m = txt.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : txt); }
    catch { return res.status(500).json({ error: "Kunde inte tolka blodprovssvaret — försök igen." }); }

    // Store in integrations table
    const { data: existing } = await supabase.from("integrations").select("data").eq("user_id", req.user.id).eq("provider", "blood_labs").single();
    const history = existing?.data?.historik || [];
    history.unshift({ ...parsed, _filename: req.file.originalname });

    await supabase.from("integrations").upsert({
      user_id:     req.user.id,
      provider:    "blood_labs",
      data:        { latest: parsed, historik: history.slice(0, 10), _filename: req.file.originalname },
      last_synced: new Date().toISOString()
    }, { onConflict: "user_id,provider" });

    res.json({ ok: true, analysis: parsed });
  } catch(e) {
    console.error("[blood/upload]", e.message);
    res.status(500).json({ error: "Analysfel — försök igen." });
  }
});

app.get("/api/blood/latest", auth, async (req, res) => {
  const { data } = await supabase.from("integrations").select("data, last_synced").eq("user_id", req.user.id).eq("provider", "blood_labs").single();
  res.json(data || null);
});

app.delete("/api/blood/disconnect",      auth, async (req, res) => { await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "blood_labs");      res.json({ ok: true }); });
app.delete("/api/blood_labs/disconnect", auth, async (req, res) => { await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "blood_labs");      res.json({ ok: true }); });

// ════════════════════════════════════════════════════════
//  AGENT 7 — DNA & GENETIK
// ════════════════════════════════════════════════════════

app.post("/api/dna/upload", auth, journalLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Ingen fil uppladdad" });

  let text = "";
  try {
    // 23andMe / AncestryDNA raw data — plain text, can be large
    text = req.file.buffer.toString("utf8").slice(0, 20000);
  } catch(e) { return res.status(400).json({ error: "Kunde inte läsa filen." }); }

  if (text.length < 100) return res.status(400).json({ error: "Filen verkar tom eller ogiltig." });

  const { data: profileRow } = await supabase.from("profiles").select("data").eq("user_id", req.user.id).single();
  const profile = profileRow?.data || {};
  const { data: intRows } = await supabase.from("integrations").select("provider,data").eq("user_id", req.user.id);
  const intMap = {};
  (intRows || []).forEach(i => { intMap[i.provider] = i.data || {}; });

  // Extract only SNP lines (lines starting with rs)
  const snpLines = text.split("\n").filter(l => l.trim().startsWith("rs")).slice(0, 500);
  const snpSample = snpLines.join("\n");

  const contextMsg = `
RAW DNA-DATA (urval av SNPs):
${snpSample}

ANVÄNDARPROFIL:
Ålder: ${profile.q3_2 || "—"} · Kön: ${profile.q3_3 || "—"}
Träningsnivå: ${profile.q7_1 || "—"}
Stresshantering: ${profile.q2_6 || "—"}
Sömnmönster: ${profile.q6_1 || "—"}

${intMap.blood_labs?.latest?.nyckelobservationer ? `BLODPROVER: ${intMap.blood_labs.latest.nyckelobservationer.join(" · ")}` : ""}

Analysera de genetiska varianterna och returnera EXAKT i JSON-formatet från din instruktion.`.trim();

  try {
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: AGENTS["7"] || "Du är Forsyne DNA-agent. Analysera genetiska varianter och returnera strukturerad JSON.",
        messages: [{ role: "user", content: contextMsg }]
      })
    });
    const aiData = await aiResp.json();
    const txt = aiData?.content?.[0]?.text || "";
    let parsed;
    try { const m = txt.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : txt); }
    catch { return res.status(500).json({ error: "Kunde inte tolka DNA-analysen." }); }

    await supabase.from("integrations").upsert({
      user_id:     req.user.id,
      provider:    "dna",
      data:        { ...parsed, _filename: req.file.originalname },
      last_synced: new Date().toISOString()
    }, { onConflict: "user_id,provider" });

    res.json({ ok: true, analysis: parsed });
  } catch(e) {
    console.error("[dna/upload]", e.message);
    res.status(500).json({ error: "Analysfel — försök igen." });
  }
});

app.get("/api/dna/latest", auth, async (req, res) => {
  const { data } = await supabase.from("integrations").select("data, last_synced").eq("user_id", req.user.id).eq("provider", "dna").single();
  res.json(data || null);
});

app.delete("/api/dna/disconnect", auth, async (req, res) => {
  await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "dna");
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  AGENT 8 — KOST & NÄRING
// ════════════════════════════════════════════════════════

app.post("/api/nutrition/upload", auth, journalLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Ingen fil uppladdad" });

  let text = "";
  try {
    if (req.file.mimetype === "application/pdf") {
      const p = await pdfParse(req.file.buffer);
      text = p.text?.slice(0, 12000) || "";
    } else {
      text = req.file.buffer.toString("utf8").slice(0, 12000);
    }
  } catch(e) { return res.status(400).json({ error: "Kunde inte läsa filen." }); }

  const { data: profileRow } = await supabase.from("profiles").select("data").eq("user_id", req.user.id).single();
  const profile = profileRow?.data || {};
  const { data: recentCheckins } = await supabase.from("checkins").select("date,energy,sleep,stress").eq("user_id", req.user.id).order("date", { ascending: false }).limit(14);
  const { data: intRows } = await supabase.from("integrations").select("provider,data").eq("user_id", req.user.id);
  const intMap = {};
  (intRows || []).forEach(i => { intMap[i.provider] = i.data || {}; });

  const avg14 = f => recentCheckins?.length ? (recentCheckins.reduce((s,x)=>s+(x[f]||0),0)/recentCheckins.length).toFixed(1) : "—";

  const contextMsg = `
KOSTDATA:
${text}

ANVÄNDARPROFIL:
Ålder: ${profile.q3_2 || "—"} · Kön: ${profile.q3_3 || "—"} · Vikt: ${profile.q3_weight || "—"} kg
Träningsnivå: ${profile.q7_1 || "—"} · Träningsmål: ${profile._training_goal || "—"}
Kostpreferenser: ${profile.q8_1 || "—"}

14-DAGARSSNITT CHECK-INS:
Energi: ${avg14('energy')}/10 · Sömn: ${avg14('sleep')}/10 · Stress: ${avg14('stress')}/10

${intMap.dexcom?.avg_glucose_7d ? `DEXCOM: Glukossnitt 7d: ${intMap.dexcom.avg_glucose_7d} mg/dL · Tid i målzon: ${intMap.dexcom.time_in_range_7d}%` : ""}
${intMap.strava?.training_load_7d ? `STRAVA: Träningsbelastning 7d: ${intMap.strava.training_load_7d}` : ""}
${intMap.blood_labs?.latest?.nyckelobservationer ? `BLODPROVER: ${intMap.blood_labs.latest.nyckelobservationer.join(" · ")}` : ""}
${intMap.dna?.kostimplikationer ? `DNA-KOSTINSIKTER: ${intMap.dna.kostimplikationer.join(" · ")}` : ""}

Analysera kostmönstret och returnera EXAKT i JSON-formatet från din instruktion.`.trim();

  try {
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: (AGENTS["8"] || "Du är Forsyne kostagent. Analysera kostmönster och returnera strukturerad JSON.") + "\n\n" + SPRAKREGLER,
        messages: [{ role: "user", content: contextMsg }]
      })
    });
    const aiData = await aiResp.json();
    const txt = aiData?.content?.[0]?.text || "";
    let parsed;
    try { const m = txt.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : txt); }
    catch { return res.status(500).json({ error: "Kunde inte tolka kostanalysen." }); }

    await supabase.from("integrations").upsert({
      user_id:     req.user.id,
      provider:    "nutrition",
      data:        { latest: parsed, _filename: req.file.originalname, _updated: new Date().toISOString() },
      last_synced: new Date().toISOString()
    }, { onConflict: "user_id,provider" });

    res.json({ ok: true, analysis: parsed });
  } catch(e) {
    console.error("[nutrition/upload]", e.message);
    res.status(500).json({ error: "Analysfel — försök igen." });
  }
});

app.get("/api/nutrition/latest", auth, async (req, res) => {
  const { data } = await supabase.from("integrations").select("data, last_synced").eq("user_id", req.user.id).eq("provider", "nutrition").single();
  res.json(data || null);
});

app.delete("/api/nutrition/disconnect", auth, async (req, res) => {
  await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "nutrition");
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  AGENT 10 — LÄKARJOURNAL (uppgraderad)
// ════════════════════════════════════════════════════════

// Upgraded journal upload — now uses Agent 10 for deep extraction
app.post("/api/journal/analyze", auth, journalLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Ingen fil uppladdad" });

  let text = "";
  try {
    if (req.file.mimetype === "application/pdf") {
      const p = await pdfParse(req.file.buffer);
      text = p.text?.slice(0, 12000) || "";
    } else {
      text = req.file.buffer.toString("utf8").slice(0, 12000);
    }
  } catch(e) { return res.status(400).json({ error: "Kunde inte läsa filen." }); }

  const { data: profileRow } = await supabase.from("profiles").select("data").eq("user_id", req.user.id).single();
  const profile = profileRow?.data || {};
  const { data: recentCheckins } = await supabase.from("checkins").select("date,energy,sleep,stress").eq("user_id", req.user.id).order("date", { ascending: false }).limit(7);
  const avg7 = f => recentCheckins?.length ? (recentCheckins.reduce((s,x)=>s+(x[f]||0),0)/recentCheckins.length).toFixed(1) : "—";

  const contextMsg = `
JOURNALTEXT:
${text}

ANVÄNDARPROFIL:
Ålder: ${profile.q3_2 || "—"} · Kön: ${profile.q3_3 || "—"}

SENASTE 7 DAGARS SNITT:
Energi: ${avg7('energy')}/10 · Sömn: ${avg7('sleep')}/10 · Stress: ${avg7('stress')}/10

Analysera journalen och returnera EXAKT i JSON-formatet från din instruktion.`.trim();

  try {
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: AGENTS["10"] || "Du är Forsyne journalagent. Extrahera medicinsk kontext och returnera strukturerad JSON.",
        messages: [{ role: "user", content: contextMsg }]
      })
    });
    const aiData = await aiResp.json();
    const txt = aiData?.content?.[0]?.text || "";
    let parsed;
    try { const m = txt.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : txt); }
    catch { return res.status(500).json({ error: "Kunde inte tolka journalanalysen." }); }

    // Store structured analysis in integrations + raw (encrypted) in journal_entries
    await supabase.from("integrations").upsert({
      user_id:     req.user.id,
      provider:    "medical_journal",
      data:        { latest: parsed, _filename: req.file.originalname, _updated: new Date().toISOString() },
      last_synced: new Date().toISOString()
    }, { onConflict: "user_id,provider" });

    // Also store raw encrypted entry in journal_entries for history
    await supabase.from("journal_entries").insert({
      user_id:    req.user.id,
      name:       req.file.originalname,
      date:       new Date().toISOString().split("T")[0],
      content:    encrypt(text),
      insight:    parsed.systemkontext || null,
      created_at: new Date().toISOString()
    });

    res.json({ ok: true, analysis: parsed });
  } catch(e) {
    console.error("[journal/analyze]", e.message);
    res.status(500).json({ error: "Analysfel — försök igen." });
  }
});

app.get("/api/journal/medical-context", auth, async (req, res) => {
  const { data } = await supabase.from("integrations").select("data, last_synced").eq("user_id", req.user.id).eq("provider", "medical_journal").single();
  res.json(data || null);
});

app.delete("/api/journal/medical-context",     auth, async (req, res) => { await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "medical_journal"); res.json({ ok: true }); });
app.delete("/api/medical_journal/disconnect", auth, async (req, res) => { await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "medical_journal"); res.json({ ok: true }); });

app.get("/api/waitlist", auth, async (req, res) => {
  const { data: list } = await supabase
    .from("waitlist")
    .select("email, created_at")
    .order("created_at", { ascending: false });
  res.json(list || []);
});

// ── INTEGRATIONS ──
app.get("/api/integrations", auth, async (req, res) => {
  const { data: rows } = await supabase
    .from("integrations")
    .select("provider, last_synced, data")
    .eq("user_id", req.user.id);
  res.json(rows || []);
});

app.post("/api/integrations/:provider", auth, async (req, res) => {
  const { provider } = req.params;
  const { access_token, refresh_token, token_expires, data } = req.body;
  const allowed = ["oura", "garmin", "dexcom", "whoop", "apple_health", "manual"];
  if (!allowed.includes(provider)) return res.status(400).json({ error: "Okänd provider" });
  const { error } = await supabase
    .from("integrations")
    .upsert(
      { user_id: req.user.id, provider, access_token, refresh_token: refresh_token || null, token_expires: token_expires || null, data: data || {}, last_synced: new Date().toISOString() },
      { onConflict: "user_id,provider" }
    );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, provider });
});

app.delete("/api/integrations/:provider", auth, async (req, res) => {
  await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", req.params.provider);
  res.json({ ok: true });
});

app.post("/api/integrations/:provider/data", auth, async (req, res) => {
  const { provider } = req.params;
  const { data } = req.body;
  const { error } = await supabase
    .from("integrations")
    .update({ data, last_synced: new Date().toISOString() })
    .eq("user_id", req.user.id)
    .eq("provider", provider);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Note: All provider OAuth is handled by Terra (/auth/terra/:provider + /api/terra/webhook).
// Direct provider callbacks removed.

// ── BLOCK INSIGHT ──
const BLOCK_NAMES = {
  1: "Varför du är här",
  2: "Psykologi & energi",
  3: "Vem du är",
  4: "Vardag & liv",
  5: "Miljö & dygnsrytm",
  6: "Sömn & återhämtning",
  7: "Träning & rörelse",
  8: "Kost & näring",
  9: "Hormoner & biologi",
  10: "Din externa plan"
};

app.post("/api/block-insight", async (req, res) => {
  const { block, answers = {}, profile = {} } = req.body;
  if (!block) return res.status(400).json({ error: "block krävs" });

  let userMsg;

  if (block === "final") {
    // ── VÄLKOMSTINSIKT — hela onboardingen summerad ──
    const name    = answers.q3_1 || profile.name || "du";
    const axel1   = profile.axel1 || answers.q1_1 || "";
    const profType = profile.current || "";

    // Bygg ett komprimerat snapshot av de viktigaste signalerna
    const signals = [
      answers.q2_1  && `Kronotyp: ${answers.q2_1}`,
      answers.q6_1  && `Sömn: ${answers.q6_1}`,
      answers.q6_2  && `Vaknar utvilad: ${answers.q6_2}`,
      answers.q4_7  && `Livsstatus: ${answers.q4_7}`,
      answers.q7_1  && `Träning: ${answers.q7_1} pass/vecka`,
      answers.q7_3  && `Träningsintensitet: ${answers.q7_3}/10`,
      answers.q8_4  && `Kaffe: ${answers.q8_4}`,
      answers.q2_9  && `Relation till vila: ${answers.q2_9}`,
      answers.q2_10 && `Trend senaste året: ${answers.q2_10}`,
      answers.q9_1  && `Oförklarliga energivariationer: ${answers.q9_1}`,
      answers.q1_4  && `Varför det inte höll tidigare: "${answers.q1_4}"`,
      answers.q4_8  && `Primär energitjuv: "${answers.q4_8}"`
    ].filter(Boolean).join("\n");

    userMsg = `
VÄLKOMSTINSIKT — hela onboardingen

NAMN: ${name}
PROFIL-TYP: ${profType}
AXEL 1 — Vad som förde dem hit: "${axel1}"

NYCKEL-SIGNALER FRÅN ALLA BLOCK:
${signals || "Begränsad data."}

Skriv en välkomstinsikt på 2–3 meningar direkt till ${name}.
Regler:
- Börja med namnet
- Referera till axel1-svaret — det är anledningen de är här
- Lyft den mest anmärkningsvärda observationen från hela onboardingen — något de känner igen men aldrig satt ord på
- Ärlig, direkt ton — aldrig generisk, aldrig tröstande
- Avsluta med att signalera vad systemet börjar med
- Inga rubriker, inga citattecken runt texten, bara texten
`.trim();

  } else {
    // ── BLOCK-CLOSE — specifikt block ──
    const blockName = BLOCK_NAMES[block] || `Block ${block}`;

    const answersText = Object.entries(answers)
      .filter(([k, v]) => k.startsWith(`q${block}_`) && v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\n");

    const profileCtx = [
      answers.q3_1 && `Namn: ${answers.q3_1}`,
      answers.q3_2 && `Ålder: ${answers.q3_2}`,
      answers.q3_3 && `Kön: ${answers.q3_3}`
    ].filter(Boolean).join(" · ");

    if (!answersText) {
      return res.json({ observation: null, hypotes: null, flagga: null });
    }

    userMsg = `
BLOCK ${block} — ${blockName}

SVAR FRÅN DETTA BLOCK:
${answersText}
${profileCtx ? `\nPROFIL: ${profileCtx}` : ""}

Skriv en block-close text på 2–3 meningar direkt till användaren.
Regler:
- Referera till ett specifikt svar eller mönster från just dessa svar — inget som kan gälla vem som helst
- Du-form, ärlig ton — inte tröstande, inte coachig
- Signalera vad systemet nu förstår bättre om den här personen
- Inga rubriker, inga citattecken, bara texten
`.trim();
  }

  console.log("[block-insight] input:", { block, answersLength: (userMsg || "").length });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: ONBOARDING_SYSTEM,
        messages: [{ role: "user", content: userMsg }]
      })
    });

    const data = await response.json();
    const raw  = data?.content?.[0]?.text?.trim();
    console.log("[block-insight] output:", raw?.substring(0, 100));
    if (!raw) return res.status(500).json({ error: "Ingen insikt genererades" });

    // Försök parsa som JSON (agenten kan returnera { observation: null, ... })
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.observation === null) {
        return res.json({ observation: null, hypotes: null, flagga: null });
      }
      return res.json({ insight: raw }); // JSON men inte null-format — returnera som text
    } catch {
      // Inte JSON — returnera som fri text (bakåtkompatibelt)
      res.json({ insight: raw });
    }
  } catch(e) {
    console.error("Block insight error:", e);
    res.status(500).json({ error: "Insikten kunde inte genereras" });
  }
});

// ── AGENT 2 — DAGLIG CHECK-IN ──
app.post("/api/agent/checkin/generate", auth, async (req, res) => {
  const { checkins = [], profile = {} } = req.body;

  const recent   = checkins.slice(-7);
  const latest   = recent[recent.length - 1];
  const n        = checkins.length;
  const avg      = f => recent.length ? (recent.reduce((s,x) => s + (x[f]||0), 0) / recent.length).toFixed(1) : "—";

  const rev = [...recent].reverse();
  let streak = 0;
  for (const c of rev) { if (c.stress >= 7 && c.sleep <= 5) streak++; else break; }
  const varselActive = streak >= 2;

  const last3 = recent.slice(-3), prev3 = recent.slice(-6,-3);
  const energyTrend = last3.length && prev3.length
    ? (last3.reduce((s,x)=>s+x.energy,0)/last3.length) - (prev3.reduce((s,x)=>s+x.energy,0)/prev3.length)
    : 0;

  const today = new Date().toISOString().split("T")[0];

  // Fetch all integration data for this user
  const { data: integrations } = await supabase
    .from("integrations")
    .select("provider, data, last_synced")
    .eq("user_id", req.user.id);

  const intMap = {};
  (integrations || []).forEach(i => { intMap[i.provider] = i.data || {}; });

  // Format specialist agent contexts
  const blood = intMap.blood_labs?.latest;
  const bloodCtx = blood?.nyckelobservationer ? `
BLODPROVER & HORMONER (Agent 6):
${blood.nyckelobservationer.join("\n")}
Mönsterkoppling: ${blood.mönsterkoppling || "—"}
Check-in-frågor: ${blood.check_in_frågor?.join(" · ") || "—"}` : "";

  const dna = intMap.dna;
  const dnaCtx = dna?.nyckelinsikter ? `
DNA & GENETIK (Agent 7):
${dna.nyckelinsikter.join("\n")}` : "";

  const nutrition = intMap.nutrition?.latest;
  const nutritionCtx = nutrition?.sammanfattning ? `
KOST & NÄRING (Agent 8):
${nutrition.sammanfattning}
${nutrition.prioriterade_åtgärder?.[0] ? `Prioritet: ${nutrition.prioriterade_åtgärder[0].åtgärd}` : ""}` : "";

  const journal = intMap.medical_journal?.latest;
  const journalCtx = journal?.systemkontext ? `
MEDICINSK KONTEXT (Agent 10):
${journal.systemkontext}
${journal.aktiva_tillstånd?.length ? `Aktiva tillstånd: ${journal.aktiva_tillstånd.map(t=>t.tillstånd).join(", ")}` : ""}` : "";

  // Format Garmin context
  const gm = intMap.garmin;
  const garminCtx = gm?.avg_sleep_7d || gm?.avg_hrv_7d ? `
GARMIN (WEARABLE):
Sömn senaste natt: ${gm.latest_sleep_min ? Math.floor(gm.latest_sleep_min/60)+'h '+((gm.latest_sleep_min||0)%60)+'m' : "—"} · Djupsömn: ${gm.latest_deep_min ? Math.floor(gm.latest_deep_min/60)+'h '+((gm.latest_deep_min||0)%60)+'m' : "—"}
HRV senaste natt: ${gm.latest_hrv || "—"} ms · Snitt 7d: ${gm.avg_hrv_7d || "—"} ms
Body Battery: ${gm.latest_body_battery || "—"} · Stress snitt 7d: ${gm.avg_stress_7d || "—"}
Sömnsnitt 7d: ${gm.avg_sleep_7d ? Math.floor(gm.avg_sleep_7d/60)+'h '+((gm.avg_sleep_7d||0)%60)+'m' : "—"} · Djupsömn snitt 7d: ${gm.avg_deep_sleep_7d ? Math.floor(gm.avg_deep_sleep_7d/60)+'h '+((gm.avg_deep_sleep_7d||0)%60)+'m' : "—"}` : "";

  // Format Dexcom context
  const dx = intMap.dexcom;
  const dexcomCtx = dx?.latest_glucose ? `
DEXCOM (CGM):
Senaste glukos: ${dx.latest_glucose.value} mg/dL · Trend: ${dx.latest_glucose.trend || "—"} · Tid: ${dx.latest_glucose.time ? new Date(dx.latest_glucose.time).toLocaleTimeString("sv-SE", {hour:"2-digit",minute:"2-digit"}) : "—"}
Snitt 24h: ${dx.avg_glucose_24h || "—"} mg/dL · Snitt 7d: ${dx.avg_glucose_7d || "—"} mg/dL
Tid i målzon (70–180): ${dx.time_in_range_24h != null ? dx.time_in_range_24h + "% (24h)" : "—"} · ${dx.time_in_range_7d != null ? dx.time_in_range_7d + "% (7d)" : "—"}
Variabilitet (CV): ${dx.cv_24h != null ? dx.cv_24h + "% (24h)" : "—"}` : "";

  // Format Strava context
  const st = intMap.strava;
  const stravaCtx = st?.training_load_7d != null ? `
STRAVA (TRÄNING):
Träningsbelastning 7d: ${st.training_load_7d} · Aktiviteter 7d: ${st.activities_7d || 0}
Snittspuls 7d: ${st.avg_heartrate_7d || "—"} bpm
${st.latest_activity ? `Senaste aktivitet: ${st.latest_activity.name} (${st.latest_activity.type}) ${st.latest_activity.date} — ${st.latest_activity.distance_km || "—"}km · ${st.latest_activity.duration_min || "—"}min · ${st.latest_activity.avg_hr || "—"} bpm` : ""}` : "";

  // Format Cronometer context
  const cr = intMap.cronometer;
  const cronometerCtx = cr?.avg_7d ? `
CRONOMETER (MIKRONÄRINGSÄMNEN — snitt 7d):
Energi: ${cr.avg_7d.energy_kcal || "—"} kcal · Protein: ${cr.avg_7d.protein_g || "—"}g · Kolhydrater: ${cr.avg_7d.carbs_g || "—"}g · Fett: ${cr.avg_7d.fat_g || "—"}g · Fiber: ${cr.avg_7d.fiber_g || "—"}g
Magnesium: ${cr.avg_7d.magnesium_mg || "—"} mg · Järn: ${cr.avg_7d.iron_mg || "—"} mg · Zink: ${cr.avg_7d.zinc_mg || "—"} mg
Vitamin D: ${cr.avg_7d.vitamin_d_iu || "—"} IU · B12: ${cr.avg_7d.vitamin_b12_ug || "—"} µg · Omega-3: ${cr.avg_7d.omega3_g || "—"}g
Data från: ${cr.date_range?.from || "—"} till ${cr.date_range?.to || "—"} (${cr.total_days || 0} dagar)` : "";

  const contextMsg = `
IDAG: ${today}
DAGAR MED DATA: ${n}

${latest ? `SENASTE CHECK-IN (${latest.date}):
Energi ${latest.energy}/10 · Sömn ${latest.sleep}/10 · Stress ${latest.stress}/10 · Fokus ${latest.focus}/10 · Motivation ${latest.motivation}/10
Reflektion: "${latest.reflection || "—"}"
Personligt svar: "${latest.personal_answer || "—"}"` : "INGEN TIDIGARE CHECK-IN — detta är dag 1."}

7-DAGARSSNITT: Energi ${avg('energy')} · Sömn ${avg('sleep')} · Stress ${avg('stress')} · Fokus ${avg('focus')} · Motivation ${avg('motivation')}
ENERGITREND: ${energyTrend > 0.5 ? "↑ Stigande" : energyTrend < -0.5 ? "↓ Sjunkande" : "→ Stabil"}

${varselActive ? `⚠ VARSEL AKTIVT — Dag ${streak} av 7. Stress ≥7 och sömn ≤5 har upprepats ${streak} dagar i rad.` : "Inget aktivt varsel."}
${garminCtx}${dexcomCtx}${stravaCtx}${cronometerCtx}${bloodCtx}${dnaCtx}${nutritionCtx}${journalCtx}
PROFIL (onboarding-urval):
Namn: ${profile.q3_1 || "Okänt"} · Ålder: ${profile.q3_2 || "—"} · Kön: ${profile.q3_3 || "—"}
Motivation till förändring: ${profile.q1_1 || "—"}
Energimönster: ${profile.q2_1 || "—"}
Sömnmönster: ${profile.q6_1 || "—"}
Träningsnivå: ${profile.q7_1 || "—"}
${(()=>{const c=profile.q11_1||profile.q3_6;const list=Array.isArray(c)?c.filter(x=>x!=='Inget av ovanstående'):(c?[c]:[]);const parts=[];if(list.length)parts.push(`Kroniska tillstånd: ${list.join(', ')}`);if(profile.q11_2==='Ja'&&profile.q11_3)parts.push(`Mediciner: ${profile.q11_3}`);else if(profile.q11_2==='Ja')parts.push('Tar mediciner regelbundet');const seasonal=profile.q11_5;if(seasonal&&seasonal!=='Inte relevant')parts.push(`Mönster: ${seasonal}`);if(profile.q11_4&&profile.q11_4!=='Påverkar inte den dagliga funktionen')parts.push(`Påverkan dagligen: ${profile.q11_4}`);return parts.join(' · ');})()}

Generera check-in för idag. Svara EXAKT i detta JSON-format, inget annat:
{
  "öppning": "En mening. Observationen som sätter kontexten. Baserad på den mest relevanta signalen.",
  "frågor": [
    {"id": 1, "fråga": "...", "kategori": "biologisk|beteende|psykologisk|mönster|varsel|positiv"},
    {"id": 2, "fråga": "...", "kategori": "..."},
    {"id": 3, "fråga": "...", "kategori": "..."}
  ],
  "avslutning": "En mening. Framåtlutad bekräftelse."
}`.trim();

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: AGENTS["2"] || "Du är Forsyne dagliga check-in agent. Generera en personaliserad check-in baserad på användarens data. Svara alltid i JSON.",
        messages: [{ role: "user", content: contextMsg }]
      })
    });

    const data = await response.json();
    const text = data?.content?.[0]?.text || "";

    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      parsed = {
        öppning: latest
          ? (varselActive ? `Varslet är fortfarande aktivt. Dag ${streak}.`
            : latest.stress >= 7 ? "Stressen var hög igår. Vi kollar in."
            : latest.sleep <= 5 ? "Sömnen var kort igår natt."
            : latest.energy >= 8 ? "Systemet ser starkt ut idag."
            : "En ny dag. Systemet lyssnar.")
          : "Första check-in. Systemet börjar lära sig.",
        frågor: [
          { id: 1, fråga: "Vad är det första du märker av i kroppen idag?", kategori: "biologisk" },
          { id: 2, fråga: "Vad fick mest av din energi igår?", kategori: "beteende" },
          { id: 3, fråga: "Finns det något som väger tungt just nu som inte syns i siffrorna?", kategori: "psykologisk" }
        ],
        avslutning: "Systemet uppdaterar din modell nu."
      };
    }

    res.json(parsed);
  } catch(e) {
    console.error("Agent 2 error:", e);
    res.status(500).json({ error: "Agenten svarade inte" });
  }
});

// ── AGENT 3 — INSIKTS-AGENTEN ──
app.post("/api/agent/insights/generate", auth, async (req, res) => {
  const { checkins = [], profile = {}, context = "dashboard" } = req.body;

  const n = checkins.length;
  if (n === 0) return res.json({ insikt: null, sammanfattning: null, rekommendation: null });

  // ── Hämta integrationsdata en gång — används i alla paths ──
  const { data: _intRows } = await supabase
    .from("integrations").select("provider, data").eq("user_id", req.user.id);
  const _int = {};
  (_intRows || []).forEach(i => { _int[i.provider] = i.data || {}; });
  const _gm = _int.garmin || {};
  const _bl = _int.blood_labs?.latest || {};
  const _dn = _int.dna || {};
  const _dx = _int.dexcom || {};
  const _cr = _int.cronometer || {};
  const _st = _int.strava || {};
  const _bioAll = [
    _gm.avg_sleep_7d ? `Garmin sömn 7d: ${Math.floor(_gm.avg_sleep_7d/60)}h ${_gm.avg_sleep_7d%60}m · HRV 7d: ${_gm.avg_hrv_7d||'—'} ms · Body Battery: ${_gm.latest_body_battery||'—'} · Stress 7d: ${_gm.avg_stress_7d||'—'}` : "",
    _dx.latest_glucose ? `CGM: ${_dx.latest_glucose.value} mg/dL · Tid i målzon 24h: ${_dx.time_in_range_24h != null ? _dx.time_in_range_24h+'%' : '—'}` : "",
    _bl.nyckelobservationer?.length ? `Blodprover: ${_bl.nyckelobservationer.slice(0,3).join(' · ')}` : "",
    _dn.nyckelinsikter?.length ? `DNA: ${_dn.nyckelinsikter.slice(0,2).join(' · ')}` : "",
    _cr.avg_7d ? `Kost 7d: ${_cr.avg_7d.energy_kcal||'—'} kcal · Magnesium ${_cr.avg_7d.magnesium_mg||'—'} mg · Vitamin D ${_cr.avg_7d.vitamin_d_iu||'—'} IU` : "",
    _st.training_load_7d != null ? `Strava belastning 7d: ${_st.training_load_7d} · Aktiviteter: ${_st.activities_7d||0}` : "",
  ].filter(Boolean).join("\n");

  // ── PÅSTÅENDE-KONTEXT ──
  if (context.endsWith('_paastående')) {
    const kategori = context.replace('_paastående', '');
    const recent = checkins.slice(-14);
    const latest = checkins[checkins.length - 1];
    const avg = (arr, f) => arr.length ? (arr.reduce((s,x) => s + (x[f]||0), 0) / arr.length).toFixed(1) : "—";

    const paasMsg = `
KATEGORI: ${kategori}
IDAG: ${new Date().toISOString().split("T")[0]}
ANTAL CHECK-INS: ${n}

SENASTE CHECK-IN (${latest.date}):
Energi ${latest.energy}/10 · Sömn ${latest.sleep}/10 · Stress ${latest.stress}/10 · Fokus ${latest.focus}/10 · Motivation ${latest.motivation}/10

14-DAGARSDATA:
Energi snitt ${avg(recent,'energy')} · Sömn snitt ${avg(recent,'sleep')} · Stress snitt ${avg(recent,'stress')}
${_bioAll ? `\nOBJEKTIV DATA:\n${_bioAll}` : ""}

Generera ETT påstående baserat på användarens ${kategori}-data. Regler:
- Max 20 ord
- Specifikt för den här personens data — omöjligt att ha fått utan just dessa siffror
- Börjar med "Du" eller "Din" eller "Ditt"
- Möjligt att bekräfta eller dementera
- Aldrig generiskt

Returnera EXAKT detta JSON: { "paastående": "string" }`.trim();

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 150,
          system: "Du är Forsyne valideringsagent. Du genererar precisa påståenden baserade på en persons biometriska data. Svara alltid i JSON.\n\n" + SPRAKREGLER,
          messages: [{ role: "user", content: paasMsg }]
        })
      });
      const d = await resp.json();
      const txt = d?.content?.[0]?.text || "";
      let parsed;
      try { const m = txt.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : txt); } catch { parsed = {}; }
      return res.json({ paastående: sanera(parsed.paastående || null) });
    } catch(e) {
      return res.json({ paastående: null });
    }
  }

  // ── REKOMMENDATION-KONTEXT ──
  if (context.endsWith('_rekommendation')) {
    const kategori = context.replace('_rekommendation', '');
    const recent   = checkins.slice(-14);
    const latest14 = checkins[checkins.length - 1];
    const avg14    = (f) => recent.length ? (recent.reduce((s,x) => s + (x[f]||0), 0) / recent.length).toFixed(1) : "—";

    const rekMsg = `
KATEGORI: ${kategori}
IDAG: ${new Date().toISOString().split("T")[0]}
ANTAL CHECK-INS: ${n}

SENASTE CHECK-IN (${latest14.date}):
Energi ${latest14.energy}/10 · Sömn ${latest14.sleep}/10 · Stress ${latest14.stress}/10 · Fokus ${latest14.focus}/10 · Motivation ${latest14.motivation}/10

14-DAGARSSNITT:
Energi ${avg14('energy')} · Sömn ${avg14('sleep')} · Stress ${avg14('stress')} · Fokus ${avg14('focus')} · Motivation ${avg14('motivation')}
${_bioAll ? `\nOBJEKTIV DATA:\n${_bioAll}\n` : ""}
PROFIL:
Namn: ${profile.q3_1 || 'Okänt'} · Ålder: ${profile.q3_2 || '—'} · Kön: ${profile.q3_3 || '—'}
Primärt mål: ${profile.q1_6 || '—'} · Vill förstå: ${profile.q1_7 || '—'}
Kronotyp: ${profile._kronotyp || profile.q2_kronotyp || profile.q2_1 || '—'}
Sömnmål: ${profile._sleep_goal || profile.q6_sleep_goal || '—'} · Faktisk sömn: ${profile.q6_1 || '—'}
Koffein: ${profile._caffeine || '—'} · Alkohol: ${profile._alcohol || '—'}
Stresshantering: ${profile.q2_6 || '—'}
Träningsmål: ${profile._training_goal || '—'} · Träningsnivå: ${profile.q7_1 || '—'}
${(() => { const c = profile.q3_6 || profile.chronic_conditions; const list = Array.isArray(c) ? c.filter(x => x !== 'Inget av ovanstående') : (c ? [c] : []); const parts = []; if (list.length) parts.push(`Kroniska/återkommande tillstånd: ${list.join(', ')}`); if (profile.q3_6_seasonal && profile.q3_6_seasonal !== 'Inga tillstånd att tala om' && profile.q3_6_seasonal !== 'Nej, det är konstant') parts.push(`Säsongsmönster: ${profile.q3_6_seasonal}`); if (profile.q3_6_other) parts.push(`Övrigt: ${profile.q3_6_other}`); return parts.join(' · '); })()}

Generera 2–3 konkreta nästa steg för ${kategori} baserade på den här personens faktiska data.
Regler:
- Varje steg är omöjligt att ha fått utan just dessa siffror — inget generiskt
- Aldrig repeterar mönster som redan nämnts i insikten — detta är ACTION
- Åtgärd = en mening, specifik och direkt
- Varför = kopplar åtgärden till ett konkret datavärde från ovan
- Frågan ska hjälpa systemet förstå hindret — omöjlig att ställa utan personens data

Returnera EXAKT detta JSON:
{
  "steg": [
    { "atgard": "Konkret åtgärd — en mening.", "varfor": "Varför — direkt kopplat till ett värde från din data." },
    { "atgard": "...", "varfor": "..." }
  ],
  "fraga": "En fördjupad fråga som hjälper systemet förstå hindret."
}`.trim();

    const FALLBACKS = {
      sleep:     { steg: [{ atgard: 'Flytta läggdags 45 minuter tidigare tre dagar i rad.', varfor: 'Ditt sömnsnitt är under återhämtningströskeln — varje kvarttimme räknas.' }, { atgard: 'Undvik koffein efter 14:00 denna vecka.', varfor: 'Sen koffein förlänger insomningstiden när stressen redan är hög.' }], fraga: 'Vad hindrar dig från att komma i säng tidigare — stress, vanor eller något annat?' },
      energy:    { steg: [{ atgard: 'Skydda 30–45 minuter efter lunch som lågkravstid.', varfor: 'Ditt energifall på eftermiddagen är konsekvent — använd det, bekämpa det inte.' }, { atgard: 'Reservera morgonens första timme för ditt viktigaste arbete.', varfor: 'Energin är som högst på morgonen enligt ditt mönster.' }], fraga: 'Vad tar mest av din energi under en normal dag — och är det värt kostnaden?' },
      stress:    { steg: [{ atgard: 'Sätt ett hårt stopp för arbete kl 19:00 tre kvällar i rad.', varfor: 'Kvällsstress är ditt starkaste och mest återkommande mönster.' }, { atgard: 'Lägg in 10 minuter ostrukturerad tid varje förmiddag.', varfor: 'Systemet ser ingen återhämtningsbuffert i dina högsträcksdagar.' }], fraga: 'Vad triggar mest stress just nu — och har du faktisk kontroll över det?' },
      training:  { steg: [{ atgard: 'Lägg in en aktiv vilodag efter din nästa intensiva träning.', varfor: 'Träning utan inbyggd återhämtning bryter ner mer än det bygger upp.' }, { atgard: 'Minska intensiteten med 20% nästa vecka och logga återhämtningen.', varfor: 'Systemet ser tecken på ackumulerad trötthet i dina energivärden.' }], fraga: 'Vad får dig att träna hårdare än planerat — prestation, stress eller något annat?' },
      nutrition: { steg: [{ atgard: 'Ät ett proteinrikt frukost de nästa tre dagarna och notera energin.', varfor: 'Ditt förmiddagsmönster tyder på instabilt blodsocker.' }, { atgard: 'Undvik att hoppa över en måltid de närmaste sju dagarna.', varfor: 'Oregelbundna måltider förstärker din återkommande energidal.' }], fraga: 'Vilken måltid är svårast att prioritera — och varför?' },
    };
    const fb = FALLBACKS[kategori] || { steg: [{ atgard: 'Fokusera på ett konkret steg idag.', varfor: 'Baserat på ditt aktuella mönster.' }], fraga: 'Vad är det viktigaste du kan förändra just nu?' };

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 600,
          system: (AGENTS["3"] || "Du är Forsyne insikts-agent. Generera konkreta, personliga nästa steg baserade på biologiska mönster. Svara alltid i JSON.") + "\n\n" + SPRAKREGLER,
          messages: [{ role: "user", content: rekMsg }]
        })
      });
      const d = await resp.json();
      const txt = d?.content?.[0]?.text || "";
      let parsed;
      try { const m = txt.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : txt); } catch { parsed = {}; }
      return res.json({ steg: parsed.steg || fb.steg, fraga: parsed.fraga || fb.fraga });
    } catch(e) {
      return res.json(fb);
    }
  }

  const recent7  = checkins.slice(-7);
  const recent30 = checkins.slice(-30);
  const latest   = checkins[checkins.length - 1];

  const avg = (arr, f) => arr.length ? (arr.reduce((s,x) => s + (x[f]||0), 0) / arr.length).toFixed(1) : "—";
  const pct = (arr, fn) => arr.length ? Math.round(arr.filter(fn).length / arr.length * 100) : 0;

  // Alias redan hämtad integrationsdata (hämtades i toppen av handlern)
  const int3 = _int;
  const dx3 = _dx;
  const st3 = _st;
  const garminCtx3 = int3.garmin?.avg_hrv_7d || int3.garmin?.avg_sleep_7d ? `\nGARMIN:\nHRV senaste natt: ${int3.garmin.latest_hrv || "—"} ms · Snitt 7d: ${int3.garmin.avg_hrv_7d || "—"} ms\nBody Battery: ${int3.garmin.latest_body_battery || "—"} · Stress snitt 7d: ${int3.garmin.avg_stress_7d || "—"}\nSömn senaste natt: ${int3.garmin.latest_sleep_min ? Math.floor(int3.garmin.latest_sleep_min/60)+'h '+((int3.garmin.latest_sleep_min||0)%60)+'m' : "—"} · Djupsömn snitt 7d: ${int3.garmin.avg_deep_sleep_7d ? Math.floor(int3.garmin.avg_deep_sleep_7d/60)+'h' : "—"}` : "";
  const blood3  = int3.blood_labs?.latest;
  const bloodCtx3 = blood3?.nyckelobservationer ? `\nBLODPROVER:\n${blood3.nyckelobservationer.join("\n")}\nMönsterkoppling: ${blood3.mönsterkoppling || "—"}` : "";
  const dnaCtx3 = int3.dna?.nyckelinsikter ? `\nDNA: ${int3.dna.nyckelinsikter.join(" · ")}` : "";
  const nutritionCtx3 = int3.nutrition?.latest?.sammanfattning ? `\nKOST: ${int3.nutrition.latest.sammanfattning}` : "";
  const journalCtx3 = int3.medical_journal?.latest?.systemkontext ? `\nMEDICINSK KONTEXT: ${int3.medical_journal.latest.systemkontext}` : "";
  const dexcomCtx3 = dx3?.latest_glucose ? `\nDEXCOM (CGM):\nSenaste glukos: ${dx3.latest_glucose.value} mg/dL · Trend: ${dx3.latest_glucose.trend || "—"}\nSnitt 24h: ${dx3.avg_glucose_24h || "—"} mg/dL · Tid i målzon 24h: ${dx3.time_in_range_24h != null ? dx3.time_in_range_24h+"%" : "—"} · Tid i målzon 7d: ${dx3.time_in_range_7d != null ? dx3.time_in_range_7d+"%" : "—"}\nVariabilitet (CV) 24h: ${dx3.cv_24h != null ? dx3.cv_24h+"%" : "—"}` : "";
  const stravaCtx3 = st3?.training_load_7d != null ? `\nSTRAVA (TRÄNING):\nBelastning 7d: ${st3.training_load_7d} · Aktiviteter 7d: ${st3.activities_7d || 0} · Snittspuls 7d: ${st3.avg_heartrate_7d || "—"} bpm\n${st3.latest_activity ? `Senaste: ${st3.latest_activity.name} (${st3.latest_activity.type}) ${st3.latest_activity.date} — ${st3.latest_activity.distance_km || "—"}km · ${st3.latest_activity.avg_hr || "—"} bpm` : ""}` : "";
  const cr3 = int3.cronometer;
  const cronometerCtx3 = cr3?.avg_7d ? `\nCRONOMETER (MIKRONÄRINGSÄMNEN snitt 7d):\nEnergi: ${cr3.avg_7d.energy_kcal||"—"} kcal · Protein: ${cr3.avg_7d.protein_g||"—"}g · Kolhydrater: ${cr3.avg_7d.carbs_g||"—"}g · Fett: ${cr3.avg_7d.fat_g||"—"}g\nMagnesium: ${cr3.avg_7d.magnesium_mg||"—"} mg · Järn: ${cr3.avg_7d.iron_mg||"—"} mg · Vitamin D: ${cr3.avg_7d.vitamin_d_iu||"—"} IU · B12: ${cr3.avg_7d.vitamin_b12_ug||"—"} µg · Omega-3: ${cr3.avg_7d.omega3_g||"—"}g` : "";

  // Hämta lärdomar från misslyckade valideringar — injiceras i prompten
  const { data: _failedVals } = await supabase
    .from("validations")
    .select("kategori, vad_missades, larda_notering")
    .eq("user_id", req.user.id)
    .eq("svar", "stämmer inte")
    .not("larda_notering", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const laerdaCtx3 = (_failedVals || []).length
    ? `\nLÄRDAR MÖNSTER — påståenden som inte stämde (undvik liknande felslut):\n${(_failedVals || []).map(v => `- ${v.kategori}: ${v.vad_missades || v.larda_notering}`).join('\n')}`
    : "";

  const avgStress7   = parseFloat(avg(recent7, 'stress'));
  const avgSleep7    = parseFloat(avg(recent7, 'sleep'));
  const avgEnergy7   = parseFloat(avg(recent7, 'energy'));
  const avgFocus7    = parseFloat(avg(recent7, 'focus'));
  const avgMotiv7    = parseFloat(avg(recent7, 'motivation'));

  const prev7 = checkins.slice(-14, -7);
  const energyTrend  = prev7.length ? (parseFloat(avg(recent7,'energy')) - parseFloat(avg(prev7,'energy'))).toFixed(1) : "—";
  const sleepTrend   = prev7.length ? (parseFloat(avg(recent7,'sleep'))  - parseFloat(avg(prev7,'sleep'))).toFixed(1)  : "—";
  const stressTrend  = prev7.length ? (parseFloat(avg(recent7,'stress')) - parseFloat(avg(prev7,'stress'))).toFixed(1) : "—";

  const moodCount = {};
  recent7.forEach(c => (c.moods || []).forEach(m => { moodCount[m] = (moodCount[m]||0)+1; }));
  const topMoods = Object.entries(moodCount).sort((a,b) => b[1]-a[1]).slice(0,3).map(([m])=>m);

  const rev = [...recent7].reverse();
  let varselStreak = 0;
  for (const c of rev) { if (c.stress >= 7 && c.sleep <= 5) varselStreak++; else break; }

  const reflections = recent7.filter(c => c.reflection).slice(-3).map(c => `"${c.reflection}"`).join(" / ");

  const contextMsg = `
KONTEXT: ${context}
IDAG: ${new Date().toISOString().split("T")[0]}
ANTAL CHECK-INS TOTALT: ${n}

SENASTE CHECK-IN (${latest.date}):
Energi ${latest.energy}/10 · Sömn ${latest.sleep}/10 · Stress ${latest.stress}/10 · Fokus ${latest.focus}/10 · Motivation ${latest.motivation}/10

7-DAGARSSNITT:
Energi ${avg(recent7,'energy')} · Sömn ${avg(recent7,'sleep')} · Stress ${avg(recent7,'stress')} · Fokus ${avg(recent7,'focus')} · Motivation ${avg(recent7,'motivation')}

TRENDER (sista 7 vs föregående 7):
Energi ${energyTrend > 0 ? '+' : ''}${energyTrend} · Sömn ${sleepTrend > 0 ? '+' : ''}${sleepTrend} · Stress ${stressTrend > 0 ? '+' : ''}${stressTrend}

VANLIGASTE KÄNSLOR: ${topMoods.join(', ') || '—'}
VARSEL-STREAK: ${varselStreak > 0 ? `${varselStreak} dagar (stress≥7 + sömn≤5)` : 'Ingen aktiv'}

SENASTE REFLEKTIONER: ${reflections || '—'}
${garminCtx3}${dexcomCtx3}${stravaCtx3}${cronometerCtx3}${bloodCtx3}${dnaCtx3}${nutritionCtx3}${journalCtx3}${laerdaCtx3}
PROFIL:
Namn: ${profile.q3_1 || 'Okänt'} · Ålder: ${profile.q3_2 || '—'} · Kön: ${profile.q3_3 || '—'}
Profiltyp: ${profile._profile || '—'}
Primärt mål: ${profile.q1_6 || '—'}
Vill förstå: ${profile.q1_7 || '—'}
Kronotyp: ${profile._kronotyp || profile.q2_kronotyp || profile.q2_1 || '—'}
Vaknar: ${profile.q2_wake_time || '—'} · Lägger sig: ${profile.q2_sleep_time || '—'}
Sömnmål: ${profile.q6_sleep_goal || profile._sleep_goal || '—'}
Stresshantering: ${profile.q2_6 || '—'}
Relation till vila: ${profile.q2_9 || '—'}
Koffein: ${profile._caffeine || profile.q6_caffeine || '—'}
Alkohol: ${profile._alcohol || profile.q6_alcohol || '—'}
Träningsmål: ${profile._training_goal || profile.q7_training_goal || '—'}
Livssituation: ${profile.q4_1 || '—'}
${(()=>{const c=profile.q11_1||profile.q3_6||profile.chronic_conditions;const list=Array.isArray(c)?c.filter(x=>x!=='Inget av ovanstående'):(c?[c]:[]);const parts=[];if(list.length)parts.push(`Kroniska tillstånd: ${list.join(', ')}`);if(profile.q11_2==='Ja'&&profile.q11_3)parts.push(`Mediciner: ${profile.q11_3}`);else if(profile.q11_2==='Ja')parts.push('Tar mediciner regelbundet');const seasonal=profile.q11_5||profile.q3_6_seasonal;if(seasonal&&!['Inte relevant','Inga tillstånd att tala om','Nej, det är konstant'].includes(seasonal))parts.push(`Säsongsmönster: ${seasonal}`);if(profile.q11_4&&profile.q11_4!=='Påverkar inte den dagliga funktionen')parts.push(`Påverkan dagligen: ${profile.q11_4}`);return parts.join(' · ');})()}}

Generera insikter för kontexten "${context}". Svara EXAKT i detta JSON-format:
{
  "insikt": "2–3 meningar. Varje mening rör sig framåt — aldrig en upprepning av föregående. Personlig och specifik.",
  "sammanfattning": "1 mening. Kortversion av nuläget — utan förbjudna ord.",
  "rekommendation": "1 konkret åtgärd baserad på mönstret just nu.",
  "styrka": "1 mening. Något äkta och positivt baserat på datan."
}`.trim();

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: (AGENTS["3"] || "Du är Forsyne insikts-agent. Din uppgift är att översätta biologiska och beteendemässiga mönster till personliga, exakta insikter på svenska. Svara alltid i JSON.") + "\n\n" + SPRAKREGLER,
        messages: [{ role: "user", content: contextMsg }]
      })
    });

    const data = await response.json();
    const text = data?.content?.[0]?.text || "";

    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      const isLow = avgEnergy7 < 5 || avgSleep7 < 5;
      const isHigh = avgStress7 >= 7;
      parsed = {
        insikt: isHigh && isLow
          ? `Hög stress och kort sömn de senaste ${recent7.length} dagarna — kroppen är inte i balans.`
          : isLow
          ? `Energi och sömn har legat under ditt normala. Kroppen signalerar något.`
          : `Dina senaste ${n} incheckningar visar ett stabilt mönster. Systemet lyssnar.`,
        sammanfattning: varselStreak >= 2 ? "Varsel aktivt — systemet rekommenderar återhämtning." : "Systemet är stabilt.",
        rekommendation: isHigh ? "Prioritera sömn framför prestation ikväll." : "Håll det stabila mönstret — det bygger modellen.",
        styrka: avgMotiv7 >= 6 ? "Din motivation har hållit sig stark trots pressen." : "Du checkar in — det är grunden allt annat vilar på."
      };
    }

    res.json(saneraParsed(parsed));
  } catch(e) {
    console.error("Agent 3 error:", e);
    res.status(500).json({ error: "Insikts-agenten svarade inte" });
  }
});

// ══════════════════════════════════════════════════════════════════
// VISION AGENT — extraherar strukturerad data från bilder
// Level 1 (foto-first): användaren skickar skärmdump/foto, vi returnerar JSON.
// Börjar starkt på Garmin och breddar till Lifesum/food/training därefter.
// ══════════════════════════════════════════════════════════════════
const visionJsonParser = express.json({ limit: "10mb" });
app.post("/api/vision/analyze", visionJsonParser, auth, async (req, res) => {
  try {
    const { image, type_hint, date_hint } = req.body || {};
    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "Missing 'image' field (base64 string or data URI)" });
    }

    // Strip data URI prefix if present (data:image/jpeg;base64,...)
    let mediaType = "image/jpeg";
    let base64 = image;
    const dataUriMatch = image.match(/^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,([\s\S]+)$/);
    if (dataUriMatch) {
      mediaType = dataUriMatch[1] === "image/jpg" ? "image/jpeg" : dataUriMatch[1];
      base64 = dataUriMatch[2].trim();
    }

    if (base64.length < 200) return res.status(400).json({ error: "Image too small to analyze" });
    if (base64.length > 10 * 1024 * 1024) return res.status(413).json({ error: "Image too large (max ~7MB)" });

    const systemPrompt = `Du är Selvitas bildanalys-agent. En användare skickar en bild. Ditt jobb:

1. Identifiera bildtypen. Möjliga värden:
   - "garmin"        : Garmin Connect-skärmdump (HRV, sömn, steg, Body Battery, stress, vilopuls, träningsbelastning)
   - "oura"          : Oura Ring-skärmdump (sömn, HRV, temperatur, aktivitet)
   - "whoop"         : Whoop-skärmdump (recovery, strain, sömn)
   - "apple_health"  : Apple Health-skärmdump
   - "lifesum"       : Lifesum-skärmdump (kalorier, makros, måltider)
   - "myfitnesspal"  : MyFitnessPal-skärmdump
   - "food_photo"    : Faktiskt foto av mat
   - "training"      : Strava/Garmin aktivitetssummering (distans, puls, kalorier)
   - "body_photo"    : Foto av en persons kropp
   - "other"         : Allt annat

2. Extrahera ALLA hälsorelevanta numeriska värden du kan läsa. Använd null för värden du inte kan läsa tydligt. GISSA ALDRIG.

3. Returnera EXAKT detta JSON (och inget annat):
{
  "type": "<en av typerna ovan>",
  "confidence": <tal 0-1>,
  "extracted": {
    "hrv_ms":          <tal eller null>,
    "body_battery":    <tal 0-100 eller null>,
    "sleep_hours":     <tal eller null>,
    "deep_sleep_min":  <tal eller null>,
    "stress_level":    <tal 0-100 eller null>,
    "resting_hr":      <tal eller null>,
    "steps":           <tal eller null>,
    "training_load":   <tal eller null>,
    "recovery_time_h": <tal eller null>,
    "kcal":            <tal eller null>,
    "protein_g":       <tal eller null>,
    "carbs_g":         <tal eller null>,
    "fat_g":           <tal eller null>,
    "meal_items":      [<strängar>] eller null,
    "activity_type":   <sträng eller null>,
    "duration_min":    <tal eller null>,
    "distance_km":     <tal eller null>,
    "avg_hr":          <tal eller null>,
    "kcal_burned":     <tal eller null>
  },
  "flags": [<strängar med osäkerheter eller noteringar>],
  "summary_sv": "<en mening i lugn observationston, t.ex. 'Garmin visar 6h 12min sömn, HRV 42 ms — under ditt snitt.'>"
}

Regler:
- Hitta aldrig på värden. Oläsbart = null.
- Om type="other", sätt extracted till {} och förklara i summary_sv.
- Inkludera inga andra nycklar än de listade.
- Returnera ENDAST JSON — ingen text före eller efter.
- Skriv summary_sv i Selvitas lugna observationella ton.`;

    const userText = type_hint
      ? `Användaren antyder att det är en "${type_hint}"-bild. Analysera och extrahera.`
      : "Analysera bilden och extrahera all relevant data.";

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 1200,
        system:     systemPrompt,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text",  text: userText }
          ]
        }]
      })
    });

    if (!anthropicResp.ok) {
      const errTxt = await anthropicResp.text();
      console.error("[vision] Claude API error:", anthropicResp.status, errTxt.slice(0, 600));
      return res.status(502).json({ error: "Vision-agenten svarade inte" });
    }

    const d = await anthropicResp.json();

    // Find the text block — Claude can return multiple content blocks
    // (thinking blocks, tool_use, etc). Iterate rather than assume index 0.
    const blocks = Array.isArray(d?.content) ? d.content : [];
    const textBlock = blocks.find(b => b && b.type === "text");
    const txt = textBlock?.text || "";

    if (!txt) {
      console.error("[vision] No text block in response. stop_reason:", d?.stop_reason,
        "block_types:", blocks.map(b => b?.type).join(","),
        "full:", JSON.stringify(d).slice(0, 800));
      return res.status(502).json({ error: "Vision-agenten returnerade tomt svar" });
    }

    let parsed = null;
    try {
      const m = txt.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : txt);
    } catch (e) {
      console.error("[vision] JSON parse failed. Raw text:", txt.slice(0, 800));
      return res.status(502).json({ error: "Vision-agenten returnerade ogiltig data" });
    }

    // Minimal shape normalization so clients always get the same keys
    if (!parsed || typeof parsed !== "object") parsed = {};
    if (!parsed.type) parsed.type = "other";
    if (typeof parsed.confidence !== "number") parsed.confidence = 0;
    if (!parsed.extracted || typeof parsed.extracted !== "object") parsed.extracted = {};
    if (!Array.isArray(parsed.flags)) parsed.flags = [];
    if (typeof parsed.summary_sv !== "string") parsed.summary_sv = "";

    // Persist to vision_events for Historik (non-fatal on failure)
    try {
      const todayUtc = new Date().toISOString().split("T")[0];
      const date = (typeof date_hint === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date_hint))
        ? date_hint
        : todayUtc;
      await supabase.from("vision_events").insert({
        user_id:    req.user.id,
        date,
        type:       parsed.type,
        extracted:  parsed.extracted,
        summary_sv: parsed.summary_sv,
        confidence: parsed.confidence,
        flags:      parsed.flags
      });
    } catch (persistErr) {
      console.error("[vision] persist failed (non-fatal):", persistErr?.message || persistErr);
    }

    res.json(parsed);
  } catch (err) {
    console.error("[vision] endpoint error:", err);
    res.status(500).json({ error: "Vision-agenten kraschade" });
  }
});

// ══════════════════════════════════════════════════════════════════
// HISTORIK — day-grouped view of all vision events
// ══════════════════════════════════════════════════════════════════
app.get("/api/history/days", auth, async (req, res) => {
  try {
    const { data: rows } = await supabase
      .from("vision_events")
      .select("date, type, extracted")
      .eq("user_id", req.user.id)
      .order("date",       { ascending: false })
      .order("created_at", { ascending: false })
      .limit(2000);

    if (!rows || rows.length === 0) return res.json([]);

    const byDate = {};
    for (const row of rows) {
      const d = row.date;
      if (!byDate[d]) {
        byDate[d] = {
          date: d,
          count: 0,
          types: new Set(),
          totals: { steps: null, kcal: 0, training_min: 0, sleep_hours: null }
        };
      }
      byDate[d].count++;
      byDate[d].types.add(row.type);

      const ex = row.extracted || {};
      if (typeof ex.steps === "number") {
        byDate[d].totals.steps = Math.max(byDate[d].totals.steps || 0, ex.steps);
      }
      if (typeof ex.kcal === "number") {
        byDate[d].totals.kcal += ex.kcal;
      }
      if (typeof ex.duration_min === "number") {
        byDate[d].totals.training_min += ex.duration_min;
      }
      if (typeof ex.sleep_hours === "number" && byDate[d].totals.sleep_hours === null) {
        // Rows are ordered DESC by created_at; first (latest) wins
        byDate[d].totals.sleep_hours = ex.sleep_hours;
      }
    }

    const result = Object.values(byDate).map(d => ({
      date:   d.date,
      count:  d.count,
      types:  Array.from(d.types),
      totals: d.totals
    }));
    res.json(result);
  } catch (err) {
    console.error("[history] /days error:", err);
    res.status(500).json({ error: "Kunde inte läsa historiken" });
  }
});

app.get("/api/history/day/:date", auth, async (req, res) => {
  try {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Ogiltigt datum" });
    }

    const { data: rows } = await supabase
      .from("vision_events")
      .select("id, date, type, extracted, summary_sv, confidence, flags, created_at")
      .eq("user_id", req.user.id)
      .eq("date", date)
      .order("created_at", { ascending: true });

    const events = rows || [];

    // Aggregate day summary
    const agg = {
      steps:        null,
      sleep_hours:  null,
      hrv_ms:       null,
      body_battery: null,
      stress_level: null,
      resting_hr:   null,
      kcal:         0,
      protein_g:    0,
      carbs_g:      0,
      fat_g:        0,
      meals_count:  0,
      training:     []
    };

    for (const e of events) {
      const ex = e.extracted || {};
      if (typeof ex.steps === "number")        agg.steps        = Math.max(agg.steps || 0, ex.steps);
      if (typeof ex.sleep_hours === "number")  agg.sleep_hours  = ex.sleep_hours;
      if (typeof ex.hrv_ms === "number")       agg.hrv_ms       = ex.hrv_ms;
      if (typeof ex.body_battery === "number") agg.body_battery = ex.body_battery;
      if (typeof ex.stress_level === "number") agg.stress_level = ex.stress_level;
      if (typeof ex.resting_hr === "number")   agg.resting_hr   = ex.resting_hr;

      if (typeof ex.kcal === "number")      { agg.kcal      += ex.kcal; agg.meals_count++; }
      if (typeof ex.protein_g === "number") { agg.protein_g += ex.protein_g; }
      if (typeof ex.carbs_g === "number")   { agg.carbs_g   += ex.carbs_g; }
      if (typeof ex.fat_g === "number")     { agg.fat_g     += ex.fat_g; }

      if (ex.activity_type || typeof ex.duration_min === "number") {
        agg.training.push({
          type:         ex.activity_type || e.type,
          duration_min: typeof ex.duration_min === "number" ? ex.duration_min : null,
          distance_km:  typeof ex.distance_km  === "number" ? ex.distance_km  : null,
          avg_hr:       typeof ex.avg_hr       === "number" ? ex.avg_hr       : null,
          kcal_burned:  typeof ex.kcal_burned  === "number" ? ex.kcal_burned  : null
        });
      }
    }

    res.json({
      date,
      event_count: events.length,
      summary:     agg,
      events
    });
  } catch (err) {
    console.error("[history] /day error:", err);
    res.status(500).json({ error: "Kunde inte läsa dagen" });
  }
});

// ══════════════════════════════════════════════════════════════════
// CHAT AGENT — persistent conversation memory
// This is what Selvitas is FOR: an AI that doesn't forget tomorrow.
// Reads history from conversations table, calls Claude with real
// messages[] array, appends user+reply, upserts back.
// ══════════════════════════════════════════════════════════════════
app.post("/api/agent/chat", auth, async (req, res) => {
  try {
    const { user_message = null, kind = "message", image_summary = null } = req.body || {};
    const userId  = req.user.id;
    const agentId = "selvitas_main";

    // 1. Load existing conversation history
    const { data: convoRow } = await supabase
      .from("conversations")
      .select("messages")
      .eq("user_id", userId)
      .eq("agent_id", agentId)
      .maybeSingle();
    const history = Array.isArray(convoRow?.messages) ? convoRow.messages : [];

    // 2. Load context: profile, last 14 checkins, integrations
    const { data: profileRow } = await supabase
      .from("profiles").select("data").eq("user_id", userId).maybeSingle();
    const profile = profileRow?.data || {};

    const { data: checkinsRaw } = await supabase
      .from("checkins").select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(14);
    const checkinList = (checkinsRaw || []).slice().reverse();
    const latest = checkinList[checkinList.length - 1] || {};

    const { data: _intRows } = await supabase
      .from("integrations").select("provider, data").eq("user_id", userId);
    const _int = {};
    (_intRows || []).forEach(i => { _int[i.provider] = i.data || {}; });

    // 2b. Load today's vision events so the agent always knows what the user has shown today
    const todayDate = new Date().toISOString().split("T")[0];
    const { data: todayVisionRows } = await supabase
      .from("vision_events")
      .select("type, extracted, summary_sv")
      .eq("user_id", userId)
      .eq("date", todayDate);

    const visionToday = { rows: todayVisionRows || [] };
    const vAgg = {
      steps: null, sleep_hours: null, hrv_ms: null, body_battery: null,
      stress_level: null, resting_hr: null,
      kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meals_count: 0,
      training: []
    };
    for (const r of visionToday.rows) {
      const ex = r.extracted || {};
      if (typeof ex.steps === "number")        vAgg.steps        = Math.max(vAgg.steps || 0, ex.steps);
      if (typeof ex.sleep_hours === "number")  vAgg.sleep_hours  = ex.sleep_hours;
      if (typeof ex.hrv_ms === "number")       vAgg.hrv_ms       = ex.hrv_ms;
      if (typeof ex.body_battery === "number") vAgg.body_battery = ex.body_battery;
      if (typeof ex.stress_level === "number") vAgg.stress_level = ex.stress_level;
      if (typeof ex.resting_hr === "number")   vAgg.resting_hr   = ex.resting_hr;
      if (typeof ex.kcal === "number")      { vAgg.kcal += ex.kcal; vAgg.meals_count++; }
      if (typeof ex.protein_g === "number") { vAgg.protein_g += ex.protein_g; }
      if (typeof ex.carbs_g === "number")   { vAgg.carbs_g   += ex.carbs_g; }
      if (typeof ex.fat_g === "number")     { vAgg.fat_g     += ex.fat_g; }
      if (ex.activity_type || typeof ex.duration_min === "number") {
        vAgg.training.push({
          type: ex.activity_type || r.type,
          duration_min: ex.duration_min || null,
          distance_km: ex.distance_km || null
        });
      }
    }

    const todayLines = [];
    if (vAgg.steps)        todayLines.push(`Steg: ${vAgg.steps.toLocaleString("sv-SE")}`);
    if (vAgg.sleep_hours)  todayLines.push(`Sömn: ${vAgg.sleep_hours}h`);
    if (vAgg.hrv_ms)       todayLines.push(`HRV: ${vAgg.hrv_ms} ms`);
    if (vAgg.body_battery) todayLines.push(`Body Battery: ${vAgg.body_battery}`);
    if (vAgg.resting_hr)   todayLines.push(`Vilopuls: ${vAgg.resting_hr} bpm`);
    if (vAgg.kcal > 0) {
      const macroParts = [];
      if (vAgg.protein_g > 0) macroParts.push(`P ${Math.round(vAgg.protein_g)}g`);
      if (vAgg.carbs_g > 0)   macroParts.push(`K ${Math.round(vAgg.carbs_g)}g`);
      if (vAgg.fat_g > 0)     macroParts.push(`F ${Math.round(vAgg.fat_g)}g`);
      todayLines.push(`Kalorier: ${Math.round(vAgg.kcal)} kcal${macroParts.length ? ` (${macroParts.join(" · ")})` : ""}`);
    }
    if (vAgg.training.length) {
      todayLines.push("Träning: " + vAgg.training.map(t => {
        const meta = [];
        if (t.duration_min) meta.push(t.duration_min + " min");
        if (t.distance_km)  meta.push(t.distance_km + " km");
        return (t.type || "pass") + (meta.length ? " (" + meta.join(", ") + ")" : "");
      }).join(", "));
    }

    const visionSummariesToday = visionToday.rows.map(r => r.summary_sv).filter(Boolean);

    // 3. Build system prompt — embeds the user's current state so every reply is grounded
    const activeIntegrations = [
      _int.garmin      && "Garmin",
      _int.oura        && "Oura",
      _int.dexcom      && "Dexcom",
      _int.dna         && "DNA",
      _int.blood_labs  && "Blodprover",
      _int.strava      && "Strava",
      _int.cronometer  && "Cronometer"
    ].filter(Boolean).join(", ") || "Inga kopplade — Level 1 (chat-only)";

    const systemPrompt = `Du är Selvitas — ett system som lär sig hur just den här personen fungerar över tid. Du är INTE en generisk hälsocoach.

STIL:
- Kort. En till tre meningar när det räcker. Längre bara när situationen kräver det.
- Observation, inte föreskrift. "Din HRV har legat under 50 ms i tre dagar" — inte "vila mer".
- Grundat i PERSONENS egna siffror och mönster, aldrig genomsnitt.
- Referera tidigare konversation när det är relevant — du minns vad användaren berättat.
- Säg när du inte vet. Gissa aldrig siffror.
- Svenska, du-form, lugn och observationell ton.

BILDANALYS — VIKTIGT:
Användaren kan skicka bilder via appen (Garmin-skärmdumpar, Lifesum-summeringar, matfoton, träningsskärmar). När de gör det ser du i deras meddelande:

[Skickade en <typ>-bild]

[Bildanalys från Selvitas vision-agent]
<en mening + Extraherad data: {json med riktiga siffror}>

**Den extraherade datan ÄR bildens innehåll.** Vision-agenten har redan läst bilden åt dig och gett dig siffrorna direkt. Du ska använda dem i ditt svar som om du själv såg bilden. Läs varje värde som ett faktum från idag.

Säg ALDRIG något i stil med "jag kan inte läsa bilden", "klistra in siffrorna i text", eller "jag ser bara att du skickade en bild". Det är vision-agentens jobb och det är redan gjort. Om du svarar så är det ett allvarligt fel.

Endast om [Bildanalys]-blocket uttryckligen innehåller texten "Vision-agenten kunde inte läsa bilden tydligt" får du be användaren om hjälp — och då bara för just den bilden.

Exempel på bra svar när du får en Garmin-bild med HRV 89 ms och 14 227 steg:
"HRV 89 ms är över ditt snitt — kroppen är redo. 14 000+ steg räknas som aktiv dag men inte ett pass; du har utrymme för något strukturerat ikväll om du vill."

Exempel på bra svar när du får en Lifesum-bild med 2764 kcal / 225g protein:
"2764 kcal med 225g protein — proteinet är solitt för din muskelmassa. Kolhydraterna ligger högt; om det är en träningsdag är det rätt riktning."

KONTEXT OM ANVÄNDAREN:
${profile.q3_1 ? `Namn: ${profile.q3_1}` : ""}
${profile.q3_2 ? `Ålder: ${profile.q3_2}` : ""}
${profile.q1_1 ? `Drivkraft: ${profile.q1_1}` : ""}
${profile.q4_1 ? `Jobb: ${profile.q4_1}` : ""}
${profile.q7_1 ? `Träningsnivå: ${profile.q7_1}` : ""}
${profile.q6_1 ? `Sömnmönster: ${profile.q6_1}` : ""}

SENASTE CHECK-IN (${latest.date || "ingen"}):
${typeof latest.energy === "number" ? `Energi ${latest.energy}/10` : "Energi —"} · ${typeof latest.sleep === "number" ? `Sömn ${latest.sleep}/10` : "Sömn —"} · ${typeof latest.stress === "number" ? `Stress ${latest.stress}/10` : "Stress —"} · ${typeof latest.focus === "number" ? `Fokus ${latest.focus}/10` : "Fokus —"} · ${typeof latest.motivation === "number" ? `Motivation ${latest.motivation}/10` : "Motivation —"}

ANTAL CHECK-INS I HISTORIK: ${checkinList.length}

AKTIVA INTEGRATIONER: ${activeIntegrations}
${_int.garmin?.avg_sleep_7d ? `Garmin 7d: sömn ${Math.floor(_int.garmin.avg_sleep_7d/60)}h${_int.garmin.avg_sleep_7d%60}m · HRV ${_int.garmin.avg_hrv_7d || "—"} ms · Body Battery ${_int.garmin.latest_body_battery || "—"}` : ""}
${_int.dexcom?.latest_glucose ? `Dexcom: ${_int.dexcom.latest_glucose.value} mg/dL · Tid i mål 24h ${_int.dexcom.time_in_range_24h ?? "—"}%` : ""}

DAGENS BILDER (${visionToday.rows.length} st uppladdade idag):
${todayLines.length ? todayLines.map(l => "· " + l).join("\n") : "Inga bilder uppladdade idag än."}
${visionSummariesToday.length ? "\nVision-agentens råa observationer:\n" + visionSummariesToday.map(s => "— " + s).join("\n") : ""}

När användaren frågar om "idag", "hur ligger jag", "hur gick dagen" eller liknande — referera PRIMÄRT till DAGENS BILDER ovan. De är den senaste och mest konkreta datan du har.

Systemet minns den här personen från dag 1. Varje svar ska kännas som det kommer från en som faktiskt känner dem — inte en chatbot som precis vaknat.`;

    // 4. Convert history to Claude messages format
    const claudeMessages = [];
    for (const m of history) {
      if (!m || !m.role) continue;
      if (m.role !== "user" && m.role !== "assistant") continue;
      const content = typeof m.content === "string" ? m.content : String(m.content || "");
      if (!content) continue;
      claudeMessages.push({ role: m.role, content });
    }

    // 5. Build current turn
    let newUserContent = "";
    let persistUserMessage = true;

    if (kind === "chat_greeting") {
      // Sentinel: system-generated opener. Don't persist this as a user message.
      newUserContent = "[Systemmarkör: användaren öppnade just chatten. Skriv en kort öppningsmening, en till två meningar, grundad i senaste check-in och aktuella integrationer. Visa att du minns dem.]";
      persistUserMessage = false;
    } else if (user_message) {
      newUserContent = user_message;
    } else {
      newUserContent = "Hej.";
    }

    if (image_summary) {
      newUserContent += "\n\n[Bildanalys från Selvitas vision-agent]\n" + image_summary;
    }

    claudeMessages.push({ role: "user", content: newUserContent });

    // 6. Call Claude
    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 700,
        system:     systemPrompt,
        messages:   claudeMessages
      })
    });

    if (!anthropicResp.ok) {
      const errTxt = await anthropicResp.text();
      console.error("[chat] Claude API error:", anthropicResp.status, errTxt.slice(0, 400));
      return res.status(502).json({ error: "Chat-agenten svarade inte" });
    }

    const d = await anthropicResp.json();
    const reply = (d?.content?.[0]?.text || "").trim();
    if (!reply) return res.status(502).json({ error: "Tomt svar från agenten" });

    // 7. Persist updated history
    const now = Date.now();
    const toAppend = [];
    if (persistUserMessage) {
      toAppend.push({ role: "user", content: user_message || "", ts: now });
    }
    toAppend.push({ role: "assistant", content: reply, ts: now });

    const newHistory = history.concat(toAppend).slice(-200); // cap at 200 turns

    await supabase
      .from("conversations")
      .upsert({
        user_id:    userId,
        agent_id:   agentId,
        messages:   newHistory,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id,agent_id" });

    res.json({ reply, history_length: newHistory.length });
  } catch (err) {
    console.error("[chat] endpoint error:", err);
    res.status(500).json({ error: "Chat-agenten kraschade" });
  }
});

// ── INTERN HJÄLP — ett Claude-anrop, returnerar objekt (används av page-batch) ──
async function insightCall(context, checkins, profile, bioCtx = "") {
  const n = checkins.length;
  if (!n) return {};

  const avg  = (arr, f) => arr.length ? (arr.reduce((s,x) => s + (x[f]||0), 0) / arr.length).toFixed(1) : "—";
  const call = async (system, user, maxTok) => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTok, system, messages: [{ role: "user", content: user }] })
    });
    const d = await r.json();
    const txt = d?.content?.[0]?.text || "";
    try { const m = txt.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt); } catch { return {}; }
  };

  // Rekommendation
  if (context.endsWith("_rekommendation")) {
    const kategori = context.replace("_rekommendation", "");
    const recent   = checkins.slice(-14);
    const latest14 = checkins[checkins.length - 1];
    const avg14    = (f) => recent.length ? (recent.reduce((s,x) => s + (x[f]||0), 0) / recent.length).toFixed(1) : "—";
    const FALLBACKS = {
      sleep:     { steg: [{ atgard: "Flytta läggdags 45 minuter tidigare tre dagar i rad.", varfor: "Ditt sömnsnitt är under återhämtningströskeln — varje kvart räknas." }, { atgard: "Undvik koffein efter 14:00 denna vecka.", varfor: "Sen koffein förlänger insomningstiden när stressen redan är hög." }], fraga: "Vad hindrar dig från att komma i säng tidigare — stress, vanor eller något annat?" },
      energy:    { steg: [{ atgard: "Skydda 30–45 minuter efter lunch som lågkravstid.", varfor: "Ditt energifall på eftermiddagen är konsekvent — använd det, bekämpa det inte." }, { atgard: "Reservera morgonens första timme för ditt viktigaste arbete.", varfor: "Energin är som högst på morgonen enligt ditt mönster." }], fraga: "Vad tar mest av din energi under en normal dag — och är det värt kostnaden?" },
      stress:    { steg: [{ atgard: "Sätt ett hårt stopp för arbete kl 19:00 tre kvällar i rad.", varfor: "Kvällsstress är ditt starkaste och mest återkommande mönster." }, { atgard: "Lägg in 10 minuter ostrukturerad tid varje förmiddag.", varfor: "Systemet ser ingen återhämtningsbuffert i dina högsträcksdagar." }], fraga: "Vad triggar mest stress just nu — och har du faktisk kontroll över det?" },
      training:  { steg: [{ atgard: "Lägg in en aktiv vilodag efter din nästa intensiva träning.", varfor: "Träning utan inbyggd återhämtning bryter ner mer än det bygger upp." }, { atgard: "Minska intensiteten med 20% nästa vecka och logga återhämtningen.", varfor: "Systemet ser tecken på ackumulerad trötthet i dina energivärden." }], fraga: "Vad får dig att träna hårdare än planerat — prestation, stress eller något annat?" },
      nutrition: { steg: [{ atgard: "Ät ett proteinrikt frukost de nästa tre dagarna och notera energin.", varfor: "Ditt förmiddagsmönster tyder på instabilt blodsocker." }, { atgard: "Undvik att hoppa över en måltid de närmaste sju dagarna.", varfor: "Oregelbundna måltider förstärker din återkommande energidal." }], fraga: "Vilken måltid är svårast att prioritera — och varför?" },
    };
    const fb = FALLBACKS[kategori] || { steg: [{ atgard: "Fokusera på ett konkret steg idag.", varfor: "Baserat på ditt aktuella mönster." }], fraga: "Vad är det viktigaste du kan förändra just nu?" };
    const rekMsg = `KATEGORI: ${kategori}\nIDAG: ${new Date().toISOString().split("T")[0]}\nANTAL CHECK-INS: ${n}\n\nSENASTE CHECK-IN (${latest14.date}):\nEnergi ${latest14.energy}/10 · Sömn ${latest14.sleep}/10 · Stress ${latest14.stress}/10 · Fokus ${latest14.focus}/10 · Motivation ${latest14.motivation}/10\n\n14-DAGARSSNITT:\nEnergi ${avg14("energy")} · Sömn ${avg14("sleep")} · Stress ${avg14("stress")} · Fokus ${avg14("focus")} · Motivation ${avg14("motivation")}\n\nPROFIL:\nNamn: ${profile.q3_1||"Okänt"} · Ålder: ${profile.q3_2||"—"} · Kön: ${profile.q3_3||"—"}\n${profile.q2_1?`Energimönster: ${profile.q2_1}`:""}${profile.q6_1?`\nSömnmönster: ${profile.q6_1}`:""}${profile.q7_1?`\nTräningsnivå: ${profile.q7_1}`:""}\n\nGenerera 2–3 konkreta nästa steg för ${kategori}. Varje steg är omöjligt att ha fått utan just dessa siffror.\n\nReturnera EXAKT detta JSON:\n{"steg":[{"atgard":"Konkret åtgärd — en mening.","varfor":"Varför — direkt kopplat till ett värde."},{"atgard":"...","varfor":"..."}],"fraga":"En fördjupad fråga som hjälper systemet förstå hindret."}`;
    try {
      const parsed = await call((AGENTS["3"] || "Du är Forsyne insikts-agent. Svara alltid i JSON.") + "\n\n" + SPRAKREGLER, rekMsg, 600);
      return { steg: parsed.steg || fb.steg, fraga: parsed.fraga || fb.fraga };
    } catch { return fb; }
  }

  // Öppningsmening — kort, dataspecifik, en mening
  if (context.endsWith("_opening")) {
    const kategori = context.replace("_opening", "");
    const latest   = checkins[checkins.length - 1];
    const recent14 = checkins.slice(-14);
    const avgF = (f) => {
      const vals = recent14.filter(c => (c[f]||0) > 0).map(c => c[f]);
      return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : null;
    };
    const rev = [...recent14].reverse();
    let stressStreak=0, lowSleepStreak=0, highEnergyStreak=0;
    for (const c of rev) { if ((c.stress||0) >= 7) stressStreak++; else break; }
    const revSl = [...recent14.filter(c=>c.sleep>0)].reverse();
    for (const c of revSl) { if (c.sleep < 6) lowSleepStreak++; else break; }
    const revE = [...recent14.filter(c=>c.energy>0)].reverse();
    for (const c of revE) { if (c.energy >= 7) highEnergyStreak++; else break; }

    const dataStr = `KATEGORI: ${kategori}
SENASTE CHECK-IN (${latest.date}):
Energi ${latest.energy}/10 · Sömn ${latest.sleep}/10 · Stress ${latest.stress}/10 · Fokus ${latest.focus}/10 · Motivation ${latest.motivation}/10

14-DAGARSSNITT:
Energi ${avgF("energy")||"—"} · Sömn ${avgF("sleep")||"—"} · Stress ${avgF("stress")||"—"}

AKTIVA STREAKS:
Stress ≥7: ${stressStreak}d i rad · Sömn <6h: ${lowSleepStreak} nätter i rad · Energi ≥7: ${highEnergyStreak}d i rad

TOTALT ANTAL CHECK-INS: ${n}
${bioCtx ? `\nOBJEKTIV DATA:\n${bioCtx}` : ""}`;

    const openingSystem = `Du är Forsyne. Skriv EN öppningsmening för ${kategori}-sidan baserat på användarens faktiska data.

Regler:
- Exakt en mening. Max 14 ord.
- Referera ett konkret tal eller streak ur data — aldrig generiskt
- Ton: du konstaterar något som redan är sant. Ingen uppmuntran. Ingen oro. Ingen lösning.
- Rätt: "Sex timmar med tre uppvaknanden är inte sömn — det är överlevnad"
- Fel: "Din sömn behöver förbättras för att du ska må bättre"

Returnera EXAKT: {"insikt":"meningen här"}`;

    try {
      const parsed = await call(openingSystem + "\n\n" + SPRAKREGLER, dataStr, 120);
      return saneraParsed(parsed);
    } catch { return {}; }
  }

  // Generisk insikt
  const recent7 = checkins.slice(-7);
  const latest  = checkins[checkins.length - 1];
  const prev7   = checkins.slice(-14, -7);
  const energyTrend = prev7.length ? (parseFloat(avg(recent7,"energy")) - parseFloat(avg(prev7,"energy"))).toFixed(1) : "—";
  const sleepTrend  = prev7.length ? (parseFloat(avg(recent7,"sleep"))  - parseFloat(avg(prev7,"sleep"))).toFixed(1)  : "—";
  const stressTrend = prev7.length ? (parseFloat(avg(recent7,"stress")) - parseFloat(avg(prev7,"stress"))).toFixed(1) : "—";
  const rev = [...recent7].reverse();
  let varselStreak = 0;
  for (const c of rev) { if (c.stress >= 7 && c.sleep <= 5) varselStreak++; else break; }
  const reflections = recent7.filter(c => c.reflection).slice(-3).map(c => `"${c.reflection}"`).join(" / ");

  const contextMsg = `KONTEXT: ${context}\nIDAG: ${new Date().toISOString().split("T")[0]}\nANTAL CHECK-INS TOTALT: ${n}\n\nSENASTE CHECK-IN (${latest.date}):\nEnergi ${latest.energy}/10 · Sömn ${latest.sleep}/10 · Stress ${latest.stress}/10 · Fokus ${latest.focus}/10 · Motivation ${latest.motivation}/10\n\n7-DAGARSSNITT:\nEnergi ${avg(recent7,"energy")} · Sömn ${avg(recent7,"sleep")} · Stress ${avg(recent7,"stress")} · Fokus ${avg(recent7,"focus")} · Motivation ${avg(recent7,"motivation")}\n\nTRENDER (sista 7 vs föregående 7):\nEnergi ${energyTrend > 0 ? "+" : ""}${energyTrend} · Sömn ${sleepTrend > 0 ? "+" : ""}${sleepTrend} · Stress ${stressTrend > 0 ? "+" : ""}${stressTrend}\n\nVARSEL-STREAK: ${varselStreak > 0 ? `${varselStreak} dagar (stress≥7 + sömn≤5)` : "Ingen aktiv"}\n\nSENASTE REFLEKTIONER: ${reflections || "—"}\n\nPROFIL:\nNamn: ${profile.q3_1||"Okänt"} · Ålder: ${profile.q3_2||"—"} · Kön: ${profile.q3_3||"—"}\nLivssituation: ${profile.q4_1||"—"}\nErgimönster: ${profile.q2_1||"—"}\n${bioCtx ? `\nOBJEKTIV DATA (vägd mot det subjektiva ovan — prioritera avvikelser):\n${bioCtx}\n` : ""}\nGenerera insikter för kontexten "${context}". Svara EXAKT i detta JSON-format:\n{"insikt":"2–3 meningar. Varje mening rör sig framåt.","sammanfattning":"1 mening.","rekommendation":"1 konkret åtgärd.","styrka":"1 mening, äkta och positiv.","risk":"1 mening, konkret risk baserad på data."}`;

  try {
    const parsed = await call((AGENTS["3"] || "Du är Forsyne insikts-agent. Svara alltid i JSON.") + "\n\n" + SPRAKREGLER, contextMsg, 700);
    return saneraParsed(parsed);
  } catch { return {}; }
}

// ── GAP-DETEKTION — jämför subjektivt (check-in) vs objektivt (wearable) ──
function detectGaps(page, checkins, intMap) {
  if (!checkins.length) return null;
  const latest = checkins[checkins.length - 1];
  const gm = intMap.garmin || {};

  if (page === 'sleep' && gm.latest_sleep_min && latest.sleep) {
    const subj_h = +(latest.sleep * 0.9).toFixed(1);
    const obj_h  = +(gm.latest_sleep_min / 60).toFixed(1);
    const gap_h  = +(obj_h - subj_h).toFixed(1);
    if (Math.abs(gap_h) >= 0.5) {
      return {
        detekterad: true,
        subjektivt: `${subj_h}h (upplevd)`,
        objektivt:  `${obj_h}h (Garmin)`,
        gap:        gap_h > 0 ? `+${gap_h}h` : `${gap_h}h`,
        tolkning:   gap_h > 0
          ? 'Du sov mer än du upplevde — återhämtningen kan vara djupare än du registrerat.'
          : 'Du sov kortare än du upplevde — kroppen signalerar mer trötthet än du märker.'
      };
    }
  }

  if (page === 'energy' && gm.latest_body_battery != null && latest.energy) {
    const subj = latest.energy * 10;
    const obj  = gm.latest_body_battery;
    const gap  = obj - subj;
    if (Math.abs(gap) >= 15) {
      return {
        detekterad: true,
        subjektivt: `${subj}/100 (upplevd)`,
        objektivt:  `${obj}/100 (Body Battery)`,
        gap:        gap > 0 ? `+${gap}` : `${gap}`,
        tolkning:   gap > 0
          ? 'Garmin mäter mer kapacitet än du upplever — kroppen har resurser medvetandet inte nåt.'
          : 'Garmin mäter lägre energi än du rapporterade — kroppen är mer utmattad än du uppfattar.'
      };
    }
  }

  if (page === 'stress' && gm.avg_stress_7d != null && latest.stress) {
    const subj = latest.stress * 10;
    const obj  = Math.round(gm.avg_stress_7d);
    const gap  = obj - subj;
    if (Math.abs(gap) >= 15) {
      return {
        detekterad: true,
        subjektivt: `${subj}/100 (upplevd)`,
        objektivt:  `${obj}/100 (Garmin 7d)`,
        gap:        gap > 0 ? `+${gap}` : `${gap}`,
        tolkning:   gap > 0
          ? 'Din fysiologiska stress är högre än vad du upplever — kroppen bär på mer än medvetandet registrerar.'
          : 'Du upplever mer stress än Garmin mäter fysiologiskt — den mentala bördan är tyngre än den biologiska.'
      };
    }
  }

  return null;
}

// ── AGENT — PAGE BATCH (parallell, ett anrop från frontend) ──
app.post("/api/agent/page/generate", auth, async (req, res) => {
  const { page, checkins = [], profile = {} } = req.body;
  if (!checkins.length) return res.json({});

  const CTX = {
    sleep:     [`sleep_opening`,    `sleep_full`,    `sleep_validation`,    `sleep_rekommendation`],
    stress:    [`stress_opening`,   `stress_full`,   `stress_validation`,   `stress_rekommendation`],
    training:  [`training_opening`, `training_full`, `training_validation`, `training_rekommendation`],
    nutrition: [`nutrition_opening`,`nutrition_full`,`nutrition_validation`,`nutrition_rekommendation`],
    energy:    [`energi`,           `energy_rekommendation`],
  };
  const contexts = CTX[page];
  if (!contexts) return res.status(400).json({ error: "Okänd sida" });

  // ── Hämta objektiv data från DB och bygg page-specifik kontext ──
  const { data: integrations } = await supabase
    .from("integrations").select("provider,data").eq("user_id", req.user.id);
  const intMap = {};
  (integrations || []).forEach(i => { intMap[i.provider] = i.data || {}; });

  const gm = intMap.garmin || {};
  const dx = intMap.dexcom || {};
  const st = intMap.strava || {};
  const bl = intMap.blood_labs?.latest || {};
  const dn = intMap.dna || {};
  const cr = intMap.cronometer || {};

  // Garmin sömn — relevant för sleep + energy + stress
  const garminSleep = gm.latest_sleep_min ? `Garmin sömn senaste natt: ${Math.floor(gm.latest_sleep_min/60)}h ${gm.latest_sleep_min%60}m (djupsömn: ${gm.latest_deep_min ? Math.floor(gm.latest_deep_min/60)+'h '+gm.latest_deep_min%60+'m' : '—'})\nHRV senaste natt: ${gm.latest_hrv||'—'} ms · HRV snitt 7d: ${gm.avg_hrv_7d||'—'} ms\nSömnsnitt 7d: ${gm.avg_sleep_7d ? Math.floor(gm.avg_sleep_7d/60)+'h '+gm.avg_sleep_7d%60+'m' : '—'}` : "";

  const garminStress = gm.avg_stress_7d ? `Garmin stressnivå snitt 7d: ${gm.avg_stress_7d}\nBody Battery senaste: ${gm.latest_body_battery||'—'}` : "";

  const garminTraining = st.training_load_7d != null ? `Strava träningsbelastning 7d: ${st.training_load_7d} · Aktiviteter: ${st.activities_7d||0}\nSnittspuls 7d: ${st.avg_heartrate_7d||'—'} bpm${st.latest_activity ? `\nSenaste: ${st.latest_activity.name} ${st.latest_activity.date} — ${st.latest_activity.distance_km||'—'}km · ${st.latest_activity.duration_min||'—'}min` : ''}` : "";

  const dexcomCtx = dx.latest_glucose ? `CGM glukos senaste: ${dx.latest_glucose.value} mg/dL · Trend: ${dx.latest_glucose.trend||'—'}\nSnitt 24h: ${dx.avg_glucose_24h||'—'} mg/dL · Tid i målzon: ${dx.time_in_range_24h != null ? dx.time_in_range_24h+'%' : '—'}` : "";

  const bloodCtx = bl.nyckelobservationer?.length ? `Blodprover:\n${bl.nyckelobservationer.slice(0,4).join('\n')}` : "";

  const dnaCtx = dn.nyckelinsikter?.length ? `DNA:\n${dn.nyckelinsikter.slice(0,3).join('\n')}` : "";

  const nutriCtx = cr.avg_7d ? `Kost snitt 7d: ${cr.avg_7d.energy_kcal||'—'} kcal · Protein ${cr.avg_7d.protein_g||'—'}g · Magnesium ${cr.avg_7d.magnesium_mg||'—'} mg · Järn ${cr.avg_7d.iron_mg||'—'} mg · Vitamin D ${cr.avg_7d.vitamin_d_iu||'—'} IU` : "";

  // Page-specifik bioCtx — varje sida får bara relevant objektiv data
  const BIO = {
    sleep:     [garminSleep, garminStress, bloodCtx, dnaCtx].filter(Boolean).join("\n"),
    energy:    [garminSleep, garminStress, dexcomCtx, bloodCtx, nutriCtx].filter(Boolean).join("\n"),
    stress:    [garminStress, garminSleep, dexcomCtx, bloodCtx].filter(Boolean).join("\n"),
    training:  [garminTraining, garminStress, garminSleep, bloodCtx].filter(Boolean).join("\n"),
    nutrition: [nutriCtx, dexcomCtx, bloodCtx, garminStress].filter(Boolean).join("\n"),
  };
  const bioCtx = BIO[page] || "";
  const avvikelse = detectGaps(page, checkins, intMap);

  const results = await Promise.allSettled(contexts.map(ctx => insightCall(ctx, checkins, profile, bioCtx)));
  const get = (i) => results[i]?.status === "fulfilled" ? results[i].value : {};

  let out;
  if (page === "energy") {
    const [ins, rek] = [get(0), get(1)];
    out = { insikt: ins.insikt || null, rekommendation: ins.rekommendation || null, steg: rek.steg || [], fraga: rek.fraga || null, avvikelse };
  } else {
    const [opening, full, validation, rek] = [get(0), get(1), get(2), get(3)];
    out = {
      opening:       opening.insikt    || null,
      insikt:        full.insikt       || null,
      styrka:        full.styrka       || null,
      risk:          full.risk         || null,
      rekommendation:full.rekommendation|| null,
      validation:    validation.insikt || null,
      steg:          rek.steg          || [],
      fraga:         rek.fraga         || null,
      avvikelse,
    };
  }
  res.json(out);
});

// ── AGENT VALIDATE — VALIDERINGSLOOPEN ──
app.post("/api/agent/validate", auth, async (req, res) => {
  const { kategori, paastående, svar, kommentar, datapunkter = [] } = req.body;
  if (!kategori || !paastående || !svar) return res.status(400).json({ error: "kategori, paastående och svar krävs" });

  // Spara till validations-tabellen
  const { error: dbErr } = await supabase.from("validations").insert({
    user_id: req.user.id,
    kategori,
    paastående,
    svar,
    kommentar: kommentar || null,
    datapunkter: datapunkter.length ? datapunkter : null
  });
  if (dbErr) console.error("validate DB error:", dbErr.message);

  const systemPrompt = `Du är Forsyne valideringsagent. Du tar emot ett påstående systemet gjort, användarens svar och datapunkterna som låg till grund.

Din uppgift:
- Bedöm om påståendet var korrekt baserat på data
- Om användaren sa 'stämmer inte' — identifiera exakt vad som var fel i resonemanget
- Generera ett bättre, mer precist påstående för nästa tillfälle
- Beräkna precision 0.0–1.0

Returnera EXAKT detta JSON:
{
  "stammer": true/false,
  "precision": 0.0-1.0,
  "vad_missades": "string om fel — annars null",
  "battre_paastående": "string",
  "larda_notering": "string — max 20 ord"
}`;

  const userMsg = `
PÅSTÅENDE: "${paastående}"
ANVÄNDARENS SVAR: ${svar}
${kommentar ? `KOMMENTAR: "${kommentar}"` : ""}
KATEGORI: ${kategori}

DATAPUNKTER (senaste ${datapunkter.length} check-ins):
${datapunkter.slice(-7).map(c => `${c.date}: energi ${c.energy} sömn ${c.sleep} stress ${c.stress}`).join('\n') || '—'}`.trim();

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }]
      })
    });

    const d = await resp.json();
    const txt = d?.content?.[0]?.text || "";
    let parsed;
    try { const m = txt.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : txt); } catch { parsed = {}; }

    // Spara valideringsresultat till DB
    const updateFields = {};
    if (parsed.precision    != null) updateFields.agentens_precision = parsed.precision;
    if (parsed.stammer      != null) updateFields.stammer            = parsed.stammer;
    if (parsed.larda_notering)       updateFields.larda_notering     = parsed.larda_notering;
    if (parsed.vad_missades)         updateFields.vad_missades       = parsed.vad_missades;
    if (Object.keys(updateFields).length) {
      await supabase.from("validations")
        .update(updateFields)
        .eq("user_id", req.user.id)
        .eq("paastående", paastående);
    }

    res.json({
      ok: true,
      precision: parsed.precision ?? null,
      larda_notering: parsed.larda_notering || "Systemet har noterat ditt svar.",
      battre_paastående: parsed.battre_paastående || null
    });
  } catch(e) {
    console.error("validate agent error:", e);
    res.json({ ok: true, precision: null, larda_notering: "Systemet har noterat ditt svar.", battre_paastående: null });
  }
});

// ── SELVITAS — SYSTEMETS SAMLADE DOM ──
app.post("/api/selvitas/generate", auth, async (req, res) => {
  const { checkins = [], profile = {} } = req.body;
  if (!checkins.length) return res.json({ error: "Ingen data" });

  const { data: integrations } = await supabase
    .from("integrations").select("provider,data").eq("user_id", req.user.id);
  const intMap = {};
  (integrations || []).forEach(i => { intMap[i.provider] = i.data || {}; });

  const gm = intMap.garmin || {};
  const dx = intMap.dexcom || {};
  const st = intMap.strava || {};
  const bl = intMap.blood_labs?.latest || {};
  const dn = intMap.dna || {};
  const cr = intMap.cronometer || {};

  const { data: failedVals } = await supabase
    .from("validations")
    .select("kategori, vad_missades, larda_notering")
    .eq("user_id", req.user.id)
    .eq("svar", "stämmer inte")
    .order("created_at", { ascending: false })
    .limit(5);

  const recent30 = checkins.slice(-30);
  const recent7  = checkins.slice(-7);
  const latest   = checkins[checkins.length - 1];
  const avg = (arr, f) => arr.length ? (arr.reduce((s,x) => s + (x[f]||0), 0) / arr.length).toFixed(1) : "—";

  // Gap-detektering
  const gapLines = [];
  if (gm.latest_sleep_min && latest.sleep) {
    const subj_h = +(latest.sleep * 0.9).toFixed(1);
    const obj_h  = +(gm.latest_sleep_min / 60).toFixed(1);
    const g = +(obj_h - subj_h).toFixed(1);
    if (Math.abs(g) >= 0.4) gapLines.push(`Sömn: upplevd ${subj_h}h vs Garmin ${obj_h}h (gap ${g > 0 ? '+' : ''}${g}h)`);
  }
  if (gm.latest_body_battery != null && latest.energy) {
    const subj = latest.energy * 10;
    const obj  = gm.latest_body_battery;
    const g    = obj - subj;
    if (Math.abs(g) >= 12) gapLines.push(`Energi: upplevd ${subj}/100 vs Body Battery ${obj}/100 (gap ${g > 0 ? '+' : ''}${g})`);
  }
  if (gm.avg_stress_7d != null && latest.stress) {
    const subj = latest.stress * 10;
    const obj  = Math.round(gm.avg_stress_7d);
    const g    = obj - subj;
    if (Math.abs(g) >= 12) gapLines.push(`Stress: upplevd ${subj}/100 vs Garmin 7d ${obj}/100 (gap ${g > 0 ? '+' : ''}${g})`);
  }

  const bioCtx = [
    gm.avg_sleep_7d ? `Garmin: sömn 7d ${Math.floor(gm.avg_sleep_7d/60)}h ${gm.avg_sleep_7d%60}m · HRV 7d ${gm.avg_hrv_7d||'—'} ms · Body Battery ${gm.latest_body_battery||'—'} · Stress 7d ${gm.avg_stress_7d||'—'}` : "",
    dx.latest_glucose ? `CGM: ${dx.latest_glucose.value} mg/dL · Tid i målzon 24h ${dx.time_in_range_24h != null ? dx.time_in_range_24h+'%' : '—'}` : "",
    bl.nyckelobservationer?.length ? `Blodprover: ${bl.nyckelobservationer.slice(0,5).join(' · ')}` : "",
    dn.nyckelinsikter?.length ? `DNA: ${dn.nyckelinsikter.slice(0,4).join(' · ')}` : "",
    cr.avg_7d ? `Kost: ${cr.avg_7d.energy_kcal||'—'} kcal · Protein ${cr.avg_7d.protein_g||'—'}g · Magnesium ${cr.avg_7d.magnesium_mg||'—'} mg · Vitamin D ${cr.avg_7d.vitamin_d_iu||'—'} IU` : "",
    st.training_load_7d != null ? `Strava: belastning 7d ${st.training_load_7d} · aktiviteter ${st.activities_7d||0}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `DU ÄR FORSYNE META-INTELLIGENS. FORMULERA SELVITAS.

Selvitas = systemets samlade dom om den här individen som levande system.
Inte en sammanfattning. En syntes — hur delarna hänger ihop och driver varandra.

PROFIL:
${profile.q3_1 || 'Okänt'}, ${profile.q3_2 || '—'} år · ${profile.q3_3 || '—'}
Mål: ${profile.q1_6 || '—'} · Vill förstå: ${profile.q1_7 || '—'}
Kronotyp: ${profile._kronotyp || profile.q2_kronotyp || '—'}
${(()=>{const c=profile.chronic_conditions||profile.q3_6;const list=Array.isArray(c)?c.filter(x=>x!=='Inget av ovanstående'):(c?[c]:[]);return list.length?`Kroniska tillstånd: ${list.join(', ')}`:'';})()}

SENASTE 7 DAGARS CHECK-INS:
Energi ${avg(recent7,'energy')} · Sömn ${avg(recent7,'sleep')} · Stress ${avg(recent7,'stress')} · Fokus ${avg(recent7,'focus')} · Motivation ${avg(recent7,'motivation')}

SENASTE 30 DAGAR:
Energi ${avg(recent30,'energy')} · Sömn ${avg(recent30,'sleep')} · Stress ${avg(recent30,'stress')}

TOTAL ANTAL CHECK-INS: ${checkins.length}
${bioCtx ? `\nBIOLOGISK DATA:\n${bioCtx}` : ""}${gapLines.length ? `\nAVVIKELSER (subjektivt vs objektivt):\n${gapLines.join('\n')}` : ""}${(failedVals||[]).filter(v=>v.vad_missades||v.larda_notering).length ? `\nLÄRDAR MÖNSTER:\n${(failedVals||[]).filter(v=>v.vad_missades||v.larda_notering).map(v=>`- ${v.kategori}: ${v.vad_missades||v.larda_notering}`).join('\n')}` : ""}

Svara EXAKT i detta JSON-format:
{
  "biologisk_identitet": "2–3 meningar. Vad biologin och vanan avslöjar om den här personens grundläggande kapacitet — baserat på DNA, blod och wearables.",
  "funktionsmönster": "2–3 meningar. De starkaste sambanden — hur sömn, stress, energi och träning driver varandra för just den här personen.",
  "gapen": "Om avvikelser finns: en mening om skillnaden mellan hur personen upplever kroppen och vad mätdata visar. Annars: null.",
  "prediktion": "Vad händer härnäst om nuvarande mönster fortsätter — specifikt och baserat på trend.",
  "selvitas_dom": "Systemets avslutande dom. Max 30 ord. Det som ska ge känslan av: hur visste det? Serif-värdig."
}`.trim();

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: "Du är Forsyne meta-intelligens. Du syntetiserar all information om en individ till en sammanhängande dom. Svara alltid i JSON.\n\n" + SPRAKREGLER,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const d = await resp.json();
    const txt = d?.content?.[0]?.text || "";
    let parsed;
    try { const m = txt.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : txt); } catch { parsed = {}; }
    res.json(saneraParsed(parsed));
  } catch(e) {
    console.error("selvitas agent error:", e);
    res.status(500).json({ error: "Selvitas-agenten svarade inte" });
  }
});

// ── SELVITAS INDEX — SI beräknat mätvärde ──
app.get("/api/selvitas/index", auth, async (req, res) => {
  const [checkinsRes, intRes, valRes] = await Promise.all([
    supabase.from("checkins").select("*", { count: "exact", head: false }).eq("user_id", req.user.id).order("date", { ascending: false }).limit(1),
    supabase.from("integrations").select("provider,data").eq("user_id", req.user.id),
    supabase.from("validations").select("svar,stammer").eq("user_id", req.user.id)
  ]);

  const checkin_count_res = await supabase.from("checkins").select("id", { count: "exact", head: true }).eq("user_id", req.user.id);
  const checkin_count = checkin_count_res.count || 0;

  const intMap = {};
  (intRes.data || []).forEach(i => { intMap[i.provider] = i.data || {}; });
  const connectedIntegrations = (intRes.data || []).filter(i => Object.keys(i.data || {}).length > 0).length;

  const validations = valRes.data || [];
  const stammerCount = validations.filter(v => v.svar === 'stämmer' || v.stammer === true).length;
  const totalValidations = validations.length;

  // ── Datamognad (0→1) ──
  const vol = Math.min(1, checkin_count / 60);
  const intBonus = Math.min(0.25, connectedIntegrations * 0.06);
  const datamognad = Math.min(1, vol + intBonus);

  // ── Modellprecision (0→1) — Laplace smoothing ──
  const modellprecision = (stammerCount + 1.5) / (totalValidations + 3);

  // ── Genomsnittsgap (0→1) ──
  const gm = intMap.garmin || {};
  const c = checkinsRes.data?.length ? decryptCheckins(checkinsRes.data)[0] : null;
  const gaps = [];
  if (c && gm.latest_sleep_min && c.sleep) {
    const subj_h = c.sleep * 0.9;
    const obj_h  = gm.latest_sleep_min / 60;
    gaps.push(Math.min(1, Math.abs(obj_h - subj_h) / 4));
  }
  if (c && gm.latest_body_battery != null && c.energy) {
    gaps.push(Math.min(1, Math.abs(c.energy * 10 - gm.latest_body_battery) / 50));
  }
  if (c && gm.avg_stress_7d != null && c.stress) {
    gaps.push(Math.min(1, Math.abs(c.stress * 10 - Math.round(gm.avg_stress_7d)) / 50));
  }
  const genomsnittsgap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0.3;

  // ── SI = D × (1−G) × P, skala 0–100 ──
  const si = Math.round(datamognad * (1 - genomsnittsgap) * modellprecision * 100);

  res.json({
    si,
    datamognad:      +datamognad.toFixed(2),
    genomsnittsgap:  +genomsnittsgap.toFixed(2),
    modellprecision: +modellprecision.toFixed(2),
    checkin_count,
    integration_count: connectedIntegrations,
    validation_count:  totalValidations
  });
});

// ── KONKRETA PREDIKTIONER ──

// Verifierar om dagens check-in bekräftar eller motbevisar en pending prediktion
async function verifyConcretePredictions(userId, sleep, energy) {
  try {
    const today = new Date().toISOString().split("T")[0];
    const { data: pending } = await supabase
      .from("concrete_predictions")
      .select("*")
      .eq("user_id", userId)
      .eq("verified", false)
      .lte("expires_at", today);
    for (const p of pending || []) {
      let triggered = false;
      let actualValue = null;
      if (p.trigger_field === "sleep" && sleep != null) {
        triggered = p.trigger_operator === "under" ? sleep < p.trigger_value : sleep >= p.trigger_value;
        actualValue = energy;
      } else if (p.trigger_field === "energy" && energy != null) {
        triggered = p.trigger_operator === "under" ? energy < p.trigger_value : energy >= p.trigger_value;
        actualValue = sleep;
      }
      const correct = triggered && actualValue != null
        ? (p.predicted_operator === "under" ? actualValue < p.predicted_value : actualValue >= p.predicted_value)
        : null;
      await supabase.from("concrete_predictions").update({
        verified: true,
        actual_value: actualValue,
        correct: triggered ? correct : null
      }).eq("id", p.id);
    }
  } catch(e) {
    console.error("[concrete-pred/verify]", e.message);
  }
}

// Generera konkret if-then prediktion från korrelationsdata
app.post("/api/selvitas/concrete-prediction", auth, async (req, res) => {
  const { checkins = [] } = req.body;
  if (checkins.length < 7) return res.json({ error: "not_enough_data" });

  // Bygg sleep→nästa-dags-energy-par
  const pairs = [];
  for (let i = 0; i < checkins.length - 1; i++) {
    const s = parseFloat(checkins[i].sleep);
    const e = parseFloat(checkins[i + 1].energy);
    if (!isNaN(s) && !isNaN(e)) pairs.push({ x: s, y: e });
  }
  if (pairs.length < 5) return res.json({ error: "not_enough_data" });

  // Pearson-korrelation
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
  const my = pairs.reduce((s, p) => s + p.y, 0) / n;
  const num = pairs.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const dx  = Math.sqrt(pairs.reduce((s, p) => s + (p.x - mx) ** 2, 0));
  const dy  = Math.sqrt(pairs.reduce((s, p) => s + (p.y - my) ** 2, 0));
  const r   = num / (dx * dy || 1);

  if (r < 0.25) return res.json({ error: "no_significant_correlation" });

  // Tröskel: medelsömn - halv standardavvikelse, avrundat till 0.5
  const sdx = dx / Math.sqrt(n);
  const rawThreshold = mx - sdx * 0.5;
  const threshold = Math.round(rawThreshold * 2) / 2; // närmaste 0.5h

  // Genomsnittlig energi för nätter under tröskeln
  const lowPairs = pairs.filter(p => p.x < threshold + 0.5);
  const avgEnergyLow = lowPairs.length
    ? lowPairs.reduce((s, p) => s + p.y, 0) / lowPairs.length
    : my - 1;
  const predictedEnergy = Math.ceil(avgEnergyLow);
  const confidence = Math.round(Math.min(0.95, Math.max(0.3, Math.abs(r))) * 100);

  const expires = new Date();
  expires.setDate(expires.getDate() + 1);
  const expiresStr = expires.toISOString().split("T")[0];

  const display_text = `Om du sover under ${threshold}h förutspår systemet energi under ${predictedEnergy} nästa dag.`;

  // Spara till DB (en per dag, deduplera)
  const { data: existing } = await supabase
    .from("concrete_predictions")
    .select("id")
    .eq("user_id", req.user.id)
    .gte("created_at", new Date().toISOString().split("T")[0] + "T00:00:00Z")
    .limit(1);
  if (!existing || existing.length === 0) {
    await supabase.from("concrete_predictions").insert({
      user_id:           req.user.id,
      expires_at:        expiresStr,
      trigger_field:     "sleep",
      trigger_operator:  "under",
      trigger_value:     threshold,
      predicted_field:   "energy",
      predicted_operator:"under",
      predicted_value:   predictedEnergy,
      confidence,
      display_text
    });
  }

  res.json({ trigger_value: threshold, predicted_value: predictedEnergy, confidence, display_text, r: Math.round(r * 100) / 100 });
});

// Hämta senaste aktiva konkreta prediktion
app.get("/api/selvitas/concrete-prediction", auth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("concrete_predictions")
    .select("*")
    .eq("user_id", req.user.id)
    .gte("expires_at", today)
    .order("created_at", { ascending: false })
    .limit(1);
  res.json(data?.[0] || null);
});

// ── AGENT 4 — PREDIKTIONS-AGENTEN ──
app.post("/api/agent/prediction/generate", auth, async (req, res) => {
  const { checkins = [], profile = {} } = req.body;

  const n = checkins.length;
  if (n === 0) return res.json({ varsel_status: "ingen", varsel_dag: 0, sannolikhet_krasch: 0, kritisk_åtgärd: null, tidslinje: [], insikt: null });

  const recent = [...checkins].reverse();
  const latest = checkins[n - 1];

  let hardStreak = 0;
  for (const c of recent) { if (c.stress >= 7 && c.sleep <= 5) hardStreak++; else break; }
  let softStreak = 0;
  for (const c of recent) { if (c.stress >= 6 && c.sleep <= 5) softStreak++; else break; }
  const varselActive = hardStreak >= 2 || softStreak >= 3;
  const streak = hardStreak >= 2 ? hardStreak : softStreak >= 3 ? softStreak : 0;

  const r7 = checkins.slice(-7);
  const avg = (arr, f) => arr.length ? (arr.reduce((s,x)=>s+(x[f]||0),0)/arr.length).toFixed(1) : "—";
  const avgStress7  = avg(r7, 'stress');
  const avgSleep7   = avg(r7, 'sleep');
  const avgEnergy7  = avg(r7, 'energy');
  const avgFocus7   = avg(r7, 'focus');
  const avgMotiv7   = avg(r7, 'motivation');

  const r3 = checkins.slice(-3);
  const r4_7 = checkins.slice(-7, -3);
  const energyRate = r3.length && r4_7.length
    ? ((r3.reduce((s,x)=>s+x.energy,0)/r3.length) - (r4_7.reduce((s,x)=>s+x.energy,0)/r4_7.length)).toFixed(1)
    : "0";
  const stressRate = r3.length && r4_7.length
    ? ((r3.reduce((s,x)=>s+x.stress,0)/r3.length) - (r4_7.reduce((s,x)=>s+x.stress,0)/r4_7.length)).toFixed(1)
    : "0";

  let crashHistory = [];
  let inCrash = false, crashLen = 0;
  for (const c of checkins) {
    if (c.stress >= 7 && c.sleep <= 5) { inCrash = true; crashLen++; }
    else if (inCrash) { crashHistory.push(crashLen); inCrash = false; crashLen = 0; }
  }
  if (inCrash) crashHistory.push(crashLen);
  const avgCrashLen = crashHistory.length ? Math.round(crashHistory.reduce((s,x)=>s+x,0)/crashHistory.length) : 7;

  const reflections = checkins.slice(-5).filter(c=>c.reflection).map(c=>`(${c.date}): "${c.reflection}"`).join('\n');

  const today = new Date().toISOString().split('T')[0];
  const varselStatus = !varselActive ? 'ingen' : streak >= 5 ? 'kritiskt' : streak >= 3 ? 'aktivt' : 'tidig_signal';

  // Fetch wearable/integration data
  const { data: intRows4 } = await supabase
    .from("integrations").select("provider, data").eq("user_id", req.user.id);
  const int4 = {};
  (intRows4 || []).forEach(i => { int4[i.provider] = i.data || {}; });
  const dx4 = int4.dexcom;
  const st4 = int4.strava;
  const garminCtx4 = int4.garmin?.avg_hrv_7d || int4.garmin?.avg_sleep_7d ? `\nGARMIN:\nHRV senaste natt: ${int4.garmin.latest_hrv || "—"} ms · Snitt 7d: ${int4.garmin.avg_hrv_7d || "—"} ms · Body Battery: ${int4.garmin.latest_body_battery || "—"}\nStress snitt 7d: ${int4.garmin.avg_stress_7d || "—"} · Sömn senaste natt: ${int4.garmin.latest_sleep_min ? Math.floor(int4.garmin.latest_sleep_min/60)+'h '+((int4.garmin.latest_sleep_min||0)%60)+'m' : "—"}` : "";
  const blood4  = int4.blood_labs?.latest;
  const bloodCtx4 = blood4?.nyckelobservationer ? `\nBLODPROVER:\n${blood4.nyckelobservationer.join("\n")}\nMönsterkoppling: ${blood4.mönsterkoppling || "—"}` : "";
  const dnaCtx4 = int4.dna?.nyckelinsikter ? `\nDNA: ${int4.dna.nyckelinsikter.join(" · ")}` : "";
  const nutritionCtx4 = int4.nutrition?.latest?.sammanfattning ? `\nKOST: ${int4.nutrition.latest.sammanfattning}` : "";
  const journalCtx4 = int4.medical_journal?.latest?.systemkontext ? `\nMEDICINSK KONTEXT: ${int4.medical_journal.latest.systemkontext}` : "";
  const dexcomCtx4 = dx4?.latest_glucose ? `\nDEXCOM (CGM):\nSenaste glukos: ${dx4.latest_glucose.value} mg/dL · Trend: ${dx4.latest_glucose.trend || "—"}\nSnitt 24h: ${dx4.avg_glucose_24h || "—"} mg/dL · Tid i målzon 24h: ${dx4.time_in_range_24h != null ? dx4.time_in_range_24h+"%" : "—"} · Variabilitet: ${dx4.cv_24h != null ? dx4.cv_24h+"%" : "—"}` : "";
  const stravaCtx4 = st4?.training_load_7d != null ? `\nSTRAVA (TRÄNING):\nBelastning 7d: ${st4.training_load_7d} · Aktiviteter: ${st4.activities_7d || 0} · Snittspuls 7d: ${st4.avg_heartrate_7d || "—"} bpm\n${st4.latest_activity ? `Senaste: ${st4.latest_activity.name} (${st4.latest_activity.type}) ${st4.latest_activity.date}` : ""}` : "";
  const cr4 = int4.cronometer;
  const cronometerCtx4 = cr4?.avg_7d ? `\nCRONOMETER (MIKRONÄRINGSÄMNEN snitt 7d):\nEnergi: ${cr4.avg_7d.energy_kcal||"—"} kcal · Protein: ${cr4.avg_7d.protein_g||"—"}g · Kolhydrater: ${cr4.avg_7d.carbs_g||"—"}g · Fett: ${cr4.avg_7d.fat_g||"—"}g\nMagnesium: ${cr4.avg_7d.magnesium_mg||"—"} mg · Järn: ${cr4.avg_7d.iron_mg||"—"} mg · Vitamin D: ${cr4.avg_7d.vitamin_d_iu||"—"} IU · B12: ${cr4.avg_7d.vitamin_b12_ug||"—"} µg · Omega-3: ${cr4.avg_7d.omega3_g||"—"}g` : "";

  const contextMsg = `
IDAG: ${today}
ANTAL CHECK-INS: ${n}
VARSEL-STATUS: ${varselStatus} (dag ${streak} av max 7)
STREAK-TYP: ${hardStreak >= 2 ? `Hårt varsel (stress≥7+sömn≤5, ${hardStreak} dagar)` : softStreak >= 3 ? `Mjukt varsel (stress≥6+sömn≤5, ${softStreak} dagar)` : 'Ingen aktiv streak'}

SENASTE CHECK-IN (${latest.date}):
Energi ${latest.energy}/10 · Sömn ${latest.sleep}/10 · Stress ${latest.stress}/10 · Fokus ${latest.focus}/10 · Motivation ${latest.motivation}/10

7-DAGARSSNITT:
Energi ${avgEnergy7} · Sömn ${avgSleep7} · Stress ${avgStress7} · Fokus ${avgFocus7} · Motivation ${avgMotiv7}

FÖRÄNDRINGSHASTIGHET (sista 3 dagar vs föregående 4):
Energi: ${energyRate > 0 ? '+' : ''}${energyRate}/10 · Stress: ${stressRate > 0 ? '+' : ''}${stressRate}/10

HISTORIK: ${crashHistory.length} dokumenterade belastningsperiod(er). Genomsnittlig längd: ${avgCrashLen} dagar.
Periodelängder: ${crashHistory.join(', ') || 'Ingen historik'}

SENASTE REFLEKTIONER:
${reflections || '—'}
${garminCtx4}${dexcomCtx4}${stravaCtx4}${cronometerCtx4}${bloodCtx4}${dnaCtx4}${nutritionCtx4}${journalCtx4}${await (async()=>{
  try {
    const f = await computePredictionFeatures(req.user.id);
    if (f.data_sufficiency.cold_start) {
      return `\n\nPERSONLIG BASELINE: inte tillgänglig än (${f.data_sufficiency.days_with_checkins} check-ins — behöver 14+ för baseline).`;
    }
    const fmt = (x) => x == null ? "—" : x;
    const fz  = (x) => x?.deviation_z == null ? "—" : `z=${x.deviation_z >= 0 ? "+" : ""}${x.deviation_z}`;
    const fPct = (x) => x?.pct_change_7d == null ? "" : ` · 7d Δ ${x.pct_change_7d >= 0 ? "+" : ""}${x.pct_change_7d}%`;
    const lines = [];
    lines.push("\n\nPERSONLIG BASELINE (28 dagar, z-score = standardavvikelser från ditt eget snitt):");
    if (f.subjective.energy?.baseline_28d?.mean != null) lines.push(`Energi: nu ${fmt(f.subjective.energy.current)}, snitt ${f.subjective.energy.baseline_28d.mean}, ${fz(f.subjective.energy)}${fPct(f.subjective.energy)}`);
    if (f.subjective.sleep?.baseline_28d?.mean != null)  lines.push(`Sömn: nu ${fmt(f.subjective.sleep.current)}, snitt ${f.subjective.sleep.baseline_28d.mean}, ${fz(f.subjective.sleep)}${fPct(f.subjective.sleep)}`);
    if (f.subjective.stress?.baseline_28d?.mean != null) lines.push(`Stress: nu ${fmt(f.subjective.stress.current)}, snitt ${f.subjective.stress.baseline_28d.mean}, ${fz(f.subjective.stress)}${fPct(f.subjective.stress)}`);
    if (f.subjective.motivation?.baseline_28d?.mean != null) lines.push(`Motivation: nu ${fmt(f.subjective.motivation.current)}, snitt ${f.subjective.motivation.baseline_28d.mean}, ${fz(f.subjective.motivation)}${fPct(f.subjective.motivation)}`);
    if (f.biological.hrv?.baseline_28d?.mean != null) lines.push(`HRV: nu ${fmt(f.biological.hrv.current)}ms, snitt ${f.biological.hrv.baseline_28d.mean}ms, ${fz(f.biological.hrv)}${fPct(f.biological.hrv)}`);
    if (f.biological.body_battery?.baseline_28d?.mean != null) lines.push(`Body Battery: nu ${fmt(f.biological.body_battery.current)}, snitt ${f.biological.body_battery.baseline_28d.mean}, ${fz(f.biological.body_battery)}${fPct(f.biological.body_battery)}`);
    if (f.training_load.acr_ratio != null) lines.push(`Träningsbelastning (ACWR): acute 7d ${f.training_load.acute_7d_avg} / chronic 28d ${f.training_load.chronic_28d_avg} = ${f.training_load.acr_ratio}${f.training_load.elevated_risk ? " (förhöjd risk)" : ""}`);
    lines.push("\nAnvänd dessa baselines som referensram. Referera aldrig till kliniska normgruppsvärden — bara till personens egen baseline. Absoluta tal har ingen mening om man inte vet personens egna mönster.");
    return lines.join("\n");
  } catch { return ""; }
})()}${await (async()=>{
  try {
    const h = await identifyCrashEpisodes(req.user.id);
    if (!h.total) return "";
    const lines = [`\n\nHISTORISKA KRASCHSEKVENSER (${h.total} identifierade, snitt ${h.avg_duration_days} dagar):`];
    for (const ep of h.episodes.slice(0, 5)) {
      const trig = ep.trigger_text ? ` — "${ep.trigger_text}"` : "";
      lines.push(`\n${ep.start_date} → ${ep.end_date} (${ep.duration_days}d, ${ep.type})${trig}`);
      if (ep.preceding_signals_7d?.length) {
        lines.push("  Signaler 7 dagar innan:");
        for (const p of ep.preceding_signals_7d) {
          lines.push(`    ${p.date}: energi=${p.energy??'?'} sömn=${p.sleep??'?'} stress=${p.stress??'?'} motivation=${p.motivation??'?'}`);
        }
      }
    }
    lines.push(`\nJämför nuläget mot dessa föregående-signaler. Om dagens mönster matchar en historisk kraschsekvens — säg det, peka på datumet, och kvantifiera matchningen.`);
    return lines.join("\n");
  } catch { return ""; }
})()}
PROFIL:
Namn: ${profile.q3_1 || 'Okänt'} · Ålder: ${profile.q3_2 || '—'} · Kön: ${profile.q3_3 || '—'}
Energimönster: ${profile.q2_1 || '—'}
Sömnmönster: ${profile.q6_1 || '—'}
Träningsnivå: ${profile.q7_1 || '—'}
${(()=>{const c=profile.q11_1||profile.q3_6;const list=Array.isArray(c)?c.filter(x=>x!=='Inget av ovanstående'):(c?[c]:[]);const parts=[];if(list.length)parts.push(`Kroniska tillstånd: ${list.join(', ')}`);if(profile.q11_2==='Ja'&&profile.q11_3)parts.push(`Mediciner: ${profile.q11_3}`);else if(profile.q11_2==='Ja')parts.push('Tar mediciner regelbundet');const seasonal=profile.q11_5;if(seasonal&&seasonal!=='Inte relevant')parts.push(`Säsongsmönster: ${seasonal}`);if(profile.q11_4&&profile.q11_4!=='Påverkar inte den dagliga funktionen')parts.push(`Påverkan dagligen: ${profile.q11_4}`);return parts.join(' · ');})()}

Gör en prediktionsbedömning. Svara EXAKT i detta JSON-format:
{
  "varsel_status": "${varselStatus}",
  "varsel_dag": ${streak},
  "sannolikhet_krasch": 0,
  "sannolikhet_avvärjning": 0,
  "dagar_till_krasch": 0,
  "kritisk_åtgärd": "Den enskilt viktigaste åtgärden just nu.",
  "insikt": "2–3 meningar om mönstret. Specifikt för den här personens data.",
  "om_åtgärd": [
    { "metrik": "Energi imorgon", "prediktion": "...", "positiv": true },
    { "metrik": "Stress dag 3", "prediktion": "...", "positiv": true },
    { "metrik": "Varsel avslutat", "prediktion": "...", "positiv": true },
    { "metrik": "Krasch", "prediktion": "Avvärjd", "positiv": true }
  ],
  "om_inget": [
    { "metrik": "Energi dag 3", "prediktion": "...", "positiv": false },
    { "metrik": "Fokus dag 5", "prediktion": "...", "positiv": false },
    { "metrik": "Krasch", "prediktion": "...", "positiv": false },
    { "metrik": "Återhämtningstid", "prediktion": "...", "positiv": false }
  ],
  "tidslinje": [
    { "dag": "Dag 1", "prognos": "...", "status": "passerad" },
    { "dag": "Dag 2", "prognos": "...", "status": "passerad" },
    { "dag": "Nu · Dag ${streak > 0 ? streak : 1}", "prognos": "...", "status": "nu" },
    { "dag": "Dag ${streak + 1}", "prognos": "...", "status": "framtid" },
    { "dag": "Dag ${streak + 2}", "prognos": "...", "status": "framtid" },
    { "dag": "Dag 7", "prognos": "...", "status": "framtid" },
    { "dag": "Dag 10", "prognos": "...", "status": "framtid" },
    { "dag": "Dag 14", "prognos": "...", "status": "framtid" }
  ]
}`.trim();

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        system: AGENTS["4"] || "Du är Forsyne prediktions-agent. Du analyserar biologiska och beteendemässiga mönster för att förutsäga när en person riskerar prestandakollaps. Du är precis, personlig och alltid framåtlutad. Svara alltid i JSON.",
        messages: [{ role: "user", content: contextMsg }]
      })
    });

    const data = await response.json();
    const text = data?.content?.[0]?.text || "";

    let parsed;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      const daysToCrash = Math.max(1, avgCrashLen - streak);
      parsed = {
        varsel_status: varselStatus,
        varsel_dag: streak,
        sannolikhet_krasch: varselActive ? Math.min(95, 30 + streak * 15) : 5,
        sannolikhet_avvärjning: varselActive ? Math.max(30, 85 - streak * 10) : 95,
        dagar_till_krasch: varselActive ? daysToCrash : 0,
        kritisk_åtgärd: latest.sleep <= 5 ? "Prioritera sömnen ikväll framför allt annat." : latest.stress >= 7 ? "Sänk stressnivån — identifiera vad som driver det och ta bort en sak." : "Håll det stabila mönstret.",
        insikt: varselActive
          ? `Stress och sömnbrist har samverkat ${streak} dagar i rad. Det är inte tillfälligt — det är ett mönster systemet känner igen.`
          : `Inga aktiva varsel. Systemet ser inga varselutlösande mönster i de senaste check-ins.`,
        om_åtgärd: [
          { metrik: "Energi imorgon", prediktion: `+${Math.round(Math.random()*2+1)}/10 om sömnen prioriteras`, positiv: true },
          { metrik: "Stress dag 3", prediktion: "Sjunkande trend möjlig", positiv: true },
          { metrik: "Varsel avslutat", prediktion: `Om ${daysToCrash > 2 ? '3–4' : '1–2'} dagar`, positiv: true },
          { metrik: "Krasch", prediktion: "Avvärjd", positiv: true }
        ],
        om_inget: [
          { metrik: "Energi dag 3", prediktion: "Fortsatt sjunkande", positiv: false },
          { metrik: "Fokus dag 5", prediktion: "Kraftigt reducerad", positiv: false },
          { metrik: "Krasch", prediktion: `Förväntad om ~${daysToCrash} dagar`, positiv: false },
          { metrik: "Återhämtningstid", prediktion: "4–6 dagar minimum", positiv: false }
        ],
        tidslinje: []
      };
    }

    res.json(parsed);
  } catch(e) {
    console.error("Agent 4 error:", e);
    res.status(500).json({ error: "Prediktions-agenten svarade inte" });
  }
});

// ── SIGNAL FEEDBACK LOOP ──

// Auto-evaluate pending predictions when a new check-in is submitted
async function evaluatePendingSignals(userId, today, energy, stress) {
  try {
    const { data: pending } = await supabase
      .from("predictions")
      .select("id, predicted_date")
      .eq("user_id", userId)
      .is("outcome", null)
      .lte("predicted_date", today);
    if (!pending || pending.length === 0) return;
    for (const p of pending) {
      let outcome = "oklar";
      if (energy != null && stress != null) {
        if (stress >= 7 || energy <= 4)    outcome = "traffade";  // crash came
        else if (stress < 6 && energy > 6) outcome = "missade";   // no crash
      }
      await supabase.from("predictions").update({
        outcome,
        outcome_checked_at: new Date().toISOString(),
        outcome_energy: energy,
        outcome_stress: stress
      }).eq("id", p.id);
    }
  } catch(e) {
    console.error("[signal/eval]", e.message);
  }
}

// Save a prediction snapshot — one per user per day, deduped
app.post("/api/signal/save", auth, async (req, res) => {
  const { prediction } = req.body;
  if (!prediction || prediction.varsel_status === "ingen") {
    return res.json({ ok: true, skipped: true });
  }
  const today = new Date().toISOString().split("T")[0];
  const { data: existing } = await supabase
    .from("predictions")
    .select("id")
    .eq("user_id", req.user.id)
    .gte("created_at", today + "T00:00:00Z")
    .limit(1);
  if (existing && existing.length > 0) return res.json({ ok: true, skipped: true });

  const dagar = Math.max(1, prediction.dagar_till_krasch || 3);
  const predictedDate = new Date();
  predictedDate.setDate(predictedDate.getDate() + dagar);
  const predicted_date = predictedDate.toISOString().split("T")[0];

  const { error } = await supabase.from("predictions").insert({
    user_id:            req.user.id,
    created_at:         new Date().toISOString(),
    predicted_date,
    sannolikhet_krasch: prediction.sannolikhet_krasch || 0,
    varsel_status:      prediction.varsel_status,
    varsel_dag:         prediction.varsel_dag || 0,
    dagar_till_krasch:  dagar,
    kritisk_atgard:     prediction.kritisk_åtgärd || null,
    agent_output:       prediction,
    outcome:            null
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Manual outcome override — user confirms what actually happened
app.post("/api/signal/outcome", auth, async (req, res) => {
  const { id, outcome } = req.body;
  if (!id || !["avvärjt", "traffade", "missade"].includes(outcome)) {
    return res.status(400).json({ error: "Ogiltigt utfall" });
  }
  const { error } = await supabase.from("predictions")
    .update({ outcome, outcome_checked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Signal accuracy — evaluated predictions + pending requiring manual input
app.get("/api/signal/accuracy", auth, async (req, res) => {
  const { data: rows, error } = await supabase
    .from("predictions")
    .select("id, outcome, sannolikhet_krasch, created_at, predicted_date, varsel_status")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const all       = rows || [];
  const evaluated = all.filter(r => r.outcome && r.outcome !== "oklar");
  const traffade  = evaluated.filter(r => r.outcome === "traffade").length;
  const avvärjt   = evaluated.filter(r => r.outcome === "avvärjt").length;
  const missade   = evaluated.filter(r => r.outcome === "missade").length;
  const total     = evaluated.length;
  const relevant  = traffade + avvärjt;  // both = signal was accurate
  const pct       = total > 0 ? Math.round((relevant / total) * 100) : 0;

  const today   = new Date().toISOString().split("T")[0];
  const pending = all
    .filter(r => !r.outcome && r.predicted_date && r.predicted_date <= today)
    .map(r => ({ id: r.id, created_at: r.created_at, predicted_date: r.predicted_date, varsel_status: r.varsel_status }));

  res.json({ total, traffade, avvärjt, missade, relevant, pct, pending });
});

// ── AGENT 5 — DATAKÄLLE-AGENTEN ──
app.post("/api/agent/datasources/normalize", auth, async (req, res) => {
  const { checkins = [] } = req.body;
  const n = checkins.length;

  if (n === 0) return res.json({ psi: null, snitt30d: null, flaggor: [], datakvalitet: "saknas", obs: null });

  const sorted = [...checkins].sort((a, b) => a.date < b.date ? -1 : 1);
  const latest = sorted[sorted.length - 1];

  const window30 = sorted.slice(-31, -1);
  const w = window30.length;

  function snitt(arr, f) { return arr.length ? arr.reduce((s,x) => s + (x[f]||0), 0) / arr.length : null; }
  function stdDev(arr, f, mean) {
    if (!arr.length || mean == null) return null;
    const variance = arr.reduce((s,x) => s + Math.pow((x[f]||0) - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
  }

  const fields = ['energy', 'sleep', 'stress', 'focus', 'motivation'];
  const snitt30d = {};
  const std30d   = {};
  fields.forEach(f => {
    snitt30d[f] = snitt(window30, f);
    std30d[f]   = stdDev(window30, f, snitt30d[f]);
  });

  function psiVal(val, avg, invert) {
    if (avg == null || avg === 0) return null;
    const raw = (val / avg) * 100;
    return invert ? Math.round((2 - val/avg) * 100) : Math.round(raw);
  }

  const psi = {
    energi:     { värde: latest.energy, snitt: snitt30d.energy != null ? +snitt30d.energy.toFixed(1) : null, psi: psiVal(latest.energy, snitt30d.energy, false), källa: 'check-in' },
    sömn:       { värde: latest.sleep,  snitt: snitt30d.sleep  != null ? +snitt30d.sleep.toFixed(1)  : null, psi: psiVal(latest.sleep,  snitt30d.sleep,  false), källa: 'check-in' },
    stress:     { värde: latest.stress, snitt: snitt30d.stress != null ? +snitt30d.stress.toFixed(1) : null, psi: psiVal(latest.stress, snitt30d.stress, true),  källa: 'check-in' },
    fokus:      { värde: latest.focus,  snitt: snitt30d.focus  != null ? +snitt30d.focus.toFixed(1)  : null, psi: psiVal(latest.focus,  snitt30d.focus,  false), källa: 'check-in' },
    motivation: { värde: latest.motivation, snitt: snitt30d.motivation != null ? +snitt30d.motivation.toFixed(1) : null, psi: psiVal(latest.motivation, snitt30d.motivation, false), källa: 'check-in' },
  };

  function sysScore(c) { return Math.round(((c.energy||0) + (c.sleep||0) + (10-(c.stress||0)) + (c.focus||0) + (c.motivation||0)) / 5 * 10); }
  const sysCurrent = sysScore(latest);
  const sysSnitt   = snitt(window30, null) != null ? snitt30d.energy != null
    ? Math.round(window30.reduce((s,c)=>s+sysScore(c),0)/window30.length)
    : null : null;
  const sysPsi     = sysSnitt ? Math.round((sysCurrent / sysSnitt) * 100) : null;

  const flaggor = [];
  fields.forEach(f => {
    const sd = std30d[f];
    if (sd != null && sd > 0) {
      const z = Math.abs((latest[f] - snitt30d[f]) / sd);
      if (z > 3) flaggor.push({ typ: 'outlier', metrik: f, z: +z.toFixed(1), värde: latest[f] });
    }
  });

  if (latest.energy >= 8 && latest.stress >= 8) {
    flaggor.push({ typ: 'motstridigt', metrik: 'energi+stress', obs: 'Hög energi och hög stress simultant — ovanlig kombination.' });
  }

  const dataAge = w;
  const kvalitet = dataAge < 3 ? 'låg' : dataAge < 7 ? 'medel' : 'hög';

  const r7 = sorted.slice(-7);
  const psi7d = {};
  fields.forEach(f => {
    const a7 = snitt(r7, f);
    const aPrev = snitt(sorted.slice(-14,-7), f);
    psi7d[f] = aPrev && a7 ? Math.round((a7/aPrev)*100) - 100 : null;
  });

  let obs = null;
  const hasFlaggor = flaggor.length > 0;
  const hasStrongDeviation = Object.values(psi).some(p => p.psi != null && (p.psi < 75 || p.psi > 130));

  if ((hasFlaggor || hasStrongDeviation) && process.env.ANTHROPIC_API_KEY) {
    try {
      const flagText = flaggor.map(f => `${f.typ}: ${f.metrik}${f.obs ? ' — '+f.obs : ''}`).join('; ');
      const psiText  = Object.entries(psi).map(([k,v]) => `${k}: PSI ${v.psi ?? '—'} (värde ${v.värde}, snitt ${v.snitt})`).join(' · ');

      const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 200,
          system: AGENTS["5"] || "Du är Forsyne datakälle-agent. Du kommenterar datakvalitet och PSI-avvikelser på svenska. Var kortfattad och precis.",
          messages: [{ role: "user", content: `PSI-data: ${psiText}. Flaggor: ${flagText || 'inga'}. Skriv EN mening (max 25 ord) som kommenterar den mest anmärkningsvärda datapunkten. Inga inledande fraser.` }]
        })
      });
      const aiData = await aiResp.json();
      obs = aiData?.content?.[0]?.text?.trim() || null;
    } catch(e) { /* tyst fel */ }
  }

  res.json({ datum: latest.date, datapunkter: n, snittfönster: w, psi, systempoäng: { värde: sysCurrent, snitt: sysSnitt, psi: sysPsi }, trend7d_psi: psi7d, flaggor, datakvalitet: kvalitet, obs });
});

// ── AI ANALYZE ──
app.post("/analyze", auth, async (req, res) => {
  const input = req.body.input;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, messages: [{ role: "user", content: input }] })
    });
    const data = await response.json();
    res.json({ reply: data?.content?.[0]?.text || "Inget svar" });
  } catch(e) {
    console.error(e);
    res.json({ reply: "Något gick fel. Försök igen." });
  }
});

// ── AI CHAT (streaming) ──
app.post("/api/chat", auth, async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages array required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        stream: true,
        ...(system ? { system } : {}),
        messages
      })
    });

    if (!response.ok) {
      const err = await response.json();
      res.write(`data: ${JSON.stringify({ error: err.error?.message || "API error" })}\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            res.write(`data: ${JSON.stringify({ text: evt.delta.text })}\n\n`);
          } else if (evt.type === "message_stop") {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch {}
      }
    }
    res.end();
  } catch(e) {
    console.error(e);
    res.write(`data: ${JSON.stringify({ error: "Serverfel" })}\n\n`);
    res.end();
  }
});

// ════════════════════════════════════════════════════════
//  STRAVA — Direct OAuth2 integration
// ════════════════════════════════════════════════════════

const STRAVA_BASE = "https://www.strava.com/api/v3";

// Normalize Strava activities into our flat schema
function normalizeStravaData(activities, athlete) {
  const now  = Date.now();
  const ms7d = 7  * 24 * 60 * 60 * 1000;
  const ms30d = 30 * 24 * 60 * 60 * 1000;

  const recent7  = activities.filter(a => now - new Date(a.start_date).getTime() < ms7d);
  const recent30 = activities.filter(a => now - new Date(a.start_date).getTime() < ms30d);

  // Training load: sum of suffer_score (Strava's relative effort) OR estimated from HR
  const load7  = recent7.reduce((s, a)  => s + (a.suffer_score || Math.round((a.moving_time / 60) * 0.4)), 0);
  const load30 = recent30.reduce((s, a) => s + (a.suffer_score || Math.round((a.moving_time / 60) * 0.4)), 0);

  const latestRun = activities.find(a => a.type === "Run" || a.sport_type === "Run");
  const latestRide = activities.find(a => a.type === "Ride" || a.sport_type === "Ride" || a.sport_type === "VirtualRide");

  // Average HR over last 7 days
  const hrActivities = recent7.filter(a => a.average_heartrate);
  const avgHR7 = hrActivities.length
    ? Math.round(hrActivities.reduce((s, a) => s + a.average_heartrate, 0) / hrActivities.length)
    : null;

  const out = {
    _source:        "strava",
    _type:          "activity",
    _updated:       new Date().toISOString(),
    strava_athlete: athlete ? { id: athlete.id, name: `${athlete.firstname} ${athlete.lastname}`, city: athlete.city } : null,
    training_load_7d:   load7,
    training_load_30d:  load30,
    activities_7d:      recent7.length,
    activities_30d:     recent30.length,
    avg_heartrate_7d:   avgHR7,
    latest_activity:    activities[0] ? {
      name:         activities[0].name,
      type:         activities[0].sport_type || activities[0].type,
      date:         activities[0].start_date_local?.split("T")[0],
      distance_km:  activities[0].distance ? +(activities[0].distance / 1000).toFixed(2) : null,
      duration_min: activities[0].moving_time ? Math.round(activities[0].moving_time / 60) : null,
      avg_hr:       activities[0].average_heartrate || null,
      suffer_score: activities[0].suffer_score || null,
    } : null,
    latest_run:  latestRun  ? { distance_km: +(latestRun.distance / 1000).toFixed(2),  pace_min_km: latestRun.average_speed  ? +(16.6667 / latestRun.average_speed).toFixed(2)  : null, avg_hr: latestRun.average_heartrate  || null, date: latestRun.start_date_local?.split("T")[0]  } : null,
    latest_ride: latestRide ? { distance_km: +(latestRide.distance / 1000).toFixed(2), speed_kmh:   latestRide.average_speed ? +(latestRide.average_speed * 3.6).toFixed(1) : null, avg_hr: latestRide.average_heartrate || null, date: latestRide.start_date_local?.split("T")[0] } : null,
  };
  return out;
}

// Refresh Strava access token if expired
async function stravaRefreshToken(userId, refreshToken) {
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     parseInt(process.env.STRAVA_CLIENT_ID, 10),
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type:    "refresh_token",
      refresh_token: refreshToken
    })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("Strava refresh failed: " + JSON.stringify(d));
  await supabase.from("integrations").update({
    access_token:  d.access_token,
    refresh_token: d.refresh_token,
    data:          { expires_at: d.expires_at }
  }).eq("user_id", userId).eq("provider", "strava");
  return d.access_token;
}

// Fetch and store Strava data for a user
async function stravasync(userId, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const [activitiesRes, athleteRes] = await Promise.all([
    fetch(`${STRAVA_BASE}/athlete/activities?per_page=50`, { headers }),
    fetch(`${STRAVA_BASE}/athlete`, { headers })
  ]);

  if (activitiesRes.status === 401) throw new Error("strava_unauthorized");

  const activities = activitiesRes.ok ? await activitiesRes.json() : [];
  const athlete    = athleteRes.ok    ? await athleteRes.json()    : null;

  const normalized = normalizeStravaData(Array.isArray(activities) ? activities : [], athlete);

  const { data: existing } = await supabase
    .from("integrations").select("data").eq("user_id", userId).eq("provider", "strava").single();

  const merged = { ...(existing?.data || {}), ...normalized };

  await supabase.from("integrations").upsert({
    user_id:      userId,
    provider:     "strava",
    access_token: accessToken,
    data:         merged,
    last_synced:  new Date().toISOString()
  }, { onConflict: "user_id,provider" });

  return normalized;
}

// Step 1 — redirect user to Strava authorization
app.get("/auth/strava", authForOAuth, (req, res) => {
  const clientId   = process.env.STRAVA_CLIENT_ID;
  if (!clientId) return res.redirect("/wearables.html?error=strava_not_configured");

  const proto  = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const appUrl = process.env.APP_URL && process.env.APP_URL !== "http://localhost:3000"
    ? process.env.APP_URL : `${proto}://${req.headers.host}`;

  // Embed user id in state so we can look them up on callback (callback has no auth header)
  const state = Buffer.from(JSON.stringify({ uid: req.user.id })).toString("base64url");

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri",  `${appUrl}/auth/strava/callback`);
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope",         "read,activity:read_all,profile:read_all");
  url.searchParams.set("state",         state);

  res.redirect(url.toString());
});

// Step 2 — Strava redirects back with ?code=...&state=...
app.get("/auth/strava/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code) return res.redirect("/wearables.html?error=strava_denied");

  let userId;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    userId = parsed.uid;
  } catch(e) {
    return res.redirect("/wearables.html?error=strava_state_invalid");
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:     parseInt(process.env.STRAVA_CLIENT_ID, 10),
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code"
      })
    });
    const tokens = await tokenRes.json();
    console.error("[strava/callback] token response:", JSON.stringify(tokens));
    if (!tokens.access_token) {
      return res.redirect("/wearables.html?error=strava_token_failed&detail=" + encodeURIComponent(tokens.message || tokens.error || 'unknown'));
    }

    // Store tokens
    await supabase.from("integrations").upsert({
      user_id:       userId,
      provider:      "strava",
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      data:          { expires_at: tokens.expires_at },
      last_synced:   new Date().toISOString()
    }, { onConflict: "user_id,provider" });

    // Initial data sync (fire-and-forget)
    stravasync(userId, tokens.access_token).catch(e => console.error("[strava/sync]", e.message));

    res.redirect("/wearables.html?connected=strava");
  } catch(e) {
    console.error("Strava callback error:", e);
    res.redirect("/wearables.html?error=strava_callback_error");
  }
});

// Manual sync trigger
app.post("/api/strava/sync", auth, async (req, res) => {
  const { data: integ } = await supabase
    .from("integrations").select("access_token, refresh_token, data")
    .eq("user_id", req.user.id).eq("provider", "strava").single();

  if (!integ) return res.status(404).json({ error: "Strava inte ansluten" });

  let token = integ.access_token;

  // Refresh token if expired (expires_at is Unix timestamp)
  if (integ.data?.expires_at && integ.data.expires_at < Math.floor(Date.now() / 1000) + 300) {
    try { token = await stravaRefreshToken(req.user.id, integ.refresh_token); }
    catch(e) { return res.status(401).json({ error: "Strava-token utgången, koppla om" }); }
  }

  try {
    const data = await stravasync(req.user.id, token);
    res.json({ ok: true, data });
  } catch(e) {
    if (e.message === "strava_unauthorized") return res.status(401).json({ error: "Strava-token utgången, koppla om" });
    res.status(500).json({ error: e.message });
  }
});

// Disconnect Strava
app.delete("/api/strava/disconnect", auth, async (req, res) => {
  await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "strava");
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  GARMIN — Manual JSON import (no API access required)
//  User exports data from Garmin Connect → unzips → uploads
//  Supported: sleep JSON, stress JSON, body battery JSON
// ════════════════════════════════════════════════════════

function normalizeGarminImport(files) {
  const out = {
    _source:   "garmin_import",
    _type:     "wearable",
    _updated:  new Date().toISOString(),
    sleep:     [],
    stress:    [],
    hrv:       [],
    body_battery: [],
  };

  for (const { name, parsed } of files) {
    const rows = Array.isArray(parsed) ? parsed : (parsed?.summaries || parsed?.allActivities || [parsed]);

    // ── SLEEP ──
    if (name.toLowerCase().includes("sleep") || rows[0]?.sleepTimeSeconds != null || rows[0]?.deepSleepSeconds != null) {
      out.sleep = rows.map(r => ({
        date:            r.calendarDate || r.startTimeLocal?.split("T")[0] || null,
        total_min:       r.sleepTimeSeconds       ? Math.round(r.sleepTimeSeconds / 60)       : null,
        deep_min:        r.deepSleepSeconds        ? Math.round(r.deepSleepSeconds / 60)        : null,
        rem_min:         r.remSleepSeconds         ? Math.round(r.remSleepSeconds / 60)         : null,
        light_min:       r.lightSleepSeconds       ? Math.round(r.lightSleepSeconds / 60)       : null,
        awake_min:       r.awakeSleepSeconds       ? Math.round(r.awakeSleepSeconds / 60)       : null,
        avg_hrv:         r.avgHrvValue             || r.averageHrvValue                         || null,
        avg_spo2:        r.averageSpO2Value        || r.avgSpo2                                 || null,
        avg_respiration: r.averageRespirationValue || null,
      })).filter(r => r.date);
    }

    // ── STRESS ──
    else if (name.toLowerCase().includes("stress") || rows[0]?.avgStressLevel != null) {
      out.stress = rows.map(r => ({
        date:               r.calendarDate || null,
        avg_stress:         r.avgStressLevel  || r.averageStressLevel || null,
        max_stress:         r.maxStressLevel  || null,
        rest_stress_min:    r.restStressDuration    ? Math.round(r.restStressDuration / 60)    : null,
        activity_stress_min: r.activityStressDuration ? Math.round(r.activityStressDuration / 60) : null,
        low_stress_min:     r.lowStressDuration     ? Math.round(r.lowStressDuration / 60)     : null,
        high_stress_min:    r.highStressDuration    ? Math.round(r.highStressDuration / 60)    : null,
      })).filter(r => r.date);
    }

    // ── HRV ──
    else if (name.toLowerCase().includes("hrv") || rows[0]?.lastNight != null || rows[0]?.weeklyAvg != null) {
      out.hrv = rows.map(r => ({
        date:        r.startTimestampLocal?.split("T")[0] || r.calendarDate || null,
        avg_hrv:     r.lastNight     || r.avgHrvValue     || null,
        weekly_avg:  r.weeklyAvg     || null,
        low_hrv:     r.lastNightLow  || null,
        high_hrv:    r.lastNightHigh || null,
        status:      r.status        || null,
      })).filter(r => r.date);
    }

    // ── BODY BATTERY ──
    else if (name.toLowerCase().includes("battery") || rows[0]?.charged != null || rows[0]?.drained != null) {
      out.body_battery = rows.map(r => ({
        date:        r.date || r.calendarDate || null,
        charged:     r.charged    || null,
        drained:     r.drained    || null,
        end_of_day:  r.endOfDay   || null,
        start_of_day: r.startOfDay || null,
      })).filter(r => r.date);
    }
  }

  // ── 7-DAY SUMMARIES ──
  const last7 = d => {
    if (!d?.length) return null;
    const sorted = [...d].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 7);
    return sorted;
  };

  const sleepR = last7(out.sleep);
  const stressR = last7(out.stress);
  const hrvR = last7(out.hrv);
  const bbR = last7(out.body_battery);

  const mean = (arr, f) => {
    const vals = arr.map(r => r[f]).filter(v => v != null);
    return vals.length ? Math.round(vals.reduce((s,v)=>s+v,0)/vals.length) : null;
  };

  out.avg_sleep_7d       = mean(sleepR || [], 'total_min');
  out.avg_deep_sleep_7d  = mean(sleepR || [], 'deep_min');
  out.avg_hrv_7d         = mean(hrvR   || [], 'avg_hrv');
  out.avg_stress_7d      = mean(stressR|| [], 'avg_stress');
  out.latest_body_battery = bbR?.[0]?.end_of_day || bbR?.[0]?.charged || null;
  out.latest_hrv         = hrvR?.[0]?.avg_hrv    || null;
  out.latest_sleep_min   = sleepR?.[0]?.total_min || null;
  out.latest_deep_min    = sleepR?.[0]?.deep_min  || null;
  out.latest_stress      = stressR?.[0]?.avg_stress || null;
  out.data_days          = Math.max(out.sleep.length, out.stress.length, out.hrv.length, out.body_battery.length);

  return out;
}

// Upload endpoint — accepts 1–4 JSON files from Garmin Connect export
app.post("/api/garmin/import", auth, upload.array("files", 4), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "Inga filer uppladdade" });

  const parsed = [];
  for (const f of req.files) {
    try {
      const text = f.buffer.toString("utf8");
      parsed.push({ name: f.originalname, parsed: JSON.parse(text) });
    } catch(e) {
      return res.status(400).json({ error: `Kunde inte läsa ${f.originalname} — kontrollera att det är en giltig JSON-fil.` });
    }
  }

  const normalized = normalizeGarminImport(parsed);

  // Merge with existing Garmin data if any
  const { data: existing } = await supabase
    .from("integrations").select("data")
    .eq("user_id", req.user.id).eq("provider", "garmin").single();

  const merged = { ...(existing?.data || {}), ...normalized };

  await supabase.from("integrations").upsert({
    user_id:     req.user.id,
    provider:    "garmin",
    data:        merged,
    last_synced: new Date().toISOString()
  }, { onConflict: "user_id,provider" });

  res.json({ ok: true, summary: {
    sleep_days:    normalized.sleep.length,
    stress_days:   normalized.stress.length,
    hrv_days:      normalized.hrv.length,
    battery_days:  normalized.body_battery.length,
    avg_sleep_7d:  normalized.avg_sleep_7d,
    avg_hrv_7d:    normalized.avg_hrv_7d,
    avg_stress_7d: normalized.avg_stress_7d,
    latest_body_battery: normalized.latest_body_battery,
  }});
});

// FIT-fil import — läser .fit direkt från Garmin-enheten
app.post("/api/garmin/fit-import", auth, upload.array("files", 60), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "Inga filer uppladdade" });

  const fileResults = req.files.map(f => ({ name: f.originalname, buffer: f.buffer }));

  let normalized;
  try {
    normalized = await normalizeFitFiles(fileResults);
  } catch(e) {
    console.error("FIT parse error:", e);
    return res.status(400).json({ error: "Kunde inte tolka FIT-filerna: " + e.message });
  }

  // Merge with existing Garmin data
  const { data: existing } = await supabase
    .from("integrations").select("data")
    .eq("user_id", req.user.id).eq("provider", "garmin").single();

  const prev = existing?.data || {};
  // Merge arrays by date — for daily aggregates (sleep/stress/hrv/battery)
  // newer entry overwrites older for the same date.
  const mergeByDate = (a, b) => {
    const map = {};
    (a || []).forEach(r => { if (r.date) map[r.date] = r; });
    (b || []).forEach(r => { if (r.date) map[r.date] = r; });
    return Object.values(map).sort((x,y) => y.date.localeCompare(x.date));
  };

  // Activities need a different merge: a single day can have multiple
  // sessions (morning walk + evening lift). Dedup by start_time, falling
  // back to a composite key if start_time is missing (legacy entries).
  const mergeActivities = (a, b) => {
    const map = {};
    const key = r => r.start_time || `${r.date}_${r.sport || ''}_${r.duration_min || 0}_${r.distance_m || 0}`;
    (a || []).forEach(r => { map[key(r)] = r; });
    (b || []).forEach(r => { map[key(r)] = r; });
    return Object.values(map).sort((x,y) =>
      (y.start_time || y.date || '').localeCompare(x.start_time || x.date || '')
    );
  };

  const merged = {
    ...prev,
    ...normalized,
    sleep:        mergeByDate(prev.sleep,        normalized.sleep),
    stress:       mergeByDate(prev.stress,       normalized.stress),
    hrv:          mergeByDate(prev.hrv,          normalized.hrv),
    body_battery: mergeByDate(prev.body_battery, normalized.body_battery),
    activities:   mergeActivities(prev.activities || [], normalized.activities || []),
  };

  await supabase.from("integrations").upsert({
    user_id:     req.user.id,
    provider:    "garmin",
    data:        merged,
    last_synced: new Date().toISOString()
  }, { onConflict: "user_id,provider" });

  res.json({ ok: true, summary: {
    sleep_days:          normalized.sleep.length,
    stress_days:         normalized.stress.length,
    hrv_days:            normalized.hrv.length,
    battery_days:        normalized.body_battery.length,
    activity_sessions:   normalized.activities.length,
    avg_sleep_7d:        normalized.avg_sleep_7d,
    avg_hrv_7d:          normalized.avg_hrv_7d,
    avg_stress_7d:       normalized.avg_stress_7d,
    latest_body_battery: normalized.latest_body_battery,
    files_processed:     req.files.length,
  }});
});

// Disconnect Garmin
app.delete("/api/garmin/disconnect", auth, async (req, res) => {
  await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "garmin");
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  CRONOMETER — Micronutrient CSV import
// ════════════════════════════════════════════════════════

function normalizeCronometerCSV(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('Tom fil');

  // Parse header
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

  // Key micronutrients to track (column name → our key)
  const NUTRIENT_MAP = {
    'Energy (kcal)': 'energy_kcal', 'Protein (g)': 'protein_g', 'Carbs (g)': 'carbs_g',
    'Fat (g)': 'fat_g', 'Fiber (g)': 'fiber_g', 'Sugar (g)': 'sugar_g',
    'Magnesium (mg)': 'magnesium_mg', 'Iron (mg)': 'iron_mg', 'Zinc (mg)': 'zinc_mg',
    'Calcium (mg)': 'calcium_mg', 'Potassium (mg)': 'potassium_mg', 'Sodium (mg)': 'sodium_mg',
    'Vitamin D (IU)': 'vitamin_d_iu', 'Vitamin B12 (µg)': 'vitamin_b12_ug',
    'Vitamin C (mg)': 'vitamin_c_mg', 'Vitamin A (IU)': 'vitamin_a_iu',
    'Omega-3 (g)': 'omega3_g', 'Folate (µg)': 'folate_ug',
  };

  // Group by date, sum nutrients
  const byDate = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
    const dateRaw = cols[headers.indexOf('Date')] || cols[0];
    if (!dateRaw || !/\d{4}-\d{2}-\d{2}/.test(dateRaw)) continue;
    const date = dateRaw.slice(0, 10);
    if (!byDate[date]) byDate[date] = {};
    for (const [csvCol, key] of Object.entries(NUTRIENT_MAP)) {
      const idx = headers.indexOf(csvCol);
      if (idx === -1) continue;
      const val = parseFloat(cols[idx]);
      if (!isNaN(val)) byDate[date][key] = (byDate[date][key] || 0) + val;
    }
  }

  const days = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, nutrients]) => ({ date, ...nutrients }));

  if (!days.length) throw new Error('Inga dagar hittades i filen');

  // 7-day averages
  const last7 = days.slice(-7);
  const avg = (key) => {
    const vals = last7.map(d => d[key]).filter(v => v != null);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  };

  return {
    days: days.slice(-90), // keep last 90 days
    avg_7d: {
      energy_kcal: avg('energy_kcal'), protein_g: avg('protein_g'),
      carbs_g: avg('carbs_g'), fat_g: avg('fat_g'), fiber_g: avg('fiber_g'),
      magnesium_mg: avg('magnesium_mg'), iron_mg: avg('iron_mg'),
      zinc_mg: avg('zinc_mg'), vitamin_d_iu: avg('vitamin_d_iu'),
      vitamin_b12_ug: avg('vitamin_b12_ug'), omega3_g: avg('omega3_g'),
    },
    total_days: days.length,
    date_range: { from: days[0]?.date, to: days[days.length - 1]?.date },
    _source: 'cronometer_csv',
  };
}

app.post("/api/cronometer/import", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Ingen fil uppladdad" });
  try {
    const text = req.file.buffer.toString("utf8");
    const normalized = normalizeCronometerCSV(text);
    await supabase.from("integrations").upsert({
      user_id:     req.user.id,
      provider:    "cronometer",
      data:        normalized,
      last_synced: new Date().toISOString()
    }, { onConflict: "user_id,provider" });
    res.json({ ok: true, summary: {
      total_days:  normalized.total_days,
      date_range:  normalized.date_range,
      avg_energy:  normalized.avg_7d.energy_kcal,
      avg_protein: normalized.avg_7d.protein_g,
      avg_magnesium: normalized.avg_7d.magnesium_mg,
    }});
  } catch(e) {
    res.status(400).json({ error: e.message || "Kunde inte läsa CSV-filen" });
  }
});

app.delete("/api/cronometer/disconnect", auth, async (req, res) => {
  await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "cronometer");
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  GARMIN HEALTH API — OAuth2 (ready when API access granted)
//  Requires: GARMIN_CLIENT_ID, GARMIN_CLIENT_SECRET in env
//  Apply at: developer.garmin.com/health-api
// ════════════════════════════════════════════════════════

const GARMIN_AUTH_URL  = "https://connect.garmin.com/oauthConfirm";
const GARMIN_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/token";
const GARMIN_API_BASE  = "https://apis.garmin.com/wellness-api/rest";

async function garminApiSync(userId, accessToken, tokenSecret) {
  // Garmin uses OAuth 1.0a — headers built with HMAC-SHA1
  // When implementing: use oauth-1.0a library
  // This stub structure is ready for full implementation
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };

  const endDate   = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [sleepRes, stressRes, hrvRes, bodyBatteryRes] = await Promise.all([
    fetch(`${GARMIN_API_BASE}/sleeps?uploadStartTimeInSeconds=${Math.floor((Date.now()-7*86400000)/1000)}&uploadEndTimeInSeconds=${Math.floor(Date.now()/1000)}`, { headers }),
    fetch(`${GARMIN_API_BASE}/stressDetails?uploadStartTimeInSeconds=${Math.floor((Date.now()-7*86400000)/1000)}&uploadEndTimeInSeconds=${Math.floor(Date.now()/1000)}`, { headers }),
    fetch(`${GARMIN_API_BASE}/hrv?uploadStartTimeInSeconds=${Math.floor((Date.now()-7*86400000)/1000)}&uploadEndTimeInSeconds=${Math.floor(Date.now()/1000)}`, { headers }),
    fetch(`${GARMIN_API_BASE}/bodyBattery?uploadStartTimeInSeconds=${Math.floor((Date.now()-7*86400000)/1000)}&uploadEndTimeInSeconds=${Math.floor(Date.now()/1000)}`, { headers }),
  ]);

  if (sleepRes.status === 401) throw new Error("garmin_unauthorized");

  const sleepData       = sleepRes.ok       ? await sleepRes.json()       : {};
  const stressData      = stressRes.ok      ? await stressRes.json()      : {};
  const hrvData         = hrvRes.ok         ? await hrvRes.json()         : {};
  const bodyBatteryData = bodyBatteryRes.ok ? await bodyBatteryRes.json() : {};

  // Normalize Garmin API response into same schema as manual import
  const sleepRows = (sleepData.sleeps || []).map(s => ({
    date:      new Date(s.startTimeInSeconds * 1000).toISOString().split("T")[0],
    total_min: s.durationInSeconds ? Math.round(s.durationInSeconds / 60) : null,
    deep_min:  s.deepSleepDurationInSeconds ? Math.round(s.deepSleepDurationInSeconds / 60) : null,
    rem_min:   s.remSleepInSeconds ? Math.round(s.remSleepInSeconds / 60) : null,
    awake_min: s.awakeDurationInSeconds ? Math.round(s.awakeDurationInSeconds / 60) : null,
    avg_spo2:  s.averageSpO2Value || null,
    avg_respiration: s.averageRespirationValue || null,
  }));

  const hrvRows = (hrvData.hrv || []).map(h => ({
    date:       new Date(h.startTimeInSeconds * 1000).toISOString().split("T")[0],
    avg_hrv:    h.lastNight || null,
    weekly_avg: h.weeklyAverage || null,
    low_hrv:    h.lastNightLow || null,
    high_hrv:   h.lastNightHigh || null,
    status:     h.status || null,
  }));

  // Body battery: aggregate by day
  const bbByDay = {};
  (bodyBatteryData.bodyBattery || []).forEach(b => {
    const date = new Date(b.startTimeInSeconds * 1000).toISOString().split("T")[0];
    if (!bbByDay[date]) bbByDay[date] = { charged: 0, drained: 0, values: [] };
    bbByDay[date].charged  += b.charged  || 0;
    bbByDay[date].drained  += b.drained  || 0;
    bbByDay[date].values.push(b.bodyBatteryLevel || 0);
  });
  const bbRows = Object.entries(bbByDay).map(([date, v]) => ({
    date,
    charged:    v.charged,
    drained:    v.drained,
    end_of_day: v.values.length ? v.values[v.values.length - 1] : null,
  }));

  const stressRows = (stressData.stressDetails || []).map(s => ({
    date:            new Date(s.startTimeInSeconds * 1000).toISOString().split("T")[0],
    avg_stress:      s.averageStressLevel || null,
    max_stress:      s.maxStressLevel || null,
    rest_stress_min: s.restStressDuration ? Math.round(s.restStressDuration / 60) : null,
    high_stress_min: s.highStressDuration ? Math.round(s.highStressDuration / 60) : null,
  }));

  // Reuse normalization logic by feeding into same summarizer
  const normalized = normalizeGarminImport([
    { name: "sleep.json",       parsed: sleepRows },
    { name: "hrv.json",         parsed: hrvRows },
    { name: "battery.json",     parsed: bbRows },
    { name: "stress.json",      parsed: stressRows },
  ]);
  normalized._source = "garmin_api";

  const { data: existing } = await supabase
    .from("integrations").select("data")
    .eq("user_id", userId).eq("provider", "garmin").single();

  const merged = { ...(existing?.data || {}), ...normalized };

  await supabase.from("integrations").upsert({
    user_id:     userId,
    provider:    "garmin",
    data:        merged,
    last_synced: new Date().toISOString()
  }, { onConflict: "user_id,provider" });

  return normalized;
}

async function garminRefreshToken(userId, refreshToken) {
  // Garmin OAuth 1.0a does not use refresh tokens in the traditional sense —
  // access tokens are long-lived. This is a placeholder for when API details are confirmed.
  return null;
}

// Returns whether Garmin Health API credentials are configured
app.get("/api/garmin/api-available", auth, (req, res) => {
  res.json({ available: !!(process.env.GARMIN_CLIENT_ID && process.env.GARMIN_CLIENT_SECRET) });
});

// Step 1 — redirect to Garmin authorization
app.get("/auth/garmin", authForOAuth, (req, res) => {
  const clientId = process.env.GARMIN_CLIENT_ID;
  if (!clientId) return res.redirect("/wearables.html?error=garmin_not_configured");

  const proto  = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const appUrl = process.env.APP_URL && process.env.APP_URL !== "http://localhost:3000"
    ? process.env.APP_URL : `${proto}://${req.headers.host}`;

  const state = Buffer.from(JSON.stringify({ uid: req.user.id })).toString("base64url");

  const url = new URL(GARMIN_AUTH_URL);
  url.searchParams.set("oauth_consumer_key", clientId);
  url.searchParams.set("oauth_callback",     `${appUrl}/auth/garmin/callback`);
  url.searchParams.set("state",              state);

  res.redirect(url.toString());
});

// Step 2 — Garmin redirects back
app.get("/auth/garmin/callback", async (req, res) => {
  const { oauth_token, oauth_verifier, state, error } = req.query;
  if (error || !oauth_token) return res.redirect("/wearables.html?error=garmin_denied");

  let userId;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    userId = parsed.uid;
  } catch(e) {
    return res.redirect("/wearables.html?error=garmin_state_invalid");
  }

  try {
    // Exchange verifier for access token
    const tokenRes = await fetch(GARMIN_TOKEN_URL, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/x-www-form-urlencoded",
        "Authorization": `OAuth oauth_consumer_key="${process.env.GARMIN_CLIENT_ID}", oauth_token="${oauth_token}", oauth_verifier="${oauth_verifier}"`
      }
    });
    const tokenText = await tokenRes.text();
    const tokenParams = Object.fromEntries(new URLSearchParams(tokenText));

    if (!tokenParams.oauth_token) {
      console.error("Garmin token exchange failed:", tokenText);
      return res.redirect("/wearables.html?error=garmin_token_failed");
    }

    await supabase.from("integrations").upsert({
      user_id:       userId,
      provider:      "garmin",
      access_token:  tokenParams.oauth_token,
      refresh_token: tokenParams.oauth_token_secret,
      data:          { _source: "garmin_api" },
      last_synced:   new Date().toISOString()
    }, { onConflict: "user_id,provider" });

    garminApiSync(userId, tokenParams.oauth_token, tokenParams.oauth_token_secret)
      .catch(e => console.error("[garmin/sync]", e.message));

    res.redirect("/wearables.html?connected=garmin");
  } catch(e) {
    console.error("Garmin callback error:", e);
    res.redirect("/wearables.html?error=garmin_callback_error");
  }
});

// Manual sync trigger
app.post("/api/garmin/sync", auth, async (req, res) => {
  const { data: integ } = await supabase
    .from("integrations").select("access_token, refresh_token, data")
    .eq("user_id", req.user.id).eq("provider", "garmin").single();

  if (!integ) return res.status(404).json({ error: "Garmin inte ansluten" });
  if (integ.data?._source !== "garmin_api") return res.status(400).json({ error: "Garmin kopplad via manuell import — använd uppladdning för att uppdatera" });

  try {
    const data = await garminApiSync(req.user.id, integ.access_token, integ.refresh_token);
    res.json({ ok: true, data });
  } catch(e) {
    if (e.message === "garmin_unauthorized") return res.status(401).json({ error: "Garmin-token utgången, koppla om" });
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════
//  DEXCOM — CGM (Continuous Glucose Monitor) integration
// ════════════════════════════════════════════════════════

const DEXCOM_BASE      = "https://sandbox-api.dexcom.com";
const DEXCOM_AUTH_URL  = "https://sandbox-api.dexcom.com/v2/oauth2/login";
const DEXCOM_TOKEN_URL = "https://sandbox-api.dexcom.com/v2/oauth2/token";

// Normalize Dexcom EGV (estimated glucose value) data
function normalizeDexcomData(egvs, events, devices) {
  const now   = Date.now();
  const ms24h = 24 * 60 * 60 * 1000;
  const ms7d  = 7  * 24 * 60 * 60 * 1000;

  const readings = Array.isArray(egvs?.egvs) ? egvs.egvs : [];
  const recent24 = readings.filter(r => now - new Date(r.systemTime).getTime() < ms24h);
  const recent7d = readings.filter(r => now - new Date(r.systemTime).getTime() < ms7d);

  // Time in range: 70–180 mg/dL
  function timeInRange(arr) {
    if (!arr.length) return null;
    const inRange = arr.filter(r => r.value >= 70 && r.value <= 180).length;
    return Math.round((inRange / arr.length) * 100);
  }

  // Coefficient of variation (%)
  function cv(arr) {
    if (arr.length < 2) return null;
    const vals = arr.map(r => r.value);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd   = Math.sqrt(vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length);
    return Math.round((sd / mean) * 100);
  }

  const avg24 = recent24.length
    ? Math.round(recent24.reduce((s, r) => s + r.value, 0) / recent24.length)
    : null;

  const avg7d = recent7d.length
    ? Math.round(recent7d.reduce((s, r) => s + r.value, 0) / recent7d.length)
    : null;

  const latest = readings[0] || null;

  const device = Array.isArray(devices?.devices) ? devices.devices[0] : null;

  return {
    _source:          "dexcom",
    _type:            "cgm",
    _updated:         new Date().toISOString(),
    latest_glucose:   latest ? { value: latest.value, trend: latest.trend, trend_rate: latest.trendRate, time: latest.systemTime } : null,
    avg_glucose_24h:  avg24,
    avg_glucose_7d:   avg7d,
    time_in_range_24h: timeInRange(recent24),
    time_in_range_7d:  timeInRange(recent7d),
    cv_24h:           cv(recent24),
    cv_7d:            cv(recent7d),
    readings_24h:     recent24.length,
    device:           device ? { model: device.displayDevice, transmitter: device.transmitterId } : null,
  };
}

// Refresh Dexcom access token
async function dexcomRefreshToken(userId, refreshToken) {
  const params = new URLSearchParams({
    client_id:     process.env.DEXCOM_CLIENT_ID,
    client_secret: process.env.DEXCOM_CLIENT_SECRET,
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
    redirect_uri:  `${process.env.APP_URL || "http://localhost:3000"}/auth/dexcom/callback`
  });

  const r = await fetch(DEXCOM_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString()
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("Dexcom refresh failed: " + JSON.stringify(d));

  const expiresAt = Math.floor(Date.now() / 1000) + (d.expires_in || 7200);
  await supabase.from("integrations").update({
    access_token:  d.access_token,
    refresh_token: d.refresh_token || refreshToken,
    data:          { expires_at: expiresAt }
  }).eq("user_id", userId).eq("provider", "dexcom");

  return d.access_token;
}

// Fetch and store Dexcom data for a user
async function dexcomSync(userId, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Fetch last 7 days of data
  const endDate   = new Date().toISOString().split(".")[0];
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split(".")[0];

  const [egvsRes, eventsRes, devicesRes] = await Promise.all([
    fetch(`${DEXCOM_BASE}/v3/users/self/egvs?startDate=${startDate}&endDate=${endDate}`, { headers }),
    fetch(`${DEXCOM_BASE}/v3/users/self/events?startDate=${startDate}&endDate=${endDate}`, { headers }),
    fetch(`${DEXCOM_BASE}/v3/users/self/devices?startDate=${startDate}&endDate=${endDate}`, { headers })
  ]);

  if (egvsRes.status === 401) throw new Error("dexcom_unauthorized");

  const egvs    = egvsRes.ok    ? await egvsRes.json()    : {};
  const events  = eventsRes.ok  ? await eventsRes.json()  : {};
  const devices = devicesRes.ok ? await devicesRes.json() : {};

  const normalized = normalizeDexcomData(egvs, events, devices);

  const { data: existing } = await supabase
    .from("integrations").select("data")
    .eq("user_id", userId).eq("provider", "dexcom").single();

  const merged = { ...(existing?.data || {}), ...normalized };

  await supabase.from("integrations").upsert({
    user_id:      userId,
    provider:     "dexcom",
    access_token: accessToken,
    data:         merged,
    last_synced:  new Date().toISOString()
  }, { onConflict: "user_id,provider" });

  return normalized;
}

// Step 1 — redirect user to Dexcom authorization
app.get("/auth/dexcom", authForOAuth, (req, res) => {
  const clientId = process.env.DEXCOM_CLIENT_ID;
  if (!clientId) return res.redirect("/wearables.html?error=dexcom_not_configured");

  const proto  = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const appUrl = process.env.APP_URL && process.env.APP_URL !== "http://localhost:3000"
    ? process.env.APP_URL : `${proto}://${req.headers.host}`;

  const state = Buffer.from(JSON.stringify({ uid: req.user.id })).toString("base64url");

  const url = new URL(DEXCOM_AUTH_URL);
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("redirect_uri",  `${appUrl}/auth/dexcom/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope",         "offline_access egv calibration device statistics event");
  url.searchParams.set("state",         state);

  res.redirect(url.toString());
});

// Step 2 — Dexcom redirects back with ?code=...&state=...
app.get("/auth/dexcom/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code) return res.redirect("/wearables.html?error=dexcom_denied");

  let userId;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    userId = parsed.uid;
  } catch(e) {
    return res.redirect("/wearables.html?error=dexcom_state_invalid");
  }

  try {
    const proto  = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
    const appUrl = process.env.APP_URL && process.env.APP_URL !== "http://localhost:3000"
      ? process.env.APP_URL : `${proto}://${req.headers.host}`;

    const params = new URLSearchParams({
      client_id:     process.env.DEXCOM_CLIENT_ID,
      client_secret: process.env.DEXCOM_CLIENT_SECRET,
      code,
      grant_type:    "authorization_code",
      redirect_uri:  `${appUrl}/auth/dexcom/callback`
    });

    const tokenRes = await fetch(DEXCOM_TOKEN_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString()
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      console.error("Dexcom token exchange failed:", tokens);
      return res.redirect("/wearables.html?error=dexcom_token_failed");
    }

    const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 7200);

    await supabase.from("integrations").upsert({
      user_id:       userId,
      provider:      "dexcom",
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      data:          { expires_at: expiresAt },
      last_synced:   new Date().toISOString()
    }, { onConflict: "user_id,provider" });

    // Initial sync
    dexcomSync(userId, tokens.access_token).catch(e => console.error("[dexcom/sync]", e.message));

    res.redirect("/wearables.html?connected=dexcom");
  } catch(e) {
    console.error("Dexcom callback error:", e);
    res.redirect("/wearables.html?error=dexcom_callback_error");
  }
});

// Manual sync trigger
app.post("/api/dexcom/sync", auth, async (req, res) => {
  const { data: integ } = await supabase
    .from("integrations").select("access_token, refresh_token, data")
    .eq("user_id", req.user.id).eq("provider", "dexcom").single();

  if (!integ) return res.status(404).json({ error: "Dexcom inte ansluten" });

  let token = integ.access_token;

  if (integ.data?.expires_at && integ.data.expires_at < Math.floor(Date.now() / 1000) + 300) {
    try { token = await dexcomRefreshToken(req.user.id, integ.refresh_token); }
    catch(e) { return res.status(401).json({ error: "Dexcom-token utgången, koppla om" }); }
  }

  try {
    const data = await dexcomSync(req.user.id, token);
    res.json({ ok: true, data });
  } catch(e) {
    if (e.message === "dexcom_unauthorized") return res.status(401).json({ error: "Dexcom-token utgången, koppla om" });
    res.status(500).json({ error: e.message });
  }
});

// Disconnect Dexcom
app.delete("/api/dexcom/disconnect", auth, async (req, res) => {
  await supabase.from("integrations").delete().eq("user_id", req.user.id).eq("provider", "dexcom");
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  TERRA — Unified wearable API
// ════════════════════════════════════════════════════════

const TERRA_BASE   = "https://api.tryterra.co/v2";
const TERRA_WIDGET = "https://widget.tryterra.co";

function terraHeaders() {
  return {
    "x-api-key": process.env.TERRA_API_KEY,
    "dev-id":    process.env.TERRA_DEV_ID,
    "Content-Type": "application/json"
  };
}

// Verify Terra webhook signature: HMAC-SHA256(rawBody, TERRA_API_KEY)
function verifyTerraSignature(rawBody, header) {
  const expected = crypto
    .createHmac("sha256", process.env.TERRA_API_KEY || "")
    .update(rawBody)
    .digest("hex");
  return header === expected;
}

// Normalize Terra daily/sleep/body data into our flat schema
function normalizeTerraData(type, dataArr) {
  const d = dataArr?.[0] || {};
  const out = { _source: "terra", _type: type, _updated: new Date().toISOString() };

  if (type === "daily" || type === "activity") {
    const hr   = d.heart_rate_data || {};
    const hrv  = hr.hrv || {};
    const ox   = d.oxygen_data || {};
    const met  = d.MET_data || {};
    out.hrv_rmssd    = hrv.rmssd_ms ?? hrv.sdnn_ms ?? null;
    out.resting_hr   = hr.summary?.resting_hr_bpm ?? null;
    out.stress_avg   = d.stress_data?.avg_stress_level ?? null;
    out.vo2max       = ox.vo2max_ml_per_min_per_kg ?? null;
    out.body_battery = d.scores?.recovery_score ?? null;
    out.steps        = d.distance_data?.steps ?? null;
    out.spo2         = ox.avg_saturation_percentage ?? null;
  }

  if (type === "sleep") {
    const sl  = d.sleep_durations_data || {};
    const hr  = d.heart_rate_data || {};
    const hrv = hr.hrv || {};
    out.sleep_total_min = sl.total_seconds      ? Math.round(sl.total_seconds / 60)            : null;
    out.sleep_deep_min  = sl.slow_wave_sleep_duration_seconds ? Math.round(sl.slow_wave_sleep_duration_seconds / 60) : null;
    out.sleep_rem_min   = sl.rem_sleep_duration_seconds       ? Math.round(sl.rem_sleep_duration_seconds / 60)       : null;
    out.sleep_light_min = sl.light_sleep_duration_seconds     ? Math.round(sl.light_sleep_duration_seconds / 60)     : null;
    out.hrv_sleep       = hrv.rmssd_ms ?? hrv.sdnn_ms ?? null;
  }

  if (type === "body") {
    const m = d.measurements_data || {};
    out.weight_kg    = m.weight_kg ?? null;
    out.height_cm    = m.height_cm ?? null;
    out.body_fat_pct = m.body_fat_percentage ?? null;
    out.bmi          = m.BMI ?? null;
  }

  // Dexcom glucose — arrives as nutrition or glucose sub-object in daily
  const glucose = d.glucose_data || d.nutrition_data?.glucose || null;
  if (glucose) {
    const samples = glucose.blood_glucose_samples || glucose.detailed?.blood_glucose_samples || [];
    if (samples.length) {
      const toMmol = mg => Math.round(mg / 18.0182 * 10) / 10;
      const vals = samples.map(s => s.blood_glucose_mg_per_dL ?? s.value ?? 0).filter(Boolean);
      out.glucose_latest_mmol = toMmol(vals[vals.length - 1]);
      out.glucose_avg_mmol    = toMmol(vals.reduce((a, b) => a + b, 0) / vals.length);
      out.glucose_min_mmol    = toMmol(Math.min(...vals));
      out.glucose_max_mmol    = toMmol(Math.max(...vals));
      out.glucose_tir_pct     = Math.round(vals.filter(v => v >= 70 && v <= 180).length / vals.length * 100);
    }
  }

  return out;
}

// ── TERRA — generate widget session for a provider ──
// Supported: GARMIN, DEXCOM, OURA, WHOOP, APPLE, SAMSUNG, POLAR, FITBIT
app.get("/auth/terra/:provider", auth, async (req, res) => {
  const provider = req.params.provider.toUpperCase();
  const allowed  = ["GARMIN","DEXCOM","OURA","WHOOP","APPLE","SAMSUNG","POLAR","FITBIT"];
  if (!allowed.includes(provider)) return res.redirect("/wearables.html?error=unknown_provider");

  const apiKey = process.env.TERRA_API_KEY;
  const devId  = process.env.TERRA_DEV_ID;
  if (!apiKey || !devId) return res.redirect("/wearables.html?error=terra_not_configured");

  const proto  = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const appUrl = (process.env.APP_URL && process.env.APP_URL !== "http://localhost:3000")
    ? process.env.APP_URL
    : `${proto}://${req.headers.host}`;

  try {
    const r = await fetch(`${TERRA_BASE}/auth/generateWidgetSession`, {
      method: "POST",
      headers: terraHeaders(),
      body: JSON.stringify({
        providers:                 provider,
        reference_id:              req.user.id,        // maps Terra user → Supabase user
        auth_success_redirect_url: `${appUrl}/wearables.html?connected=${provider.toLowerCase()}`,
        auth_failure_redirect_url: `${appUrl}/wearables.html?error=terra_auth_failed`,
        language:                  "en"
      })
    });
    const data = await r.json();

    if (!data?.url && !data?.session_id) {
      console.error("Terra widget error:", data);
      return res.redirect("/wearables.html?error=terra_widget_failed");
    }

    // Redirect user to Terra's hosted widget
    const widgetUrl = data.url || `${TERRA_WIDGET}/session/${data.session_id}`;
    res.redirect(widgetUrl);
  } catch(e) {
    console.error("Terra widget error:", e);
    res.redirect("/wearables.html?error=terra_widget_error");
  }
});

// ── TERRA — webhook receiver ──
// Terra sends POST with health data as it syncs from connected devices.
// Must be registered in the Terra dashboard as your webhook URL.
// Raw body is needed for signature verification — captured via express.json verify().
app.post("/api/terra/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig     = req.headers["x-terra-hmac-sha256"];
  const rawBody = req.body;                // Buffer from express.raw
  const apiKey  = process.env.TERRA_API_KEY;

  // Verify signature
  if (apiKey && sig) {
    const expected = crypto.createHmac("sha256", apiKey).update(rawBody).digest("hex");
    if (sig !== expected) {
      console.warn("Terra webhook: invalid signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  let payload;
  try { payload = JSON.parse(rawBody.toString()); } catch(e) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { type, user, data: dataArr } = payload;

  // Always respond quickly — process async
  res.json({ ok: true });

  // ── AUTH event — store Terra user_id mapping ──
  if (type === "auth") {
    if (payload.status === "success" && user?.reference_id) {
      const providerLower = (user.provider || "").toLowerCase();
      await supabase.from("integrations").upsert({
        user_id:      user.reference_id,
        provider:     providerLower,
        access_token: user.user_id,           // store Terra user_id as access_token
        data:         { terra_user_id: user.user_id, provider: user.provider },
        last_synced:  new Date().toISOString()
      }, { onConflict: "user_id,provider" });
    }
    return;
  }

  // ── DATA events — normalize and merge into integration data ──
  const terraUserId = user?.user_id;
  if (!terraUserId || !dataArr?.length) return;

  // Look up Supabase user via reference_id OR via terra user_id stored in access_token
  const providerLower = (user.provider || "").toLowerCase();
  const { data: integ } = await supabase
    .from("integrations")
    .select("user_id, data")
    .eq("access_token", terraUserId)
    .eq("provider", providerLower)
    .single();

  if (!integ) return; // unknown user

  const normalized = normalizeTerraData(type, dataArr);

  // Merge new fields into existing data object (don't overwrite unrelated keys)
  const merged = { ...(integ.data || {}), ...normalized };

  await supabase.from("integrations")
    .update({ data: merged, last_synced: new Date().toISOString() })
    .eq("user_id", integ.user_id)
    .eq("provider", providerLower);
});

// ── WEARABLE DATA — return latest cached data for dashboard ──
app.get("/api/wearable/data", auth, async (req, res) => {
  const { data: rows } = await supabase
    .from("integrations")
    .select("provider, data, last_synced")
    .eq("user_id", req.user.id);

  if (!rows?.length) return res.json({ connected: false, data: {} });

  // Merge all provider data into one flat object, with provider metadata
  const merged   = {};
  const providers = [];

  for (const row of rows) {
    if (row.data) Object.assign(merged, row.data);
    providers.push({ provider: row.provider, last_synced: row.last_synced });
  }

  res.json({ connected: true, providers, data: merged });
});

// ── /api/analyze — orchestrates Agent 5 → 4 → 3 ──
app.post("/api/analyze", auth, async (req, res) => {
  let { checkins, profile } = req.body;

  // ── Fetch from DB when called fire-and-forget (no body) ──
  if (!checkins || checkins.length === 0) {
    const [checkinsRes, profileRes] = await Promise.all([
      supabase.from("checkins").select("*").eq("user_id", req.user.id).order("date", { ascending: true }),
      supabase.from("profiles").select("data").eq("user_id", req.user.id).single()
    ]);
    checkins = decryptCheckins(checkinsRes.data);
    profile  = decryptProfile(profileRes.data?.data || {});
  }

  if (!checkins || checkins.length === 0) {
    return res.json({ normalize: null, prediction: null, insight: null, balance: null });
  }

  const today  = new Date().toISOString().split("T")[0];
  const n      = checkins.length;
  const sorted = [...checkins].sort((a, b) => a.date < b.date ? -1 : 1);
  const latest = sorted[sorted.length - 1];

  // Hämta objektiv data — matas in i Agent 3 + 4 nedan
  const { data: _azIntRows } = await supabase
    .from("integrations").select("provider,data").eq("user_id", req.user.id);
  const _azInt = {};
  (_azIntRows || []).forEach(i => { _azInt[i.provider] = i.data || {}; });
  const _azGm = _azInt.garmin || {};
  const _azBl = _azInt.blood_labs?.latest || {};
  const _azDn = _azInt.dna || {};
  const _azDx = _azInt.dexcom || {};
  const _azCr = _azInt.cronometer || {};
  const _azSt = _azInt.strava || {};
  const analyzeBio = [
    _azGm.avg_sleep_7d   ? `Garmin: sömn 7d ${Math.floor(_azGm.avg_sleep_7d/60)}h ${_azGm.avg_sleep_7d%60}m · HRV ${_azGm.avg_hrv_7d||'—'} ms · Body Battery ${_azGm.latest_body_battery||'—'} · Stress ${_azGm.avg_stress_7d||'—'}` : "",
    _azDx.latest_glucose ? `CGM: ${_azDx.latest_glucose.value} mg/dL · Tid i målzon 7d: ${_azDx.time_in_range_7d != null ? _azDx.time_in_range_7d+'%' : '—'}` : "",
    _azBl.nyckelobservationer?.length ? `Blodprover: ${_azBl.nyckelobservationer.slice(0,4).join(' · ')}` : "",
    _azDn.nyckelinsikter?.length  ? `DNA: ${_azDn.nyckelinsikter.slice(0,3).join(' · ')}` : "",
    _azCr.avg_7d ? `Kost 7d: ${_azCr.avg_7d.energy_kcal||'—'} kcal · Protein ${_azCr.avg_7d.protein_g||'—'}g · Magnesium ${_azCr.avg_7d.magnesium_mg||'—'} mg · Vitamin D ${_azCr.avg_7d.vitamin_d_iu||'—'} IU` : "",
    _azSt.training_load_7d != null ? `Strava: belastning ${_azSt.training_load_7d} · ${_azSt.activities_7d||0} aktiviteter 7d` : "",
  ].filter(Boolean).join("\n");

  // ─────────────────────────────────────────────────────────────
  // STEP 1 — Agent 5: Normalize + PSI (math) + Claude anomaly obs
  // ─────────────────────────────────────────────────────────────
  const window30 = sorted.slice(-31, -1);
  const fields   = ["energy", "sleep", "stress", "focus", "motivation"];

  function snittFn(arr, f) { return arr.length ? arr.reduce((s, x) => s + (x[f] || 0), 0) / arr.length : null; }
  function psiVal(val, avg, invert) {
    if (avg == null || avg === 0) return null;
    return invert ? Math.round((2 - val / avg) * 100) : Math.round((val / avg) * 100);
  }
  function sysScore(c) {
    return Math.round(((c.energy || 0) + (c.sleep || 0) + (10 - (c.stress || 0)) + (c.focus || 0) + (c.motivation || 0)) / 5 * 10);
  }

  const snitt30d = {};
  fields.forEach(f => { snitt30d[f] = snittFn(window30, f); });

  const psi = {
    energi:     { värde: latest.energy,     psi: psiVal(latest.energy,     snitt30d.energy,     false) },
    sömn:       { värde: latest.sleep,       psi: psiVal(latest.sleep,      snitt30d.sleep,      false) },
    stress:     { värde: latest.stress,      psi: psiVal(latest.stress,     snitt30d.stress,     true)  },
    fokus:      { värde: latest.focus,       psi: psiVal(latest.focus,      snitt30d.focus,      false) },
    motivation: { värde: latest.motivation,  psi: psiVal(latest.motivation, snitt30d.motivation, false) }
  };

  const sysCurrent = sysScore(latest);
  const sysSnitt   = window30.length ? Math.round(window30.reduce((s, c) => s + sysScore(c), 0) / window30.length) : null;
  const sysPsi     = sysSnitt ? Math.round((sysCurrent / sysSnitt) * 100) : null;

  const last7dates = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); last7dates.push(d.toISOString().split("T")[0]); }
  const weeklyScores = last7dates.map(date => ({ date, score: sorted.find(x => x.date === date) ? sysScore(sorted.find(x => x.date === date)) : null }));

  // Agent 5 Claude call — anomaly observation (fire if PSI deviates or flags exist)
  let agent5obs = null;
  const hasAnomaly = Object.values(psi).some(p => p.psi != null && (p.psi < 75 || p.psi > 130));
  if (hasAnomaly && process.env.ANTHROPIC_API_KEY) {
    try {
      const psiText = Object.entries(psi).map(([k, v]) => `${k}: PSI ${v.psi ?? "—"} (värde ${v.värde})`).join(" · ");
      const a5Resp  = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 120,
          system: AGENTS["5"] || "Du är Forsyne datakälle-agent. Kommentera PSI-avvikelser kort och precist på svenska.",
          messages: [{ role: "user", content: `PSI-data: ${psiText}. Systempoäng: ${sysCurrent} (PSI ${sysPsi ?? "—"}). Skriv EN mening (max 25 ord) om den mest anmärkningsvärda avvikelsen.` }]
        })
      });
      const a5Data = await a5Resp.json();
      agent5obs = a5Data?.content?.[0]?.text?.trim() || null;
    } catch(e) { /* silent */ }
  }

  const normalize = { datum: latest.date, psi, systempoäng: { värde: sysCurrent, snitt: sysSnitt, psi: sysPsi }, weeklyScores, obs: agent5obs };

  // ─────────────────────────────────────────────────────────────
  // STEP 2+3 — Agent 4 (Prediction) + Agent 3 (Insights) in parallel
  // ─────────────────────────────────────────────────────────────
  const recent  = [...sorted].reverse();
  let hardStreak = 0; for (const c of recent) { if (c.stress >= 7 && c.sleep <= 5) hardStreak++; else break; }
  let softStreak = 0; for (const c of recent) { if (c.stress >= 6 && c.sleep <= 5) softStreak++; else break; }
  const varselActive = hardStreak >= 2 || softStreak >= 3;
  const streak       = hardStreak >= 2 ? hardStreak : softStreak >= 3 ? softStreak : 0;
  const varselStatus = !varselActive ? "ingen" : streak >= 5 ? "kritiskt" : streak >= 3 ? "aktivt" : "tidig_signal";

  const avgFn  = (arr, f) => arr.length ? (arr.reduce((s, x) => s + (x[f] || 0), 0) / arr.length).toFixed(1) : "—";
  const r7     = sorted.slice(-7);
  const r3     = sorted.slice(-3);
  const r4_7   = sorted.slice(-7, -3);
  const energyRate = r3.length && r4_7.length ? ((r3.reduce((s,x)=>s+x.energy,0)/r3.length)-(r4_7.reduce((s,x)=>s+x.energy,0)/r4_7.length)).toFixed(1) : "0";
  const stressRate = r3.length && r4_7.length ? ((r3.reduce((s,x)=>s+x.stress,0)/r3.length)-(r4_7.reduce((s,x)=>s+x.stress,0)/r4_7.length)).toFixed(1) : "0";

  let crashHistory = []; let inCrash = false; let crashLen = 0;
  for (const c of sorted) {
    if (c.stress >= 7 && c.sleep <= 5) { inCrash = true; crashLen++; }
    else if (inCrash) { crashHistory.push(crashLen); inCrash = false; crashLen = 0; }
  }
  if (inCrash) crashHistory.push(crashLen);
  const avgCrashLen = crashHistory.length ? Math.round(crashHistory.reduce((s,x)=>s+x,0)/crashHistory.length) : 7;

  const prev7       = sorted.slice(-14, -7);
  const recent7     = sorted.slice(-7);
  const moodCount   = {};
  recent7.forEach(c => (c.moods||[]).forEach(m => { moodCount[m] = (moodCount[m]||0)+1; }));
  const topMoods    = Object.entries(moodCount).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([m])=>m);
  const energyTrend = prev7.length ? (parseFloat(avgFn(recent7,"energy"))-parseFloat(avgFn(prev7,"energy"))).toFixed(1) : "—";
  const sleepTrend  = prev7.length ? (parseFloat(avgFn(recent7,"sleep"))-parseFloat(avgFn(prev7,"sleep"))).toFixed(1)  : "—";
  const stressTrend = prev7.length ? (parseFloat(avgFn(recent7,"stress"))-parseFloat(avgFn(prev7,"stress"))).toFixed(1): "—";
  const reflections = recent7.filter(c=>c.reflection).slice(-3).map(c=>`"${c.reflection}"`).join(" / ");

  const pred4Msg = `IDAG: ${today}\nANTAL CHECK-INS: ${n}\nVARSEL-STATUS: ${varselStatus} (dag ${streak} av max 7)\n\nSENASTE CHECK-IN (${latest.date}):\nEnergi ${latest.energy}/10 · Sömn ${latest.sleep}/10 · Stress ${latest.stress}/10 · Fokus ${latest.focus}/10 · Motivation ${latest.motivation}/10\n\n7-DAGARSSNITT:\nEnergi ${avgFn(r7,"energy")} · Sömn ${avgFn(r7,"sleep")} · Stress ${avgFn(r7,"stress")}\n\nFÖRÄNDRINGSHASTIGHET (sista 3 vs föregående 4):\nEnergi: ${energyRate}/10 · Stress: ${stressRate}/10\n\nHISTORIK: ${crashHistory.length} perioder. Snittlängd: ${avgCrashLen} dagar.\n\nPROFIL: Namn: ${profile.q3_1||"Okänt"} · Ålder: ${profile.q3_2||"—"} · Energimönster: ${profile.q2_1||"—"}\n\nSvara EXAKT i detta JSON-format:\n{"varsel_status":"${varselStatus}","varsel_dag":${streak},"sannolikhet_krasch":0,"sannolikhet_avvärjning":0,"dagar_till_krasch":0,"kritisk_åtgärd":"...","insikt":"2–3 meningar om mönstret.","om_åtgärd":[{"metrik":"Energi imorgon","prediktion":"...","positiv":true}],"om_inget":[{"metrik":"Energi dag 3","prediktion":"...","positiv":false}],"tidslinje":[{"dag":"Nu","prognos":"...","status":"nu"},{"dag":"Dag ${streak+1}","prognos":"...","status":"framtid"}]}`;

  const ins3Msg = `KONTEXT: dashboard\nIDAG: ${today}\nANTAL CHECK-INS TOTALT: ${n}\n\nSENASTE CHECK-IN (${latest.date}):\nEnergi ${latest.energy}/10 · Sömn ${latest.sleep}/10 · Stress ${latest.stress}/10 · Fokus ${latest.focus}/10 · Motivation ${latest.motivation}/10\n\n7-DAGARSSNITT:\nEnergi ${avgFn(recent7,"energy")} · Sömn ${avgFn(recent7,"sleep")} · Stress ${avgFn(recent7,"stress")}\n\nTRENDER (sista 7 vs föregående 7):\nEnergi ${energyTrend>0?"+":""}${energyTrend} · Sömn ${sleepTrend>0?"+":""}${sleepTrend} · Stress ${stressTrend>0?"+":""}${stressTrend}\n\nVANLIGASTE KÄNSLOR: ${topMoods.join(", ")||"—"}\nVARSEL-STREAK: ${streak>0?`${streak} dagar`:"Ingen aktiv"}\n\nSENASTE REFLEKTIONER: ${reflections||"—"}\n${analyzeBio ? `\nOBJEKTIV DATA (prioritera avvikelser mot subjektivt):\n${analyzeBio}\n` : ""}\nPROFIL:\nNamn: ${profile.q3_1||"Okänt"} · Ålder: ${profile.q3_2||"—"}\nLivssituation: ${profile.q4_1||"—"}\nEnergimönster: ${profile.q2_1||"—"}\n\nSvara EXAKT i detta JSON-format:\n{"insikt":"2–3 meningar. Personlig, specifik insikt baserad på mönstret.","sammanfattning":"1 mening. Kortversion av systemets bedömning.","rekommendation":"1 konkret åtgärd.","styrka":"1 mening. Något positivt och äkta."}`;

  let prediction = null;
  let insight    = null;

  try {
    const [predResp, insResp] = await Promise.all([
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, system: AGENTS["4"] || "Du är Forsyne prediktions-agent. Svara alltid i JSON.", messages: [{ role: "user", content: pred4Msg }] })
      }),
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, system: AGENTS["3"] || "Du är Forsyne insikts-agent. Svara alltid i JSON.", messages: [{ role: "user", content: ins3Msg }] })
      })
    ]);
    const [predData, insData] = await Promise.all([predResp.json(), insResp.json()]);
    const predText = predData?.content?.[0]?.text || "";
    const insText  = insData?.content?.[0]?.text  || "";
    try { const m = predText.match(/\{[\s\S]*\}/); prediction = JSON.parse(m ? m[0] : predText); if (prediction) { prediction.varsel_status = varselStatus; prediction.varsel_dag = streak; } } catch {}
    try { const m = insText.match(/\{[\s\S]*\}/);  insight    = JSON.parse(m ? m[0] : insText);  } catch {}
  } catch(e) { console.error("[analyze] Agent 3/4 error:", e); }

  // Fallbacks
  if (!prediction) prediction = {
    varsel_status: varselStatus, varsel_dag: streak,
    sannolikhet_krasch: varselActive ? Math.min(95, 30 + streak * 15) : 5,
    sannolikhet_avvärjning: varselActive ? Math.max(30, 85 - streak * 10) : 95,
    dagar_till_krasch: varselActive ? Math.max(1, avgCrashLen - streak) : 0,
    kritisk_åtgärd: latest.sleep <= 5 ? "Prioritera sömnen ikväll." : latest.stress >= 7 ? "Sänk stressnivån." : "Håll det stabila mönstret.",
    insikt: varselActive ? `Stress och sömnbrist har samverkat ${streak} dagar i rad.` : "Inga aktiva varsel.",
    om_åtgärd: [], om_inget: [], tidslinje: []
  };
  if (!insight) insight = {
    insikt: snitt30d.stress < latest.stress ? `Stress ${latest.stress}/10 är över ditt snitt — och det syns i energin.` : `Systemet ser ett stabilt mönster i dina senaste ${n} check-ins.`,
    sammanfattning: varselActive ? "Varsel aktivt — fokusera på återhämtning." : "Systemet är stabilt.",
    rekommendation: latest.sleep <= 5 ? "Prioritera sömnen ikväll framför allt annat." : "Håll det stabila mönstret.",
    styrka: latest.energy >= 7 ? "Din energinivå håller sig stark." : "Du checkar in konsekvent — det är grunden."
  };

  // ─────────────────────────────────────────────────────────────
  // STEP 4 — Agent 9: Balance — reads Agent 3+4 output
  // ─────────────────────────────────────────────────────────────
  let balance = null;
  if (AGENTS["9"]) {
    try {
      const bal9Msg = buildBalanceMsg(sorted, profile, insight, prediction, today);
      const balResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, system: AGENTS["9"], messages: [{ role: "user", content: bal9Msg }] })
      });
      const balData = await balResp.json();
      const balText = balData?.content?.[0]?.text || "";
      try { const m = balText.match(/\{[\s\S]*\}/); balance = JSON.parse(m ? m[0] : balText); } catch {}
    } catch(e) { console.error("[analyze] Agent 9 error:", e); }
  }

  if (balance?.producerade_output && balance?.balans_tillägg_till_agent3 && insight) {
    insight.balans = balance.balans_tillägg_till_agent3;
  }
  if (balance?.avvärjnings_förstärkare?.length && prediction && varselActive) {
    prediction.avvärjnings_förstärkare = balance.avvärjnings_förstärkare;
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 5 — Persist to Supabase daily_data
  // ─────────────────────────────────────────────────────────────
  try {
    await supabase.from("daily_data").upsert({
      user_id:    req.user.id,
      date:       today,
      psi:        normalize.systempoäng.psi,
      normalize:  normalize,
      prediction: prediction,
      insight:    insight,
      balance:    balance,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id,date" });
  } catch(e) { console.error("[analyze] Supabase save error:", e.message); }

  res.json({ normalize, prediction, insight, balance, generated_at: new Date().toISOString() });
});

// ── ALIAS ROUTES — thin proxies to existing agent endpoints ──
async function proxyToAgent(req, res, targetPath) {
  try {
    const r = await fetch(`http://localhost:${process.env.PORT || 3000}${targetPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": req.headers.authorization || "" },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch(e) { res.status(500).json({ error: "Proxy failed" }); }
}
app.post("/api/insights/daily",  auth, (req, res) => proxyToAgent(req, res, "/api/agent/insights/generate"));
app.post("/api/predict",         auth, (req, res) => proxyToAgent(req, res, "/api/agent/prediction/generate"));
app.post("/api/data/normalize",  auth, (req, res) => proxyToAgent(req, res, "/api/agent/datasources/normalize"));

// ── TRÄNINGSSCHEMA ──
app.get("/api/training-schedule", auth, async (req, res) => {
  const { data, error } = await supabase.from("training_schedule").select("*").eq("user_id", req.user.id).order("dag");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/training-schedule", auth, async (req, res) => {
  const { schedule } = req.body; // array of { dag, typ, fokus, intensitet, varaktighet, anteckningar }
  if (!Array.isArray(schedule)) return res.status(400).json({ error: "schedule måste vara en array" });
  // Upsert each day
  const rows = schedule.map(s => ({ ...s, user_id: req.user.id, updated_at: new Date().toISOString() }));
  const { error } = await supabase.from("training_schedule").upsert(rows, { onConflict: "user_id,dag" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── MÅLTIDSLOGG ──
// GET  /api/nutrition-log?date=YYYY-MM-DD
app.get("/api/nutrition-log", auth, async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("nutrition_log").select("*")
    .eq("user_id", req.user.id).eq("date", date)
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/nutrition-log
app.post("/api/nutrition-log", auth, async (req, res) => {
  const { date, meal_type, food_name, brand, barcode, serving_g, kcal, protein_g, carbs_g, fat_g } = req.body;
  if (!date || !meal_type || !food_name) return res.status(400).json({ error: "date, meal_type och food_name krävs" });
  const { data, error } = await supabase.from("nutrition_log").insert({
    user_id: req.user.id, date, meal_type, food_name, brand: brand || null,
    barcode: barcode || null, serving_g: serving_g || null,
    kcal: kcal || null, protein_g: protein_g || null, carbs_g: carbs_g || null, fat_g: fat_g || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/nutrition-log/:id
app.delete("/api/nutrition-log/:id", auth, async (req, res) => {
  const { error } = await supabase.from("nutrition_log").delete()
    .eq("id", req.params.id).eq("user_id", req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── KOSTPROTOKOLL ──
app.get("/api/nutrition-protocol", auth, async (req, res) => {
  const { data, error } = await supabase.from("nutrition_protocol").select("*").eq("user_id", req.user.id).single();
  if (error && error.code !== "PGRST116") return res.status(500).json({ error: error.message });
  res.json(data || null);
});

app.post("/api/nutrition-protocol", auth, async (req, res) => {
  const p = req.body;
  const { error } = await supabase.from("nutrition_protocol").upsert({ ...p, user_id: req.user.id, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── SCHEMA-AGENT — dagens rekommendation baserad på nuläge × plan ──
app.post("/api/agent/schedule/recommend", auth, async (req, res) => {
  const userId = req.user.id;
  try {
    const [checkinsRes, scheduleRes, protocolRes, profileRes] = await Promise.all([
      supabase.from("checkins").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(14),
      supabase.from("training_schedule").select("*").eq("user_id", userId),
      supabase.from("nutrition_protocol").select("*").eq("user_id", userId).single(),
      supabase.from("profiles").select("data").eq("user_id", userId).single()
    ]);

    const checkins = decryptCheckins(checkinsRes.data || []);
    const schedule = scheduleRes.data || [];
    const protocol = protocolRes.data || null;
    const profile  = decryptProfile(profileRes.data?.data || {});

    if (!checkins.length) return res.json({ ok: false, reason: "inga check-ins" });

    const latest = checkins[0]; // most recent
    const today  = new Date().toLocaleDateString("sv-SE", { weekday: "long" });
    const todayCapitalized = today.charAt(0).toUpperCase() + today.slice(1);
    const todayPlan = schedule.find(s => s.dag.toLowerCase() === today.toLowerCase()) || null;

    // PSI
    const psiOf = c => {
      const vals = [c.energy, c.sleep ? c.sleep : null, c.stress ? 10 - c.stress : null, c.focus, c.motivation].filter(v => v != null);
      return vals.length >= 3 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) : null;
    };
    const psi = psiOf(latest);

    // 7-day averages
    const avg7 = key => { const v = checkins.slice(0,7).map(c=>c[key]).filter(v=>v!=null); return v.length ? (v.reduce((a,b)=>a+b,0)/v.length).toFixed(1) : null; };

    const contextMsg = `
NULÄGE (${todayCapitalized}):
PSI: ${psi ?? '?'}
Sömn: ${latest.sleep ?? '?'}
Energi: ${latest.energy ?? '?'}
Stress: ${latest.stress ?? '?'}
Fokus: ${latest.focus ?? '?'}
Motivation: ${latest.motivation ?? '?'}

7-DAGARSSNITT:
Sömn: ${avg7('sleep')} | Energi: ${avg7('energy')} | Stress: ${avg7('stress')}

PLANERAD TRÄNING IDAG:
${todayPlan ? `${todayPlan.typ || 'Okänd typ'} · ${todayPlan.fokus || ''} · Intensitet ${todayPlan.intensitet ?? '?'}/10 · ${todayPlan.varaktighet ?? '?'} min` : 'Ingen träning planerad'}

VECKOSCHEMA:
${schedule.map(s => `${s.dag}: ${s.typ || 'vila'} ${s.fokus ? '· '+s.fokus : ''} intensitet ${s.intensitet ?? '?'}/10`).join('\n') || 'Inget schema satt'}

KOSTPROTOKOLL:
${protocol ? `Fastar: ${protocol.fastar ? protocol.fastfönster || 'ja' : 'nej'} | Kolhydratsstrategi: ${protocol.kolhydratsstrategi || 'normal'} | Kolhydrater: ${protocol.kolhydrater_gram ?? '?'}g | Protein: ${protocol.protein_gram ?? '?'}g | Kalorier: ${protocol.kalorier ?? '?'}` : 'Inget protokoll satt'}
${protocol?.anteckningar ? 'Anteckningar: ' + protocol.anteckningar : ''}

PROFIL:
${profile.q3_1 ? 'Namn: ' + profile.q3_1 : ''}
${profile._profile ? 'Profil: ' + profile._profile : ''}
${profile._training_goal ? 'Träningsmål: ' + profile._training_goal : ''}

SENASTE 7 CHECK-INS (nyast först):
${checkins.slice(0,7).map((c,i) => `dag-${i+1} (${c.date}): sömn=${c.sleep??'?'} energi=${c.energy??'?'} stress=${c.stress??'?'}`).join('\n')}
`;

    const SCHEDULE_PROMPT = `Du är Forsyne schemaagent. Du tar emot användarens nuläge, planerade träning och kostprotokoll — och anpassar dagens plan baserat på hens faktiska biologiska kapacitet just nu.

Du är inte en personlig tränare som ger generella råd. Du är ett system som känner den här personen och säger exakt vad de ska göra idag — och varför, baserat på deras data.

Returnera alltid JSON med exakt dessa nycklar:

{
  "träning": {
    "kör_planerat": true/false,
    "rekommendation": "string — vad de ska göra idag (max 120 tecken)",
    "modifiering": "string — om avvikelse: vad som ändrats och varför (max 120 tecken), annars null",
    "intensitet_idag": number (1-10),
    "fokus_idag": "string",
    "varning": "string — om kritisk signal, annars null"
  },
  "kost": {
    "följ_protokoll": true/false,
    "justering": "string — specifik justering för idag om avvikelse (max 120 tecken), annars null",
    "prioritet_idag": "string — vad som är viktigast att äta/undvika idag (max 120 tecken)",
    "timing": "string — när och vad om relevant (max 120 tecken), annars null"
  },
  "systeminsikt": "string — ett mening om varför idag ser ut som det gör, baserat på datan (max 120 tecken)"
}

Regler:
- Aldrig generella råd. Alltid baserat på nuläget du fått.
- PSI under 55: kör aldrig planerat tungt pass. Modifiera alltid.
- PSI 55-70: kör planerat men sänk intensitet 1-2 enheter.
- PSI över 70: kör planerat.
- Om fastar och PSI under 60 + tung träning planerad: justera alltid kolhydrater upp kvällen/morgonen.
- Inga förbjudna ord: optimal, resa, potential, bästa version.
- Skriv som om du vet — för det gör du.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: SCHEDULE_PROMPT,
        messages: [{ role: "user", content: contextMsg }]
      })
    });

    const apiData = await resp.json();
    if (apiData.error) return res.status(500).json({ error: apiData.error.message });

    const text = apiData?.content?.[0]?.text || "";
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[1] : text);

    res.json({ ok: true, dag: todayCapitalized, psi, plan: todayPlan, ...parsed });
  } catch (e) {
    console.error("[schedule-agent]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── MORGON-BRIEFING (Agent 11) ─────────────────────────────────────
// Orkestrerar prediktion + schema + check-in + väder till ETT narrativ.
// Callable från cron eller HTTP — ingen intern HTTP-roundtrip.

const AGENT_11_PROMPT = fs.readFileSync(
  path.join(__dirname, "agents", "agent_11_briefing.md"), "utf8"
) + "\n\n" + AGENT_GUARDRAILS;

const AGENT_13_PROMPT = fs.readFileSync(
  path.join(__dirname, "agents", "agent_13_interpreter.md"), "utf8"
) + "\n\n" + AGENT_GUARDRAILS;

const AGENT_14_PROMPT = fs.readFileSync(
  path.join(__dirname, "agents", "agent_14_historical.md"), "utf8"
) + "\n\n" + AGENT_GUARDRAILS;

async function fetchSMHIForecast(lat, lon) {
  // SMHI snow1gv1 — ersätter pmp3g som deprecerades 2026-03-31.
  // Coordinates max 6 decimaler, inom Nordisk täckning.
  const url = `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/${lon}/lat/${lat}/data.json`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: { "User-Agent": "Forsyne/1.0 (forsyne.se)" }
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  const now  = json.timeSeries?.[0]?.data;
  if (!now) return null;
  const octas = now.cloud_area_fraction; // 0–8
  return {
    temp_c:       now.air_temperature ?? null,
    nederbord_mm: now.precipitation_amount_mean ?? null,
    vind_ms:      now.wind_speed ?? null,
    moln_procent: typeof octas === "number" ? Math.round(octas / 8 * 100) : null
  };
}

function buildUserProfileBlock(profile) {
  const lines = ["=== ANVÄNDARPROFIL (stabil kontext) ==="];
  if (profile.q3_1)           lines.push(`Namn: ${profile.q3_1}`);
  if (profile.q3_2)           lines.push(`Ålder: ${profile.q3_2}`);
  if (profile.q3_3)           lines.push(`Kön: ${profile.q3_3}`);
  if (profile.q3_weight)      lines.push(`Vikt: ${profile.q3_weight} kg`);
  if (profile.q4_1)           lines.push(`Yrke: ${profile.q4_1}`);
  if (profile.q7_1)           lines.push(`Träning: ${profile.q7_1} pass/vecka`);
  if (profile.q7_3)           lines.push(`Träningsintensitet: ${profile.q7_3}/10`);
  if (profile._training_goal) lines.push(`Träningsmål: ${profile._training_goal}`);
  if (profile._profile)       lines.push(`Arketyp: ${profile._profile}`);
  if (profile.q2_9)           lines.push(`Relation till vila: ${profile.q2_9}`);
  if (profile.q6_1)           lines.push(`Sömnmönster: ${profile.q6_1}`);
  if (profile.q5_1 || profile.kroniska) {
    lines.push(`Kroniska tillstånd: ${profile.q5_1 || profile.kroniska}`);
  }
  return lines.join("\n");
}

function summarizeLabTest(t) {
  if (!t) return null;
  const parts = [];
  if (t.vo2max != null)               parts.push(`VO2max ${t.vo2max}`);
  if (t.lt1_watts != null)            parts.push(`LT1 ${t.lt1_watts}W${t.lt1_bpm ? `/${t.lt1_bpm}bpm` : ""}`);
  if (t.lt2_watts != null)            parts.push(`LT2 ${t.lt2_watts}W${t.lt2_bpm ? `/${t.lt2_bpm}bpm` : ""}`);
  if (t.body_fat_pct != null)         parts.push(`fett ${t.body_fat_pct}%`);
  if (t.muscle_mass_kg != null)       parts.push(`muskelmassa ${t.muscle_mass_kg}kg`);
  if (t.bone_density_t_score != null) parts.push(`bentäthet T=${t.bone_density_t_score}`);
  if (t.weight_kg != null)            parts.push(`vikt ${t.weight_kg}kg`);
  if (!parts.length) return null;
  return {
    datum:      t.date,
    leverantör: t.provider || null,
    summering:  parts.join(" · "),
    noteringar: t.notes || null
  };
}

function buildBriefingInput({ today, checkins, todayPlan, profile, prediction, weather, latestLab }) {
  const latest = checkins[0];
  const avg7 = key => {
    const v = checkins.slice(0, 7).map(c => c[key]).filter(v => v != null);
    return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)) : null;
  };
  const daysToRace = profile._race_date
    ? Math.max(0, Math.round((new Date(profile._race_date) - new Date()) / 86400000))
    : null;

  return {
    datum: today,
    prediktion: prediction || { varsel_status: "ingen", varsel_dag: 0 },
    checkin: {
      energi:     latest.energy,
      sömn:       latest.sleep,
      stress:     latest.stress,
      fokus:      latest.focus,
      motivation: latest.motivation,
      fri_text:   latest.fri_text || ""
    },
    kontext: {
      dag_i_veckan:         new Date().toLocaleDateString("sv-SE", { weekday: "long" }),
      dagens_plan_i_schema: todayPlan
        ? `${todayPlan.typ || "okänd"} · ${todayPlan.fokus || ""} · intensitet ${todayPlan.intensitet ?? "?"}/10 · ${todayPlan.varaktighet ?? "?"} min`
        : "Ingen träning planerad",
      väder_prognos: weather,
      kommande_tävling: profile._race_name
        ? { namn: profile._race_name, dagar_till: daysToRace }
        : null,
      labbtest_senast: summarizeLabTest(latestLab)
    },
    historik_kort: {
      energi_snitt_7d: avg7("energy"),
      sömn_snitt_7d:   avg7("sleep"),
      stress_snitt_7d: avg7("stress"),
      senaste_datum:   checkins.slice(0, 7).map(c => c.date)
    }
  };
}

async function generateMorningBriefing(userId) {
  const today = new Date().toISOString().split("T")[0];

  const [checkinsRes, scheduleRes, profileRes, predictionRes, labRes] = await Promise.all([
    supabase.from("checkins").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(14),
    supabase.from("training_schedule").select("*").eq("user_id", userId),
    supabase.from("profiles").select("data").eq("user_id", userId).single(),
    supabase.from("predictions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("lab_tests").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(1).maybeSingle()
  ]);

  const checkins   = decryptCheckins(checkinsRes.data || []);
  const schedule   = scheduleRes.data || [];
  const profile    = decryptProfile(profileRes.data?.data || {});
  const prediction = predictionRes.data || null;
  const latestLab  = labRes.data || null;

  if (!checkins.length) return { ok: false, reason: "inga_checkins" };

  const weekday   = new Date().toLocaleDateString("sv-SE", { weekday: "long" });
  const todayPlan = schedule.find(s => s.dag?.toLowerCase() === weekday.toLowerCase()) || null;
  const weather   = (profile._lat && profile._lon)
    ? await fetchSMHIForecast(profile._lat, profile._lon).catch(() => null)
    : null;

  const agentInput = buildBriefingInput({ today, checkins, todayPlan, profile, prediction, weather, latestLab });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":     "application/json",
      "x-api-key":        process.env.ANTHROPIC_API_KEY,
      "anthropic-version":"2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: [
        { type: "text", text: AGENT_11_PROMPT, cache_control: { type: "ephemeral" } }
      ],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: buildUserProfileBlock(profile), cache_control: { type: "ephemeral" } },
          { type: "text", text: JSON.stringify(agentInput, null, 2) }
        ]
      }]
    })
  });

  const apiData = await resp.json();
  if (apiData.error) {
    console.error("[briefing] Anthropic-fel:", apiData.error.message);
    return { ok: false, reason: "api_error", message: apiData.error.message };
  }

  const narrative = apiData?.content?.[0]?.text?.trim() || "";
  const usage     = apiData?.usage || {};

  const { error: insertErr } = await supabase.from("briefings").insert({
    user_id:            userId,
    date:               today,
    narrative,
    varsel_status:      prediction?.varsel_status || null,
    input_used:         agentInput,
    tokens_input:       usage.input_tokens || 0,
    tokens_output:      usage.output_tokens || 0,
    tokens_cache_read:  usage.cache_read_input_tokens || 0,
    tokens_cache_write: usage.cache_creation_input_tokens || 0
  });
  if (insertErr) console.error("[briefing] DB insert-fel:", insertErr.message);

  return {
    ok: true,
    narrative,
    varsel_status: prediction?.varsel_status || null,
    tokens: {
      input:       usage.input_tokens || 0,
      output:      usage.output_tokens || 0,
      cache_read:  usage.cache_read_input_tokens || 0,
      cache_write: usage.cache_creation_input_tokens || 0
    }
  };
}

// POST — on-demand-generering (test / manuell uppdatering)
app.post("/api/agent/briefing/generate", auth, async (req, res) => {
  try {
    const out = await generateMorningBriefing(req.user.id);
    if (!out.ok) {
      const status = out.reason === "inga_checkins" ? 400 : 500;
      return res.status(status).json(out);
    }
    // Skicka test-email endast vid ?email=1 (för dev/pilot-test, ingen auto-mailing)
    if (req.query.email === "1" && out.narrative) {
      const { data: userData } = await supabase.auth.admin.getUserById(req.user.id);
      const email = userData?.user?.email;
      if (email) {
        const r = await sendBriefingEmail(email, "", out.narrative, svDateLabel(new Date()), req.user.id);
        out.email_sent  = r.ok;
        out.email_error = r.ok ? null : (r.reason + (r.status ? ` (${r.status})` : ""));
      } else {
        out.email_error = "no_email";
      }
    }
    res.json(out);
  } catch (e) {
    console.error("[briefing-agent]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET — dagens briefing (för in-app "idag"-kort)
app.get("/api/briefing/today", auth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const { data, error } = await supabase
      .from("briefings")
      .select("narrative, varsel_status, created_at")
      .eq("user_id", req.user.id)
      .eq("date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    res.json({ ok: true, briefing: data || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GARMIN-TOLKARE (Agent 13) ─────────────────────────────────
// Basic-tier: smart tolkning av enbart Garmin-data utan check-ins.
// Cachas i briefings-tabellen med varsel_status='interpretation' så
// samma dag återanvänds — undviker Claude-anrop vid varje sidladdning.

async function generateGarminInterpretation(userId) {
  const today = new Date().toISOString().split("T")[0];

  const [intRes, profRes] = await Promise.all([
    supabase.from("integrations").select("provider, data").eq("user_id", userId),
    supabase.from("profiles").select("data").eq("user_id", userId).single()
  ]);

  const integrations = intRes.data || [];
  const garmin = integrations.find(i => i.provider === "garmin")?.data;
  const profile = decryptProfile(profRes.data?.data || {});

  if (!garmin) return { ok: false, reason: "no_garmin_data" };

  // Sammanfatta Garmin-data för agenten
  const lines = [`DATUM: ${today}`];

  const age = profile.q3_2 ? Number(profile.q3_2) : null;
  const sex = profile.q3_3 || null;
  if (age) lines.push(`Ålder: ${age}`);
  if (sex) lines.push(`Kön: ${sex}`);

  const series = (key, valueKey, n, formatter) => {
    const arr = garmin[key];
    if (!Array.isArray(arr) || !arr.length) return;
    lines.push(`\n${key.toUpperCase()} senaste ${Math.min(n, arr.length)} dagarna:`);
    arr.slice(0, n).forEach(r => {
      lines.push(`  ${r.date}: ${formatter(r)}`);
    });
  };

  series("hrv",          "avg_hrv",       7,  r => `${r.avg_hrv}ms`);
  series("sleep",        "duration_hours",7,  r => `${r.duration_hours}h (djup ${r.deep_sleep_hours || '?'}h)`);
  series("body_battery", "start_of_day",  7,  r => `start ${r.start_of_day}`);
  series("resting_hr",   "bpm",           7,  r => `${r.bpm} bpm`);

  if (Array.isArray(garmin.activities) && garmin.activities.length) {
    lines.push(`\nSENASTE AKTIVITETER:`);
    garmin.activities.slice(0, 7).forEach(a => {
      lines.push(`  ${a.date} ${a.name || a.sport}: ${a.duration_min || '?'}min, avg HR ${a.avg_hr || '?'}, kalorier ${a.calories || '?'}`);
    });
  }

  if (Array.isArray(garmin.training_load) && garmin.training_load.length) {
    lines.push(`\nTRÄNINGSBELASTNING senaste 7 dagarna:`);
    garmin.training_load.slice(0, 7).forEach(t => {
      lines.push(`  ${t.date}: akut ${t.acute}${t.chronic ? ` kronisk ${t.chronic}` : ''}`);
    });
  }

  const context = lines.join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: [
        { type: "text", text: AGENT_13_PROMPT, cache_control: { type: "ephemeral" } }
      ],
      messages: [{ role: "user", content: context }]
    }),
    signal: AbortSignal.timeout(30000)
  });

  const apiData = await resp.json();
  if (apiData.error) {
    console.error("[interpretation] Anthropic-fel:", apiData.error.message);
    return { ok: false, reason: "api_error", message: apiData.error.message };
  }

  const narrative = apiData?.content?.[0]?.text?.trim() || "";
  const usage = apiData?.usage || {};

  return {
    ok: true,
    narrative,
    tokens: {
      input:       usage.input_tokens || 0,
      output:      usage.output_tokens || 0,
      cache_read:  usage.cache_read_input_tokens || 0,
      cache_write: usage.cache_creation_input_tokens || 0
    }
  };
}

// GET — Garmin-tolkning för dagen (basic-tier)
// Cachar i briefings-tabellen så vi inte anropar Claude vid varje sidladdning.
app.get("/api/interpretation/today", auth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    // Kolla om vi redan har genererat en tolkning idag
    const { data: existing } = await supabase
      .from("briefings")
      .select("narrative, created_at")
      .eq("user_id", req.user.id)
      .eq("date", today)
      .eq("varsel_status", "interpretation")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.narrative) {
      return res.json({ ok: true, interpretation: existing.narrative, cached: true });
    }

    // Generera ny
    const out = await generateGarminInterpretation(req.user.id);
    if (!out.ok) return res.json(out);

    // Cacha i briefings-tabellen
    const { error: insertErr } = await supabase.from("briefings").insert({
      user_id:            req.user.id,
      date:               today,
      narrative:          out.narrative,
      varsel_status:      "interpretation",
      tokens_input:       out.tokens.input,
      tokens_output:      out.tokens.output,
      tokens_cache_read:  out.tokens.cache_read,
      tokens_cache_write: out.tokens.cache_write
    });
    if (insertErr) console.error("[interpretation] cache insert-fel:", insertErr.message);

    res.json({ ok: true, interpretation: out.narrative, cached: false });
  } catch (e) {
    console.error("[interpretation]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── RETROSPEKTIV ANALYS (Agent 14) ─────────────────────────────
// Läser bakåt i användarens historik och beskriver vad Forsyne skulle
// ha sett. Levererar aha-moment på dag 1 istället för vecka 4.
// Cachas i briefings-tabellen med varsel_status='retrospective'.

async function generateHistoricalAnalysis(userId) {
  const [crashesResult, checkinsRes, profRes] = await Promise.all([
    identifyCrashEpisodes(userId),
    supabase.from("checkins").select("date").eq("user_id", userId).order("date", { ascending: true }).limit(1),
    supabase.from("profiles").select("data").eq("user_id", userId).single()
  ]);

  const profile = decryptProfile(profRes.data?.data || {});
  const firstCheckin = checkinsRes.data?.[0]?.date || null;
  const totalCrashes = crashesResult.total || 0;
  const episodes = crashesResult.episodes || [];

  const lines = [];
  if (firstCheckin) {
    const daysOfData = Math.max(1, Math.round((new Date() - new Date(firstCheckin)) / 86400000));
    lines.push(`DATAFÖNSTER: ${daysOfData} dagar (första check-in ${firstCheckin})`);
  }
  lines.push(`ANTAL IDENTIFIERADE KRASCHSEKVENSER: ${totalCrashes}`);
  lines.push(`GENOMSNITTLIG LÄNGD: ${crashesResult.avg_duration_days || "—"} dagar`);

  if (profile.q3_2) lines.push(`Ålder: ${profile.q3_2}`);
  if (profile.q3_3) lines.push(`Kön: ${profile.q3_3}`);

  if (!episodes.length) {
    lines.push(`\nINGA KRASCHEPISODER ÄNNU REGISTRERADE.`);
  } else {
    lines.push(`\nEPISODER (nyast först):`);
    for (const ep of episodes.slice(0, 8)) {
      lines.push(`\n— ${ep.start_date} till ${ep.end_date} (${ep.duration_days} dagar, ${ep.type})`);
      if (ep.trigger_text) lines.push(`  Trigger-text: "${ep.trigger_text}"`);
      if (ep.preceding_signals_7d && ep.preceding_signals_7d.length) {
        lines.push(`  Signaler 7 dagar innan:`);
        ep.preceding_signals_7d.forEach(p => {
          lines.push(`    ${p.date}: energi=${p.energy??'?'} sömn=${p.sleep??'?'} stress=${p.stress??'?'} motivation=${p.motivation??'?'}`);
        });
      } else {
        lines.push(`  (Inga föregångsdata — episod för tidigt i historiken)`);
      }
    }
  }

  const context = lines.join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 900,
      system: [
        { type: "text", text: AGENT_14_PROMPT, cache_control: { type: "ephemeral" } }
      ],
      messages: [{ role: "user", content: context }]
    }),
    signal: AbortSignal.timeout(45000)
  });

  const apiData = await resp.json();
  if (apiData.error) {
    console.error("[historical] Anthropic-fel:", apiData.error.message);
    return { ok: false, reason: "api_error", message: apiData.error.message };
  }

  const narrative = apiData?.content?.[0]?.text?.trim() || "";
  const usage = apiData?.usage || {};

  return {
    ok:           true,
    narrative,
    crash_count:  totalCrashes,
    episodes:     episodes.slice(0, 8),
    tokens: {
      input:       usage.input_tokens || 0,
      output:      usage.output_tokens || 0,
      cache_read:  usage.cache_read_input_tokens || 0,
      cache_write: usage.cache_creation_input_tokens || 0
    }
  };
}

// GET — retrospektiv analys (cachas i briefings-tabellen)
// Generaras en gång per vecka, returnerar cache-version däremellan.
app.get("/api/historical/analysis", auth, async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    // Kolla om vi har cachat analys senaste 7 dagarna
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const { data: cached } = await supabase
      .from("briefings")
      .select("narrative, created_at")
      .eq("user_id", req.user.id)
      .eq("varsel_status", "retrospective")
      .gte("date", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.narrative) {
      return res.json({ ok: true, analysis: cached.narrative, cached: true });
    }

    const out = await generateHistoricalAnalysis(req.user.id);
    if (!out.ok) return res.json(out);

    const { error: insertErr } = await supabase.from("briefings").insert({
      user_id:            req.user.id,
      date:               today,
      narrative:          out.narrative,
      varsel_status:      "retrospective",
      tokens_input:       out.tokens.input,
      tokens_output:      out.tokens.output,
      tokens_cache_read:  out.tokens.cache_read,
      tokens_cache_write: out.tokens.cache_write
    });
    if (insertErr) console.error("[historical] cache insert-fel:", insertErr.message);

    res.json({
      ok: true,
      analysis: out.narrative,
      crash_count: out.crash_count,
      cached: false
    });
  } catch (e) {
    console.error("[historical]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── EMAIL (Resend) — briefing-leverans ─────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function svDateLabel(d) {
  const months = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function unsubscribeToken(userId) {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.ENCRYPTION_KEY || "dev-unsubscribe-secret";
  const hmac = crypto.createHmac("sha256", secret).update(userId).digest("hex").slice(0, 16);
  return `${userId}.${hmac}`;
}

function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== "string") return null;
  const [userId, hmac] = token.split(".");
  if (!userId || !hmac) return null;
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.ENCRYPTION_KEY || "dev-unsubscribe-secret";
  const expected = crypto.createHmac("sha256", secret).update(userId).digest("hex").slice(0, 16);
  try {
    if (hmac.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
  } catch { return null; }
  return userId;
}

async function sendWaitlistConfirmEmail(toEmail, toName) {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: "no_api_key" };

  const firstName = (toName || "").split(" ")[0] || "";
  const greeting = firstName ? `Hej ${firstName.replace(/[^A-Za-zÅÄÖåäöÉé\-]/g, "")},` : "Hej,";

  const html = `<!DOCTYPE html>
<html lang="sv"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2F0EA;font-family:Georgia,'Cormorant Garamond',serif;">
<div style="max-width:560px;margin:0 auto;padding:48px 30px;">
  <div style="font-family:'Jost',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#8A8E89;margin-bottom:36px;">Forsyne</div>
  <div style="font-size:17px;line-height:1.65;color:#0F1210;">
    <p style="margin:0 0 1em 0;">${greeting}</p>
    <p style="margin:0 0 1em 0;">Tack för din anmälan till Forsyne-betan.</p>
    <p style="margin:0 0 1em 0;">Jag går igenom varje anmälan personligen. Piloten startar under maj med ett begränsat antal atleter som täcker in olika tränings- och wearable-profiler.</p>
    <p style="margin:0 0 1em 0;">Du hör av mig inom 72 timmar — antingen med pilot-invite eller med ett ärligt "vi tar in fler i nästa våg".</p>
    <p style="margin:0;">Carl</p>
  </div>
  <div style="margin-top:40px;padding-top:24px;border-top:1px solid rgba(15,18,16,0.08);font-family:'Jost',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;">
    <a href="https://forsyne.se/" style="color:#8A8E89;text-decoration:none;border-bottom:1px solid rgba(15,18,16,0.15);">forsyne.se</a>
  </div>
</div></body></html>`;

  const text = `${greeting}\n\nTack för din anmälan till Forsyne-betan.\n\nJag går igenom varje anmälan personligen. Piloten startar under maj med ett begränsat antal atleter som täcker in olika tränings- och wearable-profiler.\n\nDu hör av mig inom 72 timmar — antingen med pilot-invite eller med ett ärligt "vi tar in fler i nästa våg".\n\nCarl\nforsyne.se`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Forsyne <briefing@forsyne.se>",
      to: [toEmail],
      subject: "Tack — vi syns snart",
      html,
      text
    })
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("[waitlist-email] Resend-fel:", resp.status, body.slice(0, 200));
    return { ok: false, reason: "resend_error", status: resp.status };
  }
  return { ok: true };
}

async function sendBriefingEmail(toEmail, toName, narrative, dateLabel, userId) {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: "no_api_key" };

  const unsubUrl = `https://forsyne.se/api/briefing/unsubscribe?t=${unsubscribeToken(userId)}`;
  const appUrl   = `https://forsyne.se/app/today.html`;
  const paragraphs = narrative.split(/\n\n+/).filter(Boolean);
  const htmlParas  = paragraphs.map(p => `<p style="margin:0 0 1em 0;">${escapeHtml(p)}</p>`).join("");

  const html = `<!DOCTYPE html>
<html lang="sv"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F2F0EA;font-family:Georgia,'Cormorant Garamond',serif;">
<div style="max-width:560px;margin:0 auto;padding:48px 30px;">
  <div style="font-family:'Jost',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#8A8E89;">Forsyne</div>
  <div style="font-family:'Jost',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#8A8E89;margin-top:6px;margin-bottom:36px;">Morgonens observation · ${escapeHtml(dateLabel)}</div>
  <div style="font-size:17px;line-height:1.65;color:#0F1210;">${htmlParas}</div>
  <div style="margin-top:40px;padding-top:24px;border-top:1px solid rgba(15,18,16,0.08);font-family:'Jost',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;">
    <a href="${appUrl}" style="color:#8A8E89;text-decoration:none;border-bottom:1px solid rgba(15,18,16,0.15);">Öppna idag i appen</a>
    &nbsp;·&nbsp;
    <a href="${unsubUrl}" style="color:#8A8E89;text-decoration:none;border-bottom:1px solid rgba(15,18,16,0.15);">Avsluta morgonmail</a>
  </div>
</div></body></html>`;

  const text = `FORSYNE — Morgonens observation · ${dateLabel}\n\n${narrative}\n\n—\nÖppna idag i appen: ${appUrl}\nAvsluta morgonmail: ${unsubUrl}`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Forsyne <briefing@forsyne.se>",
      to: [toEmail],
      subject: `Morgonens observation — ${dateLabel}`,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
      }
    })
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return { ok: false, reason: "resend_error", status: resp.status, body: body.slice(0, 200) };
  }
  const data = await resp.json().catch(() => ({}));
  return { ok: true, id: data.id };
}

// GET — avsluta morgonmail (unauth, HMAC-token krävs)
app.get("/api/briefing/unsubscribe", async (req, res) => {
  const userId = verifyUnsubscribeToken(req.query.t);
  if (!userId) return res.status(400).type("text/html").send("<p>Ogiltig länk.</p>");
  try {
    await supabase.from("profiles").update({ email_briefing_disabled: true }).eq("user_id", userId);
  } catch (e) {
    console.error("[unsubscribe]", e.message);
    return res.status(500).type("text/html").send("<p>Kunde inte spara. Försök igen.</p>");
  }
  res.type("text/html").send(`<!DOCTYPE html>
<html lang="sv"><head><meta charset="UTF-8"><title>Avslutat</title>
<style>body{font-family:Georgia,serif;background:#F2F0EA;color:#0F1210;padding:56px 24px;max-width:500px;margin:0 auto;line-height:1.6;}
.meta{color:#8A8E89;font-family:system-ui,sans-serif;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;}
h2{font-weight:300;margin-top:16px;font-size:1.6rem;}</style>
</head><body>
<div class="meta">Forsyne</div>
<h2>Du får inga fler morgonmail.</h2>
<p>Din morgon-observation finns fortfarande i appen varje dag.</p>
</body></html>`);
});

// ── CHAT (Agent 12) ─────────────────────────────────────────────
const AGENT_12_PROMPT = fs.readFileSync(
  path.join(__dirname, "agents", "agent_12_chat.md"), "utf8"
) + "\n\n" + AGENT_GUARDRAILS;

async function buildChatContext(userId) {
  const [checkinsRes, profRes, intRes, briefingsRes, labsRes] = await Promise.all([
    supabase.from("checkins").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(30),
    supabase.from("profiles").select("data").eq("user_id", userId).single(),
    supabase.from("integrations").select("provider, data").eq("user_id", userId),
    supabase.from("briefings").select("narrative, date").eq("user_id", userId).order("date", { ascending: false }).limit(3),
    supabase.from("lab_tests").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(3)
  ]);

  const checkins    = decryptCheckins(checkinsRes.data || []);
  const profile     = decryptProfile(profRes.data?.data || {});
  const integrations = intRes.data || [];
  const briefings   = briefingsRes.data || [];
  const labs        = labsRes.data || [];

  const get = (provider) => integrations.find(i => i.provider === provider)?.data || null;
  const garmin    = get("garmin");
  const dexcom    = get("dexcom");
  const blood     = get("blood_labs");
  const dna       = get("dna");
  const nutrition = get("cronometer");

  const lines = ["=== ANVÄNDARENS DATA ==="];

  lines.push("\n--- PROFIL ---");
  if (profile.q3_1)           lines.push(`Namn: ${profile.q3_1}`);
  if (profile.q3_2)           lines.push(`Ålder: ${profile.q3_2}`);
  if (profile.q3_3)           lines.push(`Kön: ${profile.q3_3}`);
  if (profile.q3_weight)      lines.push(`Vikt: ${profile.q3_weight} kg`);
  if (profile.q4_1)           lines.push(`Yrke: ${profile.q4_1}`);
  if (profile.q7_1)           lines.push(`Träning: ${profile.q7_1} pass/vecka`);
  if (profile.q7_3)           lines.push(`Träningsintensitet: ${profile.q7_3}/10`);
  if (profile._training_goal) lines.push(`Träningsmål: ${profile._training_goal}`);
  if (profile._profile)       lines.push(`Arketyp: ${profile._profile}`);
  if (profile.q1_1)           lines.push(`Motivation: ${profile.q1_1}`);
  if (profile.q2_1)           lines.push(`Kronotyp: ${profile.q2_1}`);
  if (profile.q2_6)           lines.push(`Stresshantering: ${profile.q2_6}`);
  if (profile.q2_9)           lines.push(`Relation till vila: ${profile.q2_9}`);
  if (profile.q6_1)           lines.push(`Sömnmönster: ${profile.q6_1}`);
  if (profile.q6_2)           lines.push(`Vaknar utvilad: ${profile.q6_2}`);
  if (profile.q8_1)           lines.push(`Kostpreferenser: ${profile.q8_1}`);
  if (profile.q8_4)           lines.push(`Kaffe: ${profile.q8_4}`);
  if (profile.q5_1 || profile.kroniska) {
    lines.push(`Kroniska tillstånd: ${profile.q5_1 || profile.kroniska}`);
  }

  if (checkins.length) {
    lines.push(`\n--- SENASTE ${checkins.length} CHECK-INS (nyast först) ---`);
    for (const c of checkins) {
      const parts = [];
      if (c.energy     != null) parts.push(`energi=${c.energy}`);
      if (c.sleep      != null) parts.push(`sömn=${c.sleep}`);
      if (c.stress     != null) parts.push(`stress=${c.stress}`);
      if (c.focus      != null) parts.push(`fokus=${c.focus}`);
      if (c.motivation != null) parts.push(`motivation=${c.motivation}`);
      const ft = c.fri_text ? ` · "${String(c.fri_text).slice(0, 120)}"` : "";
      lines.push(`${c.date}: ${parts.join(" ")}${ft}`);
    }
  }

  if (garmin) {
    lines.push(`\n--- GARMIN ---`);
    if (Array.isArray(garmin.hrv))          lines.push(`HRV senaste 14: ${garmin.hrv.slice(0,14).map(h=>`${h.date}=${h.avg_hrv}ms`).join(", ")}`);
    if (Array.isArray(garmin.sleep))        lines.push(`Sömn senaste 7: ${garmin.sleep.slice(0,7).map(s=>`${s.date}=${s.duration_hours}h (djup ${s.deep_sleep_hours}h)`).join(", ")}`);
    if (Array.isArray(garmin.body_battery)) lines.push(`Body Battery senaste 7: ${garmin.body_battery.slice(0,7).map(b=>`${b.date}=${b.start_of_day}`).join(", ")}`);
    if (Array.isArray(garmin.resting_hr))   lines.push(`Vilopuls senaste 7: ${garmin.resting_hr.slice(0,7).map(r=>`${r.date}=${r.bpm}`).join(", ")}`);
    if (Array.isArray(garmin.activities))   lines.push(`Senaste aktiviteter: ${garmin.activities.slice(0,5).map(a=>`${a.date} ${a.type || ""} ${a.duration_min||"?"}min`).join(", ")}`);
    if (Array.isArray(garmin.training_load)) lines.push(`Träningsbelastning senaste 7: ${garmin.training_load.slice(0,7).map(t=>`${t.date}=${t.acute}`).join(", ")}`);
  }

  if (dexcom && Array.isArray(dexcom.readings)) {
    lines.push(`\n--- DEXCOM (senaste 7 dagar, sammanfattat) ---`);
    const last7 = dexcom.readings.slice(0, 7 * 288);
    const avg = last7.length ? (last7.reduce((s, r) => s + (r.value || 0), 0) / last7.length).toFixed(1) : "?";
    lines.push(`Snitt glukos: ${avg} mg/dL (${last7.length} mätningar)`);
  }

  if (blood) {
    lines.push(`\n--- BLODPROV ---`);
    if (Array.isArray(blood.results)) {
      for (const b of blood.results.slice(0, 2)) {
        lines.push(`${b.date || "okänt datum"}:`);
        const markers = b.markers || b.results || {};
        for (const [k, v] of Object.entries(markers).slice(0, 30)) {
          const val = typeof v === "object" ? v.value : v;
          const unit = typeof v === "object" ? v.unit : "";
          const ref  = typeof v === "object" ? v.reference_range : "";
          lines.push(`  ${k}: ${val}${unit?` ${unit}`:""}${ref?` (ref ${ref})`:""}`);
        }
      }
    } else if (blood.markers) {
      for (const [k, v] of Object.entries(blood.markers).slice(0, 30)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }

  if (dna) {
    lines.push(`\n--- DNA ---`);
    const variants = dna.variants || dna.snps || [];
    for (const v of variants.slice(0, 25)) {
      lines.push(`${v.gene || v.rsid}: ${v.genotype || ""}${v.significance?` — ${v.significance}`:""}`);
    }
  }

  if (nutrition?.avg_7d) {
    lines.push(`\n--- NÄRING (snitt 7 dagar) ---`);
    const n = nutrition.avg_7d;
    lines.push(`${n.energy_kcal||"?"} kcal · P ${n.protein_g||"?"}g · K ${n.carbs_g||"?"}g · F ${n.fat_g||"?"}g · Mg ${n.magnesium_mg||"?"}mg · Fe ${n.iron_mg||"?"}mg · D ${n.vitamin_d_iu||"?"}IU · B12 ${n.vitamin_b12_ug||"?"}µg`);
  }

  if (labs.length) {
    lines.push(`\n--- LABBTESTER (nyast först) ---`);
    for (const t of labs) {
      const parts = [`${t.date}${t.provider ? ` · ${t.provider}` : ""}`];
      if (t.vo2max != null)               parts.push(`VO2max ${t.vo2max}`);
      if (t.lt1_watts != null)            parts.push(`LT1 ${t.lt1_watts}W${t.lt1_bpm ? `/${t.lt1_bpm}bpm` : ""}`);
      if (t.lt2_watts != null)            parts.push(`LT2 ${t.lt2_watts}W${t.lt2_bpm ? `/${t.lt2_bpm}bpm` : ""}`);
      if (t.body_fat_pct != null)         parts.push(`fett ${t.body_fat_pct}%`);
      if (t.muscle_mass_kg != null)       parts.push(`muskel ${t.muscle_mass_kg}kg`);
      if (t.bone_density_t_score != null) parts.push(`bentäthet T=${t.bone_density_t_score}`);
      if (t.weight_kg != null)            parts.push(`vikt ${t.weight_kg}kg`);
      lines.push(parts.join(" · "));
      if (t.notes) lines.push(`  not: ${t.notes}`);
    }
  }

  if (briefings.length) {
    lines.push(`\n--- SENASTE MORGONBRIEFINGS ---`);
    for (const b of briefings) lines.push(`${b.date}: ${b.narrative.replace(/\n+/g, " ").slice(0, 250)}...`);
  }

  return lines.join("\n");
}

// POST — skicka meddelande, få svar från Agent 12
app.post("/api/chat/message", auth, async (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "Tomt meddelande" });
    }
    if (content.length > 2000) {
      return res.status(400).json({ error: "Meddelandet är för långt (max 2000 tecken)" });
    }

    const userId = req.user.id;
    const userContent = content.trim();

    // 1. Spara användarens meddelande
    await supabase.from("chat_messages").insert({
      user_id: userId, role: "user", content: userContent
    });

    // 2. Hämta kontext + senaste 20 meddelanden parallellt
    const [context, historyRes] = await Promise.all([
      buildChatContext(userId),
      supabase.from("chat_messages")
        .select("role, content")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20)
    ]);

    const history = (historyRes.data || []).reverse();

    // 3. Claude Sonnet 4.6 — system prompt + kontext cachas, history skickas färskt
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: [
          { type: "text", text: AGENT_12_PROMPT, cache_control: { type: "ephemeral" } },
          { type: "text", text: context,         cache_control: { type: "ephemeral" } }
        ],
        messages: history.map(m => ({ role: m.role, content: m.content }))
      })
    });

    const apiData = await resp.json();
    if (apiData.error) {
      console.error("[chat] Anthropic-fel:", apiData.error.message);
      return res.status(500).json({ error: apiData.error.message });
    }

    const assistantContent = apiData?.content?.[0]?.text?.trim() || "";
    const usage = apiData?.usage || {};

    // 4. Spara assistentsvaret
    await supabase.from("chat_messages").insert({
      user_id: userId,
      role: "assistant",
      content: assistantContent,
      tokens_input:       usage.input_tokens || 0,
      tokens_output:      usage.output_tokens || 0,
      tokens_cache_read:  usage.cache_read_input_tokens || 0,
      tokens_cache_write: usage.cache_creation_input_tokens || 0
    });

    res.json({
      ok: true,
      message: assistantContent,
      tokens: {
        input:       usage.input_tokens || 0,
        output:      usage.output_tokens || 0,
        cache_read:  usage.cache_read_input_tokens || 0,
        cache_write: usage.cache_creation_input_tokens || 0
      }
    });
  } catch (e) {
    console.error("[chat]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET — chatt-historik (senaste 50 meddelanden, äldst först)
app.get("/api/chat/history", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ ok: true, messages: (data || []).reverse() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── LABBTESTER ──────────────────────────────────────────────────
// Generisk: fritext-leverantör så atleten kan ladda in från vilket labb som helst.

app.post("/api/lab/create", auth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.date) return res.status(400).json({ error: "Datum krävs" });
    const row = {
      user_id:              req.user.id,
      date:                 b.date,
      provider:             b.provider || null,
      vo2max:               b.vo2max ?? null,
      lt1_watts:            b.lt1_watts ?? null,
      lt1_bpm:              b.lt1_bpm ?? null,
      lt1_pace:             b.lt1_pace || null,
      lt2_watts:            b.lt2_watts ?? null,
      lt2_bpm:              b.lt2_bpm ?? null,
      lt2_pace:             b.lt2_pace || null,
      body_fat_pct:         b.body_fat_pct ?? null,
      muscle_mass_kg:       b.muscle_mass_kg ?? null,
      bone_density_t_score: b.bone_density_t_score ?? null,
      weight_kg:            b.weight_kg ?? null,
      height_cm:            b.height_cm ?? null,
      notes:                b.notes || null
    };
    const { data, error } = await supabase.from("lab_tests").insert(row).select().single();
    if (error) throw error;
    res.json({ ok: true, test: data });
  } catch (e) {
    console.error("[lab/create]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/lab/tests", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("lab_tests")
      .select("*")
      .eq("user_id", req.user.id)
      .order("date", { ascending: false });
    if (error) throw error;
    res.json({ ok: true, tests: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/lab/:id", auth, async (req, res) => {
  try {
    const b = req.body || {};
    const fields = ["date","provider","vo2max","lt1_watts","lt1_bpm","lt1_pace",
      "lt2_watts","lt2_bpm","lt2_pace","body_fat_pct","muscle_mass_kg",
      "bone_density_t_score","weight_kg","height_cm","notes"];
    const patch = { updated_at: new Date().toISOString() };
    for (const f of fields) if (f in b) patch[f] = b[f] === "" ? null : b[f];
    const { data, error } = await supabase
      .from("lab_tests")
      .update(patch)
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Test hittades inte" });
    res.json({ ok: true, test: data });
  } catch (e) {
    console.error("[lab/update]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/lab/:id", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("lab_tests")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PREDICTION FEATURES — deterministisk feature-pipeline för Agent 4 ──
// Beräknar baselines, avvikelser, trender och belastning från användarens data.
// Ingen klinisk tolkning — bara matematiska observationer som Agent 4 konsumerar.

function _mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}
function _stddev(arr) {
  if (arr.length < 2) return null;
  const m = _mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}
function _slope(values) {
  // Linjär regression, x = 0..n-1. Positiv slope = ökande över tid.
  if (!values.length || values.length < 2) return null;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = _mean(values);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : Number((num / den).toFixed(3));
}
function _zscore(value, m, sd) {
  if (value == null || m == null || sd == null || sd === 0) return null;
  return Number(((value - m) / sd).toFixed(2));
}
function _round(v, d = 2) {
  return v == null ? null : Number(v.toFixed(d));
}

async function computePredictionFeatures(userId) {
  const [checkinsRes, intRes, profRes] = await Promise.all([
    supabase.from("checkins").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(28),
    supabase.from("integrations").select("provider, data").eq("user_id", userId),
    supabase.from("profiles").select("data").eq("user_id", userId).single()
  ]);

  const checkins     = decryptCheckins(checkinsRes.data || []);
  const integrations = intRes.data || [];
  const garmin       = integrations.find(i => i.provider === "garmin")?.data || {};
  const profile      = decryptProfile(profRes.data?.data || {});

  const daysCheckins = checkins.length;

  // Uppskatta max HR från profil-ålder (Tanaka-formeln) för load-beräkning
  const age   = profile.q3_2 ? Number(profile.q3_2) : null;
  const maxHR = age ? 208 - (0.7 * age) : 190;

  // Feature-byggare för ett subjektivt check-in-fält
  const checkinFeat = (key) => {
    const series28 = checkins.slice(0, 28).map(c => c[key]).filter(v => v != null);
    const last7    = checkins.slice(0, 7).map(c => c[key]).filter(v => v != null);
    const prior7   = checkins.slice(7, 14).map(c => c[key]).filter(v => v != null);
    const m28 = _mean(series28), sd28 = _stddev(series28);
    const current = checkins[0]?.[key] ?? null;
    const m7 = _mean(last7), mPrior7 = _mean(prior7);
    return {
      baseline_28d:      { mean: _round(m28), stddev: _round(sd28), n: series28.length },
      current,
      deviation_z:       _zscore(current, m28, sd28),
      mean_7d:           _round(m7),
      mean_prior_7d:     _round(mPrior7),
      pct_change_7d:     (m7 != null && mPrior7 != null && mPrior7 !== 0) ? _round(((m7 - mPrior7) / mPrior7) * 100, 1) : null,
      trend_slope_7d:    _slope(last7.slice().reverse())
    };
  };

  // Feature-byggare för en Garmin-serie
  const garminFeat = (seriesKey, valueKey) => {
    const series = garmin[seriesKey];
    if (!Array.isArray(series) || !series.length) return null;
    const s28    = series.slice(0, 28).map(r => r[valueKey]).filter(v => v != null);
    const last7  = series.slice(0, 7).map(r => r[valueKey]).filter(v => v != null);
    const prior7 = series.slice(7, 14).map(r => r[valueKey]).filter(v => v != null);
    const m28 = _mean(s28), sd28 = _stddev(s28);
    const current = series[0]?.[valueKey] ?? null;
    const m7 = _mean(last7), mPrior7 = _mean(prior7);
    return {
      baseline_28d:   { mean: _round(m28), stddev: _round(sd28), n: s28.length },
      current,
      deviation_z:    _zscore(current, m28, sd28),
      mean_7d:        _round(m7),
      pct_change_7d:  (m7 != null && mPrior7 != null && mPrior7 !== 0) ? _round(((m7 - mPrior7) / mPrior7) * 100, 1) : null,
      trend_slope_7d: _slope(last7.slice().reverse())
    };
  };

  // Träningsbelastning — ACWR (acute:chronic workload ratio, Gabbett 2016)
  // Garmin-aktiviteter saknar "load"-fält, så vi uppskattar:
  //   1. calories om tillgängligt (bäst proxy för energiomsättning)
  //   2. fallback: duration_min × intensitet (avg_hr / maxHR), baseline 0.5
  const activities = Array.isArray(garmin.activities) ? garmin.activities : [];
  const loadByDate = {};
  const estimateLoad = (a) => {
    if (a.calories && a.calories > 0) return Number(a.calories);
    const dur = Number(a.duration_min) || 0;
    const intensity = a.avg_hr && maxHR ? Math.min(1, Math.max(0.3, a.avg_hr / maxHR)) : 0.5;
    return Math.round(dur * intensity * 6); // skalfaktor så siffror liknar kalorier
  };
  for (const a of activities) {
    if (!a.date) continue;
    loadByDate[a.date] = (loadByDate[a.date] || 0) + estimateLoad(a);
  }
  const now = new Date();
  let acute7Sum = 0, chronic28Sum = 0;
  for (let i = 0; i < 28; i++) {
    const d = new Date(now.getTime() - i * 86400000).toISOString().split("T")[0];
    const load = loadByDate[d] || 0;
    if (i < 7) acute7Sum += load;
    chronic28Sum += load;
  }
  const acute7Avg    = acute7Sum / 7;
  const chronic28Avg = chronic28Sum / 28;
  const acrRatio     = chronic28Avg > 0 ? Number((acute7Avg / chronic28Avg).toFixed(2)) : null;

  return {
    computed_at: new Date().toISOString(),
    data_sufficiency: {
      days_with_checkins: daysCheckins,
      has_garmin:         Object.keys(garmin).length > 0,
      cold_start:         daysCheckins < 14,
      baseline_ready:     daysCheckins >= 14
    },
    subjective: {
      energy:     checkinFeat("energy"),
      sleep:      checkinFeat("sleep"),
      stress:     checkinFeat("stress"),
      focus:      checkinFeat("focus"),
      motivation: checkinFeat("motivation")
    },
    biological: {
      hrv:          garminFeat("hrv", "avg_hrv"),
      sleep_hours:  garminFeat("sleep", "duration_hours"),
      body_battery: garminFeat("body_battery", "start_of_day"),
      resting_hr:   garminFeat("resting_hr", "bpm")
    },
    training_load: {
      acute_7d_avg:     _round(acute7Avg, 1),
      chronic_28d_avg:  _round(chronic28Avg, 1),
      acr_ratio:        acrRatio,
      elevated_risk:    acrRatio != null && acrRatio > 1.3,
      activities_28d:   activities.filter(a => a.date).slice(0, 28).length
    }
  };
}

// GET — prediction features (för debug / inspektion)
app.get("/api/prediction/features", auth, async (req, res) => {
  try {
    const features = await computePredictionFeatures(req.user.id);
    res.json({ ok: true, features });
  } catch (e) {
    console.error("[prediction/features]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── CRASH HISTORY DETECTION (sprint 3/4) ───────────────────────────
// Identifierar historiska kraschsekvenser från check-ins:
//  - 2+ konsekutiva dagar med energi ≤4 OCH motivation ≤4
//  - Fri-text mentioning "sjuk/skada/influensa/etc"
// Sparar föregående 7 dagars signaler för mönstermatchning.

function _daysBetween(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

async function identifyCrashEpisodes(userId) {
  const { data: rows } = await supabase
    .from("checkins")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: true }); // äldsta först för sekvensdetektion

  const checkins = decryptCheckins(rows || []);
  const episodes = [];

  // Detektera konsekutiva dippar i subjektivt välmående
  let inEp = false, epStart = null, epEnd = null;
  const flushEp = () => {
    if (inEp && epStart && epEnd) {
      const dur = _daysBetween(epStart, epEnd) + 1;
      if (dur >= 2) {
        episodes.push({
          start_date: epStart,
          end_date: epEnd,
          duration_days: dur,
          type: "subjective_dip"
        });
      }
    }
    inEp = false; epStart = null; epEnd = null;
  };

  for (const c of checkins) {
    const low = (c.energy != null && c.energy <= 4) && (c.motivation != null && c.motivation <= 4);
    if (low) {
      if (!inEp) { inEp = true; epStart = c.date; }
      epEnd = c.date;
    } else {
      flushEp();
    }
  }
  flushEp();

  // Detektera sjukdom/skada-nämn i fri-text eller reflektion
  const sickRegex = /\b(sjuk|influensa|feber|skadad|skada|rygg|värk|migrän|halsont|förkyld|förkylning|magsjuk|halsbränna)\b/i;
  for (const c of checkins) {
    const text = [c.fri_text, c.reflection].filter(Boolean).join(" ").trim();
    if (!text || !sickRegex.test(text)) continue;
    const existing = episodes.find(e => e.start_date <= c.date && c.date <= e.end_date);
    if (existing) {
      existing.type = "subjective_dip_with_sickness";
      existing.trigger_text = text.slice(0, 120);
    } else {
      episodes.push({
        start_date: c.date,
        end_date: c.date,
        duration_days: 1,
        type: "sickness_mention",
        trigger_text: text.slice(0, 120)
      });
    }
  }

  // För varje episod, hämta 7 dagars föregående check-in-signaler
  for (const ep of episodes) {
    const epStartDt = new Date(ep.start_date);
    const preceding = checkins.filter(c => {
      const d = new Date(c.date);
      return d < epStartDt && (epStartDt - d) <= 7 * 86400000;
    });
    ep.preceding_signals_7d = preceding.map(c => ({
      date:       c.date,
      energy:     c.energy,
      sleep:      c.sleep,
      stress:     c.stress,
      focus:      c.focus,
      motivation: c.motivation
    }));
  }

  // Sortera nyast först
  episodes.sort((a, b) => b.start_date.localeCompare(a.start_date));

  const avg = episodes.length
    ? episodes.reduce((s, e) => s + e.duration_days, 0) / episodes.length
    : null;

  return {
    total:              episodes.length,
    avg_duration_days:  avg ? Number(avg.toFixed(1)) : null,
    episodes:           episodes.slice(0, 10)
  };
}

// GET — historiska kraschsekvenser (för debug / inspektion)
app.get("/api/prediction/crashes", auth, async (req, res) => {
  try {
    const history = await identifyCrashEpisodes(req.user.id);
    res.json({ ok: true, history });
  } catch (e) {
    console.error("[prediction/crashes]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DAGLIG PREDIKTION (sprint 4/4) ───────────────────────────────
// Helper som bygger strukturerad input från feature-pipeline +
// krasch-historia, anropar Agent 4, sparar i predictions-tabellen.
// Callable från cron OCH HTTP endpoint.

async function runDailyPrediction(userId) {
  const today = new Date().toISOString().split("T")[0];

  const [features, crashes, checkinsRes, profRes] = await Promise.all([
    computePredictionFeatures(userId),
    identifyCrashEpisodes(userId),
    supabase.from("checkins").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(14),
    supabase.from("profiles").select("data").eq("user_id", userId).single()
  ]);

  const checkins = decryptCheckins(checkinsRes.data || []);
  const profile  = decryptProfile(profRes.data?.data || {});

  if (!checkins.length) return { ok: false, reason: "inga_checkins" };

  const agentInput = {
    datum:             today,
    personliga_features: features,
    historiska_krascher: crashes,
    senaste_checkin:   checkins[0],
    senaste_7_checkins: checkins.slice(0, 7).map(c => ({
      date: c.date, energy: c.energy, sleep: c.sleep, stress: c.stress,
      focus: c.focus, motivation: c.motivation, fri_text: c.fri_text || ""
    }))
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system: [
        { type: "text", text: AGENTS["4"] || "Du är Forsyne prediktions-agent.", cache_control: { type: "ephemeral" } }
      ],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: buildUserProfileBlock(profile), cache_control: { type: "ephemeral" } },
          { type: "text", text: `Analysera nuläget och returnera prediktion i exakt det JSON-format du är specificerad för. Använd features.baseline som referensram — inte kliniska normvärden. Om historiska_krascher.total > 0, jämför aktuellt mönster mot föregående-signaler.\n\nDATA:\n${JSON.stringify(agentInput, null, 2)}` }
        ]
      }]
    }),
    signal: AbortSignal.timeout(60000) // override default 30s — prediktion har stort system-prompt + cache-write första gången
  });

  const apiData = await resp.json();
  if (apiData.error) {
    console.error("[prediction-daily] Anthropic-fel:", apiData.error.message);
    return { ok: false, reason: "api_error", message: apiData.error.message };
  }

  const text = apiData?.content?.[0]?.text || "";
  let parsed;
  try {
    // Strippa markdown-code-fences först
    const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : cleaned);
  } catch (e) {
    return {
      ok: false,
      reason: "parse_error",
      stop_reason: apiData?.stop_reason,
      raw_preview: text.slice(0, 300),
      raw_length: text.length
    };
  }

  const dagar = parsed.dagar_till_krasch || 0;
  const predictedDate = new Date(Date.now() + dagar * 86400000)
    .toISOString().split("T")[0];

  const { error: insertErr } = await supabase.from("predictions").insert({
    user_id:            userId,
    created_at:         new Date().toISOString(),
    predicted_date:     predictedDate,
    sannolikhet_krasch: parsed.sannolikhet_krasch || 0,
    varsel_status:      parsed.varsel_status || "ingen",
    varsel_dag:         parsed.varsel_dag || 0,
    dagar_till_krasch:  dagar,
    kritisk_atgard:     parsed.kritisk_åtgärd || null,
    agent_output:       parsed,
    outcome:            null
  });
  if (insertErr) console.error("[prediction-daily] DB insert-fel:", insertErr.message);

  return {
    ok: true,
    prediction: parsed,
    tokens: apiData.usage || {}
  };
}

// POST — manuell trigger av daglig prediktion (för test / on-demand)
app.post("/api/agent/prediction/run", auth, async (req, res) => {
  try {
    const out = await runDailyPrediction(req.user.id);
    res.json(out);
  } catch (e) {
    console.error("[prediction-daily]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── WAITLIST (public, ingen auth) ───────────────────────────────
app.post("/api/waitlist", waitlistLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const email = String(b.email || "").toLowerCase().trim();
    const name  = String(b.name  || "").trim();

    if (!email || !name)              return res.status(400).json({ error: "Email och namn krävs." });
    if (email.length > 200)           return res.status(400).json({ error: "Email för lång." });
    if (name.length > 100)            return res.status(400).json({ error: "Namn för långt." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "Ogiltig email-adress." });
    }

    const row = {
      email,
      name,
      age:               b.age ? (Number(b.age) || null) : null,
      wearable:          b.wearable          ? String(b.wearable).slice(0, 50)          : null,
      sessions_per_week: b.sessions_per_week ? String(b.sessions_per_week).slice(0, 20) : null,
      main_sport:        b.main_sport        ? String(b.main_sport).slice(0, 50)        : null,
      about:             b.about             ? String(b.about).slice(0, 500)            : null,
      source:            b.source            ? String(b.source).slice(0, 50)            : "landing",
      ip_address:        (req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim() || null,
      user_agent:        (req.headers["user-agent"] || "").slice(0, 400) || null
    };

    const { error } = await supabase.from("waitlist").insert(row);
    if (error) {
      // Duplicate email — acceptera som tidigare anmäld, skicka inte ny bekräftelse
      if (error.code === "23505") {
        return res.json({ ok: true, already_registered: true });
      }
      console.error("[waitlist] DB-fel:", error.code, error.message);
      return res.status(500).json({ error: "Kunde inte spara just nu. Försök igen." });
    }

    // Confirmation email — fire-and-forget så signup inte failar om email har problem
    sendWaitlistConfirmEmail(row.email, row.name).catch(e =>
      console.error("[waitlist] email-fel:", e.message)
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("[waitlist]", e.message);
    res.status(500).json({ error: "Internt fel." });
  }
});

// ── SENASTE META-INSIKT — hämtar senaste meta-agent insikt från databasen ──
app.get("/api/insights/latest", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("insights")
      .select("rubrik,insikt,prediktion,rekommendation,prioritet,grundat_i,mönster_referens,psi_förklaring,created_at")
      .eq("user_id", req.user.id)
      .eq("agent", "meta")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (error || !data) return res.json(null);
    res.json(data);
  } catch (e) {
    res.json(null);
  }
});

// ── AGENT 9 — BALANSAGENTEN ──
app.post("/api/agent/balance/generate", auth, async (req, res) => {
  const { checkins = [], profile = {}, agent3_output = null, agent4_output = null } = req.body;
  const n = checkins.length;
  if (n === 0) return res.json({ producerade_output: false });

  const today = new Date().toISOString().split("T")[0];

  // Hämta objektiv data
  const { data: _bRows } = await supabase
    .from("integrations").select("provider,data").eq("user_id", req.user.id);
  const _bInt = {};
  (_bRows || []).forEach(i => { _bInt[i.provider] = i.data || {}; });
  const _bGm = _bInt.garmin || {};
  const _bBl = _bInt.blood_labs?.latest || {};
  const _bDn = _bInt.dna || {};
  const _bDx = _bInt.dexcom || {};
  const _bCr = _bInt.cronometer || {};
  const balanceBio = [
    _bGm.avg_hrv_7d   ? `Garmin HRV 7d: ${_bGm.avg_hrv_7d} ms · Body Battery: ${_bGm.latest_body_battery||'—'} · Sömnsnitt 7d: ${_bGm.avg_sleep_7d ? Math.floor(_bGm.avg_sleep_7d/60)+'h '+_bGm.avg_sleep_7d%60+'m' : '—'}` : "",
    _bDx.latest_glucose ? `CGM: ${_bDx.latest_glucose.value} mg/dL · Tid i målzon 7d: ${_bDx.time_in_range_7d != null ? _bDx.time_in_range_7d+'%' : '—'}` : "",
    _bBl.nyckelobservationer?.length ? `Blodprover: ${_bBl.nyckelobservationer.slice(0,3).join(' · ')}` : "",
    _bDn.nyckelinsikter?.length ? `DNA: ${_bDn.nyckelinsikter.slice(0,2).join(' · ')}` : "",
    _bCr.avg_7d ? `Kost snitt 7d: ${_bCr.avg_7d.energy_kcal||'—'} kcal · Protein ${_bCr.avg_7d.protein_g||'—'}g` : "",
  ].filter(Boolean).join("\n");

  const contextMsg = buildBalanceMsg(checkins, profile, agent3_output, agent4_output, today, balanceBio);

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: AGENTS["9"] || "Du är Forsyne balansagent. Hitta vad som fungerar i datan. Svara i JSON.",
        messages: [{ role: "user", content: contextMsg }]
      })
    });
    const data = await resp.json();
    const text = data?.content?.[0]?.text || "";
    let parsed;
    try { const m = text.match(/\{[\s\S]*\}/); parsed = JSON.parse(m ? m[0] : text); } catch { parsed = { producerade_output: false }; }
    res.json(parsed);
  } catch(e) {
    console.error("Balance agent error:", e);
    res.json({ producerade_output: false });
  }
});

// Build context message for Agent 9
function buildBalanceMsg(checkins, profile, insight, prediction, today, bioCtx = "") {
  const n = checkins.length;
  const sorted = [...checkins].sort((a, b) => a.date < b.date ? -1 : 1);
  const latest = sorted[sorted.length - 1];
  const r7  = sorted.slice(-7);
  const r14 = sorted.slice(-14);
  const r3  = sorted.slice(-3);
  const avgFn = (arr, f) => arr.length ? (arr.reduce((s,x) => s+(x[f]||0), 0)/arr.length).toFixed(1) : "—";

  // Trend detection helpers
  const trend = (f) => {
    if (r3.length < 2) return "—";
    const first = r3[0][f] || 0;
    const last  = r3[r3.length-1][f] || 0;
    return last > first ? `↑ ${(last-first).toFixed(1)}` : last < first ? `↓ ${(first-last).toFixed(1)}` : "→ stabil";
  };

  const varselActive = prediction?.varsel_status && prediction.varsel_status !== "ingen";
  const agent3Heavy  = insight?.insikt && (insight.insikt.includes("sömnbrist") || insight.insikt.includes("stress") || insight.insikt.includes("varsel") || insight.insikt.includes("sjunk"));

  return `IDAG: ${today}
ANTAL CHECK-INS: ${n}

SENASTE MÄTVÄRDEN (${latest?.date}):
Energi ${latest?.energy}/10 · Sömn ${latest?.sleep}/10 · Stress ${latest?.stress}/10 · Fokus ${latest?.focus}/10 · Motivation ${latest?.motivation}/10

7-DAGARSSNITT:
Energi ${avgFn(r7,"energy")} · Sömn ${avgFn(r7,"sleep")} · Stress ${avgFn(r7,"stress")} · Fokus ${avgFn(r7,"focus")} · Motivation ${avgFn(r7,"motivation")}

TRENDER (sista 3 dagar):
Energi: ${trend("energy")} · Sömn: ${trend("sleep")} · Stress: ${trend("stress")}

${varselActive ? `⚠ SIGNALEN AKTIV — Dag ${prediction.varsel_dag}. Agent 9: sök efter styrka som är sann trots signalen.` : "Ingen aktiv signal."}

${agent3Heavy ? `AGENT 3 INSIKT (tung): "${insight?.insikt}" — Agent 9: lägg till positiv motvikt om den finns i datan.` : `AGENT 3 INSIKT: "${insight?.insikt || "—"}"`}

PROFIL:
Namn: ${profile.q3_1 || "Okänt"} · Energimönster: ${profile.q2_1 || "—"} · Sömnmönster: ${profile.q6_1 || "—"}
${bioCtx ? `\nOBJEKTIV DATA:\n${bioCtx}\n` : ""}
Sök efter vad som faktiskt fungerar i datan ovan. Svara EXAKT i detta JSON-format:
{
  "datum": "${today}",
  "styrkeinsikt": "",
  "formel_bekräftad": false,
  "formel_text": "",
  "balans_tillägg_till_agent3": "",
  "avvärjnings_förstärkare": [],
  "check_in_avslutning": "Vad fungerade igår — även något litet?",
  "producerade_output": true
}

Om inget positivt finns i datan — sätt producerade_output: false och lämna styrkeinsikt tom. Tvinga aldrig fram optimism.`.trim();
}

// ── JOURNAL — PDF upload → extract context → delete file ──
app.post("/api/journal/process", auth, journalLimiter, upload.single("pdf"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Ingen PDF uppladdad" });
  if (req.file.mimetype !== "application/pdf") return res.status(400).json({ error: "Bara PDF-filer stöds" });

  // Extract text from PDF buffer (never written to disk — multer memoryStorage)
  let pdfText;
  try {
    const parsed = await pdfParse(req.file.buffer);
    pdfText = parsed.text?.slice(0, 8000) || "";
  } catch(e) {
    return res.status(400).json({ error: "Kunde inte läsa PDF" });
  }

  if (!pdfText.trim()) return res.status(400).json({ error: "PDF innehåller ingen läsbar text" });

  // Extract context via Claude
  let insight;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: "Du är Forsyne journal-agent. Extrahera den mest relevanta personliga kontexten från en uppladdad journal. Fokusera på mönster, triggers, återkommande teman och självinsikter. Max 200 ord. Ingen rubrik.",
        messages: [{ role: "user", content: `Extrahera kontext från denna journal:\n\n${pdfText}` }]
      })
    });
    const data = await resp.json();
    insight = data?.content?.[0]?.text?.trim();
  } catch(e) {
    return res.status(500).json({ error: "Claude svarade inte" });
  }

  if (!insight) return res.status(500).json({ error: "Ingen kontext extraherades" });

  // Save ONLY the extracted context (encrypted) — original file is already gone (memoryStorage)
  const encryptedContext = encrypt(insight);
  const { data: existing } = await supabase.from("profiles").select("data").eq("user_id", req.user.id).single();
  const profileData = { ...(existing?.data || {}), journal_context: encryptedContext, journal_updated: new Date().toISOString() };
  await supabase.from("profiles").upsert({ user_id: req.user.id, data: profileData, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  res.json({ insight, contextSaved: true });
});

// ── JSON REPAIR — stänger trunkerade svar från Claude ──
function repairTruncatedJSON(str) {
  if (!str) return null;
  let s = str.trim();
  // Walk the string tracking parser state
  let inString = false, escape = false;
  const stack = []; // tracks unclosed '{' and '['
  let lastSafePos = 0; // position after last complete value at depth 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inString) { escape = true; continue; }
    if (c === '"') {
      inString = !inString;
      if (!inString && stack.length === 1) lastSafePos = i + 1;
      continue;
    }
    if (inString) continue;
    if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length === 0) lastSafePos = i + 1;
    }
    else if ((c === ',' || c === ':') && stack.length <= 1) lastSafePos = i;
  }
  // If truncated inside a string, close it
  if (inString) s += '"';
  // Remove trailing dangling comma or colon or incomplete key before closing
  s = s.replace(/,\s*"[^"]*"\s*:\s*$/, '').replace(/,\s*"[^"]*"\s*$/, '').replace(/[,\s]+$/, '');
  // Close all open brackets
  s += stack.reverse().join('');
  try { return JSON.parse(s); } catch(e) { return null; }
}

// ── META AGENT — systemets kärna ──
async function runMetaAgent(userId) {
  // Fetch all data in parallel
  const [profileRes, checkinsRes, insightsRes, validationsRes] = await Promise.all([
    supabase.from("profiles").select("data").eq("user_id", userId).single(),
    supabase.from("checkins").select("*").eq("user_id", userId).order("date", { ascending: true }),
    supabase.from("insights").select("rubrik,insikt,prioritet,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    supabase.from("validations").select("kategori,paastående,svar,kommentar,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20)
  ]);

  const profile          = decryptProfile(profileRes.data?.data || {});
  const checkins         = decryptCheckins(checkinsRes.data || []);
  const previousInsights = insightsRes.data || [];
  const validations      = validationsRes.data || [];

  if (!checkins.length) {
    console.warn(`[meta-agent] inga check-ins för user_id ${userId}`);
    return null;
  }

  const firstDate   = new Date(checkins[0].date);
  const lastDate    = new Date(checkins[checkins.length - 1].date);
  const dagarAktiv  = Math.ceil((Date.now() - firstDate.getTime()) / 86400000);
  const periodStart = checkins[0].date;
  const periodEnd   = checkins[checkins.length - 1].date;

  // Normalisera fältnamn — simulate.js infogar på engelska, server läser svenska
  const norm = checkins.map(c => ({
    ...c,
    sömn:    c.sömn    ?? c.somn    ?? c.sleep    ?? null,
    energi:  c.energi  ?? c.energy  ?? null,
    humör:   c.humör   ?? c.humor   ?? null,
    träning: c.träning ?? c.traning ?? c.training ?? null,
  }));

  // Checkins som numrerade textrader — dag-nummer + datum + värden
  // Dag-nummer förhindrar att modellen räknar bakåt från fel referenspunkt
  const VECKODAGAR = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];
  const checkinRader = norm.map((c, i) => {
    const veckodag = VECKODAGAR[new Date(c.date).getDay()];
    const parts = [`dag${i + 1} (${c.date} ${veckodag}):`];
    if (c.stress  != null) parts.push(`stress=${c.stress}`);
    if (c.sömn    != null) parts.push(`somn=${c.sömn}`);
    if (c.energi  != null) parts.push(`energi=${c.energi}`);
    if (c.humör   != null) parts.push(`humor=${c.humör}`);
    if (c.kost_kvalitet != null) parts.push(`kost=${c.kost_kvalitet}`);
    if (c.träning != null) parts.push(`traning=${c.träning}`);
    // Fritext endast för dagar med anmärkningsvärda värden — minskar token-användning
    const notable = (c.stress ?? 0) >= 6 || (c.sömn ?? 99) <= 5.5 || (c.energi ?? 99) <= 3;
    if (notable && c.reflection)      parts.push(`reflektion="${c.reflection}"`);
    if (notable && c.personal_answer) parts.push(`svar="${c.personal_answer}"`);
    return parts.join(" ");
  }).join("\n");

  // Pre-beräknade kritiska dagar — agenten ska inte behöva hitta dem
  const kritiskaDagar = norm
    .map((c, i) => {
      if ((c.stress ?? 0) >= 7 || (c.sömn ?? 99) <= 4 || (c.energi ?? 99) <= 2) {
        const fritext = c.reflection || c.personal_answer;
        return `dag${i + 1} (${c.date}): stress=${c.stress ?? "?"} somn=${c.sömn ?? "?"} energi=${c.energi ?? "?"}${fritext ? ` reflektion="${fritext}"` : ""}`;
      }
      return null;
    })
    .filter(Boolean);

  // Periodvisa snitt — trendankar utan att agenten behöver räkna
  const avg = (arr, key) => {
    const vals = arr.map(c => c[key]).filter(v => v != null);
    return vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : null;
  };
  const perioderSnitt = [
    { period: "dag1-7",   stress: avg(norm.slice(0, 7),  "stress"), somn: avg(norm.slice(0, 7),  "sömn"), energi: avg(norm.slice(0, 7),  "energi") },
    { period: "dag8-14",  stress: avg(norm.slice(7, 14), "stress"), somn: avg(norm.slice(7, 14), "sömn"), energi: avg(norm.slice(7, 14), "energi") },
    { period: "dag15-21", stress: avg(norm.slice(14,21), "stress"), somn: avg(norm.slice(14,21), "sömn"), energi: avg(norm.slice(14,21), "energi") },
    { period: "dag22-30", stress: avg(norm.slice(21),   "stress"), somn: avg(norm.slice(21),   "sömn"), energi: avg(norm.slice(21),   "energi") },
  ].map(p => `${p.period}: stress=${p.stress ?? "?"} somn=${p.somn ?? "?"} energi=${p.energi ?? "?"}`).join(" | ");

  // ── Personliga baslinjer — individuella snitt + spridning ─────────────────
  const METRIC_DEF = [
    { key: "stress",     label: "Stress",     get: c => c.stress },
    { key: "sömn",       label: "Sömn",       get: c => c.sömn },
    { key: "energi",     label: "Energi",     get: c => c.energi },
    { key: "fokus",      label: "Fokus",      get: c => c.focus ?? c.fokus },
    { key: "motivation", label: "Motivation", get: c => c.motivation },
  ];
  const baslinjer = {};
  for (const m of METRIC_DEF) {
    const vals = norm.map(m.get).filter(v => v != null);
    if (!vals.length) continue;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    baslinjer[m.label] = { snitt: +mean.toFixed(1), std: +std.toFixed(1), n: vals.length };
  }

  // ── Laggade Pearson-korrelationer — pre-beräknade faktapåståenden ─────────
  const pcorr = (xs, ys) => {
    if (xs.length < 6) return 0;
    const mx = xs.reduce((a, b) => a + b) / xs.length;
    const my = ys.reduce((a, b) => a + b) / ys.length;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
    return den === 0 ? 0 : num / den;
  };
  const recentNorm = norm.slice(-90);
  const korrelationer = [];
  for (const m1 of METRIC_DEF) {
    for (const m2 of METRIC_DEF) {
      if (m1.key === m2.key) continue;
      for (const lag of [1, 2, 3]) {
        const n = recentNorm.length - lag;
        if (n < 8) continue;
        const pairs = recentNorm.slice(0, n).map((c, i) => ({ x: m1.get(c), y: m2.get(recentNorm[i + lag]) })).filter(p => p.x != null && p.y != null);
        if (pairs.length < 8) continue;
        const r = pcorr(pairs.map(p => p.x), pairs.map(p => p.y));
        if (Math.abs(r) < 0.4) continue;
        const lagTxt = lag === 1 ? "nästa dag" : `+${lag} dagar`;
        korrelationer.push(`${m1.label} → ${m2.label} ${lagTxt}: r=${r > 0 ? "+" : ""}${r.toFixed(2)} (n=${pairs.length})`);
      }
    }
  }
  korrelationer.sort((a, b) => {
    const ra = Math.abs(parseFloat(a.match(/r=([+-]\d+\.\d+)/)[1]));
    const rb = Math.abs(parseFloat(b.match(/r=([+-]\d+\.\d+)/)[1]));
    return rb - ra;
  });

  // ── 7-dagars strukturerad tabell ──────────────────────────────────────────
  const VDAG = ["Sön","Mån","Tis","Ons","Tor","Fre","Lör"];
  const psiOf = c => {
    const e = c.energi ?? null, s = c.sömn ?? null, t = c.stress ?? null,
          f = c.focus ?? c.fokus ?? null, m = c.motivation ?? null;
    const vals = [e, s, t != null ? 10 - t : null, f, m].filter(v => v != null);
    return vals.length >= 3 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) : null;
  };
  const sju_dagars_tabell = norm.slice(-7).map((c, i) => {
    const wd  = VDAG[new Date(c.date).getDay()];
    const psi = psiOf(c);
    const parts = [`${c.date} (${wd}):`];
    parts.push(`PSI=${psi ?? "?"}`);
    if (c.sömn    != null) parts.push(`sömn=${c.sömn}`);
    if (c.energi  != null) parts.push(`energi=${c.energi}`);
    if (c.stress  != null) parts.push(`stress=${c.stress}`);
    if ((c.focus ?? c.fokus) != null) parts.push(`fokus=${c.focus ?? c.fokus}`);
    if (c.motivation != null) parts.push(`motivation=${c.motivation}`);
    return parts.join(" ");
  }).join("\n");

  // ── Avvikelseflaggor — dagar som bryter det personliga mönstret ───────────
  const avvikelseflaggor = [];
  for (const m of METRIC_DEF) {
    const vals = norm.map(m.get).filter(v => v != null);
    if (vals.length < 7) continue;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    if (std < 0.3) continue;
    norm.slice(-14).forEach((c, i) => {
      const val = m.get(c);
      if (val == null) return;
      const z = (val - mean) / std;
      if (Math.abs(z) >= 1.6) {
        const dagNr = norm.length - 14 + i + 1;
        const dir   = z > 0 ? "högt" : "lågt";
        avvikelseflaggor.push(`dag${dagNr} (${c.date}): ${m.label}=${val} — ovanligt ${dir} (snitt=${mean.toFixed(1)}, ${z > 0 ? "+" : ""}${z.toFixed(1)}σ)`);
      }
    });
  }

  // ── Konvergensvarning — systembredd kritisk signal ─────────────────────────
  const latestNorm  = norm[norm.length - 1];
  const konvergensKritiska = latestNorm ? [
    (latestNorm.stress  ?? 0) >= 7 ? "stress" : null,
    (latestNorm.sömn   ?? 99) <= 4 ? "sömn"   : null,
    (latestNorm.energi ?? 99) <= 3 ? "energi" : null,
    ((latestNorm.focus ?? latestNorm.fokus) ?? 99) <= 2 ? "fokus" : null,
    (latestNorm.motivation ?? 99) <= 2 ? "motivation" : null,
  ].filter(Boolean) : [];

  const payload = {
    analys_period:  `${periodStart} till ${periodEnd} (${checkins.length} dagar)`,
    forsta_checkin: periodStart,
    sista_checkin:  periodEnd,
    kritiska_dagar: kritiskaDagar.length ? kritiskaDagar : ["inga kritiska dagar"],
    period_snitt:   perioderSnitt,
    profil: profile,
    checkins: checkinRader,
    tidigare_insikter: previousInsights.map(i => ({
      datum: i.created_at,
      rubrik: i.rubrik,
      insikt: i.insikt,
      prioritet: i.prioritet
    })),
    valideringssvar: validations.map(v => ({
      kategori: v.kategori,
      svar: v.svar,
      kommentar: v.kommentar
    })),
    dagar_aktiv:          dagarAktiv,
    personliga_baslinjer: baslinjer,
    korrelationer:        korrelationer.slice(0, 8).length ? korrelationer.slice(0, 8) : ["för lite data för korrelationsanalys"],
    sju_dagars_tabell:    sju_dagars_tabell || "inga data",
    avvikelseflaggor:     avvikelseflaggor.length ? avvikelseflaggor : ["inga avvikelser senaste 14 dagarna"],
    konvergens_idag:      konvergensKritiska.length >= 3
      ? `SYSTEMKONVERGENS: ${konvergensKritiska.length} metriker kritiska: ${konvergensKritiska.join(", ")}`
      : null,
  };

  // Call Claude — retry vid overloaded (3 försök, 10s paus) och vid bad JSON (1 retry)
  console.log("[meta-agent] payload size:", JSON.stringify(payload).length, "bytes");
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 60000);
    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          system: META_PROMPT,
          messages: [{ role: "user", content: JSON.stringify(payload) }]
        })
      });
    } catch(e) {
      clearTimeout(timeout);
      throw new Error(`meta-agent: Claude fetch misslyckades (${e.name === "AbortError" ? "timeout 60s" : e.message})`);
    }
    clearTimeout(timeout);
    const apiData = await resp.json();

    // Overloaded — vänta 10s och försök igen
    if (apiData?.error?.type === "overloaded_error") {
      console.warn(`[meta-agent] overloaded, försök ${attempt + 1}/3 — väntar 10s...`);
      if (attempt < 2) { await sleep(10000); continue; }
      throw new Error("meta-agent: Claude överbelastad efter 3 försök");
    }

    // Övriga API-fel
    if (apiData?.error) {
      const { type, message } = apiData.error;
      console.error(`[meta-agent] Claude API-fel: ${type} — ${message}`);
      throw new Error(`meta-agent: Claude returnerade ${type}: ${message}`);
    }

    const text = apiData?.content?.[0]?.text || "";
    console.log("[meta-agent] raw response:", text.substring(0, 500));
    if (!text) {
      console.error(`[meta-agent] Tomt svar. Stop reason: ${apiData?.stop_reason}`);
      throw new Error("meta-agent: tomt svar från Claude");
    }

    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
      const jsonStr   = jsonMatch ? jsonMatch[1] : text;
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch(parseErr) {
        // Attempt repair on truncated JSON
        console.warn("[meta-agent] JSON truncated, attempting repair...");
        parsed = repairTruncatedJSON(jsonStr);
        if (!parsed) throw parseErr;
        console.log("[meta-agent] repair succeeded");
      }
      result = parsed;
      break;
    } catch(e) {
      console.error("[meta-agent] parse-fel:", e.message);
      if (attempt === 2) throw new Error("meta-agent: invalid JSON efter retry");
      console.warn("[meta-agent] JSON parse misslyckades, försöker igen...");
    }
  }

  const { modell_uppdatering, agent_koordinering, systeminsikt } = result;

  // Save systeminsikt to insights table
  if (systeminsikt) {
    await supabase.from("insights").insert({
      user_id:          userId,
      rubrik:           systeminsikt.rubrik           || null,
      insikt:           systeminsikt.insikt           || null,
      prediktion:       systeminsikt.prediktion       || null,
      rekommendation:   systeminsikt.rekommendation   || null,
      prioritet:        systeminsikt.prioritet        || "Normal",
      grundat_i:        systeminsikt.grundat_i        || [],
      mönster_referens: systeminsikt.mönster_referens || null,
      psi_förklaring:   systeminsikt.psi_förklaring   || null,
      agent:            "meta"
    });
  }

  // Merge modell_uppdatering.reviderade_fält into profiles.data
  if (modell_uppdatering?.reviderade_fält) {
    const merged = { ...profile, ...modell_uppdatering.reviderade_fält };
    await supabase.from("profiles").upsert(
      { user_id: userId, data: encryptProfile(merged), updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  }

  return { systeminsikt, agent_koordinering, modell_uppdatering };
}

app.post("/api/agent/meta/run", auth, async (req, res) => {
  const userId = req.user.id;
  try {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from("insights")
      .select("*")
      .eq("user_id", userId)
      .eq("agent", "meta")
      .gte("created_at", sixHoursAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (cached) {
      return res.json({ systeminsikt: cached, agent_koordinering: null, cached: true });
    }

    const result = await runMetaAgent(userId);
    if (!result) return res.json({ systeminsikt: null, agent_koordinering: null });
    res.json(result);
  } catch(e) {
    console.error("[meta-agent] error:", e.message);
    res.status(500).json({ error: "agent_failed" });
  }
});

// Schedule endpoint — triggers meta agent for all users who checked in today
app.post("/api/agent/meta/schedule", async (req, res) => {
  // Require internal secret to prevent abuse
  const secret = req.headers["x-schedule-secret"];
  if (secret !== process.env.SCHEDULE_SECRET && process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const today = new Date().toISOString().split("T")[0];
    const { data: rows } = await supabase.from("checkins").select("user_id").eq("date", today);
    const userIds = [...new Set((rows || []).map(r => r.user_id))];
    console.log(`[meta/schedule] Kör för ${userIds.length} användare`);

    // Respond immediately — agents run in background
    res.json({ queued: userIds.length, started_at: new Date().toISOString() });

    for (const uid of userIds) {
      runMetaAgent(uid)
        .then(() => console.log(`[meta/schedule] ok: ${uid}`))
        .catch(e => console.error(`[meta/schedule] fel: ${uid}`, e.message));
    }
  } catch(e) {
    console.error("[meta/schedule] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// COACH B2B
// ══════════════════════════════════════════════════════════════

// Coach middleware — verifierar JWT + coach-roll
async function coachAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ingen token" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Ogiltig token" });
  req.user = { id: user.id, email: user.email };
  const { data: coach, error: cErr } = await supabase
    .from("coaches").select("*").eq("user_id", user.id).single();
  if (cErr || !coach) return res.status(403).json({ error: "Ingen coach-behörighet" });
  req.coach = coach;
  next();
}

// POST /api/coach/register — bli coach
app.post("/api/coach/register", auth, async (req, res) => {
  const { name, organization } = req.body;
  if (!name) return res.status(400).json({ error: "name krävs" });
  const { error } = await supabase
    .from("coaches")
    .upsert({ user_id: req.user.id, name, organization }, { onConflict: "user_id" });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/coach/me
app.get("/api/coach/me", coachAuth, (req, res) => res.json(req.coach));

// POST /api/coach/invite — skapa inbjudningslänk
app.post("/api/coach/invite", coachAuth, async (req, res) => {
  const { email, client_name } = req.body;
  const { data, error } = await supabase
    .from("coach_clients")
    .insert({ coach_id: req.user.id, invite_email: email || null, client_name: client_name || null, status: "pending" })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  const base = process.env.NODE_ENV === "production"
    ? `https://${process.env.RAILWAY_STATIC_URL || "forsyne.se"}`
    : "http://localhost:3000";
  res.json({ invite_token: data.invite_token, invite_url: `${base}/coach-invite.html?token=${data.invite_token}` });
});

// GET /api/coach/invite/:token — publik, klientens välkomstinfo
app.get("/api/coach/invite/:token", async (req, res) => {
  const { data, error } = await supabase
    .from("coach_clients")
    .select("invite_email,client_name,status,coach_id")
    .eq("invite_token", req.params.token).single();
  if (error || !data) return res.status(404).json({ error: "Ogiltig inbjudan" });
  if (data.status !== "pending") return res.status(400).json({ error: "Inbjudan redan använd" });
  const { data: coach } = await supabase
    .from("coaches").select("name,organization").eq("user_id", data.coach_id).single();
  res.json({ invite_email: data.invite_email, client_name: data.client_name,
    coach_name: coach?.name, coach_organization: coach?.organization });
});

// POST /api/coach/invite/:token/accept — klient accepterar
app.post("/api/coach/invite/:token/accept", auth, async (req, res) => {
  const { data: invite, error } = await supabase
    .from("coach_clients").select("*").eq("invite_token", req.params.token).single();
  if (error || !invite) return res.status(404).json({ error: "Ogiltig inbjudan" });
  if (invite.status !== "pending") return res.status(400).json({ error: "Inbjudan redan använd" });
  const { error: upErr } = await supabase
    .from("coach_clients")
    .update({ client_id: req.user.id, status: "active", accepted_at: new Date().toISOString() })
    .eq("invite_token", req.params.token);
  if (upErr) return res.status(500).json({ error: upErr.message });
  res.json({ ok: true });
});

// GET /api/coach/clients — lista klienter med PSI + senaste data
app.get("/api/coach/clients", coachAuth, async (req, res) => {
  const { data: clients, error } = await supabase
    .from("coach_clients").select("*").eq("coach_id", req.user.id).in("status", ["active", "pending"]);
  if (error) return res.status(500).json({ error: error.message });

  function calcPsiRow(c) {
    if (!c.energy && !c.sleep) return null;
    return Math.round(((c.energy + c.sleep + (10 - c.stress) + c.focus + c.motivation) / 5) * 10);
  }

  const enriched = await Promise.all((clients || []).map(async (c) => {
    if (c.status !== "active" || !c.client_id) return { ...c, psi: null, last_checkin: null, trend: null, varsel: false };
    const [{ data: checkins }, { data: profileRow }] = await Promise.all([
      supabase.from("checkins").select("date,energy,sleep,stress,focus,motivation")
        .eq("user_id", c.client_id).order("date", { ascending: false }).limit(7),
      supabase.from("profiles").select("data").eq("user_id", c.client_id).single()
    ]);
    const latest = checkins?.[0];
    const psi    = latest ? calcPsiRow(latest) : null;
    let trend = null;
    if (checkins?.length >= 2) {
      const psiOld = calcPsiRow(checkins[checkins.length - 1]);
      if (psiOld !== null) trend = psi - psiOld;
    }
    const varsel = checkins?.length >= 2
      && checkins[0].stress >= 7 && checkins[0].sleep <= 5
      && checkins[1].stress >= 7 && checkins[1].sleep <= 5;
    const profile = decryptProfile(profileRow?.data || {});
    const name = c.client_name || profile.q3_1 || c.invite_email || "Klient";
    return { ...c, name, psi, last_checkin: latest?.date || null, trend, varsel };
  }));

  res.json(enriched);
});

// GET /api/coach/clients/:clientId — klientens fulla data
app.get("/api/coach/clients/:clientId", coachAuth, async (req, res) => {
  const { clientId } = req.params;
  const { data: rel } = await supabase.from("coach_clients").select("*")
    .eq("coach_id", req.user.id).eq("client_id", clientId).eq("status", "active").single();
  if (!rel) return res.status(403).json({ error: "Ingen behörighet" });

  const [profileRes, checkinsRes, insightsRes, labRes] = await Promise.all([
    supabase.from("profiles").select("data,analysis").eq("user_id", clientId).single(),
    supabase.from("checkins").select("*").eq("user_id", clientId).order("date", { ascending: false }).limit(30),
    supabase.from("insights").select("*").eq("user_id", clientId).order("created_at", { ascending: false }).limit(5),
    supabase.from("lab_tests").select("*").eq("client_id", clientId).order("test_date", { ascending: false })
  ]);

  const profile  = decryptProfile(profileRes.data?.data || {});
  const checkins = decryptCheckins(checkinsRes.data || []).map(c => ({
    ...c,
    psi: Math.round(((c.energy + c.sleep + (10 - c.stress) + c.focus + c.motivation) / 5) * 10)
  }));

  res.json({ relation: rel, profile, analysis: profileRes.data?.analysis,
    checkins, insights: insightsRes.data || [], lab_tests: labRes.data || [] });
});

// POST /api/coach/clients/:clientId/lab-tests — lägg till testresultat
app.post("/api/coach/clients/:clientId/lab-tests", coachAuth, async (req, res) => {
  const { clientId } = req.params;
  const { data: rel } = await supabase.from("coach_clients").select("id")
    .eq("coach_id", req.user.id).eq("client_id", clientId).eq("status", "active").single();
  if (!rel) return res.status(403).json({ error: "Ingen behörighet" });

  const { test_date, test_type, label, value, unit, reference_low, reference_high, notes } = req.body;
  if (!test_date || !test_type || !label) return res.status(400).json({ error: "test_date, test_type och label krävs" });

  const { data, error } = await supabase.from("lab_tests")
    .insert({ client_id: clientId, coach_id: req.user.id, test_date, test_type, label,
      value: value ?? null, unit: unit || null,
      reference_low: reference_low ?? null, reference_high: reference_high ?? null, notes: notes || null })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/coach/clients/:clientId/lab-tests/:testId/analyze — AI-kontextualisering
app.post("/api/coach/clients/:clientId/lab-tests/:testId/analyze", coachAuth, async (req, res) => {
  const { clientId, testId } = req.params;
  const { data: rel } = await supabase.from("coach_clients").select("id")
    .eq("coach_id", req.user.id).eq("client_id", clientId).eq("status", "active").single();
  if (!rel) return res.status(403).json({ error: "Ingen behörighet" });

  const [testRes, checkinsRes, profileRes] = await Promise.all([
    supabase.from("lab_tests").select("*").eq("id", testId).eq("client_id", clientId).single(),
    supabase.from("checkins").select("*").eq("user_id", clientId).order("date", { ascending: false }).limit(90),
    supabase.from("profiles").select("data").eq("user_id", clientId).single()
  ]);

  const test = testRes.data;
  if (!test) return res.status(404).json({ error: "Test hittas inte" });

  const checkins = decryptCheckins(checkinsRes.data || []);
  const profile  = decryptProfile(profileRes.data?.data || {});

  const avg = (field) => checkins.length
    ? (checkins.reduce((s, c) => s + (c[field] || 0), 0) / checkins.length).toFixed(1) : null;
  const psiOf = c => ((c.energy + c.sleep + (10 - c.stress) + c.focus + c.motivation) / 5) * 10;
  const avgPsi = checkins.length ? Math.round(checkins.reduce((s, c) => s + psiOf(c), 0) / checkins.length) : null;

  let psiTrend = null;
  if (checkins.length >= 14) {
    const recentPsi = checkins.slice(0, 14).reduce((s, c) => s + psiOf(c), 0) / 14;
    const olderPsi  = checkins.slice(-14).reduce((s, c) => s + psiOf(c), 0) / 14;
    psiTrend = Math.round(recentPsi - olderPsi);
  }

  const prompt = `Du är ett system som kontextualiserar vetenskapliga testresultat mot en individs faktiska dagliga data.

INDIVIDEN:
Namn: ${profile.q3_1 || "Okänt"}
Träning: ${profile.q7_1 || "—"} pass/vecka
Mål: ${profile.q1_3 || "—"}

DAGLIG DATA (senaste ${checkins.length} dagar):
Genomsnittlig energi: ${avg("energy")}/10
Genomsnittlig sömn: ${avg("sleep")}/10
Genomsnittlig stress: ${avg("stress")}/10
Genomsnittligt PSI: ${avgPsi}/100
PSI-trend (senaste 14 vs äldre 14 dagar): ${psiTrend !== null ? (psiTrend >= 0 ? `+${psiTrend}` : psiTrend) : "otillräcklig data"}

TESTRESULTAT:
Typ: ${test.test_type}
Test: ${test.label}
Värde: ${test.value} ${test.unit || ""}
Referensintervall: ${test.reference_low !== null ? `${test.reference_low}–${test.reference_high} ${test.unit || ""}` : "saknas"}
Testdatum: ${test.test_date}
Anteckningar: ${test.notes || "—"}

UPPDRAG:
Kontextualisera detta testresultat mot individens faktiska dagliga data. Svara i exakt detta JSON-format:
{
  "sammanfattning": "En mening: vad testresultatet faktiskt betyder för denna person.",
  "kontext": "Hur sömn, stress och energimönstret förklarar eller påverkar detta värde.",
  "avvikelse": "Ligger värdet utanför referens? Om ja: hur mycket och vad innebär det konkret?",
  "rekommendation": "Ett specifikt nästa steg för denna person — inte generellt.",
  "prioritet": "Hög | Normal | Låg"
}

${SPRAKREGLER}

Skriv på svenska. Var direkt.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1024,
        messages: [{ role: "user", content: prompt }] })
    });
    const json  = await resp.json();
    const raw   = json.content?.[0]?.text || "";
    const match = raw.match(/\{[\s\S]*\}/);
    const analysis = match ? saneraParsed(JSON.parse(match[0])) : { sammanfattning: raw };

    await supabase.from("lab_tests").update({
      context_analysis: JSON.stringify(analysis),
      context_generated_at: new Date().toISOString()
    }).eq("id", testId);

    res.json({ analysis });
  } catch(e) {
    console.error("[lab-agent] error:", e.message);
    res.status(500).json({ error: "agent_failed" });
  }
});

// DELETE /api/coach/clients/:clientId — återkalla åtkomst
app.delete("/api/coach/clients/:clientId", coachAuth, async (req, res) => {
  const { clientId } = req.params;
  const { error } = await supabase.from("coach_clients")
    .update({ status: "revoked" })
    .eq("coach_id", req.user.id).eq("client_id", clientId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── GDPR — permanent account deletion ──
app.delete("/api/user/delete", auth, async (req, res) => {
  const userId = req.user.id;

  // Delete all user data from every table in parallel
  await Promise.allSettled([
    supabase.from("checkins").delete().eq("user_id", userId),
    supabase.from("daily_data").delete().eq("user_id", userId),
    supabase.from("insights").delete().eq("user_id", userId),
    supabase.from("predictions").delete().eq("user_id", userId),
    supabase.from("patterns").delete().eq("user_id", userId),
    supabase.from("journal_context").delete().eq("user_id", userId),
    supabase.from("integrations").delete().eq("user_id", userId),
    supabase.from("conversations").delete().eq("user_id", userId),
    supabase.from("profiles").delete().eq("user_id", userId)
  ]);

  // Delete Supabase auth user (service role required)
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error("Delete auth user error:", error);
    return res.status(500).json({ error: "Dataradering klar men autentisering kunde inte raderas. Kontakta support." });
  }

  res.json({ ok: true, message: "Ditt konto och all data har raderats permanent." });
});

// ── CRON — daglig prediktion 06:45 (innan briefingen kl 07:00) ──
// Uppdaterar predictions-tabellen så att briefingen får färska varselstatus.
cron.schedule("45 6 * * *", async () => {
  console.log("[cron/prediction] 06:45 — startar");
  try {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const { data: rows } = await supabase
      .from("checkins")
      .select("user_id")
      .gte("date", cutoff);
    const userIds = [...new Set((rows || []).map(r => r.user_id))];
    console.log(`[cron/prediction] ${userIds.length} aktiva användare`);

    let ok = 0, fail = 0, cacheHits = 0;
    for (const uid of userIds) {
      try {
        const out = await runDailyPrediction(uid);
        if (out.ok) {
          ok++;
          if ((out.tokens?.cache_read_input_tokens || 0) > 0) cacheHits++;
        } else {
          fail++;
          console.warn(`[cron/prediction] user=${uid} hoppad (${out.reason})`);
        }
      } catch (e) {
        fail++;
        console.error(`[cron/prediction] fel user=${uid}:`, e.message);
      }
    }
    console.log(`[cron/prediction] klar — ok=${ok} fail=${fail} cache_hits=${cacheHits}/${userIds.length}`);
  } catch (e) {
    console.error("[cron/prediction] fatal:", e);
  }
}, { timezone: "Europe/Stockholm" });

// ── CRON — morgon-briefing 07:00 Europe/Stockholm ──
// Aktiv användare = någon som checkat in senaste 7 dagarna.
// Seriell körning så systempromptens cache hålls varm över flera användare.
cron.schedule("0 7 * * *", async () => {
  console.log("[cron/briefing] 07:00 — startar");
  try {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const { data: rows } = await supabase
      .from("checkins")
      .select("user_id")
      .gte("date", cutoff);
    const userIds = [...new Set((rows || []).map(r => r.user_id))];
    console.log(`[cron/briefing] ${userIds.length} aktiva användare`);

    const dateLabel = svDateLabel(new Date());
    let ok = 0, fail = 0, cacheHits = 0, emailed = 0, emailFail = 0;
    for (const uid of userIds) {
      try {
        const out = await generateMorningBriefing(uid);
        if (!out.ok) {
          fail++;
          console.warn(`[cron/briefing] user=${uid} hoppad (${out.reason})`);
          continue;
        }
        ok++;
        if ((out.tokens?.cache_read || 0) > 0) cacheHits++;

        // Email — hoppas om användaren avslutat eller saknar email
        const [userRes, profRes] = await Promise.all([
          supabase.auth.admin.getUserById(uid),
          supabase.from("profiles").select("data, email_briefing_disabled").eq("user_id", uid).maybeSingle()
        ]);
        const email    = userRes?.data?.user?.email;
        const disabled = profRes?.data?.email_briefing_disabled === true;
        if (!email || disabled) continue;

        const profileData = decryptProfile(profRes.data?.data || {});
        const name = profileData.q3_1 || "";
        const er = await sendBriefingEmail(email, name, out.narrative, dateLabel, uid);
        if (er.ok) emailed++;
        else {
          emailFail++;
          console.warn(`[cron/briefing] email-fel user=${uid}: ${er.reason}${er.status ? ` (${er.status})` : ""}`);
        }
      } catch (e) {
        fail++;
        console.error(`[cron/briefing] fel user=${uid}:`, e.message);
      }
    }
    console.log(`[cron/briefing] klar — ok=${ok} fail=${fail} cache_hits=${cacheHits}/${userIds.length} emailed=${emailed} email_fail=${emailFail}`);
  } catch (e) {
    console.error("[cron/briefing] fatal:", e);
  }
}, { timezone: "Europe/Stockholm" });

// ── CRON — meta-agent 23:00 — INAKTIVERAD ──
// cron.schedule("0 23 * * *", async () => {
//   console.log("[cron] 23:00 — meta-agent kör för aktiva användare");
//   try {
//     const today = new Date().toISOString().split("T")[0];
//     const { data: rows } = await supabase.from("checkins").select("user_id").eq("date", today);
//     const userIds = [...new Set((rows || []).map(r => r.user_id))];
//     console.log(`[cron/meta] ${userIds.length} användare med check-in idag`);
//     for (const uid of userIds) {
//       try { await runMetaAgent(uid); console.log(`[cron/meta] ok: ${uid}`); }
//       catch(e) { console.error(`[cron/meta] fel: ${uid}`, e.message); }
//     }
//   } catch(e) { console.error("[cron/meta] Fel:", e); }
// }, { timezone: "Europe/Stockholm" });

// ── CRON — daglig analys 06:00 — INAKTIVERAD ──
// cron.schedule("0 6 * * *", async () => {
//   console.log("[cron] 06:00 — daglig analys startar");
//   try {
//     const { data: users } = await supabase.from("checkins").select("user_id").gte("date", new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0]);
//     const uniqueUsers = [...new Set((users || []).map(r => r.user_id))];
//     console.log(`[cron] Analyserar ${uniqueUsers.length} aktiva användare`);
//
//     for (const userId of uniqueUsers) {
//       try {
//         const { data: checkins } = await supabase.from("checkins").select("*").eq("user_id", userId).order("date", { ascending: true });
//         const { data: profileRow } = await supabase.from("profiles").select("data").eq("user_id", userId).single();
//         const profile = profileRow?.data || {};
//         if (!checkins?.length) continue;
//
//         // Compute system score for latest
//         const latest = checkins[checkins.length - 1];
//         const sysScore = Math.round(((latest.energy || 0) + (latest.sleep || 0) + (10 - (latest.stress || 0)) + (latest.focus || 0) + (latest.motivation || 0)) / 5 * 10);
//         console.log(`[cron] user=${userId} score=${sysScore} checkins=${checkins.length}`);
//       } catch(e) {
//         console.error(`[cron] fel för user ${userId}:`, e.message);
//       }
//     }
//   console.log("[cron] Daglig analys klar");
//   } catch(e) {
//     console.error("[cron] Fel:", e);
//   }
// }, { timezone: "Europe/Stockholm" });


// ── ERROR HANDLING ──
// Sentry error handler — captures unhandled errors, no-op without DSN.
Sentry.setupExpressErrorHandler(app);

// Fallback JSON error responder (runs after Sentry's handler).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[unhandled]', err);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Forsyne – http://localhost:${PORT}`));
