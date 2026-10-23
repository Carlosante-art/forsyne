Jag bygger Selvitas — ett AI-drivet performance intelligence system. 
Jag har en befintlig webb-app på Railway med komplett backend.

═══════════════════════════════════
BAKGRUND
═══════════════════════════════════

Webb-app: forsyne-production.up.railway.app
Backend: Express v5 + Supabase + JWT + Railway
Agenter: 10 specialiserade AI-agenter + 1 meta-agent (finns i /agents/)
Design-referens: selvitas-1210.html, selvitas-kost.html, selvitas-traning.html

═══════════════════════════════════
SYSTEM-ARKITEKTUR — TRE LEVELS
═══════════════════════════════════

LEVEL 1 — Chatt-only (default för nya användare)
- Inga wearables krävs
- Användaren loggar via naturlig chatt: "sov 6h, åt havre, stressig dag"
- Agent 2 (check-in) ställer 3 frågor baserade på vad användaren skrivit
- Agent 3 genererar en daglig insikt
- Hemskärmen: en stor kursiv insikt-text + "Prata med Selvitas" CTA
- Chatten är produkten — inget annat visas

LEVEL 2 — Wearables (upplåses när wearable kopplas)
- Garmin / Oura / Apple Health via befintliga API-endpoints
- Systemet hämtar HRV, sömn, stress automatiskt varje morgon kl 06:00
- Check-in kortas ner — systemet vet redan biologin, frågar bara subjektivt
- Agent 4 (prediktion) aktiveras efter 14+ check-ins
- Hemskärmen: cycling insights + recovery/sleep/strain rings + rådata

LEVEL 3 — Full modell (upplåses när Dexcom eller DNA läggs till)
- Dexcom CGM realtids-glukos + DNA-profil + blodprover + kalender
- Meta-agenten körs kl 07:00 och initierar chatten automatiskt
- Systemet pratar FÖRST — inte användaren
- Prediktion 24–48h i förväg baserat på alla 9 agenter
- Hemskärmen: "Din kropp är inte redo idag" — ett statement, inte en dashboard

LEVEL-DETEKTERING (automatisk):
- Ingen wearable kopplad → Level 1
- Wearable kopplad → Level 2
- Dexcom ELLER DNA uppladdad → Level 3

Samma app. Samma design. Djupet ökar progressivt.

═══════════════════════════════════
DESIGN-SPEC (icke-förhandlingsbar)
═══════════════════════════════════

Bakgrundsfärg: #04060a
Bakgrundsbild: ögat (lokal fil, baka in som base64)
Gradient över ögat: tung top/bottom, öppen i mitten

Typsnafi:
- Rubriker/insikter: Instrument Serif, italic
- Data/labels: Syne Mono  
- UI-text: Syne

Färgpalett (extraherad från ögat):
- Primär accent: #67aac8 (iris-teal)
- Sekundär: #8fa8c4 (djupare blå)
- Amber/strain: #be7a5b
- Text: #dde8ec
- Bakgrund kort: rgba(5,7,10,.5) glassmorphism

Hemskärmen Level 3:
- Wordmark "Selvitas" uppe vänster, liten och diskret
- Live-pip (pulserar) + "Live" uppe höger
- Cycling insights — byter var 4:e sekund med fade-transition
- Dots-indicator (aktiv dot = bred pill)
- Why-line under insikten (Syne Mono, liten, muted)
- CTA: "Fråga Selvitas" med pil
- Prediction block med vänsterkant i iris-färg
- Raw numbers längst ner: 4 celler, nästan osynliga

Kost-skärmen:
- Meta-agent context högst upp (vänsterkant + glassmorphism)
- Makro-ringar (protein/kolhydrater/fett) med SVG stroke-animation
- Dexcom live-indicator under varje måltid
- Snabblogg via input + chip-shortcuts
- Veckohistorik som bar-chart
- Semestermål/kalender-event synkat

Tränings-skärmen:
- HRV-baserat beslut högst upp (grön/gul/röd beroende på status)
- Auto-justerat pass med förklaring
- Veckoschema (7 dagar, idag markerad)
- Kost-sync badge (automatisk justering visas)
- Historik med HRV dagen efter varje pass

Chat-skärmen:
- Ögat som avatar (base64 inbakat)
- Systemet initierar ALLTID — aldrig tom skärm
- Typing indicator (tre pulsande dots)
- Conversation starters som pills
- Chatten bygger modellen — svar refererar till DNA, Dexcom, mönster

Design-princip: Stripe-filosofi.
Visa bara essensen. Siffrorna är sekundära.
Det viktigaste är vad systemet vet om dig — inte att du åt 2387 kcal.

