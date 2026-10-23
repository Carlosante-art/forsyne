# Forsyne — tvåtiers-arkitektur

*Strategisk pivot 2026-04-19 baserad på MARKET.md. Definierar två tydliga produktnivåer: friktionslös entry och premium-djup.*

---

## Varför pivot

Forskningen i MARKET.md visade att:
- Konsumentmarknaden vill ha mindre engagement än nuvarande Forsyne planerar
- Whoop Journal (samma form som Forsynes check-in) har 10-30 % daglig compliance
- Dagarna 3-21 är abandonment-zonen där de flesta appar dör
- Samtidigt: marknaden vill ha *mer djup* än Oura levererar — gapet är smalt men existerar

**Lösningen:** progressiv disclosure. Inte "allt eller inget". Två tiers där hög-friktion-features (check-in, lab, prediktion) är valfri premium, inte obligatoriskt första-intryck.

---

## Tier 1 — Free: "Garmin-tolkaren"

**Kärnvärde:** *"Din Garmin-data, fattad för första gången."*

### Onboarding (30 sekunder total)
1. Email
2. Lösenord (eller magic link)
3. Klicka "Koppla Garmin" → OAuth → klart

Ingen profilfrågefyllning. Inga mål. Ingen matlogging. Inga check-ins.

### Vad användaren får
- **Cross-metric interpretation** av Garmin-data som Garmin Connect själv inte gör
  - "HRV säger X, sömn säger Y, din Body Battery-trend pekar åt Z — bilden är tvådelad"
  - Garmin etiketter ifrågasätts ("Productive"-label kanske inte stämmer givet din djupsömnsdipp)
- **Daily summary** (light-version av briefing) via morgon-email och i-app
- **Historisk trendvy** — ser mönster i din historik som Garmin aldrig visade dig
- Personlig "arketyp" efter 14 dagars data

### Vad användaren INTE får
- Prediktionsmotorn (72h-varsel)
- Chat-yta mot sin data
- Subjektiv check-in → tillgänglig men optional (och ger bara light-pattern, inte full prediktion)
- Labb-integration
- Cross-source data (Dexcom, blodprover, DNA)
- Utökad briefing (den kliniskt-varma 3-styckers agent 11-versionen)

### Prissättning
Gratis. Användaren signalerar intresse genom att koppla Garmin. Forsyne signalerar värde genom att omedelbart leverera insikter. Ingen förhandling, inget friktion.

### Konvertering till Tier 3
Free-användare ser dagligen *teaser* av djupare insikt som premium skulle låsa upp:
- "Din HRV ligger under baseline. Med en 15-sek check-in kan jag säga varför."
- "Detta mönster matchar en historisk krasch. Premium visar dig 72h framåt."

---

## Tier 3 — Premium: "Full Forsyne"

**Kärnvärde:** *"Systemet som känner dig bättre än du själv just nu."*

### Onboarding (10 minuter)
- Tier 1:s 30 sekunder
- Plus personlighetsformulär (nuvarande q1-q6)
- Plus träningsmål
- Plus valfri labb-uppladdning

### Vad användaren får (utöver Tier 1)
- **Prediktionsmotor** — 72h-varsel baserade på personlig baseline + historiska kraschsekvenser
- **Chat-yta** — fråga din data, få svar grundade i hela ditt sammanhang
- **Daglig check-in** — matas in i prediktionsmodellen
- **Labb-integration** — VO2 max, laktattrösklar, kroppssammansättning, blodprover
- **Utökad morgonbriefing** — Agent 11:s tre-stycken narrativ, email + in-app
- **Historisk kraschanalys** — när och varför du brukar krascha, och vad som vänder det
- **Cross-source data** — Dexcom, blodprov, DNA i kontexten

### Prissättning
3 000 SEK/år eller 349 SEK/månad (motsvarar $300/år, i linje med Function Health, Superpower, Whoop).

