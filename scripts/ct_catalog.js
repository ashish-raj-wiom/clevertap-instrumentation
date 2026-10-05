#!/usr/bin/env node
/**
 * ct_catalog.js — extract a CleverTap event catalog from an app repo, mechanically.
 *
 * Usage:
 *   node ct_catalog.js --repo <dir> --out <catalog.json> [--version <label>] [--profile <name>]
 *        [--events Events] [--props EventProps] [--prop-prefix PROP_]
 *        [--enums SheetNames,Module,PhotoType,CallTarget]
 *        [--tracker CleverTapAnalyticsTracker] [--profile-call updateUserProfile] [--ext kt,java]
 *
 * --profile picks defaults for a known app (see app_profiles.md). Explicit flags override it:
 *   csp       Events / EventProps / SheetNames,Module,PhotoType,CallTarget / CleverTapAnalyticsTracker
 *   technician Events / EventProps / Sheet,Module,CallTarget / CleverTapAnalyticsTracker (Kotlin Technician-App)
 *   customer  Events (PROP_* keys live inside it) / ScreenNames,Flows,FunnelSteps,Screens / CleverTapProvider
 *
 * What it finds (no judgement; Claude adds per-event properties and rule verdicts on top):
 *   - every constant in the events object: wire name, file:line, callsites outside test/build dirs
 *   - role per constant, by usage: USED_AS_EVENT (referenced outside a value position),
 *     REFERENCED_OTHER (every reference is a property value, e.g. `"k" to Events.OFFER_YES`), or UNREFERENCED.
 *     USED_AS_EVENT is NOT proof it fires: a helper with no caller still references it.
 *   - sinks per event: which tracker function sends it (e.g. track = CT + Firebase + Meta + Branch,
 *     trackCleverTapOnly = CT, trackBookingLogs = not CT). Only CT-reaching events count for CT-L1.
 *     "unknown" = sent through a variable or helper the script can't follow; counted as reaching CT.
 *   - raw string event names passed straight to track*() / pushEvent()
 *   - property-key constants (separate object, or a prefix inside the events object) + callsite count
 *   - raw string property keys in maps near a track call
 *   - user-profile keys: put("Key", ...) / map["Key"] = ... in the tracker's identity functions, plus
 *     keys passed to a profile-update call anywhere in the app
 *   - enum objects (sheet names, modules, screen names, flows, ...) with their values
 * Writes JSON (input to ct_diff.js) and a sibling .csv for humans.
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1];
if (!a.repo || !a.out) { console.error('need --repo and --out'); process.exit(2); }

const PROFILES = {
  csp: { events: 'Events', props: 'EventProps', propPrefix: '', enums: 'SheetNames,Module,PhotoType,CallTarget', tracker: 'CleverTapAnalyticsTracker', profileCall: '' },
  technician: { events: 'Events', props: 'EventProps', propPrefix: '', enums: 'Sheet,Module,CallTarget', tracker: 'CleverTapAnalyticsTracker', profileCall: '' },
  customer: { events: 'Events', props: '', propPrefix: 'PROP_', enums: 'ScreenNames,Flows,FunnelSteps,Screens', tracker: 'CleverTapProvider', profileCall: 'updateUserProfile', sduiJson: true },
};
const P = PROFILES[a.profile || 'csp'];
if (!P) { console.error('unknown --profile ' + a.profile + ' (known: ' + Object.keys(PROFILES).join(', ') + ')'); process.exit(2); }
const EVENTS = a.events || P.events;
const PROPS = a.props !== undefined ? a.props : P.props;
const PROP_PREFIX = a['prop-prefix'] !== undefined ? a['prop-prefix'] : P.propPrefix;
const ENUMS = (a.enums || P.enums).split(',').filter(Boolean);
const TRACKERS = (a.tracker || P.tracker).split(',');
const PROFILE_CALL = a['profile-call'] !== undefined ? a['profile-call'] : P.profileCall;
const EXT = new Set((a.ext || 'kt,java').split(',').map(e => '.' + e));
const SKIP = /[\\/](test|androidTest|build|\.git|node_modules|generated)[\\/]/;
// Tracker functions with a known destination. Any other track*() helper counts as an event call
// with sink "via:<name>" (e.g. trackInstall -> wraps track()).
const SINKS = { track: 'track', trackCleverTapOnly: 'ct_only', trackBookingLogs: 'booking_logs', pushEvent: 'ct_direct', trackEvent: 'track' };

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.test(p + path.sep)) walk(p); }
    else if (EXT.has(path.extname(e.name))) files.push(p);
  }
})(a.repo);
const rel = p => path.relative(a.repo, p).split(path.sep).join('/');
const src = {};
const lines = {};
for (const f of files) { src[f] = fs.readFileSync(f, 'utf8'); lines[f] = src[f].split('\n'); }
const lineOf = (s, idx) => s.slice(0, idx).split('\n').length;

// Parse `object NAME { const val X = "y" }` (Kotlin), `class NAME { static final String X = "y"; }`
// (Java), or `enum class NAME(val v) { A("a"), ... }`. Reads EVERY object with that name across the
// repo (an app can have two, e.g. a top-level `Events` and a nested `AnalyticsConstants.Events`), and
// records constants whose name is declared in more than one of them in `duplicates`.
const duplicates = [];
function parseObject(name) {
  const consts = {};
  const wheres = [];
  const head = new RegExp('(object|class|enum class)\\s+' + name + '\\b[^{]*\\{', 'g');
  for (const [f, s] of Object.entries(src)) {
    head.lastIndex = 0;
    let m;
    while ((m = head.exec(s))) {
    let i = m.index + m[0].length, depth = 1;
    // Count braces outside comments and string literals only.
    while (i < s.length && depth) {
      if (s.startsWith('//', i)) { i = s.indexOf('\n', i); if (i < 0) i = s.length; continue; }
      if (s.startsWith('/*', i)) { i = s.indexOf('*/', i + 2); i = i < 0 ? s.length : i + 2; continue; }
      if (s.startsWith('"""', i)) { i = s.indexOf('"""', i + 3); i = i < 0 ? s.length : i + 3; continue; }
      if (s[i] === '"') { i++; while (i < s.length && s[i] !== '"' && s[i] !== '\n') i += s[i] === '\\' ? 2 : 1; i++; continue; }
      if (s[i] === '{') depth++; else if (s[i] === '}') depth--;
      i++;
    }
    const where = rel(f);
    wheres.push(where + ':' + lineOf(s, m.index));
    let k;
    const st = m.index, body = s.slice(st, i);
    const add = (c, v, idx) => {
      const d = { value: v, file: where, line: lineOf(s, st + idx) };
      if (consts[c]) duplicates.push({ object: name, constant: c, first: consts[c].file + ':' + consts[c].line + ' = "' + consts[c].value + '"', second: d.file + ':' + d.line + ' = "' + v + '"' });
      else consts[c] = d;
    };
    const re = /(?:const\s+val|static\s+final\s+String)\s+([A-Z0-9_]+)\s*=\s*"([^"]*)"/g;
    while ((k = re.exec(body))) add(k[1], k[2], k.index);
    const enr = /^\s*([A-Z0-9_]+)\("([^"]*)"\)/gm;
    while ((k = enr.exec(body))) if (!consts[k[1]]) add(k[1], k[2], k.index);
    head.lastIndex = i;
    }
  }
  return { where: wheres.join(' + ') || null, consts };
}

