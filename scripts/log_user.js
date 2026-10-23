#!/usr/bin/env node
// scripts/log_user.js
// Hämtar och loggar data för en riktig användare i samma format som simulate.js
//
// Kör med:
//   node scripts/log_user.js --email carl@...
//   node scripts/log_user.js --user_id abc-123
//   node scripts/log_user.js --email carl@... --live   ← riktigt Claude-graderingsanrop

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs   = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// ── ARGS ──
const args        = process.argv.slice(2);
const LIVE        = args.includes("--live");
const LOG_DIR     = path.join(__dirname, "..", "logs");

const emailIdx   = args.indexOf("--email");
const userIdx    = args.indexOf("--user_id");
const inputEmail  = emailIdx !== -1 ? args[emailIdx  + 1] : null;
const inputUserId = userIdx  !== -1 ? args[userIdx   + 1] : null;

if (!inputEmail && !inputUserId) {
  console.error("Användning: node scripts/log_user.js --email addr@... [--live]");
  console.error("        eller: node scripts/log_user.js --user_id <uuid> [--live]");
  process.exit(1);
}

// ── SUPABASE ADMIN (service key — bypasses RLS) ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── SIGNAL DETECTION — samma logik som servern ──
// stress >= 7 AND sleep <= 5 två dagar i rad
function detectSignal(checkins) {
  for (let i = 1; i < checkins.length; i++) {
    const prev = checkins[i - 1];
    const curr = checkins[i];
    if (prev.stress >= 7 && prev.sleep <= 5 && curr.stress >= 7 && curr.sleep <= 5) {
      return i + 1; // dag 1-indexerat
    }
  }
  return null;
}

// ── GRADE INSIKT — identisk logik med simulate.js ──
async function gradeInsikt(insikt, profile, checkins) {
  if (!insikt) return null;

  if (!LIVE) {
    console.log(`  [dry-run] gradeInsikt — ${JSON.stringify(insikt).slice(0, 80)}...`);
    return { generisk: false, specifik: true, prediktion: true, poang: 0, forklaring: "DRY-RUN - ingen gradering" };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("  ANTHROPIC_API_KEY saknas");
    return null;
  }

  const forstaCheckin = checkins[0]?.date  || "okänt";
  const sistaCheckin  = checkins[checkins.length - 1]?.date || "okänt";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{
        role:    "user",
        content: `Du är kvalitetsgranskare för Forsyne.

Profil: ${JSON.stringify(profile)}
Check-ins period: ${forstaCheckin} till ${sistaCheckin} (${checkins.length} dagar)
Alla check-ins: ${JSON.stringify(checkins)}
Insikt att granska: ${typeof insikt === "object" ? JSON.stringify(insikt) : (insikt || "")}

VIKTIGT: Check-ins sträcker sig från ${forstaCheckin} till ${sistaCheckin}. Datum i detta intervall är giltiga att referera till. Verifiera påståenden i insikten mot de faktiska värdena ovan.

Definitioner:
- generisk: insikten innehåller fraser som BARA handlar om "begränsad data", "vi behöver mer tid" eller råd som gäller alla. Sätt true om insikten PRIMÄRT är generisk. Om insikten innehåller konkreta datapunkter OCH en generisk mening — sätt false.
- specifik: insikten namnger minst ett konkret mönster från just dessa check-ins (specifika värden, datum inom perioden, trender)
- prediktion: insikten innehåller ett "om inget förändras → X händer" påstående

Svara ENBART med JSON:
{
  "generisk": true/false,
  "specifik": true/false,
  "prediktion": true/false,
  "poang": 1-10,
  "forklaring": "max 20 ord"
}`,
      }],
    }),
  });

  const data = await res.json();
  if (data?.error) {
    console.error(`  gradeInsikt API-fel: ${data.error.message}`);
    return null;
  }
  const text = data?.content?.[0]?.text || "";
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch {
    console.error(`  gradeInsikt parse-fel — svar: ${text.slice(0, 200)}`);
    return null;
  }
}

// ── SAVE LOG ──
function saveLog(log, email) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const datum     = log.timestamp.slice(0, 10); // YYYY-MM-DD
  const safeEmail = email.replace(/[@.]/g, "_");
  const logPath   = path.join(LOG_DIR, `real_${safeEmail}_${datum}.json`);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
  console.log(`\nLog: ${logPath}`);
  return logPath;
}

