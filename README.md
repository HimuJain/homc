# HOMC — AI-Powered A/B Testing Simulator

> Run AI personas through two UX variants. Detect friction. Find your winner — before spending a dollar on real traffic.

---

## Team members

Himanshu Jain, Jason Park, and Liangxue Chen

---

## What it does

HOMC is a UX simulation engine that takes two variants of a web experience and runs AI-driven personas through both in a real browser. Each persona attempts realistic tasks, and the system measures success rates, step counts, backtracking, and exactly where sessions fail.

Results feed into a live dashboard showing side-by-side metrics, per-task breakdowns, and a weighted winner — computed across a population model of four behavioral sub-agent types.

**This is not a replacement for real A/B testing. It's the fast filter you run before you commit to the experiment.**

---

## Demo

```bash
pnpm run clean && pnpm run demo
```

One command runs 120 simulated sessions across 3 tasks × 2 variants × 5 personas × 4 sub-agent types, then opens the dashboard.

---

## Results (last verified run)

| Task                 | Variant A | Variant B |
|----------------------|-----------|-----------|
| Create account       | 84%       | 6%        |
| Find pricing         | 83%       | 32%       |
| Learn about company  | 83%       | 21%       |

**Overall winner: Variant A**

---

## How it works

Each simulation run follows a strict loop:

1. Select persona and task
2. Open variant in a real Playwright browser
3. Observe page state (screenshot + element extraction)
4. GPT-4o decides next action
5. Execute action, log result
6. Repeat until success or failure

Success detection is **deterministic** — tight string matching per task, using `innerText` to prevent hidden elements from triggering false positives. No LLM subjectivity in scoring.

### Population model

Each persona runs as four sub-agent types, reflecting realistic user behavior distributions:

| Type | Behavior | Score formula |
|------|----------|---------------|
| A-00 Focused | Pursues primary task only | `primary ? 1.0 : 0.0` |
| A-10 Distracted / returns | Chaos fires once, returns to task | `0.80 × primary + 0.20 × chaos` |
| A-11 Blended goals | Tries to satisfy both goals | `0.60 × primary + 0.40 × chaos` |
| A-12 Fully distracted | Abandons primary task entirely | `chaos ? 1.0 : 0.0` |

Persona and group weights are configurable and editable live in the dashboard.

---

## Stack

- **Runner**: Node.js, Playwright, GPT-4o (OpenAI)
- **Schemas**: TypeScript, Zod
- **API**: Express (port 3001)
- **Dashboard**: React + Vite + Tailwind
- **Monorepo**: pnpm workspaces

---

## Project structure

```
/apps/web             → dashboard + demo HTML variants
/packages/runner      → simulation engine (observe → decide → act → log)
/packages/shared      → schemas and types
/packages/eval        → scoring and success detection
/logs                 → run outputs
```

---

## Variants

| Variant | Description |
|---------|-------------|
| A | Clean home, always-visible pricing, 2-field signup |
| B | Cookie gate, confusing nav, buried pricing, 7-field signup |

Each variant is a full multi-page HTML site (home, about, signup).

---

## Personas

| Persona | Traits |
|---------|--------|
| Alex | Impatient power user |
| Morgan | Cautious, privacy-aware |
| Jamie | Distracted, easily confused |
| Jordan | Thorough evaluator |
| Dana | Keyboard-first, accessibility-focused |

---

## Tasks

| ID | Goal |
|----|------|
| `create-account` | Complete signup flow |
| `find-pricing` | Locate pricing/plan info |
| `learn-about-company` | Find company story and team |

---

## Configuration

Weights are stored in plaintext config files and validated to sum to 1.0 at startup:

```
packages/runner/config/persona-group-weights.txt
packages/runner/config/persona-subagent-weights.txt
```

You can also edit weights live in the dashboard — changes POST to `/api/weights`, rewrite config files, and regenerate `summary.json` instantly.

---

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/summary` | GET | Overall scores and winner |
| `/api/results` | GET | Full per-run results |
| `/api/weights` | GET | Current weight config |
| `/api/weights` | POST | Update weights + recompute |

---

## Commands

```bash
pnpm run demo       # clean + full simulation run + dashboard
pnpm run dev        # dashboard only (uses existing logs)
pnpm run sim        # simulation only
pnpm run clean      # wipe logs and prior results
```

---

## Cost and runtime

| Metric | Value |
|--------|-------|
| Runs per demo | 120 |
| Estimated cost | ~$12–$48 (GPT-4o) |
| Wall-clock time | ~10–15 minutes |

---

## Limitations

- Personas are synthetic — they approximate structural friction well but don't replicate the full range of human behavior
- Success detection patterns must be configured per site
- Currently scoped to the demo variants; generalizing to arbitrary URLs is the next step

---

## What's next

- Accept any URL with a JSON task config
- LLM-generated plain-English friction summaries
- Session replay viewer
- Heatmap overlays
- CI/CD integration for pre-ship UX checks
- Exportable reports

---

## License

MIT
