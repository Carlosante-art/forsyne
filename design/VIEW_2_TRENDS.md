# View 2 — Trends

*The depth-view behind View 1's hero composite. Answers what's *actually happening* over weeks and months. Maps to RESEARCH.md findings on HRV trends, Sleep Regularity Index, and balance-over-value framing.*

---

## Purpose — the one question this view answers

> *"Vad händer med mig över veckor och månader — vart är jag på väg?"*

Where View 1 is the snapshot, View 2 is the **arc**. User comes here when something on View 1 surprises them — composite dropped, alert appeared — and they want to see if it's a blip or a trend.

If they can answer "is this a pattern or noise?" in <10 seconds, the view succeeds.

---

## Layout (mobile, max-width 430px, single-column scroll)

```
┌────────────────────────────────────────┐
│ NAV: forsyne  ·  Trends  ·  ⚙       │
├────────────────────────────────────────┤
│                                        │
│  [14d]  [90d]  [1år]                   │  ← Time period selector (sticky)
│                                        │
├────────────────────────────────────────┤
│                                        │
│  COMPOSITE                       ↗ +6  │  ← Card 1: hero metric trend
│  72 idag · 66 snitt 14d                │     (always at top, biggest)
│  ╱╲  ╱──╲     ╱──   ╱╲╱──             │
│  ───────────────────────               │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  HRV BALANCE              Sjunkande ↘  │  ← Card 2: HRV trend
│  -8% vs 30d-baseline                   │     (text-first, sparkline below)
│   ─╲ ╱╲  ╱─╲╱─╲─╲                     │     "balance" not raw ms
│                                        │
├────────────────────────────────────────┤
│                                        │
│  SÖMN-REGULARITET     Driftande +18m   │  ← Card 3: SRI (the differentiator)
│  Bedtime ±43 min · target ±20          │     specific + actionable target
│  ▮ ▮ ▮ ▮▮▮▮▮▮ ▮▮▮ ▮ ▮ ▮              │     bar chart, each = one night
│                                        │
├────────────────────────────────────────┤
│                                        │
│  VILOPULS              +4 bpm vs 30d   │  ← Card 4: RHR delta
│  62 idag · 58 baseline                 │
│   ─╱╲╱─────────╱╲╲                    │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  TRÄNINGSBELASTNING       Påbyggande   │  ← Card 5: ACWR
│  ACWR 1.4 · grön zon (0.8-1.5)         │
│   ▮▮▮▮▮▮▮▮▮▮▮ vs ▮▮▮▮▮▮▮▮▮▮▮▮▮▮     │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  SUBJEKTIV (du själv)        Stabil →  │  ← Card 6: self-report avg
│  Energi 4.2/5 snitt 7d                 │
│   ────────────                         │
│                                        │
├────────────────────────────────────────┤
│  Today  Trends  Check-in  Insights     │
└────────────────────────────────────────┘
```

---

## Components — data, behavior, interaction

### Time period selector (sticky at top)

**Three options:** `14d` (default) · `90d` · `1år`

**Visual:**
- Three pill buttons, horizontal
- Active = filled with accent color
- Inactive = outline, fg3 text
- Sticky to top of scroll container (stays visible as user scrolls)

**Behavior:**
- Tap → all cards re-render with new period
- Period choice persists across sessions (localStorage)
- Smooth fade transition between periods (200ms)

**Default:** 14d (matches what cards anchor against, what AI agents reason over)

**Edge:** if user has <14d data, only show "Sedan start (X dagar)" — disable period selector

### Card structure (universal pattern)

Every card follows the same anatomy:

```
[LABEL]                    [DELTA + ARROW]
[primary value]  ·  [context value]
[chart visualization]
[optional: target line]
```

**Label:** Jost 0.62rem uppercase, letter-spaced 0.18em, `var(--fg3)`

**Delta + arrow:** Jost 0.85rem, color matches direction (green/terracotta/red)
- ↗ improving / +N
- → stable
- ↘ declining / -N

**Primary value:** Jost 1.6rem, weight 300, `var(--fg)`
**Context value:** Jost 0.95rem, `var(--fg2)` — always provides comparison

**Chart:** ~60px height, full card width, simple line/bar — no axis labels (tap to expand)

**Tap behavior:** any card → expands to detail panel with:
- Larger chart (300px height)
- Axis labels active
- Annotations (illness, travel, training peaks marked)
- Underlying contributors
- Comparable past episodes if any

### Card 1 — Composite (always first, always biggest)

**Source:** Same composite as View 1 hero, but as time series.

**Display:**
- Today's value + 14d/90d/1y average (depending on period)
- Sparkline showing trend
- Delta badge (today vs average)

