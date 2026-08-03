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

## What you get

Depending on what you ask for:

1. **A code-verified event baseline** — every event that actually fires today, traced to
   file:line, with dead constants and raw-string-key drift flagged explicitly.
2. **A UI-element gap audit** — walk every screen/control in scope, classify each
   `AVAILABLE` / `MISSING` / `DEAD CODE` against the real code.
3. **A tech-ready event design** — for every gap, one of: no event needed, reuse an
   existing event, a new enum value on an existing event, or (only after ruling out the
   other three) a genuinely new event — with the exact properties to send.
4. **A CSV tech can implement directly from** — see `csv_template.md` for the exact format.

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

- `audit clevertap events for <app>`
- `instrument CT events for <feature>`
- `what events should fire from <screen>`
- `add clevertap tracking to <flow>`
- `review our CT event names`
- `is this event list correct` (paste/attach an existing audit or spec)

You'll be asked a few quick setup questions first — which repo(s), what scope (whole app /
one module / one flow), whether you want a baseline, a gap audit, event-naming
recommendations, or some combination, and whether there's an existing plan/CSV to check
against rather than start from scratch.

The skill never edits app source code — it produces recommendations and documents only,
unless you explicitly ask for implementation.

---

## How it works

Two jobs, and the skill does whichever one you asked for:

| Job | What it does |
|---|---|
| **Baseline / audit** | Reads the analytics wrapper, the event/property constants, the route→screen map, then greps every real callsite of every event across the scope. A constant with zero callsites is dead no matter what a doc says. |
| **Event design** | For every gap, runs a reuse-first checklist (does an existing auto-fire already cover this? is it a selection that should ride as a property on the submit event instead? does an existing event's intent already match?) before ever proposing a new event name. |

The **naming playbook** (`naming_playbook.md`) is the concrete pattern library behind step
2 — real, worked patterns like collapsing 14 independently-discovered "call support" gaps
into one `call_initiated` reuse, or replacing 15 proposed one-off events for a multi-step
flow with one typed engagement event + a `step` property.

---

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
| `SKILL.md` | The operating principles + 5-phase runbook (intake → code baseline → gap audit → recommend → tech CSV → verification plan), plus notes on scaling an audit across sub-agents without losing accuracy |
| `naming_playbook.md` | The reuse/consolidation cheat-sheet — concrete patterns, a "does this even need a new event?" checklist, and the common traps (double-firing one event at two different moments, retake/retry counters that should be properties not events, module-naming discipline) |
| `csv_template.md` | Exact CSV column formats for both the gap-audit shape and the tech-handoff shape, with a worked example |

---

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
- Access to the app repo(s) you want to audit

---

## License

MIT — see [LICENSE](./LICENSE).
