# Forsyne — Garmin-First Execution Plan

*Created 2026-04-19. The single execution document. Updated weekly.*

> **Mission, this phase:** Be the foresight layer that 100 paying Swedish Garmin-wearing endurance users open every morning before WWDC June 2026.

---

## ⚠ Strategisk pivot 2026-04-19

Efter MARKET.md-research och IDEA-FRAMEWORK.md-analys har vi pivoterat till **tvåtiers-arkitektur:**

- **Free tier — "Garmin-tolkaren":** 30 sek onboarding (email + Garmin OAuth), omedelbar smartare tolkning än Garmin Connect. Ingen check-in, ingen väntetid.
- **Premium tier — "Full Forsyne" (3 000 SEK/år):** Prediktion, chat, check-ins, lab, full briefing. Allt vi byggt idag.

Mellantier (check-in utan prediktion) byggs **inte**.

Detaljer i `TIERS.md`. North Star nedan uppdaterad för att reflektera både tiers.

---

## North Star Metric

**Antalet betalande (premium-tier) svenska endurance-användare.** Free-tier är acquisition-kanal, inte målvariabel.

| Milestone | Date | Premium paying | Free active |
|---|---|---|---|
| First paying user (founder) | 2026-04-19 | 1 | — |
| First paying non-founder user | 2026-05-15 | 5 | 50 |
| Aktivitus pilot active | 2026-06-01 | 15 (gratis under pilot) | 150 |
| Public soft-launch | 2026-07-01 | 50 | 500 |
| **Pre-WWDC target** | **2026-06-09** (WWDC starts) | **100** | 1 000 |
| Sustainability proof | 2026-09-01 | 250 | 2 500 |

**Kill switch:** Om vi inte når 50 betalande premium-användare till 2026-07-01 eller free-tier konvertering < 3 % — re-evaluera strategin (inte bara iterera — re-tänka).

---

## The 4 Phases

### Phase 0 — Foundation (Week 1-2, ending 2026-05-03)

**Goal:** Lock in everything that should NOT be in motion during execution. Get out of "deciding" and into "doing."

**Carl deliverables:**
- [ ] Sign founder agreement with co-founder (50/50, 4-year vest, 1-year cliff)
- [ ] USPTO + EUIPO + svensk PRV trademark check on FORSYNE (engage IP attorney)
- [ ] Domain DNS: point forsyne.app at Railway/Cloudflare deploy
- [ ] Set up Stripe for Sweden/EU subscriptions (1495 SEK/year, monthly option)
- [ ] Personal: complete first 14 days of own check-ins + Garmin imports

**Co-founder deliverables:**
- [ ] Verify scope of Garmin Connect IQ developer access (free tier limits, app store process)
- [ ] First conversation with Aktivitus management about pilot interest
- [ ] Audit current Forsyne tech-debt: identify the 3 biggest blockers to scaling beyond 10 users

**Joint:**
- [ ] Co-founders both use Forsyne daily for 14 days (eat your own dog food)
- [ ] Decide: solo Founder deploy on Railway vs. AWS/GCP from day 1
- [ ] Decide: Stripe Atlas LLC for US incorporation vs. Swedish AB only?

**Kill switch:** If Aktivitus shows zero interest after 2 conversations → reconsider Phase 1 entirely.

---

### Phase 1 — Aktivitus Pilot (Month 1-3, 2026-05 to 2026-07)

**Goal:** 15 Aktivitus elite athlete pilots using Forsyne weekly. Validate that the product actually works for serious endurance users.

**Carl:**
- [ ] Aktivitus formal partnership: free product for their elite roster in exchange for testimonials + structured feedback
- [ ] Build "Aktivitus Lab Integration" — VO2max + lactate threshold + body comp imports as biomarkers feeding the agents
- [ ] Weekly 1:1 with 3-5 most engaged athletes (15 min each, what works/sucks)
- [ ] Recruit 1 sport scientist as informal clinical advisor (pro bono or stock options)

**Co-founder:**
- [ ] Build Garmin Connect IQ data field: shows Forsyne composite score on watch face during run
- [ ] Submit to Garmin Connect IQ store (free distribution, ~2 week review)
- [ ] First call with Garmin via watch-chef warm intro: "We're building consumer AI for your data — what would partnership look like?"