**Inte** 1 495 SEK. MARKET.md:s slutsats: det undersäljer produkten och signalerar "mindre seriöst".

### Pilot-pricing
Aktivitus-piloten får premium **gratis i 3 månader** som del av pilotavtalet. Efter pilot: 50% rabatt första året (1 500 SEK) om de stannar. Full pris efter det.

---

## Tekniska implikationer

### Vad som behöver byggas (i ordning)

1. **`subscription_tier`-kolumn** på `profiles`-tabellen (värden: `free`, `premium`, `pilot`)
2. **Onboarding-split:** `/onboarding-basic.html` (30 sek) vs existing `/onboarding.html` (full)
3. **Feature-gating middleware** på server: `requirePremium` för prediction, chat, lab, full briefing
4. **Today-page tier-awareness:** free visar subset, premium visar allt
5. **Upgrade CTA** i app (kontextuella teasers)
6. **Stripe-integration** för premium-prenumeration
7. **Email-flows** — olika welcome per tier

### Vad som INTE behöver byggas
- Mellantier (check-in utan prediktion) — byggs inte
- B2B-features — senare
- Multi-region pricing — senare

---

## Tidsplan

**Denna vecka (april 2026):**
- Landing uppdaterad för två tiers
- Backend tier-gating
- Onboarding-split

**Maj 2026:**
- Stripe live
- Upgrade-flows
- Aktivitus-pilot startar på premium-gratis

**Juni 2026:**
- Free-tier launch (öppna för publik)
- Post-WWDC-kommunikation (efter Apple Health+)

**Juli 2026:**
- Pilot slut → 50% rabatt för kvarvarande
- Mät konvertering (pilot → betalande)

---

## Framgångskriterier

### Tier 1 (free)
- **Onboarding-completion:** >80% (vs 40-70% för dagens full-onboarding)
- **Day-1 retention:** >60% (ser något värdefullt på dag 1)
- **Day-7 retention:** >40%
- **Day-30 retention:** >25%

### Tier 3 (premium)
- **Free → Premium konvertering:** >5% inom 60 dagar
- **Premium churn:** <5%/månad
- **Pilot → post-pilot-betalande:** >30%

Om någon av dessa siffror underskrids signifikant: omvärdera tier-strategin.

---

## Risker med pivoten

1. **Free-tier kanibaliserar premium.** Folk stannar på gratis utan att uppgradera. *Mitigation:* gör premium-värdet uppenbart teaser-mässigt i free-vyn.

2. **Garmin-beroende blir större.** Om Garmin stryper API:et är free-tier död. *Mitigation:* bygg Oura/Apple Health-stöd senare. Men primärt: den största svenska endurance-populationen *är* Garmin-användare, så beroendet är pragmatiskt acceptabelt.

3. **Free-tier kräver egen support.** Varje gratis-användare är en potentiell frågeställare. *Mitigation:* första månaden — begränsat antal gratis-inbjudningar via invite-koder, skalar gradvis.

4. **Positioneringsrisk.** "Better Garmin interpretation" är lättare att förstå men låter mindre visionärt än "personal intelligence system". *Mitigation:* free-tier är hook, premium-tier är visionen. Landingcopy måste balansera båda.

---

## Vad som FÖRSVINNER från ursprungsvisionen

- "Du måste göra check-ins" → nu valfritt (premium unlock)
- "Bygger dig själv i onboarding" → nu splittrat (quick vs deep)
- 1 495 SEK → nu 3 000 SEK
- Allt-i-en-UX → nu progressiv disclosure

## Vad som ÄR kvar

- Prediktionsmotorn som moat
- Cross-domain synthesis
- Kliniskt-varm röst
- Svensk endurance-first
- Aktivitus som pilot-bas
- "Forsyne förutsäger innan du känner det"-positionering (för premium)

---

*Pivot bekräftad 2026-04-19. Denna fil är levande — uppdatera när tiers kalibreras efter pilot-data.*
