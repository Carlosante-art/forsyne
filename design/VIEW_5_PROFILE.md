# View 5 — Profile / Body

*The biological baseline behind everything else. Slow-changing, accessed when an insight references it. Lives behind the top-right user icon, not in bottom nav — it doesn't compete for daily attention.*

---

## Purpose — the one question this view answers

> *"Vad är min biologiska baseline — vad är fasta versus variabla i mig?"*

Most days the user never opens this view. That's by design. They open it when:
- An insight on View 4 references "din ferritin från mars" → tap → land here
- They get new bloodwork / DNA results to add
- Onboarding (set initial baseline)
- Quarterly review of biological baseline

If they open it once a quarter and find their biology cleanly organized, it succeeds.

---

## Layout (mobile, max-width 430px, single-column scroll)

```
┌────────────────────────────────────────┐
│ NAV: ‹ Tillbaka  ·  Profil  ·  ⚙       │
├────────────────────────────────────────┤
│                                        │
│  CARL · 28 år · M                      │  ← Identity strip
│  Egenföretagare · Diabetes typ 1       │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  BIOLOGI                                │  ← Section header
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ DNA                       ✓ 23&Me │  │  ← Subsection card
│  │ Senast importerad: 2024-08-12     │  │
│  │ 12 markörer av interest detekterade│  │
│  │ [Se rapport →]                    │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ BLODPROVER              3 senaste │  │
│  │                                   │  │
│  │ 2026-03-14  ·  full panel         │  │
│  │ 2025-11-02  ·  hormoner           │  │
│  │ 2025-06-21  ·  vitaminer          │  │
│  │                                   │  │
│  │ [Ladda upp nytt PDF →]            │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ HORMONER & CGM            Dexcom  │  │
│  │ Glukos-data sedan 2026-04-15      │  │
│  │ 4 dagar sammanställd              │  │
│  │ [Se HRV-cyklustrend →]            │  │
│  └──────────────────────────────────┘  │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  KROPP                                  │  ← Next section
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ Längd       181 cm               │  │
│  │ Vikt        76.4 kg     ↘ -1.2kg │  │
│  │ Body comp   17% fett · 32% muskel│  │
│  │ Senast: 2026-04-12 · Inbody-skann │  │
│  │ [Uppdatera →]                    │  │
│  └──────────────────────────────────┘  │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  BASELINER                              │  ← Section: Forsyne's view of you
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ HRV-baseline       54 ms          │  │
│  │ baserad på 30 d                   │  │
│  │ ↘ sjunkande senaste 7 d           │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ RHR-baseline       58 bpm         │  │
│  │ baserad på 30 d                   │  │
│  │ ↗ +2 bpm vs 90d                   │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ Sömn-baseline      6h47           │  │
│  │ regularitet ±43 min               │  │
│  │ → stabil                          │  │
│  └──────────────────────────────────┘  │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  KRONISKA TILLSTÅND                     │
│                                        │
│  • Diabetes typ 1 (sedan 2018)         │
│  • [+ Lägg till]                       │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  KÄLLOR                                 │
│                                        │
│  ✓ Garmin Vivosmart       senast nu   │
│  ✓ Dexcom G7              4 d sedan   │
│  ─ Apple Health           ej kopplad  │
│  ─ Strava                 ej kopplad  │
│                                        │
│  [Hantera integrationer →]             │
│                                        │
├────────────────────────────────────────┤
│  Today  Trends  Check-in  Insights     │
└────────────────────────────────────────┘
```

---

## Components — data, behavior, interaction

### Identity strip (top)

**Static, minimal.** Name, age, sex, occupation, chronic conditions in 2 lines.

**Visual:** No card border. Just text on background.

**Tap:** opens identity edit form (modal): name, age, sex, occupation, conditions.

**Why this exists:** the agent needs context — diabetes, age, sex influence interpretation of every other metric. Surface as the FIRST thing on Profile so user knows the AI knows.

### Section: Biologi

Three subsections, each as its own card:

**DNA card:**
- Status: ✓ imported (with source: 23andMe / AncestryDNA / etc.) or `Lägg till →`
- Last imported date
- "X markers of interest detected" (filtered to relevant ones — e.g., MTHFR variants, FTO, ApoE)
- `[Se rapport →]` opens a detail view with markers grouped by domain (sleep, metabolism, exercise response, drug metabolism)

**Blodprover card:**
- List of last 3-5 imports with date + label ("full panel" / "hormoner" / "vitaminer" / "thyroid")
- `[Ladda upp nytt PDF →]` opens file uploader (existing `/api/blood/upload`)
- Tap individual entry → detail view of that lab's results parsed into structured data + flagged out-of-range values

**Hormoner & CGM card:**
- Source (Dexcom / Libre / FreeStyle)
- Status (active / paused / not connected)
- Date range covered
- `[Se trend →]` opens 24h glucose curves, time-in-range, fasting baselines

### Section: Kropp

**Body composition + measurements.**

- Height, weight (with delta vs last measurement)
- Body composition: %fett, %muskel, water%, basal metabolism
- Last measurement source + date
- `[Uppdatera →]` opens manual entry form (or import from Withings/Fitbit/scale integration if connected)

**No charts.** This is reference data, not trend data. (Trends live in View 2.)

