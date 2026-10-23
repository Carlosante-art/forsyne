# Forsyne — Testplan
**Syfte:** Verifiera att hela systemet fungerar som avsett.  
**Deltagare:** Du + kompanjon (två separata konton).  
**Förutsättning:** Railway är uppe · Supabase-migration körd · Två enheter (mobil + dator fungerar).

---

## Innan du börjar

Öppna Supabase → Table Editor. Du kommer behöva det för att verifiera att data sparas korrekt.  
Öppna Railway → Deployments. Bekräfta att senaste deploy är grön.

---

## FAS 1 — Konto & Onboarding

### 1.1 Skapa konto
1. Gå till `forsyne-production.up.railway.app`
2. Skapa ett nytt konto (använd din riktiga e-post)
3. Kompanjonen skapar sitt konto på sin enhet

**✓ Rätt:** Du hamnar i onboarding-flödet, inte direkt på dashboard  
**✗ Fel:** Hamnar på dashboard utan onboarding → Supabase profiles-tabellen saknar rad

### 1.2 Genomför onboarding
1. Svara på alla frågor — ta det på allvar, riktig data ger bättre insikter
2. Kompanjonen gör detsamma på sin enhet

**✓ Rätt:** Du landar på `dashboard.html` när onboarding är klar  
**✗ Fel:** Fastnar i loop → localStorage `forsyne_onboarding` kan vara korrupt, rensa och försök igen

**Verifiera i Supabase:** `profiles`-tabellen → en rad per användare med `data` ifyllt

---

## FAS 2 — Daglig check-in

### 2.1 Genomför första check-in
1. Gå till Check-in i sidebaren
2. Svara på alla frågor — **kontrollera att dessa frågor dyker upp:**
   - Humörfråga (skala 1–5) — alltid första
   - 3 AI-genererade frågor (unika för dig)
   - **"Hur hög var den kognitiva belastningen idag?"** (skala 1–5)
   - **"Har du haft aktiv återhämtning idag?"** (ja/nej)
3. Spara check-in

**✓ Rätt:** Totalt 6 frågor visas · Done-state med prickar · Omdirigeras till dashboard efter 2–5 sek  
**✗ Fel:** Bara 4 frågor → server.js uppdaterades inte korrekt (kontrollera Railway deploy)  
**✗ Fel:** "Systemet kunde inte förbereda" → API-nyckel eller Supabase-anslutning nere

**Verifiera i Supabase:** `checkins`-tabellen → ny rad för idag med `kognitiv_belastning` och `aktiv_aterhamtning` ifyllda (inte null)

### 2.2 Notifikationsprompt
Efter att check-in sparas:

**✓ Rätt:** En fråga dyker upp — "Aktivera dagliga påminnelser?" med Aktivera/Inte nu  
**✗ Fel:** Syns inte → Notification API stöds inte i den webbläsaren (Safari iOS kräver tillåtelse i inställningar)

1. Klicka **Aktivera** → godkänn i webbläsarens dialog
2. Nästa dag efter 07:30 (om check-in inte gjorts) ska en notis dyka upp

---

## FAS 3 — Dashboard

### 3.1 Grundläggande visning
Efter check-in, gå till Dashboard.

Kontrollera att dessa element visas:
- [ ] Ditt namn uppe till höger
- [ ] Dagens datum
- [ ] **Ögat** — animerat, öppnar sig baserat på PSI-score
- [ ] **PSI-siffra** (0–100) under ögat
- [ ] En statustext under PSI

**✓ Rätt:** Ögat är delvis öppet (PSI 50–70 för de flesta första dagar)  
**✓ Rätt:** Statustext är dynamisk — inte "—"

### 3.2 AI-insikt (typewriter)
Vänta 5–15 sekunder efter att sidan laddats.

**✓ Rätt:** En mening skrivs ut bokstav för bokstav i det stora textfältet  
**✗ Fel:** Texten är statisk och generisk → PCache returnerar gammal data, kör `localStorage.clear()` och ladda om

### 3.3 Rekommendation
Under AI-insikten:

**✓ Rätt:** En konkret åtgärd visas (t.ex. "Lägg dig 60 minuter tidigare")  
**✗ Fel:** Tom → agenten svarade men utan rekommendationsfält

### 3.4 Idag-plan
Scrolla ner till plan-sektionen:

**✓ Rätt:** Träningsrekommendation + kostfokus för idag visas  
**✗ Fel:** Sektionen döljs helt → schema-agenten behöver fler check-ins (kräver 1+)

