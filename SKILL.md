---
name: clevertap-instrumentation
description: >
  Audit, instrument, and verify CleverTap (CT) events in a mobile app. Three actions:
  AUDIT (inventory every CT event and user-profile property in a version, check them
  against the rulebook, and diff against the previous version to catch events that were
  removed, renamed, or stopped firing), INSTRUMENT (ask only the app and module, then take the
  requirements as Figma, a PRD, or plain English, confirm the codebase, and produce a requirements CSV
  telling engineering exactly which CT events and properties to fire, when, and when not to;
  reuse-first, version-continuous, inside CT limits), and VERIFY (prove the events fire:
  static code check, unit tests, a Maestro run on an emulator that taps through the app and
  reads the CT log, and live-data checks after release). Trigger on: "audit clevertap
  events", "CT event audit", "what events exist in this version", "did we lose any events",
  "compare CT events with last release", "instrument CT events for X", "add clevertap
  tracking to this PRD/design", "I want to define events for my workflow", "help me define
  CT events", "CT event requirements for X", "what should we track in X", "what events
  should fire from X", "is this event name ok", "check this event", "I want to add an event",
  "review our CT event
  names", "is this event list correct", "verify CT events", "test that events fire", "check
  clevertap events on the app". Works for any Android/iOS app using the CleverTap SDK. Ships app profiles for Wiom's CSP
  app, Technician app (which shares the CSP CleverTap project) and Customer app (its own
  CleverTap project, events also sent to Firebase / Meta / Branch). Recommends only; it does
  not edit app source unless explicitly asked.
---

# CleverTap Instrumentation — Audit · Instrument · Verify

| Action | Input | Output |
|---|---|---|
| **audit** | App repo (+ previous version) | Master catalog of every event and profile property in this version, the diff vs the previous version, and the rule violations |
| **instrument** | App + module, then requirements as Figma / PRD / plain English, and the codebase to confirm (optional) | A requirements CSV engineering implements from: every moment → decision → event, with a plain-language instruction, typed properties, must-haves, when to fire and when not to, and priority. Plus the expected streams verify will check |
| **verify** | Spec or changed-event list (+ build) | PASS / FAIL / NOT_RUN per event per tier, with evidence |

The action is always chosen by the user in Step 0, after the repo and module are set. Run
only the action chosen; at the end, offer the natural next one (audit → instrument the gaps;
instrument → verify).

Reference files, load when the step says so:
- `rules.md`: **the rulebook.** Must-haves (CT-M, CT-P), CleverTap hard limits (CT-L), naming
  (CT-N), duplicates (CT-D), version continuity (CT-V), data quality (CT-Q), and design rules
  (CT-X). Every finding cites a rule ID.
- `app_profiles.md`: **per-app facts**: repo, CleverTap project ids, what's auto-attached,
  context keys, entity id, house naming style, destinations, identity, debug log. Decides the
  `[house]` rules in the rulebook. Load it in Step 0a.
- `naming_playbook.md`: reuse-first decision patterns with worked examples.
- `templates.md`: every output file's exact columns.
- `verify.md`: the verify runbook (tiers, commands, expected-stream format).
- `scripts/ct_catalog.js`: mechanical event/property/profile extraction → JSON + CSV.
- `scripts/ct_diff.js`: version diff between two catalogs; exits 1 on regressions.
- `scripts/ct_logcat_check.js`: diffs a captured logcat against an expected stream.
- `scripts/ct_reconcile.js`: compares the code catalog with a CleverTap event export (what
  was actually received).
- `scripts/ct_score.js`: grades every triggered event Red / Yellow / Green against the rulebook.
- `scripts/ct_lint_spec.js`: grades **new or changed** event definitions (a spec, or one quick
  event) against the rulebook, with a fix per finding and a suggested compliant name.

---

## Operating principles (all actions)

1. **Code is the source of truth.** A spec, plan, CSV, or sub-agent's report is a claim to
   verify. Re-pull the repo before any real run (`git pull --ff-only`; ask first if the
   clone is a shared or read-only reference).
2. **Referenced is not firing.** `ct_catalog.js` reports `USED_AS_EVENT` / `REFERENCED_OTHER` /
   `UNREFERENCED` from references only. A constant used inside a helper that nothing calls is
   still dead. `FIRES` needs a reachable
   caller, confirmed by reading.
3. **Every finding cites a rule ID and `file:line`.** No ID, no finding.
4. **Every event traces to a question** (CT-X8). Measuring for its own sake burns the CT-L1
   budget.
