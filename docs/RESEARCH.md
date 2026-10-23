# Forsyne Dashboard Research

*Compiled 2026-04-18 to inform 4-5 main view design for the Forsyne iPhone app.*

## TL;DR (≈200 words)

The dashboard for Forsyne should reduce 20+ wearable signals to **one composite "today" answer + one trend + one journal/check-in + one alert/insight**, not a metric grid. The science is consistent: morning **HRV trend** (RMSSD vs personal baseline, not single readings — Altini, Plews) and **resting heart rate deviation** are the two best objective predictors of impending illness, fatigue, and overreaching, and they detected ~60–88% of COVID infections 4–9 days before symptoms (Stanford/Mishra, *Nature Biomed Eng*). But the systematic-review consensus (Saw et al. 2016) is unambiguous: **subjective self-report (mood, soreness, sleep quality, motivation) outperforms HRV alone** for daily monitoring of overreaching — meaning a 30-second daily check-in is not "soft data" but the highest-yield input you can collect. **Sleep regularity beats sleep duration** as a mortality and recovery predictor (Windred 2024, UK Biobank, n=60,977). On the engagement side: ~53% of mHealth apps are uninstalled within 30 days and 70% by day 100; the apps that survive (Whoop, Oura, Headspace) all share the same morning ritual — *one number on top, one sentence of meaning, one suggested action, hidden depth on tap*. The dashboard's job is to make the best-evidence metrics also be the most engaging surface — not to expose the underlying complexity.

---

## What users actually engage with daily

**Whoop (the three-pillar pattern):**
Whoop's published member averages page and product docs confirm the daily ritual centers on three numbers: **Recovery (avg 58%), Strain (avg 11.0/21), Sleep performance (avg 82%)**. HRV (avg 64 ms) and RHR (avg 56 bpm) are secondary "explainers" inside the Recovery card — users open to the score, not the underlying physiology. ([WHOOP member averages](https://www.whoop.com/us/en/thelocker/member-averages-recovery-strain-sleep-hrv/))

**Oura (composite scores → trend balance):**
Oura's Readiness Score collapses 7 contributors (sleep, sleep balance, prev day activity, activity balance, RHR, HRV balance, body temp, recovery index) into a single 0–100 number. Crucially, Oura emphasizes **balance/trend contributors** ("HRV Balance" — last 14 days vs 90-day baseline) over the absolute morning value — directly mirroring what HRV science says is the right unit of analysis. ([Oura readiness score](https://ouraring.com/blog/readiness-score/))

**Garmin (Body Battery + Training Readiness):**
Garmin Connect's most-discussed daily features are **Body Battery (0–100 energy gauge)** and **Training Readiness** — both composites of HRV, sleep, stress, and recent training load. Forum traffic shows users primarily compare these two against subjective feel rather than reading underlying HRV/RHR. ([Garmin Body Battery](https://www.garmin.com/en-US/garmin-technology/health-science/body-battery/))

**Cross-app pattern:** Every successful wearable hides physiology behind a 0–100 composite, surfaces a 14-to-90-day trend underneath, and adds a behavior journal layer. None of them lead with raw HRV in milliseconds.

**Whoop Journal (behavior tracking) — what users actually correlate:**
Whoop's published correlation data identifies the journal items most associated with recovery change: **alcohol** (-17% recovery, -13 ms HRV, -20 min sleep on drinking nights), **late caffeine**, **screen time before bed**, **blue-light glasses (positive)**, and **>85% sleep performance (positive)**. ([WHOOP alcohol data](https://www.whoop.com/us/en/thelocker/how-alcohol-negatively-impacts-your-biometic-data/), [WHOOP Journal](https://www.whoop.com/us/en/thelocker/the-whoop-journal/))

---

## What experts say matters most

Top 5–7 metrics with research backing for predicting health/performance dips:

1. **HRV trend (RMSSD vs personal baseline, weekly average + CV)** — Altini, Plews, Buchheit. RMSSD is the most parasympathetically pure HRV metric. *The trend matters, not the daily value.* Plews recommends 3–4 morning measurements per week; weekly average + coefficient of variation captures both chronic adaptation and acute stress. Acting on a single low day is statistical noise — Galpin's rule of thumb: act when ≥5% below baseline for 5+ consecutive days. ([Plews/Buchheit Frontiers 2014](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2014.00073/full), [Altini Ultimate Guide](https://marcoaltini.substack.com/p/the-ultimate-guide-to-heart-rate))

