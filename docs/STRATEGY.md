# Forsyne — lärdomar från startup-graveyarden

*Strategisk rapport för Carl, april 2026. Återvänd varje vecka under piloten.*

---

## 1. Exekutiv sammanfattning

- **Den vanligaste dödsorsaken är inte konkurrens utan irrelevans.** CB Insights analys av 110+ post-mortems visar att "no market need" är skäl nummer ett (~35–42 % av fallen). Forsynes största risk är inte Garmin eller Apple, det är att 100 betalande svenskar inte räcker för att validera att prediktion är ett *problem värt att betala för*, inte bara en teknisk möjlighet.
- **Sherlocking är överdrivet som hot, undervärderat som tidsfönster.** Tile, MyFitnessPal och Fitbit överlevde alla Apples direkta attacker i flera år. Men den som inte använde tidsfönstret till att bygga moat (nätverk, djup, data-kompoundering) blev reducerad till feature eller uppköp.
- **Innovator's Dilemma gäller inte automatiskt.** Christensens teori förutsätter att disrupter attackerar nerifrån på pris/enkelhet. Forsyne attackerar uppifrån (premium, djupare data). Det är en annan mekanism — "jobs-to-be-done mot underserved power users" — och den har egna risker (liten TAM, svårt att bredda).
- **Pilot-till-betalande är den farligaste övergången.** Forskning på B2B SaaS (Gartner, OpenView) antyder pilot-konverteringstal på 30–50 % när piloten är betald, betydligt lägre för gratispiloter. Aktivitus-piloten måste designas för konvertering, inte för feedback.
- **Solo-grundare + hälsodata + prenumeration + svensk marknad = fyra svaga signaler samtidigt.** Ingen enskild faktor dödar, men kombinationen kräver att Carl explicit kompenserar varje axel (co-founder/advisor, GDPR-rutin, churn-mätning, expansion-plan mot EU).

---

## 2. Varför startups dör

### 2.1 Ingen riktig marknad ("No market need")

**Mönstret:** Produkten löser ett problem som existerar men som användare inte är villiga att betala för, eller där smärtan är för låg för byte.

