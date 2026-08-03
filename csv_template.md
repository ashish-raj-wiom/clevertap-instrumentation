# CT Instrumentation CSV — Format Reference

Two CSV shapes come up, depending on the phase. Both use standard RFC4180 quoting: wrap a
field in double quotes if it contains a comma or a double quote, and double any internal
quote character. Use `\r\n` line endings for maximum spreadsheet-tool compatibility.

---

## Shape A — UI-element gap audit (Phase 2 output, or verifying someone else's audit)

One row per interactive control. Header:

```
Module,Flow,Screen,Route,Screen File,Trigger,Event (Plain Language),Event Code,Origin,Status
```

| Column | Meaning |
|---|---|
| `Module` | The app's existing module/category value this control's screen belongs to (never invent a new one — see Operating Principle 3) |
| `Flow` | Human-readable sub-flow name within the module (e.g. "Install wizard", "Returns", "Withdraw") |
| `Screen` | Screen/composable name |
| `Route` | The nav route string, if this screen is independently routable; blank/placeholder if it's a sheet/dialog/overlay nested inside another route |
| `Screen File` | File path to the screen's source (this is what makes the audit re-verifiable later — always fill it in) |
| `Trigger` | Plain-language description of the specific tap/gesture/system-event this row covers |
| `Event (Plain Language)` | What fires today, in plain English, or `(no event)` / `(no event - navigation only)` etc. if nothing does |
| `Event Code` | The actual `Events.X` constant reference if one fires, or `—` if none |
| `Origin` | Where the track call is made from: `VM` (ViewModel), `UI` (composable directly), `SheetVM` (a shared sheet-analytics helper), or `—` |
| `Status` | `AVAILABLE` / `MISSING` / `DEAD CODE` — see Phase 2 definitions in SKILL.md |

**Adding rows the original audit missed:** when your own pass finds a control the input CSV
never listed at all (a whole feature added since, a duplicate control, a bonus finding),
still add it as a normal row — don't create a separate document for it. Just make it
obvious it's an addition, e.g. put `NOT IN ORIGINAL CSV` in Status if you're comparing
against an existing document.

---

## Shape B — Tech-ready final recommendations (Phase 3/4 output)

If you're reconciling against an existing Shape-A-style input, KEEP its original columns
(minus any now-superseded "recommended addition" column the input had) and append exactly:

```
...<original columns>...,Final Event Name,Properties,Notes
```

| Column | Rules |
|---|---|
| `Final Event Name` | The precise event constant/name tech should use. If nothing changes from what's already live, restate the existing name with `(existing)` or `(no change)` — don't leave it blank for rows that are already correct, that reads as unreviewed. If no event is needed at all, leave this blank and put the reason in Notes. If reusing an existing event at a new callsite, write `event_name (reuse)`. |
| `Properties` | The concrete property list, using the app's existing constant names wherever they exist. Only include `module=`/`execution_id=` explicitly when Operating Principle 6's exception applies — otherwise leave common auto-attached properties out. If a property should be ADDED to an event that already exists, say so explicitly (`+ retake_count — missing today, add`). If a raw-string-key migration is needed (see naming_playbook.md §8), name the proper constant here as the target. |
| `Notes` | One line, only when something needs to be said: which other rows share this same final recommendation (name them so nobody re-derives the consolidation from scratch), a dead-code wiring instruction, a "which file is actually live" correction, or an audit-error correction. Leave blank when the row is simple and self-explanatory from the other columns — don't pad. |

### Row correspondence rule (non-negotiable)

Every row in the input keeps its own row in the output, 1:1 — even when 8 input rows all
resolve to the exact same final event+properties (state that once, then repeat it, or use a
single output row spanning the original row-number range if your tooling supports it, but
never silently delete rows). Verify this programmatically before calling the deliverable
done: for every original row number, confirm exactly one output row maps to it, and print any
that don't.

### Worked example (abbreviated)

```
Module,Flow,Screen,Route,Screen File,Trigger,Event (Plain Language),Event Code,Origin,Status,Final Event Name,Properties,Notes
Wallet,Withdraw,WalletHomeScreen,wallet_home,feature/wallet/.../WalletHomeScreen.kt,Tap Withdraw primary CTA,(no event),—,—,MISSING,,,Covered by existing screen_viewed(screen=wallet_withdraw) auto-fire on arrival — no new event needed
Wallet,AddFunds,AddFundsFlowScreen,wallet_add_funds,feature/wallet/.../AddFundsFlowScreen.kt,Tap Pay CTA (METHOD step),(no event),—,—,MISSING,add_funds_confirmed,"amount, payment_method, is_payoff (Bool), outcome (success/pending/declined/timeout/network_error)",P0 — confirmAddFunds() has zero tracking today; this is the module's most important gap
Wallet,Ledger,WalletLedgerScreen,wallet_ledger,feature/wallet/.../WalletLedgerScreen.kt,Tap underline filter tab,Ledger filter applied,Events.LEDGER_FILTER_APPLIED,VM,AVAILABLE,LEDGER_FILTER_APPLIED (existing),filter,Fires today with a raw "filter" string key — migrate to an EventProps constant
```

Note: row 1 needs no new event (auto-fire already covers it), row 2 is a genuinely new event
with a full property list and a priority note, row 3 is an already-correct event with a
drift-migration note only.

---

## Producing this at scale (script, don't hand-transcribe)

For anything beyond ~20 rows, parse the input CSV and any per-module recommendation
tables programmatically (a short Node/Python script) rather than hand-copying — hand
transcription at row counts in the hundreds reliably introduces silent errors. Always run
the "every input row has exactly one output row" check as part of the script, and print
(don't silently swallow) any row-label formats your parser doesn't recognize (ranges,
slash-separated pairs, placeholder markers for added rows) so you can extend the parser
rather than lose rows.
