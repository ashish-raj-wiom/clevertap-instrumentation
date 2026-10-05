# App profiles

The rulebook (`rules.md`) has two kinds of rules:

- **Universal** rules apply to every app, whatever its house style: CleverTap limits (CT-L),
  data quality (CT-Q), duplicates (CT-D), version continuity (CT-V), fire-after-success
  (CT-M4), identity stability (CT-P1, CT-M8), and a recorded reason for sensitive values (CT-Q1).
- **House-style** rules depend on the app: naming pattern, context keys, the entity id, and
  how page views are recorded. They come from the profile below. **Follow the app's own
  convention for new events.** Existing events are accepted as they are (SKILL.md principle 10).

Pick the profile in Step 0a and pass `--profile <name>` to `scripts/ct_catalog.js` and
`scripts/ct_lint_spec.js`. Each profile describes how the app's tracker is built. Re-check it
against the current tracker (Step 1) before relying on it. For an app with no profile, read
its tracker the same way and add a profile here.

---

## csp — Wiom CSP (partner) app

| | |
|---|---|
| Repo | `wiom-tech/wiom-csp-app-apr09`, branch `development` |
| CleverTap project | **CSP Prod `44Z-644-777Z`**, CSP Test `54Z-644-777Z`. **Shared with the Technician app**; the two are told apart by the `Role` user property |
| CT-L1 budget | Shared: CSP **and** Technician names together, against 512 |
| Destinations | CleverTap only, plus a Crashlytics breadcrumb |
| Tracker | `core/data/.../analytics/AnalyticsTracker.kt` (interface + `Events`, `EventProps`, `Module`, `SheetNames`), `CleverTapAnalyticsTracker.kt` |
| Auto-attached | `module`, `screen` (from `ScreenContextHolder`, set by the nav listener), partner location set, `key`. **Not** `execution_id` |
| Context keys (CT-M1/M2) | `module` (a `Module` value), `screen` (readable, via `RouteScreenMapper`) |
| Entity id (CT-M3) | `execution_id`, passed by the callsite or a per-module helper |
| Page views | One generic `screen_viewed`, auto-fired by the nav listener; workflow routes re-fire `*_candidate_opened` instead |
| Naming (house) | `object_action`, past tense, product action not UI mechanic: `slot_proposed`, `technician_assigned`. Sheets reuse `sheet_opened` + `SheetNames` |
| Identity | `onUserLogin` with `Identity` = backend user id, plus `cspId`, `Role`, app/device fields |
| Debug log for verify | CT SDK VERBOSE (debug builds); the in-memory `CtEventJournal` with a shake inspector in `mock` / `staging` |
| Catalog flags | `--profile csp` |
| Push / background events | Fired outside a screen (push receiver, workers), so `module` / `screen` must be passed explicitly (CT-M1) |

## technician — Wiom Technician app (Kotlin)

| | |
|---|---|
| Repo | `wiom-tech/Technician-App`, branch **`development`** (`main` lags behind) |
| CleverTap project | **Same as CSP** |
| How the two apps are told apart | `Role = "technician"`, set on the profile **and stamped on every event**. CSP sends the raw server role (OWNER / MANAGER / ...) on the profile only |
| CT-L1 budget | Shared with CSP. A new name in either app spends the same budget |
| Destinations | CleverTap only |
| Tracker | `app/.../analytics/CleverTapAnalyticsTracker.kt`; constants in `core/common/.../analytics/Events.kt` (`Events`, `Module`, `EventProps`, `Sheet`, `CallTarget`) |
| Auto-attached | `module`, `screen`, **`execution_id`** (all from `ScreenContextHolder`, callsite wins), `page`, `flow`, `Role`, `key` |
| Context keys | `module`, `screen` (as CSP) |
| Entity id | `execution_id`, auto-attached here, unlike CSP |
| Page views | **One event name per screen**: the nav host fires `<screen>_viewed` for every non-task route (`pageViewed` in the tracker). Task screens re-fire candidate events instead. So a new non-task screen adds a new event name to the shared budget |
| Naming (house) | CSP style. When both apps record the same moment, reuse the CSP name (CT-D1 across apps) |
| Identity | `Identity` = technician backend id, plus `Role`, `technicianId`, `cspId`, `Name`, `Phone`, app/device fields |
| Debug log | CT SDK VERBOSE in debug builds |
| Catalog flags | `--profile technician` |

## technician-legacy — Wiom Expert app (Flutter, older Technician app)

| | |
|---|---|
| Repo | `wiom-tech/Expert-App` (Dart), `master` |
| Status | Replaced by the Kotlin Technician app; installs still in the field send to the **CSP project** |
| Tracker | `Utilities.cleverTapEventLog(...)` and `CleverTapEventConstants` come from the private package `wiom_repository_client_common` (source: `wiom-tech/wiom-flutter-common-repository-client`). App-local constants in `lib/core/constants/app_events.dart` (`AppEvents`, UPPER_SNAKE values) |
| Identity | `Identity` = username, or phone as fallback; role under **`user_role`**, not `Role` |
| Catalog | Not supported by `ct_catalog.js` (Dart, helper in an external package). Attribute its events through the schema reconcile (A2b) |

