require("dotenv").config();
const fs   = require("fs");
const path = require("path");

const checkins = [
  { date:"2026-03-27", energy:8, sleep:8, stress:4, focus:8, motivation:8, moods:["fokuserad"], reflection:null },
  { date:"2026-03-28", energy:7, sleep:7, stress:5, focus:7, motivation:7, moods:["stabil"],    reflection:null },
  { date:"2026-03-29", energy:7, sleep:7, stress:5, focus:7, motivation:8, moods:["bra"],       reflection:null },
  { date:"2026-03-30", energy:6, sleep:6, stress:6, focus:6, motivation:6, moods:["okej"],      reflection:null },
  { date:"2026-03-31", energy:6, sleep:6, stress:6, focus:6, motivation:6, moods:["trött"],     reflection:null },
  { date:"2026-04-01", energy:5, sleep:5, stress:7, focus:5, motivation:5, moods:["stressad"],  reflection:"Mycket att göra" },
  { date:"2026-04-02", energy:5, sleep:5, stress:7, focus:5, motivation:5, moods:["pressad"],   reflection:null },
  { date:"2026-04-03", energy:4, sleep:4, stress:8, focus:4, motivation:4, moods:["utmattad"],  reflection:"Inte återhämtat mig" },
  { date:"2026-04-04", energy:4, sleep:4, stress:8, focus:4, motivation:4, moods:["trött","stressad"], reflection:null },
  { date:"2026-04-05", energy:4, sleep:4, stress:8, focus:3, motivation:3, moods:["utmattad"],  reflection:null },
  { date:"2026-04-06", energy:3, sleep:4, stress:8, focus:3, motivation:3, moods:["utmattad","pressad"], reflection:"Behöver vila" },
  { date:"2026-04-07", energy:3, sleep:4, stress:7, focus:3, motivation:3, moods:["trött"],     reflection:null },
  { date:"2026-04-08", energy:4, sleep:5, stress:7, focus:4, motivation:4, moods:["okej"],      reflection:null },
  { date:"2026-04-09", energy:4, sleep:4, stress:8, focus:3, motivation:3, moods:["utmattad"],  reflection:"Signalen borde vara aktiv" }
];

const profile = {
  q3_1:"Carl", q3_2:"28", q3_3:"Man",
  q1_1:"Jag vill förstå varför energin crashar varje gång jag presterar bra",
  q2_1:"Morgonmänniska — toppar kl 8-11",
  q6_1:"6-7 timmar, sällan mer",
  q7_1:"4",
  q4_1:"Egenföretagare, hög kognitiv belastning"
};

const AGENTS = {};
["2_checkin","3_insights","4_prediction","5_datasources","9_balance"].forEach(name => {
  const file = path.join(__dirname, "agents", "agent_" + name + ".md");
  if (fs.existsSync(file)) AGENTS[name.split("_")[0]] = fs.readFileSync(file, "utf8");
});

async function claude(system, user, maxTokens, model) {
  model = model || "claude-haiku-4-5-20251001";
  maxTokens = maxTokens || 600;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type":"application/json", "x-api-key":process.env.ANTHROPIC_API_KEY, "anthropic-version":"2023-06-01" },
    body: JSON.stringify({ model, max_tokens:maxTokens, system, messages:[{role:"user",content:user}] })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d?.content?.[0]?.text || "";
}

function parseJSON(text) {
  try { const m = text.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : text); }
  catch { return null; }
}

function avg(arr, f) { return arr.length ? (arr.reduce((s,x) => s+(x[f]||0), 0)/arr.length).toFixed(1) : "—"; }

