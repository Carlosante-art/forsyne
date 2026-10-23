#!/usr/bin/env node
// scripts/simulate.js
// Kör med: node scripts/simulate.js --persona stressed
// Tillgängliga personas: stressed, athlete, sedentary, diabetic, optimizer

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const { createClient } = require("@supabase/supabase-js");

// ── ARGS ──
const args = process.argv.slice(2);
const personaIdx = args.indexOf("--persona");
const personaArg = personaIdx !== -1 ? args[personaIdx + 1] : "stressed";
const BASE_URL   = `http://localhost:${process.env.PORT || 3000}`;
const LOG_DIR    = path.join(__dirname, "..", "logs");

// --dry-run är default. Riktiga Claude API-anrop kräver --live.
const DRY_RUN = !args.includes("--live");

// ── SUPABASE ADMIN (service key — bypasses RLS för bulk-insert) ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── HELPERS ──
function dateOffset(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

async function apiRequest(method, endpoint, body, token) {
  return new Promise((resolve, reject) => {
    const url  = new URL(BASE_URL + endpoint);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port:     parseInt(url.port) || 3000,
      path:     url.pathname,
      method,
      headers:  { "Content-Type": "application/json" },
    };
    if (token) opts.headers["Authorization"] = `Bearer ${token}`;
    if (data)  opts.headers["Content-Length"] = Buffer.byteLength(data);

    const req = http.request(opts, res => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── CHECK-IN PATTERNS ──
// Varje mönster är en 30-dagars historia. Inte slumpmässiga värden —
// varje persona bygger upp mot en kris eller insikt som agenten kan läsa.
// sleep = timmar (inte 1–10 skala)
const PATTERNS = {

  // Jobbar för mycket → kris vecka 3 → helgåterhämtning → tillbaka till mönstret
  stress_high_sleep_low: [
    // Vecka 1: Etablera baseline — funktionell men inte bra
    { stress: 6,   sleep: 6.5, energy: 5, focus: 5, motivation: 5, moods: ["Stressad", "Fokuserad"],    reflection: null },
    { stress: 6,   sleep: 6.5, energy: 5, focus: 5, motivation: 5, moods: ["Neutral"],                  reflection: null },
    { stress: 6,   sleep: 6.0, energy: 5, focus: 5, motivation: 4, moods: ["Trött"],                    reflection: null },
    { stress: 6,   sleep: 6.5, energy: 5, focus: 5, motivation: 5, moods: ["Stressad"],                 reflection: null },
    { stress: 6,   sleep: 6.5, energy: 5, focus: 6, motivation: 5, moods: ["Fokuserad"],                reflection: null },
    { stress: 4,   sleep: 7.5, energy: 6, focus: 6, motivation: 6, moods: ["Lugn"],                     reflection: "Helg. Äntligen lite luft." },
    { stress: 3,   sleep: 8.0, energy: 7, focus: 6, motivation: 7, moods: ["Lugn", "Utvilad"],          reflection: null },
    // Vecka 2: Stress börjar stiga
    { stress: 7,   sleep: 5.5, energy: 4, focus: 5, motivation: 4, moods: ["Stressad"],                 reflection: null },
    { stress: 8,   sleep: 5.5, energy: 4, focus: 4, motivation: 4, moods: ["Stressad", "Spänd"],        reflection: null },
    { stress: 7,   sleep: 5.0, energy: 4, focus: 4, motivation: 3, moods: ["Trött"],                    reflection: null },
    { stress: 8,   sleep: 5.5, energy: 4, focus: 4, motivation: 4, moods: ["Spänd"],                    reflection: "Märker att jag inte kan varva ner på kvällarna." },
    { stress: 7,   sleep: 5.0, energy: 4, focus: 5, motivation: 4, moods: ["Stressad"],                 reflection: null },
    { stress: 5,   sleep: 7.0, energy: 5, focus: 5, motivation: 5, moods: ["Neutral"],                  reflection: null },
    { stress: 4,   sleep: 7.5, energy: 6, focus: 6, motivation: 6, moods: ["Lugn"],                     reflection: null },
    // Vecka 3: Kris — signal ska trigga dag 17
    { stress: 9,   sleep: 4.5, energy: 3, focus: 3, motivation: 2, moods: ["Överväldigad", "Trött"],    reflection: null },
    { stress: 8,   sleep: 5.0, energy: 3, focus: 3, motivation: 2, moods: ["Utmattad"],                 reflection: null },
    { stress: 9,   sleep: 4.0, energy: 2, focus: 2, motivation: 1, moods: ["Överväldigad", "Utmattad"], reflection: "Klarar inte mer. Kroppen stänger ner." },
    { stress: 8,   sleep: 4.5, energy: 3, focus: 3, motivation: 2, moods: ["Trött", "Spänd"],           reflection: null },
    { stress: 7,   sleep: 5.0, energy: 4, focus: 4, motivation: 3, moods: ["Stressad"],                 reflection: null },
    { stress: 3,   sleep: 8.0, energy: 7, focus: 6, motivation: 6, moods: ["Lugn", "Lättad"],           reflection: "Helgen räddade mig. Men imorgon börjar det igen." },
    { stress: 2,   sleep: 8.5, energy: 8, focus: 7, motivation: 7, moods: ["Utvilad"],                  reflection: null },
    // Vecka 4: Tillbaka till mönstret — baseline som aldrig förändras
    { stress: 7,   sleep: 5.5, energy: 4, focus: 4, motivation: 4, moods: ["Stressad"],                 reflection: null },
    { stress: 7,   sleep: 5.5, energy: 4, focus: 5, motivation: 4, moods: ["Neutral"],                  reflection: null },
    { stress: 7,   sleep: 5.0, energy: 4, focus: 4, motivation: 3, moods: ["Trött"],                    reflection: null },
    { stress: 7,   sleep: 5.5, energy: 4, focus: 4, motivation: 4, moods: ["Stressad"],                 reflection: null },
    { stress: 8,   sleep: 5.0, energy: 3, focus: 4, motivation: 3, moods: ["Spänd", "Trött"],           reflection: "Samma mönster. Vet inte hur jag bryter det." },
    { stress: 7,   sleep: 5.5, energy: 4, focus: 4, motivation: 4, moods: ["Stressad"],                 reflection: null },
    { stress: 4,   sleep: 7.5, energy: 6, focus: 5, motivation: 5, moods: ["Neutral"],                  reflection: null },
    { stress: 3,   sleep: 8.0, energy: 7, focus: 6, motivation: 6, moods: ["Lugn"],                     reflection: null },
    { stress: 7,   sleep: 5.5, energy: 4, focus: 4, motivation: 4, moods: ["Stressad"],                 reflection: null },
  ],

  // Tränar för hårt → överträning vecka 3 → tvingad vila → delvis återhämtning
  high_training_low_recovery: [
    // Vecka 1: Hög men hanterbar belastning
    { stress: 4, sleep: 7.5, energy: 8, focus: 8, motivation: 9, moods: ["Energifull", "Motiverad"],  reflection: null },
    { stress: 6, sleep: 6.5, energy: 6, focus: 7, motivation: 8, moods: ["Trött", "Motiverad"],       reflection: "Hårt pass. Men det känns rätt." },
    { stress: 3, sleep: 8.0, energy: 9, focus: 8, motivation: 9, moods: ["Stark", "Fokuserad"],       reflection: null },
    { stress: 5, sleep: 7.0, energy: 7, focus: 7, motivation: 8, moods: ["Fokuserad"],                reflection: null },
    { stress: 7, sleep: 6.0, energy: 5, focus: 6, motivation: 7, moods: ["Trött", "Motiverad"],       reflection: null },
    { stress: 2, sleep: 8.5, energy: 9, focus: 8, motivation: 8, moods: ["Utvilad"],                  reflection: null },
    { stress: 2, sleep: 9.0, energy: 9, focus: 8, motivation: 9, moods: ["Stark"],                    reflection: null },
    // Vecka 2: Rampar upp — överträningstecken börjar synas
    { stress: 5, sleep: 7.0, energy: 7, focus: 7, motivation: 9, moods: ["Fokuserad"],                reflection: null },
    { stress: 8, sleep: 5.5, energy: 5, focus: 5, motivation: 8, moods: ["Utmattad", "Motiverad"],    reflection: "Kroppen protesterar men hjärnan vill fortsätta." },
    { stress: 4, sleep: 7.5, energy: 7, focus: 7, motivation: 8, moods: ["Stark"],                    reflection: null },
    { stress: 8, sleep: 5.0, energy: 4, focus: 5, motivation: 7, moods: ["Trött", "Spänd"],           reflection: null },
    { stress: 9, sleep: 5.0, energy: 4, focus: 4, motivation: 7, moods: ["Utmattad"],                 reflection: "Vaknade utmattad trots 8h sömn. Dålig signal." },
    { stress: 3, sleep: 8.0, energy: 7, focus: 6, motivation: 7, moods: ["Neutral"],                  reflection: null },
    { stress: 3, sleep: 8.5, energy: 8, focus: 7, motivation: 8, moods: ["Utvilad"],                  reflection: null },
    // Vecka 3: Kris — kroppen vägrar
    { stress: 9, sleep: 5.0, energy: 3, focus: 4, motivation: 8, moods: ["Utmattad", "Frustrerad"],   reflection: null },
    { stress: 9, sleep: 5.5, energy: 3, focus: 3, motivation: 7, moods: ["Utmattad"],                 reflection: "Skadan i knät. Vet att jag borde vila." },
    { stress: 8, sleep: 5.0, energy: 3, focus: 3, motivation: 6, moods: ["Frustrerad", "Utmattad"],   reflection: null },
    { stress: 9, sleep: 4.5, energy: 2, focus: 3, motivation: 5, moods: ["Utmattad", "Frustrerad"],   reflection: "Tränade ändå. Idiotisk beslut." },
    { stress: 7, sleep: 6.0, energy: 4, focus: 4, motivation: 5, moods: ["Trött"],                    reflection: null },
    { stress: 5, sleep: 7.5, energy: 6, focus: 6, motivation: 6, moods: ["Neutral"],                  reflection: null },
    { stress: 4, sleep: 8.0, energy: 7, focus: 6, motivation: 6, moods: ["Lugn"],                     reflection: "Tvingas vila av skadan. Kanske systemet har rätt." },
    // Vecka 4: Tvingad vila → försiktig återhämtning
    { stress: 4, sleep: 8.0, energy: 7, focus: 7, motivation: 6, moods: ["Neutral"],                  reflection: null },
    { stress: 3, sleep: 8.5, energy: 8, focus: 7, motivation: 7, moods: ["Utvilad"],                  reflection: null },
    { stress: 3, sleep: 8.0, energy: 8, focus: 8, motivation: 7, moods: ["Stark"],                    reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 7, motivation: 7, moods: ["Fokuserad"],                reflection: null },
    { stress: 5, sleep: 7.0, energy: 7, focus: 7, motivation: 8, moods: ["Motiverad"],                reflection: "Varsamt tillbaka. Kroppen svarar annorlunda nu." },
    { stress: 4, sleep: 7.5, energy: 7, focus: 7, motivation: 8, moods: ["Fokuserad"],                reflection: null },
    { stress: 3, sleep: 8.0, energy: 8, focus: 8, motivation: 8, moods: ["Stark"],                    reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 7, motivation: 8, moods: ["Fokuserad"],                reflection: null },
    { stress: 5, sleep: 7.0, energy: 6, focus: 7, motivation: 8, moods: ["Motiverad"],                reflection: null },
  ],

  // Aldrig tränats, jobbar stillasittande — 30 dagar av kronisk, oförklarlig trötthet
  stable_low: [
    // Ingen dramatisk kris — det är det som är problemet
    { stress: 5, sleep: 7.0, energy: 4, focus: 5, motivation: 4, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 4, moods: ["Trött"],                reflection: null },
    { stress: 5, sleep: 6.5, energy: 4, focus: 5, motivation: 3, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 4, moods: ["Trött"],                reflection: "Trött igen. Som alltid." },
    { stress: 5, sleep: 7.0, energy: 5, focus: 5, motivation: 4, moods: ["Neutral"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 5, focus: 5, motivation: 5, moods: ["Neutral"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 5, focus: 5, motivation: 4, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 3, moods: ["Trött"],                reflection: null },
    { stress: 5, sleep: 6.5, energy: 4, focus: 4, motivation: 3, moods: ["Neutral"],              reflection: null },
    { stress: 6, sleep: 6.5, energy: 3, focus: 4, motivation: 3, moods: ["Trött"],                reflection: "Sover tillräckligt men vaknar ändå trött." },
    { stress: 5, sleep: 7.0, energy: 4, focus: 5, motivation: 4, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 3, moods: ["Trött"],                reflection: null },
    { stress: 4, sleep: 7.5, energy: 5, focus: 5, motivation: 4, moods: ["Neutral"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 5, focus: 5, motivation: 5, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 3, moods: ["Trött"],                reflection: null },
    { stress: 5, sleep: 6.5, energy: 4, focus: 4, motivation: 3, moods: ["Neutral"],              reflection: null },
    { stress: 6, sleep: 6.5, energy: 3, focus: 3, motivation: 2, moods: ["Trött", "Uttråkad"],    reflection: "Förstår inte. Dricker inte, sover bra, äter okej. Ändå detta." },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 3, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 5, motivation: 4, moods: ["Neutral"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 5, focus: 5, motivation: 5, moods: ["Neutral"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 5, focus: 5, motivation: 4, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 3, moods: ["Trött"],                reflection: null },
    { stress: 5, sleep: 6.5, energy: 4, focus: 4, motivation: 3, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 3, moods: ["Trött"],                reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 5, motivation: 4, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 6.5, energy: 3, focus: 4, motivation: 3, moods: ["Trött"],                reflection: "30 dagar. Ingenting har förändrats." },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 3, moods: ["Neutral"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 5, focus: 5, motivation: 4, moods: ["Neutral"],              reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 3, moods: ["Trött"],                reflection: null },
    { stress: 5, sleep: 7.0, energy: 4, focus: 4, motivation: 3, moods: ["Neutral"],              reflection: null },
  ],

  // God kontroll → stressperiod vecka 3 → svängningar → stabiliserar sig
  variable_glucose: [
    // Vecka 1: Välkontrollerat
    { stress: 3, sleep: 7.5, energy: 7, focus: 7, motivation: 7, moods: ["Stabil", "Fokuserad"],  reflection: null },
    { stress: 3, sleep: 7.5, energy: 7, focus: 8, motivation: 7, moods: ["Alert"],                reflection: null },
    { stress: 4, sleep: 7.0, energy: 6, focus: 7, motivation: 6, moods: ["Stabil"],               reflection: null },
    { stress: 3, sleep: 7.5, energy: 7, focus: 7, motivation: 7, moods: ["Stabil"],               reflection: null },
    { stress: 4, sleep: 7.0, energy: 6, focus: 6, motivation: 6, moods: ["Neutral"],              reflection: "Bra vecka. Glukoset stabilt." },
    { stress: 2, sleep: 8.0, energy: 8, focus: 7, motivation: 8, moods: ["Lugn"],                 reflection: null },
    { stress: 2, sleep: 8.5, energy: 8, focus: 8, motivation: 8, moods: ["Utvilad"],              reflection: null },
    // Vecka 2: Fortfarande bra, lite variation
    { stress: 4, sleep: 7.0, energy: 7, focus: 7, motivation: 7, moods: ["Fokuserad"],            reflection: null },
    { stress: 5, sleep: 6.5, energy: 5, focus: 5, motivation: 6, moods: ["Dimmig"],               reflection: "Lite lågt idag. Svårt att fokusera förmiddagen." },
    { stress: 3, sleep: 7.5, energy: 7, focus: 8, motivation: 7, moods: ["Alert"],                reflection: null },
    { stress: 4, sleep: 7.0, energy: 6, focus: 7, motivation: 6, moods: ["Stabil"],               reflection: null },
    { stress: 4, sleep: 7.0, energy: 6, focus: 6, motivation: 6, moods: ["Neutral"],              reflection: null },
    { stress: 2, sleep: 8.0, energy: 8, focus: 7, motivation: 7, moods: ["Lugn"],                 reflection: null },
    { stress: 2, sleep: 8.5, energy: 8, focus: 8, motivation: 8, moods: ["Utvilad"],              reflection: null },
    // Vecka 3: Stressperiod → glukoset spårar ur
    { stress: 7, sleep: 6.0, energy: 4, focus: 3, motivation: 5, moods: ["Dimmig", "Irritabel"],  reflection: "Lågt hela morgonen. Äter rätt men kroppen lyssnar inte." },
    { stress: 8, sleep: 5.5, energy: 3, focus: 3, motivation: 4, moods: ["Trött", "Irritabel"],   reflection: null },
    { stress: 7, sleep: 6.0, energy: 5, focus: 5, motivation: 5, moods: ["Stabil"],               reflection: null },
    { stress: 8, sleep: 5.5, energy: 3, focus: 2, motivation: 3, moods: ["Dimmig", "Utmattad"],   reflection: "Värst hittills. Tappade fokus mitt i ett möte." },
    { stress: 7, sleep: 6.0, energy: 4, focus: 4, motivation: 4, moods: ["Irritabel"],            reflection: null },
    { stress: 5, sleep: 7.0, energy: 6, focus: 6, motivation: 6, moods: ["Neutral"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 6, motivation: 6, moods: ["Lugn"],                 reflection: "Helgen hjälpte. Men veckan var brutal." },
    // Vecka 4: Aktivt stabiliseringsarbete
    { stress: 5, sleep: 7.0, energy: 6, focus: 6, motivation: 6, moods: ["Stabil"],               reflection: null },
    { stress: 5, sleep: 7.0, energy: 5, focus: 6, motivation: 6, moods: ["Neutral"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 7, motivation: 7, moods: ["Fokuserad"],            reflection: null },
    { stress: 4, sleep: 7.0, energy: 6, focus: 7, motivation: 6, moods: ["Stabil"],               reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 7, motivation: 7, moods: ["Alert"],                reflection: "Märker sambandet — när jag stressar spårar glukoset ur." },
    { stress: 3, sleep: 7.5, energy: 7, focus: 7, motivation: 7, moods: ["Stabil"],               reflection: null },
    { stress: 3, sleep: 8.0, energy: 8, focus: 8, motivation: 8, moods: ["Fokuserad"],            reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 7, motivation: 7, moods: ["Stabil"],               reflection: null },
    { stress: 3, sleep: 7.5, energy: 7, focus: 7, motivation: 7, moods: ["Alert"],                reflection: null },
  ],

  // Redan bra → en jobbig vecka → snabb återhämtning → djupare förståelse
  generally_good: [
    // Vecka 1: Hög baslinje
    { stress: 3, sleep: 8.0, energy: 8, focus: 8, motivation: 8, moods: ["Fokuserad", "Energifull"], reflection: null },
    { stress: 3, sleep: 7.5, energy: 8, focus: 9, motivation: 9, moods: ["Alert"],                   reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 8, motivation: 8, moods: ["Fokuserad"],               reflection: null },
    { stress: 3, sleep: 8.0, energy: 8, focus: 8, motivation: 8, moods: ["Energifull"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 8, motivation: 7, moods: ["Fokuserad"],               reflection: "Mår generellt bra. Undrar ändå vad jag missar." },
    { stress: 2, sleep: 8.5, energy: 9, focus: 8, motivation: 9, moods: ["Utvilad", "Lugn"],         reflection: null },
    { stress: 2, sleep: 9.0, energy: 9, focus: 8, motivation: 9, moods: ["Stark"],                   reflection: null },
    // Vecka 2: Fortfarande bra
    { stress: 3, sleep: 8.0, energy: 8, focus: 9, motivation: 8, moods: ["Alert"],                   reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 8, motivation: 8, moods: ["Fokuserad"],               reflection: null },
    { stress: 3, sleep: 8.0, energy: 8, focus: 8, motivation: 8, moods: ["Energifull"],              reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 7, motivation: 7, moods: ["Fokuserad"],               reflection: null },
    { stress: 4, sleep: 7.5, energy: 7, focus: 8, motivation: 7, moods: ["Neutral"],                 reflection: "Lite under min topp men fortfarande bra." },
    { stress: 2, sleep: 8.5, energy: 9, focus: 8, motivation: 9, moods: ["Lugn"],                    reflection: null },
    { stress: 2, sleep: 9.0, energy: 9, focus: 9, motivation: 9, moods: ["Stark"],                   reflection: null },
    // Vecka 3: En jobbig vecka — projekt, sömnbrist
    { stress: 6, sleep: 6.5, energy: 6, focus: 6, motivation: 7, moods: ["Fokuserad", "Spänd"],      reflection: null },
    { stress: 7, sleep: 6.0, energy: 5, focus: 6, motivation: 6, moods: ["Stressad"],                reflection: "Deadline-vecka. Märker direkt i energin." },
    { stress: 7, sleep: 5.5, energy: 5, focus: 5, motivation: 6, moods: ["Stressad", "Trött"],       reflection: null },
    { stress: 8, sleep: 5.5, energy: 4, focus: 5, motivation: 5, moods: ["Trött"],                   reflection: null },
    { stress: 6, sleep: 6.0, energy: 6, focus: 6, motivation: 6, moods: ["Neutral"],                 reflection: null },
    { stress: 3, sleep: 8.5, energy: 8, focus: 7, motivation: 8, moods: ["Lättad"],                  reflection: "Klart. Kroppen återhämtar sig snabbt — det är nytt att notera." },
    { stress: 2, sleep: 9.0, energy: 9, focus: 8, motivation: 9, moods: ["Utvilad"],                 reflection: null },
    // Vecka 4: Tillbaka + djupare förståelse
    { stress: 3, sleep: 8.0, energy: 8, focus: 9, motivation: 9, moods: ["Fokuserad"],               reflection: null },
    { stress: 3, sleep: 8.0, energy: 8, focus: 9, motivation: 8, moods: ["Alert"],                   reflection: null },
    { stress: 3, sleep: 7.5, energy: 8, focus: 8, motivation: 8, moods: ["Energifull"],              reflection: null },
    { stress: 3, sleep: 8.0, energy: 8, focus: 9, motivation: 9, moods: ["Fokuserad"],               reflection: null },
    { stress: 2, sleep: 8.5, energy: 9, focus: 9, motivation: 9, moods: ["Stark"],                   reflection: "Ser nu hur sömnkvaliteten driver allt annat. Vill förstå exakt varför." },
    { stress: 2, sleep: 8.5, energy: 9, focus: 9, motivation: 9, moods: ["Alert"],                   reflection: null },
    { stress: 2, sleep: 9.0, energy: 9, focus: 9, motivation: 9, moods: ["Stark", "Nyfiken"],        reflection: null },
    { stress: 3, sleep: 8.0, energy: 8, focus: 8, motivation: 9, moods: ["Fokuserad"],               reflection: null },
    { stress: 2, sleep: 8.5, energy: 9, focus: 9, motivation: 9, moods: ["Stark"],                   reflection: null },
  ],
};

// ── RANDOM PATTERN GENERATOR ──
function generateRandomPattern() {
  const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
  const rInt  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const rHalf = (min, max) => Math.round((Math.random() * (max - min) + min) * 2) / 2;
  const MOODS = ["Lugn", "Neutral", "Fokuserad", "Trott", "Stressad", "Glad", "Energisk", "Nedstamd", "Stand", "Utmattad", "Utvilad", "Orolig"];

  return Array.from({ length: 30 }, (_, i) => ({
    stress:     rInt(1, 9),
    sleep:      rHalf(4, 9),
    energy:     rInt(2, 9),
    focus:      rInt(2, 9),
    motivation: rInt(2, 9),
    moods:      [pick(MOODS), ...(Math.random() > 0.6 ? [pick(MOODS)] : [])],
    reflection: Math.random() > 0.85 ? pick(["Konstigt dag.", "Trott idag.", "Bra kval.", "Ingen energi.", "Lattare an vanligt."]) : null,
  }));
}

// ── RANDOM ONBOARDING GENERATOR ──
function generateRandomOnboarding() {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const rInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  return {
    q1_1:  pick(["Vill forsta hur min kropp fungerar", "Trott hela tiden", "Vill prestera battre", "Stress paverkar mig for mycket", "Sovproblem sedan lange"]),
    q2_1:  pick(["Morgon", "Kväll", "Mitt på dagen", "Varierar"]),
    q2_6:  pick(["Tränar bort den", "Jobbar bort den", "Ignorerar den", "Mediterar"]),
    q3_2:  rInt(20, 62),
    q3_3:  pick(["Man", "Kvinna", "Annat"]),
    q4_2:  pick(["Under 30h", "30-40h", "40-50h", "Över 60h"]),
    q4_7:  pick(["Stabilt", "Kaotiskt", "Lugnare period"]),
    q5_1:  pick(["Ja, inom 30 minuter", "Ja, men senare på dagen", "Sällan", "Nästan aldrig"]),
    q5_2:  pick(["Under 30 min", "30–60 min", "1–3 timmar", "Över 3 timmar"]),
    q5_3:  pick(["Mörkt kontor", "Naturligt ljus", "Blandat", "Varierar"]),
    q5_4:  pick(["Kallt rum, öppet fönster", "Svalt", "Varmt", "Varierar"]),
    q5_5:  pick(["Ingen alls", "Lite", "En hel del", "Somnar med skärmen"]),
    q5_6:  pick(["Sällan", "Ibland", "Ofta", "Konstant"]),
    q6_1:  pick(["Under 5h", "5–6h", "6–7h", "7–8h", "Över 8h"]),
    q6_2:  pick(["Ja, nästan alltid", "Ibland", "Sällan", "Aldrig — känns som att jag aldrig återhämtar mig"]),
    q6_3:  pick(["Ja, direkt", "Tar 15–30 min", "Ligger och snurrar länge", "Det varierar"]),
    q6_4:  pick(["Sällan", "1–2 gånger", "Ofta", "Nästan varje natt"]),
    q6_5:  pick(["Ja, ganska fasta", "Ibland", "Nej, varierar helt"]),
    q6_8:  pick(["Oura", "Whoop", "Garmin", "Apple Watch", "Nej"]),
    q7_1:  pick(["0–1", "2–3", "4–5", "6+"]),
    q7_4:  pick(["Pigg", "Okej", "Utmattad", "Det varierar"]),
    q7_5:  pick(["Ja, ofta", "Ibland", "Sällan", "Aldrig"]),
    q7_6:  pick(["Morgon", "Lunch", "Eftermiddag", "Kväll", "Varierar"]),
    q7_8:  pick(["Prestation", "Hälsa & livslängd", "Utseende", "Stresshantering", "Inget specifikt mål"]),
    q8_1:  pick(["1–2", "3", "4–5", "Oregelbundet"]),
    q8_2:  pick(["Ofta", "Ibland", "Sällan", "Aldrig"]),
    q8_3:  pick(["Pigg och fokuserad", "Trög och dåsig", "Beror helt på vad jag ätit", "Har inte tänkt på det"]),
    q8_4:  pick(["Nej", "Ja, bara på morgonen", "Ja, hela dagen", "Ja, även på kvällen"]),
    q8_5:  pick(["Aldrig", "Socialt", "Regelbundet", "Dagligen"]),
    q8_6:  pick(["Nej", "Snusar", "Röker", "Ibland"]),
    q8_9:  pick(["Inget speciellt", "LCHF / Keto", "Intermittent fasta", "Veganskt", "Vegetariskt"]),
    q8_10: pick(["Ja, tydlig koppling", "Lite koll", "Nej, det är ett mysterium"]),
    q9_1:  pick(["Ja, ofta", "Ibland"]),
  };
}

// ── PERSONAS ──
const PERSONAS = {

  // Konstant utmattad, jobbar över 60h/vecka, kaotisk tillvaro
  stressed: {
    email:    () => `sim_stressed_${Date.now()}@forsyne.dev`,
    password: "Forsyne_Sim_2025!",
    onboarding: {
      q1_1: "Jag är konstant utmattad men kan inte slappna av",
      q2_1: "Kväll", q2_6: "Jobbar bort den",
      q3_2: 34, q3_3: "Man",
      q4_2: "Över 60h", q4_7: "Kaotiskt",
      // Block 5 — Miljö & dygnsrytm
      q5_1: "Nästan aldrig", q5_2: "30–60 min", q5_3: "Mörkt kontor",
      q5_4: "Varmt", q5_5: "En hel del", q5_6: "Konstant",
      // Block 6 — Sömn & återhämtning
      q6_1: "5–6h", q6_2: "Sällan", q6_3: "Ligger och snurrar länge",
      q6_4: "Ofta", q6_5: "Nej, varierar helt", q6_8: "Nej",
      // Block 7 — Träning & rörelse
      q7_1: "0–1", q7_4: "Utmattad", q7_5: "Sällan",
      q7_6: "Kväll", q7_8: "Stresshantering",
      // Block 8 — Kost & näring
      q8_1: "Oregelbundet", q8_2: "Ofta", q8_3: "Trög och dåsig",
      q8_4: "Ja, hela dagen", q8_5: "Socialt", q8_6: "Nej",
      q8_9: "Inget speciellt", q8_10: "Nej, det är ett mysterium",
      // Block 9 — Hormoner & biologi
      q9_1: "Ja, ofta",
    },
    pattern: "stress_high_sleep_low",
  },

  // Tränar 6+ dagar/vecka, intensitet 9/10, vaknar utmattad
  athlete: {
    email:    () => `sim_athlete_${Date.now()}@forsyne.dev`,
    password: "Forsyne_Sim_2025!",
    onboarding: {
      q1_6: "Högre prestation",
      q7_1: "6+", q7_3: 9,
      q7_4: "Utmattad",
    },
    pattern: "high_training_low_recovery",
  },

  // Kontorsarbete, aldrig tränats, trött hela tiden utan tydlig orsak
  sedentary: {
    email:    () => `sim_sedentary_${Date.now()}@forsyne.dev`,
    password: "Forsyne_Sim_2025!",
    onboarding: {
      q1_1: "Trött hela tiden, vet inte varför",
      q4_1: "Kontorsarbete stillasittande",
      q7_2: ["Tränar inte"],
    },
    pattern: "stable_low",
  },

  // Diabetes typ 1, CGM hela dagen, energi styrs av glukosnivåer
  diabetic: {
    email:    () => `sim_diabetic_${Date.now()}@forsyne.dev`,
    password: "Forsyne_Sim_2025!",
    onboarding: {
      q3_6: "Diabetes typ 1",
      q8_4: "Hela dagen",
    },
    pattern: "variable_glucose",
  },

  // Redan hälsointresserad, mår bra, vill förstå exakt varför
  optimizer: {
    email:    () => `sim_optimizer_${Date.now()}@forsyne.dev`,
    password: "Forsyne_Sim_2025!",
    onboarding: {
      q1_0a: "Det fungerar bra. Jag vill förstå varför.",
      q1_6: "Högre prestation",
    },
    pattern: "generally_good",
  },

  // Slumpmässiga värden — inget förutbestämt mönster
  // Onboarding och check-ins genereras nytt varje körning
  random: {
    email:      () => `sim_random_${Date.now()}@forsyne.dev`,
    password:   "Forsyne_Sim_2025!",
    onboarding: generateRandomOnboarding(),
    pattern:    "random",
  },
};

// ── GRADING ──
// Claude som domare — utvärderar insikten mot persona + de sista 7 check-ins.
// Returnerar { generisk, specifik, prediktion, poang, forklaring }
async function gradeInsikt(insikt, persona, checkins) {
  if (!insikt) return null;
  if (DRY_RUN) {
    console.log(`  [dry-run] gradeInsikt — insikt: ${JSON.stringify(insikt || "").slice(0, 80)}...`);
    return { generisk: false, specifik: true, prediktion: true, poang: 0, forklaring: "DRY-RUN - ingen gradering" };
  }
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const forstaCheckin = checkins[0]?.date || "okant";
  const sistaCheckin  = checkins[checkins.length - 1]?.date || "okant";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
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

Persona: ${JSON.stringify(persona)}
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

// ── ONBOARDING GRADING ──
// Tre frågor per block-insikt. Returnerar { specifik, traffade, generisk, forklaring }
async function gradeBlockInsikt(insikt, blockNum, blockAnswers) {
  if (DRY_RUN) {
    console.log(`  [dry-run] gradeBlockInsikt block ${blockNum}`);
    return { specifik: true, traffade: true, generisk: false, forklaring: "DRY-RUN - ingen gradering" };
  }
  if (!process.env.ANTHROPIC_API_KEY || !insikt) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{
        role:    "user",
        content: `Du granskar en AI-genererad onboarding-insikt för block ${blockNum}.

SVAR FRÅN BLOCKET:
${JSON.stringify(blockAnswers)}

INSIKT:
"${insikt}"

Svara ENBART med JSON:
{
  "specifik": true/false,
  "traffade": true/false,
  "generisk": true/false,
  "forklaring": "max 15 ord"
}

Definitioner:
- specifik: insikten refererar till minst ett konkret svar från blocket (inte bara parafras)
- traffade: observationen matchar ett verkligt mönster i svaren (inte påhittat)
- generisk: insikten skulle kunna gälla vem som helst — om ja är det ett fel`,
      }],
    }),
  });

  const data = await res.json();
  const text = data?.content?.[0]?.text || "";
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch { return null; }
}

// ── ONBOARDING TEST ──
// Kör block-insight för varje block + final, gradsätter, sparar separat log
async function runOnboardingTest(persona, personaKey) {
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
  };

  const answers = persona.onboarding;
  const results = [];

  for (const [blockStr, blockName] of Object.entries(BLOCK_NAMES)) {
    const blockNum = parseInt(blockStr);

    // Filtrera ut svar för just detta block (q[N]_*)
    const blockAnswers = Object.fromEntries(
      Object.entries(answers).filter(([k]) => k.startsWith(`q${blockNum}_`))
    );

    process.stdout.write(`  Block ${blockNum} (${blockName})... `);

    let insikt = null;
    let grade  = null;

    try {
      if (DRY_RUN) {
        const mockRes = mockBlockInsikt(blockNum);
        insikt = mockRes.insight;
        console.log(`[dry-run] ${Object.keys(blockAnswers).length} svar → mock insikt`);
      } else {
        const res = await apiRequest("POST", "/api/block-insight", {
          block:   blockNum,
          answers: blockAnswers,
          profile: answers,
        }, null);
        insikt = res.body?.insight || null;
        if (!insikt) {
          console.log(`ingen insikt (status ${res.status})`);
        }
      }

      if (insikt && !DRY_RUN) {
        grade = await gradeBlockInsikt(insikt, blockNum, blockAnswers);
        const flags = grade
          ? `specifik:${grade.specifik ? "ok" : "fail"} traffade:${grade.traffade ? "ok" : "fail"} generisk:${grade.generisk ? "FAIL" : "ok"}`
          : "gradering misslyckades";
        console.log(flags);
        if (grade?.forklaring) console.log(`    → ${grade.forklaring}`);
      }
    } catch (e) {
      console.log(`fel: ${e.message}`);
    }

    results.push({
      block:     blockNum,
      namn:      blockName,
      svar:      blockAnswers,
      insikt,
      gradering: grade,
    });
  }

  // Final — välkomstinsikt baserad på hela onboardingen
  process.stdout.write("  Final (välkomstinsikt)... ");
  let finalInsikt = null;
  let finalGrade  = null;
  try {
    if (DRY_RUN) {
      finalInsikt = "[DRY-RUN] Mock välkomstinsikt";
      console.log(`[dry-run] ${Object.keys(answers).length} svar → mock insikt`);
    } else {
      const res = await apiRequest("POST", "/api/block-insight", {
        block:   "final",
        answers,
        profile: answers,
      }, null);
      finalInsikt = res.body?.insight || null;
      if (!finalInsikt) {
        console.log(`ingen insikt (status ${res.status})`);
      } else {
        finalGrade = await gradeBlockInsikt(finalInsikt, "final", answers);
        const flags = finalGrade
          ? `specifik:${finalGrade.specifik ? "ok" : "fail"} traffade:${finalGrade.traffade ? "ok" : "fail"} generisk:${finalGrade.generisk ? "FAIL" : "ok"}`
          : "gradering misslyckades";
        console.log(flags);
        if (finalGrade?.forklaring) console.log(`    → ${finalGrade.forklaring}`);
      }
    }
  } catch (e) {
    console.log(`fel: ${e.message}`);
  }

  // Spara separat log
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const ts      = new Date().toISOString().replace(/:/g, "-").replace("T", "_").slice(0, 19);
  const logPath = path.join(LOG_DIR, `${personaKey}_onboarding_${ts}.json`);
  const logData = {
    persona:   personaKey,
    timestamp: new Date().toISOString(),
    block_results: results,
    final: {
      insikt:    finalInsikt,
      gradering: finalGrade,
    },
    sammanfattning: {
      totalt:           results.length,
      specifika:        results.filter(r => r.gradering?.specifik).length,
      traffade:         results.filter(r => r.gradering?.traffade).length,
      generiska_fel:    results.filter(r => r.gradering?.generisk).length,
      inga_insikter:    results.filter(r => !r.insikt).length,
    },
  };
  fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), "utf8");
  console.log(`\n  Sammanfattning: ${logData.sammanfattning.specifika}/${results.length} specifika, ${logData.sammanfattning.generiska_fel} generiska fel`);
  console.log(`  Onboarding-log: ${logPath}`);

  return logData;
}

// ── DRY-RUN MOCK HELPERS ──
function mockBlockInsikt(blockNum) {
  return { insight: `[DRY-RUN] Mock insikt block ${blockNum}` };
}
function mockAgentInsikt(dag) {
  return { insikt: `[DRY-RUN] Mock insikt dag ${dag}` };
}
function mockMetaRun() {
  return {
    systeminsikt: { rubrik: "DRY-RUN", insikt: "[DRY-RUN] Ingen insikt genererades", prioritet: "Normal", grundat_i: [], prediktion: null, rekommendation: null },
    agent_koordinering: null,
    modell_uppdatering: null,
  };
}

// ── SIGNAL DETECTION ──
// Samma logik som servern: stress >= 7 AND sleep <= 5 i två dagar i rad
function detectSignal(pattern) {
  for (let i = 1; i < pattern.length; i++) {
    const prev = pattern[i - 1];
    const curr = pattern[i];
    if (prev.stress >= 7 && prev.sleep <= 5 && curr.stress >= 7 && curr.sleep <= 5) {
      return i + 1; // dag 1-indexerat
    }
  }
  return null;
}

// ── NOTERING — vad systemet missade ──
async function generateNotering(dag30insikt, pattern, personaKey) {
  if (DRY_RUN) {
    console.log("  [dry-run] generateNotering — hoppas över");
    return "[DRY-RUN] Ingen notering genererades";
  }
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const signalDag     = detectSignal(pattern);
  const kritiskaDagar = pattern
    .map((d, i) => ({ dag: i + 1, ...d }))
    .filter(d => d.stress >= 8 || d.sleep < 5 || d.energy <= 2);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: 200,
      messages: [{
        role:    "user",
        content: `Du analyserar om ett AI-system fångade rätt mönster i en persons 30-dagars data.

PERSONA: ${personaKey}
KRITISKA DAGAR (stress ≥ 8, sömn < 5h, eller energi ≤ 2):
${JSON.stringify(kritiskaDagar)}

SIGNAL TRIGGAR: ${signalDag ? `Dag ${signalDag}` : "Ingen signal triggar i detta mönster"}

SYSTEMETS DAG-30 INSIKT:
${typeof dag30insikt === "object" ? JSON.stringify(dag30insikt) : (dag30insikt || "Ingen insikt genererades")}

Skriv EN konkret mening om vad systemet antingen missade eller träffade rätt på.
Var specifik: namnge dagar, värden, samband. Ingen inledning, ingen avslutning. Bara meningen.`,
      }],
    }),
  });

  const data = await res.json();
  return data?.content?.[0]?.text?.trim() || null;
}

