#!/usr/bin/env node
/**
 * ct_score.js — Red / Yellow / Green audit of every event in a CleverTap project, against rules.md.
 *
 * Usage:
 *   node ct_score.js --schema <events_schema.csv> --sources <ct_event_sources.csv> --project <csp|customer>
 *        --out <ct_rag_<project>.csv> [--findings <code_findings.csv>] [--all]
 *
 * Scope: custom events that were TRIGGERED (volume this + last month > 0), plus events the app still
 * fires but CleverTap has discarded (data lost). --all also scores Active events with no volume.
 *
 * Inputs:
 *   schema   CleverTap "events schema" export (one row per event x property).
 *   sources  ct_event_sources_*.csv (Source Kind / Sender per event): decides which house rules apply.
 *   findings optional CSV `event,rule,severity,evidence` for violations only visible in code
 *            (fire-before-success, placeholders, wrong timing...). Merged in as-is.
 *
 * Mechanical checks per event (rule IDs from rules.md; severity BLOCKER / MAJOR / MINOR):
 *   universal   CT-L5 prohibited chars (BLOCKER) · CT-N1 not snake_case (MAJOR; MINOR for legacy apps)
 *               CT-L2 name > 40 chars (MINOR) · CT-N4 version / numbered suffix (MAJOR)
 *               CT-D3 same name in another casing / token order in the project (MAJOR)
 *               CT-L3 > 25 custom properties (MAJOR) · CT-N8 non-snake_case property keys (MINOR)
 *               CT-L7/V3 app fires a discarded event (BLOCKER)
 *   house, app events only (by Sender):
 *     csp / technician   CT-M1 no `module` (BLOCKER) · CT-M2 no `screen` (MAJOR)
 *                        CT-M3 task event without `execution_id` (BLOCKER) · CT-N2 UI-mechanic name (MAJOR)
 *     customer           CT-M1 no `flow` (BLOCKER) · CT-M2 no `page_name` (MAJOR)
 *                        CT-L9 fan-out event: name > 40 (MAJOR) or > 25 params incl. auto (MAJOR)
 *                        CT-Q1(c) personal keys reaching Meta / Firebase / Branch (MINOR flag)
 *
 * Grade:
 *   RED     any BLOCKER, or 3+ MAJOR          ("breaks most of the rules")
 *   YELLOW  1-2 MAJOR, or 3+ MINOR            ("breaks some rules, acceptable")
 *   GREEN   at most 2 MINOR                   ("follows the rules; minor slips are fine")
 */
const fs = require('fs');
const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
if (!a.schema || !a.out || !a.project) { console.error('need --schema --project --out'); process.exit(2); }

function parse(t) { const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f.replace(/\r$/, '')); rows.push(r); r = []; f = ''; } else f += c; }
  if (f || r.length) { r.push(f); rows.push(r); } return rows.filter(x => x.length > 1); }
const num = v => Number(String(v || '').replace(/[, ]/g, '')) || 0;

// Schema -> events with their properties that actually carry data.
const S = parse(fs.readFileSync(a.schema, 'utf8')); const sh = S.shift();
const col = re => sh.findIndex(h => re.test(h));
const iName = col(/^event name$/i), iKind = col(/system\/custom/i), iStatus = col(/^status$/i), iThis = col(/^this month$/i), iLast = col(/^last month$/i), iProp = col(/^property name$/i);
const iPropPts = sh.length > 15 ? 15 : -1;
const ev = new Map();
for (const r of S) {
  const n = r[iName]; if (!n) continue;
  if (!ev.has(n)) ev.set(n, { name: n, kind: r[iKind], status: r[iStatus], vol: num(r[iThis]) + num(r[iLast]), props: [] });
  if (r[iProp] && (iPropPts < 0 || num(r[iPropPts]) > 0)) ev.get(n).props.push(r[iProp]);
}
const SYS_PROP = p => /^CT /.test(p) || /^wzrk_/.test(p) || /^_branch_/.test(p) || /^(Campaign id|Campaign type|Variant|Install)$/.test(p);

// Sources -> sender / kind / bucket per event.
const src = new Map();
if (a.sources) { const T = parse(fs.readFileSync(a.sources, 'utf8')); const th = T.shift();
  for (const r of T) { const o = Object.fromEntries(th.map((h, i) => [h, r[i]])); src.set(o.Event, o); } }
