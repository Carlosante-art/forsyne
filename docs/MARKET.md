# Forsyne — marknadssignalen för enkelhetens intelligens

*Deep research-rapport, april 2026. Skriven för Carl. Svar på kärnfrågan: vill människor faktiskt ha ett "systemet förklarar, du lever som vanligt"-flöde, eller är det en kognitiv illusion som dör vid första check-in?*

---

## 1. Exekutiv sammanfattning

- **Evidensen lutar inte åt att "folk vill förstå sin data".** Evidensen lutar åt att folk vill *känna sig omhändertagna utan ansträngning*. Self-tracking-forskningen (Epstein et al., UC Irvine, 2015–2020) är entydig: nyfikenhet på data är stark vid start och förfaller snabbt. Retention följer inte intresset — den följer friktion. Detta är både Forsynes största styrka (flödet är designat runt friktion, inte runt data) och största risk (14–30 dagars baseline kräver uthållighet innan värdet syns).
- **Engagement-spektrat har en tydlig vinnande pol: den passiva.** Oura (passiv ring, daglig 3-sekunders glimt) har långt högre långtidsretention än Whoop (passiv band + dagligt Journal). Journal-funktionen i Whoop är offentligt hypad men den faktiska andel som loggar dagligen är låg — Whoop publicerar inte siffror, anekdotisk uppskattning från power-user-forum är 10–25 %. Forsynes 15-sekunders check-in ligger i en gråzon: kort nog för att vara överkomlig, men aktiv nog för att kräva disciplin. Det är exakt där hälften av apparna har dött.
- **Willingness to pay för AI-tolkad hälsodata är växande men koncentrerad till en specifik psykologisk profil.** Function Health ($499/år), Superpower ($499/år) och Levels Health ($199–$399/år) har skalat snabbt men mot en tydligt definierbar grupp: höginkomsttagare, 30–50 år, teknik-/finansbakgrund, redan quantified-self-benägna. Det är inte en generell konsument. För Sverige är motsvarande pool liten men existerande (uppskattad övergripande storlek 30–150 k; flaggas som osäker).
- **Agentic AI-trenden är verklig men ojämn.** Granola (passiv mötestranskribering) har dokumenterad breakout-retention; Rewind och Limitless har haft betydligt svagare traction. Det är inte "AI gör allt" som vinner — det är "AI gör en specifik, tydlig sak passivt som tidigare krävde aktivt arbete". Forsyne måste kunna definiera *den enda sak* som systemet gör automatiskt (prediktion 48–72 h framåt) — annars hamnar det i "vag AI-assistent"-fällan som har hög dödlighet.
- **Forsynes flöde är inte validerat i sin helhet — men varje enskild komponent har evidens.** En-gångs-onboarding: validerat (Oura, Eight Sleep). Wearable-koppling: validerat (alla större). 15-sekunders check-in: halvvaliderat (Whoop Journal, men med låg compliance). 14–30 dagars baseline-väntan: *ovaliderat och Forsynes största UX-skuld* — det är just under denna period som majoriteten av appar tappar användaren. Carl bör behandla dagarna 3–21 som en separat produktsurface, inte som "vänte-tid".

---

## 2. Marknadens grundtillstånd 2026

Konsumenthälsomarknaden 2026 står i en paradox. Utbudet av AI-hälsoverktyg har exploderat sedan GPT-4-eran (2023), men konsumenters faktiska tidsbudget för hälso-appar är oförändrad eller krympande. Data.ai/Sensor Tower-rapporter (flera år, metodologin är branschstandard men samplen varierar) visar att genomsnittlig tid i hälso- och fitness-appar per användare per dag ligger runt 2–7 minuter för de som öppnar appen. Medianen av alla nedladdade hälsoappar öppnas aldrig efter vecka 2.

Det här är grundsignalen: **marknaden är inte brist på intresse, den är brist på uthållighet**. Varje ny app konkurrerar inte om tid i användarens liv utan om att *inte bli bortglömd* under dag 3–14.

Parallellt har betalningsviljan för premium hälso-AI ökat i specifika segment. Function Health rapporterade offentligt 100 000+ betalande medlemmar inom 18 månader efter lansering (bolagets egna siffror, maj 2024) till $499/år. Superpower har offentligt hävdat snabb tillväxt men siffror är mindre transparenta. Whoop har hållit sig runt $30/månad-nivå sedan 2020 och expanderat internationellt; de publicerar ingen retention-data (själv en signal — bolag som inte publicerar retention har oftast inte enastående retention).

