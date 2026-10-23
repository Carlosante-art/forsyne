# View 3 — Check-in

*The 30-second daily input that the AI agent uses as its highest-yield signal. Maps to RESEARCH.md finding (Saw 2016) — subjective self-report outperforms objective metrics for daily monitoring of overreaching.*

---

## Purpose — the one question this view answers

> *"Vad behöver systemet från mig idag för att kunna se mig?"*

This is **not** a survey. It's a 30-second instrument that the AI uses to triangulate against wearable data. If it takes >30 seconds, users abandon (RESEARCH.md — friction is the dominant abandonment driver in journal-based apps).

If a returning user can complete check-in in <30 seconds and feels rewarded for doing so, the view succeeds.

---

## Layout (mobile, max-width 430px, sequential reveal)

```
┌────────────────────────────────────────┐
│  ← Tillbaka       Check-in    [skip]   │  ← Top nav, dismissible
├────────────────────────────────────────┤
│                                        │
│              FRÅGA 1 / 3               │  ← Progress (subtle)
│                                        │
│                                        │
│                                        │
│         Hur är energin idag?           │  ← Big, calm question (serif)
│                                        │
│       ●  ●  ●  ●  ●                    │  ← 5 dots, big touch targets
│       1  2  3  4  5                    │
│      lågt        högt                  │  ← Anchor labels, only at extremes
│                                        │
│                                        │
│                                        │
│                                        │
│                                        │
│                                        │
└────────────────────────────────────────┘
```

After tap → slide left, next question slides in:

```
┌────────────────────────────────────────┐
│                                        │
│              FRÅGA 2 / 3               │
│                                        │
│         Hur är humöret?                │
│                                        │
│       ●  ●  ●  ●  ●                    │
│       1  2  3  4  5                    │
│      tungt       lätt                  │
│                                        │
└────────────────────────────────────────┘
```

After question 3 → completion screen:

```
┌────────────────────────────────────────┐
│                                        │
│                                        │
│            ╭─────╮                     │  ← Composite count-up
│           │   72  │                    │     (the immediate reward)
│            ╰─────╯                     │
│                                        │
│                +3                      │
│       sedan igår                       │
│                                        │
│       Tack. Vi ses imorgon.            │
│                                        │
│                                        │
│  [Logga något extra →]                 │  ← Optional deep journal
│                                        │
└────────────────────────────────────────┘
```

---

## The 3 core questions (locked — research-backed)

These are the **non-negotiable minimum**. Every check-in asks these, in this order, every day.

### Question 1 — Energy
**Text:** *"Hur är energin idag?"*
**Scale:** 1–5 (5 dots, tappable)
**Anchors:** `lågt` (1) ↔ `högt` (5)
**Maps to:** `checkins.energy` (existing field, will get scaled to 2-10 server-side per current code)

### Question 2 — Mood
**Text:** *"Hur är humöret?"*
**Scale:** 1–5
**Anchors:** `tungt` ↔ `lätt`
**Maps to:** `checkins.mood`

### Question 3 — Anything notable?
**Text:** *"Något att flagga från igår?"*
**Type:** Multi-select toggle pills (zero or more)
**Options (in order):**
- `Alkohol`
- `Sen koffein`
- `Sjuk / krämpor`
- `Resa`
- `Hård träning`
- `Mens` (if applicable per profile)
- `Inget särskilt` (mutually exclusive with all above)

**Maps to:** `checkins.moods` (jsonb array — existing field) + serialize into `personal_answer` for context

**Why this question:** RESEARCH.md — Whoop's behavior journal correlations come from binary toggle data. This is what makes patterns emergent ("HRV drops 12 ms on average the day after >2 drinks").

---

## Optional deeper journal (one tap below the 3 core questions)

After completing the 3 core questions, user sees the composite update + a single CTA:

> `[Logga något extra →]`

If tapped → reveals the existing fuller form (the legacy check-in.html questions):
- Sömntimmar igår
- Stress (1–10)
- Reflektion (free text)
- Kognitiv belastning (1–5)
- Aktiv återhämtning (ja/nej)

**Most users will skip this.** That's fine. The AI gets enough from 3 questions to make the core composite work. The deep journal is for power users who want to feed the agents extra context.

---

## Components — data, behavior, interaction

### Sequential reveal pattern

**One question at a time, full screen.**
- Question text: Cormorant Garamond, 1.8rem, weight 300, centered, ~50% down the viewport
- Answer interface: directly below, big touch targets
- Bottom 30% intentionally empty — calm, no distractions

