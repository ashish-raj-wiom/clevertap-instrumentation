#!/usr/bin/env node
/**
 * ct_lint_spec.js — check NEW or CHANGED event definitions against rules.md before they ship.
 * Existing events are accepted as they are; only what is being defined now is graded.
 *
 * Usage:
 *   Spec mode   node ct_lint_spec.js --profile <csp|technician|customer> --spec <ct_spec.csv>
 *                    --catalog <ct_master.json>[,<other_app.json>] [--schema <events_schema.csv>] [--out <lint.csv>]
 *   Quick mode  node ct_lint_spec.js --profile customer --event "otp_resend_clicked"
 *                    [--props "attempt_number,phone"] [--family outcome|entry|engagement]
 *                    --catalog <ct_master.json> [--schema <events_schema.csv>]
 *
 * Spec columns used (templates.md § Instrument): Event, Decision, Properties, Must-haves,
 * Fires When, Do Not Fire When, Family, Notes. Only rows with Decision NEW_EVENT / NEW_PROPERTY /
 * NEW_ENUM / REUSE / CONTINUITY are checked; NO_EVENT and AUTO are skipped.
 *
 * Grade per row (same scale as ct_score.js):
 *   RED     any BLOCKER, or 3+ MAJOR   -> must be fixed before the spec goes to engineering
 *   YELLOW  1-2 MAJOR, or 3+ MINOR     -> allowed only with a reason in Notes
 *   GREEN   at most 2 MINOR
 * Each finding carries a concrete fix, and the output suggests a compliant name when the name fails.
 */
const fs = require('fs');
const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
const P = a.profile || 'csp';
if (!a.spec && !a.event) { console.error('need --spec <csv> or --event <name>'); process.exit(2); }

function parse(t) { const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f.replace(/\r$/, '')); rows.push(r); r = []; f = ''; } else f += c; }
  if (f || r.length) { r.push(f); rows.push(r); } return rows.filter(x => x.length > 1); }
const num = v => Number(String(v || '').replace(/[, ]/g, '')) || 0;

// ── Existing names: code catalogs + (optional) CleverTap schema export ─────────────────────────
const existing = new Map(); // name -> { where, status }
for (const f of String(a.catalog || '').split(',').filter(Boolean)) {
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const e of c.events) existing.set(e.name, { where: 'code', status: e.status });
  for (const e of c.raw_events || []) if (!e.pattern) existing.set(e.name, { where: 'code', status: 'USED_AS_EVENT' });
  for (const e of c.other_constants || []) if (!existing.has(e.name)) existing.set(e.name, { where: 'code', status: 'REFERENCED_OTHER' });
}
const propKeys = new Set();
for (const f of String(a.catalog || '').split(',').filter(Boolean)) {
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const p of c.props || []) propKeys.add(p.key);
  for (const k of c.raw_prop_keys || []) propKeys.add(k.key);
}
let activeCount = null;
if (a.schema) {
  const S = parse(fs.readFileSync(a.schema, 'utf8')); const h = S.shift();
  const iN = h.findIndex(x => /^event name$/i.test(x)), iS = h.findIndex(x => /^status$/i.test(x));
  const seen = new Map();
  for (const r of S) if (r[iN] && !seen.has(r[iN])) seen.set(r[iN], r[iS]);
  for (const [n, s] of seen) existing.set(n, { where: existing.has(n) ? 'code + clevertap' : 'clevertap', status: s });
  activeCount = [...seen.values()].filter(s => s !== 'Discarded').length;
}
const names = [...existing.keys()];
const lower = new Map(names.map(n => [n.toLowerCase(), n]));
const tokKey = n => n.toLowerCase().split(/[_\- ]+/).filter(Boolean).sort().join('_');
const tokIdx = new Map(); names.forEach(n => { const k = tokKey(n); if (!tokIdx.has(k)) tokIdx.set(k, []); tokIdx.get(k).push(n); });
function lev(x, y) { const d = Array.from({ length: x.length + 1 }, (_, i) => [i]); for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); return d[x.length][y.length]; }

