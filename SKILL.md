---
name: clevertap-instrumentation
description: >
  Use this skill when the user asks to audit CleverTap event instrumentation, add or
  recommend new CT events for a feature/module/app, review someone else's event-naming
  proposal, or produce a tech-ready event spec. Trigger on: "audit clevertap events",
  "instrument CT events for X", "what events should fire from X", "add clevertap tracking
  to X", "clevertap instrumentation plan", "review our CT event names", "how should we
  track X in clevertap", "CT event audit for <app>", "is this event list correct". Works
  for any Android/iOS app with a CleverTap SDK integration; tuned for Wiom's
  AnalyticsTracker / ScreenContextHolder / RouteScreenMapper wrapper pattern (CSP app,
  Technician app) but generalizes to any similar analytics-wrapper architecture. Produces
  a code-verified event baseline, a UI-element gap audit, and/or a tech-ready CSV of final
  event names + properties. Does not edit app source code — recommendations only, unless
  the user explicitly asks for implementation.
---

# CleverTap Instrumentation — Audit & Event Design

Two related jobs this skill supports. Do the one requested — don't force both:

1. **Baseline / audit** — inventory what CT events actually fire today (traced from real
   code, never from docs alone), and/or a UI-element-level gap audit of what's missing.
2. **Event design** — recommend precise, tech-ready event names + properties for gaps,
   following the conventions below, so engineering can implement directly without
   translation.

---

## Operating principles (read first, apply throughout)

1. **Code is the source of truth, not any prior plan/spec/CSV.** Historical instrumentation
   plans, old PRs, and audit spreadsheets someone else authored all drift from reality.
   Before trusting any claim — "this event fires," "this is missing," "this file owns this
   flow" — open the actual current file and confirm. Repos move fast; re-pull before a real
   audit, don't trust a stale local clone's HEAD.

2. **Reuse beats new names, hard.** CleverTap caps event names at a low fixed ceiling (512
   on standard plans) — treat every "new event" proposal as a cost. One event + a
   differentiating property beats N near-identical event names almost every time. See
   `naming_playbook.md` for the concrete reuse patterns and worked examples.

3. **Never invent a new module/category value.** Enumerate whatever module/category enum
   already exists in the app's analytics wrapper (Wiom apps: the `Module` object in
   `AnalyticsTracker.kt`) and reuse the closest existing value for ambiguous UI areas. A
   drilldown, sub-flow, or secondary screen with no dedicated module of its own reuses its
   parent feature's module — it does not get a new one invented for it.

4. **One canonical entity-identifier property, always.** Wiom's convention is
   `execution_id` for the task/candidate/ticket/device UUID — never let a second, competing
   ID name (`task_id`, `ticket_id`, a bare `device_id` used as the primary key) creep in for
   the same entity. Mixed identifiers break joins in the CT dashboard — this exact class of
   bug has recurred even after being flagged once, so check for it explicitly every time.

5. **snake_case noun_verb, past tense, describes the action not the UI mechanic.**
   `slot_proposed` not `Slot Proposal Button Tapped`. No Title Case. No opaque codes in
   property values (`screen=install_aadhaar_capture`, not `s8`). No PII in event
   properties — identity/phone/email/etc. belong on the user-profile call only, never as an
   event property.

6. **`module`/`screen` auto-attach — don't restate them as boilerplate.** Most mature Wiom
   apps have a `ScreenContextHolder` + NavController-listener pattern that stamps
   `module`/`screen` (often `execution_id` too) onto every event automatically once wired.
   Only call out `module=`/`execution_id=` explicitly in a recommendation when (a) it must
   be something other than the route's default, or (b) the callsite is a generic shared
   route (like a `task_drilldown`) where the real module must be derived dynamically from
   the entity's type, not the nav graph the screen happens to sit in.

7. **Selection ≠ submit.** Never recommend tracking an intermediate radio-pick,
   checkbox-toggle, or list-row-selection as its own event. The picked value rides as a
   property on the terminal submit event instead. (Exception: if the tap itself IS the
   irreversible commit with no separate confirm step, it's a submit, not a selection —
   check the actual code path before applying this rule mechanically.)

8. **A generic page-load auto-fire may already answer the question.** Before recommending a
   new `_opened` event for a CTA that merely navigates to a registered screen, check whether
   the app already auto-fires a generic screen-view event (Wiom: `screen_viewed`) on arrival
   at that route via the NavController listener. If so, no new event is needed — the
   destination's arrival is already filterable by its `screen` value. This single check
   routinely eliminates a large fraction of "MISSING → add an `_opened` event" asks.

9. **Distinguish per-screen state machines from nav-driven flows.** A wizard where every
   step is its own nav route gets auto-attach for free (screen differentiates the step). A
   wizard where steps are internal ViewModel/state-holder state inside ONE composable/route
   does NOT — auto-attach can't see inside it. That case needs a small manual tracking
   helper (mirrors whatever per-module helper pattern the app already uses, e.g.
   `trackInstall()`/`trackNetbox()`) that stamps `execution_id` + a `step` property on every
   call, plus one typed re-firing engagement event (mirrors `*_candidate_opened`), not N
   per-step event names.