// Every reference to OBJ.CONST, with the tracker call it sits in (if any). Inside the declaring file,
// bare `CONST` counts too (helpers in the object itself, e.g. `when (days) { 2 -> VIEW_2_DAYS_... }`),
// except on the declaration line and in comments.
function references(objName, constName, declFile) {
  const qualified = new RegExp('\\b' + objName + '\\.' + constName + '\\b', 'g');
  const bare = new RegExp('(?<![\\w.])' + constName + '\\b', 'g');
  const hits = [];
  for (const [f, s] of Object.entries(src)) {
    const own = rel(f) === declFile;
    const re = own ? bare : qualified;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const ln = lineOf(s, m.index);
      if (own) {
        const lineText = lines[f][ln - 1] || '';
        if (/const\s+val\s+/.test(lineText) && new RegExp('val\\s+' + constName + '\\b').test(lineText)) continue;
        if (/^\s*(\*|\/\/|\/\*)/.test(lineText)) continue;
      }
      const before = s.slice(Math.max(0, m.index - 220), m.index);
      // The nearest unclosed `name(` before the reference: is it a tracker call?
      const call = /\b(track[A-Za-z]*|pushEvent)\(\s*(?:eventName\s*=\s*)?$/.exec(before.replace(/\s+$/, ''))
        || /\b(track[A-Za-z]*|pushEvent)\(\s*\n?\s*(?:eventName\s*=\s*)?$/.exec(before)
        || /\b(track[A-Za-z]*|pushEvent)\(\s*[\w.]*\s*,?\s*\n?\s*(?:eventName\s*=\s*)?$/.exec(before);
      // Fallback: the reference sits anywhere inside a still-open tracker call, e.g.
      // `track(if (expanded) Events.A else Events.B)`. Find the last `track*(` whose parens are open.
      let fn = call ? call[1] : null;
      if (!fn) {
        const opens = [...before.matchAll(/\b(track[A-Za-z]*|pushEvent)\(/g)];
        for (let j = opens.length - 1; j >= 0 && !fn; j--) {
          const tail = before.slice(opens[j].index + opens[j][0].length);
          let depth = 1;
          for (const ch of tail) { if (ch === '(') depth++; else if (ch === ')') depth--; }
          // Still open, and the reference is not a property value inside it (`"k" to X`, `put(K, X)`).
          if (depth > 0 && !/(?:\bto|put\(\s*[\w.]+\s*,)\s*$/.test(before)) fn = opens[j][1];
        }
      }
      // Value position: `"key" to Events.X`, `x == Events.X`. Such a reference is a property value,
      // not an event (e.g. OFFER_YES = "yes").
      // Also `put(KEY, CONST)` and `if (cond) CONST else CONST`.
      // A reference inside an open tracker call's event slot is an event, not a value.
      const valuePos = !fn && /(?:\bto|[=!]=|\belse|\?:|\)|put\(\s*[\w.]+\s*,)\s*$/.test(before);
      hits.push({ at: rel(f) + ':' + ln, sink: fn ? (SINKS[fn] || 'via:' + fn) : null, valuePos });
    }
  }
  return hits;
}

const ev = parseObject(EVENTS);
if (!ev.where) { console.error('events object "' + EVENTS + '" not found; pass --events or --profile'); process.exit(3); }
const pr = PROPS ? parseObject(PROPS) : { where: null, consts: {} };

const events = [];
const props = [];
const otherConsts = [];
for (const [c, d] of Object.entries(ev.consts)) {
  const refs = references(EVENTS, c, d.file);
  if (PROP_PREFIX && c.startsWith(PROP_PREFIX)) {
    props.push({ constant: EVENTS + '.' + c, key: d.value, declared: d.file + ':' + d.line, status: refs.length ? 'REFERENCED' : 'UNREFERENCED', callsite_count: refs.length });
    continue;
  }
  const asValue = refs.filter(r => r.valuePos);
  const sinks = [...new Set(refs.filter(r => r.sink).map(r => r.sink))];
  if (refs.length > asValue.length && !sinks.length) sinks.push('unknown');
  const status = !refs.length ? 'UNREFERENCED' : asValue.length === refs.length ? 'REFERENCED_OTHER' : 'USED_AS_EVENT';
  const row = { constant: c, name: d.value, declared: d.file + ':' + d.line, status, sinks, callsite_count: refs.length, callsites: refs.map(r => r.at) };
  // REFERENCED_OTHER is usually a property value (OFFER_YES = "yes"), but can also be an event
  // passed through a variable. Kept in its own list so it never inflates the event count.
  (status === 'REFERENCED_OTHER' ? otherConsts : events).push(row);
}
for (const [c, d] of Object.entries(pr.consts)) {
  const n = references(PROPS, c, d.file).length;
  props.push({ constant: c, key: d.value, declared: d.file + ':' + d.line, status: n ? 'REFERENCED' : 'UNREFERENCED', callsite_count: n });
}
const enums = {};
for (const n of ENUMS) {
  const o = parseObject(n);
  enums[n] = Object.entries(o.consts).map(([c, d]) => ({ constant: c, value: d.value, declared: d.file + ':' + d.line, callsite_count: references(n, c, d.file).length }));
}

const rawEvents = [];
const rawKeys = [];
const knownKeys = new Set(props.map(p => p.key));
for (const [f, s] of Object.entries(src)) {
  let m;
  // Positional or named first argument: track("x", ...) / track(eventName = "x", ...).
  const re = /\b(track|trackCleverTapOnly|trackBookingLogs|trackEvent|pushEvent)\(\s*(?:eventName\s*=\s*)?"([a-zA-Z0-9_ ]+)"/g;
  while ((m = re.exec(s))) rawEvents.push({ name: m[2], at: rel(f) + ':' + lineOf(s, m.index), sink: SINKS[m[1]] || 'via:' + m[1] });
  // Names built at runtime: track("juspay_$label") / track("x_${y}_z") -> pattern "juspay_*".
  const tre = /\b(track|trackCleverTapOnly|trackBookingLogs|trackEvent|pushEvent)\(\s*(?:eventName\s*=\s*)?"([a-zA-Z0-9_]*\$[^"]*)"/g;
  while ((m = tre.exec(s))) rawEvents.push({ name: m[2].replace(/\$\{[^}]*\}|\$\w+/g, '*'), at: rel(f) + ':' + lineOf(s, m.index), sink: SINKS[m[1]] || 'via:' + m[1], pattern: true });
  if (!/analytics|pushEvent/i.test(s)) continue;
  const rk = /"([a-zA-Z][a-zA-Z0-9_]{1,60})"\s+to\s+/g;
  while ((m = rk.exec(s))) {
    const line = lineOf(s, m.index);
    const ctx = lines[f].slice(Math.max(0, line - 8), line).join('\n');
    if (/\btrack[A-Za-z]*\(|Events\.|properties\s*=/.test(ctx) && !/extraData|header|query|json|body|Bundle/i.test(ctx)) {
      rawKeys.push({ key: m[1], at: rel(f) + ':' + line, has_constant: knownKeys.has(m[1]) });
    }
  }
}

// Server-driven UI bundled as JSON (customer app: */assets/sdui_*.json). An action of the form
// {"type": "log_event", "destination": "<event name>"} is tracked by the SDUI action handler, so
// those names never appear in Kotlin. Server-sent SDUI configs are NOT in the repo: reconcile with
// a CleverTap export to see them.
if (a['sdui-json'] !== undefined ? a['sdui-json'] !== 'false' : P.sduiJson) {
  (function walkJson(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP.test(p + path.sep)) walkJson(p); continue; }
      if (!/[\\/]assets[\\/]/.test(p) || path.extname(e.name) !== '.json') continue;
      const s = fs.readFileSync(p, 'utf8');
      let m;
      const re = /"type"\s*:\s*"log_event"\s*,\s*"destination"\s*:\s*"([^"]+)"/g;
      while ((m = re.exec(s))) rawEvents.push({ name: m[1], at: rel(p) + ':' + lineOf(s, m.index), sink: 'sdui_json' });
    }
  })(a.repo);
}