**Chart:** simple line, color-coded by current zone (green/terracotta/red)
- Today's point: filled circle, larger
- Past anomaly days: small markers
- If period = 90d or 1y: weekly aggregates instead of daily

### Card 2 — HRV Balance (NOT raw HRV)

**Source:** `integrations.data.hrv[]` aggregated to weekly average + CV (coefficient of variation)

**Display:**
- "Balance" framing (Oura's UX-validated pattern):
  - Word: `Stigande ↗` / `Stabil →` / `Sjunkande ↘` / `Strain ⚠`
  - Number: `-8% vs 30d-baseline` (delta only, never raw ms)
- Sparkline shows the *trend* of the rolling average, not daily values

**Empty state (no HRV data):** card shows "Ingen HRV-data ännu" with link to manual logging or wearable connect. Doesn't fail.

**Why never raw ms:** research (Altini, RESEARCH.md section 5) — single-day HRV is statistical noise. Surface only as personal-baseline trend.

### Card 3 — Sleep Regularity (the hero of this view)

**This is the differentiator card.** No other consumer wearable surfaces SRI as a primary metric. RESEARCH.md: top-quintile SRI = 20-48% lower mortality (Windred 2024).

**Source:** Compute from `checkins.sleep` + bedtime data (need to track bedtime — see "data needed" below)

**Display:**
- Word: `Driftande +18m` / `Stabil` / `Stadigt`
- Detail: `Bedtime ±43 min · target ±20`
- Chart: bar chart, each bar = one night's bedtime, colored by deviation from rolling median
- Target band overlay (visual zone showing ±20 min)

**Data needed for full feature** (current schema doesn't capture bedtime explicitly):
- Add `bedtime` field to checkins schema (TIMESTAMP), or
- Derive from sleep file (Garmin SLEEP/.fit has start/end), or
- Add a bedtime question to the daily check-in

**Tap → detail:**
- 30-day bedtime drift chart
- "Your most regular week was [X], your least was [Y]"
- Specific actionable: "Going to bed within ±15 min of 23:30 would put you in the top regularity quintile"

### Card 4 — Vilopuls (RHR) delta

**Source:** `integrations.data.resting_hr[]` (built today via manual logging)

**Display:**
- Today's value vs personal baseline (rolling 30d average)
- Delta in bpm (e.g., `+4 bpm vs 30d`)
- Sparkline of the daily values

**Why valuable:** RESEARCH.md — RHR anomaly detected 63-88% of COVID infections 4-9 days early (Mishra 2020, Stanford). RHR deviation is the cheapest, highest-signal illness predictor available to consumer wearables.

**Color rules:**
- Within ±3 bpm of baseline: neutral (fg2)
- +3 to +7 bpm: terracotta (caution)
- ≥+7 bpm: red (consider this in alert engine)
- Below baseline: subtle green (well-recovered)

### Card 5 — Träningsbelastning (ACWR)

**ACWR = Acute:Chronic Workload Ratio** = (last 7d training minutes) / (last 28d training minutes)

**Source:** `integrations.data.activities[]`

**Display:**
- ACWR number (e.g., `1.4`)
- Zone label: `påbyggande` (1.0-1.5) / `stabil` (0.8-1.0) / `återhämtar` (<0.8) / `risk` (>1.5)
- Two bar series: 7d-average vs 28d-average, side by side

**Why this metric:** Sports science consensus (RESEARCH.md section 6) — ACWR spikes >1.5 predict injury. Belongs as the "are you overdoing it?" signal.

**Empty state:** if <14 days of activity data → "Bygger träningsbaseline. Dag X av 14."

### Card 6 — Subjektiv self-report

**Source:** `checkins.energy`, `checkins.mood` aggregated as 7d average

**Display:**
- Average value (e.g., `Energi 4.2/5 snitt 7d`)
- Word: `Stigande ↗` / `Stabil →` / `Sjunkande ↘`
- Simple line of daily reports

**Why include:** RESEARCH.md — Saw 2016 systematic review found subjective measures *outperform* objective for daily monitoring. Critical that the user's own voice has equal visual weight as their wearable's voice.

**This card is the bridge to View 3 — Check-in.** When user taps, can offer "Logga idag" if today's missing.

---

## Color discipline

**Same as View 1 + this view-specific addition:**

**Trend arrows:** color and direction together never fail accessibility:
- `↗` green = improving
- `→` fg3 = stable
- `↘` terracotta = declining
- `⚠` red = anomaly (rare, big signal)

**Charts:**
- Single color per card (matches the metric's current state)
- No multi-color line charts (avoid visual noise)
- Filled area below line = subtle gradient with same hue (5% opacity)
- Today's point on each chart: filled circle, slightly larger

**Target lines / zones:**
- Dashed grey at 1px (`#4a4e49`)
- Background band for "good zone" at 5% opacity sage green
- Never bright "ideal" markers — implies the user is failing if outside

---

## Typography discipline

Same families as View 1, sizes calibrated for card density:

| Use | Family | Size | Weight |
|---|---|---|---|
| Card label | Jost | 0.62rem uppercase, 0.18em letter-spacing | 400 |
| Trend delta | Jost | 0.85rem | 400 |
| Primary value | Jost | 1.6rem | 300 |
| Context / subtitle | Jost | 0.95rem | 300 |
| Tooltip / annotation | Jost | 0.7rem | 300 |
| Period selector | Jost | 0.75rem uppercase, 0.16em letter-spacing | 400 |

**No Cormorant Garamond on this view.** Serif is reserved for View 1's hero composite + interpretation. Trends is utilitarian — sans only.

---

## Animation discipline

**Card load:** stagger from top, 80ms delay between, each fades up + 8px translate, 250ms ease

**Sparkline draw:** stroke draws left to right, 600ms ease, on first render only. On period change → all sparklines redraw simultaneously, 400ms ease.

**Number transitions:** when period changes, primary values count from old → new (300ms ease).

**Tap to expand:** card morphs into detail panel via shared element transition. ~350ms ease-in-out.

**No idle animations.** Stillness is signal. Once loaded, View 2 doesn't move.

---

## Empty states

**Day 0 (no data):**
```
[All cards greyed out]

Trends visar mönster över tid.
Logga 14 dagar — sen kommer du tillbaka hit
och ser något du inte sett förr.

[CTA: Gör check-in →]
```

**Day 1-13 (some data, not enough for trends):**
```
Each card shows current value but no chart, with subtitle:
"Bygger trend. Dag X av 14."

The composite card might show actual sparkline if compositet is generating
from 1-day data, but with a "tentativ baseline"-tag.
```

**Day 14+ (full activation):**
- All cards show real trends
- Period selector enabled
- Tap-to-expand works

**Card-specific empty states:**
- HRV card with no HRV data: "Ingen HRV-data. Synca klocka eller logga manuellt."
- ACWR card with <14 day activity history: "Bygger träningsbaseline."
- Sleep regularity with no bedtime data: "Lägg till bedtime i check-in för att aktivera."

---

## Microcopy tone

Same constraints as View 1, plus this view's specifics:

**Always state direction + magnitude + comparison:**
- ✅ "HRV -8% vs 30d-baseline"
- ❌ "HRV is lower"

**Make targets specific and actionable:**
- ✅ "target ±20 min bedtime"
- ❌ "improve sleep regularity"

**Use Swedish equivalents that don't feel translated:**
- ✅ "påbyggande" / "stabil" / "återhämtar" / "risk"
- ❌ "loading" / "stable" / "recovering" / "elevated"

**Trend words (keep this dictionary):**
- Stigande / Sjunkande / Stabil / Driftande / Påbyggande / Återhämtar / Risk / Strain

---

## What is NOT on this view (intentionally)

- ❌ Today's interpretation (lives on View 1)
- ❌ Suggested action (lives on View 1)
- ❌ Alert (lives on View 1)
- ❌ Single-day raw values as headlines (only deltas + trends)
- ❌ Comparative percentile vs other users ("you're 23rd percentile") — research says this drives anxiety
- ❌ Streak counters
- ❌ Weight, body composition (lives in View 5 Profile)
- ❌ Bloodwork values (lives in View 5)

**Drill-down rule:** every card expands to detail with axis labels and annotations. The card itself never carries axis labels — visual noise.

---

## Edge cases & states

- **Period switch with sparse data:** if user picks 1y but only has 3 months of data, charts render with what's available, x-axis shows actual range
- **Anomaly during view:** if a card detects a current anomaly worth surfacing, no badge here (View 1's job) — but card border subtly tinted in the anomaly's color
- **Loading state:** show greyed placeholder cards in same layout (avoid layout shift). Each card resolves independently — composite first, then HRV, etc.
- **Empty state for entire view (just signed up, no data anywhere):** Show single hero message + Check-in CTA. No greyed cards — that's noise.

---

## Acceptance criteria

A user opens View 2 because View 1 surprised them. Within 10 seconds they:
1. See whether the surprise is a single-day blip or a multi-day trend
2. Understand WHICH metric is driving the change (which card has the biggest delta)
3. Know whether to dig deeper (tap card) or close the app (it's noise)

If they want detail, every card expands. If they don't, the headlines told them enough.

That's the bar. Not "comprehensive metrics dashboard." A *navigable* trend feed where the most important arc is at the top.