// ── MAIN ──
async function run() {
  const persona = PERSONAS[personaArg];
  if (!persona) {
    console.error(`Okänd persona: "${personaArg}"`);
    console.error(`Tillgängliga: ${Object.keys(PERSONAS).join(", ")}`);
    process.exit(1);
  }

  const patternSrc = PATTERNS[persona.pattern] ?? (persona.pattern === "random" ? generateRandomPattern : null);
  if (!patternSrc) {
    console.error(`Okänt mönster: "${persona.pattern}"`);
    process.exit(1);
  }
  const pattern = typeof patternSrc === "function" ? patternSrc() : patternSrc;

  const today     = new Date().toISOString().split("T")[0];
  const email     = persona.email();
  const password  = persona.password;
  const signalDag = detectSignal(pattern);

  // Loggobjekt — exakt det format som ska analyseras
  const log = {
    persona:           personaArg,
    timestamp:         new Date().toISOString(),
    email:             null,
    user_id:           null,
    onboarding_insikt: null,
    dag_7_insikt:      null,
    dag_14_insikt:     null,
    dag_30_insikt:     null,
    signal_aktiverad:  signalDag !== null,
    signal_dag:        signalDag,
    gradering: {
      generisk:   null,
      specifik:   null,
      prediktion: null,
      traffade:   null,
    },
    notering: null,
    errors:   [],
  };

  console.log(`\nForsyne Simulator — persona: ${personaArg}`);
  if (DRY_RUN) console.log("Läge: DRY-RUN  (Supabase körs, Claude hoppas över — använd --live för riktiga anrop)");
  console.log(`Signal triggar: ${signalDag ? `dag ${signalDag}` : "nej"}\n`);

  // 1. Registrera
  console.log("1. Registrerar testanvändare...");
  const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr) {
    log.errors.push({ step: "register", error: createErr.message });
    saveLog(log, today); process.exit(1);
  }
  log.email   = email;
  log.user_id = createData.user.id;
  const userId = createData.user.id;
  console.log(`  user_id: ${userId}`);

  // 2. Logga in
  console.log("\n2. Loggar in...");
  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    log.errors.push({ step: "login", error: signInErr.message });
    saveLog(log, today); process.exit(1);
  }
  const token = signIn.session.access_token;

  // 3. Onboarding-profil
  console.log("\n3. Skickar onboarding-profil...");
  let profRes;
  try {
    profRes = await apiRequest("POST", "/api/profile", { data: persona.onboarding }, token);
    if (profRes.status !== 200) {
      const errDetail = {
        step:   "profile",
        status: profRes.status,
        body:   profRes.body,
      };
      console.error(`  FEL status=${profRes.status}`);
      console.error(`  body=${JSON.stringify(profRes.body, null, 2)}`);
      log.errors.push(errDetail);
      saveLog(log, today); process.exit(1);
    }
  } catch (e) {
    const errDetail = {
      step:    "profile",
      status:  null,
      body:    null,
      message: e.message,
    };
    console.error(`  FEL (nätverk/timeout): ${e.message}`);
    log.errors.push(errDetail);
    saveLog(log, today); process.exit(1);
  }

  // 3b. Onboarding-test — block-insight per block + final
  console.log("\n3b. Kör onboarding-test (block 1–9 + final)...");
  await runOnboardingTest(persona, personaArg);

  // 4. Bygg alla 30 check-ins (kronologiskt)
  const checkins = [];
  for (let i = 29; i >= 0; i--) {
    const day = 30 - i;
    checkins.push({
      user_id:         userId,
      date:            dateOffset(i),
      energy:          pattern[day - 1].energy,
      focus:           pattern[day - 1].focus,
      stress:          pattern[day - 1].stress,
      sleep:           pattern[day - 1].sleep,
      motivation:      pattern[day - 1].motivation,
      moods:           pattern[day - 1].moods || [],
      reflection:      pattern[day - 1].reflection || null,
      personal_answer: null,
      analysis:        null,
    });
  }

  console.log("\n4. Infogar 30 check-ins i Supabase...");
  const { error: checkinErr } = await supabase
    .from("checkins")
    .upsert(checkins, { onConflict: "user_id,date" });
  if (checkinErr) {
    log.errors.push({ step: "checkins", error: checkinErr.message });
    saveLog(log, today); process.exit(1);
  }
  console.log(`  ${checkins[0].date} → ${checkins[checkins.length - 1].date}`);

  // 5. Milestone-insikter via insights-agenten
  // Skickas med subset av checkins direkt i body — agenten ser bara dessa dagar
  console.log("\n5. Genererar milestone-insikter...");

  const profile = persona.onboarding;

  process.stdout.write("  Dag 7... ");
  if (DRY_RUN) {
    log.dag_7_insikt = mockAgentInsikt(7).insikt;
    console.log("[dry-run]");
  } else {
    const r7 = await apiRequest("POST", "/api/agent/insights/generate",
      { checkins: checkins.slice(0, 7),  profile }, token);
    log.dag_7_insikt = r7.body?.insikt || r7.body?.insight || r7.body || null;
    console.log(r7.status === 200 ? "ok" : `fel ${r7.status}`);
  }

  process.stdout.write("  Dag 14... ");
  if (DRY_RUN) {
    log.dag_14_insikt = mockAgentInsikt(14).insikt;
    console.log("[dry-run]");
  } else {
    const r14 = await apiRequest("POST", "/api/agent/insights/generate",
      { checkins: checkins.slice(0, 14), profile }, token);
    log.dag_14_insikt = r14.body?.insikt || r14.body?.insight || r14.body || null;
    console.log(r14.status === 200 ? "ok" : `fel ${r14.status}`);
  }

  // 6. Meta-agenten — dag 30 (full analys)
  console.log("\n6. Kör meta-agenten (dag 30)...");
  if (DRY_RUN) {
    const mock = mockMetaRun();
    log.dag_30_insikt = mock.systeminsikt;
    console.log("  [dry-run] meta-agent mockad");
  } else {
    const metaRes = await apiRequest("POST", "/api/agent/meta/run", {}, token);
    if (metaRes.status !== 200) {
      log.errors.push({ step: "meta", error: JSON.stringify(metaRes.body) });
    } else {
      const metaBody = metaRes.body;
      log.dag_30_insikt = metaBody?.systeminsikt || metaBody?.insights?.[0] || metaBody?.insikt || metaBody || null;
      log.onboarding_insikt = metaBody?.onboarding_insikt || metaBody?.profil_analys || null;
    }
  }

  // 7. Gradering av dag-30-insikten — Claude som domare
  // Paus for att undvika rate limit efter meta-agentens tunga anrop
  if (!DRY_RUN) await new Promise(r => setTimeout(r, 15000));
  console.log("\n7. Granskar dag-30-insikten...");
  if (!log.dag_30_insikt) {
    console.log("  skip (meta-agent misslyckades — ingen insikt att gradera)");
  }
  const grade = log.dag_30_insikt ? await gradeInsikt(log.dag_30_insikt, persona.onboarding, checkins) : null;
  if (grade) {
    log.gradering = {
      generisk:   grade.generisk   ?? null,
      specifik:   grade.specifik   ?? null,
      prediktion: grade.prediktion ?? null,
      traffade:   grade.generisk === false && grade.specifik === true && grade.prediktion === true,
    };
    log.gradering.poang    = grade.poang    ?? null;
    log.gradering.forklaring = grade.forklaring ?? null;

    const { generisk, specifik, prediktion, traffade, poang, forklaring } = log.gradering;
    console.log(`  generisk:${generisk ? "ok" : "fail"}  specifik:${specifik ? "ok" : "fail"}  prediktion:${prediktion ? "ok" : "fail"}  poang:${poang}/10`);
    console.log(`  traffade:${traffade ? "JA" : "NEJ"}  — ${forklaring}`);
  } else {
    console.log("  skip (API-fel)");
  }

  // 8. Notering — vad systemet missade eller träffade
  console.log("\n8. Genererar notering...");
  log.notering = await generateNotering(log.dag_30_insikt, pattern, personaArg);
  if (log.notering) console.log(`  "${log.notering}"`);

  // 9. Jämför mot föregående körning
  const prev = loadPreviousRun(personaArg);
  if (prev) {
    console.log("\n9. Delta mot föregående körning:");
    compareRuns(log, prev);
  }

  // 10. Spara log + uppdatera history
  const runId = saveLog(log);
  appendHistory(log, runId);
  if (log.errors.length > 0)
    console.warn(`\nVarning: ${log.errors.length} fel — se logfilen.`);
}