10. **Recognize when a flow already has its own stricter "envelope" convention.** Some flows
    (Wiom: router-provisioning/"Install Config", "Service Status") deliberately use a
    different, fixed, non-conditional property envelope on every event, tied to a written
    mini-spec (often referenced in code comments by a spec-section ID). If a flow already
    has one, extend it — don't force the general per-module convention onto it, and don't
    force its stricter envelope onto everything else either.

11. **Flag drift, don't silently perpetuate it.** If live events fire with raw string-literal
    property keys instead of the app's own constants object, say so explicitly as a
    migration note even when it's outside the current ask's scope. This drift is common and
    recurring — expect to find it, not to be surprised by it.

12. **Convert relative dates to absolute** using today's date from context.

---

## Phase 0 — Intake

Ask (or infer from context) before starting real work:

1. **Repo(s)** — path or URL. If URL, clone fresh (`git clone --depth 1 --branch <branch>
   <url> <dest>`); if a local clone already exists, `git pull --ff-only` before trusting it
   — code moves fast, and a stale clone silently invalidates an audit.
2. **Scope** — whole app, one module/feature, or one flow? Get explicit boundaries.
3. **Job** — baseline/audit only, event-design/recommendations only, or both?
4. **Existing artifacts** — is there a prior CT event plan, spec, or audit CSV/sheet to
   reconcile against? If the user hands you one, treat it as a claim to verify (Operating
   Principle 1), never as ground truth — this is the single most common real task shape in
   practice.
5. **Output location** — where to save deliverables. Check whether a CT-instrumentation
   project folder already exists in the workspace before assuming one needs to be created;
   default to a dated subfolder inside it.

---

## Phase 1 — Establish the analytics baseline (code-level)

Find and read, in this order:

1. **The analytics wrapper interface** (Wiom: `AnalyticsTracker.kt`) — `track()`/
   `trackScreen()`/`identifyUser()` plus any typed helpers (`pageViewed()`,
   `callInitiated()`, `candidateOpened()`, etc.).
2. **The concrete tracker implementation** (Wiom: `CleverTapAnalyticsTracker.kt`) — confirm
   exactly which properties auto-attach to every event, and the full current user-*profile*
   property list from `identifyUser`/`pushProfile` (distinct from event properties — profile
   properties are pushed once per user, not per event).
3. **The event/property/module constant objects** (Wiom: `Events`, `EventProps`, `Module`,
   `CallTarget`, `SheetNames`, plus any per-flow envelope object like `InstallConfigEvent`).
   This is the authoritative list of what already exists — read it in full before proposing
   anything new. Any recommendation that skips this step risks duplicating an existing
   event under a different name.
4. **The route→screen/module mapper** (Wiom: `RouteScreenMapper.kt`) — the current route
   table, and whether/how it's wired into a NavController listener. This tells you which
   routes get a free generic auto-fire page-view event (Operating Principle 8) and which
   don't.
5. **Every real callsite of every event constant**, grepped across the whole scope — not
   just the constants file. Distinguish constants that are *declared* from ones actually
   *fired* anywhere. A constant with zero callsites is dead, regardless of what any doc
   claims. Also grep for raw string-literal event names/properties that bypass the
   constants objects entirely — this is where undocumented drift hides.

**Output of this phase:** an event catalog, one row per REAL live event — name,
category/module, trigger description, file:line, properties actually sent (from code, never
from a spec). Flag explicitly: dead constants (declared, zero callsites), raw-string-literal
property drift, and any naming-convention violations found.

For a large app, this phase parallelizes well by module — see "Scaling with sub-agents"
below.

---

## Phase 2 — UI-element gap audit (if requested)

A different, more granular pass than Phase 1: walk every interactive control on every screen
in scope (not just already-fired events) and classify each:

- **AVAILABLE** — a CT event fires here, confirmed by reading the code (constant or raw
  literal — check both).
- **MISSING** — no event fires here at all.
- **DEAD CODE** — either an event constant exists for this exact moment but the callsite
  never calls it, or the composable/screen itself is unreachable/unreferenced anywhere in
  the codebase.

Standard table columns (see `csv_template.md` for the full format + worked example):
`Module | Flow | Screen | Route | Screen File | Trigger | Event (Plain Language) | Event
Code | Origin | Status`.

