#!/usr/bin/env node
/**
 * ct_reconcile.js — compare the code catalog (ct_catalog.js JSON) with what CleverTap actually
 * received (an event list exported from the CleverTap dashboard, or built from its API).
 *
 * Usage:
 *   node ct_reconcile.js --catalog <ct_master.json> --ct <ct_events_export.csv> --out <reconcile.csv>
 *        [--name-col "Event Name"] [--count-col "Count"] [--other-app <other_catalog.json>]
 *
 * The export needs one row per event name; a count column is optional. Column names are
 * auto-detected (first column containing "event" / "name", first numeric column containing
 * "count" / "total" / "occurr") unless given. CleverTap system events (App Launched,
 * Notification Viewed, ...) are labelled, not flagged.
 *
 * Also reads CleverTap's full "events schema" export (one row per event x property, with Status,
 * This month / Last month, System/Custom, Campaign / Journey / Segment counts); detected by its
 * "Property name" column. Then volumes, Discarded status and campaign dependencies are used too:
 *   CODE_SENDS_DISCARDED  code still fires an event CleverTap has discarded: data silently dropped
 *   CODE_NO_RECENT_DATA   in code and Active in CleverTap, but zero volume this + last month
 *   CT_ACTIVE_NO_DATA     Active in CleverTap, not in code, zero volume this + last month (information only;
 *                         discarding is the project owner's call)
 *   CT_DISCARDED          discarded and not in code: nothing to do
 *
 * Every name lands in one bucket:
 *   BOTH                  in code and received by CleverTap
 *   CODE_NOT_IN_CT        in code (used as event, CT-reaching) but CleverTap never received it:
 *                         never fires, fires only on a path nobody uses, or not released yet
 *   CODE_DEAD_IN_CT       unreferenced in code but CleverTap still receives it: older app versions
 *                         in the field, or a server-driven / dynamic name
 *   CT_NOT_IN_CODE        received by CleverTap, absent from this code: server-driven (SDUI) names,
 *                         another app on the same project (--other-app), older releases, or raw strings
 *   OTHER_APP             received by CleverTap, found in the --other-app catalog (shared project)
 *   BOTH_PATTERN          received by CleverTap, matches a runtime-built name in code (e.g. juspay_*)
 *   SYSTEM                a CleverTap system event
 *   NOT_CT                in code but sent only to non-CleverTap sinks (e.g. booking_logs): expected absent
 */
const fs = require('fs');
const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1];
if (!a.catalog || !a.ct || !a.out) { console.error('need --catalog --ct --out'); process.exit(2); }

function parseCsv(t) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f.replace(/\r$/, '')); rows.push(r); r = []; f = ''; }
    else f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows.filter(x => x.some(v => v.trim()));
}

const SYSTEM = new Set(['App Launched', 'App Installed', 'App Uninstalled', 'App Version Changed', 'Notification Sent', 'Notification Viewed', 'Notification Clicked', 'Notification Delivered', 'Notification Replied', 'Push Impressions', 'Push Unregistered', 'UTM Visited', 'Web Session Started', 'Session Concluded', 'State Transitioned', 'Geocluster Entered', 'Geocluster Exited', 'Channel Unsubscribed', 'Channel Subscribed', 'Reply Sent', 'Charged', 'Stayed', 'Identity Set', 'Identity Reset']);

const cat = JSON.parse(fs.readFileSync(a.catalog, 'utf8'));
const other = a['other-app'] ? JSON.parse(fs.readFileSync(a['other-app'], 'utf8')) : null;
const rows = parseCsv(fs.readFileSync(a.ct, 'utf8'));
const head = rows.shift().map(h => h.trim());
const ni = a['name-col'] ? head.indexOf(a['name-col']) : head.findIndex(h => /event|name/i.test(h));
const ci = a['count-col'] ? head.indexOf(a['count-col']) : head.findIndex(h => /count|total|occurr/i.test(h));
if (ni < 0) { console.error('no event-name column found in ' + JSON.stringify(head) + '; pass --name-col'); process.exit(3); }

