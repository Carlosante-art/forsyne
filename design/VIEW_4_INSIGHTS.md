# View 4 — Insights

*The AI agent's surface. Where patterns the user couldn't find themselves get articulated. Maps to RESEARCH.md findings on what makes data actionable (Fogg, Clear, Wood) and how Whoop's Monthly Performance Assessment is among their highest-rated features.*

---

## Purpose — the one question this view answers

> *"Vad har systemet hittat om mig som jag aldrig själv skulle se?"*

If a user lands here and reads ONE insight that genuinely surprises them in a useful way, the view succeeds. The bar isn't "show data" — it's *make-the-invisible-visible-and-actionable*.

---

## Layout (mobile, max-width 430px, single-column scroll)

```
┌────────────────────────────────────────┐
│ NAV: forsyne  ·  Insights  ·  ⚙     │
├────────────────────────────────────────┤
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ DENNA VECKA                      │  │  ← Pinned weekly digest
│  │                                  │  │     (Whoop MPA analog)
│  │  3 insikter · 1 prediktion       │  │     always at top
│  │  träffade · Kraschsignal nivå 2  │  │
│  │                                  │  │     [Läs vecko-rapport →]
│  └──────────────────────────────────┘  │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  KORRELATION  ·  hög tilltro            │  ← Card 1
│                                        │
│  Din HRV faller -12 ms i snitt         │
│  dagen efter du druckit alkohol.       │
│                                        │
│  ▮▮ ▮▮▮ ▮▮▮ ▮ ▮▮ ▮▮ ▮ ▮              │
│  Senaste 14 nätter · n=4 dr-dagar     │
│  p < 0.05                              │
│                                        │
│  Föreslagen åtgärd:                    │
│  Tracka morgon-HRV efter 2+ drinkar    │
│  i 30 dagar — verifiera mönstret       │
│                                        │
│  [Aktivera tracking]                   │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  PREDIKTION VERIFIERAD  ·  igår         │  ← Card 2
│                                        │
│  "Ben-pass idag = energiglapp imorgon" │
│  Det stämde. Energi: 4 → 3.            │
│                                        │
│  Varslet såg det 19 timmar innan.      │
│                                        │
│  [Hur kunde systemet veta? →]          │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  ANOMALI  ·  nu                        │  ← Card 3 (if active)
│                                        │
│  Vilopuls +9 bpm i 3 dagar — kan vara  │
│  ingående infektion eller värme-       │
│  belastning. Bloodwork mars visade     │
│  låg ferritin — kan vara relaterat.    │
│                                        │
│  [Se din ferritin-historik →]          │
│                                        │
├────────────────────────────────────────┤
│                                        │
│  REKOMMENDATION                         │  ← Card 4
│                                        │
│  Din sömn-regularitet sjönk 18 min     │
│  förra veckan. Topp-kvintilen i UK     │
│  Biobank har 20-48% lägre dödsrisk     │
│  — mest påverkbar genom konsekvent     │
│  läggtid, inte sömntid.                │
│                                        │
│  [Spara som mål: ±20 min läggtid]      │
│                                        │
├────────────────────────────────────────┤
│                                        │
│   [filter chips: Alla · Sömn · HRV…]   │  ← Tap to filter feed
│                                        │
├────────────────────────────────────────┤
│  Today  Trends  Check-in  Insights     │
└────────────────────────────────────────┘
```

---

## Components — data, behavior, interaction

### Pinned weekly digest (always at top)

**The summary card that anchors the view.** A user opening Insights once a week should land here and feel "ok, here's the headline."

**Format:**
```
DENNA VECKA
[summary line — 1-2 sentences]
[3-5 chip stats with delta]

[Läs vecko-rapport →]
```

**Generated:** automatically every Monday morning (cron job). Manually re-trigger via tap.

**Stats chips inside digest:**
- "3 insikter" (new patterns found)
- "1 prediktion träffade" (predictions verified)
- "Kraschsignal nivå 2" (current alert state if any)
- "Sömn -18m vs förra veckan" (largest behavior delta)

**Tap → expanded weekly report** (own scrollable view): full review of week's patterns, predictions, deltas, agent commentary.

**Visual:** subtly tinted background to differentiate from regular insights. Border accent in `var(--trust)` (blue) to signal "this is the system's overview, not a single insight."

