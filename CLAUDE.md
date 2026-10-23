# Forsyne — CLAUDE.md

## Vad projektet är
Personligt intelligenssystem. Bygger en levande 
modell av en individ baserat på daglig data, 
biologi och beteende. Backend på localhost:3000.

## Filstruktur
server.js          — backend, 2013 rader, alla routes
auth.js            — Supabase JWT, token refresh
transitions.js     — fade, toast, skeleton
components.js      — delade UI-funktioner
agents/            — systemprompts per agent
prompts/           — meta_agent.md
images/            — webp och png assets

## Backend endpoints
GET  /api/me
GET  /api/profile
POST /api/profile
GET  /api/checkins
POST /api/checkin/questions
POST /api/checkin/submit
POST /api/block-insight
POST /api/agent/checkin/generate
POST /api/agent/insights/generate
POST /api/agent/validate
POST /api/agent/prediction/generate
POST /api/agent/balance/generate
POST /api/agent/meta/run
POST /api/analyze
POST /api/journal/analyze    — Agent 10, medicinsk historia
POST /api/blood/upload       — Agent 6, blodprover
POST /api/dna/upload         — Agent 7, DNA
POST /api/nutrition/upload   — Agent 8, nutrition
POST /api/garmin/import      — Garmin manuell JSON-import
GET  /api/integrations       — hämta alla integrationer
GET  /api/garmin/api-available
GET  /auth/strava            — Strava OAuth2
GET  /auth/dexcom            — Dexcom OAuth2

## Tech stack
Vanilla JS, Node.js/Express, Supabase,
Claude API (claude-sonnet-4-6), Strava API, Dexcom API

## Rör aldrig
- checkAuth() och API-wrappern i auth.js
- calcPSI() logiken
- Agent-prompterna i agents/ utan godkännande
- Supabase-krypteringen
- Befintliga API-anrop på varje sida

## Design-regler
- Färger: #0F1210, #F2F0EA, #8FAE8A, 
  #C4875A, #A85C5C
- Typsnitt: Cormorant Garamond + Jost
- Ingen border-radius, inga emojis, inga ikoner
- Serif för allt systemet säger
- Sans för metadata och labels
- Tomma states: alltid en mening, aldrig "–"
- Laddning: dotPulse + text, aldrig spinner
- Animationer: ease, aldrig linear

## Byggprincip
En leverans per prompt.
Bevara alltid befintlig logik.
Visa första 50 raderna och vänta på 
bekräftelse innan du fortsätter.

---

## Vision

Ett system som lär känna dig så väl att det
kan förutse — för att det redan vet hur
just du fungerar.

En människa är ett system. Allt hänger ihop.
Maten påverkar sömnen. Sömnen påverkar stressen.
Stressen påverkar blodsockret. Ingen annan
ser sambanden. Forsyne gör det.

Alla andra rapporterar vad som hände.
Forsyne förutsäger vad som händer härnäst.

## Funktioner
- Dynamisk onboarding — konversation, ej formulär
- Daglig check-in — 60 sekunder
- Fyra akter per datasida
- Levande schema — träning och kost efter 30 dagar
- Biologiska tester — blod, hormoner, DNA, CGM
- Signalen — kritisk varning
- Daglig rapport kl 07:00
- Total analys med indexkarta
- Läkarjournal

## Det enda måttet som räknas
Om användaren efter 30 dagar läser systemets
insikt och tänker "hur visste det?" —
är allt arbete värt det.

## Roadmap
Fas 1: Appen — bevisa att intelligensen träffar
Fas 2: API — andra appar integrerar mot modellen
Fas 3: Plattform — idrott, sjukvård, longevity

## Exit
Acquisition av Microsoft, Apple eller Google
när systemet är bevisat i skala.

Det köpvärda: modellen, datanätverket,
API-plattformen.

Inte baserat på genomsnitt. Baserat på dig.

## Öppna problem

- Kroniska hälsotillstånd saknas i onboarding
  Säsongsallergier, astma, sköldkörtel,
  autoimmuna tillstånd — allt som påverkar
  biologin säsongsbaserat eller kontinuerligt