// ── House style per profile (app_profiles.md) ─────────────────────────────────────────────────
const HOUSE = {
  csp: { name: /_(opened|viewed|selected|submitted|confirmed|completed|failed|failure_reported|started|cancelled|dismissed|retried|initiated|assigned|accepted|declined|marked|verified|acknowledged|added|removed|updated|changed|expanded|toggled|played|captured|reported|resolved|sent|received|blocked)$/,
         nameHint: 'object_action, past tense (e.g. slot_proposed)', mustCtx: ['module', 'screen'], entity: 'execution_id', uiMechanic: true, maxName: 40, autoCount: 9 },
  technician: { name: null, nameHint: 'same as CSP', mustCtx: ['module', 'screen'], entity: 'execution_id', uiMechanic: true, maxName: 40, autoCount: 7 },
  customer: { name: /(_page_loaded|_loaded|_clicked|_cta_clicked|_shown|_success|_failed|_success_page_loaded|_failed_page_loaded|_popup|_selected|_submitted|_completed|_opened|_dismissed|_expanded)$/,
         nameHint: '<screen>_page_loaded / <action>_clicked / <action>_success_page_loaded', mustCtx: ['flow', 'page_name'], entity: null, uiMechanic: false, maxName: 40, autoCount: 14, fanOut: true },
};
HOUSE.technician.name = HOUSE.csp.name;
const H = HOUSE[P];
const ENTITY_SYNONYMS = /^(task_id|ticket_id|candidate_id|booking_id|order_id|orderId|connection_task_id)$/;
const SENSITIVE = /(password|passwd|pwd|otp|upi|vpa|account_number|ifsc|aadhaar|aadhar|pan_number|pan_no)/i;
const CARD = /(card_number|cardnumber|cvv|cvc|card_expiry|expiry_date|pan$)/i;
const TASKY = /^(install|restore|nbrec|pickup|shifting|ticket|technician|arrival|proof|netbox|task)/;

const suggest = n => {
  let s = n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s\-]+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
  s = s.replace(/(_v\d+|_new|_old|_android|_ios|_\d+)$/, '');
  if (H.uiMechanic) s = s.replace(/_(button|btn|cta)(?=_|$)/g, '').replace(/_(clicked|tapped)$/, '_selected');
  if (s.length > H.maxName) s = s.slice(0, H.maxName).replace(/_[^_]*$/, '');
  return s;
};