**Case:** Juicero (2013–2017) byggde en $400 juicepress för färdigförpackade påsar — Bloomberg visade att påsarna kunde pressas för hand lika bra ([Bloomberg, april 2017](https://www.bloomberg.com/news/features/2017-04-19/silicon-valley-s-400-juicer-may-be-feeling-the-squeeze)). $120M i VC brändes. Företaget stängde fyra månader senare.

**Data:** CB Insights "Top 12 Reasons Startups Fail" (2021-rapporten, baserad på 110+ post-mortems) anger 35 % för "no market need" — den största enskilda kategorin ([CB Insights, 2021](https://www.cbinsights.com/research/startup-failure-reasons-top/)).

**För Forsyne:** Att serious endurance athletes *har* Garmin/Whoop/Oura betyder att de värderar data. Det betyder inte att de värderar *prediktion* tillräckligt för 1 495 SEK/år utöver sina befintliga prenumerationer. Hypotes att testa: är "jag kraschar ibland oväntat" ett medvetet, artikulerbart problem hos målgruppen, eller är det något Carl ser men de inte gör?

**Varningssignal:** Pilotanvändare som är nyfikna men inte återvänder till appen efter vecka 2. Retention > engagement > akvisition i den här ordningen.

### 2.2 Slut på pengar / feljusterad burn

**Mönstret:** Företag skalar säljet eller teamet innan enhetsekonomin fungerar.

**Case:** Quibi (2018–2020) brände $1,75B på 6 månader innan de stängde — de skalade marknadsföring och innehåll innan de validerat att någon ville ha kort mobilt premiuminnehåll ([Wall Street Journal, oktober 2020](https://www.wsj.com/articles/quibi-is-shutting-down-barely-six-months-after-going-live-11603385316)).

**Data:** CB Insights anger "ran out of cash / failed to raise new capital" som näst vanligast (~38 % — kategorier överlappar).

**För Forsyne:** Som solo-grundare, pre-revenue, är detta mindre akut *idag* men blir kritiskt när Carl överväger att ta in kapital eller anställa. Varje rekrytering innan 1 000 betalande användare är en risk.

**Varningssignal:** Frestelse att öka Google Ads/Meta-spend för att "nå 100 användare i tid". Om betald akvisition kostar > 50 % av LTV (1 495 SEK × förväntad livslängd), är enhetsekonomin trasig.

### 2.3 Fel team / fel grundarkomposition

**Mönstret:** Solo-grundare eller obalanserade team misslyckas oftare än balanserade team. Noam Wassermans *The Founder's Dilemmas* (Princeton, 2012) dokumenterar att 65 % av startups misslyckas pga co-founder conflict — men solo-grundare har lägre genomsnittlig exit-värdering.

**Case:** Wassermans data från 10 000+ grundare: solo-ledda bolag reser mindre kapital och når lägre värderingar i genomsnitt, även kontrollerat för sektor.

**För Forsyne:** Detta är **Carls mest undervärderade risk**. Inte för att solo är omöjligt (DHH/Basecamp, Pieter Levels, Tobias Lütke initialt) utan för att det begränsar vad en person kan göra väl samtidigt (produkt + sälj + support + sjukvårdsregulatoriskt + community).

**Varningssignal:** Veckor där support och akvisition trängs ut av produktarbete, eller omvänt. Om Carl känner att han "borde" göra tre saker samma vecka men bara hinner en.

### 2.4 Produkten är bra men distributionen är olöst

**Mönstret:** Grundare med teknisk bakgrund underinvesterar i go-to-market och antar att produkten säljer sig själv.

**Case:** Wesabe (2005–2010) hade bättre produkt än Mint enligt grundaren Marc Hedlunds egen post-mortem — men Mint löste onboarding och datasynk smidigare och vann ([Marc Hedlund, 2010](https://web.archive.org/web/20110510114144/http://blog.precipice.org/why-wesabe-lost-to-mint)). Mints lärdom: "users don't care if your philosophy is right, they care if it works on Tuesday."

**För Forsyne:** Teknisk differentiering (cross-domain prediktion) är bara värdefull om målgruppen kan *förstå* den utan att Carl förklarar. Om säljargumentet kräver 10 minuters utläggning är det distributionsdött.

**Varningssignal:** Att Carl måste förklara varför Forsyne är bättre än Garmin HRV-status när han träffar en potentiell användare. Om värdet inte är synligt i en screenshot eller en mening är positioneringen fel.

### 2.5 Prissättning fel (för lågt eller för högt)

**Mönstret:** Konsumentprenumerationer under 10 USD/månad tvingar fram volym som kräver betald akvisition som kräver volym. Dödsspiral.

**Case:** Många mindfulness-appar (inte Calm/Headspace) har försökt 5–7 USD/månad och hamnat i iOS-search-ads-dödsspiralen. Patrick Campbell/ProfitWell har dokumenterat detta upprepat ([ProfitWell-data, 2019–2022](https://www.profitwell.com/)).

**För Forsyne:** 1 495 SEK/år = ~125 SEK/månad = ~12 USD. Högre än Strava Premium (~10 USD) men lägre än Whoop (~30 USD). Rimligt band, men det finns ett strategiskt val: gå till 2 500–3 500 SEK och positionera som "coach-ersättning" till de översta 10 % av seriösa atleter, eller gå till 495 SEK/år och accepterad lägre prediktionsdjup.

**Varningssignal:** Högre churn än 5 %/månad på konsumentsidan är svårt att överleva utan massiv akvisition.

### 2.6 Premature scaling

**Startup Genome Report (2011, Blank/Marmer)** analyserade 3 200 startups: 70 % av failed startups hade skalat prematurt i minst en dimension (team, kundakvisition, produktfunktioner) innan PMF ([Startup Genome Report, 2011](https://startupgenome.com/)).

**Case:** Color Labs (2011) reste $41M pre-launch baserat på grundarnas track record, skalade team till 30+, stängde 2012 utan PMF.

**För Forsyne:** Frestelse att gå från 100 svenska till "europeisk launch" innan svensk kohort visar retention > 70 % efter 3 månader.

**Varningssignal:** Planering för internationell expansion innan svensk månatlig aktiv användning nått stabil platå.

### 2.7 Regulatorisk/juridisk överraskning (hälsodata-specifikt)

**Mönstret:** Hälso-adjacenta produkter snubblar över MDR (EU 2017/745) eller GDPR artikel 9 (känslig data).

**Case:** 23andMe fick FDA cease-and-desist november 2013 som stoppade deras health reports i USA i nästan två år ([FDA Warning Letter, 22 nov 2013](https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/23andme-inc-11222013)). Det var den största enskilda händelsen som skadade deras marknadsposition.

**För Forsyne:** Prediktion av "illness" ligger nära medicinsk gräns. I EU är Medical Device Regulation (MDR) tydlig: om produkten gör diagnostiska eller prognostiska påståenden kan den klassas som medical device. Wellness-framing ("training readiness") är säkrare än medical-framing ("infection probability").

**Varningssignal:** Copy i appen eller marknadsföring som säger "predict illness", "detect infection", "medical-grade". Byt till "stress load", "readiness risk", "recovery debt".

### 2.8 Plattformsberoende-kollaps

**Mönstret:** Bygger ovanpå API som stängs eller ändrar villkor.

**Case:** Zynga-beroendet av Facebook (2009–2013) när Facebook ändrade app-integrationen. Många Twitter-klient-startups (Tweetie, Twitterrific i ursprunglig form) när Twitter stängde API 2012.

**För Forsyne:** Garmin Connect IQ, Oura API, Whoop Developer Platform är alla tredjepartsberoenden. Om någon stänger eller prissätter om kan datatillgången dö över en natt.

**Varningssignal:** Om en enskild datakälla (säg Garmin) utgör > 60 % av användarbasen blir Forsyne sårbart. Diversifiera tidigt, och bygg eventuellt eget BLE-lager som fallback.

---

## 3. Hur små aktörer slår stora

### 3.1 Djup i en smal nisch som incumbenten inte kan försvara

**Case: Figma vs Adobe XD.** Adobe XD lanserades 2016 med Adobes hela distributionsapparat. Figma vann genom att vara browser-native och multiplayer-first — Adobe kunde inte kopiera multiplayer utan att omarkitektera hela Creative Cloud. Resultat: Adobe försökte köpa Figma för $20B 2022 (avbröts av regulatorer 2023).

**Varför incumbenten inte kunde kopiera:** Adobes affärsmodell (desktop-licens + creative cloud) var strukturellt fientlig mot browser-native kollaboration. Varje försök skadade befintlig intäkt.

**För Forsyne:** Garmin/Whoop kan inte enkelt leverera *cross-domain* prediktion utan att ta in lab-data, subjective check-ins, och blod. Det skulle kräva partnerskap (svårt) eller egen lab-infrastruktur (dyrt och off-brand). Det är Forsynes strukturella fördel — men bara om lab-integration faktiskt blir en moat, inte bara en feature.

### 3.2 Opinionated defaults / en åsikt om hur jobbet ska göras

**Case: Linear vs Jira.** Linear valde radikalt färre alternativ, keyboard-first, snabbt UI. Jira försöker vara allt för alla. Linear når topp-teams som tidigare var tvungna att använda Jira.

**Varför Atlassian inte kan kopiera:** Jiras intäktsmodell bygger på configurability för stora kunder. Att göra Jira opinionated skulle alienera dem.

**För Forsyne:** Garmin Connect visar ALLT (sömn-score, body battery, stress, HRV status, training readiness, race predictor...). Forsyne kan vinna genom att visa *en siffra*: "Din nästa 48h risk." Radikal reduktion är en moat eftersom Garmin aldrig kan ta bort features utan kundbortfall.

### 3.3 Brand / distinktiv estetik

**Case: Liquid Death (vatten i ölburkar).** Lanserade 2019, nådde $1,4B värdering 2024. Vanligt mineralvatten, men brand som är åtråvärd bland en specifik subkultur (straight-edge, punk, anti-alkohol).

**Varför Coca-Cola/Nestlé inte kan kopiera:** De kan lansera en produkt, men de kan inte äga en anti-corporate estetik. Det är strukturellt omöjligt.

**För Forsyne:** Svenska endurance-kulturen har estetik (Vasaloppet, Gotland Runt, Ironman Kalmar) som Apple och Whoop inte kan äga trovärdigt. En Forsyne som känns *specifikt svensk/nordisk endurance* har en positioneringsfördel som är osv för amerikanska plattformar.

### 3.4 Community / användarna är produkten

**Case: Strava.** Strava är teknik-mässigt enkel. Moat är att alla dina löparkompisar är där. Garmin Connect har bättre data men saknar social energi.

**För Forsyne:** Om prediktioner kan delas/jämföras med tränarens eller träningspartnerns (med samtycke) skapas ett nätverk. Risk: Forsyne är djupt personligt, community-fit är oklar. Detta är mer hypotes än bevis.

### 3.5 Hastighet / iterationstakt

**Case: Superhuman vs Gmail.** Superhuman har mindre team än ett Gmail-underlag, men iterationshastighet är ojämnförligt högre. De gjorde Rahul Vohras PMF-survey till metod ([First Round Review, 2018](https://review.firstround.com/how-superhuman-built-an-engine-to-find-product-market-fit/)).

**För Forsyne:** Solo-grundare + Stockholm-baserat + inga möten = potentiellt högre iterationstakt än Whoop (Boston, 600+ anställda). Det är en fördel *idag* men eroderar när teamet växer.

### 3.6 Prissättningsinnovation (inte nödvändigtvis billigare)

**Case: Whoop vs Garmin.** Whoop tog den dyrare vägen (prenumeration som inkluderar hårdvara, ingen förköp) och lyckades mot Garmin trots att hårdvaran var sämre specifikt. Prissättningsmodellen var moat.

**För Forsyne:** Prova paketering: "Forsyne Pro" inkluderar 2 blodprover/år via Aktivitus-partnerskap för 4 500 SEK/år. Det blir en bundle Apple/Whoop strukturellt inte kan matcha.

### 3.7 Distributionskanal som är osvmåtbar för incumbenten

**Case: Glossier.** Byggt på Emily Weiss blogg Into the Gloss och Instagram, inte på retail. L'Oréal kunde inte kopiera eftersom deras retail-distribution var deras affär.

**För Forsyne:** Aktivitus-piloten är exakt denna typ av kanal. Sportvetenskapslab är en distributionskanal som Garmin/Apple inte kan använda trovärdigt. Om Forsyne blir *the recommended tool* från svenska tränare och sportvetenskapliga labb är det en moat som inte kan köpas via Apple Search Ads.

---

## 4. Kategorispecifika fallgropar (hälso-tech och consumer AI)

### 4.1 Zeo-graveyarden: bra teknik, dålig retention

Zeo (2003–2012) var första konsumentvänliga sömnspårningen. De mätte mer exakt än någon wearable gör idag. Företaget stängde 2012. **Lärdom:** noggrannhet är ingen moat när retention är låg. Användare slutade bära pannbandet efter 2–3 veckor när nyhetsvärdet försvann ([Gizmodo, 2013](https://gizmodo.com/the-end-of-zeo-whats-left-for-self-trackers-5982469)).

**För Forsyne:** Prediktion måste leda till *handling*. Om användaren inte kan göra något annorlunda utifrån prediktionen blir appen feedback-trött. Varje prediktion måste ha en koppling till "så vad gör jag idag?"

### 4.2 Quantified Self-paradoxen

Många QS-appar (Fitocracy, Moves, Saga) misslyckades trots engagerade tidiga användare. Massmarknaden är inte QS-personer. **Lärdom (Nir Eyal, Hooked):** om produkten kräver 20-minuters daglig engagement för full nytta, förlorar du 95 % av marknaden.

**För Forsyne:** Subjektiv check-in är en retention-risk. Gör den < 15 sekunder eller automatisera den via kontextuella signaler (tid på dygnet, HRV-förändring).

### 4.3 AI-wellness-hypen 2022–2024

Många "AI coach" appar fick seed-finansiering 2022–2023 och stängde 2024–2025 när GPT-wrappers blev commodity. Flera nämnda i [Dead Startups](https://deadstartups.com/) och [Layoffs.fyi](https://layoffs.fyi/) men jag är osäker på specifika namn och undviker att gissa.

**Generellt mönster:** användare betalade inte för "AI coach" när ChatGPT gratis var nära. Differentieringen var för tunn.

**För Forsyne:** Prediktion är svårare än coaching. GPT-wrappers kan inte leverera prediktiv modell på personliga baselines utan Forsynes datapipeline. Det är försvarligt — men Carl måste kunna artikulera varför på 10 sekunder.

### 4.4 Theranos-skuggan

Theranos var bedrägeri, men skadade kategorin "blood testing startups" i över ett decennium. Varje hälsoteknik-startup som använder ordet "prediktion" hamnar i skuggan.

**För Forsyne:** Var paranoid med accuracy-påståenden. Undvik specifika procentsatser ("vi förutsäger 94 % av illness-episoder") tills de är validerade i peer-reviewed-studie. Aktivitus-piloten är perfekt för att producera sådan validering.

### 4.5 Peloton-lektionen: hårdvara-beroende, överinvestering

Peloton nådde $50B market cap 2021, $1,5B 2024 ([Bloomberg](https://www.bloomberg.com/)). Byggde för pandemi-efterfrågan och kunde inte justera. **Lärdom:** hårdvarumarginaler är hårdvarumarginaler, mjukvara är mjukvara, blanda inte.

**För Forsyne:** Undvik att sälja egen hårdvara. Plattformsberoende är illa, hårdvaruskulder är värre.

---

## 5. Apple-hotet (Health+ juni 2026)

### Historisk precedent

**MyFitnessPal:** Under Bought av Under Armour 2015 för $475M, såld till Francisco Partners 2020 för $345M. Apple Health och Google Fit försvagade men dödade inte. Moat: databas över kaloriinnehåll som var crowd-sourced över 10 år. **Lärdom:** data-compounding överlever plattformshot.

**Fitbit:** Ledde kategorin 2014–2017, blev reducerad till feature när Apple Watch skalade. Såld till Google 2019 för $2,1B ([Reuters, 2019](https://www.reuters.com/)). **Lärdom:** om din moat är hårdvaruform-faktor och Apple släpper en bättre, dör du.

**Tile:** Apple lanserade AirTag april 2021. Tile finns fortfarande men växer långsamt. **Lärdom:** Apple-killers är sällan instant dödsstötar, men de låser tillväxttak.

### Troligt Apple Health+-scenario

Om Apple släpper Health+ på WWDC juni 2026, kommer det sannolikt:
- Innehålla retrospektiva metrics + lightweight prediktion
- Vara bundled med iCloud+ eller Apple One
- Sakna lab-integration (strukturellt fientligt för Apple att hantera tredjepartsblod)
- Sakna cross-platform (Garmin-användare exkluderade)

**Detta är Forsynes strategiska fönster.** Apple kommer att validera kategorin men inte döda Forsyne om Forsyne:

1. **Är plattforms-agnostisk (Garmin + Oura + Whoop).** Apple stödjer inte Garmin.
2. **Äger lab-partnerskapet (Aktivitus + eventuella fler).** Apple kan inte replikera sjukvårdsinfrastruktur.
3. **Går djupare i endurance-nischen (maraton, triatlon, skidåkning).** Apple måste gå bredd.
4. **Positionerar om direkt efter WWDC** ("Apple Health + Forsyne: the depth layer" eller liknande).

**Hypotes, inte bevis:** Apple-lansering kan öka Forsynes användarintresse (kategorivalidering) innan den äter marknaden, givet 6–12 månaders fönster.

---

## 6. Tidiga varningssignaler för Carl (nästa 90 dagar)

### 6.1 Aktivitus-pilotens dag-30-retention < 60 %

**Detektion:** Mät DAU/WAU/MAU från dag 1. Om 40+ % av piloten inte öppnat appen på vecka 4, är det inte en "engagement issue" — det är att prediktionen inte är actionable nog.

**Respons:** Intervjua 10 icke-återvändande användare personligen. Fråga inte "varför slutade du" utan "vad använder du istället för det här problemet?"

### 6.2 Användare säger "wow, coolt" men betalar inte

**Detektion:** När pilotens gratis-period slutar, mät konvertering till betalande. Under 20 % är en röd flagga.

**Respons:** Det är inte prissättning. Det är att upplevt värde är lägre än 1 495 SEK. Antingen höj upplevt värde (fler actionable rekommendationer, coach-delning) eller ompaketera (bundle med blodprov).

### 6.3 Carl förklarar produkten fortfarande i första meningen

**Detektion:** Skriv ner Carls 10 senaste pitcher till potentiella användare. Om de är olika, är positioneringen inte klar.

**Respons:** Tvinga fram en mening. "Forsyne förutsäger när du kommer krascha." Om den meningen inte säljer är produkten inte positionerad för självförsäljning.

### 6.4 GDPR/MDR-frågor dyker upp från användare eller Aktivitus-jurister

**Detektion:** Om någon frågar "är det här medicinsk utrustning?" är det en varning att språket lutar för nära medicinskt.

**Respons:** Konsultera en svensk MedTech-jurist (Setterwalls, Vinge, eller specialistbyråer) innan juli 2026. Kostnad: 20–50 kSEK. Billigare än post-hoc.

### 6.5 Feature creep från pilotfeedback

**Detektion:** Om Carls backlog växer med > 3 nya features/vecka baserat på pilotfeedback är det överlyssning.

**Respons:** Pilotfeedback ska främst avslöja om *kärnhypotesen* (prediktion betalas för) håller. Featurerequests är signaler att användaren inte är evangelist — de är konsulter.

### 6.6 Carl känner sig "för upptagen för att sälja"

**Detektion:** Veckor där < 20 % av tiden går till användarakvisition eller pilot-management.

**Respons:** Detta är det klassiska "teknisk solo-grundare"-mönstret. Block kalendertid till sälj/support, skydda den som produkttid.

### 6.7 Apple WWDC-annonsering triggar panik-pivot

**Detektion:** Efter 10 juni 2026, om Carl börjar omplanera roadmap inom 72 timmar efter keynote.

**Respons:** Vänta 4 veckor. De flesta Apple-annonseringar är mindre disruptiva än de ser ut första dagen. Samla data på faktiska Apple Health+-features innan responsändring.

---

## 7. Konkreta rekommendationer (rankade)

1. **Gör Aktivitus-piloten betald (även symboliskt, 500 SEK/deltagare) från dag 1.** Gratispiloter konverterar sämre. Betald = seriös signal, och det testar prissättningselasticitet tidigt.

2. **Definiera en enda North Star-metric före 1 maj 2026.** Kandidater: "andel prediktioner som användare agerar på" eller "veckolig aktiv användning efter dag 30". Allt annat är brus.

3. **Kör Rahul Vohras PMF-survey (40 %-regeln) efter 30 dagar.** Fråga: "Hur skulle du känna om Forsyne försvann?" — % "very disappointed" under 40 % = ingen PMF ännu ([Superhuman case study, First Round](https://review.firstround.com/how-superhuman-built-an-engine-to-find-product-market-fit/)).

4. **Konsultera MedTech-jurist före juli 2026.** Språkliga justeringar i app och marknadsföring är billigare nu än efter att FI/Läkemedelsverket hör av sig.

5. **Bygg datalager-moat: varje användare som lämnar måste bli dataförlust.** Longitudinell personlig baseline efter 6 månader ska vara så värdefull att migrering till Apple Health+ = värdeförlust.

6. **Hitta en teknisk-operativ rådgivare (inte co-founder ännu).** Någon som har skalat svensk consumer health-tech — t.ex. någon från Natural Cycles, Kry, Flo. Köp 2 h/månad för rådgivning. Kostnad: låg, värde: hög.

7. **Positionera produkten för den översta 10 %, inte bredd.** Högre pris, smalare målgrupp, djupare retention. 2 500–3 500 SEK/år till ultrarun/triathlon-segmentet är troligen mer försvarbart än 1 495 SEK till "seriösa motionärer".

8. **Planera en post-WWDC-kommunikation redan i maj 2026.** Två versioner: "Apple gick in i kategorin, här är varför Forsyne är komplementär" respektive "Apple gick inte in". Publicera en inom 48 h efter keynote.

9. **Sätt cap på produktutveckling till max 50 % av veckan från pilotstart.** Resten är sälj, support, och skriva/tala om Forsyne publikt (ägd distribution).

10. **Dokumentera varje user interview under pilot offentligt (anonymiserat).** Skapar content-moat och tvingar Carl att lyssna systematiskt, inte selektivt.

11. **Undvik betald akvisition tills organisk retention > 70 % efter 3 månader.** Betald akvisition på en otät hink dränerar kassan.

12. **Sätt ett explicit "kill criterion".** Om 100 svenska betalande inte nåtts till 1 september 2026, vad gör Carl? Beslutet är lättare nu än i panik senare.

---

## Källor och osäkerhet

- CB Insights, "The Top 12 Reasons Startups Fail" (2021) — robust
- Startup Genome Report (Blank/Marmer 2011) — äldre, men nätmetodologin är bra
- Wasserman, *The Founder's Dilemmas* (2012) — akademiskt robust
- Marc Hedlund, "Why Wesabe Lost to Mint" (2010) — primärkälla
- FDA Warning Letter till 23andMe (22 nov 2013) — primärkälla
- First Round Review om Superhuman/Vohra PMF (2018) — sekundärkälla, men väldokumenterad
- Bloomberg om Juicero (april 2017) och Peloton — etablerad affärsjournalistik

**Osäkert:** specifika procentsatser för pilot-till-betalande-konvertering i consumer health (benchmarks varierar kraftigt), exakt effekt på MyFitnessPal/Fitbit från Apple Health (flera faktorer samverkade), och AI-wellness-appars specifika namn 2022–2025. Där har jag medvetet hållit språket hypotes-baserat.

---

## Rapportens viktigaste påminnelse

Forsyne kan dö av tio olika skäl, men bara ett ska egentligen oroa Carl denna månad —

*kommer pilotanvändarna betala efter månad 2?*

Allt annat är andrahandsfrågor tills det är besvarat.

---

*Rapport kompilerad 2026-04-19. Återvänd varje vecka under piloten och jämför beslut mot varningssignaler i sektion 6.*
