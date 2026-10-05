# Verify — proving CT events fire

Verify takes an **expected event list** (from the instrument action's spec, or a list of
changed events) and proves, per event, that it fires at the right moment with the right
properties. Every row ends **PASS**, **FAIL**, or **NOT_RUN** with the evidence attached.
Never write PASS without evidence from the tier that produced it.

Run the highest tier the environment allows, and always run Tier 1.

| Tier | What it proves | Needs | Edits app code? |
|---|---|---|---|
| **1. Static** | A callsite exists, sends the listed keys, and sits after the success check | The repo | No |
| **2. Unit (JVM)** | The ViewModel calls `track()` with the right name and properties, including on the failure path | JDK + Gradle (or CI) | Adds test files, **ask first** |
| **3. Device** | The real app, driven like a user, emits the expected stream | Emulator/device + adb + Maestro (or CI) | Adds a Maestro flow, **ask first** |
| **4. Live data** | Events reached CleverTap with clean properties at the right volume | A released build + CT export or API | No |

---

## Step 0 — probe the environment (always)

```bash
adb version; emulator -list-avds; maestro --version; java -version
ls .github/workflows | grep -i maestro
```

Record what's present. If nothing local is available but the repo has a Maestro CI
workflow, Tiers 2–3 run in CI. Triggering a workflow or pushing a branch is outward-facing:
**ask before doing either.** Otherwise hand tech the generated files and the exact command,
and mark those rows `NOT_RUN — needs <tool>`.

---

## Tier 1 — static (always runs)

For each expected event:
1. `grep` the constant. Confirm a callsite exists on the moment the spec names, and that the
   callsite is reachable (its caller is called; CT-V3).
2. Confirm every listed property key is put at that callsite or by its helper. Auto-attached
   keys need the context check from CT-M1/M2.
3. Confirm ordering for outcome events (CT-M4): the track call follows the success check.
4. Run `scripts/ct_catalog.js` and confirm `raw_events` / `raw_prop_keys` introduce nothing
   new (CT-N6).

Evidence: `file:line` for the callsite and for each key.

---

## Tier 2 — unit tests (JVM)

Mirror the test style the repo already uses. In Wiom apps that's
`mockk<AnalyticsTracker>(relaxed = true)` in ViewModel tests (`HomeViewModelTest.kt`).
Generate one test per expected event, plus one per failure path:

```kotlin
@Test fun `technician_assigned fires only after assign succeeds`() = runTest {
    coEvery { repository.assignTechnician(any(), any(), any()) } returns Result.success(Unit)
    vm.assignTechnician(cardId = "t1", executorId = "e1", isSelf = true)
    advanceUntilIdle()
    verify(exactly = 1) {
        analytics.track(Events.TECHNICIAN_ASSIGNED, any(), match {
            it[EventProps.EXECUTION_ID] == "t1" && it[EventProps.ASSIGNEE_TYPE] == "self"
        })
    }
}

@Test fun `technician_assigned does not fire when assign fails`() = runTest {
    coEvery { repository.assignTechnician(any(), any(), any()) } returns Result.failure(Exception())
    vm.assignTechnician(cardId = "t1", executorId = "e1", isSelf = true)
    advanceUntilIdle()
    verify(exactly = 0) { analytics.track(Events.TECHNICIAN_ASSIGNED, any(), any()) }
}
```

Also assert **absence** where it matters: no placeholder values (CT-Q2), so
`assertFalse(props[EventProps.TIME_SINCE_ACCEPT_MIN] == 0)`, and exactly one fire per action
(CT-D4).

Run: discover the variant from `app/build.gradle.kts` flavors, then
`./gradlew :feature:<module>:test<Flavor>DebugUnitTest --tests "*<TestClass>*"`.
Evidence: the test report path and pass/fail per test.

---

## Tier 3 — device run (emulates opening the app)

This is the "open the app and tap through it" tier. A Maestro flow drives the real UI; the
CleverTap SDK's VERBOSE log is captured from logcat; `scripts/ct_logcat_check.js` diffs what
fired against the expected stream.

1. **Build.** Use the flavor with deterministic data and no real customers (Wiom CSP: `mock`,
   `applicationIdSuffix = ".mock"`). It must be a **debug** build: the CSP app enables CT
   VERBOSE logging only under `BuildConfig.DEBUG` (`WiomCspApplication.kt:158-162`).