### Insight cards (the stream)

**Universal anatomy:**
```
[TYPE-LABEL]  ·  [CONFIDENCE / TIMING]
[Pattern statement — 1-2 sentences, specific + evidence-anchored]
[Optional: small inline chart with caption]
[Optional: bio-context callback — "Bloodwork mars visade…"]

Föreslagen åtgärd:
[Action sentence]

[Action button(s)]
```

**Type label** (small uppercase, top of card):
- `KORRELATION` (light fg2)
- `PREDIKTION` (var(--accent) when verified, var(--warn) when active)
- `ANOMALI` (var(--danger), bold visual)
- `REKOMMENDATION` (var(--fg2))
- `MILSTOLPE` (var(--accent), e.g., "Du har checkat in 30 dagar i rad")

**Confidence / timing** (small, right-aligned):
- "hög tilltro" / "preliminär" / "1 dag" / "förra veckan" / "nu" / "verifierad igår"

**Microcopy rules:**
- Always cite n-data ("n=4 dr-dagar", "14 nätter")
- Always cite statistical significance when applicable ("p < 0.05")
- Frame negative findings non-judgmentally ("din HRV faller", not "alkohol skadar dig")
- Cite biological context when relevant ("ferritin från mars-blodprov")

**Tap on card** → expand to detail view:
- Full data behind the pattern
- Larger chart with all data points
- Comparable past episodes
- "How the agent reasoned" — transparency on what was synthesized
- Long-form explanation if user wants

### Action button(s) — the bridge to behavior

**Every insight has at least one action button.** Per RESEARCH.md (Fogg B=MAP), the prompt + ability convergence requires a *clickable* action, not just an idea.

**Action button types:**
- `[Aktivera tracking]` — enables a specific monitoring rule
- `[Spara som mål: X]` — adds to ongoing goals
- `[Påminn mig: X]` — sets a reminder
- `[Visa underliggande data →]` — opens detail
- `[Avfärda — det här är inte mig]` — feedback loop, agent learns
- `[Logga: jag agerade]` — compliance tracking

**Visual:** uppercase, letter-spaced, 1px border, transparent fill. Active state: subtle accent fill on hover.

**Compliance loop:** taps persist via `/api/insights/action` (not yet built — design intent only). The agent reads action history to calibrate future insights ("user typically dismisses sleep recommendations — try framing differently").

### Filter chips (bottom of feed)

**Optional — only shows after >5 insights exist.**

Horizontal scrollable chips:
- `Alla` (default)
- `Sömn`
- `HRV`
- `Träning`
- `Kost`
- `Biologi`
- `Prediktioner`
- `Anomalier`

Tap → filters feed. Active chip highlighted with `var(--accent)`. State persists per session.

---

## Color discipline

**Universal palette as before, with insight-type semantics:**

| Card type | Border accent | Type label color |
|---|---|---|
| Weekly digest | `var(--trust)` (blue) | `var(--trust)` |
| Korrelation | none | `var(--fg2)` |
| Prediktion (verified) | subtle `var(--accent)` | `var(--accent)` |
| Prediktion (active) | subtle `var(--warn)` | `var(--warn)` |
| Anomali | subtle `var(--danger)` | `var(--danger)` (bold) |
| Rekommendation | none | `var(--fg2)` |
| Milstolpe | subtle `var(--accent)` | `var(--accent)` |

**Border accent** = 2px left border in the type's color, 0.05 opacity background tint. Subtle — never visually loud.

**Anomaly card is the exception:** stronger visual presence (3px left border, slightly higher background tint) — but never aggressive. Calm consequence per RESEARCH.md.

---

## Typography discipline

| Use | Family | Size | Weight |
|---|---|---|---|
| Type label | Jost | 0.6rem uppercase, 0.22em letter-spaced | 400 |
| Confidence / timing | Jost | 0.62rem uppercase, 0.18em letter-spaced | 400 |
| Pattern statement | Cormorant Garamond | 1.15rem | 400 |
| Evidence caption | Jost | 0.78rem | 300 |
| Action label | Jost | 0.65rem uppercase, 0.18em letter-spaced | 400 |
| Action button | Jost | 0.7rem uppercase, 0.16em letter-spaced | 400 |