═══════════════════════════════════
API-ENDPOINTS (Railway-backend)
═══════════════════════════════════

Auth:
POST /api/auth/login     { email, password }
POST /api/auth/register  { email, password }
GET  /api/auth/me        → user + level

Check-ins:
GET  /api/checkins           → array senaste 30 dagar
POST /api/checkins           { energy, sleep, stress, focus, motivation, reflection }

Agenter:
POST /api/agent/checkin/generate     → Agent 2, genererar morgonfrågor
POST /api/agent/insights/generate    → Agent 3, daglig insikt
POST /api/agent/prediction/run       → Agent 4, varsel + prediktion
POST /api/agent/meta/analyze         → Meta-agent, full systemanalys
POST /api/agent/nutrition/analyze    → Agent 8, kostanalys
POST /api/agent/balance/run          → Agent 9, balansinsikt

Selvitas:
GET  /api/selvitas/index    → SI-score + level + modell-status
GET  /api/selvitas/profile  → biologisk identitet

Wearables:
POST /api/wearables/garmin/import   → FIT-fil
GET  /api/wearables/status          → anslutna källor

Kost:
POST /api/nutrition/log     { text: "havre, ägg, kaffe" } → AI parsar
GET  /api/nutrition/today   → dagens makros + Dexcom-spikes

Träning:
GET  /api/training/today    → HRV-baserat pass + justering
GET  /api/training/week     → veckostatus + historik

═══════════════════════════════════
PWA-KRAV
═══════════════════════════════════

manifest.json:
- name: "Selvitas"
- short_name: "Selvitas"  
- theme_color: #04060a
- background_color: #04060a
- display: standalone
- icons: generera från ögat-bilden

Service Worker:
- Cache hemskärmen offline
- Background sync för check-ins (sparas lokalt om offline, synkas när online)
- Push notifications: daglig påminnelse kl 07:30 om check-in inte gjorts

App Shell:
- Laddas under 1 sekund
- Splash screen: ögat + "Selvitas" wordmark
- Ingen vit blixt vid start

═══════════════════════════════════
NAVIGATION
═══════════════════════════════════

Bottom nav med 5 knappar:
1. Hem (default)
2. Data (raw metrics, döljs på Level 1)
3. FAB — ögat i mitten, förhöjt, öppnar chat
4. Kost (döljs på Level 1)
5. Selvitas (biologisk identitet + SI-score)

Level 1 navigation:
- Bara Hem + FAB (chat) + Selvitas
- Data och Kost döljs tills Level 2

═══════════════════════════════════
ONBOARDING-FLÖDE
═══════════════════════════════════

Skärm 1 — Välkomst:
Ögat. Stor kursiv text: "Systemet lär sig hur du fungerar."
Knapp: "Börja"

Skärm 2 — Level-val:
"Hur vill du börja?"
[ Bara chatt ] — Level 1, inga krav
[ Koppla wearable ] — Level 2, välj Garmin/Oura/Apple
[ Full setup ] — Level 3, + Dexcom/DNA

Skärm 3 — 5 kärnfrågor (förenklad onboarding för mobil):
Namn, vad vill du förstå, wakeup-tid, sömnmål, största energitjuv.
(Fullständig 78-frågor onboarding finns på webben — appen gör mini-version)

Skärm 4 — Koppla källor (Level 2+):
Garmin Connect, Apple Health, Oura
Skip-möjlighet → Level 1

Skärm 5 — Klar:
"Selvitas börjar lyssna."
Ögat animeras. Fade in till hemskärmen.

═══════════════════════════════════
BYGGORDNING
═══════════════════════════════════

1. App-skal (navigation, routing, auth)
2. Hemskärm Level 1 (chatt-only, fungerar standalone)
3. Chatskärm kopplad mot Agent 2 + 3 via API
4. Hemskärm Level 2 (rings + cycling insights + API-data)
5. Hemskärm Level 3 (meta-agent initierar, full modell)
6. Kostskärm
7. Träningsskärm
8. Selvitas-profil (biologisk identitet)
9. Onboarding-flöde
10. PWA (manifest, service worker, notifications)

Börja med punkt 1 och 2. Bygg Level 1 perfekt först.
Level 2 och 3 är lager ovanpå — inte separata byggen.

═══════════════════════════════════
REFERENSFILER (läs dessa först)
═══════════════════════════════════

selvitas-1210.html   — hemskärm design + cycling insights
selvitas-kost.html   — kostskärm komplett
selvitas-traning.html — träningsskärm komplett
agents/              — alla agent-prompts

Matcha designen exakt. Färger, typsnitt, spacing — allt ska stämma.