## customer — Wiom Customer app

| | |
|---|---|
| Repo | `wiom-tech/customer-app-kotlin`, branch `main` |
| CleverTap project | **Customer Prod `R95-6RK-5K6Z`**, Customer Test `8RZ-865-547Z`. Its own budget |
| Destinations | `track()` fans out to **CleverTap + Firebase + Meta + Branch**; `trackCleverTapOnly()` → CleverTap only; `trackBookingLogs()` → backend booking logs only, **not CleverTap**. **Firebase limits apply to every `track()` event** (CT-L9) |
| Tracker | `core/data/.../analytics/api/AnalyticsTracker.kt`, `internal/AnalyticsTrackerImpl.kt`, `internal/providers/CleverTapProvider.kt`, `internal/CommonPropertiesProvider.kt`, `internal/EventDeduplicator.kt` |
| Constants | `Events.kt` (`object Events`, with property keys as `PROP_*` inside it, plus `ScreenNames`, `Flows`, `FunnelSteps`). An older parallel set exists in `AnalyticsConstants.kt`; **new constants go in `Events.kt` only**, and must not reuse a name from the older set with a different value (CT-V4) |
| Auto-attached | `app_version`, `session_id`, `mobile`, `ad_id`, `unique_id`, `NewVsRepeat` (when known), `cost_breakdown_flow` + `_source` (once settled), `new_offering_slot_selection` (once armed), `page_name`, `flow`, `funnel_step`, `key`, `curr_dateTime`: up to **14 keys**, leaving **11** event-specific slots under Firebase's 25-parameter cap |
| Context keys (CT-M1/M2) | `page_name` (a `ScreenNames` value), `flow` (a `Flows` value: booking / login / installation / installed_customer / renewal), `funnel_step` (a `FunnelSteps` value). Set by `screenContext.update(...)` in each screen's `LaunchedEffect(Unit)`; an event fired before that update carries none of them |
| Entity id (CT-M3) | Not standardised. Booking / connection ids appear under several keys. Pick one canonical key before adding more |
| Page views | **One event per screen**: `<screen>_page_loaded` (or `<screen>_loaded`), fired after the context update. There is no generic page-view event, so CT-X4 does not apply |
| Naming (house) | Per the app's own rulebook `claude_context/agent_app_event_instructions.md`: page views `<screen>_page_loaded`; primary CTA `<action>_clicked` / `<action>_cta_clicked`; API outcomes `<action>_success_page_loaded` / `<action>_failed_page_loaded`. **`_clicked` is the house style here**, so CT-N2 does not apply |
| Property keys | Raw strings at callsites are allowed by the app's rulebook, so CT-N6 is a recommendation, not a blocker. New keys should get a `PROP_*` constant |
| Identity | `onUserLogin` with **`Identity` = the customer's mobile number**, `Phone`, `Name`, channel opt-ins. Differs from CSP, where Identity is the backend user id |
| Server-driven events | **Some event names are not in Kotlin.** Bundled SDUI screens (`assets/sdui_*.json`) carry `{"type": "log_event", "destination": "<event>"}` actions, which `ct_catalog.js` reads. SDUI configs sent by the server are not in the repo, so a code-only catalog is incomplete: **run the A2b reconcile against a CleverTap export** |
| Runtime-built names | Juspay clickstream events are sent as `juspay_<label>`; the catalog records the `juspay_*` pattern |
| Other senders into this project | Backend services and web surfaces also upload events to the Customer project, and the legacy Flutter customer app (`wiom-tech/customer-app`) is still installed. A new app event must not reuse a name another sender already uses for a different moment (CT-D1); the schema export shows those names |
| Dedup | `EventDeduplicator` drops the same name + key + non-common properties within 500 ms. Its exclusion list must cover every per-call auto key (CT-D7) |
| Debug log for verify | `adb logcat -s AnalyticsTracker`: every event with full properties in debug builds, plus `DEDUP SUPPRESSED` lines. Flavors `dev`, `qa`; Maestro suite under `maestro/` |
| Catalog flags | `--profile customer` |

### Customer-app rule notes

- **CT-Q1:** personal data is allowed in CleverTap. Because `track()` also reaches Meta /
  Firebase / Branch, list any personal or sensitive keys a new event adds (MINOR flag).
- **CT-L9:** every new `track()` event fits Firebase's limits: a 40-char name, ≤ 25
  parameters including the 14 auto keys, and 100-char values.
- **CT-M1/M2:** fire a new event only after `screenContext.update(...)` has run for its screen.