### 3.5 Signalen-sektionen
Klicka på **Signalen** i sidebaren (eller scrolla till signal-sektionen på dashboard):

**✓ Rätt:** En analys med varselstatus visas (vanligtvis "ingen" första dagarna)  
**✓ Rätt:** Två kolumner: "Om du agerar" vs "Om ingenting ändras"  
**✗ Fel:** Laddningsprickar snurrar för evigt → prediction-agenten timeout, vänta och ladda om

---

## FAS 4 — Mönster-sidor

### 4.1 Genomför minst 3 check-ins (dag 1, 2, 3) innan du testar dessa

### 4.2 Testa varje mönster-sida
Gå till: **Sömn / Energi / Stress / Träning / Kost / Wearables**

På varje sida, kontrollera:
- [ ] Datan från dina check-ins visas (siffror, inte "—")
- [ ] AI-insikten laddas (kan ta 5–10 sek)
- [ ] Trendpil eller statustext är logisk (om du sov dåligt ska sömnstatus vara varning)

**✓ Rätt:** Sidan visar din faktiska data, inte generiska platshållare  
**✗ Fel:** Alla värden är "—" → checkins hämtas inte, kontrollera auth-token

### 4.3 Gap-detektion (kräver Garmin-data)
Om du har Garmin: importera data via **Wearables → Garmin Import**

**✓ Rätt:** På Sömn/Energi/Stress-sidorna dyker en gul sektion upp: "Avvikelse detekterad"  
**✓ Rätt:** Texten förklarar skillnaden mellan subjektivt (check-in) och objektivt (Garmin)  
**✗ Fel:** Sektionen dyker aldrig upp → gapet är under tröskeln (normalt om du är konsistent)

---

## FAS 5 — Biologi

### 5.1 Blodprover
Gå till **Biomarkörer → Ladda upp blodprov**

1. Ladda upp en PDF eller text med dina värden
2. Vänta på analys (15–30 sek)

**✓ Rätt:** Systemet extraherar värden och ger biologisk kontext kopplad till dina check-ins  
**✗ Fel:** "Kunde inte tolka filen" → filen är skannad bild utan text-lager, konvertera till sökbar PDF

**Verifiera i Supabase:** `integrations`-tabellen → rad med `provider = 'blood_labs'`

### 5.2 DNA (om du har 23andMe/Ancestry)
Gå till **DNA → Ladda upp**

**✓ Rätt:** Genetiska predispositioner listas och kopplas till dina mönster  
**✗ Fel:** Timeout → DNA-filen är för stor, agenten behöver mer tid

### 5.3 Journal
Gå till **Journal → Läkarjournal**

1. Klistra in eller ladda upp medicinsk historia
2. Systemet extraherar kronisk kontext

**✓ Rätt:** Systemkontext sparas och används av alla agenter framöver  
**✗ Fel:** Tom → journalen hade inget systemrelevant innehåll

---

## FAS 6 — Systemkarta

### 6.1 Kräver minst 7 check-ins

Gå till **Systemkarta**:

- [ ] Animerade noder laddas (Sömn, Energi, Stress, Träning, Kost)
- [ ] Flödeslinjer visas mellan noderna (gröna = positiv korrelation, röda = negativ)
- [ ] Hovra på en nod → insikt visas i panelen till höger
- [ ] Klicka på en nod → navigerar till rätt sida

**✓ Rätt:** Nodens storlek varierar — den mest inflytelserika variabeln är störst  
**✓ Rätt:** Flödeslinjerna rör sig (animerade partiklar)  
**✗ Fel:** Inga linjer alls → under 7 check-ins, eller alla korrelationer under 0.25-tröskeln (behöver mer variation i datan)

### 6.2 Selvitas Index på Systemkarta
I map-headers-sektionen:

**✓ Rätt:** SI-siffran visas (0–100) och etiketten under ändras beroende på score  
**✗ Fel:** Visar "—" → `/api/selvitas/index` svarar inte, kontrollera Railway logs

### 6.3 Arkitektur-sektionen
Scrolla ner förbi korrelationskartan:

**✓ Rätt:** Tre kolumner visas: Datakällor → Systemet → Output  
**✓ Rätt:** SI-formeln visas: `SI = Datamognad × (1 − Genomsnittsgap) × Modellprecision`

---

## FAS 7 — Selvitas

### 7.1 Kräver minst 5 check-ins

Gå till **Selvitas** (längst ner i sidebaren):

- [ ] SI-index visas med tre komponentbars (Datamognad, Genomsnittsgap, Modellprecision)
- [ ] Biologisk identitet — en mening om vem du är som system
- [ ] Funktionsmönster — hur dina variabler hänger ihop
- [ ] Prediktion — vad systemet förutspår härnäst
- [ ] Systemets dom — den stora kursiva meningen längst ner