2. **Flow.** Reuse the repo's existing Maestro flow for the journey if there is one (CSP app:
   `maestro/install_flow.yaml`, `maestro/flows/installation/*_mock.yaml`); otherwise write one
   under `maestro/flows/<module>/ct_<journey>_mock.yaml` that walks exactly the
   expected-stream moments, with an `assertVisible` before each tap so a UI miss fails loudly
   instead of producing a misleadingly short event stream.
3. **Capture and run:**
   ```bash
   adb logcat -c
   adb logcat -v time > ct_run.log &
   maestro test maestro/flows/<module>/ct_<journey>_mock.yaml
   kill %1
   node scripts/ct_logcat_check.js --log ct_run.log --expected expected_stream.json --out verify_device.csv
   ```
   **Use the app's own debug log when it has one; it beats SDK VERBOSE.** Customer app:
   `adb logcat -s AnalyticsTracker` prints every event with full properties in debug builds,
   and also prints `DEDUP SUPPRESSED: <name>` for events the tracker drops
   (`AnalyticsDebugLogger.kt`). Pass `--tag AnalyticsTracker` to the checker. The tag for
   each app is in `app_profiles.md`.
4. **Calibrate once per app.** The exact line format of the CT SDK's VERBOSE event log is not
   something this skill can assume. On the first run, open `ct_run.log`, find one known event,
   and record its line format in the app's verify notes. `ct_logcat_check.js` matches by
   event name plus `key`/`value` text within the next few lines, which tolerates most formats.
   If the check finds **zero** events while the flow passed, the format assumption is wrong:
   fix the matcher, don't report FAIL.
5. **Testability gap.** If VERBOSE is too noisy, or the build can't be debug, recommend that
   tech add a debug-only one-line log in the tracker (`Log.d("CT_EVENT", "$name $props")`)
   and match on that tag. That is an app change, so recommend it; don't make it.

Evidence: the log file, the Maestro report, and `verify_device.csv`.

`expected_stream.json` format, produced by the instrument action or written from the spec:
```json
[
  {"event": "install_candidate_opened", "props": {"entry_source": "home_card"}},
  {"event": "install_accepted"},
  {"event": "technician_assigned", "props": {"assignee_type": "self", "execution_id": "*"}},
  {"event": "arrival_marked", "props": {"execution_id": "*"}}
]
```
`"*"` means the key must be present with any value. Order is checked as a subsequence:
other events may interleave, but these must appear in this order.

---

## Tier 4 — live data (after release)

On one full production day after release, from a CleverTap export or the Get Events API
(<https://developer.clevertap.com/docs/get-events-api>), filtered to `AppVersion` ≥ the
release (needs CT-P3):

1. **Property sanity** (mechanical, zero is the target):
   - missing `execution_id` on entity events (CT-M3)
   - `screen` empty, matching `^s\d`, or containing `{` (CT-M2)
   - empty `module` (CT-M1)
   - placeholder values: a numeric property whose value is 0 on > 95% of rows (CT-Q2)
   - personal-data patterns in any string property: 10-digit numbers, `@` (CT-Q1)
2. **Volume reconciliation:** event counts vs the backend's own action log for the same day
   (Wiom: Snowflake via the `data-retrieval` skill). A gap over 5% is an instrumentation bug.
   An outcome event *higher* than backend successes means CT-M4 is violated.
3. **Version continuity:** for every redesigned flow, plot the event by `flow_version`. The
   line must continue across the release with no step change that the product change doesn't
   explain (CT-V1).

Evidence: the query or export, and counts per check.

---

## Output — `verify_<scope>_<date>.csv`

```
Event,Expected Moment,Expected Properties,Tier,Result,Evidence,Rule,Notes
order_confirmed,Confirm tap (server success),"execution_id, payment_method",1,FAIL,OrderViewModel.kt:120 tracks before repository.confirm() at :131,CT-M4,
order_confirmed,Confirm tap (server success),"execution_id, payment_method",3,NOT_RUN,no adb/emulator locally; CI workflow not triggered,,needs approval to dispatch the Maestro workflow
```

One row per event × tier that ran. The summary states, per tier, PASS / FAIL / NOT_RUN counts.
**NOT_RUN is never rounded up to PASS.**