// ── PERSISTENCE ──

function saveLog(log) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  // Timestamp i filnamn — undviker överskrivning vid flera körningar samma dag
  const ts      = log.timestamp.replace(/:/g, "-").replace("T", "_").slice(0, 19);
  const logPath = path.join(LOG_DIR, `${log.persona}_${ts}.json`);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
  console.log(`\nLog: ${logPath}`);
  return path.basename(logPath);
}

// Kompakt historik — ett entry per körning, läsbar som trendlinje
function appendHistory(log, runId) {
  const histPath = path.join(LOG_DIR, `${log.persona}_history.json`);
  const history  = fs.existsSync(histPath)
    ? JSON.parse(fs.readFileSync(histPath, "utf8"))
    : [];

  history.push({
    run:              runId,
    timestamp:        log.timestamp,
    poang:            log.gradering.poang     ?? null,
    generisk:         log.gradering.generisk  ?? null,
    specifik:         log.gradering.specifik  ?? null,
    prediktion:       log.gradering.prediktion ?? null,
    traffade:         log.gradering.traffade  ?? null,
    forklaring:       log.gradering.forklaring ?? null,
    signal_aktiverad: log.signal_aktiverad,
    signal_dag:       log.signal_dag,
    notering:         log.notering,
    errors:           log.errors.length,
  });

  fs.writeFileSync(histPath, JSON.stringify(history, null, 2), "utf8");
}

