# Output templates

All CSVs use RFC4180 quoting (wrap a field containing a comma, quote or newline in double
quotes; double any internal quote) and `\r\n` line endings. Build them with a script, never
by hand: hand transcription at hundreds of rows reliably drops rows silently.

| Action | Files |
|---|---|
| audit | `ct_master_<app>_<version>.csv` · `ct_master_<app>_<version>.json` · `ct_profile_<app>_<version>.csv` · `ct_diff_<prev>_to_<version>.csv` · `ct_reconcile_<app>_<date>.csv` + `ct_event_sources_<project>_<date>.csv` (when a CleverTap export exists) · `ct_violations_<app>_<version>.csv` · optional `ct_gap_audit_<scope>.csv` (Shape A/B) |
| instrument | `ct_spec_<feature>_<date>.csv` · `expected_stream_<feature>.json` |
| verify | `verify_<scope>_<date>.csv` (format in `verify.md`) |

Default folder: the workspace's existing CT-instrumentation folder (Wiom:
`C:\Users\ashis\clevertap-instrumentation-plan\`), one dated subfolder per run. **Keep
every `ct_master_*.json`.** It is the "previous version" the next audit diffs against.

---

## Audit — master catalog `ct_master_<app>_<version>.csv`

One row per event name that exists in this version: constants, raw literals, and SDK/system
events the app fires itself (`pn_clicked`, `InApp_*`).

```
Event,Constant,Family,Module,Trigger,Properties Sent,Callsites,Status,Change vs Prev,Rule Violations,Notes
```

| Column | Rules |
|---|---|
| `Event` | Wire name exactly as sent |
| `Constant` | `Events.X`, or `(raw literal)` |
| `Family` | `entry` / `outcome` / `engagement` / `system` / `envelope:<flow>`. Decides which must-haves apply (rules.md §1) |
| `Module` | Module value(s) it fires with. `"" (bug)` if it can fire with an empty module |
| `Trigger` | Plain language: the user or system moment |
| `Properties Sent` | Keys actually put at the callsite(s), plus the auto-attached set as `+auto`. Read from code, never from a spec |
| `Callsites` | `file:line ; file:line`, from `ct_catalog.js`, confirmed by reading |
| `Status` | `FIRES` (reachable callsite confirmed) · `UNREACHABLE` (referenced only from code with no caller) · `UNREFERENCED` (declared, zero references) · `DEPRECATED_ALIAS` (dual-emit, with removal release) |
| `Change vs Prev` | From `ct_diff.js`: `ADDED` / `UNCHANGED` / `RENAMED_WIRE` / `LOST_CALLSITES` / `CALLSITES_DOWN` / `REPOINTED`. `REMOVED` events appear as rows too, with `Status=GONE`, so the "missed from previous version" list sits inside the master |
| `Rule Violations` | Rule IDs, comma-separated (`CT-M4, CT-Q2`). Blank = clean |
| `Notes` | Only when needed |

Footer rows (in the summary file, not the CSV): **CT-L1 budget**. Distinct event names in
this app, the union across apps sharing the CT account if known, + 25 system events, as a
% of 512.

## Audit — event sources `ct_event_sources_<project>_<date>.csv`

One row per event name in the CleverTap project (from the schema export), so every event
has an owner.

```
Event,Bucket,Volume (this + last month),CT Status,Source Kind,Sender,Evidence,Confidence
```

| Column | Rules |
|---|---|
| `Bucket` | From `ct_reconcile.js` |
| `Source Kind` | `app_code` · `app_runtime_name` (built at runtime, e.g. `juspay_*`) · `server_side` · `other_app` (same project, e.g. Technician on CSP) · `legacy_app` · `cleverTap_system` · `unknown` |
| `Sender` | Repo / service / surface name, e.g. `customer-app-kotlin`, `booking-service-java` |
| `Evidence` | `file:line` or URL for a code hit; the property fingerprint (e.g. "no app_version / session_id; carries account_id") otherwise |
| `Confidence` | `CONFIRMED` (exact name found in the sender's code) · `LIKELY` (fingerprint, prefix or date only) · `UNKNOWN` |

## Audit — grades `ct_rag_<project>_<date>.csv`

Produced as-is by `scripts/ct_score.js`:
`Grade,Event,Volume (this + last month),CT Status,Source Kind,Sender,Blockers,Majors,Minors,Violations`.
Sorted Red → Yellow → Green, then by volume. `Violations` lists `rule severity: why` per
break. Code findings keep their CONFIRMED / REPORTED tag.

## Audit — user profile `ct_profile_<app>_<version>.csv`

```
Profile Key,Source,Conditional,Change vs Prev,Rule Violations,Notes
```
`Source` is `file:line` of the `put`. `Conditional` is `yes` if guarded (`if (x != null)`).

## Audit — version diff `ct_diff_<prev>_to_<version>.csv`

Produced as-is by `scripts/ct_diff.js`: `kind,change,name,constant,prev_refs,curr_refs,note`.
Sorted with regressions first (`REMOVED`, `LOST_CALLSITES`, `RENAMED_WIRE`, `CALLSITES_DOWN`).
Claude adds a verdict per regression in the violations file. **A row is a regression until
shown deliberate.**

## Audit — violations `ct_violations_<app>_<version>.csv`

```
Rule,Severity,Event / Key,Evidence,Fix,Status
```
One row per violation instance. `Evidence` is `file:line`; `Status` is `CONFIRMED` (lead
re-read the code) or `REPORTED` (from a sub-agent, not yet re-read). Sorted
BLOCKER → MAJOR → MINOR.

---

## Audit (optional) — control-level gap audit, Shapes A and B

Use when the user wants coverage of every button in a scope, not only an inventory.

**Shape A** (one row per interactive control):
```
Module,Flow,Screen,Route,Screen File,Trigger,Event (Plain Language),Event Code,Origin,Status
```
`Status` is `AVAILABLE` / `MISSING` / `DEAD CODE`. `Origin` is `VM` / `UI` / `SheetVM` / `—`.

**Shape B** (Shape A + recommendation): append `Final Event Name,Properties,Notes`.
- `Final Event Name`: `name (no change)` if already correct · `name (reuse)` for a new
  callsite · blank only when no event is needed, with the reason in Notes.
- `Properties`: event-specific keys only; mark additions `+ key — add`.
- **Row correspondence is non-negotiable.** Every input row maps to exactly one output row,
  checked by script. Rows found that weren't in an input audit are added and labelled
  `NOT IN ORIGINAL CSV`.

Example:
```
Module,Flow,Screen,Route,Screen File,Trigger,Event (Plain Language),Event Code,Origin,Status,Final Event Name,Properties,Notes
wallet,Withdraw,WalletHomeScreen,wallet_home,feature/wallet/.../WalletHomeScreen.kt:212,Tap Withdraw CTA,(no event),—,—,MISSING,,,screen_viewed(screen=wallet_withdraw) on arrival already covers it (CT-X4)
wallet,AddFunds,AddFundsFlowScreen,wallet_add_funds,feature/wallet/.../AddFundsFlowScreen.kt:301,Tap Pay CTA,(no event),—,—,MISSING,add_funds_confirmed,"amount, payment_method, is_payoff (Bool), outcome, failure_reason",Fire after the payment result (CT-M4)
```

---

## Instrument — spec `ct_spec_<feature>_<date>.csv`

The requirements file. One row per **moment** in the workflow, in flow order. A moment that
needs no event still gets a row, so the decision and its reason are visible. Written for an
engineer who never saw the PRD or the interview: every row must make sense on its own.

```
#,Step,Moment,Question,Decision,Event,Instruction,Properties,Must-haves,Fires When,Do Not Fire When,Family,Priority,Replaces,Design Ref,Budget After,Rules Checked,Notes
```

| Column | Rules |
|---|---|
| `#` | Row number in flow order (1, 2, 3 …). Failure-branch rows sit right after the step they branch from (`4a`, `4b`) |
| `Step` | The workflow step or screen this moment belongs to, as the user named it |
| `Moment` | The user or system moment, in plain language: "Technician taps Mark Arrived and the server confirms" |
| `Question` | The question this row answers (CT-X8). Use the same text across every row that serves the same question |
| `Decision` | `NO_EVENT` · `AUTO` (already covered by the page-view auto-fire) · `REUSE` (existing event, new place) · `NEW_ENUM` (existing event, new property value) · `NEW_PROPERTY` (existing event, extra key) · `NEW_EVENT` · `CONTINUITY` (redesign of an existing moment: same name, new `flow_version`) |
| `Event` | Exact wire name. Blank only for `NO_EVENT`; for `AUTO`, the auto event (e.g. `screen_viewed`) |
| `Instruction` | **One or two complete sentences an engineer can implement from**, e.g. "Fire `arrival_marked` once, after the mark-arrived API returns success. On failure, fire it with `outcome=failure` and the error as `failure_reason`." For `NO_EVENT`: the reason ("Selection only: the chosen value rides on `slot_proposed` as `slot_window`"). For `AUTO`: what already covers it |
| `Properties` | Every event-specific key as `key (type): allowed values / meaning`, separated by `;`, e.g. `outcome (string): success\|failure; failure_reason (string): network\|validation\|server; retake_count (int): retakes before submit`. Types are fixed forever (CT-L8, CT-V5). Mark keys added to an existing event `+new` |
| `Must-haves` | The must-haves for this family from rules.md §1, stated explicitly even when the app auto-attaches them, e.g. `module=installation (auto); screen (auto); execution_id (pass explicitly); entry_source`. An engineer must not have to look them up |
| `Fires When` | The exact moment. With a repo: the code moment ("after `assignTechnician` returns success"). Without one: product terms precise enough to place ("after the server confirms; not on tap") (CT-M4, CT-Q3) |
| `Do Not Fire When` | The cases that must **not** fire it: before the result is known, on failure (unless `outcome` covers it), on back-navigation re-render, on skip/mock paths, twice for one action (CT-M4, CT-D4, CT-Q5). Blank only for `NO_EVENT` |
| `Family` | `entry` / `outcome` / `engagement` / `system` / `envelope:<flow>`. Decides the must-haves |
| `Priority` | `P0`: needed to answer a stated question. `P1`: diagnostic (explains a P0 number, e.g. failure reasons). `P2`: nice to have. Tech ships P0 first |
| `Replaces` | For `CONTINUITY` / redesign rows: the old moment and event this one continues (CT-V1) |
| `Design Ref` | PRD section / Figma frame name or node id / screen name / "interview round 3" |
| `Budget After` | CT-L1 count after this row, for `NEW_EVENT` rows only, e.g. `219 / 512 (43%)` |
| `Rules Checked` | Rule IDs checked and passed for this row |
| `Notes` | Only when needed: open questions, `reuse not checked against live catalog`, dependencies on backend fields |

