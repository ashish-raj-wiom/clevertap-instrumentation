# CT Naming & Consolidation Playbook

Concrete, pattern-matchable heuristics for turning a UI gap into a precise event
recommendation. Apply these in order — most gaps resolve in the first few checks, before you
ever get to "propose a genuinely new event."

Every pattern below was learned from a real multi-hundred-row audit; the illustrative
examples are real (from Wiom's CSP app) but the pattern generalizes to any app with a
similar analytics-wrapper architecture.

---

## 0. First, check: does this even need a NEW event?

Run through this checklist before writing anything down as "MISSING → add event X":

1. **Is the destination a registered nav route with an existing generic page-view auto-fire?**
   If yes, arrival is already answerable by filtering that auto-fire event on its `screen`
   value — recommend nothing. (Found ~15 times independently across Wallet and NetBox in one
   audit — each looked like a real gap in isolation, none actually were.)
2. **Is this a selection/toggle that precedes a submit a few taps later?** Recommend nothing
   standalone — the value becomes a property on the submit event instead.
3. **Is this low-value UI chrome** (flash toggle, password-visibility toggle, per-keystroke
   search-as-you-type, a decorative render with no click handler, a dropdown open/close)?
   Recommend nothing. CT events should represent user actions/screens with product meaning,
   not every possible interaction surface.
4. **Does an event with the right intent already exist, fired from a different screen?**
   If yes, this is a "reuse at a new callsite" recommendation, not a new event.
5. **Is the same underlying action reachable from 2+ places in this audit** (a duplicate
   control, a shared component instantiated on multiple screens, a retry path that's really
   the same button as the original action)? Merge into one recommendation, note the
   duplication, don't propose two.

Only after all five come back "no" do you propose a genuinely new event name.

---

## 1. Reused-event patterns (one event, many callsites, a property differentiates)

These are the highest-value consolidations — they routinely turn 10-20 independently
"discovered" gaps into one line of engineering work.

| Pattern | Event | Differentiator property | Real example |
|---|---|---|---|
| Any "call support/customer/partner" CTA, anywhere in the app | `call_initiated` | `target` (customer/partner/support/ivr), `call_method` | 18 independent "Help (madad)" links across 3 different modules all collapsed to one fix |
| Any sheet/dialog/bottom-sheet becoming visible | `sheet_opened` | `sheet` (enum value, add new ones freely) | ~20-30 distinct sheets in one app, one event |
| Any "screen failed to load, tap retry" | `screen_retry` | *(none needed — module/screen auto-attach already differentiate)* | Found independently in Wallet (6 screens) and Recharge (3 screens) — same event both times |
| Any "assign a technician/executor" action across different task types | `technician_assigned` (or your app's equivalent) | `assignee_type`, `executor_role`, auto-attached `module` | Reused across install/restore/shifting/NBREC task families |
| Any "view location on a map" tap | `location_map_opened` | `address_type` (current/new/etc.) when there are multiple addresses on one screen | Reused across 5 different drilldown screens |
| A photo capture/review step that recurs for different physical items | `device_photo_captured` (or your app's equivalent) | `photo_type` | Reused across netbox/threepin/wiring capture flows |
| Branch/outcome fan-out on one screen (a progress/result screen with N terminal states) | ONE event, e.g. `<flow>_outcome` | `step` or `outcome` (one value per branch) + `action` if there's also a user response to the outcome | An 8-branch automation-progress screen collapsed from 8 proposed event names to 1 |
| A row of near-identical CRUD actions (add/edit/delete/change-password on a management list) | ONE event, e.g. `<entity>_management_action` | `action` (add/edit/delete/...), plus the entity's id | 4 proposed CRUD-icon events collapsed to 1 |
| Multiple hub/menu rows that each just navigate somewhere | ONE event, e.g. `<hub>_row_opened` | `destination` | 2 proposed navigation events collapsed to 1 |

**Verb precision matters inside this pattern.** `_opened` = navigates somewhere / makes
something visible. `_selected` = choosing among several listed, presented options (a radio
row, a checkbox in a list). A tap that opens a detail screen is "_opened," not "_selected" —
even if the CSV/spec you're reviewing called it "_selected." Getting this backwards produces
event names that read as choices when they're really navigation, and vice versa.

---

## 2. The "double-fire at two different moments" trap

Watch for a recommendation that reuses an existing event's bare name at a DIFFERENT moment
than where it already fires. Example: an app already fires `device_photo_captured` when the
user accepts a reviewed photo. A gap-audit row for the raw shutter-press, on a different
screen, might naively recommend firing the *same* bare event name there too — but that
double-counts the funnel step and makes the event ambiguous (was this "just captured" or
"reviewed and accepted"?). Either:
- Don't fire anything at the earlier moment (usually the right call — raw shutter-press
  rarely has independent product value over the review-accept moment), or
- Add a disambiguating property (`stage=captured` vs `stage=reviewed`) if the earlier moment
  genuinely needs its own visibility (e.g., to measure retake-before-review friction).

Never let the same bare event name fire at two semantically different moments without a
property telling them apart.

---

## 3. Retake/retry/duration counters — properties, not events

A "user retried/retook this step" signal almost never needs a standalone event. It's cheaper
and more consistent as a `retake_count`/`retest_count`/`total_duration_min`-style property on
the *existing* submit-time event for that step. This was frequently planned correctly in
older specs and then simply never implemented — check whether a "new" gap is actually just a
previously-planned-but-dropped property on an event that already exists, before treating it
as net-new work.

---

## 4. Module discipline — concrete resolution rule

When a screen's natural "area" has no dedicated module value in the app's existing enum:

1. Find which parent feature it's nested under in the nav graph / drilldown hierarchy.
2. Reuse THAT feature's module value.
3. Never propose adding a new module value to solve this — it's almost always unnecessary
   and fragments what should be one filterable dimension in the CT dashboard.

Real example: a "Shifting" drilldown and several small cross-link/exposure/earnings
drilldowns all lived under the Home feature with no module of their own — every event fired
from them correctly reuses `module=home`, not a new `module=shifting`.

---

## 5. State-machine flows vs. nav-driven flows

If a multi-step flow is implemented as **N separate nav routes**, the app's existing
route→screen auto-attach differentiates each step for free — just make sure each route is in
the route map.

If it's implemented as **one nav route with internal ViewModel/state-holder state** (a
`when(state.step)` switch inside a single composable), auto-attach cannot see inside it. This
needs:
- A small manual tracking helper local to that flow's ViewModel, matching whatever
  per-module helper pattern the app already uses elsewhere (don't invent a new pattern).
- One typed, re-firing engagement event (mirrors the app's existing "candidate_opened"-style
  pattern if it has one) that fires on entry and on every internal step transition, with a
  `step` property carrying position — not a separate event name per step.
- Terminal events (`_completed`, `_failure_reported` with an `outcome` property) mirroring
  whatever terminal-event convention the rest of the app already uses for its other
  multi-step flows.

Real example: an install wizard (nav-route-per-step) needed zero extra plumbing; a device
"swap" flow (one route, internal state machine) needed the manual-helper treatment, and its
audit's 15 proposed one-off event names collapsed to 5 under this pattern.

---

## 6. When a flow already has a stricter "envelope" convention

Occasionally a specific high-stakes flow (a hardware-provisioning flow, a regulated
financial flow) will already follow a different, deliberately stricter convention: a fixed,
non-conditional set of properties sent on literally every event in that flow (not just
`module`/`screen`), often tied to a written mini-spec referenced in code comments. If you
find one:
- Extend it for new events in that same flow — same envelope, same property set.
- Don't try to fold it into the general per-module convention, and don't propose spreading
  its stricter envelope onto unrelated events elsewhere.

---

## 7. Property-name reuse checklist

Before naming ANY new property:
1. Does an existing property constant already mean this? (Check the app's EventProps-style
   constants object in full — not just the ones used nearby.)
2. Is this the entity's canonical identifier? Use the app's one established ID property name
   (`execution_id` in Wiom apps) — never a second competing name for the same kind of entity.
3. Is this a "which page did this fire from" question? It's probably already answered by the
   auto-attached `screen` property — don't add a redundant explicit property for it.
4. Is this genuinely new? Name it the same way you'd name an event: snake_case, describes
   the value's meaning, no PII, no opaque codes as the *value* either (prefer human-readable
   enum-style strings over numeric/coded values wherever the property is going to be read by
   a human in a dashboard).

---

## 8. Common drift to flag (even outside the current scope)

- Raw string-literal property keys at a callsite instead of the constants object (e.g.
  `"device_id" to id` instead of `EventProps.DEVICE_ID`) — flag it as a migration note.
- An identifier property drifting between two names for the same entity across different
  events (`execution_id` on nine events, `ticket_id` on the tenth, same underlying entity).
- A dead event constant that IS live in a sibling app on the same analytics account but dead
  in the one you're auditing (cross-app symmetry breaks are common when two apps share a
  wrapper pattern but were built by different teams at different times).
- A cited "fix this file" pointing at code that's actually been superseded/is dead — verify
  the file is really the live implementation before recommending anyone touch it.