Centralt för Forsyne: **efterfrågan på "AI som förklarar min hälsa" är riktig, men den är smalare än den ser ut i Twitter/X-diskursen.** Det är en premium-nisch, inte en mainstream-våg.

---

## 3. Vad forskningen säger om självspårningsbeteende

### 3.1 Abandonment-mönstret

Den ofta citerade siffran "50 % slutar använda sin fitness-tracker inom 6 månader" kommer från en Endeavour Partners-rapport (2014, "Inside Wearables") och replikeras i senare studier med liknande resultat. En PwC Health Research Institute-studie (2016) hittade 33 % som slutat efter sex månader. Nyare industrirapporter (IDC, 2021–2023) visar förbättrade men fortfarande svaga siffror: ca 30–40 % av wearable-köpare använder sällan eller inte alls efter 12 månader. Siffran "50 % inom 6 månader" är alltså inte myt men inte heller bevisad universell — intervallet är 30–50 % beroende på studie och plattform.

Forskningsgruppen runt Daniel Epstein (först UW, sedan UC Irvine) har publicerat en rad artiklar om "abandonment of personal informatics". Kärnfynd:

- **Abandonment är inte en enskild händelse.** Det är en gradvis process: minskad datakvalitet → missade dagar → appen stängs. Användare beskriver sällan ett aktivt beslut att sluta.
- **Orsaker rangordnade:** (1) appen ger inte längre nya insikter, (2) för mycket friktion att logga, (3) datan matchar inte upplevelsen, (4) life-event (stress, sjukdom, flytt).
- **"Lapsed" ≠ "quit".** Många återvänder. Men bara efter en ny motivator (t.ex. skada, graviditet, läkarbesök). Forsynes modell måste överleva och snyggt återaktivera en bortfallen användare.

### 3.2 Passiv vs aktiv tracking — retention-glappet

Ju mindre användaren ombes göra dagligen, desto högre långtidsretention. Varje aktivt moment är en kostnad.

- Oura Ring: över 2,5 miljoner sålda enheter (Tom Hale 2023). 6-månaders aktiv användning uppskattas 70–85 % (anekdotiskt från Reddit-sentiment).
- Whoop: använder abonnemangsmodell vilket döljer engagemangs-bortfall. Publicerar inte churn.
- Apple Watch: third-party surveys (CIRP) antyder >90 % 12-månaders hårdvaru-retention, men det mäter inte appanvändning.

### 3.3 Whoop Journal — det mest relevanta jämförelseobjektet

Whoops Journal är nästan identiskt i form med Forsynes 15-sekunders check-in: dagliga yes/no-frågor om kontextuella faktorer (alkohol, caffeine, meditation, stress). Whoop hypar funktionen i marknadsföring men **publicerar inte compliance-data**. På r/whoop rapporteras 10–30 % som loggar dagligen efter 3 månader.

**Detta är den mest konkreta evidensen mot Forsynes hypotes.** Om Whoop, med 30 USD/månad betalda användare och topp-tier onboarding, inte får majoriteten att fylla i en ~30-sekunders daglig Journal, finns ingen särskild anledning att tro att Forsyne får det gratis.

Carls motargument är implicit: Forsyne *gör något* med check-in-datan (prediktion) som Whoop inte gör. Men användaren vet inte det på dag 3. Upp till dag 14–30 är det en ren förtroendefråga.

### 3.4 Cognitive load och default bias

Forskningen på daily check-ins: **under 30 sekunder är överlevbart, över 60 sekunder är inte**. 15 sekunder ligger i den säkra zonen form-mässigt, men *psykologisk* kostnad är högre än tidsmässig: "att behöva tänka på sig själv" varje dag är tyngre än att klicka ett alternativ.

Default bias (Thaler & Sunstein, *Nudge*) säger att det som auto-loggas vinner över det som kräver val. Forsynes check-in bryter mot denna princip medvetet — den kräver subjektiv input som inte kan automatiseras. Det är en strukturell svaghet, inte ett designfel.

### 3.5 Willingness to pay — 2023–2026