**Joint:**
- [ ] Daily standup (15 min, every morning) — what shipped yesterday, blocker today
- [ ] Weekly retrospective with 1 Aktivitus athlete (not just data, real conversation)

**Success criteria for Phase 1 exit:**
- 15 weekly active Aktivitus pilot users
- 5 of them have run 30+ days each
- Connect IQ widget live in store
- 1 formal Garmin call completed

**Kill switch:** If <8 weekly active by month 3, the pilot model isn't working — pivot to direct Swedish endurance community marketing.

---

### Phase 2 — Garmin Connect Wedge (Month 2-4, parallel with Phase 1)

**Goal:** Be the product that Garmin users discover ON their device, not via marketing.

**Co-founder primary:**
- [ ] Connect IQ widget v1: shows daily composite + 1-line interpretation
- [ ] Connect IQ data field: composite + recovery trend during workouts
- [ ] Connect IQ watchface: minimal Forsyne face for Fenix/Forerunner premium users
- [ ] Push notification integration: "Forsyne predicts crash in 48h" from server → Garmin device alert

**Carl:**
- [ ] Garmin partnership pitch deck (10 slides max): 
  - Problem (Garmin's AI blind spot)
  - Solution (Forsyne IS the AI layer)
  - Traction (Aktivitus pilot)
  - Ask (technical partnership / API access / pilot in Garmin store / acquisition discussion)
- [ ] Quarterly check-in with watch-chef contact (don't ask for anything, just update them)
- [ ] Apply for Garmin Connect Developer Program "Featured" status

**Success criteria:**
- Connect IQ widget at 1000+ installs by month 4
- 1 in-person meeting with Garmin Connect IQ team
- Forsyne mentioned in any Garmin-community publication

**Kill switch:** If Garmin partnership conversations stall completely, Connect IQ widget becomes the de-facto distribution channel. Continue solo.

---

### Phase 3 — Swedish Endurance Launch (Month 3-6, 2026-07 to 2026-10)

**Goal:** 100 paying Swedish users before WWDC June 2026 narrative dominates. Prove unit economics.

**Carl primary:**
- [ ] Pricing live: 1495 SEK/year with 30-day free trial, monthly 199 SEK/mo option
- [ ] Aktivitus case study published (with metrics: how the pilot went)
- [ ] Swedish endurance community marketing:
  - Run4Fun, Tjurruset, Vasaloppet community partnerships
  - 5 podcast appearances (Lopplabbet, Träningstoppen, etc.)
  - Instagram + Strava community engagement
- [ ] First 10 paid customer interviews (1 hour each, structured)

**Co-founder primary:**
- [ ] Production-grade reliability: 99.5% uptime, zero data loss
- [ ] Sentry alerts to phone: every 500 error gets investigated within 2h
- [ ] Performance: app loads <2s on 3G

**Joint:**
- [ ] Forsyne PWA install prompt on iOS (Add to Home Screen flow)
- [ ] Apple HealthKit read access (pull data from those who have iPhone but no Garmin sync)
- [ ] Decision: solo continue OR raise seed round?

**Success criteria:**
- 100 paying Swedish users
- <5% monthly churn
- NPS >50 from first 30-day cohort
- 10+ user-generated testimonials/screenshots

**Kill switch:** Below 50 paying users → fundamental pivot. Below 50% trial→paid conversion → pricing is wrong.

---

### Phase 4 — Validate Exit Positioning (Month 6-12, 2026-10 to 2027-04)

**Goal:** Be acquirable. Or be sustainable enough to stay independent.

**Carl primary:**
- [ ] First Garmin executive pitch (not buy-us, just "what would partnership look like?")
- [ ] Apple Health App Store curation outreach (if PWA deployed via TWA wrapper)
- [ ] First angel/seed investor conversations (only if 500+ users)
- [ ] Hire #1: senior engineer or growth marketer (which depends on what's bottlenecking)

**Co-founder primary:**
- [ ] EU AI Act compliance audit (becomes required mid-2026)
- [ ] Multi-region deploy (Sweden + Germany + UK)
- [ ] Multi-agent UX surfaced: "ask the metabolism agent" feature live

**Decision gate at month 12:**
- 500+ paying users + sustainable economics → independent path, slow growth, optionality preserved
- Acquisition interest from Garmin/Apple/Microsoft → evaluate term sheet
- Below 200 paying users → real evaluation: is the thesis wrong?

---

## Roles & ownership

| Domain | Carl | Co-founder | Both |
|---|---|---|---|
| Product strategy | ✅ Lead | Input | |
| UX/design | ✅ Lead | | |
| Tech architecture | | ✅ Lead | |
| Backend/infra | | ✅ Lead | |
| Frontend implementation | Input | ✅ Lead | |
| Aktivitus relationship | ✅ Lead | Input (via watch contact) | |
| Garmin partnership | ✅ Lead | Input (technical credibility) | |
| Marketing/sales | ✅ Lead | | |
| Sport science / clinical | ✅ Lead | | |
| Customer interviews | ✅ Lead | | |
| Daily standup | | | ✅ Both |
| Strategic decisions | | | ✅ Both, equity = veto power |

---

## Operating rhythm

**Daily (Mon-Fri):**
- 09:00 — 15-min standup. What I shipped yesterday. What I'm doing today. Blockers.
- Both founders use Forsyne live (check-in, view data)

**Weekly (Friday):**
- 16:00 — 1h retrospective. What went well, what didn't. Re-prioritize next week.
- Update PLAN.md if scope/dates need adjustment.

**Monthly (last Friday):**
- 4h strategy session. Review North Star numbers vs targets. Phase-gate review.
- Decide: continue current phase, escalate, or pivot.

**Quarterly:**
- Full review of competitive landscape (re-read COMPETITORS.md, update if needed).
- Founder-level conversation: are we still aligned on vision + roles?

---

## What we are NOT doing in 2026

Be ruthless about scope. Not doing means saying yes to focus.

- ❌ B2B enterprise sales (ONVY/Vanta own this)
- ❌ Building our own bloodwork lab (Function owns this — ingest theirs)
- ❌ Building our own ring/band (Oura/Whoop/Garmin own this)
- ❌ US market launch (EU-first; US is Phase 5+)
- ❌ Apple Watch native app (PWA is enough until 500+ users)
- ❌ Multi-language (Swedish + English only; German is Phase 5+)
- ❌ B2B clinical partnerships beyond Aktivitus
- ❌ Hardware (forever; we're software)
- ❌ Token/Web3/blockchain (no)

---

## Risk register

| Risk | Likelihood | Severity | Mitigation | Owner |
|---|---|---|---|---|
| Apple ships Health+ at WWDC June 2026 | Medium | Catastrophic | Have product live + 100 paying users by then; emphasize cross-platform | Carl |
| Garmin partnership stalls | High | Moderate | Connect IQ widget = de facto distribution; doesn't require formal partnership | Co-founder |
| Function/Superpower expand to EU | Medium | Large | Ship faster, be Swedish-native, lock in Aktivitus relationship | Carl |
| Solo-founder bandwidth (now 2-founder) | Reduced from High to Medium | Moderate | Co-founder solves 50%; consider hire #1 by month 6 | Both |
| Trademark conflict on FORSYNE | Unknown | High | IP attorney check Phase 0 — don't invest before clear | Carl |
| Aktivitus interest fades | Medium | Large | Diversify pilot recruitment by month 3 (running clubs, triathlon teams) | Carl |
| Tech-debt drowns velocity | Medium | Moderate | Co-founder audit Phase 0; refactor server.js mid-Phase 1 | Co-founder |
| Burnout (founders) | Medium | High | 1 day/week off, no exceptions; vacation in August | Both |

---

## What "win" looks like at end of 2026

- 250+ paying Swedish users
- Connect IQ widget at 5k+ installs
- 1 formal Garmin partnership conversation completed
- Forsyne-as-noun in Swedish endurance community vernacular
- Founders both well, together, still aligned
- Optionality: can choose to raise, sell, or stay independent

---

## When to revisit this plan

- Weekly retrospective (Friday)
- After every major external event (WWDC, Garmin announcement, competitor raise)
- When North Star metric is >20% off target for 2 weeks
- When something fundamental changes (Aktivitus pulls out, Apple ships, key hire)

The plan is a hypothesis, not a contract. Update it when reality teaches you something.

---

*"Du märker det om 72 timmar. Vi ser det nu." — Forsyne*