// User profile keys: identity functions in the tracker file(s), and profile-update calls anywhere.
const profile = [];
for (const [f, s] of Object.entries(src)) {
  if (!TRACKERS.some(t => path.basename(f).indexOf(t) === 0)) continue;
  const start = s.search(/fun\s+(identifyUser|pushProfile|setUserId|onUserLogin|updateProfile)\b|void\s+(identifyUser|pushProfile|setUserId)\b/);
  if (start < 0) continue;
  let m;
  const re = /(?:put\(\s*"([^"]+)"|\[\s*"([^"]+)"\s*\]\s*=)/g;
  re.lastIndex = start;
  while ((m = re.exec(s))) profile.push({ key: m[1] || m[2], at: rel(f) + ':' + lineOf(s, m.index), via: 'identity' });
}
if (PROFILE_CALL) {
  const callRe = new RegExp('\\b' + PROFILE_CALL + '\\(', 'g');
  for (const [f, s] of Object.entries(src)) {
    let m;
    while ((m = callRe.exec(s))) {
      if (/fun\s+$/.test(s.slice(Math.max(0, m.index - 6), m.index))) continue; // the declaration
      const chunk = s.slice(m.index, m.index + 600);
      const end = chunk.indexOf('\n)') > 0 ? chunk.indexOf('\n)') : chunk.length;
      let k;
      const kr = /"([A-Za-z][A-Za-z0-9_ -]{0,60})"\s+to\s+/g;
      while ((k = kr.exec(chunk.slice(0, end)))) profile.push({ key: k[1], at: rel(f) + ':' + lineOf(s, m.index), via: PROFILE_CALL });
    }
  }
}