2. **Resting heart rate deviation from personal baseline** — Stanford/Snyder Lab COVID studies (Mishra et al., *Nature Biomed Eng* 2020). RHR elevation detected 63–88% of infections 4–9 days *before* symptom onset. Median anomaly was +7 bpm above personal baseline. Cheaper to collect than HRV and equally predictive of acute illness. ([Mishra 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC9020268/))

3. **Sleep regularity (SRI), not sleep duration** — Windred et al. 2024, UK Biobank, n=60,977, *SLEEP* journal. Top SRI quintile had **20–48% lower all-cause mortality** vs lowest, and SRI beat duration in nested models. Sleep regularity is also more actionable than duration — easier to fix bedtime drift than to manufacture an extra hour. ([Windred 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10782501/))

4. **Subjective wellness (mood, soreness, motivation, perceived recovery)** — Saw, Main, Gastin 2016 systematic review (BJSM). **Subjective measures showed superior sensitivity to acute training load changes than HRV, CK, salivary cortisol, or any objective marker tested.** Subjective and objective measures generally did not correlate — which means a daily 4-question check-in is *not redundant* with the wearable, it is additive and arguably more informative. ([Saw 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4789708/))

5. **Sleep architecture (REM and deep proportions, secondary to total + regularity)** — Walker. Both REM and NREM are essential; cutting either degrades cognitive, emotional, and physical recovery. Walker emphasizes you cannot optimize one stage in isolation — total + regularity gates the architecture. ([Walker on REM/NREM](https://www.foundmyfitness.com/episodes/rem-sleep-deep-sleep-cardiovascular-and-emotional-health))

6. **Cumulative training/strain load (ACWR — acute:chronic workload ratio)** — applied across Whoop's Strain, Garmin's Training Load, and sports science. Spikes in the 7-day load relative to 28-day baseline predict injury and illness risk. The composite "are you overdoing it?" signal users actually find decision-relevant.

7. **Steps for cardiometabolic risk (but with the right number)** — Lancet Public Health meta-analysis (Ding et al. 2025) and Banach 2022. **7,000 steps captures ~80% of the mortality and CV benefit; 10,000 is marketing, not science.** Useful as a behavioral floor, not a daily achievement target. ([Lancet 2025](https://www.thelancet.com/journals/lanpub/article/PIIS2468-2667(25)00164-1/fulltext))

---

## The intersection — the dashboard core

| Metric | User engagement | Expert validation | Why on main view |
|---|---|---|---|
| **Composite "Today" score (0–100)** | Highest. Every successful app (Whoop Recovery, Oura Readiness, Garmin Body Battery) leads with it. | Strong if built from validated inputs (HRV trend, RHR deviation, sleep regularity, subjective check-in). | The single answer to "should I push or rest today?" — bypasses metric overload. |
| **HRV trend (not value)** | Medium-low — users find raw HRV confusing. High when shown as a sparkline trend or balance arrow. | Highest objective predictor when used as personal-baseline trend (Altini, Plews). | Core engine of the composite. Surface as trend arrow + 14-day sparkline, never as raw ms on the main view. |
| **Sleep score with regularity emphasis** | Very high (Oura's #1 driver of returning). | Sleep regularity > duration (Windred 2024). | Make regularity the top contributor card, not duration. |
| **Subjective check-in (≤30s)** | Variable — depends on friction. Whoop's Journal shows users *do* engage when correlations are surfaced. | Highest sensitivity to acute change (Saw 2016). | Required input to predict "energy crash in 72h" thesis — the wearable alone won't see motivation drops. |
| **Today's suggested action (one line)** | High. "Take it easy today" beats a chart. | Maps to Fogg's prompt + James Clear's "make it obvious." | Converts insight into behavior — without this, the score is a vanity number. |
| **Recent crash/illness alert** | Highest engagement when present (anomaly detection). | Strong — RHR/HRV anomaly detection is the single biggest clinically validated signal (Mishra 2020). | This is Forsyne's differentiator: "Du märker det om 72 timmar. Vi ser det nu." Make the alert visually distinct (color + shape, per NN/g). |
| **Behavior correlations (weekly view, not daily)** | Whoop's Monthly Performance Assessment is one of its highest-rated features. | Whoop journal data + Saw 2016 — behaviors are the only causal levers users control. | Lives one tap below the dashboard, surfaced by AI agent when a strong correlation emerges. |

---

## Anti-patterns: high engagement, low signal

These are surfaces users *want* to see but experts rate as noise. Demote them — show on a secondary view, not the morning open.

- **Daily step count as a "health goal."** 10,000 is a 1960s Japanese marketing number; mortality benefits plateau at ~7,000 (Lancet 2025). Treating step count as the headline metric trains users to optimize a weak proxy. Show as a contextual sparkline, not a hero. ([Lancet meta-analysis](https://www.thelancet.com/journals/lanpub/article/PIIS2468-2667(25)00164-1/fulltext))
- **Single-day raw HRV in milliseconds.** Day-to-day HRV variability is so high that single readings are statistical noise (Altini). Surfacing a number like "HRV: 47 ms" without trend context creates anxiety, not insight, and is the single most cited reason engineers/biohackers churn off wearables.
- **Calorie burn estimates from wrist optical sensors.** Notoriously inaccurate (Stanford wearable validation studies show ±27–93% error). High user engagement, near-zero clinical validity.
- **Deep sleep / REM minutes as standalone optimization targets.** Walker emphasizes both stages are required — cutting either is bad — but consumer apps can mislead users into chasing "more deep sleep" through supplements or rituals that just shift architecture without improving outcomes. Show stages as composition, not as a leaderboard.
- **VO2max from wrist devices day-to-day.** Changes too slowly (weeks-to-months) to warrant daily attention. Belongs in a quarterly view.
- **Stress score (continuous).** Garmin/Fitbit "stress" scores are largely RHR/HRV in disguise, double-counting what's already in the composite. Confuses more than clarifies.

---

## The gap: high signal, low engagement

These are research-validated metrics users routinely ignore. **Good design earns its keep here** — making important data engaging.

- **HRV trend (not value).** Users glaze over at "RMSSD baseline ±2 SD." Design solution: show as a 14-day arrow ("Recovering" / "Strained" / "Plateau") with sparkline, never as a number-of-the-day. Oura's "HRV Balance" framing is the proven UX pattern.
- **Sleep regularity / SRI.** Strongest mortality predictor in sleep research (Windred 2024) but virtually no consumer app surfaces it as a hero metric. Design solution: a single visual — "your bedtime drift this week was ±43 min" — paired with a target window. This is a wide-open differentiator.
- **Subjective check-in compliance.** Highest signal-per-question of any input (Saw 2016) but compliance collapses when check-ins exceed ~30 seconds. Design solution: 3 questions max, anchored to the morning open (Fogg's "anchor to existing routine"), one tap each, immediate visual reward (the composite score updates live as they answer).
- **Acute:chronic workload ratio.** Predicts injury risk but is hidden inside Garmin/Whoop strain. Design solution: a "load weather" metaphor (today vs your normal) on the composite card.
- **Heart rate recovery after exercise.** Strong cardiovascular fitness marker, almost never surfaced. Design solution: passively detect post-workout, show a single trend line over months.
- **Body temperature trend (skin temp from Oura/Whoop).** Detects illness 1–2 days before symptoms (and in menstruating users, validates cycle phase). Underused. Design solution: include in the alert/anomaly engine, surface only when deviating.

---

## Information hierarchy patterns from successful apps

Concrete observations from product teardowns, NN/g research, and published design articles:

**The morning-open ritual (Whoop / Oura / Headspace):**
- **First screen, top of viewport:** one composite number + one sentence of meaning. Whoop's Recovery (color-coded green/yellow/red ring), Oura's Readiness with a single contextual line ("Your readiness is good. Take advantage of it."), Headspace's "Today's recommended meditation" anchored to time-of-day.
- **Second band (above the fold):** one trend line or one delta vs yesterday/baseline. Never raw values.
- **Third band:** the day's suggested action (one line, dismissible). Maps to Fogg B=MAP — the prompt is the screen.
- **Hidden depth:** every metric expands on tap to its underlying contributors and 14/90-day trend. Stripe's design philosophy ("show the minimum, allow drill-down") is the operative pattern. ([Stripe iPhone teardown](https://medium.com/swlh/exploring-the-product-design-of-the-stripe-dashboard-for-iphone-e54e14f3d87e))

**What's animated:**
- The composite score number on load (subtle count-up — variable reward, per Eyal's Hook Model).
- The trend arrow when crossing a threshold.
- Streaks (Headspace's most retention-positive element). Avoid streak-shame on miss — use Headspace's "non-shareable" approach to prevent anxiety spirals.

**What's hidden:**
- Raw HRV ms, raw RHR bpm, raw sleep stage minutes.
- Settings, integrations, history calendar.
- Behavior journal entry (one tap to access — Whoop hides it behind a "+" icon).

**NN/g preattentive principles applied** ([NN/g dashboards article](https://www.nngroup.com/articles/dashboards-preattentive/)):
- Use length (bar charts) and 2D position (line graphs) for quantities. Avoid radial gauges, donuts, 3D — they kill scannability.
- Combine color *and* shape for status (8% of men colorblind; color alone fails accessibility).
- Most important info upper-left or screen-center; user attention drops sharply outside the F-pattern.

---

## Retention / abandonment findings

The blunt numbers, with sources:

- **~53% of mHealth apps are uninstalled within 30 days.** ([JMIR scoping review 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11694054/))
- **70% median abandonment by day 100.** Same source.
- **Headspace and Calm — the gold-standard wellness retention case — still struggle to break 8.5% Day-30 retention** in independent benchmarks. Even the best is leaky. ([Headspace gamification case study](https://trophy.so/blog/headspace-gamification-case-study))
- **Domain matters:** alcohol apps 95–97% abandonment, mental health 89–92%, diet 86%, physical activity 54–75%. ([JMIR review 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11694054/))

**The 6 most-cited reasons users abandon** (from the JMIR 2024 review):
1. Technical/functional issues (sync failures, data loss, mandatory account creation)
2. Privacy concerns (especially for biological/genetic data — relevant to Forsyne)
3. Poor UX (confusing interfaces, annoying notifications)
4. Content/features (lack of personalization, no expert guidance)
5. Time/financial cost (data-entry burden, hidden fees)
6. Goal achievement OR motivation loss

**What works to retain:**
- **Personalization that visibly adapts.** Headspace personalizes the home screen based on last session, time of day, history — users see the app "remember" them. ([StriveCloud on Headspace](https://www.strivecloud.io/blog/headspace-gamification-features))
- **Streaks without shame.** Headspace deliberately omits social sharing of streaks to avoid comparison anxiety in a mental-health context. Forsyne is health-context — same logic applies.
- **Variable reward** (Eyal Hook Model). The morning composite must occasionally surprise — a "today is exceptional" or a "watch out, anomaly detected" — or users habituate and stop opening.
- **In-app expert/coach voice.** Apps with embedded professional content retain longer (JMIR review). For Forsyne, the AI agent's interpretation IS the coach.
- **Reduce data-entry friction below 30 seconds.** The dominant cost driver in abandonment of journal-based apps.

---

## Behavioral change findings

What makes a metric or insight **actionable** vs ignored:

**Fogg Behavior Model: B = M × A × P** ([Fogg model](https://www.behaviormodel.org/))
- An insight only triggers a behavior if **Motivation × Ability × Prompt** all align in the same moment.
- The biggest leverage in app design is **Ability** — make the action trivially easy. "Drink water" is more actionable than "improve hydration."
- The morning open IS the prompt. Don't waste it on a chart.

**Atomic Habits (Clear): cue → craving → response → reward**
- Cue: scheduled morning notification at consistent time.
- Craving: anticipation of "what's my number today?" (variable reward — Eyal).
- Response: ≤3 taps to log check-in.
- Reward: composite updates instantly + visual streak + sometimes an insight ("you slept better when you skipped late caffeine 4 of last 5 times").

**Wendy Wood — habits are context-cue driven, not goal-driven.**
~43% of daily behavior is habit (not deliberate). Habits form when a response is repeated in a stable context until the cue alone triggers the action. **App takeaway:** the morning open ritual must be the same time, same place, same first screen — variability kills habit formation. ([Wood 2016 review](https://pubmed.ncbi.nlm.nih.gov/26361052/))

**What separates "actionable" from "vanity":**
- **Actionable:** specific, time-bound, within user control. "Move your bedtime 15 min earlier this week — your sleep regularity is in the bottom quartile."
- **Vanity:** global, abstract, comparative. "Your sleep score is 78."
- The Forsyne thesis ("we see it 72h before you do") is inherently actionable — the alert IS the action prompt. Don't dilute it with passive metrics.

**CGM as a behavior-change exemplar:** 87% of CGM users change food choices based on glucose feedback; nearly half exercise more after seeing a spike. The pattern: **immediate, personal, causal feedback drives behavior change.** Forsyne can engineer the same loop — log behavior → see physiological response within 24h. ([CGM behavioral change](https://thrombosis.org/patients/patient-articles/continuous-glucose-monitoring-for-non-diabetics-a-new-frontier-in-metabolic-health-optimization))

---

## Recommendations for the 4–5 main views

Translating research into concrete IA. Mobile-first, max-width 430px.

### View 1 — **Today** (the morning open / hero)
The single screen 90% of opens land on. Answers: *"How am I, what should I do, what's coming?"*

- **Hero band:** composite score (0–100) + one-line interpretation generated by the AI agent. Color ring (green/yellow/red) but with shape redundancy for accessibility.
- **Why band:** 3 contributor chips (e.g., "HRV trending down 4 days," "Slept 5h45," "Reported low energy"). Tap → contributor detail.
- **Action band:** one suggested action ("Skip the hard workout. Walk + protein-rich lunch.") — generated by AI, dismissible, with a "log it" tap that records compliance.
- **Alert band (conditional):** anomaly card if RHR/HRV/temp deviates from baseline. THIS is the differentiator surface — design it to feel like a calm, consequential signal, not a panic alert. The 72h-prediction thesis lives here.

### View 2 — **Trends**
Answers: *"What's actually happening to me over weeks/months?"*

- 4–6 sparkline tiles: composite score, HRV balance, RHR delta, sleep regularity (SRI), training/strain load, subjective wellness average.
- Each opens to a 14-day / 90-day / 1-year detail view with annotations (life events, illnesses, travel, cycle phase).
- Avoid raw values as headlines — always show as deltas or balance arrows.

### View 3 — **Check-in** (the daily journal)
Answers: *"What does the AI need from me to be smart?"*

- 3 questions max, ≤30 seconds total. Suggested set:
  1. Energy (1–5)
  2. Mood (1–5)
  3. One toggle: anything notable? (alcohol, late caffeine, travel, illness, training, period)
- Live update: as user answers, the composite score on View 1 nudges. Immediate reward = compliance.
- Optional deep journal (300+ behaviors, Whoop-style) one tap below — for power users.

### View 4 — **Insights** (the AI agent surface)
Answers: *"What patterns has the system found that I'd never find?"*

- Card stream: ranked AI-generated insights with confidence + data ("Your HRV drops 12 ms on average the day after >2 drinks. n=14 nights, p<0.01.").
- Each insight has: pattern statement, evidence chart, suggested action, "act on this" button (sets a reminder/journal tag).
- Weekly digest pinned at top — Whoop's Monthly Performance Assessment is the closest existing analog and one of their highest-rated features.
- This is where biological tests (DNA, blood, hormones, CGM) get integrated — not as separate metric pages but as context the AI cites in its insights ("your low ferritin from March bloodwork is consistent with the persistent fatigue trend").

### View 5 — **Profile / Body** (slow-changing baseline)
Answers: *"What's the biological me?"*

- Static-ish baseline data: bloodwork results, DNA, baseline HRV/RHR, body composition.
- Updates monthly-quarterly, not daily.
- Lives behind a tab so it doesn't compete for daily attention but is always accessible when an insight references it.

**Notably absent from main views:** step count, calorie burn, raw HRV ms display, sleep stage minutes as headline. These exist in tier-3 detail views, not the front door.

---

## Sources

1. [Plews & Buchheit — Monitoring training status with HR measures (Frontiers in Physiology, 2014)](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2014.00073/full) — HRV protocol: 3–4x/week morning, weekly average + CV, trend over single readings.
2. [Marco Altini — The Ultimate Guide to HRV (Substack)](https://marcoaltini.substack.com/p/the-ultimate-guide-to-heart-rate) — RMSSD as primary metric, baseline trend over absolute values.
3. [Marco Altini — Week 6: Using The Right Metric](https://hrv4training.substack.com/p/week-6-using-the-right-metric) — measurement consistency protocol.
4. [Mishra et al., *Nature Biomedical Engineering* 2020 — Pre-symptomatic detection of COVID-19 from smartwatch data](https://pmc.ncbi.nlm.nih.gov/articles/PMC9020268/) — RHR anomaly detected 63–88% of cases 4–9 days before symptoms.
5. [Saw, Main, Gastin — Subjective self-reported measures trump commonly used objective measures (BJSM 2016)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4789708/) — systematic review: subjective wellness > HRV/CK/cortisol for monitoring acute training response.
6. [Windred et al. 2024, *SLEEP* — Sleep regularity stronger predictor of mortality than duration (UK Biobank, n=60,977)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10782501/) — SRI top quintile = 20–48% lower mortality.
7. [Matthew Walker on REM and deep sleep (FoundMyFitness)](https://www.foundmyfitness.com/episodes/rem-sleep-deep-sleep-cardiovascular-and-emotional-health) — both stages essential, neither can be optimized in isolation.
8. [Ding et al., Lancet Public Health 2025 — Daily steps and health outcomes meta-analysis](https://www.thelancet.com/journals/lanpub/article/PIIS2468-2667(25)00164-1/fulltext) — 7,000 steps captures most benefit; 10,000 is marketing.
9. [Kellmann — Preventing overtraining: stress/recovery monitoring (Scand J Med Sci Sports 2010)](https://onlinelibrary.wiley.com/doi/10.1111/j.1600-0838.2010.01192.x) — RESTQ-Sport psychometric basis for subjective monitoring.
10. [Whoop member averages and metric explainers](https://www.whoop.com/us/en/thelocker/member-averages-recovery-strain-sleep-hrv/) — published averages for Recovery (58%), Strain (11.0), Sleep (82%), HRV (64 ms), RHR (56 bpm).
11. [Whoop alcohol impact data](https://www.whoop.com/us/en/thelocker/how-alcohol-negatively-impacts-your-biometic-data/) — quantified -17% recovery, -13 ms HRV, -20 min sleep correlations from journal data.
12. [Whoop Journal — behavior tracking framework](https://www.whoop.com/us/en/thelocker/the-whoop-journal/) — 300+ trackable behaviors, correlation-based feedback after 5+ entries.
13. [Oura Readiness Score breakdown](https://ouraring.com/blog/readiness-score/) — 7-contributor composite, balance contributors over absolute values.
14. [Garmin Body Battery technology page](https://www.garmin.com/en-US/garmin-technology/health-science/body-battery/) — energy gauge composite of HRV/stress/activity.
15. [JMIR 2024 — Why adults abandon mHealth apps (scoping review)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11694054/) — 53% drop in 30 days, 70% in 100 days, 6 abandonment categories.
16. [Headspace gamification & retention case study (Trophy)](https://trophy.so/blog/headspace-gamification-case-study) — streaks, non-shareable design, 8.5% Day-30 ceiling.
17. [BJ Fogg — Behavior Model B = MAP](https://www.behaviormodel.org/) — motivation, ability, prompt convergence.
18. [Wendy Wood — Psychology of Habit (Annual Review of Psychology 2016)](https://pubmed.ncbi.nlm.nih.gov/26361052/) — context-cue automaticity, ~43% of daily behavior is habitual.
19. [Nir Eyal — The Hook Model (nirandfar.com)](https://www.nirandfar.com/how-to-manufacture-desire/) — trigger, action, variable reward, investment loop.
20. [Nielsen Norman Group — Dashboards: Preattentive Visual Processing](https://www.nngroup.com/articles/dashboards-preattentive/) — bar/line/2D-position over radial/3D; combine color + shape; accessibility.
21. [Stripe iPhone Dashboard product teardown (Medium)](https://medium.com/swlh/exploring-the-product-design-of-the-stripe-dashboard-for-iphone-e54e14f3d87e) — minimum-info-first, drill-down depth, calm technology.
22. [CGM behavioral change for non-diabetics (Vasculearn / Stelo)](https://thrombosis.org/patients/patient-articles/continuous-glucose-monitoring-for-non-diabetics-a-new-frontier-in-metabolic-health-optimization) — 87% change diet from CGM feedback; immediate-feedback loop as behavior-change template.

---

*Conflict noted: HRV is the most-cited objective recovery metric, but the strongest systematic review (Saw 2016) finds subjective wellness questionnaires outperform it for daily training monitoring. Resolution: use HRV as the slow trend baseline, subjective check-in as the daily acute signal, composite both — neither alone is sufficient.*