// Two input shapes:
//   simple list  — one row per event, optional count column
//   schema export — CleverTap's "events schema" CSV: one row per (event, property), with
//                   Status (Active / Discarded), This month / Last month volumes, System/Custom,
//                   and Campaign / Journey / Segment counts. Detected by a "Property name" column.
const num = v => Number(String(v || '').replace(/[, ]/g, '')) || 0;
const col = re => head.findIndex(h => re.test(h));
const schema = col(/^property name$/i) >= 0;
const ct = new Map();
const meta = new Map(); // schema mode: name -> { status, kind, thisM, lastM, camp, jour, seg, props }
if (schema) {
  const iStatus = col(/^status$/i), iKind = col(/system\/custom/i), iThis = col(/^this month$/i), iLast = col(/^last month$/i);
  const iProp = col(/^property name$/i), iCamp = col(/^campaign count$/i), iJour = col(/^journey count$/i), iSeg = col(/^segment count$/i);
  for (const r of rows) {
    const n = (r[ni] || '').trim();
    if (!n) continue;
    if (!meta.has(n)) meta.set(n, { status: r[iStatus], kind: r[iKind], thisM: num(r[iThis]), lastM: num(r[iLast]), camp: 0, jour: 0, seg: 0, props: 0 });
    const m = meta.get(n);
    if (r[iProp]) m.props++;
    m.camp = Math.max(m.camp, num(r[iCamp])); m.jour = Math.max(m.jour, num(r[iJour])); m.seg = Math.max(m.seg, num(r[iSeg]));
  }
  for (const [n, m] of meta) ct.set(n, m.thisM + m.lastM);
} else {
  for (const r of rows) {
    const n = (r[ni] || '').trim();
    if (n) ct.set(n, ci >= 0 ? num(r[ci]) : '');
  }
}
const isSystem = n => SYSTEM.has(n) || (meta.get(n) && meta.get(n).kind === 'System');
const ctStatus = n => (meta.get(n) ? meta.get(n).status : '');
const deps = n => { const m = meta.get(n); return m ? [m.camp && 'campaigns:' + m.camp, m.jour && 'journeys:' + m.jour, m.seg && 'segments:' + m.seg].filter(Boolean).join(' ') : ''; };
// CleverTap shows an event under one spelling; match names case-insensitively and flag the
// difference (code `click` vs CleverTap `CLICK`) instead of reporting two unrelated events.
const ctLower = new Map();
for (const n of ct.keys()) ctLower.set(n.toLowerCase(), n);
const ctName = n => (ct.has(n) ? n : ctLower.get(n.toLowerCase()));
const codeEvents = new Map();
const patterns = [];
for (const e of cat.events) codeEvents.set(e.name, e);
// Constants the catalog could only see as values. If CleverTap received the name, it is an event
// sent through a variable (`val ev = if (x) Events.A else Events.B`); otherwise it is a value. Skip it.
for (const e of cat.other_constants || []) if (ctName(e.name) && !codeEvents.has(e.name)) codeEvents.set(e.name, { ...e, status: 'USED_VIA_VARIABLE', sinks: ['unknown'] });
for (const e of cat.raw_events || []) {
  if (e.pattern) { patterns.push(e); continue; }
  if (!codeEvents.has(e.name)) codeEvents.set(e.name, { name: e.name, status: 'USED_AS_EVENT', sinks: [e.sink], callsites: [e.at] });
}
// Only patterns with a literal prefix are matched automatically (`juspay_*`). A pattern that starts
// with a wildcard (`*_viewed`) would swallow unrelated names; it is listed for manual attribution.
const patternFor = n => patterns.filter(p => !p.name.startsWith('*')).find(p => new RegExp('^' + p.name.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$').test(n));
const otherNames = new Set(other ? other.events.map(e => e.name).concat((other.raw_events || []).map(e => e.name)) : []);

// In schema mode a Discarded event is not "received": CleverTap drops it (CT-L7).
const received = n => !!ctName(n) && ctStatus(ctName(n)) !== 'Discarded';
const live = n => received(n) && (!schema || ct.get(ctName(n)) > 0); // schema mode: volume in this or last month
const out = [];
const seen = new Set();
for (const [n, e] of codeEvents) {
  seen.add(n);
  const ctOnlyNon = e.sinks && e.sinks.length && e.sinks.every(s => s === 'booking_logs');
  let bucket;
  const cn = ctName(n);
  if (cn && ctStatus(cn) === 'Discarded' && !ctOnlyNon && e.status !== 'UNREFERENCED') bucket = 'CODE_SENDS_DISCARDED';
  else if (ctOnlyNon) bucket = received(n) ? 'BOTH' : 'NOT_CT';
  else if (live(n)) bucket = e.status === 'UNREFERENCED' ? 'CODE_DEAD_IN_CT' : 'BOTH';
  else if (received(n)) bucket = e.status === 'UNREFERENCED' ? 'DEAD_BOTH' : 'CODE_NO_RECENT_DATA';
  else bucket = e.status === 'UNREFERENCED' ? 'DEAD_BOTH' : 'CODE_NOT_IN_CT';
  if (cn) seen.add(cn);
  const caseNote = cn && cn !== n ? ' [CleverTap shows it as "' + cn + '"]' : '';
  out.push([bucket, n + caseNote, e.status, (e.sinks || []).join('|'), cn ? ct.get(cn) : '', cn ? ctStatus(cn) : '', cn ? deps(cn) : '', (e.callsites || []).slice(0, 2).join(' ; ')]);
}
for (const [n, cnt] of ct) {
  if (seen.has(n)) continue;
  let bucket;
  const pat = patternFor(n);
  if (isSystem(n)) bucket = 'SYSTEM';
  else if (pat) bucket = 'BOTH_PATTERN';
  else if (otherNames.has(n)) bucket = 'OTHER_APP';
  else if (ctStatus(n) === 'Discarded') bucket = 'CT_DISCARDED';
  else if (schema && !cnt) bucket = 'CT_ACTIVE_NO_DATA';
  else bucket = 'CT_NOT_IN_CODE';
  out.push([bucket, n, pat ? 'pattern ' + pat.name : '', pat ? pat.sink : '', cnt, ctStatus(n), deps(n), pat ? pat.at : '']);
}
const order = { CODE_SENDS_DISCARDED: 0, CODE_NOT_IN_CT: 1, CODE_NO_RECENT_DATA: 2, CT_NOT_IN_CODE: 3, CT_ACTIVE_NO_DATA: 4, CODE_DEAD_IN_CT: 5, OTHER_APP: 6, BOTH: 7, BOTH_PATTERN: 7, NOT_CT: 8, DEAD_BOTH: 9, CT_DISCARDED: 10, SYSTEM: 11 };
out.sort((x, y) => order[x[0]] - order[y[0]] || x[1].localeCompare(y[1]));
const q = v => (/[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
fs.writeFileSync(a.out, [['bucket', 'event', 'code_status', 'sinks', schema ? 'ct_volume_this_plus_last_month' : 'ct_count', 'ct_status', 'ct_dependencies', 'callsites'], ...out].map(r => r.map(q).join(',')).join('\r\n') + '\r\n');
const summary = {};
out.forEach(r => (summary[r[0]] = (summary[r[0]] || 0) + 1));
// CT-L1: in schema mode, the budget is the Active names (Discarded ones no longer accept data).
const activeNames = schema ? [...meta.entries()].filter(([, m]) => m.status !== 'Discarded').length : ct.size;
console.log(JSON.stringify({ ct_names: ct.size, active_names: activeNames, budget_used: activeNames + ' / 512 (' + Math.round(activeNames / 5.12) + '%)', summary }));