// Ladda senaste körning för en persona (för delta-jämförelse)
function loadPreviousRun(personaKey) {
  if (!fs.existsSync(LOG_DIR)) return null;
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith(`${personaKey}_`) && f.endsWith(".json") && !f.includes("history"))
    .sort();                         // kronologisk ordning via timestamp i filnamnet
  if (files.length < 2) return null; // behöver minst en tidigare körning
  try {
    return JSON.parse(fs.readFileSync(path.join(LOG_DIR, files[files.length - 2]), "utf8"));
  } catch { return null; }
}

function scoreOf(g) {
  if (!g) return 0;
  // poang 1-10 normaliserat till 0-3 för delta-jämförelse
  return g.poang != null ? g.poang : [g.generisk, g.specifik, g.prediktion].filter(Boolean).length;
}

// ── DELTA-JÄMFÖRELSE ──
function compareRuns(current, previous) {
  const prevPoang = previous.gradering?.poang ?? null;
  const currPoang = current.gradering?.poang  ?? null;

  // Binära fält — visa regression om något gick från ok till fail
  const binary = ["generisk", "specifik", "prediktion", "traffade"];
  let regressions = 0;

  for (const f of binary) {
    const was = previous.gradering?.[f];
    const now = current.gradering?.[f];
    if (was === null || now === null) continue;

    if (was === true && now === false) {
      console.log(`  REGRESSION  ${f}: ok → fail`);
      regressions++;
    } else if (was === false && now === true) {
      console.log(`  FÖRBÄTTRING ${f}: fail → ok`);
    } else {
      console.log(`  oförändrat  ${f}: ${now ? "ok" : "fail"}`);
    }
  }

  // Poäng-delta — primärt mått
  if (prevPoang !== null && currPoang !== null) {
    const delta = currPoang - prevPoang;
    const sign  = delta > 0 ? "+" : "";
    console.log(`\n  Poäng: ${prevPoang}/10 → ${currPoang}/10  (${sign}${delta})`);
    if (delta < 0) {
      console.warn(`  REGRESSION: poäng sjönk — rulla tillbaka eller undersök prompten`);
      regressions++;
    }
  }

  // Förklaring från domarmodellen
  const fk = current.gradering?.forklaring;
  if (fk) console.log(`  Domarens motivering: "${fk}"`);

  if (regressions > 0) {
    console.warn(`\n  ${regressions} regression(er) — föregående körning: ${previous.timestamp}`);
  }
}

run().catch(e => {
  console.error("\nFatal:", e.message);
  process.exit(1);
});
