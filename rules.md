# CT Rulebook — must-haves, limits, and checks

**Scope:** these rules govern events defined from now on (instrument, quick check). Existing
events are graded for information by the audit, and accepted as they are.

Every rule has an ID, a severity, and a **mechanical check**: a grep, a script field, or a
code read with a yes/no answer. All three actions cite these IDs. **audit** reports
violations, **instrument** designs so none occur, **verify** proves none shipped. A finding
that can't name a rule ID is an opinion, not a finding.

Severity:
- **BLOCKER**: data is wrong or lost in CleverTap. Fix before release.
- **MAJOR**: data is ambiguous, uncomparable, or will break later.
- **MINOR**: hygiene.

**Universal vs house style.** Rules marked **[house]** depend on the app: its naming pattern,
context keys, entity id, and how page views work. Read their concrete form from the app's
profile in `app_profiles.md` (csp / technician / customer). Every other rule is universal
and applies to every app unchanged. New events follow the app's house style. A house style
that itself breaks a universal rule is raised as a recommendation; shipped events are never
renamed to "fix" it (CT-V1).

---

## 1. Must-haves (CT-M) — what every event carries

Properties are required by **event family**, not on every event blindly. Family is decided
by what the event records, not by its name alone.

| ID | Applies to | Must carry | Sev | Check |
|---|---|---|---|---|
| **CT-M1** [house] | Every event | The app's area context key, non-empty and from its enum. CSP: `module` (a `Module` value). Customer: `flow` (a `Flows` value) | BLOCKER | Callsite runs where auto-attach is populated (a screen is on top), or passes `module` explicitly. **Background workers, push receivers, app-start code, and ViewModels firing after navigation have no screen context** and must set it themselves. |
| **CT-M2** [house] | Every event | The app's screen context key, non-empty and human-readable. CSP: `screen`. Customer: `page_name` (a `ScreenNames` value), plus `funnel_step` where the flow has steps | MAJOR | Value never matches `^s\d`, never contains `{`, never empty. Same auto-attach caveat as M1; in the customer app it means `screenContext.update(...)` ran before the event. |
| **CT-M3** [house] | Any event about the app's main entity | The profile's one canonical id key. CSP: `execution_id` (task / ticket / candidate). Customer: not standardised yet; flag it as an open decision rather than inventing one | BLOCKER | Read the callsite or helper; neither Wiom tracker auto-attaches it. Flag a second key used for the same entity (`task_id` / `ticket_id` / `orderId` / `booking_id`). |
| **CT-M4** | Outcome events: anything that records the result of an API call or commit (`_submitted`, `_completed`, `_confirmed`, `_assigned`, `_marked`, `_verified`, `_accepted`, `_declined`) | Fired **after success is confirmed**, plus a failure path: `outcome=success\|failure` with `failure_reason`, or an existing paired failure event | BLOCKER | The track call sits after the result check (`if (result.isSuccess)` / `onSuccess`), not before the request. A failure branch that fires nothing is a violation. |
| **CT-M5** | Entry events (`_opened`, `*_candidate_opened`, `_viewed` for a destination) | `entry_source`: where the user came from | MAJOR | Every callsite passes it. A destination reachable from N places with no `entry_source` is a violation. |
| **CT-M6** | Every event in a flow that exists in more than one design version, experiment arm, or rollout cohort | `flow_version` | MAJOR | If the code branches on a rollout flag, experiment, or "new vs legacy" UI, every event in both branches carries `flow_version`. This is what makes CT-V1 work. |
| **CT-M7** | Flows with a declared envelope (e.g. Install Config) | Every envelope field, unconditionally | MAJOR | Diff the envelope builder against its spec. Fields sent only `if (notBlank)`, or never sent, are violations. |
| **CT-M8** | Account | User identity pushed **before** the first tracked event of a session | BLOCKER | `onUserLogin` / `identifyUser` runs on login **and** on cold start with a saved session. Otherwise events land on an anonymous profile. |

