#!/usr/bin/env node
/**
 * ct_diff.js — compare two catalogs produced by ct_catalog.js (previous version vs current).
 *
 * Usage:
 *   node ct_diff.js --prev <prev.json> --curr <curr.json> --out <diff.csv>
 *
 * Classifies every event / property / profile key / enum value as one of:
 *   ADDED            new in current
 *   REMOVED          constant gone entirely                  -> dashboards on it go blank
 *   LOST_CALLSITES   constant still declared, every reference gone  -> "missed from previous version"
 *   RENAMED_WIRE     same constant, different wire name      -> breaks version-over-version comparison (rule CT-V1)
 *   REPOINTED        same wire name, now under a different constant (usually harmless; check intent)
 *   CALLSITES_DOWN   fewer references than before (a moment may have stopped being tracked)
 *   UNCHANGED        omitted from the CSV, counted in the summary
 * Exit code 1 if any REMOVED / LOST_CALLSITES / RENAMED_WIRE row exists, so CI can gate on it.
 */
const fs = require('fs');
const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1];
if (!a.prev || !a.curr || !a.out) { console.error('need --prev --curr --out'); process.exit(2); }
const P = JSON.parse(fs.readFileSync(a.prev, 'utf8'));
const C = JSON.parse(fs.readFileSync(a.curr, 'utf8'));

const rows = [];
const summary = {};
const add = (kind, change, name, constant, before, after, note) => {
  summary[change] = (summary[change] || 0) + 1;
  if (change !== 'UNCHANGED') rows.push([kind, change, name, constant, before, after, note || '']);
};

function diffKeyed(kind, prevList, currList, nameField) {
  const pBy = new Map(prevList.map(x => [x.constant, x]));
  const cBy = new Map(currList.map(x => [x.constant, x]));
  const cByName = new Map(currList.map(x => [x[nameField], x]));
  for (const [k, p] of pBy) {
    const c = cBy.get(k);
    if (!c) {
      const moved = cByName.get(p[nameField]);
      if (moved) add(kind, 'REPOINTED', p[nameField], k + ' -> ' + moved.constant, p.callsite_count, moved.callsite_count);
      else add(kind, 'REMOVED', p[nameField], k, p.callsite_count, '', 'was declared at ' + p.declared);
      continue;
    }
    if (c[nameField] !== p[nameField]) add(kind, 'RENAMED_WIRE', p[nameField] + ' -> ' + c[nameField], k, p[nameField], c[nameField], 'same constant, new wire name: history splits in CleverTap');
    else if (p.callsite_count > 0 && c.callsite_count === 0) add(kind, 'LOST_CALLSITES', c[nameField], k, p.callsite_count, 0, 'still declared, no longer referenced');
    else if (c.callsite_count < p.callsite_count) add(kind, 'CALLSITES_DOWN', c[nameField], k, p.callsite_count, c.callsite_count);
    else add(kind, 'UNCHANGED', c[nameField], k, p.callsite_count, c.callsite_count);
  }
  for (const [k, c] of cBy) if (!pBy.has(k) && !new Set(prevList.map(x => x[nameField])).has(c[nameField])) add(kind, 'ADDED', c[nameField], k, '', c.callsite_count);
}

diffKeyed('event', P.events, C.events, 'name');
diffKeyed('property', P.props, C.props, 'key');
for (const n of new Set([...Object.keys(P.enums || {}), ...Object.keys(C.enums || {})])) diffKeyed('enum:' + n, (P.enums || {})[n] || [], (C.enums || {})[n] || [], 'value');

const pProf = new Set(P.profile.map(x => x.key));
const cProf = new Set(C.profile.map(x => x.key));
for (const k of pProf) add('profile', cProf.has(k) ? 'UNCHANGED' : 'REMOVED', k, '', 'present', cProf.has(k) ? 'present' : '', cProf.has(k) ? '' : 'user profile property no longer pushed');
for (const k of cProf) if (!pProf.has(k)) add('profile', 'ADDED', k, '', '', 'present');

const pRaw = new Set(P.raw_events.map(x => x.name));
const cRaw = new Set(C.raw_events.map(x => x.name));
for (const k of pRaw) if (!cRaw.has(k) && !C.events.some(e => e.name === k)) add('raw_event', 'REMOVED', k, '', 'raw literal', '', 'raw event literal gone and no constant replaced it');
for (const k of cRaw) if (!pRaw.has(k)) add('raw_event', 'ADDED', k, '', '', 'raw literal', 'bypasses the events object (rule CT-N6)');

const order = { REMOVED: 0, LOST_CALLSITES: 1, RENAMED_WIRE: 2, CALLSITES_DOWN: 3, REPOINTED: 4, ADDED: 5 };
rows.sort((x, y) => order[x[1]] - order[y[1]] || x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]));
const q = v => (/[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const header = ['kind', 'change', 'name', 'constant', 'prev_refs', 'curr_refs', 'note'];
fs.writeFileSync(a.out, [header, ...rows].map(r => r.map(q).join(',')).join('\r\n') + '\r\n');
console.log(JSON.stringify({ prev: P.version, curr: C.version, summary }));
process.exit(rows.some(r => ['REMOVED', 'LOST_CALLSITES', 'RENAMED_WIRE'].includes(r[1])) ? 1 : 0);
