#!/usr/bin/env node
// scripts/tune.js
// Läser summary.json + meta_agent.md, föreslår och applicerar prompt-förbättringar.
//
// Användning:
//   node scripts/tune.js              # förhandsvisning — inga ändringar
//   node scripts/tune.js --apply      # applicerar ändringar på meta_agent.md
//   node scripts/tune.js --rollback   # återställer senaste backup

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs   = require("fs");
const path = require("path");

const args     = process.argv.slice(2);
const APPLY    = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");

const ROOT        = path.join(__dirname, "..");
const LOG_DIR     = path.join(ROOT, "logs");
const PROMPT_PATH = path.join(ROOT, "prompts", "meta_agent.md");
const BACKUP_DIR  = path.join(LOG_DIR, "prompt_backups");

// ── ROLLBACK ────────────────────────────────────────────────────────────────

if (ROLLBACK) {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.error("Inga backuper hittades.");
    process.exit(1);
  }
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("meta_agent_") && f.endsWith(".md"))
    .sort()
    .reverse();
  if (!backups.length) {
    console.error("Inga backuper hittades.");
    process.exit(1);
  }
  const latest = path.join(BACKUP_DIR, backups[0]);
  fs.copyFileSync(latest, PROMPT_PATH);
  console.log(`Aterstaллd: ${backups[0]}`);
  process.exit(0);
}

// ── LÄSA DATA ────────────────────────────────────────────────────────────────

const summaryPath = path.join(LOG_DIR, "summary.json");
if (!fs.existsSync(summaryPath)) {
  console.error("logs/summary.json hittades inte — kör run_all.ps1 -Live forst.");
  process.exit(1);
}
if (!fs.existsSync(PROMPT_PATH)) {
  console.error("prompts/meta_agent.md hittades inte.");
  process.exit(1);
}

const summary  = JSON.parse(fs.readFileSync(summaryPath, "utf8").replace(/^\uFEFF/, ""));
const prompt   = fs.readFileSync(PROMPT_PATH, "utf8");

// ── BYGG FELANALYS ───────────────────────────────────────────────────────────

const personas = summary.personas || [];
const failande = personas.filter(p => (p.poang ?? 0) < 7);
const okanda   = personas.filter(p => (p.poang ?? 0) >= 7);

const felanalys = personas.map(p => {
  const flags = [];
  if (p.generisk  === true)  flags.push("generisk");
  if (p.specifik  === false) flags.push("inte_specifik");
  if (p.prediktion=== false) flags.push("ingen_prediktion");
  return {
    persona:    p.persona,
    poang:      p.poang,
    flags,
    forklaring: p.forklaring,
    notering:   p.notering,
  };
}).filter(p => p.flags.length > 0 || (p.poang ?? 10) < 7);

const noteringar = (summary.noteringar || []).filter(Boolean);
const monster    = (summary.monster    || []).filter(m => m.forekomster >= 2);

// ── CLAUDE-ANROP ─────────────────────────────────────────────────────────────

async function analyzeAndSuggest() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY saknas.");
    process.exit(1);
  }

  const felText = felanalys.length
    ? felanalys.map(p =>
        `  ${p.persona} (${p.poang}/10): ${p.flags.join(", ")}\n  Forklaring: ${p.forklaring || "-"}\n  Notering: ${p.notering || "-"}`
      ).join("\n\n")
    : "  Inga kritiska fel.";

  const monsterText = monster.length
    ? monster.map(m => `  "${m.monster}" x${m.forekomster}: ${m.exempel}`).join("\n")
    : "  Inga upprepade monster.";

  const noteringsText = noteringar.length
    ? noteringar.map((n, i) => `  ${i + 1}. ${n}`).join("\n")
    : "  Inga noteringar.";

  const userMsg = `Du är en expert på prompt-engineering for AI-system.

NUVARANDE PROMPT (meta_agent.md):
${prompt}

TESTRESULTAT FRAN SENASTE RUN:
Personas som failade (poang < 7):
${felText}

Gemensamma monster i noteringar:
${monsterText}

Alla noteringar:
${noteringsText}

Din uppgift:
Identifiera MAX 3 konkreta forandringar i prompten som skulle fixa de upprepade felen.

Regler:
- Varje andring ska vara direkt motiverad av ett specifikt fel i testresultaten
- Andringarna ska vara minimala — kirurgiska, inte omskrivningar
- Om ett fel beror pa data-format (inte prompt), notera det istallet for att forandra prompten
- Forandra ALDRIG grundlaggande struktur eller JSON-schema

Svara ENBART med JSON:
{
  "analys": "string — vad som ar rotproblemet i max 2 meningar",
  "andringar": [
    {
      "sektion": "string — vilket block i prompten",
      "typ": "ersatt | tillagg | borttagning",
      "gammal_text": "exakt text som ska ersattas (null om tillagg)",
      "ny_text": "ny text som ska in (null om borttagning)",
      "anledning": "string — vilket testfel detta fixar",
      "paverkar_persona": ["lista med persona-namn som bor forbattras"]
    }
  ],
  "data_problem": "string — fel som INTE kan fixas via prompt, null om inga",
  "forvantat_resultat": "string — vilka metriker bor oka nasta run"
}`;

  console.log("Skickar till Claude...\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-6",
      max_tokens: 2000,
      messages:   [{ role: "user", content: userMsg }],
    }),
  });

  const data = await res.json();
  if (data?.error) {
    console.error("Claude API-fel:", data.error.message);
    process.exit(1);
  }

  const text  = data?.content?.[0]?.text || "";
  const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/);
  try {
    return JSON.parse(match ? match[1] : text);
  } catch {
    console.error("Kunde inte parsa svar fran Claude:\n", text);
    process.exit(1);
  }
}