### User-profile must-haves (CT-P)

Pushed once per user through `onUserLogin` / `pushProfile`, never as event properties.

| ID | Must-have | Sev | Check |
|---|---|---|---|
| **CT-P1** [house] | `Identity` is **stable and unique per person, and the same value on every login and device**. Which key it is depends on the app: CSP: the backend user id. Customer: **the customer's mobile number, accepted as-is** | BLOCKER if Identity can change for the same person, or be shared by two people | `put("Identity", …)` / `profile["Identity"] = …` matches the profile's identity key, and is pushed on login and on cold start with a saved session (CT-M8). Don't recommend changing an app's identity key: that re-keys every existing profile. |
| **CT-P2** | Role / user type (Wiom: `Role`), and the org key (Wiom: `cspId`) | MAJOR | Present and conditional: absent rather than `""`. |
| **CT-P3** | `AppVersion` + `AppVersionCode` | MAJOR | Needed to split any metric by release; without it CT-V checks cannot be run on live data. |
| **CT-P4** | `MSG-push` / channel opt-ins, if the app sends CT campaigns | MINOR | Present when campaigns are used. |
| **CT-P5** | Personal profile data (`Name`, `Phone`, `Email`) goes under CleverTap's reserved profile keys, so campaigns can use them; a duplicate custom key (`mobile`, `name`) for the same value is redundant | MINOR | `ct_catalog.js` `profile` list. |

---

## 2. CleverTap hard limits (CT-L)

Source: CleverTap developer docs, *Events* page (checked 5 Oct 2026). Re-check
<https://developer.clevertap.com/docs/events> if a number looks off.

| ID | Limit | Our rule | Sev | Check |
|---|---|---|---|---|
| **CT-L1** | **512 event types per CleverTap account.** CleverTap's own system events (App Launched, Notification Viewed, …, 20+) count against it. Events beyond the limit are **dropped**. | Count **Active** names per CleverTap project, from a schema export when one exists (`ct_reconcile.js` `active_names`). Otherwise use the union of CT-reaching names across every app on the project, plus 25 for system events. **Warn at 70% (358). At 85% (435), every `NEW_EVENT` must name the existing events it was checked against and why none fits** (a strict reuse gate, not a block). Every new name states the count after adding it. **Never recommend discarding events**; report unused ones (Active, zero recent volume) as information only. Discarding is the project owner's decision | MAJOR at 85% | `ct_reconcile.js` on a schema export; else `ct_catalog.js` `counts.reaching_clevertap` per app, unioned. |
| **CT-L2** | Event name ≤ 120 chars | Keep names ≤ 40 chars | MINOR | Length check on catalog `name`. |
| **CT-L3** | ≤ 256 properties per event | Keep ≤ 25 per event (auto-attached included) | MAJOR above 25 | Count keys at the callsite plus the auto-attached set. |
| **CT-L4** | Property values ≤ 512 chars | Never send free text, URLs with query strings, or serialized blobs | MAJOR | Grep for `.toString()` of objects, JSON, free-text fields in props. |
| **CT-L5** | Prohibited characters in names/keys: `& $ " , % > < !` | snake_case `[a-z0-9_]` only | BLOCKER | Regex `^[a-z][a-z0-9_]*$` on every event name and key. |
| **CT-L6** | Property values must be scalar: String, Boolean, Integer, Float, Date. Nested objects/arrays are rejected (error 512), except the Charged event's Items. | Flatten. Lists become a delimited string or a count. | BLOCKER | Grep for `Map`/`List` values in track props. |
| **CT-L7** | A discarded event name is dropped forever (error 528) | Never reuse a name that was discarded in the CT dashboard | BLOCKER | Ask for (or export) the discarded-events list before proposing any new name. |
| **CT-L9** | **Other destinations' limits.** If the tracker sends the same event to more tools (customer app: Firebase, Meta, Branch), the tightest limit wins. Firebase Analytics (Google's *Collection limits* help page, checked 5 Oct 2026): event name ≤ **40** chars, ≤ **25** parameters per event, parameter name ≤ 40 chars, parameter value ≤ **100** chars, ≤ 500 distinct event names per app user, user properties ≤ 25 (name ≤ 24, value ≤ 36 chars) | Events that fan out keep names ≤ 40 chars and *auto-attached + event-specific* params ≤ 25. Events that should not feed ad / attribution tools use the CT-only path (customer: `trackCleverTapOnly`) | MAJOR | `ct_catalog.js` `sinks`: for every event with sink `track` in a fan-out app, check name length and param count. |
| **CT-L8** | Type stability. CT types a property from the data it receives, so a key that arrives as `"true"` and later as `true` splits or breaks filters. This is observed behaviour, noted in the CSP app's own code, and is not a quoted CT doc limit. | One type per key, everywhere, every version | MAJOR | Same key across callsites: same Kotlin type. Booleans are real booleans; numbers are numbers, never `.toString()`. |

