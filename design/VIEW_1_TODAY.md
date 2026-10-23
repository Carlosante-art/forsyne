# View 1 — Today (Hero / Morning Open)

*The single screen 90% of opens land on. Maps to all research findings in [RESEARCH.md](../RESEARCH.md). Built in `app/index.html` as the first scene.*

---

## Purpose — the one question this view answers

> *"Hur är jag idag? Ska jag pusha eller vila? Är något på väg?"*

If a user can answer that in <5 seconds without scrolling, the view succeeds.
Everything else on the screen exists in service of that answer.

---

## Layout (mobile, max-width 430px)

```
┌────────────────────────────────────────┐
│ NAV: forsyne  ·  19 apr  ·  ⚙       │  ← 56px, sticky, blur backdrop
├────────────────────────────────────────┤
│                                        │
│           ALERT (conditional)          │  ← 64px when present, hidden otherwise
│  ⚠  RHR +9 bpm i 3 dagar — möjlig …   │     calm pulse, distinct from rest
│                                        │
├────────────────────────────────────────┤
│                                        │
│                                        │
│              ╭─────╮                   │
│             │   72  │                  │  ← Hero composite (40% of viewport)
│              ╰─────╯                   │     ring + number, 200ms count-up
│                                        │
│      Du är välåterhämtad.              │  ← Interpretation (1 line, serif)
│      Push-läge ok idag.                │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  HRV ↘ 4d   Sömn 5h45   Energi 4/10   │  ← 3 contributor chips (15%)
│                                        │
├────────────────────────────────────────┤
│                                        │
│  Föreslagen åtgärd:                    │  ← Action band (15%)
│  Skippa hård träning. Gå + protein.    │
│  [✓ gjorde]  [✗ hoppade]               │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  ─────────╱╲────╱──╲────────           │  ← Trend preview (peek of View 2)
│  7-dag composite                       │     small sparkline, taps to View 2
│                                        │
└────────────────────────────────────────┘
│  Today  Trends  Check-in  Insights     │  ← Bottom nav (always visible)
└────────────────────────────────────────┘
```

---

## Components — data, behavior, interaction

### 1. Hero composite score

**What:** Single 0-100 number derived by AI agent from all available signals.

**Data sources** (weighted aggregate):
- Sleep duration + Sleep Regularity Index (SRI) — recent 14d
- HRV trend (RMSSD vs personal baseline, weekly average + CV)
- RHR deviation from personal baseline
- Body Battery (if available)
- Subjective check-in (last 24h: energy, mood)
- Training load (acute vs chronic ratio)