// ── APPLICERA ANDRINGAR ──────────────────────────────────────────────────────

function applyChanges(currentPrompt, andringar) {
  let updated = currentPrompt;
  const applied = [];
  const skipped = [];

  for (const a of andringar) {
    if (a.typ === "ersatt" && a.gammal_text && a.ny_text) {
      if (updated.includes(a.gammal_text)) {
        updated = updated.replace(a.gammal_text, a.ny_text);
        applied.push(a);
      } else {
        skipped.push({ ...a, orsak: "gammal_text hittades inte i prompten" });
      }
    } else if (a.typ === "tillagg" && a.ny_text) {
      updated = updated + "\n\n" + a.ny_text;
      applied.push(a);
    } else if (a.typ === "borttagning" && a.gammal_text) {
      if (updated.includes(a.gammal_text)) {
        updated = updated.replace(a.gammal_text, "");
        applied.push(a);
      } else {
        skipped.push({ ...a, orsak: "text hittades inte" });
      }
    }
  }

  return { updated, applied, skipped };
}

// ── BACKUP ───────────────────────────────────────────────────────────────────

function saveBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts     = new Date().toISOString().replace(/:/g, "-").replace("T", "_").slice(0, 19);
  const backup = path.join(BACKUP_DIR, `meta_agent_${ts}.md`);
  fs.copyFileSync(PROMPT_PATH, backup);
  return backup;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  const mode = APPLY ? "APPLY" : "PREVIEW";
  console.log(`\nForsyne — Prompt Tuner (${mode})`);
  console.log(`Summary: ${summaryPath}`);
  console.log(`Prompt:  ${PROMPT_PATH}\n`);

  console.log(`Personas: ${personas.length} totalt, ${failande.length} under 7/10`);
  if (failande.length) {
    failande.forEach(p => console.log(`  ${p.persona}: ${p.poang}/10 — ${p.forklaring || "-"}`));
  }
  console.log();

  const result = await analyzeAndSuggest();

  // Visa analys
  console.log("Analys:");
  console.log(`  ${result.analys}\n`);

  if (result.data_problem) {
    console.log("Data-problem (kan inte fixas via prompt):");
    console.log(`  ${result.data_problem}\n`);
  }

  console.log(`Foreslagn andringar: ${result.andringar?.length ?? 0}`);
  (result.andringar || []).forEach((a, i) => {
    console.log(`\n  ${i + 1}. [${a.typ.toUpperCase()}] ${a.sektion}`);
    console.log(`     Anledning: ${a.anledning}`);
    console.log(`     Paverkar:  ${(a.paverkar_persona || []).join(", ")}`);
    if (a.gammal_text) console.log(`     Gammal:    "${a.gammal_text.slice(0, 80)}..."`);
    if (a.ny_text)     console.log(`     Ny:        "${a.ny_text.slice(0, 80)}..."`);
  });

  console.log(`\nForvantat resultat: ${result.forvantat_resultat}`);

  // Applicera om --apply
  if (APPLY && result.andringar?.length) {
    const { updated, applied, skipped } = applyChanges(prompt, result.andringar);

    const backup = saveBackup();
    console.log(`\nBackup sparad: ${path.relative(ROOT, backup)}`);

    fs.writeFileSync(PROMPT_PATH, updated, "utf8");
    console.log(`Prompt uppdaterad: prompts/meta_agent.md`);
    console.log(`  Applicerade: ${applied.length}`);
    if (skipped.length) {
      console.log(`  Hoppade over: ${skipped.length}`);
      skipped.forEach(s => console.log(`    - ${s.sektion}: ${s.orsak}`));
    }

    // Spara tuning-log
    const ts      = new Date().toISOString().replace(/:/g, "-").replace("T", "_").slice(0, 19);
    const logPath = path.join(LOG_DIR, `tune_${ts}.json`);
    fs.writeFileSync(logPath, JSON.stringify({
      timestamp:          new Date().toISOString(),
      summary_used:       summaryPath,
      backup:             backup,
      analys:             result.analys,
      data_problem:       result.data_problem,
      andringar_foreslagen: result.andringar?.length ?? 0,
      andringar_applicerade: applied.length,
      andringar_hoppade:  skipped.length,
      detaljer:           { applied, skipped },
      forvantat_resultat: result.forvantat_resultat,
      personas_innan:     personas.map(p => ({ persona: p.persona, poang: p.poang })),
    }, null, 2), "utf8");
    console.log(`Tune-log: ${path.relative(ROOT, logPath)}`);
  } else if (!APPLY) {
    console.log("\nForhandsvisning klar. Kör med --apply for att applicera andringarna.");
  }
}

run().catch(e => {
  console.error("\nFatal:", e.message);
  process.exit(1);
});