---

## 3. Naming (CT-N)

| ID | Rule | Sev | Check |
|---|---|---|---|
| **CT-N1** [house] | The app's name pattern, snake_case always. CSP: `object_action` past tense (`slot_proposed`). Customer: `<screen>_page_loaded`, `<action>_clicked` / `<action>_cta_clicked`, `<action>_success_page_loaded` / `_failed_page_loaded` | MAJOR | Regex per profile. snake_case (`^[a-z][a-z0-9_]*$`) is universal: `backPressed` fails in every app. |
| **CT-N2** [house] | Name the **product action**, not the UI mechanic: `withdraw_initiated`, not `withdraw_button_clicked`. **CSP only.** In the customer app `_clicked` is the documented house style | MAJOR | CSP: no `button`, `click`, `tap`, `btn`, `cta` tokens unless the tap *is* the product action. Customer: a `_clicked` event for a CTA that triggers an API still needs its outcome event (CT-M4). |
| **CT-N3** [house] | Verb vocabulary, used consistently: `opened` (made visible / navigated to) · `viewed` (passive render) · `selected` (chose among presented options) · `submitted` (user sent input) · `confirmed` (user approved a consequence) · `completed` (system finished a multi-step thing) · `failed` / `failure_reported` · `started` · `cancelled` · `dismissed` · `retried` | MAJOR | Synonym pairs flagged: `clicked`/`tapped`, `shown`/`viewed`/`displayed`, `done`/`completed`, `success`/`completed`. |
| **CT-N4** | No version, platform, or screen-code suffixes in names: no `_v2`, `_new`, `_android`, `_s11` | MAJOR | Regex `(_v\d+\|_new\|_old\|_android\|_ios\|_s\d+)$`. Versions go in `flow_version` (CT-M6). |
| **CT-N5** [house] | Don't put the screen in the name when `screen` is auto-attached: `screen_retry`, not `wallet_screen_retry` | MINOR | Name starts with a module/screen token **and** a generic sibling exists. |
| **CT-N6** [house: MAJOR in CSP, MINOR in customer, whose rulebook allows raw keys] | Constants only. Every event name and property key comes from the app's constants objects, never a raw string at the callsite | MAJOR | `ct_catalog.js` `raw_events` and `raw_prop_keys` must be empty. Each hit gets a migration note. |
| **CT-N7** | Property values are human-readable enum strings, never opaque codes: `screen=install_aadhaar_capture`, not `s8`; `outcome=failure`, not `2` | MAJOR | Read the value source at the callsite. |
| **CT-N8** | Property keys follow the same snake_case rules, and **one meaning has one key app-wide**: `execution_id` everywhere, never `task_id` on one event | BLOCKER for ids, MAJOR otherwise | `ct_catalog.js` `props`. Look for keys whose names differ only by synonym (`ticket_id` / `task_id` / `execution_id`). |

---

## 4. Duplicates (CT-D)