Example (two rows):
```
#,Step,Moment,Question,Decision,Event,Instruction,Properties,Must-haves,Fires When,Do Not Fire When,Family,Priority,Replaces,Design Ref,Budget After,Rules Checked,Notes
3,Arrival,Technician marks arrived and the server confirms,% of assigned installs reaching arrival within 24h,REUSE,arrival_marked,"Fire arrival_marked once, after the mark-arrived API returns success. On API failure fire it with outcome=failure and the error category as failure_reason.","outcome (string): success|failure +new; failure_reason (string): network|server|validation +new; time_since_assigned_min (int): minutes since assignment, omit if unknown","module=installation (auto); screen (auto); execution_id (pass explicitly)",After the mark-arrived API returns,"On tap before the API returns; on back-navigation to the screen; never twice for one task",outcome,P0,,Interview round 3,,"CT-M3, CT-M4, CT-Q2",
4,Arrival,Technician picks arrival time slot from list,% of assigned installs reaching arrival within 24h,NO_EVENT,,"Selection only: the chosen slot rides on slot_proposed as slot_window.",,,,,,P2,,Interview round 3,,CT-X2,
```

Plus `expected_stream_<feature>.json` (format in `verify.md`): the happy-path stream and one
stream per failure branch. This is the verify action's input.