**If verifying someone else's existing audit:** read every distinct screen file ONCE and
answer every row that cites it together — don't reopen a file per row. Also actively look
for what the input audit itself missed: a whole new feature that shipped after it was
written, a duplicate control the audit only listed once, an "AVAILABLE" claim pointing at a
now-superseded/dead implementation file (right conclusion, wrong evidence — this happens and
matters, because tech will edit the wrong file if you don't catch it).

---

## Phase 3 — Recommend final event names + properties

Load `naming_playbook.md` and apply it to every gap from Phase 2 (or every ad-hoc name in an
existing plan under review). For each row, land on exactly one of:

- **No event needed** — covered by an existing auto-fire, a downstream event, or genuinely
  low-value UI chrome (flash toggles, password-visibility toggles, per-keystroke search,
  decorative renders, "continue past a success screen" taps).
- **Reuse an existing event** — wire an already-live event at a new callsite, with or
  without a new differentiating property value.
- **New enum value only** — a new `SheetNames`/`PhotoType`/etc. value feeding an event that
  already exists — not a new event name.
- **Genuinely new event** — only after positively confirming no existing event's intent
  already covers it.
- **Dead-code wire** — an event constant already exists and just needs a real callsite (not
  a naming question at all).

**Deduplicate across the WHOLE scope, not per module or per file.** The same consolidated
event (a shared "help/support call" reuse, a shared "error-retry" reuse, a shared "sheet
open" reuse, a shared "branch outcome" collapse) routinely applies to a dozen-plus otherwise
unrelated rows discovered independently across different screens and even different modules
worked on by different people/agents. Catch this by event *name and intent*, not just by
row — two different workers who can't see each other's output will often propose
near-identical events under different names for the same underlying moment; reconcile these
in a final pass.

Be terse in the final output. State the pattern's reasoning once, then apply it silently
everywhere it recurs — don't re-argue a settled consolidation decision on every row it
touches.

---

## Phase 4 — Tech-ready deliverable

Default output: a CSV. If reconciling against an existing input audit, retain its original
columns (minus any now-superseded "recommended addition"-style column) and append exactly:
`Final Event Name | Properties | Notes`. See `csv_template.md` for the exact header,
quoting/escaping rules, how to handle rows that got consolidated into one recommendation
(keep 1:1 row correspondence with the input — repeat the same final recommendation across
every input row it covers, never collapse rows away), and how to append genuinely new
completeness-gap rows that weren't in the original input (clearly labeled as additions, not
blended in silently).

**Always sanity-check the merge programmatically.** Every input row must map to exactly one
output row, or be an explicit, clearly-labeled addition. Never silently drop a row — run an
actual "which input rows have no output mapping" check and resolve every hit before treating
the deliverable as done.

---

## Phase 5 — Verification plan (hand off alongside the event list, don't skip)

Every instrumentation recommendation should ship with a verification plan tech can run after
implementing:

1. **Local debug** — enable verbose CT SDK logging, `adb logcat | grep CleverTap` (or
   platform equivalent), confirm each new event reaches the SDK with the expected
   properties.
2. **One scripted end-to-end walkthrough** — write out the exact expected event stream for
   one full happy-path session, so tech can diff real logcat output against it directly.
3. **Property sanity audits** on a real export after shipping — concrete, mechanical checks:
   zero events with an opaque code leaking into a human-readable property, zero events with
   a raw route template (`{placeholder}`) leaking into `screen`, zero events firing with the
   wrong module for their context, zero events still using a retired/renamed event name.
4. **Volume reconciliation** — compare event counts to the equivalent backend action-log
   counts for one production day; a >5% mismatch is a real instrumentation bug, not noise.

---

## Scaling this with sub-agents (for large audits)

A full-app audit is naturally parallelizable by module. When doing so:

- Give every parallel worker the SAME operating principles and the SAME existing
  Events/Module/EventProps catalog from Phase 1, so consolidation decisions stay consistent
  across workers who can't see each other's output.
- Have each worker verify against actual current code, not just restate an input claim.
- Re-pull/refresh the repo once, centrally, before fanning out — don't let workers each
  independently (and inconsistently) decide whether their clone is fresh.
- Do a final cross-module reconciliation pass yourself: the same consolidated event, or a
  naming collision, is routinely proposed independently by two different modules' workers
  for what turns out to be the same underlying destination or intent.
- **Don't trust a worker's own self-reported row/count summary.** Re-read the actual output
  file before relying on a headline number — self-reported counts have been observed to be
  wrong even when the underlying file was correct, and there's no cost to just checking.

---

## Don'ts

- Don't invent a new module/category value — reuse what already exists.
- Don't propose a new event name before checking whether an existing event + property
  already covers the same intent.
- Don't track selection/intermediate steps as their own events — only opens and terminal
  submits (unless the tap itself is the irreversible commit — verify the actual code path).
- Don't restate `module`/`screen`/`execution_id` as boilerplate on every row once the
  auto-attach pattern is confirmed — call it out only where it's non-default or needs
  derivation logic.
- Don't trust a prior spec/doc/CSV's claims about what "already fires" or "is missing"
  without opening the actual current code.
- Don't edit app source code as part of this skill unless the user explicitly asks for
  implementation, not just a plan/audit.
- Don't over-instrument: low-value UI chrome doesn't need an event just because a CTA
  exists there.
- Don't silently drop or merge away input rows when producing a tech-handoff CSV — every
  input row gets an output row, always.
