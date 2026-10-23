# LIVE-NOTES — observationer under daglig användning

Kontinuerlig logg av friktioner, buggar, och saknade features upptäckta
genom faktisk användning av Forsyne. Sortera efter datum, nyaste högst upp.

---

## 2026-04-19

### 🐛 onboarding.html scroll-bug på iPhone Safari
- **Symptom:** Vissa skärmar i onboardingen kan inte scrollas på iPhone (kommer inte åt nedre halvan av innehåll)
- **Hypotes:** `onboarding.html` är inte migrerad till det nya design-systemet (mobile-first SPA, max-width: 430px, `.screen`-mönstret) — använder fortfarande gamla pre-2026-04-15 layouten med `max-width: 640px`
- **Workaround:** Gör onboardingen på desktop-browser
- **Riktig fix:** Migrera onboarding.html till samma SPA-mönster som `app/index.html`. Estimerat: 1-2h
- **Prio:** Inte blockerande — onboarding är engångsaktion. Kan vänta tills daglig-användning-flow är validerat.

### ✅ Första check-in fungerar end-to-end
- Webbformulär → POST /api/checkin/submit → Supabase
- Verifierat med direct REST-query: rad finns i `checkins`-tabellen
- Kolumn-encoding-bugg (ä → mojibake) fixad permanent genom rename till ASCII