const ctReaching = events.filter(e => e.sinks.some(x => x !== 'booking_logs'));
const cat = {
  version: a.version || null,
  profile: a.profile || 'csp',
  generated_at: new Date().toISOString(),
  repo: path.resolve(a.repo),
  events_object: ev.where,
  props_object: pr.where || (PROP_PREFIX ? ev.where + ' (' + PROP_PREFIX + '*)' : null),
  counts: {
    events: events.length,
    used_as_event: events.filter(e => e.status === 'USED_AS_EVENT').length,
    unreferenced: events.filter(e => e.status === 'UNREFERENCED').length,
    reaching_clevertap: ctReaching.length,
    other_constants: otherConsts.length,
    props: props.length,
    raw_event_names: rawEvents.length,
    raw_prop_keys: rawKeys.length,
    profile_keys: new Set(profile.map(p => p.key)).size,
    duplicate_declarations: duplicates.length,
  },
  events, other_constants: otherConsts, props, enums, raw_events: rawEvents, raw_prop_keys: rawKeys, profile, duplicate_declarations: duplicates,
};
fs.writeFileSync(a.out, JSON.stringify(cat, null, 2));

const q = v => (/[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const rows = [['kind', 'name', 'constant', 'status', 'sinks', 'callsite_count', 'declared', 'first_callsites']];
events.forEach(e => rows.push(['event', e.name, e.constant, e.status, e.sinks.join('|'), e.callsite_count, e.declared, e.callsites.slice(0, 3).join(' ; ')]));
otherConsts.forEach(e => rows.push(['other_constant', e.name, e.constant, e.status, '', e.callsite_count, e.declared, e.callsites.slice(0, 3).join(' ; ')]));
rawEvents.forEach(e => rows.push(['raw_event', e.name, '', 'USED_AS_EVENT', e.sink, 1, '', e.at]));
props.forEach(p => rows.push(['property', p.key, p.constant, p.status, '', p.callsite_count, p.declared, '']));
rawKeys.forEach(k => rows.push(['raw_property', k.key, '', k.has_constant ? 'RAW_HAS_CONSTANT' : 'RAW_NO_CONSTANT', '', 1, '', k.at]));
profile.forEach(p => rows.push(['profile', p.key, '', p.via, '', 1, '', p.at]));
for (const [n, vs] of Object.entries(enums)) vs.forEach(v => rows.push(['enum:' + n, v.value, v.constant, v.callsite_count ? 'REFERENCED' : 'UNREFERENCED', '', v.callsite_count, v.declared, '']));
fs.writeFileSync(a.out.replace(/\.json$/, '') + '.csv', rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n');
console.log(JSON.stringify(cat.counts));