const findings = [];
if (a.findings && fs.existsSync(a.findings)) { const F = parse(fs.readFileSync(a.findings, 'utf8')); const fh = F.shift();
  for (const r of F) findings.push(Object.fromEntries(fh.map((h, i) => [h, r[i]]))); }

// Name index for CT-D3: lower-case and token-sorted keys.
const allNames = [...ev.keys()];
const lowerIdx = {}; const tokIdx = {};
for (const n of allNames) { const l = n.toLowerCase(); (lowerIdx[l] = lowerIdx[l] || []).push(n);
  const t = l.split(/[_\- ]+/).filter(Boolean).sort().join('_'); (tokIdx[t] = tokIdx[t] || []).push(n); }

const TASK = /^(install|restore|nbrec|pickup|shifting|ticket|technician_assigned|arrival|selfie|aadhaar|payg|device_photo|provisioning|placement|speed_test|captured_optical|failed_to_capture|wizard|proof_|switchon|power_up|isp_form|customer_details|payment_checklist|threepin|rating_submitted)/;
const PERSONAL = /^(mobile|phone|name|current_latlong|latlong|selected_latlong|confirmed_latlong|suggested_latlong|lat_lng|ssid|connected_ssid|ssid_captured)$/;
const AUTO_CUSTOMER = 14; // keys the customer tracker can auto-attach (app_profiles.md)

// Keys the app's tracker attaches to EVERY event (app_profiles.md). Problems with them are tracker-level:
// reported once in the summary, not charged to each event (CT-L3 / CT-L9 still count them).
const AUTO = {
  customer: ['app_version', 'session_id', 'mobile', 'ad_id', 'unique_id', 'NewVsRepeat', 'cost_breakdown_flow', 'cost_breakdown_flow_source', 'new_offering_slot_selection', 'page_name', 'flow', 'funnel_step', 'key', 'curr_dateTime'],
  csp: ['module', 'screen', 'key', 'location_status', 'location_lat', 'location_lon', 'location_accuracy_m', 'location_fix_age_sec', 'location_is_mock'],
  technician: ['module', 'screen', 'execution_id', 'page', 'flow', 'Role', 'key'],
};
const autoFor = app => new Set(app === 'both' ? [...AUTO.csp, ...AUTO.technician] : AUTO[app] || []);
const projectNotes = new Set();

