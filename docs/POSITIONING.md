# Forsyne — Positionering

*Fastslagen 2026-04-19 efter syntes av MARKET.md + RETENTION-RESEARCH.md + STRATEGY.md.*

---

## Den ena meningen

**Forsyne är intelligenslagret över din befintliga träningstack — inte en ny destination.**

---

## Vad det betyder

Varje etablerad hälso- eller träningstjänst löser ETT jobb väl:

- **Garmin** — hårdvara, passiv datainsamling, ekosystem av sensorer
- **Strava** — social layer, segments, atlet-community
- **TrainingPeaks** — coach-atlet-arbetsflöde, strukturerade träningsprogram
- **Oura** — sömn, passiv ring-form
- **Whoop** — återhämtningsfokus, dygnet-runt-band
- **Aktivitus / Werlabs / Kry** — professionella tester och blodvärden

Ingen av dem läser sammanhanget **över** silorna. Det är där vi står.

---

## Den strategiska konsekvensen

### Vi konkurrerar inte mot dessa tjänster. Vi behöver dem.

Ju mer användaren redan investerat i Garmin/Strava/Oura/Aktivitus, desto mer värdefulla blir vi. Deras dataset är vår råvara. Deras retention-mekanismer (hårdvara, segments, sömnstreaks) håller användaren engagerad i grundvärdena — vi kompletterar utan att behöva replikera.

Det löser retention-handikappet för software-only-produkter (RETENTION-RESEARCH.md):

| Retention-gap | Vi bygger | Vi lånar från ekosystemet |
|---|---|---|
| Hårdvaru-anchor | — | Garmin/Oura/Whoop-klockor |
| Social layer | Valfri delning v2 | Strava, Garmin Connect |
| Streaks / consistency | — | Garmin/Strava befintliga streaks |
| Daglig passiv loop | Morgonbriefing (07:00) | Bygger på wearable-data |
| Proprietär vokabulär | "Varsel", "Baslinje", "Mönstermatchning" | Förstärker vår identitet utan att krocka |

### Vi behöver bara bygga intelligens-lagret. Allt annat kan lånas.

---

## Vad vi gör (och vad andra gör)

```
Andra:
  Mäter → visar siffror → ger generiska etiketter

Forsyne:
  Läser andras mätningar → korsanalyserar → ger dig
  personlig intelligens ingen annan kan ge
```

Garmin Connect visar att din HRV är 38. Forsyne säger *varför* — och vad det betyder *för dig just nu* givet vad sömnen, träningsbelastningen, blodproverna och dina mönster säger tillsammans.

Det är skillnaden mellan data och förståelse.

---

## Positioneringens praktiska regler

1. **Aldrig kompromissa med data-portabilitet.** Användare ska kunna ta med sig sin data. Vår moat är intelligensen, inte inlåsningen.
2. **Aldrig konkurrera om hårdvara.** Vi säljer aldrig en klocka. Vi gör aldrig egen sensor.
3. **Aldrig bygga eget socialt nätverk.** Strava, Garmin Connect finns. Vi kan däremot stödja *delning till* dem.
4. **Integrationer är distribution.** Varje ny wearable vi stödjer = ny publik. Prioritera brett stöd (Garmin, Oura, Whoop, Apple Health, Polar, Coros) över djup i en.
5. **Expert-tjänster är partners, inte konkurrenter.** Aktivitus, Werlabs, Cerascreen — de gör tester, vi integrerar resultaten. Vinna-vinna.

---

## Positionering i en pitch

**Till en atlet:**
> "Du har redan Garmin. Du har kanske ringen, CGM:en, senaste blodprovet från Aktivitus. Forsyne är systemet som läser allt tillsammans — och säger det som ingen enskild app kan."

**Till en potentiell partner (Aktivitus):**
> "Era tester är värdefulla. Men 363 dagar om året ligger resultaten i en PDF. Forsyne gör dem levande — tolkar mot atletens dagliga data, flaggar när något avviker, håller er relevant i atletens dagliga träningsbeslut."

**Till en investerare (om det någonsin blir aktuellt):**
> "Vi är Zapier för hälsa — intelligent lager över en fragmenterad ekosystem. Inte en app som tävlar mot Apple eller Garmin, utan ett datavärde som blir större för varje tjänst som växer."

---

## Vad detta ÄNDRAR

- **Landing-copy:** tona ner "ny hälsoapp", lyft "intelligens över din data"
- **Produkt-roadmap:** varje integration är strategiskt viktigare än varje ny standalone-feature
- **Pitch-tonen:** kommer-med-perspektiv, inte ersättare
- **Metriker:** antal kopplade datakällor per användare blir lead indicator — mer än antalet features använda

## Vad detta INTE ÄNDRAR

- Kärnprodukten (agenter, prediktion, morgonbriefing)
- Tvåtiers-modellen (free Garmin-tolkare + premium full Forsyne)
- Prissättningen (3 000 SEK/år premium)
- Pilot-strategin (Aktivitus först)

---

*Denna fil är den korta, skarpa versionen av Forsynes strategiska positionering. Alla andra strategiska dokument (VISION, STRATEGY, MARKET, RETENTION-RESEARCH, TIERS, IDEA-FRAMEWORK) hänger under denna huvudlinje.*

**Om det du bygger inte hjälper till att förstärka intelligens-lagret över användarens befintliga data — bygg inte det.**