- Whoop: ~30 USD/månad. Estimerad intäkt 2023 ~500 M USD.
- Oura: 5,99–9,99 USD/månad prenumeration från 2022+, utöver ringens ~300 USD. Finansierad på 5,2 B USD värdering 2023.
- Function Health: 499 USD/år. 100 k+ medlemmar inom 18 månader.
- Superpower: 499 USD/år, mindre transparent kring siffror.
- Levels Health: 199–399 USD/år. Uppskattat 50–100 k medlemmar.

**Intrycket är att $300–600/år är en beprövad prispunkt för "AI tolkar min hälsodata".** Forsynes 1 495 SEK (~140 USD) ligger under denna nivå — vilket både är billigare-än-förväntat och kan signalera "mindre seriös" jämfört med Function/Superpower.

---

## 4. Konkurrentanalys: vem vinner på "systemet förklarar"-modellen?

### 4.1 Oura — passiv, tolkad, minimal friktion

Oura är det närmaste analogi till Forsynes filosofi på engagement-sidan. Användaren bär ringen (passiv), öppnar appen en gång per dag (2–10 sekunder), ser "Readiness Score" + kort textförklaring. Ingen check-in krävs.

**Varför det fungerar:** ring-form-faktorn är osynlig. Daily glance är < 10 sekunder. AI-tolkningen är kort och generisk men känns personlig nog.

**Vad som inte finns hos Oura:** djup-analys av *varför*. "Your recovery is low because..." är ofta bara "you slept less than average". Där Forsyne har möjlighet att vinna — förklaringsdjupet.

### 4.2 Whoop — semi-passiv med journal-beroende

Whoop är beviset att "användaren loggar för att appen blir bättre" inte räcker. Forsyne måste göra det akut-värdefullt att fylla i check-in inom första veckan, inte lova långsiktigt värde.

### 4.3 Function Health & Superpower — premium + AI + periodisk data

Inte dagligt-loggade. Tar blodprov 2–4 ggr/år och levererar AI-tolkning. Användaren gör i princip ingenting mellan testerna. Extremt låg engagement-kostnad.

Retention är högre än daily-apps (95 %+ årlig förnyelse enligt Function, 2024). Det är troligen delvis sant eftersom friktionen är nästan noll och värdet är tydligt punktvis.

**Forsyne-implikation:** Om Forsyne positioneras som "månatlig rapport + periodiska blodprov, inte daglig app" skulle det sannolikt konvertera bättre. Men det är en annan produkt. Detta är ett verkligt strategiskt vägval: *daglig prediktion kräver daglig relation, vilket är den svåraste relationen i consumer apps.*

### 4.4 Levels Health — CGM + AI

Validerar "passiv signal + AI-tolkning + minimal dagliga input". Levels har vuxit stadigt men inte explosivt — tyder på att även med passiv data är konsumentvillighet begränsad utanför QS-segmentet.

### 4.5 Eight Sleep — passiv, produkt i möbel

När produkten är möbel eller wearable gör friktion mindre arbete. När produkten är en app måste friktion-hantering göras i UX.

### 4.6 Sammanfattning

| Produkt | Daglig friktion | Retention-signal | Forsyne-relevans |
|---|---|---|---|
| Oura | 2–10 sek glance | Hög (anekdotisk) | Sätter riktmärket för "minimal" |
| Whoop | 30–60 sek Journal | Okänd, troligen medel | Journal-compliance är varningssignal |
| Apple Watch | 0 sek (passiv) | Hög hårdvaru-retention | Plattform, inte konkurrent |
| Function | 0 sek dagligt | Hög årlig | Alternativ affärsmodell |
| Levels | 0–30 sek | Medel | Validerar CGM + AI |
| Eight Sleep | 0 sek | Hög (möbelfördel) | Ej direkt jämförbart |
| **Forsyne (planerad)** | **15 sek check-in** | **Okänd** | — |

**Forsyne ligger närmare Whoop än Oura i friktionsprofil.** Det är en varning, inte nödvändigtvis en dom.

---

## 5. Agentic AI-trenden — vad den betyder 2026–2029

"Agentic AI" i konsumentappar 2024–2026 har gått från buzzword till specifika produkter:

- **Granola** (passiv mötestranskribering + AI-sammanfattning): bekräftad breakout 2024, hög user retention. Fungerar för att: (a) ett specifikt jobb, (b) noll användar-interaktion under själva jobbet, (c) output är uppenbart värdefullt.
- **Rewind** (spelar in allt på datorn): svagare traction, integritetsoro, pivoterade flera gånger. "Allt" är sämre än "en sak".
- **Limitless, Cluely, Mem**: mindre traction än PR-cycle antyder.

**Mönstret är konsekvent:** agentic AI vinner när det gör *en tydlig sak passivt* som användaren skulle gjort aktivt. Den vinner inte när det försöker vara "personlig assistent" generellt.

**För Forsyne:** den explicita agentic-pitchen måste vara **"systemet varnar 72 h innan du kraschar, passivt"**. Inte "systemet hjälper dig förstå din hälsa". Det andra är för brett, det första är Granola-shaped.

GPT-wrappers med "AI hälso-coach" har bränts 2024–2025. Forsynes moat måste vara i *datapipelinen och prediktionsmodellen*, inte i chat-UI:t.

---

## 6. Svensk kontext

### 6.1 Betalningsvilja för hälso-premium i Sverige

- **Kry/Livi** har bevisat att svenskar betalar för digital vård, men modellen bygger på region-ersättning.
- **Natural Cycles** är det mest relevanta svenska precedent: FDA/CE-godkänd preventivmedelsapp, globalt skalad, svensk ursprung. Bevisar att svenskar bygger globalt trovärdiga hälso-AI, men regulatoriskt arbete är dyrt och långsamt.
- **Aktivitus, Werlabs, Cerascreen** visar att svenska konsumenter köper premium blodprov (2–5 k SEK), men marknaden är smal.

**Realistisk svensk TAM för "Forsyne-typ produkt"** (ambitiösa motionärer + QS-benägna höginkomsttagare 30–50): uppskattningsvis 30 000–150 000 personer. Baserat på Vasaloppet ~15 k deltagare, Ironman Kalmar ~2 k, svenska triatlonförbundet ~25 k aktiva medlemmar, Aktivitus-kohort ~5–10 k kunder/år.

**Forsyne som endast svensk produkt är ett lifestyle-company (några tusen betalande), inte ett venture-scale-företag.**

---

## 7. Forsynes UX-hypotes — utvärderad punkt för punkt

### 7.1 "Onboarding EN gång (10–15 min personlighetsformulär)"

**Marknadsbeprövat.** 10–15 min är inom norm. Risk: kompletteringsgrad. Amplitude/Mixpanel-benchmarks: 40–70 % completion.

### 7.2 "Kopplar in wearables en gång"

**Marknadsbeprövat.** Friktion uppstår när multi-device-integration krävs. Forsyne måste välja en primärkälla eller hantera konflikter transparent.

### 7.3 "15-sekunders daglig check-in"

**Halvvaliderat.** Whoop Journal-precedentet visar att compliance blir låg. 15 sekunder är i säkra zonen tidsmässigt men psykologisk kostnad kvarstår.

**Starkaste motåtgärd:** gör check-in *värdeladdad från dag 1*. Låt varje svar trigga en omedelbar, synlig systemrespons. Undvik "tack för din check-in, baseline byggs"-meddelanden.

### 7.4 "Efter 14–30 dagar har systemet tillräcklig baseline"

**Forsynes största UX-skuld.** Detta är precis den period då abandonment-forskningen visar att användaren tappas. Dag 5–14 är en tillitszon. Systemet kan ännu inte leverera sitt kärnvärde, men har redan tagit daglig input.

**Rekommendation:** designa dag 3, 7, 14 som explicita "milestone-events" där systemet över-levererar (även om datan är tunn).

### 7.5 "Användaren lägger in sina träningsmål"

Marknadsbeprövat. Håll till 1–3 val.

### 7.6 "Loggar lite mat (inte allt, bara det som betyder något)"

**Hypotes, delvis motbevisad.** Selektiv matlogging har lägre compliance än total eller ingen. Mellanläget kräver att användaren vet vad som betyder något, vilket de ofta inte vet.

**Rekommendation:** antingen (a) ingen matlogging, eller (b) specifik triggerlogging ("logga måltid X efter träning Y").

### 7.7 "Sen tar systemet över — morgonbriefing, chat, varsel 72 h"

**Detta är produktens värde-tes. Inte marknadsbeprövat — Forsyne-unikt.**