const rows = [];
for (const e of ev.values()) {
  if (e.kind === 'System') continue;
  const s = src.get(e.name) || {};
  const bucket = s.Bucket || '';
  const firesDiscarded = bucket === 'CODE_SENDS_DISCARDED';
  if (!a.all && !(e.vol > 0) && !firesDiscarded) continue;
  if (e.status === 'Discarded' && !firesDiscarded) continue;
  const sender = s.Sender || '';
  const kindS = s['Source Kind'] || 'unknown';
  const isLegacy = /legacy/.test(kindS);
  const isApp = /^app_code|^other_app|^app_runtime/.test(kindS);
  const app = a.project === 'customer' ? (isApp ? 'customer' : '')
    : /Technician-App/.test(sender) && /wiom-csp-app/.test(sender) ? 'both'
    : /Technician-App/.test(sender) ? 'technician' : isApp ? 'csp' : '';
  const v = []; const add = (rule, sev, why) => v.push({ rule, sev, why });
  const n = e.name;
  const custom = e.props.filter(p => !SYS_PROP(p));

  if (/[&$",%><!]/.test(n)) add('CT-L5', 'BLOCKER', 'prohibited character in name');
  else if (!/^[a-z][a-z0-9_]*$/.test(n)) add('CT-N1', isLegacy ? 'MINOR' : 'MAJOR', 'not snake_case');
  if (n.length > 40) add('CT-L2', 'MINOR', `name ${n.length} chars`);
  if (/(_v\d+|_new|_old|_android|_ios|_\d+)$/i.test(n)) add('CT-N4', 'MAJOR', 'version / numbered suffix');
  const twinsCase = (lowerIdx[n.toLowerCase()] || []).filter(x => x !== n);
  const twinsTok = (tokIdx[n.toLowerCase().split(/[_\- ]+/).filter(Boolean).sort().join('_')] || []).filter(x => x !== n && !twinsCase.includes(x));
  if (twinsCase.length) add('CT-D3', 'MAJOR', 'same name in another casing: ' + twinsCase.join(', '));
  if (twinsTok.length) add('CT-D3', 'MAJOR', 'same words, different order: ' + twinsTok.join(', '));
  if (custom.length > 25) add('CT-L3', 'MAJOR', `${custom.length} custom properties`);
  const auto = autoFor(app);
  for (const p of custom) if (auto.has(p) && !/^[a-z][a-z0-9_]*$/.test(p)) projectNotes.add(`CT-N8 (tracker, ${app}): auto-attached key "${p}" is not snake_case`);
  const badKeys = custom.filter(p => !auto.has(p) && !/^[a-z][a-z0-9_]*$/.test(p));
  if (badKeys.length) add('CT-N8', 'MINOR', 'non-snake_case keys: ' + badKeys.slice(0, 6).join(', ') + (badKeys.length > 6 ? ' …' : ''));
  if (firesDiscarded) add('CT-L7', 'BLOCKER', 'app still fires it, CleverTap discarded it: data dropped');

  if (app === 'csp' || app === 'technician' || app === 'both') {
    if (!custom.includes('module')) add('CT-M1', 'BLOCKER', 'no module');
    if (!custom.includes('screen')) add('CT-M2', 'MAJOR', 'no screen');
    if (TASK.test(n) && !/_shortcut_/.test(n) && !custom.includes('execution_id')) add('CT-M3', 'BLOCKER', 'task event without execution_id');
    if (/(^|_)(click|clicked|tap|tapped|button|btn|cta)(_|$)/.test(n)) add('CT-N2', 'MAJOR', 'names the UI mechanic');
  }
  if (app === 'customer') {
    if (!custom.includes('flow')) add('CT-M1', 'BLOCKER', 'no flow');
    if (!custom.includes('page_name')) add('CT-M2', 'MAJOR', 'no page_name');
    const fansOut = !/booking logs/.test(kindS); // track() fans out to Firebase / Meta / Branch
    if (fansOut && n.length > 40) add('CT-L9', 'MAJOR', 'over Firebase 40-char name limit');
    if (fansOut && custom.length > 25) add('CT-L9', 'MAJOR', `${custom.length} params > Firebase 25`);
    for (const p of custom) if (auto.has(p) && PERSONAL.test(p)) projectNotes.add(`CT-Q1 (tracker, customer): auto-attached "${p}" reaches Meta / Firebase / Branch on every track() event`);
    const pers = custom.filter(p => !auto.has(p) && PERSONAL.test(p));
    if (fansOut && pers.length) add('CT-Q1', 'MINOR', 'personal keys also reach Meta / Firebase / Branch: ' + pers.join(', '));
  }
  // Code findings; skip one that repeats a rule the mechanical checks already caught.
  for (const f of findings.filter(f => f.event === n)) if (!v.some(x => x.rule === f.rule && x.sev === f.severity)) add(f.rule, f.severity, f.evidence);

  const B = v.filter(x => x.sev === 'BLOCKER').length, M = v.filter(x => x.sev === 'MAJOR').length, m = v.filter(x => x.sev === 'MINOR').length;
  const grade = B || M >= 3 ? 'RED' : M || m >= 3 ? 'YELLOW' : 'GREEN';
  rows.push([grade, n, e.vol, e.status, kindS, sender.slice(0, 60), B, M, m, v.map(x => `${x.rule} ${x.sev}: ${x.why}`).join(' | ')]);
}
const order = { RED: 0, YELLOW: 1, GREEN: 2 };
rows.sort((x, y) => order[x[0]] - order[y[0]] || y[2] - x[2]);
const q = v => (/[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const hdr = ['Grade', 'Event', 'Volume (this + last month)', 'CT Status', 'Source Kind', 'Sender', 'Blockers', 'Majors', 'Minors', 'Violations'];
fs.writeFileSync(a.out, [hdr, ...rows].map(r => r.map(q).join(',')).join('\r\n') + '\r\n');
const tally = {}; const vol = {}; rows.forEach(r => { tally[r[0]] = (tally[r[0]] || 0) + 1; vol[r[0]] = (vol[r[0]] || 0) + r[2]; });
const rules = {}; rows.forEach(r => (r[9] ? r[9].split(' | ') : []).forEach(x => { const k = x.split(':')[0]; rules[k] = (rules[k] || 0) + 1; }));
console.log(JSON.stringify({ project: a.project, scored: rows.length, grades: tally, volume_by_grade: vol, violations_by_rule: rules, tracker_level: [...projectNotes] }, null, 1));
