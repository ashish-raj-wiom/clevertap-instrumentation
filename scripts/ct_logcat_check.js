#!/usr/bin/env node
/**
 * ct_logcat_check.js — diff a captured logcat against an expected CT event stream.
 *
 * Usage:
 *   node ct_logcat_check.js --log ct_run.log --expected expected_stream.json --out verify_device.csv
 *        [--window 6] [--tag CleverTap]
 *
 * expected_stream.json: [{"event": "name", "props": {"key": "value" | "*"}}, ...]
 *   "*" = key must be present with any value. Order is checked as a subsequence.
 *
 * Matching is deliberately format-tolerant: a line (optionally filtered by --tag) mentions the
 * event name as a whole word; each expected key must appear within the next --window lines,
 * followed by its value when one is given. Calibrate the format once per app (see verify.md).
 * If zero expected events are found at all, the script exits 3 and says the format assumption
 * is probably wrong, rather than reporting every row as FAIL.
 */
const fs = require('fs');
const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1];
if (!a.log || !a.expected || !a.out) { console.error('need --log --expected --out'); process.exit(2); }
const WINDOW = Number(a.window || 6);
const all = fs.readFileSync(a.log, 'utf8').split(/\r?\n/);
const idx = all.map((l, i) => i).filter(i => !a.tag || all[i].includes(a.tag));
const lines = idx.map(i => all[i]);
const orig = i => idx[i] + 1; // 1-based line number in the original log
const expected = JSON.parse(fs.readFileSync(a.expected, 'utf8'));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const occurrences = name => {
  const re = new RegExp('(^|[^a-z0-9_])' + esc(name) + '([^a-z0-9_]|$)');
  const out = [];
  lines.forEach((l, i) => { if (re.test(l)) out.push(i); });
  return out;
};

let cursor = -1;
let found = 0;
const rows = [];
for (const exp of expected) {
  const occ = occurrences(exp.event);
  if (occ.length) found++;
  const next = occ.find(i => i > cursor);
  if (next === undefined) {
    rows.push([exp.event, JSON.stringify(exp.props || {}), occ.length ? 'FAIL' : 'FAIL', occ.length ? 'fired, but out of order (seen at log line ' + orig(occ[0]) + ')' : 'never fired', occ.length]);
    continue;
  }
  const block = lines.slice(next, next + WINDOW).join('\n');
  const missing = [];
  for (const [k, v] of Object.entries(exp.props || {})) {
    const keyRe = new RegExp('["\\s{,]' + esc(k) + '["\\s]*[:=]');
    if (!keyRe.test(block)) { missing.push(k + ' (absent)'); continue; }
    if (v !== '*' && !new RegExp(esc(k) + '["\\s]*[:=]\\s*"?' + esc(String(v)) + '\\b').test(block)) missing.push(k + '=' + v + ' (wrong value)');
  }
  cursor = next;
  rows.push([exp.event, JSON.stringify(exp.props || {}), missing.length ? 'FAIL' : 'PASS', missing.length ? missing.join('; ') : 'log line ' + orig(next), occ.length]);
}

const q = v => (/[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
fs.writeFileSync(a.out, [['Event', 'Expected Properties', 'Result', 'Evidence', 'Times Seen'], ...rows].map(r => r.map(q).join(',')).join('\r\n') + '\r\n');
const pass = rows.filter(r => r[2] === 'PASS').length;
console.log(JSON.stringify({ expected: rows.length, pass, fail: rows.length - pass }));
if (found === 0) { console.error('No expected event name appears anywhere in the log. The log-format assumption is probably wrong (or VERBOSE is off). Calibrate before reporting FAIL.'); process.exit(3); }
process.exit(pass === rows.length ? 0 : 1);