**Color** (research: combine color + shape, never color alone):
- `≥75` → green (#8FAE8A) ring, **solid** stroke
- `40-74` → terracotta (#C4875A) ring, **dashed** stroke
- `<40` → muted red (#A85C5C) ring, **slow pulse** animation
- `<baseline-eligible` → grey (#4a4e49), no fill, "Bygger baseline (dag X av 14)"

**Typography:**
- Number: Cormorant Garamond, weight 300, **5rem** (clamp 4rem on small phones)
- Interpretation below: same family, italic, **1.05rem**, color `var(--fg2)`

**Animation:**
- On load: number counts from 0 to actual value, 800ms ease-out
- Ring stroke draws from 12 o'clock clockwise, 1.0s ease
- If anomaly active (alert visible): ring pulses subtly (opacity 0.85 → 1.0, 2.5s loop)

**Interaction:**
- Tap → expands to "contributor breakdown" panel showing each input + weight + delta vs baseline. Stripe-style drill-down.
- Long-press → 14-day history chart of the composite

**Edge case:**
- Day 1 user: show grey circle, "—" instead of number, copy reads "Jag bygger din modell. Logga din första check-in →"
- Day 1-13: show grey, copy reads "Bygger baseline. Dag X av 14."
- Day 14+: real number activates

### 2. Interpretation line (one sentence, AI-generated)

**Source:** AI agent (Insikts-agenten / Agent 3) generates one sentence based on composite + context.

**Tone constraints** (from CLAUDE.md + research):
- Serif typeface (signal: this is the system speaking)
- ≤90 characters
- Direct, calm, never alarmist
- "Du är..." / "Din kropp visar..." — never "Du borde..." / "You should..."
- Variable (variable reward principle): occasionally surprising, never templated

**Examples:**
- `72 + good sleep`: "Du är välåterhämtad. Push-läge ok idag."
- `45 + low HRV streak`: "Kroppen vill ha vila. Lyssna idag."
- `38 + RHR anomaly`: "Något pågår — sänk intensitet, höj kontaktytor."
- `90 + multi-day green`: "Sällsynt fönster. Använd det."

### 3. Contributor chips (3, horizontal scroll on small)

**What:** 3 small chips showing top contributors that drove today's score.

**Format per chip:**
```
[label]  [value]  [trend arrow]
HRV      54ms     ↘ 4d
```

**Color:** chip background tinted by contribution direction
- positive contribution: subtle green wash
- negative contribution: subtle red wash
- neutral: no tint

**Typography:**
- Label: Jost 0.62rem, uppercase, letter-spaced 0.18em, `var(--fg3)`
- Value: Jost 0.95rem, regular weight
- Trend arrow: 0.85rem, color matches direction

**Interaction:**
- Tap chip → drawer with 14-day sparkline + brief explanation
- Drawer dismissible by tap outside or swipe down

**Selection rule** (which 3 chips):
- Always include the strongest *negative* contributor (signal user should know about)
- Always include sleep (most engagement-validated daily metric)
- Third slot: highest absolute delta from baseline (positive or negative)
- Subjective check-in is included if completed in last 24h, else replaced

### 4. Action band (single suggested action)

**Format:**
```
Föreslagen åtgärd:
[one sentence]
[✓ gjorde] [✗ hoppade]
```

**Tone:** specific, time-bound, within user control (Fogg B=MAP — make Ability high).
- ❌ "Improve hydration"
- ✅ "Drick 500ml vatten innan lunch"
- ❌ "Sleep better"
- ✅ "Lägg dig 22:30 ikväll — du har gått 23:50 i snitt"

**Tap behavior:**
- `gjorde` → green flash, action logs to compliance history, used by AI for next-day calibration
- `hoppade` → grey acknowledge, also logged, AI uses it ("user typically skips morning protein suggestions")

**Empty state:** if AI has no high-confidence action, hide band entirely. Better silence than padding.

### 5. Alert band (conditional, only when anomaly)

**Trigger conditions** (from prediction agent):
- RHR ≥7 bpm above personal baseline ≥3 days
- HRV ≥10% below baseline ≥5 days
- Body temp anomaly (if data available)
- Subjective + objective divergence beyond threshold

**Visual:**
- Above hero, distinct band
- Background: very subtle red/terracotta wash (5% opacity)
- 1px top + bottom border in same hue
- Slow pulse animation (2.5s opacity loop, never aggressive)
- Icon (warning triangle) + one line + arrow indicating tappable

**Copy:**
- Lead with what's observed, not prescription
- "RHR +9 bpm i 3 dagar — möjlig värmeökning eller ingående infektion"
- Not "OBS! RHR förhöjd!"

**Tap behavior:**
- Expands to detail panel: which signals deviated, by how much, similar past episodes if any, recommended response

**Hide rule:** alert band is ENTIRELY HIDDEN when no anomaly. Empty space > false positives.

### 6. Trend preview (peek of View 2)

**What:** Small 7-day sparkline of the composite score, no labels, no axis.

**Purpose:** Visual continuity — implies "there's more depth here." User taps → goes to Trends (View 2).

**Visual:**
- 32px height, full width
- Single line, color matches today's score range
- Today's point highlighted (filled circle)
- No grid, no labels (those live in View 2)

---

## Color discipline (from RESEARCH.md + CLAUDE.md)

**Three accent colors, used semantically:**
- `#8FAE8A` (sage green) → recovered / good / positive contribution
- `#C4875A` (terracotta) → caution / attention / borderline
- `#A85C5C` (muted red) → strain / anomaly / negative contribution

**Never use color alone for status.** Always pair with shape:
- Solid stroke = good
- Dashed stroke = caution
- Pulsing = alert

**Grayscale for everything that isn't a signal:**
- `#0F1210` background (ink)
- `#F2F0EA` primary text
- `#CCC9BF` secondary text
- `#8A8E89` tertiary / labels
- `#4a4e49` disabled / empty-state

**Trust blue (`#5B7FA6`) reserved for "neutral system info"** — e.g., "Synced 2 min ago," not status.

---

## Typography discipline

Two families, four sizes max:

| Use | Family | Size | Weight |
|---|---|---|---|
| Hero composite number | Cormorant Garamond | 5rem | 300 |
| Interpretation line | Cormorant Garamond italic | 1.05rem | 400 |
| Action sentence | Jost | 1.0rem | 400 |
| Body / chip values | Jost | 0.95rem | 300 |
| Labels (uppercase, letter-spaced) | Jost | 0.6-0.7rem | 400 |

**Letter-spacing:** labels always `0.18em` to `0.28em`. Body never letter-spaced.

**Line-height:** body 1.7, hero 1.1, labels 1.4.

---

## Animation discipline

**Universal rule:** 200ms ease-out for all transitions. Never linear. Never longer than 800ms (count-up is the one exception at 800ms).

**What animates and why:**
| Element | Animation | Why |
|---|---|---|
| Hero number on load | Count up 0 → value, 800ms | Variable reward (Eyal Hook Model) |
| Hero ring on load | Stroke draws clockwise, 1.0s | Establishes hero as primary focus |
| Alert band when shown | Slow pulse (opacity 0.85↔1.0, 2.5s loop) | Calm consequence, not panic |
| Chip tap | Gentle scale 1.0 → 0.96 → 1.0, 200ms | Tactile feedback |
| Action button tap (✓/✗) | Background flash, 300ms fade | Compliance acknowledgment |

**Never animated:** typography, color shifts, idle elements. Stillness is signal.

---

## Empty states (per data maturity)

These are where Forsyne's brand happens. Research says: empty states should *guide*, not just inform.

**Day 0 (just signed up, no data):**
```
[grey ring, no number]

Välkommen.
Logga din första check-in så börjar jag bygga din modell.

[Stor CTA: Gör check-in →]
```

**Day 1-6 (some data, no baseline):**
```
[grey ring, "—"]

Jag bygger din baseline.
Dag 3 av 14. Loggat 2 av 3 check-ins.

[contributor chips show actual values, no trend]
```

**Day 7-13 (early baseline forming):**
```
[grey ring with subtle stroke, current value in parens]
"(58)"

Halva baseline klar.
Riktiga insikter aktiveras dag 14.
```

**Day 14+:** Full activation. Composite, interpretation, action, alert all live.

---

## Microcopy tone — the system's voice

From RESEARCH.md (in-app expert voice retains longer) + CLAUDE.md (no scaffolding) + Forsyne thesis (calm, consequential):

**Always:**
- Direct (skip "could be," "might want to")
- Specific (numbers + context)
- Calm (no exclamation marks, no caps lock)
- Personal ("din baseline", "ditt mönster", never "users like you")

**Never:**
- "OBS!" or "VIKTIGT!" or "VARNING!"
- Emoji (per CLAUDE.md)
- Generic health advice ("drink water!" without context)
- Comparative ("you're 23rd percentile")
- "Should" / "borde"

**The system speaks as itself**, not as a human coach. It's an instrument that observes — not a friend that pushes.

---

## What is NOT on this view (intentionally)

These exist in deeper drill-downs but never compete for attention here:

- ❌ Step count
- ❌ Calorie burn
- ❌ Raw HRV in ms (only trend arrow)
- ❌ Raw RHR in bpm (only deviation chip)
- ❌ Sleep stage minutes (only sleep score with regularity emphasis)
- ❌ "Stress score" (it's already in the composite)
- ❌ Settings, integrations, history calendar
- ❌ Notifications list
- ❌ Streak counter (avoid streak-shame per Headspace research)

**Drill-down rule:** anything users *might* want is one tap away, but nothing competes with the answer to the one question.

---

## Edge cases & states

- **Offline:** show last cached composite + "Offline — visar senaste värden" muted at top
- **No internet for AI:** composite still works (deterministic from cached data); only the AI interpretation line falls back to a static description
- **Composite cannot be calculated** (insufficient data even after 14 days): show contributor chips as raw, hide hero ring, copy: "Inte nog data idag. Kolla [vilken signal saknas]"
- **All metrics stale (>48h)**: dim entire screen, prompt: "Senaste data är 3 dagar gammal. Synca din klocka eller logga manuellt →"

---

## Acceptance criteria (when this view ships)

A user opens the app at 07:30. Within 5 seconds they:
1. See ONE number
2. Read ONE sentence about what it means
3. Know ONE concrete thing to do today
4. (If applicable) See ONE alert about something developing

If they want more, drill-down is one tap. If they don't, they close the app feeling informed.

That's the bar. Not "comprehensive dashboard." Not "all metrics visible." Calm answers.