**Transition:** when user taps an answer:
1. Selected dot fills + scales briefly (300ms)
2. Whole screen slides left (400ms ease)
3. Next question slides in from right (400ms ease, 100ms delay)

**No "Next" button.** Tapping the answer IS the next-button. Removes one decision.

**No "Back" button mid-flow.** If user wants to change an answer, they can re-do check-in (overwrites). Going back kills the flow speed.

### Dot interface (questions 1-2)

5 dots, big enough for thumb (44x44px touch zone, 16px visual).
- Default: outlined circles, color `var(--fg3)`
- Hovered/pressed: gentle scale 1.0 → 1.1, 150ms ease
- Selected: filled, color matches value zone
  - 1-2: terracotta tint
  - 3: neutral fg
  - 4-5: sage green tint
- Anchor labels (`lågt` / `högt`) only at positions 1 and 5

**Position spacing:** equal, never crowded. Dots feel like dots, not buttons.

### Toggle pills (question 3)

- Pill buttons, round corners (one of the few exceptions to "no border-radius" — touch affordance)
- Default: outline, `var(--fg2)` text
- Selected: filled with `var(--fg)`, ink text
- "Inget särskilt" is mutually exclusive — selecting it deselects all others (and vice versa)
- Bottom of screen: `[✓ Spara]` button, only enabled when at least one option selected

### Completion / reward screen

The reward = **immediate composite update** (variable reward, Eyal Hook Model).

**Sequence:**
1. Final question submitted → screen fades to white briefly (200ms)
2. Composite ring draws + number counts up from yesterday's value to today's new value (1.0s ease)
3. Delta badge appears below: `+3 sedan igår` or `−2 sedan igår`
4. One-line message: `Tack. Vi ses imorgon.` (or variants — see microcopy)
5. After 2s: optional `[Logga något extra →]` link fades in

**Why this matters (RESEARCH.md):** the immediate visible response to user input IS the retention loop. CGM users change diet because they see glucose response within hours. Forsyne must engineer the same loop — log → see composite move → return tomorrow.

### Already-checked-in-today state

If user opens View 3 and has already done today's check-in:

```
┌────────────────────────────────────────┐
│                                        │
│         Du har checkat in idag.        │
│                                        │
│         [Energi 4 · Mood 4 · Inget]    │  ← Today's answers
│                                        │
│                                        │
│         [Justera idag →]                │  ← Re-do (overwrites)
│         [Logga extra →]                 │  ← Open deep journal
│                                        │
│         Nästa check-in: imorgon         │
│         (jag påminner kl 07:30)         │
│                                        │
└────────────────────────────────────────┘
```

**No guilt.** No "you missed yesterday" if applicable. The screen is neutral.

---

## Color discipline

**Same palette as View 1 + 2, with this view's particularity:**

The screen during input is **very calm** — minimal color, lots of grayscale. Color appears at:
- The selected dot (subtle hue tint based on value)
- The completion composite ring
- The pills in question 3 when selected
- The delta badge

**Background gradient (subtle):** Linear from `#0F1210` (top) to `#131714` (bottom) — gives the sequential cards visual depth without distracting.

**Avoid:** any bright colors during the question flow. The user is in input mode — color = noise.

---

## Typography discipline

**Question text:** Cormorant Garamond is the system speaking — same family as View 1's hero composite + interpretation. Reinforces "this is the instrument."

| Use | Family | Size | Weight |
|---|---|---|---|
| Question text | Cormorant Garamond | 1.8rem | 300 |
| Progress label | Jost | 0.6rem uppercase, 0.22em letter-spaced | 400 |
| Anchor labels | Jost | 0.7rem | 300 |
| Toggle pill text | Jost | 0.95rem | 400 |
| Completion message | Cormorant Garamond italic | 1.2rem | 400 |
| Delta badge | Jost | 0.85rem | 400 |

---

## Animation discipline

**The flow is faster than View 1 or 2** — input mode wants momentum.

| Element | Animation | Why |
|---|---|---|
| Dot tap | Scale 1.0 → 1.1 → 1.0, 200ms | Tactile feedback |
| Selected dot | Fill from center outward, 250ms | Confirmation |
| Question slide out | translateX(-100%), 400ms ease | Direction = progress |
| Question slide in | translateX(0) from 100%, 400ms ease, 100ms delay | Continuation |
| Composite count-up | 0 → value, 1.0s ease-out | The reward |
| Delta badge appearance | Fade in + 8px translateY, 350ms ease, 600ms delay | Sequenced reward |
| Optional CTA fade | 350ms ease, 2s delay | Doesn't interrupt the moment |