async function run() {
  const today  = "2026-04-09";
  const n      = checkins.length;
  const sorted = [...checkins].sort((a,b) => a.date < b.date ? -1 : 1);
  const latest = sorted[sorted.length - 1];
  const r7     = sorted.slice(-7);
  const r3     = sorted.slice(-3);

  console.log("Loaded agents:", Object.keys(AGENTS).join(", "));
  console.log("Checkins:", n, "| Latest:", latest.date, "E"+latest.energy+" Sl"+latest.sleep+" St"+latest.stress);

  // ── STEP 1: Agent 5 ──
  console.log("\n─── STEP 1 — Agent 5: Normalize ───");
  const psiSummary = ["energi","sömn","stress"].map(k => {
    const f = k === "sömn" ? "sleep" : k === "energi" ? "energy" : "stress";
    return k + ": snitt " + avg(r7, f);
  }).join(" · ");
  const obs5 = await claude(
    AGENTS["5"] || "Du är Forsyne datakälle-agent. Kommentera PSI-avvikelser på svenska.",
    "PSI-data: " + psiSummary + ". Systempoäng baserat på de senaste 7 dagarna. Skriv EN mening (max 25 ord) om den mest anmärkningsvärda avvikelsen.",
    100
  );
  console.log("✓ obs:", obs5.trim());

  // ── STEP 2+3: Agent 4 + Agent 3 parallel ──
  console.log("\n─── STEP 2+3 — Agent 4 (Pred) + Agent 3 (Insight) — parallel ───");
  const rev = [...sorted].reverse();
  let hS = 0; for (const c of rev) { if (c.stress >= 7 && c.sleep <= 5) hS++; else break; }
  let sS = 0; for (const c of rev) { if (c.stress >= 6 && c.sleep <= 5) sS++; else break; }
  const varselActive = hS >= 2 || sS >= 3;
  const streak = hS >= 2 ? hS : sS >= 3 ? sS : 0;
  const vs = !varselActive ? "ingen" : streak >= 5 ? "kritiskt" : streak >= 3 ? "aktivt" : "tidig_signal";
  console.log("Varsel:", vs, "| Streak:", streak, "(hard=" + hS + " soft=" + sS + ")");

  const pred4Msg = [
    "IDAG: " + today,
    "ANTAL CHECK-INS: " + n,
    "VARSEL-STATUS: " + vs + " (dag " + streak + " av max 7)",
    "",
    "SENASTE CHECK-IN (" + latest.date + "):",
    "Energi " + latest.energy + "/10 · Sömn " + latest.sleep + "/10 · Stress " + latest.stress + "/10 · Fokus " + latest.focus + "/10 · Motivation " + latest.motivation + "/10",
    "",
    "7-DAGARSSNITT: Energi " + avg(r7,"energy") + " · Sömn " + avg(r7,"sleep") + " · Stress " + avg(r7,"stress"),
    "",
    "PROFIL: Namn Carl · Ålder 28 · Egenföretagare · Hög kognitiv belastning",
    "",
    'Svara EXAKT i detta JSON-format:',
    '{"varsel_status":"' + vs + '","varsel_dag":' + streak + ',"sannolikhet_krasch":0,"sannolikhet_avvärjning":0,"dagar_till_krasch":0,"kritisk_atgard":"...","insikt":"2-3 meningar.","om_atgard":[{"metrik":"Energi imorgon","prediktion":"...","positiv":true}],"om_inget":[{"metrik":"Krasch","prediktion":"...","positiv":false}],"tidslinje":[{"dag":"Nu","prognos":"...","status":"nu"}]}'
  ].join("\n");

  const ins3Msg = [
    "KONTEXT: dashboard",
    "IDAG: " + today,
    "ANTAL CHECK-INS TOTALT: " + n,
    "",
    "SENASTE CHECK-IN (" + latest.date + "):",
    "Energi " + latest.energy + "/10 · Sömn " + latest.sleep + "/10 · Stress " + latest.stress + "/10",
    "",
    "7-DAGARSSNITT: Energi " + avg(r7,"energy") + " · Sömn " + avg(r7,"sleep") + " · Stress " + avg(r7,"stress"),
    "",
    "VARSEL-STREAK: " + (streak > 0 ? streak + " dagar" : "Ingen aktiv"),
    "SENASTE REFLEKTIONER: " + sorted.filter(c=>c.reflection).slice(-3).map(c => '"'+c.reflection+'"').join(" / "),
    "",
    "PROFIL: Namn Carl · Ålder 28 · Livssituation: egenföretagare",
    "",
    'Svara EXAKT i detta JSON-format:',
    '{"insikt":"2-3 meningar. Personlig specifik insikt.","sammanfattning":"1 mening.","rekommendation":"1 konkret atgard.","styrka":"1 mening."}'
  ].join("\n");

  const [p4txt, i3txt] = await Promise.all([
    claude(AGENTS["4"] || "Du är Forsyne prediktions-agent. Svara alltid i JSON.", pred4Msg, 800),
    claude(AGENTS["3"] || "Du är Forsyne insikts-agent. Svara alltid i JSON.", ins3Msg, 500)
  ]);

  const prediction = parseJSON(p4txt);
  const insight    = parseJSON(i3txt);

  if (prediction) {
    console.log("✓ PREDICTION:", JSON.stringify({
      varsel_status:    prediction.varsel_status || prediction["varsel_status"],
      varsel_dag:       prediction.varsel_dag    || prediction["varsel_dag"],
      sannolikhet_krasch: prediction.sannolikhet_krasch || prediction["sannolikhet_krasch"],
      kritisk_atgard:   prediction.kritisk_atgard || prediction["kritisk_åtgärd"] || prediction["kritisk_atgard"],
      insikt:           (prediction.insikt || "").slice(0, 80) + "…"
    }, null, 2));
  } else {
    console.log("✗ PREDICTION parse failed. Raw:", p4txt.slice(0, 200));
  }

  if (insight) {
    console.log("✓ INSIGHT:", JSON.stringify({
      insikt:        (insight.insikt || "").slice(0, 80) + "…",
      sammanfattning: insight.sammanfattning,
      rekommendation: insight.rekommendation,
      styrka:         insight.styrka
    }, null, 2));
  } else {
    console.log("✗ INSIGHT parse failed. Raw:", i3txt.slice(0, 200));
  }

  // ── STEP 4: Agent 9 ──
  console.log("\n─── STEP 4 — Agent 9: Balance ───");
  if (!AGENTS["9"]) { console.log("✗ Agent 9 not loaded"); return; }

  const b9Msg = [
    "IDAG: " + today,
    "ANTAL CHECK-INS: " + n,
    "",
    "SENASTE MÄTVÄRDEN (" + latest.date + "):",
    "Energi " + latest.energy + "/10 · Sömn " + latest.sleep + "/10 · Stress " + latest.stress + "/10 · Fokus " + latest.focus + "/10 · Motivation " + latest.motivation + "/10",
    "",
    "7-DAGARSSNITT: Energi " + avg(r7,"energy") + " · Sömn " + avg(r7,"sleep") + " · Stress " + avg(r7,"stress"),
    "",
    "TRENDER (sista 3 dagar): Energi sjunkande · Stress stigande",
    "",
    (varselActive ? "SIGNALEN AKTIV — Dag " + streak + ". Sök efter styrka som är sann trots signalen." : "Ingen aktiv signal."),
    "",
    "AGENT 3 INSIKT: " + (insight?.insikt || "—"),
    "AGENT 4 STATUS: " + vs + " dag " + streak,
    "",
    "PROFIL: Carl · Egenföretagare · Hög kognitiv belastning · Morgonmänniska",
    "",
    "Sök efter vad som faktiskt fungerar i datan. Svara EXAKT i detta JSON-format:",
    '{"datum":"' + today + '","styrkeinsikt":"","formel_bekraftad":false,"formel_text":"","balans_tillagg_till_agent3":"","avvärjnings_förstärkare":[],"check_in_avslutning":"Vad fungerade igår — även något litet?","producerade_output":true}'
  ].join("\n");

  const b9txt  = await claude(AGENTS["9"], b9Msg, 350);
  const balance = parseJSON(b9txt);

  if (balance) {
    console.log("✓ BALANCE:", JSON.stringify(balance, null, 2));
  } else {
    console.log("✗ BALANCE parse failed. Raw:", b9txt.slice(0, 300));
  }

  console.log("\n═══ PIPELINE COMPLETE ═══");
  console.log("Agents run: 5 ✓  4 ✓  3 ✓  9 ✓");
  console.log("All results would be saved to daily_data table after schema is created in Supabase.");
}

run().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