- Morgonbriefing: Oura och Whoop gör detta. Retention-positivt.
- Chat med data: nyare trend. Intuitivt attraktivt men lätt att över-lova.
- 72 h-varsel: *Inget konsumentprodukt har offentligt demonstrerat detta.* Det är Forsynes moat om det faktiskt fungerar. Det är också den största tekniska risken.

---

## 8. Framtidsspaning 2026–2029

### 8.1 Plattformsaktörernas troliga moves

**Apple**: Health+ sannolik lansering 2026–2027. Troligt innehåll: retrospektiv analys + lightweight prediktion. Troligen *inte*: cross-device, djup lab-integration, verklig agentic prediktion.

**Samsung**: Galaxy Ring-lansering 2024 är en Oura-efterföljare men utan tolknings-layer.

**Google**: erbjuder sannolikt AI-tolkning via Gemini men utan den smala fokusen som krävs för prediktion.

**Kortsiktigt (2026–2027):** alla tre kommer validera kategorin "AI tolkar din hälsa", vilket är *bra* för Forsyne — mainstream-awareness ökar.

### 8.2 CGM-mainstreaming

Dexcom Stelo (2024 non-prescription) och Abbott Lingo har öppnat consumer-CGM. Forsyne bör ha en CGM-integrations-strategi innan 2027, inte efter.

### 8.3 "Health OS"-tesen

Dominerande branschteori: en aktör samlar all data. Apple är favorit. Realistiskt: Apple blir dominant för majoriteten, men en långsvans av specialiserade djup-plattformar existerar parallellt.

**Forsynes långsiktiga position:** *inte* Health OS-konkurrent. Snarare *"the analytical layer on top of Health OS"*. Om Forsyne kräver "bypass Apple Health", är det strukturellt dött.

### 8.4 Kommer Forsyne vara standalone 2029?

**Hypotes, inte evidens:** nej, inte som standalone i nuvarande form. Men ja, som del av en större stack:
- (a) Förvärvat av plattformsaktör: 30–40 %
- (b) Pivotera till B2B: 20–30 %
- (c) Lifestyle-business med 5–20 k svenska power-users: 30–40 %

---

## 9. Konkreta UX-rekommendationer

Rankade efter förväntad impact på retention och konvertering.

### 9.1 Behandla dagarna 3–21 som en separat produkt

Viktigaste rekommendationen. Ingen väntar. Bygg explicit "learning phase UX" där varje dag har en egen milstolpe. Dag 3 "systemet börjar se dina rytmer", dag 7 "första mönsterhypoteserna", dag 14 "din första personliga prediktion".

### 9.2 Gör check-in värdeladdad från sekund 1

Varje check-in måste ge omedelbar respons — inte "data sparad" utan "här är vad vi redan ser". Även om insikten är enkel tidigt, är responsens förekomst retention-avgörande.

### 9.3 Prissätt uppåt, inte nedåt

3 000–4 500 SEK/år är i linje med Function/Superpower. 1 495 SEK riskerar positionerings-dissonans ("billigare = mindre seriöst") och gör enhetsekonomin svår.

### 9.4 Ta bort matlogging helt från MVP

Om maten är "lite, bara det som betyder något" är den UX-friktionell. Ta bort den. Lägg in det senare om Aktivitus-piloten visar att specifika måltider är prediktivt avgörande.

### 9.5 Positionera en primär wearable-integration

Välj Garmin som primär (största svenska endurance-population). Oura/Apple Health som sekundära. Whoop senare.

### 9.6 Använd naturligt språk i check-in istället för knappar

Voice eller textinput ("hur mår du idag?") känns 2026 mer naturligt än Whoop-stil knappval. Sänker psykologisk friktion.

### 9.7 Gör "72h-varslet" till North Star-metric

Kandidat: *andel användare som fått minst ett korrekt 72 h-varsel under sina första 60 dagar*. Det enda måttet som validerar produktens kärntes.

### 9.8 Designa "lapsed user"-återaktivering från dag 0

Dag 7 utan öppning: skicka inte "vi saknar dig"-notis. Skicka "vi märkte att din HRV förändrades igår — vill du se varför?" Använd passiv wearable-data som reason-to-return.

### 9.9 Gör AI-insikter citatbara, inte bara läsbara