**Pattern statement uses Cormorant Garamond** — same as View 1 hero composite + interpretation. Signals: this is the system speaking, not a UI label.

---

## Animation discipline

- Cards stagger-fade in on view load (80ms between, 250ms ease)
- Action button tap: subtle background flash (300ms)
- Filter chip tap: re-flow cards with 200ms cross-fade
- "Aktivera tracking" / "Spara som mål" success: brief checkmark animation in button (450ms)

**No idle animations.** Insights view is reading mode — stillness lets the user focus on content.

---

## Empty states

**Day 0-13 (no insights yet):**
```
[Hero illustration: minimal]

Insikter kräver mönster.
Mönster kräver data.

Du är dag X av 14.
Sju check-ins kvar tills första riktiga insikt.

[Gör check-in →]
```

**Day 14+ but no clear patterns yet:**
```
Jag tittar fortfarande.

Dina senaste 14 dagar visar variation
men inga starka mönster ännu.

Fortsätt logga — jag säger till när
något träder fram.
```

**Filtered to nothing:**
```
Inga insikter inom [filter].
[Visa alla] (CTA)
```

---

## Microcopy tone — the agent's voice

This is the most important place in the app for the agent's voice. The whole app's claim is "we see what you don't" — this view delivers on that.

**Always:**
- Specific numbers: "-12 ms" not "lower"
- N-data cited: "n=4 dr-dagar" — establishes statistical credibility
- p-values when applicable: "p < 0.05" — research-grade transparency
- Biological context callback: "Bloodwork mars visade..." — bridges domains
- First-person agent voice: "Jag tittar..." / "Jag har sett..."

**Never:**
- Diagnoses or medical claims ("you might have...")
- Comparative shame ("better than 73% of users")
- Vague guidance ("try to sleep better")
- Generic health tips ("drink more water")
- Exclamation marks
- Emoji

**Avoid the trap of over-confidence:**
- Use "tilltro" labels: "hög" / "preliminär" / "stark" / "svag"
- Always offer an "Avfärda — det här är inte mig" option — the agent learns from rejections too

---

## What is NOT on this view (intentionally)

- ❌ Today's composite score (lives on View 1)
- ❌ Trends sparklines (lives on View 2)
- ❌ Daily check-in form (lives on View 3)
- ❌ Settings, integrations
- ❌ Notifications inbox
- ❌ "Tips & tricks" / educational articles
- ❌ Comparative percentiles
- ❌ Streak counters

**What lives one tap deeper but not on the surface:**
- The full reasoning behind any insight (tap → detail)
- Underlying data behind correlations
- Past prediction history (tap weekly digest → expanded report)

---

## Card priority logic (which insights show first)

The agent must rank insights for display. Order by:

1. **Active anomalies** (right now, real-time)
2. **Verified predictions from last 24h** (proof the system works)
3. **High-confidence new patterns** (n>10, p<0.05)
4. **Recommendations with high actionability** (specific + within user control)
5. **Lower-confidence patterns** (preliminary findings)
6. **Milestones** (streaks, achievements — rare, non-shaming)

**Cap at 8 cards per session load.** Beyond that, "Visa fler →" at bottom. Users overwhelm fast in feed views.

**Stale insight cleanup:** insights older than 14 days fade from feed unless re-validated. Keep accessible via "Historik" link in weekly digest.

---

## Edge cases

- **Insight contradicts another insight:** show both with "Motstridiga signaler" callout. Don't silently pick one. The agent is wrong sometimes — surface that.
- **User dismisses repeatedly:** after 3 dismissals of similar insight type, agent stops generating that type for ~30 days, surfaces a meta-message: "Jag har slutat föreslå sömn-tips eftersom du avfärdade tre. Säg till om du vill ha dem tillbaka."
- **Insight references missing data** (e.g., bloodwork from PDF that was deleted): degrade gracefully, drop the bio-context callback.

---

## Acceptance criteria

A user opens View 4 once a week. Within 60 seconds:
1. They've read the weekly digest summary
2. They've encountered at least one insight that genuinely tells them something they didn't already know
3. They've either acted on it (tap action button) or dismissed it (also feedback)

If the agent produces nothing surprising in 14 days of data, the view should ADMIT THAT — never fake insights to fill space.

That's the bar. The credibility of Forsyne lives or dies here. Better silence than noise.