let specRows = [];
const specNew = new Set();
function lint(row) {
  const v = []; const add = (rule, sev, why, fix) => v.push({ rule, sev, why, fix });
  const n = (row.Event || '').trim();
  const dec = (row.Decision || 'NEW_EVENT').trim().toUpperCase();
  const fam = (row.Family || '').toLowerCase();
  const props = (row.Properties || '').split((row.Properties || '').includes(';') ? /;/ : /,/).map(x => x.trim()).filter(Boolean).map(x => x.split(/[\s(:=]/)[0]).filter(Boolean);
  const text = [row.Properties, row['Must-haves'], row.Notes].join(' ');
  const notes = row.Notes || '';
  const ex = existing.get(n);
  const isNewName = dec === 'NEW_EVENT' || (!ex && !specNew.has(n) && !['REUSE', 'CONTINUITY', 'NEW_PROPERTY', 'NEW_ENUM'].includes(dec));

  // Existence / continuity
  if (ex && ex.status === 'Discarded') add('CT-L7', 'BLOCKER', 'name is Discarded in CleverTap: data sent to it is dropped', 'pick a new name');
  if (isNewName && ex && ex.status !== 'Discarded') add('CT-D1', 'MAJOR', `"${n}" already exists (${ex.where}); a new definition must not reuse it for a different moment`, 'mark the row REUSE if it is the same moment, else rename');
  if (!isNewName && !ex && !specNew.has(n)) add('CT-X1', 'MINOR', `Decision is ${dec} but "${n}" was not found in code or CleverTap`, 'check the name, or mark NEW_EVENT');

  // Naming (new names only: existing names are kept as they are, CT-V1)
  if (isNewName) {
    if (/[&$",%><!]/.test(n)) add('CT-L5', 'BLOCKER', 'prohibited character', 'use snake_case');
    else if (!/^[a-z][a-z0-9_]*$/.test(n)) add('CT-N1', 'MAJOR', 'not snake_case', 'use snake_case');
    if (H.name && /^[a-z][a-z0-9_]*$/.test(n) && !H.name.test(n)) add('CT-N1', 'MINOR', `does not follow the house pattern (${H.nameHint})`, 'rename to the house pattern');
    if (/(_v\d+|_new|_old|_android|_ios|_\d+)$/i.test(n)) add('CT-N4', 'MAJOR', 'version / numbered suffix', 'drop the suffix; put the variant in flow_version');
    if (n.length > H.maxName) add(H.fanOut ? 'CT-L9' : 'CT-L2', H.fanOut ? 'MAJOR' : 'MINOR', `${n.length} chars (> ${H.maxName}${H.fanOut ? ', Firebase limit' : ''})`, 'shorten');
    if (H.uiMechanic && /(^|_)(click|clicked|tap|tapped|button|btn|cta)(_|$)/.test(n)) add('CT-N2', 'MAJOR', 'names the UI mechanic, not the product action', 'name the action (e.g. _initiated / _confirmed / _selected)');
    const twin = lower.get(n.toLowerCase());
    if (twin && twin !== n) add('CT-D3', 'MAJOR', `same as existing "${twin}" in another casing`, `reuse "${twin}"`);
    const tok = (tokIdx.get(tokKey(n)) || []).filter(x => x !== n && x !== twin);
    if (tok.length) add('CT-D3', 'MAJOR', `same words as existing ${tok.slice(0, 3).map(x => '"' + x + '"').join(', ')}`, 'reuse the existing name');
    if (n.length > 10) { const near = names.filter(x => x !== n && x !== twin && !tok.includes(x) && Math.abs(x.length - n.length) <= 2 && lev(x.toLowerCase(), n.toLowerCase()) <= 2).slice(0, 3);
      if (near.length) add('CT-D3', 'MAJOR', `near-duplicate of existing ${near.map(x => '"' + x + '"').join(', ')}`, 'reuse it if it is the same moment'); }
    if (activeCount !== null) {
      const pct = (activeCount + 1) / 512;
      if (pct >= 0.85 && !/checked|reuse|no existing/i.test(notes)) add('CT-L1', 'MAJOR', `budget ${activeCount + 1}/512 (${Math.round(pct * 100)}%) after this name; Notes must name the existing events checked and why none fits`, 'add the reuse justification to Notes, or reuse');
      else if (pct >= 0.7) add('CT-L1', 'MINOR', `budget ${activeCount + 1}/512 (${Math.round(pct * 100)}%) after this name`, 'prefer reuse');
    }
  }

  // Must-haves (all checked rows)
  if (dec !== 'NO_EVENT' && dec !== 'AUTO') {
    for (const k of H.mustCtx) if (!text.includes(k)) add(k === H.mustCtx[0] ? 'CT-M1' : 'CT-M2', k === H.mustCtx[0] ? 'BLOCKER' : 'MAJOR', `must-have "${k}" not listed`, `list ${k} in Must-haves (auto-attached counts, say so)`);
    if (H.entity && (TASKY.test(n) || /task|ticket|install|restore/i.test(row.Moment || '')) && !text.includes(H.entity)) add('CT-M3', 'BLOCKER', `task event without ${H.entity}`, `add ${H.entity}`);
    const syn = props.filter(p => ENTITY_SYNONYMS.test(p));
    if (syn.length && H.entity) add('CT-N8', 'BLOCKER', `entity id under a second key: ${syn.join(', ')}`, `use ${H.entity}`);
    if (/outcome/.test(fam)) {
      const isFailureEvent = /(_failed|_failure_reported|_error)$/.test(n);
      if (isFailureEvent ? !/fail|error|onFailure|reject/i.test(row['Fires When'] || '') : !/after|success|returns|confirm/i.test(row['Fires When'] || '')) add('CT-M4', 'BLOCKER', isFailureEvent ? 'failure event: Fires When must name the failure branch' : 'outcome event: Fires When must say it fires after success', isFailureEvent ? 'state the failure branch' : 'state the success moment');
      if (!(row['Do Not Fire When'] || '').trim()) add('CT-M4', 'MAJOR', 'outcome event without Do Not Fire When', 'list failure / before-result / re-render cases');
      const hasBranchRow = row['#'] && specRows.some(o => o !== row && String(o['#'] || '').startsWith(String(row['#'])) && /[a-z]$/.test(String(o['#'] || '')));
      if (!isFailureEvent && !hasBranchRow && !/outcome|failure_reason|_failed|failure/i.test(text + ' ' + (row.Instruction || ''))) add('CT-M4', 'MAJOR', 'no failure path', 'add outcome + failure_reason, or name the failure event');
    }
    if (/entry/.test(fam) && !text.includes('entry_source')) add('CT-M5', 'MAJOR', 'entry event without entry_source', 'add entry_source');
    if (/redesign|variant|arm|flow_version|continuity/i.test(dec + ' ' + notes) && !text.includes('flow_version')) add('CT-M6', 'MAJOR', 'variant / redesign without flow_version', 'add flow_version');
  }

  // Properties
  for (const p of props) {
    if (!/^[a-z][a-z0-9_]*$/.test(p)) add('CT-N8', 'MINOR', `key "${p}" not snake_case`, 'snake_case the key');
    if (CARD.test(p)) add('CT-Q1', 'BLOCKER', `"${p}" is card data (PCI-DSS)`, 'needs explicit confirmation after the PCI-DSS warning; prefer card_brand / last4');
    else if (SENSITIVE.test(p) && !/reason|why|needed|required|because/i.test(notes)) add('CT-Q1', 'MAJOR', `"${p}" is sensitive; no reason recorded`, 'ask why it is needed and record it in Notes; offer a boolean / length / last4 / hash instead');
  }
  if (/\b(0|false|none|null|"")\s+(if|when)\s+(unknown|missing|absent|not available)/i.test(text) || /default(s)?\s+to\s+0/i.test(text)) add('CT-Q2', 'BLOCKER', 'placeholder value for unknown data', 'omit the key when unknown');
  if (props.length && !/\((string|int|bool|boolean|float|long|double|date)\)|:\s*(string|int|bool)/i.test(row.Properties || '')) add('CT-L8', 'MINOR', 'property types not stated', 'state a type per key');
  const total = props.length + H.autoCount;
  if (H.fanOut && total > 25) add('CT-L9', 'MAJOR', `${props.length} + ${H.autoCount} auto = ${total} params (> Firebase 25)`, 'drop keys, or send via trackCleverTapOnly');
  else if (total > 25) add('CT-L3', 'MAJOR', `${total} properties incl. auto (> 25)`, 'drop keys');

  const B = v.filter(x => x.sev === 'BLOCKER').length, M = v.filter(x => x.sev === 'MAJOR').length, m = v.filter(x => x.sev === 'MINOR').length;
  const grade = B || M >= 3 ? 'RED' : M || m >= 3 ? 'YELLOW' : 'GREEN';
  const sug = isNewName && v.some(x => /^CT-(N1|N2|N4|L2|L5|L9)$/.test(x.rule)) ? suggest(n) : '';
  return { grade, B, M, m, v, sug };
}

let rows;
if (a.spec) { const R = parse(fs.readFileSync(a.spec, 'utf8')); const h = R.shift(); rows = R.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
else rows = [{ Event: a.event, Decision: a.decision || 'NEW_EVENT', Properties: a.props || '', 'Must-haves': a.musthaves || '', Family: a.family || '', 'Fires When': a.when || '', 'Do Not Fire When': a.not || '', Notes: a.notes || '' }];

specRows = rows;
for (const r of rows) if ((r.Decision || '').toUpperCase() === 'NEW_EVENT' && r.Event && !existing.has(r.Event)) specNew.add(r.Event);
const out = [];
for (const r of rows) {
  const dec = (r.Decision || '').toUpperCase();
  if (a.spec && (!r.Event || dec === 'NO_EVENT' || dec === 'AUTO')) continue;
  const L = lint(r);
  out.push([r['#'] || '', r.Event, dec || 'NEW_EVENT', L.grade, L.B, L.M, L.m, L.sug, L.v.map(x => `${x.rule} ${x.sev}: ${x.why} -> ${x.fix}`).join(' | ')]);
}
if (a.out) {
  const q = v => (/[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  fs.writeFileSync(a.out, [['#', 'Event', 'Decision', 'Lint Grade', 'Blockers', 'Majors', 'Minors', 'Suggested Name', 'Findings'], ...out].map(r => r.map(q).join(',')).join('\r\n') + '\r\n');
}
const tally = {}; out.forEach(r => (tally[r[3]] = (tally[r[3]] || 0) + 1));
if (!a.out || a.event) for (const r of out) { console.log(`${r[3]}  ${r[1]}${r[7] ? '  -> suggested: ' + r[7] : ''}`); r[8].split(' | ').filter(Boolean).forEach(x => console.log('   - ' + x)); }
console.log(JSON.stringify({ profile: P, checked: out.length, grades: tally, active_budget: activeCount === null ? 'n/a (no --schema)' : activeCount + ' / 512' }));
process.exit(out.some(r => r[3] === 'RED') ? 1 : 0);
