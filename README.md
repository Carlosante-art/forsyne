# Forsyne

> A system that gets to know you well enough to predict — because it already knows how *you* work.

Forsyne builds a living model of one person from daily check-ins, wearables, blood work, DNA, nutrition and medical history, and uses a set of specialised LLM agents to find the connections a person can't see themselves: Monday's food showing up in Wednesday's energy, Friday's stress in Sunday's sleep. Most health apps report what happened. Forsyne tries to say what happens next, and checks itself against what actually did.

Built by Carl Karjalainen Joels with Claude Code. Product, agent design and architecture are mine. The product docs in `docs/` are in Swedish.

## What it does

- **Conversational onboarding** instead of forms, then a **60-second daily check-in** generated per person.
- **14 specialist agents** (`agents/`), each with its own system prompt: check-in, insights, prediction, data sources, blood & hormones, DNA, nutrition, balance, medical journal, morning briefing, chat, Garmin interpreter and retrospective analysis. A meta-agent (`prompts/meta_agent.md`) coordinates them.
- **Prediction with a feedback loop.** Predictions are stored, validated against what the user later reports, and the validations feed back into the next run.
- **Morning briefing** at 07:00 by cron and e-mail.
- **Lab uploads:** blood tests, DNA and nutrition reports parsed from PDF.
- **Integrations:** Strava and Dexcom (OAuth2), Garmin (FIT file import), Terra.
- **Coach view (B2B2C):** a coach can follow their athletes' insights, read-only.

## Architecture

```
server.js            Express 5 backend: ~120 routes, agent orchestration, cron jobs
auth.js              Supabase JWT auth and token refresh (client side)
agents/ prompts/     System prompts for the specialist agents and the meta-agent
app/                 Mobile-first app views (today, check-in, trends, insights, chat, lab)
*.html               Landing, onboarding, data pages, coach dashboard (vanilla JS, no build step)
migrations/          SQL migrations, applied in date order
supabase_schema.sql  Tables, indexes and RLS
scripts/             Persona simulation and prompt tuning (simulate.js, tune.js)
tests/               Vitest smoke tests
docs/                Vision, strategy, market, roadmap and test plan (Swedish)
```

## Stack

| Layer | Choice |
|---|---|
| Backend | Node.js, Express 5, node-cron |
| Database & auth | Supabase (Postgres, Auth, row-level security) |
| AI | Claude API, with prompt caching on the chat agent |
| Frontend | Vanilla JS and HTML, multi-page, PWA manifest |
| Files | Multer and pdf-parse |
| E-mail | Resend |
| Ops | Railway, Cloudflare, Sentry |

## Security

- Supabase JWT checked on every private endpoint; RLS on all user-data tables.
- Profile data encrypted at rest (`ENCRYPTION_KEY`).
- Rate limits on auth, check-in and journal endpoints; Helmet; HTTPS redirect in production.

## Simulation and tuning

`scripts/simulate.js` runs synthetic personas (athlete, sedentary, stressed and so on) through weeks of simulated check-ins against the real agents, and `scripts/tune.js` uses the results to revise the meta-agent prompt. This is how the prompts were tested before any real user saw them.

## Run it locally

```bash
npm install
cp .env.example .env     # SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, ENCRYPTION_KEY
# run supabase_schema.sql and then migrations/*.sql in the Supabase SQL editor
npm run dev              # http://localhost:3000
```

Set `MOCK_AI=true` to develop without Claude API calls.

```bash
npm test
```

## Status

Phase 1: prove that the insights land. The one metric that matters: after 30 days, the user reads an insight and thinks *"how did it know?"*

## License

Proprietary. See [LICENSE](LICENSE).
