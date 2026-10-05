# CleverTap Instrumentation — Claude Code Skill

A Claude Code skill for product managers that audits CleverTap event instrumentation
against real app code (never against docs alone), and designs precise, tech-ready event
names + properties for whatever's missing.

---

## What problem does this solve?

*"Is our CleverTap tracking actually correct? What should we even call this new event?"*

Analytics instrumentation drifts from reality fast:

- A spec says an event fires — the code was refactored six weeks ago and it doesn't anymore
- Someone proposes 15 new event names for what's really one flow with 15 steps
- Two apps on the same CleverTap account invent two different names for the same action
- A property fires as a raw string instead of the app's own constant, and nobody notices
  until a dashboard filter silently returns nothing
- "Add an event here" turns out to be redundant — the screen already auto-fires a generic
  page-view event that answers the same question

This skill reads the actual source (the analytics wrapper, the event/property constants,
the route map, every real callsite) before it will make any claim about what fires or
what's missing. Then, for gaps, it applies a reuse-first naming discipline instead of
proposing a new event for every row of a UI-element checklist.

---

## What you get — three actions

| Action | You give it | You get |
|---|---|---|
| **audit** | An app repo (and the previous release) | A **master catalog** of every CT event and user-profile property in this version, a **diff vs the previous version** (events removed, renamed, or no longer fired), the **CT budget** (how close you are to CleverTap's 512-event cap), and every **rule violation** with `file:line` |
| **instrument** | The app and module, then your requirements in any form: **Figma, a PRD, or plain English**, plus the codebase to confirm. No long interview: anything the requirements leave open becomes an open question in the CSV | A **requirements CSV** with a plain-language instruction per event, the must-have properties, when to fire and when not to, and priority: every moment in the design → a decision (no event / reuse / new) → exact event name and typed properties, traced to the PRD question it answers. Redesigns keep the old event names, so metrics compare across versions |
| **verify** | The spec (or a list of changed events) | **PASS / FAIL / NOT_RUN per event**, with evidence, from four tiers: code check, unit tests, a **Maestro run that taps through the app on an emulator and reads the CleverTap log**, and live-data checks after release |

Every finding cites a rule from `rules.md`: must-have properties, CleverTap's hard limits,
naming, duplicates, version continuity, and data quality (no personal data, no placeholder
values, no event firing before its result is known).

---

## Install

### One-liner (macOS / Linux / Windows Git Bash)

```bash
git clone https://github.com/ashish-raj-wiom/clevertap-instrumentation ~/.claude/skills/clevertap-instrumentation
```

### Windows PowerShell

```powershell
git clone https://github.com/ashish-raj-wiom/clevertap-instrumentation "$HOME\.claude\skills\clevertap-instrumentation"
```

That's it. Claude Code auto-detects skills in `~/.claude/skills/`. Restart your Claude Code
session if it was already open.

---

## Use

In Claude Code, say any of these:

- `audit clevertap events for <app>` · `did we lose any CT events since <release>?`
- `instrument CT events for <PRD / Figma link>` · `I want to define events for <workflow>` · `what events should fire from <screen>?`
- `verify CT events for <feature>` · `test that the install events fire`
- `is this event list correct` (attach an existing audit or spec)

You'll get one batch of setup questions: which action, which repo and branch, what scope,
which previous version to compare against, and which other apps share the CleverTap
account (the 512-event budget is per account).

The skill never edits app source code. For verify it writes test files or Maestro flows only
after you agree, and asks before pushing a branch or triggering CI.

---

## How it works

| Action | Steps |
|---|---|
| **audit** | Reads the analytics wrapper (what's auto-attached to every event) → `scripts/ct_catalog.js` extracts every event, property, enum, raw literal and profile key, for this version and the previous one → `scripts/ct_diff.js` lists regressions → Claude confirms each event really fires, records its properties, and runs the rulebook |
| **instrument** | PRD → the questions to measure → every moment in the design → continuity mapping for redesigns → reuse-first decision per moment (`naming_playbook.md`) → must-haves, types, firing moment → rulebook + budget → spec + expected event streams |
| **verify** | Probes for adb / emulator / Maestro / JDK / CI → static check → mockk unit tests → Maestro walk of the mock build with logcat capture → `scripts/ct_logcat_check.js` diffs what fired against the expected stream → live-data checks after release |

## Principles

- **Code is the source of truth.** Not a prior plan, not an old PR, not a spec doc someone
  wrote eight sprints ago. Open the current file and confirm before trusting any claim.
- **Reuse beats new names, hard.** CleverTap caps event names at a low fixed ceiling — one
  event + a differentiating property beats N near-identical event names almost every time.
- **Never invent a new module/category value.** Reuse whatever already exists in the app's
  own analytics-module enum.
- **One canonical entity-identifier property, always.** Never let a second ID name creep in
  for the same kind of entity — it breaks dashboard joins.
- **Flag drift, don't silently perpetuate it.** Raw string-literal properties, dead
  constants, cross-app naming inconsistencies — call them out even when outside the current
  ask's scope.

Full list of operating principles is in `SKILL.md`.

---

## Repo contents

| File | Purpose |
|---|---|
| `SKILL.md` | The three actions, step by step, plus intake, baseline, and sub-agent scaling |
| `rules.md` | The rulebook: must-haves (CT-M, CT-P), CleverTap limits (CT-L), naming (CT-N), duplicates (CT-D), version continuity (CT-V), data quality (CT-Q), design rules (CT-X). Each rule has a severity and a mechanical check |
| `naming_playbook.md` | Reuse-first decision patterns with real worked examples |
| `templates.md` | Exact columns for every output file (master catalog, profile, diff, violations, gap audit, instrument spec) |
| `verify.md` | The four verify tiers, commands, and the expected-stream format |
| `scripts/ct_catalog.js` | Extracts the event catalog from a repo → JSON + CSV |
| `scripts/ct_diff.js` | Diffs two catalogs; exits 1 on regressions, so CI can gate on it |
| `scripts/ct_logcat_check.js` | Checks a captured logcat against an expected event stream |
| `scripts/ct_lint_spec.js` | Checks new or changed event definitions (a spec CSV, or one event in quick mode) against the rulebook: Red / Yellow / Green per row, a fix per finding, a suggested name. Existing events are accepted as they are |
| `scripts/ct_score.js` | Grades every triggered event Red / Yellow / Green against the rulebook, from a schema export + sources file + code findings |
| `scripts/ct_reconcile.js` | Compares the code catalog with a CleverTap dashboard event export: received-but-not-in-code, in-code-but-never-received, retired-but-still-arriving |
| `app_profiles.md` | Per-app facts (CSP, Technician, Customer): CleverTap project, auto-attached properties, context keys, house naming style, destinations, identity, debug log |

---

## Apps covered

Wiom's CSP app and Technician app (one shared CleverTap project, split by the `Role` user property) and the Customer app (its own CleverTap project; events also go to Firebase, Meta and Branch). Each app's conventions live in `app_profiles.md`. Universal rules apply to all; house-style rules follow the app.

## Tuning

The skill is general-purpose for any app with a CleverTap SDK integration, but its
terminology is tuned for an `AnalyticsTracker` / `ScreenContextHolder` / `RouteScreenMapper`
wrapper architecture (an `Events`/`EventProps`/`Module` constants object, a route→screen
auto-attach listener, per-module tracking helpers). If your app's wrapper looks different,
Claude will adapt the same principles to your actual architecture — the reuse-first
discipline and verification approach apply regardless of the specific wrapper shape.

---

## Requirements

- [Claude Code](https://claude.com/claude-code) installed
- Git
- Node.js (for the scripts)
- For device verify: Android SDK (adb + emulator) and Maestro, locally or in CI
- Access to the app repo(s) you want to audit

---

## License

MIT — see [LICENSE](./LICENSE).