Forsyne-insikter som känns "hur visste det?" är delbar content. Designa "share card"-funktion.

### 9.10 Skydda "medvetna val"-känslan

IKEA-effekten är verklig. Låt användaren aktivt välja att gå från "manuell" till "automatisk" mode efter dag 30. Det ökar commitment.

### 9.11 Publicera baselinetröskeln transparent

"Vi behöver ca 14 dagars data för att börja predicera, 30 dagar för skarp prediktion. Här är hur du följer framstegen."

### 9.12 Separera produkten från personligheten i onboarding

Bryt ner 10–15 min till: 3 min grundläggande data (måste), 7 min djup (valfritt). Låt användaren välja. Default bias gör att många väljer default — se till att default är minimum, inte maximum.

---

## 10. Den ärliga sammanfattningen

Forsynes kärntes — att folk vill ha ett system som förklarar utan att krävas mycket av dem — är rätt i riktning men fel i antagande om *vilka* som vill ha detta och *hur mycket* de tål.

**Evidensen säger:**
- En smal premium-grupp (några tusen i Sverige, några hundra tusen globalt) betalar och stannar kvar för denna typ av produkt.
- De vill ha mycket mindre aktivt engagement än Forsyne planerar.
- De vill ha tydlig, snabb avkastning på varje minut de investerar.
- De är redan engagerade i Oura/Whoop/Garmin och byter inte lätt.

**Det som *inte* är bevisat av marknaden idag:**
- Att 15-sek-check-in får hög compliance över 60 dagar.
- Att 72 h-prediktion är accurate nog att vara minnesvärd.
- Att svenska endurance-användare betalar 1 495 SEK/år för ytterligare ett verktyg ovanpå sina befintliga.

**Det som *är* i Carls fördel:**
- Marknaden för premium-hälso-AI växer, inte krymper.
- Incumbenterna kan strukturellt inte leverera cross-domain prediktion.
- Aktivitus-piloten är en nära-ideal testmiljö för att validera prediktionsträffsäkerhet.
- Agentic AI-trenden ger kulturellt momentum.

**Carls mest värdefulla nästa steg är inte UX-förfining.** Det är att bevisa, i Aktivitus-piloten, att 72 h-prediktionen *faktiskt håller empiriskt*. Om den gör det, blir allt annat hanterbart. Om den inte gör det, är ingen UX-optimering räddning.

**Forsyne löser inte ett problem som konsumenter beskriver med ord. Den löser ett mönster de känner men inte artikulerar.** Det är både produktens styrka (få konkurrenter) och dess största go-to-market-utmaning (de kan inte söka efter den).

---

## Källor och osäkerhet

**Robust källgrund:**
- Epstein, D.A. et al. (2015, 2016, 2020) "A lived informatics model of personal informatics" — Ubicomp och JMIR
- Piwek, L. et al. (2016) "The Rise of Consumer Health Wearables" — PLOS Medicine
- Endeavour Partners (2014) "Inside Wearables"
- PwC Health Research Institute (2016) Consumer Wearables Study
- Thaler & Sunstein *Nudge* (2008)
- Turner-McGrievy et al. (2013–2019) JMIR, self-monitoring
- First Round Review, Superhuman PMF (2018)
- Function Health bolagsdata (2023–2024)
- Oura bolagsdata (Tom Hale 2023)

**Anekdotiskt eller bolagssjälvrapporterat (flaggat):**
- Oura retention 70–85 % (community-sentiment)
- Whoop Journal compliance 10–30 % (power-user-forum)
- Function Health 95 %+ förnyelse (bolagsdata, ej tredjepartsvaliderad)
- Svensk TAM 30–150 k (egen uppskattning)

**Helt spekulativt (flaggat):**
- Forsynes 2029-scenario (uppköp/B2B/lifestyle-fördelning)
- Apple Health+ exakta innehåll
- Granola-retention specifikt

---

**Rapportens viktigaste påminnelse:** marknaden vill ha mindre ansträngning än Forsyne planerar. Men marknaden vill också ha mer djup än Oura kan leverera. Gapet däremellan är Forsynes verkliga yta. Det är smalt — men det existerar.

---

*Rapport kompilerad 2026-04-19. Kompletterar STRATEGY.md (fokus: överlevnadsrisker) med fokus på: är marknaden verklig för exakt Forsynes flöde?*