### Section: Baseliner (Forsyne's view of you)

This is **the agent's own model of you** — derived baselines that everything else is compared against.

Three or more cards, each:
- Metric name
- Current baseline value
- Time window basis ("baserad på 30 d")
- Trend arrow with magnitude

**Why on Profile not Trends:** these are *baselines* (stable references), not *trends* (moving values). Trends view shows movement; here we show the anchor that movement is measured against.

**Tap each card** → "Hur är min baseline beräknad?" — transparency. Shows formula, time window, exclusion rules (illness days, travel days).

### Section: Kroniska tillstånd

**List + add button.** Conditions that affect interpretation:
- Diabetes (typ 1 / 2 / 3)
- Sköldkörtelsjukdom (Graves, Hashimoto, etc.)
- Autoimmuna (Crohn's, RA, MS, etc.)
- Säsongsallergier
- Astma
- Hormonella tillstånd
- Mediciner (long-term)

Each condition: name + onset year + optional severity. Affects what insights agent generates and how (e.g., insulin-related glucose spikes are categorized differently for T1D).

**Critical for the agent.** Without this section, the agent makes wrong assumptions.

### Section: Källor (data sources)

Status of each integration:
- ✓ Connected (with last-sync timestamp)
- ─ Not connected (with `Anslut →` link)

Sources listed:
- Garmin (specific model)
- Apple Health
- Strava
- Dexcom / CGM
- Oura
- Whoop
- MyFitnessPal / Cronometer
- Manual entry (Forsyne only)

**`[Hantera integrationer →]`** opens existing wearables.html / datasources.html UI.

---

## Color discipline

**This view is mostly grayscale.** Color reserved for:
- ✓ marks (var(--accent))
- Trend arrows (per metric direction)
- Out-of-range badges in detail views (var(--danger), var(--warn))

**Deliberately quiet** — Profile isn't a daily-check view. Visual loudness here would compete with View 1's hero composite for attention.

---

## Typography discipline

| Use | Family | Size | Weight |
|---|---|---|---|
| Identity name | Cormorant Garamond | 1.4rem | 400 |
| Identity meta | Jost | 0.85rem | 300 |
| Section header | Jost | 0.62rem uppercase, 0.28em letter-spaced | 400 |
| Card label | Jost | 0.62rem uppercase, 0.18em letter-spaced | 400 |
| Card value (numbers) | Jost | 1.05rem | 300 |
| Card meta | Jost | 0.78rem | 300 |
| Action link | Jost | 0.7rem uppercase, 0.18em letter-spaced | 400 |

---

## Animation discipline

**Almost none.** Profile is a reference view — animation = noise here.

Acceptable:
- Cards fade in on view load (200ms, no stagger needed)
- Card tap: subtle background brighten (150ms)

That's it.

---

## Empty states

**First-time user (just signed up):**
```
[Identity strip empty]

Profilera dig.
Forsyne blir bättre ju mer den vet.

[Lägg till identitet]
[Ladda upp blodprov]
[Ladda upp DNA-rapport]
```

**Section-level empty:**
- Biology with no DNA: card shows "Lägg till" CTA
- Body with no measurements: card shows "Mät dig första gången →"
- Baselines section is hidden until day 14+ (no baselines exist before then)

---

## Microcopy tone

Same constraints as other views, with this view's specifics:

**Always:**
- Use the user's actual name in identity strip ("CARL", not "User")
- State data freshness: "senast nu" / "4 d sedan" / "2026-03-14"
- Mark known limitations: "12 markörer av interest" — be specific about what's filtered

**Avoid:**
- Wellness-app fluff ("your incredible biology!")
- Implications of judgement ("your fat % is high")
- Diagnostic language ("you have...")

---

## What is NOT on this view (intentionally)

- ❌ Daily metrics (View 1 / View 2)
- ❌ Insights based on this data (those live on View 4)
- ❌ Goals / targets (lives on Insights as recommendations)
- ❌ Notifications settings (gear icon → settings, separate)
- ❌ Account settings (gear icon → settings, separate)
- ❌ Subscription / billing (gear icon → settings, separate)

**Profile is biological data only.** Account/system settings are a separate area accessed via gear icon in nav.

---

## Navigation

**Profile is NOT in bottom nav.** Bottom nav stays at 4: Today, Trends, Check-in, Insights.

**Profile is accessed via:**
- Top-right user icon (left of the gear icon) in the global nav
- Tap on the forsyne logo top-left also goes to Profile (Stripe-style — logo = home of the human, not the data)
- Deep-linked from Insights when an insight references biological data ("din ferritin →")

**Back navigation:** top-left ‹ Tillbaka returns to whichever view sent the user here. If accessed via icon: returns to Today.

---

## Acceptance criteria

A user uploads new bloodwork. Within 30 seconds:
1. They see a confirmation that data is parsed
2. The new entry shows in the Blodprover card with date + label
3. Within minutes, the agent regenerates relevant insights citing the new data

A user opens Profile out of curiosity (not from an insight link). Within 30 seconds:
1. They see their identity, body comp, biological baselines clearly organized
2. They feel "the system actually knows me" (proven by what's listed)
3. They close the view without confusion about what each section means

That's the bar. Reference layer, not analytical layer. Calm, organized, complete.