5. **Reuse beats new names; continuity beats tidiness.** Renaming a shipped event breaks
   every dashboard on it (CT-V1). A redesign keeps the old names and adds `flow_version`.
6. **Sensitive values need a reason; no placeholders** (CT-Q1, CT-Q2). Personal data is fine in
   CleverTap (it's internal). Passwords, OTPs, UPI / bank details and government ids are allowed
   when needed: **ask why, and record the answer**. Card numbers and CVV need an explicit
   confirmation after a PCI-DSS warning. Omit a key you can't measure; never
   send `0` as if measured.
7. **Lead verifies sub-agents.** Re-read the code behind every BLOCKER a worker reports
   before calling it confirmed. Re-count their output files; never trust a self-reported
   count. Mark each finding `CONFIRMED` or `REPORTED`.
8. **Recommend, don't implement.** No app-source edits. Test files and Maestro flows (verify)
   are written only after the user agrees. Pushing branches or triggering CI is
   outward-facing: ask.
9. **Absolute dates** in every output.
10. **Existing events are accepted as they are; the rules govern what is defined from now
    on.**
    - **audit** reports how existing events fare. It never proposes renaming, discarding or
      re-instrumenting them unless the user asks.
    - **instrument** applies the full rulebook to every new or changed definition.
      - Reusing an existing name is fine even if that name breaks a rule today (CT-V1
        continuity). Copying its pattern into a *new* name is not.
      - A redesign that keeps an existing event may still need its firing moment or must-haves
        corrected. Do that only where the design touches the event, and say so in that row's
        Notes.

---

## Step 0 — Intake (all actions)

Always in this order, and keep it short.

**0a. App, repo and area.** Ask one `AskUserQuestion` with two questions:
- **App (repo):** offer the apps in `app_profiles.md` (CSP / Technician / Customer), each
  with its local clone, branch and last commit date. The answer picks the **profile**:
  - the house rules
  - the `ct_catalog.js --profile` value
  - the CleverTap project, and so whose CT-L1 budget is spent. CSP and Technician share one
    project; Customer has its own.
- **Area:** offer the app's real area values. CSP: `Module` values. Customer: `Flows`
  values (booking / login / installation / installed_customer / renewal). Or the whole app.

An app with no profile: read its tracker (Step 1) and add a profile to `app_profiles.md`
first.

If a clone is already known, name it and ask the user to confirm it rather than asking from
scratch. Skip either question if the user already said. Then fast-forward the clone and
record the commit and app version (`versionName`) for every output. Below, `<module>`
means the chosen area.

**0b. Action.** Ask one `AskUserQuestion`: **what do you want to do with `<module>` in
`<app>`?** Three options, each described in terms of that module:
- **Audit**: "List every CT event and user property `<module>` sends today, check them
  against the rules, and compare with the previous release."
- **Instrument**: "Define the events for a new or changed `<module>` workflow from your
  Figma / PRD / plain-English requirements."
- **Verify / test**: "Check that `<module>`'s events actually fire: code check, unit tests,
  or a run on an emulator."

Make the descriptions concrete with numbers from a quick `ct_catalog.js` pass, e.g. "N
events reference this module's code today". Skip this question only if the user's words already
named the action unambiguously.

**0c. Action-specific inputs.** Ask only for what the chosen action needs, in one message,
inferring the rest:
- **audit**: the previous version to compare against (offer the latest release tag, or a
  previous `ct_master_*.json` from the output folder). The apps sharing the CT project come
  from the profile; don't ask.
- **instrument**: the requirements, as Figma / PRD / plain English (see B0).
- **verify**: the spec or list of changed events, and the build or branch to test.

Output folder: the existing CT folder, one dated subfolder per run (`templates.md`). Don't
ask about it unless none exists.

---

## Step 1 — Baseline (all actions; reuse a same-day catalog if one exists)

1. Read the tracker files the profile lists. CSP: `AnalyticsTracker.kt`,
   `CleverTapAnalyticsTracker.kt`, `RouteScreenMapper.kt`, and the `MainActivity` back-stack
   collector. Customer: `AnalyticsTrackerImpl.kt`, `CommonPropertiesProvider.kt`,
   `CleverTapProvider.kt`, `ScreenContextHolder.kt`, and the app's own
   `claude_context/agent_app_event_instructions.md`. Confirm the profile still matches the
   code; update `app_profiles.md` if it drifted. Write down:
   - **exactly which keys are auto-attached** to every event, and from where. This decides
     CT-M1/M2/M3 per callsite.
   - which routes get an automatic page-view or candidate re-fire (CT-X4), or, in the customer
     app, which screens fire their own `_page_loaded`.
   - **every destination** the tracker sends to (CleverTap, Firebase, Meta, Branch, backend
     logs). Those decide CT-L9 and the CT-Q1 blast radius.
   - the `identifyUser` profile keys and when identity is pushed (CT-M8).
2. Run the extractor:
   ```bash
   node <skill>/scripts/ct_catalog.js --repo <repo> --profile <csp|technician|customer> --out <out>/ct_master_<app>_<version>.json --version "<versionName> <branch>@<sha> (<date>)"
   ```
   For an app with no profile, pass `--events` / `--props` / `--prop-prefix` / `--enums` /
   `--tracker` / `--profile-call` / `--ext`. If it exits 3, the events object has a different
   name: find it, then pass it.
3. Note the counts:
   - events, used as events, unreferenced
   - **reaching CleverTap** (the CT-L1 number)
   - raw event names, raw property keys, profile keys
   - **duplicate declarations** (the same constant in two objects; check whether the values
     differ, CT-V4)

---

## Action A — AUDIT

Goal: a master file of what this version sends to CleverTap, what changed since the
previous version, and what breaks the rules.

**A1. Catalog the previous version.** If there's no previous `ct_master_*.json`, regenerate
it read-only from the previous ref:
```bash
git -C <repo> archive <prev-ref> | tar -x -C <scratch>/prev
node <skill>/scripts/ct_catalog.js --repo <scratch>/prev --out <out>/ct_master_<app>_<prev>.json --version "<prev>"
```

**A2. Diff.**
```bash
node <skill>/scripts/ct_diff.js --prev <prev.json> --curr <curr.json> --out <out>/ct_diff_<prev>_to_<curr>.csv
```
Every `REMOVED`, `LOST_CALLSITES`, `RENAMED_WIRE`, and `CALLSITES_DOWN` row is a regression
(CT-V2/V3) until the code or a deprecation record shows it was deliberate. Read each one.
For `REMOVED`, check whether a new event took over the moment. If so, it's a CT-V1 rename
violation unless the meaning changed.

**A2b. Reconcile with what CleverTap actually received** (do it whenever an export exists;
**required** for an app with server-driven event names, which the code can't show, e.g. the
customer app's SDUI screens). Ask the user for the event list exported from the CleverTap
dashboard for the profile's **prod** project, ideally with counts for the last 30 days.
Never ask for or handle the project passcode. Then:
```bash
node <skill>/scripts/ct_reconcile.js --catalog <curr.json> --ct <ct_export.csv> --out <out>/ct_reconcile_<app>_<date>.csv [--other-app <catalog of the app sharing the project>]
```
- `CODE_NOT_IN_CT`: in code but never received. Dead path, unreleased, or broken (CT-V3).
- `CT_NOT_IN_CODE`: received but not in this code. Server-driven names, another app on the
  project, older releases, or raw strings. Each one is catalogued with its source.
- `CODE_DEAD_IN_CT`: retired in code but still arriving from older app versions in the
  field. Keep it in the master as `DEPRECATED_ALIAS` until volume reaches ~0.

The CT-L1 budget uses the **exported** name count when there is one: it is the real number.

**Shared project (CSP + Technician):** reconcile the CSP prod export against the app being
audited, and pass the other app's catalog as `--other-app` so its events land in `OTHER_APP`,
not `CT_NOT_IN_CODE`. Names from the legacy Flutter Expert app have no catalog. They show as
`CT_NOT_IN_CODE` and are attributed by their UPPER_SNAKE style and creation date.

**Attribute every event to a source** (template § sources). The four kinds:
- **app code**: file:line from the catalog.
- **runtime-built names**: e.g. `juspay_*`, from a code pattern.
- **server-side**: backend services uploading events for the user.
- **other / legacy apps** on the same project.

An event with no confirmed source is `UNKNOWN`, never guessed.

**A3. Enrich every event into the master catalog** (`templates.md` § master). For each
event: read its callsites, record the trigger, module, family, and properties actually
sent, and resolve `USED_AS_EVENT` into `FIRES` or `UNREACHABLE`. For more than ~60 events,
split by module across sub-agents (see Scaling).

**A4. Run the rulebook.** Load `rules.md` and run every check in §1–§6 that applies to each
event's family. Mechanical first:
- CT-N6 is `raw_events` / `raw_prop_keys`.
- CT-L5 is the name regex.
- CT-D3 is near-duplicate name pairs across the **whole** catalog.
- CT-Q2 is a grep for literal `to 0` / `to false` / `to ""` / `to "none"` in track maps.
- CT-M4 checks each outcome event's callsite against its success branch.

Then judgement checks: CT-D1/D2/D4, CT-Q1 (a reason recorded for each sensitive value; card data confirmed; personal data reaching external destinations), CT-Q3/Q4/Q5.

**A5. Profile.** Build `ct_profile_*.csv` and check CT-P1…P5 and CT-M8.

**A6. Budget** (CT-L1). Count per **CleverTap project**, from the profile: distinct
CT-reaching names across every app on that project (CSP + Technician together; Customer
alone), + 25 system events, as a % of 512. For apps that fan out to Firebase, also report
CT-L9: names over 40 chars, and events over 25 parameters including the auto-attached ones. State the growth since the previous version and the
projected months to 85%.

**A6b. Grade every triggered event Red / Yellow / Green.** Needs a schema export and the
sources file from A2b. Collect the code-level violations found in A3–A4 into
`code_findings_<project>.csv` (`event,rule,severity,evidence`, with evidence marked
CONFIRMED or REPORTED), then:
```bash
node <skill>/scripts/ct_score.js --schema <export.csv> --sources <ct_event_sources.csv> --findings <code_findings.csv> --project <csp|customer> --out <out>/ct_rag_<project>_<date>.csv
```
- 🔴 **Red**: any BLOCKER, or 3+ MAJOR.
- 🟡 **Yellow**: 1–2 MAJOR, or 3+ MINOR.
- 🟢 **Green**: at most 2 MINOR.

House rules apply only to events the apps send. Tracker-level issues (keys auto-attached to
every event) are reported once, not per event. State the limits in the write-up: types,
values and firing moments are checked only where code findings exist.

**A7. Deliver** (`templates.md`): master CSV + JSON, profile CSV, diff CSV, violations CSV, and
a short README with:
- the counts and the budget line
- regressions vs the previous version
- BLOCKERs, each `CONFIRMED` or `REPORTED`
- the drift list

**A8 (optional). Control-level gap audit.** If the user wants coverage of every
button in a scope, walk every interactive control and system milestone, and classify each
`AVAILABLE` / `MISSING` / `DEAD CODE` (Shape A). Then recommend per `naming_playbook.md`
(Shape B), keeping 1:1 row correspondence, checked by script.

---

## Quick check — "is this event OK?"

When the user names one or a few events and properties to add ("I want to add
`otp_resend_clicked` with `attempt_number`"), skip the full intake. Find the app from context
(ask only if unclear), then run:
```bash
node <skill>/scripts/ct_lint_spec.js --profile <app> --event "<name>" [--props "k1 (type), k2 (type)"] [--family outcome|entry|engagement] [--when "<fires when>"] [--not "<do not fire when>"] [--notes "<reason>"] --catalog <ct_master.json> [--schema <latest export>]
```
Reply with:
- the grade
- each finding in one line: rule, why, fix
- the checker's suggested name, if any
- the closest existing event to reuse, if one exists

For a sensitive key, ask why it's needed (CT-Q1). Offer to turn it into a full spec row
(Action B) when they're happy.

## Action B — INSTRUMENT

Goal: a requirements CSV that tells engineering exactly which CT events to fire for a
workflow, when, with which properties, and when **not** to fire them, so every question the
user wants answered can be answered. No more, and nothing that breaks continuity or the
budget. The CSV is the deliverable: an engineer who never saw this conversation must be able
to implement from it alone.

**B0. Intake: short, then read the requirements.** Don't interview the user step by step.
The requirements carry the detail; the questions only locate the work. The repo and module
are already set by Step 0a (CT-X6), and the action by 0b. The only instrument-specific ask is
one plain message (0c):

- "Share the requirements in any form: a Figma link or frames, a PRD, or plain English
  describing the workflow."

A codebase is optional. If the user said in 0a that there is none, the reuse pool is the
latest `ct_master_*.json` in the output folder or a CleverTap event export. If there's
neither, every `NEW_EVENT` row's Notes say `reuse not checked against live catalog`.

**No requirements, or "use your best judgement":** treat the module's **current flow in the
codebase** as the requirements:
- Map every live action, sheet, API call and state change from the code.
- Infer the standard questions: drop-off per step, time between steps, failure reasons.
- Keep every existing event name (CT-V1).
- Fix the rule violations you find, as `CONTINUITY` rows with corrected `Fires When`.
- Fill only the real gaps.

Mark each inferred question `inferred: confirm` in the summary.

Then work entirely from what was shared: the questions to measure (B1), the moments (B2),
new vs redesign, entry points, outcomes, and data fields.

- **Infer, don't ask.** Where the requirements are silent, choose the rulebook's default and
  say so in that row's Notes. For example: a redesign keeps the old names and adds
  `flow_version` (CT-V1); outcome events fire after success with `outcome` +
  `failure_reason` (CT-M4); an unknown value is omitted, never sent as a placeholder
  (CT-Q2).
- **Ask a follow-up only when it is blocking.** That means it changes which events exist,
  and the requirements and code can't settle it. Batch blocking questions into **one**
  `AskUserQuestion` (at most 4). Everything else goes into the CSV as an open question in
  Notes, plus the summary's open-questions list. Never run a second follow-up round; carry
  any leftovers as open questions.

**B1. Extract the measurement questions.** From the requirements' goals, success metrics,
guardrails, and acceptance criteria, list every question the data must answer, e.g. "% of
accepted bookings that reach arrival within 24h". If the requirements state no metrics,
infer the standard set for the flow (drop-off per step, time between key steps, failure
reasons), and mark it `inferred: confirm` in the summary. **Don't invent events without a
question** (CT-X8).

**B2. List the moments.** From the requirements (Figma frames, screens, PRD flows, or the
plain-English description) and, where the codebase exists, the current screens for that
flow, every:
- screen arrival
- sheet or dialog
- primary CTA
- system result (API success or failure)
- error state
- branch outcome
- background milestone

Note what each moment is: entry, selection, submit/outcome, or chrome.

**B3. Load the current catalog** (Step 1; run it if it's missing or older than the code). This
is the reuse pool. Proposals are checked against the whole app, not the feature.

**B4. Continuity check** (CT-V1, CT-M6). Does this design replace or vary an existing flow
(a redesign, an A/B arm, a rollout cohort)? If so, map every old moment to its new moment
first. Mapped moments are `CONTINUITY`: same event name, same keys, new `flow_version`
value. Only moments with no old counterpart go on to B5.

**B5. Decide each moment**, in `naming_playbook.md` §0 order: `NO_EVENT` (chrome,
selection) → `AUTO` (page-view already covers it) → `REUSE` → `NEW_ENUM` / `NEW_PROPERTY` →
`NEW_EVENT` last.

**B6. Specify each event fully:**
- the family's must-haves (CT-M1…M7)
- every property with a fixed type and value set (CT-L8, CT-V5)
- the exact firing moment (CT-M4, CT-Q3). With a repo, name the code moment ("after
  `assignTechnician` returns success"). Without one, state it in product terms precise enough
  for an engineer to place ("after the server confirms the assignment; not on tap").
- when it must **not** fire: on tap before the result, on failure, on back-navigation
  re-render, on a skip or mock path (CT-M4, CT-D4, CT-Q5)
- the failure path for every outcome event
- a one-sentence **Instruction** an engineer can implement from without other context

**B7. Rules pass on the proposal.** Run the spec checker. It grades every new or changed row
on the same Red / Yellow / Green scale as the audit, and gives a fix per finding:
```bash
node <skill>/scripts/ct_lint_spec.js --profile <csp|technician|customer> --spec <ct_spec.csv> --catalog <ct_master.json>[,<other app on the project>] [--schema <latest CleverTap export>] --out <ct_spec_lint.csv>
```
- 🔴 **Red rows are not handed over.** Fix them, or put the choice to the user with the
  checker's suggested fix.
- 🟡 **Yellow rows need a reason** in that row's Notes (e.g. "PascalCase kept: campaign
  template owns the name").
- 🟢 **Green rows** go as they are.

Pass the CSP **and** Technician catalogs for the shared CSP project, and the latest schema
export when one exists: it adds Discarded names (CT-L7), names other senders already use
(CT-D1 / D3), and the real budget (CT-L1).

The checker covers:
- CT-N naming on every new name and key
- CT-D3 near-duplicates against the whole catalog
- CT-L1: state the budget after each `NEW_EVENT`. At 85% or more, each `NEW_EVENT` names
  the existing events it was checked against and why none fits
- CT-L3/L4 property counts and value lengths
- CT-Q1: every sensitive value has a recorded reason (ask once, batched with any other
  blocking question in B0); card data is confirmed after the PCI-DSS warning; flag keys going
  to external tools. CT-Q2 placeholders

**B8. Coverage check.** Every question from B1 has at least one event row that answers it,
and every event row names its question. List any question still unanswerable and why
(often a backend field, not an app event).

**B9. Deliver.**
- `ct_spec_<feature>_<date>.csv`: the requirements file, in the exact columns from
  `templates.md`.
- `expected_stream_<feature>.json`: the happy path, plus one stream per failure branch.

Build the CSV by script, then **self-check it before handing it over**:
- every row has a `Decision`
- every non-`NO_EVENT` row has an `Event`, an `Instruction`, `Properties` with types,
  `Must-haves`, `Fires When`, and `Do Not Fire When`
- every row has a `Question`, and every question from B1 appears on at least one row
- every `NEW_EVENT` row has `Budget After`
- every sensitive property (password, OTP, UPI / bank, government id) has its reason in
  Notes; no card number or CVV without the user's confirmation
- `ct_lint_spec.js` reports no Red row, and every Yellow row has its reason in Notes. Ship
  `ct_spec_<feature>_lint.csv` next to the spec.

Print and fix any row that fails.

The summary in chat covers:
- counts by decision
- new names, and the budget after adding them
- continuity mappings
- questions → events coverage
- open questions the user must answer before tech starts

Offer **verify** next.

---

## Action C — VERIFY

Load `verify.md` and follow it. In short:

0. **Probe** for adb, an emulator, Maestro, a JDK, and any CI Maestro workflow. Pick the tiers
   that can run.
1. **Static** (always): callsite exists, keys are put, it fires after success, no new raw
   keys.
2. **Unit**: generate mockk `verify { analytics.track(...) }` tests in the repo's existing
   style, including failure-path and no-placeholder assertions. Ask before adding test
   files.
3. **Device**: debug build of the deterministic flavor (Wiom CSP: `mock`), a Maestro flow
   that taps through the journey, logcat capture with CT VERBOSE, then `ct_logcat_check.js`
   against `expected_stream.json`. Calibrate the log format on the first run. Ask before
   adding flows or triggering CI.
4. **Live**: after release, property sanity + volume reconciliation vs backend + `flow_version`
   continuity on CleverTap data.

Deliver `verify_<scope>_<date>.csv`, with per-tier PASS / FAIL / NOT_RUN counts. **NOT_RUN is
never reported as PASS.**

---

## Scaling with sub-agents

For a whole app, or any scope over ~60 events or ~80 screen files:

- Run Step 1 once, centrally, and pull the repo once.
- Write one shared brief file containing: the repo + commit, the auto-attach facts from
  Step 1, the rule IDs that apply, the exact output header, and "verify every claim with
  `file:line`". Every worker reads that same file, so decisions stay consistent.
- Split by module or by flow segment, with no overlapping files.
- Each worker writes a CSV and replies with: row count, counts by status, new names
  proposed, and bugs with `file:line` and rule ID.
- **Lead pass:**
  - re-count every file
  - re-read the code behind every BLOCKER
  - merge by script, check for duplicate rows across workers
  - reconcile the same event proposed under different names or properties
  - fill blank decisions

---

## Don'ts

- Don't call an event live because a constant is referenced (Principle 2).
- Don't propose a new event name before the playbook's §0 checks and the CT-L1 budget line.
- Don't rename a shipped event because a design changed (CT-V1). Use `flow_version`.
- Don't send a measured-looking value you didn't measure (CT-Q2).
- Don't let an outcome event fire before its result is known (CT-M4).
- Don't add a sensitive value (password, OTP, payment details, government id) without asking
  why it's needed and recording the answer; don't add card numbers or CVV without explicit
  confirmation after the PCI-DSS warning (CT-Q1).
  Personal data is fine in CleverTap; flag it where it also reaches external tools.
- Don't invent a `Module` value (CT-X6).
- Don't drop rows when producing a handoff CSV.
- Don't report PASS without evidence from the tier that ran.
- Don't edit app source, push, or trigger CI without an explicit yes.
- Don't recommend discarding CleverTap events. Report unused ones as information; the
  project owner decides.