| ID | Rule | Sev | Check |
|---|---|---|---|
| **CT-D1** | **One moment → one event.** Two event names must never record the same user moment. | MAJOR | For each callsite, list every track call within the same handler. Two names fired together for one action is a duplicate unless one is a documented deprecation alias (CT-V2). |
| **CT-D2** | **One name → one moment.** The same name at two semantically different moments needs a disambiguating property. | MAJOR | For events with more than one callsite, check every callsite records the same thing; otherwise require `stage` / `outcome` / `step` (playbook §2). |
| **CT-D3** | No near-duplicate names in the catalog | MAJOR | Tokenise names. Flag pairs with the same tokens reordered (`opened_sheet` / `sheet_opened`), synonym verbs (CT-N3), or edit distance ≤ 3 on names over 10 chars. Every new proposal is checked against the **whole** catalog, not the module. |
| **CT-D4** | No double-fire for one tap | BLOCKER | The same name fired from both a composable callback and the ViewModel it calls, or from a `LaunchedEffect` that re-runs on recomposition or back-navigation. Look for track calls inside `LaunchedEffect(Unit)` on screens reachable by back. |
| **CT-D5** | One wire value, one constant | MINOR | Two constants with the same string value in the events object. |
| **CT-D7** | A tracker-level dedup guard must actually work: its key must exclude volatile auto-attached values (timestamps, counters), or no two events ever match and duplicates pass through | MAJOR | Read the dedup key builder. Every auto-attached key that changes per call (customer: `curr_dateTime`) must be excluded. |
| **CT-D6** | Re-firing engagement events (nav-listener `*_candidate_opened`) must not fire on pass-through routes that render nothing | MAJOR | Routes whose composable immediately navigates away (`LaunchedEffect { navigate(...) }`) inflate opens. |

---

## 5. Version continuity (CT-V) — comparing across releases and redesigns

The point: when a screen is redesigned, the dashboard line for "users who did X" must
continue unbroken.

| ID | Rule | Sev | Check |
|---|---|---|---|
| **CT-V1** | **Same action, same name.** When a design changes but the user action means the same thing (e.g. "accepted the booking" in the old card and in the new sheet), the new design fires the **same event name and same property keys**. The design difference goes in `flow_version` (CT-M6). | BLOCKER | **instrument:** every moment in a redesign maps old moment → new moment before naming. **audit:** `ct_diff.js` `RENAMED_WIRE` and `REMOVED` + `ADDED` pairs with the same meaning. |
| **CT-V2** | A rename is allowed only when the **meaning** changed. Then dual-emit the old and new names for ≥ 1 release, mark the old constant `@Deprecated` with a removal release, and record it in the master catalog. | MAJOR | Every `REMOVED` row in the diff has a deprecation record, or dashboards and journeys were confirmed clear. |
| **CT-V3** | Never silently stop firing. An event referenced in the previous version and unreferenced now is a regression until shown deliberate. | BLOCKER | `ct_diff.js` `LOST_CALLSITES` and `CALLSITES_DOWN`. |
| **CT-V4** | Enum values are frozen once shipped: don't change a value's spelling (`static` vs `static_ip`) or meaning | MAJOR | Diff `enums` between versions. Same moment's value set across callsites. |
| **CT-V5** | Property types and units are frozen: `duration` doesn't move from minutes to seconds; `amount` doesn't move from rupees to paise | MAJOR | Unit in the key name (`_min`, `_sec`, `_ms`, `_m`, `_dbm`, `_mbps`) or in a constant comment. |
| **CT-V6** | A master catalog exists per release and is diffed against the previous one before release | MAJOR | The audit action produces it. A missing previous catalog is regenerated from the previous release tag with `git archive`. |

---

## 6. Data quality (CT-Q)