// ── MAIN ──
async function run() {
  let userId = inputUserId;
  let email  = inputEmail;

  // 1. Slå upp user_id ↔ email
  if (!userId) {
    console.log(`\nLetar upp user_id för ${email}...`);
    const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) { console.error("Kan inte lista användare:", error.message); process.exit(1); }
    const found = users.find(u => u.email === email);
    if (!found) { console.error(`Ingen användare hittades: ${email}`); process.exit(1); }
    userId = found.id;
    console.log(`  user_id: ${userId}`);
  } else if (!email) {
    console.log(`\nLetar upp email för ${userId}...`);
    const { data: { user }, error } = await supabase.auth.admin.getUserById(userId);
    if (error) { console.error("Kan inte hämta användare:", error.message); process.exit(1); }
    email = user.email;
    console.log(`  email: ${email}`);
  }

  console.log(`\nForsyne log_user — ${email}`);
  if (!LIVE) console.log("Läge: DRY-RUN  (Claude-gradering hoppas över — lägg till --live för riktiga anrop)\n");

  // Loggobjekt — exakt samma struktur som simulate.js
  const log = {
    persona:           "real",
    timestamp:         new Date().toISOString(),
    email,
    user_id:           userId,
    onboarding_insikt: null,
    dag_7_insikt:      null,   // tredje senaste insikt
    dag_14_insikt:     null,   // näst senaste insikt
    dag_30_insikt:     null,   // senaste insikt (graderas)
    signal_aktiverad:  false,
    signal_dag:        null,
    gradering: {
      generisk:   null,
      specifik:   null,
      prediktion: null,
      traffade:   null,
      poang:      null,
      forklaring: null,
    },
    notering:    null,
    errors:      [],
    // Extra fält för riktiga användare — inte i simulate.js-formatet
    profil:      null,
    checkins:    [],
    insikter:    [],
    valideringar: [],
  };

  // 2. Hämta all data parallellt
  console.log("1. Hämtar data från Supabase...");
  const [profileRes, checkinsRes, insightsRes, validationsRes] = await Promise.all([
    supabase.from("profiles").select("data").eq("user_id", userId).single(),
    supabase.from("checkins").select("*").eq("user_id", userId).order("date", { ascending: true }),
    supabase.from("insights")
      .select("rubrik,insikt,prioritet,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("validations")
      .select("kategori,paastående,svar,kommentar,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (profileRes.error)     log.errors.push({ step: "profile",     error: profileRes.error.message });
  if (checkinsRes.error)    log.errors.push({ step: "checkins",    error: checkinsRes.error.message });
  if (insightsRes.error)    log.errors.push({ step: "insights",    error: insightsRes.error.message });
  if (validationsRes.error) log.errors.push({ step: "validations", error: validationsRes.error.message });

  const profile     = profileRes.data?.data || {};
  const checkins    = checkinsRes.data  || [];
  const insights    = insightsRes.data  || [];
  const validations = validationsRes.data || [];

  log.profil       = profile;
  log.checkins     = checkins;
  log.insikter     = insights;
  log.valideringar = validations;

  console.log(`  Profil:       ${Object.keys(profile).length} fält`);
  console.log(`  Check-ins:    ${checkins.length}`);
  console.log(`  Insikter:     ${insights.length}`);
  console.log(`  Valideringar: ${validations.length}`);

  // 3. Signal detection
  const signalDag = detectSignal(checkins);
  log.signal_aktiverad = signalDag !== null;
  log.signal_dag       = signalDag;
  console.log(`  Signal:       ${signalDag ? `dag ${signalDag}` : "nej"}`);

  // 4. Mappar insikter till simulate.js-fälten
  // Senaste körning → dag_30_insikt, äldre → dag_14 / dag_7
  if (insights.length > 0) log.dag_30_insikt = insights[0];
  if (insights.length > 1) log.dag_14_insikt = insights[1];
  if (insights.length > 2) log.dag_7_insikt  = insights[2];

  // 5. Gradera senaste insikten
  console.log("\n2. Granskar senaste insikten...");
  if (!log.dag_30_insikt) {
    console.log("  skip — inga insikter i databasen");
  } else {
    const grade = await gradeInsikt(log.dag_30_insikt, profile, checkins);
    if (grade) {
      log.gradering = {
        generisk:   grade.generisk   ?? null,
        specifik:   grade.specifik   ?? null,
        prediktion: grade.prediktion ?? null,
        traffade:   grade.generisk === false && grade.specifik === true && grade.prediktion === true,
        poang:      grade.poang    ?? null,
        forklaring: grade.forklaring ?? null,
      };
      const { generisk, specifik, prediktion, traffade, poang, forklaring } = log.gradering;
      console.log(`  generisk:${generisk ? "FAIL" : "ok"}  specifik:${specifik ? "ok" : "fail"}  prediktion:${prediktion ? "ok" : "fail"}  poang:${poang}/10`);
      console.log(`  traffade:${traffade ? "JA" : "NEJ"}  — ${forklaring}`);
    }
  }

  // 6. Spara
  saveLog(log, email);

  if (log.errors.length > 0)
    console.warn(`\nVarning: ${log.errors.length} fel — se logfilen.`);
}

run().catch(e => { console.error(e); process.exit(1); });