**✓ Rätt:** Allt skrivs ut progressivt med fade-in  
**✓ Rätt:** SI-siffran är färgkodad (röd tidigt, orange 30–55, vit 55–80, grön 80+)  
**✗ Fel:** Empty state ("Systemet bygger sin modell") → under 5 check-ins

### 7.2 Konkret prediktion
Under Systemets dom:

**✓ Rätt:** En if-then-prediktion visas: "Om du sover under X.Xh förutspår systemet energi under Y nästa dag."  
**✓ Rätt:** Konfidens visas i procent  
**✓ Rätt:** Status: "Väntar på verifiering"  
**✗ Fel:** Prediktionskortet syns inte → under 7 check-ins, eller korrelationen är för svag (< 0.25)

**Verifiera i Supabase:** `concrete_predictions`-tabellen → en rad skapad

---

## FAS 8 — Valideringsslinga (dag 2+)

Detta testar systemets viktigaste funktion — att lära sig.

### 8.1 Dag 2: Gör en ny check-in

**✓ Rätt:** I Supabase `concrete_predictions` → kolumnen `verified` ändras från `false` till `true`  
**✓ Rätt:** `correct` är antingen `true` eller `false` beroende på om prediktionen stämde  
**✓ Rätt:** På Selvitas-sidan ändras badge från "Väntar på verifiering" till "Träffade" eller "Missade"

### 8.2 Verifiera att systemet lär sig
I Supabase → `validations`-tabellen:

**✓ Rätt:** Rader med `stammer`, `larda_notering`, `vad_missades` ifyllda  
**✓ Rätt:** Framtida insikter tar hänsyn till vad agenten missade tidigare

---

## FAS 9 — Demo-läge

### 9.1 Testa utan inloggning
Öppna i ett inkognitofönster (eller skicka till kompanjonen):

```
https://forsyne-production.up.railway.app/dashboard.html?demo=1
```

- [ ] Sidan laddas utan inloggning
- [ ] Namnet "FAWZI" visas uppe till höger
- [ ] Ögat animeras med PSI ~55
- [ ] Typewriter-insikt om sömn skrivs ut
- [ ] Idag-plan visas
- [ ] Signalen visar 28% krashrisk med tidig varning

**✓ Rätt:** Hela dashboarden fungerar utan konto  
**✗ Fel:** Vitruta eller redirect till login → Railway har inte deployt senaste versionen ännu

---

## FAS 10 — Kompanjonens test (parallellt)

Kompanjonen testar samma flöde på sin enhet. Viktigt att verifiera:

1. **Separata data** — era check-ins blandas inte (Row Level Security i Supabase)
2. **Separata insikter** — AI-agenten ger olika svar baserat på er individuella data
3. **Separat SI** — era Selvitas Index-värden är olika

**Verifiera i Supabase:** `checkins`-tabellen → två separata `user_id` med varsin data

---

## FAS 11 — Belastningstest (valfritt)

### 11.1 Check-in spam-skydd
Försök göra två check-ins samma dag:

**✓ Rätt:** Andra check-in skriver över den första (upsert på `user_id, date`) — ingen dubblett  
**✗ Fel:** Två rader med samma datum → RLS eller upsert fungerar inte

### 11.2 Cache-busting
Gör en check-in, gå till Dashboard:

**✓ Rätt:** PCache är tömd, ny insikt genereras  
**✗ Fel:** Gammal insikt kvar → `PCache.bust()` fungerar inte

---

## Vad du ska anteckna under testning

För varje fas, notera:
- Fungerade det? (ja/nej)
- Hur lång tid tog det? (känsla för responsivitet)
- Något oväntat?
- Vad visades som var genuint träffsäkert om dig?

Det sista är det viktigaste. Det är beviset.

---

## Snabbreferens — Supabase-tabeller att kolla

| Vad du testar | Tabell | Kolumn att verifiera |
|---|---|---|
| Check-in sparad | `checkins` | `kognitiv_belastning`, `aktiv_aterhamtning` |
| Prediktion skapad | `concrete_predictions` | `display_text`, `verified` |
| Prediktion verifierad | `concrete_predictions` | `correct` |
| Agent lärde sig | `validations` | `stammer`, `larda_notering` |
| Profil sparad | `profiles` | `data` |
| Wearables importerade | `integrations` | `provider`, `data` |

---

*Inte baserat på genomsnitt. Baserat på dig.*