| ID | Rule | Sev | Check |
|---|---|---|---|
| **CT-Q1** | **Personal data is allowed in CleverTap**, which Wiom uses internally: mobile, name, location and the like may be sent as event or profile properties. (a) **Sensitive values need a stated reason.** These are allowed *if necessary*, for example to see what users enter and use it later in a product workflow: passwords (e.g. the customer's WiFi password), OTPs, UPI ids, bank or payment details, government ids. **Ask the user why the value is required, and record the answer** in the row's Notes (instrument) or the finding (audit). Offer the lighter alternative in the same question when one would answer it: a boolean (`password_set`), a length or strength, a last-4, or a hash. (b) **Card data is the exception: warn and get explicit confirmation.** Full card numbers and CVV fall under PCI-DSS, the card industry's mandatory standard, which forbids storing a CVV after authorisation and restricts storing full card numbers; CleverTap keeps event data for years. Never add these without the user confirming after this warning. (c) **External destinations are flagged**: when the same event also reaches a third-party tool (Firebase, Meta, Branch), list the personal or sensitive keys going there so the owner can decide. | (a) MAJOR if no reason is recorded; none once it is. (b) BLOCKER until confirmed. (c) MINOR flag | (a) Grep prop values for password / otp / upi / vpa / account number / aadhaar / pan sources; each hit needs a recorded reason. (b) Grep for card number / pan / cvv / expiry values. (c) For apps that fan out (`sinks` = `track` in the customer app), list keys like `mobile`, `phone`, `name`, `*_latlong`, `ssid`, and any (a) keys, that ride along. |
| **CT-Q2** | No placeholder values. Never send a hard-coded `0`, `false`, `"none"`, `""` as if it were measured. If the value is unknown, **omit the key**. | BLOCKER | Grep track maps for literal `to 0`, `to false`, `to ""`, `to "none"` and `// placeholder`, `// TODO` comments near them. |
| **CT-Q3** | Fire timing matches the name: `_started` fires at start, `_completed` at completion | MAJOR | Read the trigger. |
| **CT-Q4** | Durations use a persisted anchor. For a resumable flow, start time comes from the server or storage, never from ViewModel creation. | MAJOR | Find the `startTime` source. |
| **CT-Q5** | No false success. A `_completed` / `_success` event never fires on a skip, mock, or bypass path without `outcome=skipped` | BLOCKER | Read every branch that sets the success state. |
| **CT-Q6** | Ids are join keys, not group-bys. High-cardinality values (ids, timestamps) never go in a property that dashboards will group on. | MINOR | Naming: ids end `_id`. |

---

## 7. Design rules (CT-X) — the reuse-first discipline

Details and worked examples are in `naming_playbook.md`. Listed here so they have IDs.

| ID | Rule |
|---|---|
| **CT-X1** | Reuse beats new names. A new event only after an existing event + property, a new enum value, and the auto page-view all fail (playbook §0). |
| **CT-X2** | Selection ≠ submit. Picks ride as properties on the submit. |
| **CT-X3** | No events for chrome: flash toggle, password eye, keystrokes, decorative renders, "continue past success". |
| **CT-X4** [house] | CSP: check the auto page-view (`screen_viewed`, the nav-listener re-fire) before proposing any `_opened`. Customer: there is no generic page view, so every new screen gets its own `<screen>_page_loaded` after `screenContext.update(...)`, as the app's rulebook requires. |
| **CT-X5** [house] | CSP: every sheet/dialog open reuses `sheet_opened` with a `SheetNames` value. Customer: follow its existing pattern (`*_bottom_sheet_shown`, `*_popup`); one name per sheet. |
| **CT-X6** [house] | Never invent a context value: CSP `Module`; customer `Flows` / `FunnelSteps` / `ScreenNames` (a new screen adds its `ScreenNames` constant, which the app's rulebook allows; flows and funnel steps are reused). |
| **CT-X7** | Flows with an envelope extend the envelope; the envelope is not spread elsewhere. |
| **CT-X8** | **Every event traces to a question.** An event with no metric or decision behind it is not added (instrument), and is reported for information (audit); existing events are never pushed for removal. |