**Total flow time** for typical 3-question check-in: ~25 seconds (5s read + 3s tap × 3 + 1s composite reward + 2s sit). Under the 30s threshold.

---

## Empty states

**Day 0 (first ever check-in):**
- Skip the "FRÅGA 1 / 3" progress label on first question
- Add a one-line intro before Q1: *"Tre frågor. ~30 sekunder. Sen ses vi imorgon."*
- After completion: extra context — *"Bra. Jag har börjat lyssna. Riktiga insikter aktiveras dag 14."*

**Re-entry after long absence (>14 days no check-ins):**
- Before Q1: *"Välkommen tillbaka. Jag har hållit din baseline — bara hoppa in igen."*
- Don't shame.

**Mid-day check-in:**
- Same flow. The check-in always overwrites today's row in `checkins`.

**Multiple check-ins per day:**
- Allowed. Each overwrites. Last write wins.
- Rationale: morning check-in might have been impressionistic; evening reflection is more accurate. No reason to lock either out.

---

## Microcopy tone

The questions themselves are the most carefully worded copy in the entire app. Each word matters.

**Principles:**
- **First-person from the system** ("Vi ses imorgon", "Jag har lyssnat") — research says embedded expert voice retains
- **Never directive** ("borde", "ska") — instrument voice, not coach voice
- **Specific over hedged** — "energin idag" not "din energinivå"
- **Calm completion phrases** (variable, never templated):
  - `Tack. Vi ses imorgon.`
  - `Bra. Sov gott.`
  - `Noterat. Imorgon igen.`
  - `Tack — det här hjälper.` (rare, used when AI detected the input was decision-relevant)
  - `Sex dagar i rad.` (only on streaks of 6, 14, 30, 100 — never daily)

**Avoid:**
- "Great!" / "Perfect!" / "Awesome!"
- "Don't forget!"
- "Build your streak!"
- Numeric scoring of the input ("you're crushing it")
- Comparative ("better than yesterday" — that's data, not feedback)

---

## What is NOT on this view (intentionally)

- ❌ More than 3 core questions
- ❌ Free-text fields in the core flow (deep journal can have them, core can't)
- ❌ Sliders (harder to tap precisely on mobile than dots)
- ❌ "Body part scan" or other hyper-detailed inputs (Whoop has these — too much friction for daily)
- ❌ Reminders to log other things ("don't forget to log your meals")
- ❌ Streak counter visible during the flow (interrupts focus)
- ❌ Tips / educational content (lives in Insights view)
- ❌ Validation of yesterday's prediction (lives in Insights view)

---

## Data model implications

The 3 core questions need to map cleanly to existing `checkins` schema:

**Already exists:**
- `energy` numeric(4,1) — Q1 (1–5 scaled to 2–10)
- `mood` numeric(4,1) — Q2 (1–5 scaled to 2–10)
- `moods` jsonb — Q3 (selected toggle pill names as array)

**No schema changes needed.** Server already maps `q1` → energy * 2, `q2` → boolean → 4 or 8 sleep, etc. The new flow just sends a different payload structure.

**Backward compatibility:** existing check-in.html keeps its longer form. The new View 3 IS the new flow but submits to the same `/api/checkin/submit` endpoint with a refined payload shape.

**Optional schema add (future):** for the "anything notable" toggle pills to be queryable separately, consider a `checkins.notable_tags text[]` column. For now, store in `moods` array.

---

## Edge cases & states

- **Mid-flow abandonment** (user closes app at Q2): no save. Treat as "didn't check in today." Returning later starts from Q1.
- **Network failure on submit:** show inline error, retry button. Don't drop the responses — keep in client state until success.
- **Permission denied / token expired:** redirect to login, then return to View 3 with state preserved (responses kept).
- **Already submitted today:** show "already checked in" state immediately, skip the question flow.
- **Time zone edge:** "today" is computed client-side as user's local date. If user crosses midnight mid-flow, accept the date when the flow STARTED.

---

## Acceptance criteria

A returning user opens the app at 07:32 with intent to check in. Within 30 seconds:
1. They've completed 3 questions
2. They've seen their composite update (the variable reward)
3. They've left the app feeling acknowledged, not interrogated

If they want to add more (deep journal), the option is there. If they don't, the door closed cleanly.

That's the bar. Not "comprehensive daily journal." A 30-second instrument with a calm reward at the end.
