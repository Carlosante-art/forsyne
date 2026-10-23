# Forsyne — Roadmap

*Löpande lista över vad som är byggt, vad som är nästa, vad som väntar.*

---

## Levererat (2026-04-19)

### Kärnprodukt
- Agent 2 (check-in generering)
- Agent 3 (insikter)
- Agent 4 (prediktion) + 4-sprint feature pipeline
- Agent 6 (blod), 7 (DNA), 8 (nutrition)
- Agent 9 (balans), 10 (journal)
- **Agent 11 (morgonbriefing) — cron 07:00 + email**
- **Agent 12 (chat-yta) — med datakontext + prompt caching**
- **Agent 13 (Garmin-tolkaren) — basic-tier**
- **Agent 14 (retrospektiv analys) — aha-moment dag 1**

### Infrastruktur
- Railway (backend) + Cloudflare (DNS) + Resend (email) + Supabase (db)
- forsyne.se live med SSL, .io/.app redirect
- briefing@forsyne.se verifierad avsändare
- Alla API-nycklar roterade efter exponering

### Frontend
- app/today.html, chat.html, lab.html, checkin.html etc.
- landing.html (scenario-baserad pitch + waitlist)
- onboarding-basic.html (30 sek, Garmin-koppling via FIT-upload)
- privacy.html, share.html, icon-template.html
- PWA manifest + ikoner

### Strategi-dokument
- VISION.md, STRATEGY.md, MARKET.md, RETENTION-RESEARCH.md
- TIERS.md, POSITIONING.md, IDEA-FRAMEWORK.md
- GARMIN.md, COMPETITORS.md
- PLAN.md, AKTIVITUS-PITCH.md

---

## Nästa session (prioriterat)

### 1. Coach-vy (B2B2C) — stärker Aktivitus-pitchen

En separat dashboard där Aktivitus sport scientists loggar in och ser
alla sina atleters Forsyne-insikter i realtid. Gör Aktivitus
operationellt beroende av Forsyne, inte bara partnerskap.

**Teknisk insats:** medium (~4-6h)
- Nytt roles-system på profiles-tabellen (`role: 'athlete' | 'coach'`)
- Coach–atlet-relation (ny tabell `coach_athletes`)
- Coach-dashboard-sida (`app/coach.html`) — lista atleter + genväg
  till var och ens today-vy (read-only)
- Permissions middleware: coach får läsa sina atleters data

**Strategisk impact:** hög. Kan pitchas till Aktivitus som "v2 efter
pilot" redan nu, stärker pilotavtalet.

### 2. Feedback-loop — smart → smartare över tid

När Forsyne rekommenderar något ("skippa tempopasset"), fråga nästa
dag om användaren följde rådet och vad som hände. Lagra som
kausalitetsdata per användare.

**Teknisk insats:** medium (~3-4h)
- Ny tabell `feedback` (recommendation_id, user_id, followed, outcome_data)
- Frågekomponent i today.html ("följde du gårdagens råd?")
- Efter 30+ feedback-rader: modellen viktar mer för "vad som faktiskt
  fungerade för just dig" i framtida prediktioner

**Strategisk impact:** hög. Skapar äkta inlärande modell som bara
blir bättre över tid = retention-moat.

### 3. Cross-user pattern matching — "andra som liknar dig"

När 100+ användare finns: matcha nuvarande användarens mönster mot
liknande profiler i pool. "7 atleter i din åldersgrupp med liknande
HRV-profil och träningsbelastning kraschade i mars. Gemensam nämnare:
sömnregelbundenhet."

**Teknisk insats:** high (~8-12h)
- Vector embeddings per användarprofil
- Similarity search (Supabase pgvector eller extern)
- Privacy-aware aggregation (ingen individualiserad läckage)
- Integration i Agent 4:s prediktion-kontext

**Strategisk impact:** mycket hög men kräver pilot-skalan för att
aktiveras. **Arkitekturellt viktigt att veta om nu** så vi inte
stänger dörrar med nuvarande datamodell.

---

## Infrastruktur-jobb (stöttar ovanstående)

### Garmin Connect IQ Developer Program
Ansök till [developer.garmin.com](https://developer.garmin.com/gc-developer-program/).
Ger GARMIN_CLIENT_ID + GARMIN_CLIENT_SECRET för automatisk OAuth
istället för FIT-filsuppladdning. Tar 1-2 veckor.

### Terra API som fallback
Om Garmin-godkännandet drar ut: Terra API erbjuder OAuth-middleware
för Garmin + Oura + Whoop + Apple Health på en gång. Gratis upp till
100 användare, sen $50-100/mån. 1h integration.

### Stripe för premium
Sätt upp Stripe Atlas eller svensk Stripe-setup. Checkout + webhook
för subscription events. Smart retry-logik (Eight Sleep-pattern från
RETENTION-RESEARCH.md: 32 % → 15 % failed renewals). ~4h.

### Backend feature-gating
Middleware `requirePremium` på endpoints som är premium-only:
prediction, chat, lab, full briefing. Basic-users får 402-svar
eller redirect till upgrade. ~2h.

### Proprietär vokabulär
Skapa `VOCABULARY.md` som fryser 3-5 termer utöver "Varsel":
- Baslinje (personlig normalnivå per metrik)
- Mönstermatchning (din sekvens matchar historik)
- Kraschsignatur (din typiska föregång)
- Återhämtningsskuld (ackumulerad underdrift av vila)

Använd konsekvent i alla agenter + UI-text.

---

## Dataintegrationer (prioriterade)

Varje ny datakälla gör Forsyne märkbart smartare. Prioritet efter
svensk endurance-marknad.

1. **Garmin** — primär, fungerar via FIT-upload. OAuth när Developer
   Program-godkänt.
2. **Oura** — ring-användare bland Forsynes målgrupp. API dokumenterad.
3. **Whoop** — mindre populär i Sverige men växande. API finns.
4. **Dexcom / Abbott Lingo** — CGM för de seriösa. OAuth kräver
   ansökan.
5. **Apple Health** — via HealthKit-webb eller manuell export.
6. **Strava** — inte för träningsdata (Garmin räcker), men för social
   delning och segment-kontext.
7. **TrainingPeaks** — för atleter med coach. Planerade pass kan
   jämföras med faktiska.
8. **Werlabs / Cerascreen** — svenska blodprovsleverantörer. Pitch
   liknande Aktivitus kan gälla.

---

## Bortsållat (inte för pilot eller premium-launch)

- Egen hårdvara (ring, band, etc.) — aldrig
- Eget socialt nätverk — använd Strava/Garmin Connect
- B2B enterprise-sälj — Phase 3+
- US-lansering — Phase 4+
- Apple Watch native app — PWA räcker
- Multi-språk utöver svenska + engelska — Phase 3+

---

## Beslutsfilter

Nya idéer testas mot två frågor:

1. **Passar det i skärningspunkten Markets × Problems × Skills?**
   (IDEA-FRAMEWORK.md Venn-analys)
2. **Förstärker det intelligens-lagret över användarens data, eller
   försöker det ersätta något som redan fungerar i ekosystemet?**
   (POSITIONING.md huvudregel)

Om inte båda är ja — säg nej. Även om idén är lockande.

---

*Uppdatera denna fil när stora sprintar avslutas eller prioriteringar ändras.*
