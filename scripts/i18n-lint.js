#!/usr/bin/env node
/*
 * i18n-lint — fast, dependency-free guardrail for the FR/EN/ES locales.
 *
 * Checks, in order:
 *   1. KEY PARITY — fr / en / es must declare the exact same set of keys.
 *   2. STATIC CALLS — every t('ns.key', {...}) / i18n.t / tt / tc / <Trans i18nKey="...">
 *      references an existing key AND provides every {{var}} that key interpolates
 *      (so a missing variable can never render as a literal "{{eq}}").
 *   3. DYNAMIC KEYS — keys built at runtime (t('phase.' + x), t(p.tier), t(verdictKey)…)
 *      can't be resolved statically, so each family's full value set is listed here and
 *      verified to exist in all three languages. Add new dynamic families below.
 *
 * Exit code is non-zero if any real problem is found → usable in CI / pre-commit.
 * Run: node scripts/i18n-lint.js
 */
const fs = require('fs'), path = require('path')
const SRC = path.join(__dirname, '..', 'src', 'renderer', 'src')
const LOC = path.join(SRC, 'i18n', 'locales')

function flat(o, p, out) { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') flat(v, p + k + '.', out); else out[p + k] = v } return out }
const L = {}; for (const lng of ['fr', 'en', 'es']) L[lng] = flat(JSON.parse(fs.readFileSync(path.join(LOC, lng + '.json'), 'utf8')), '', {})
const KEYS = { fr: new Set(Object.keys(L.fr)), en: new Set(Object.keys(L.en)), es: new Set(Object.keys(L.es)) }
const problems = []

// ── 1) parity ────────────────────────────────────────────────────────────────
for (const a of ['fr', 'en', 'es']) for (const b of ['fr', 'en', 'es']) if (a !== b)
  for (const k of KEYS[a]) if (!KEYS[b].has(k)) problems.push(`[PARITY] '${k}' present in ${a} but missing in ${b}`)

// ── helpers ──────────────────────────────────────────────────────────────────
const has = k => KEYS.fr.has(k) && KEYS.en.has(k) && KEYS.es.has(k)
const isPlural = k => KEYS.fr.has(k + '_one') || KEYS.fr.has(k + '_other')
const keyExists = k => has(k) || isPlural(k)
function placeholders(key) {
  const set = new Set()
  for (const lng of ['fr', 'en', 'es']) for (const vk of [key, key + '_one', key + '_other', key + '_zero', key + '_many']) {
    const s = L[lng][vk]; if (typeof s === 'string') { let m; const re = /\{\{\s*([a-zA-Z0-9_]+)/g; while ((m = re.exec(s))) set.add(m[1]) }
  }
  return set
}
function balanced(src, i) { let d = 0; for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) return src.slice(i, j + 1) } } return null }
function provided(txt) { const n = new Set(); let m; let re = /([a-zA-Z0-9_]+)\s*:/g; while ((m = re.exec(txt))) n.add(m[1]); re = /[{,]\s*([a-zA-Z0-9_]+)\s*(?=[,}])/g; while ((m = re.exec(txt))) n.add(m[1]); return n }
function walk(d, acc) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!p.includes('locales')) walk(p, acc) } else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p) } return acc }
const rel = f => f.split(path.sep).join('/').replace(/.*renderer\/src\//, '')

// ── 2) static calls ──────────────────────────────────────────────────────────
let analysed = 0, skipped = 0
for (const f of walk(SRC, [])) {
  const src = fs.readFileSync(f, 'utf8')
  const callRe = /\b(?:i18n\.t|tt|tc|t)\(\s*(['"])([^'"]+)\1\s*(,)?/g
  let m
  while ((m = callRe.exec(src))) {
    const key = m[2], hasArg = m[3] === ','
    if (!/^[a-zA-Z][\w.]*$/.test(key) || key.endsWith('.')) { skipped++; continue } // dynamic concat like 'phase.'
    analysed++
    if (!keyExists(key)) { problems.push(`[MISSING KEY] ${rel(f)}  t('${key}')`); continue }
    let prov = new Set()
    if (hasArg) { const after = src.slice(callRe.lastIndex); const b = after.search(/\S/); if (after[b] === '{') { const o = balanced(after, b); if (o) prov = provided(o) } }
    if (isPlural(key)) prov.add('count')
    for (const v of placeholders(key)) if (!prov.has(v)) problems.push(`[MISSING VAR] ${rel(f)}  t('${key}') → {{${v}}} not provided (given: ${[...prov].join(',') || 'none'})`)
  }
  const transRe = /i18nKey=(['"])([^'"]+)\1/g
  while ((m = transRe.exec(src))) {
    const key = m[2]; analysed++
    if (!keyExists(key)) { problems.push(`[MISSING KEY] ${rel(f)}  <Trans ${key}>`); continue }
    const seg = src.slice(m.index, m.index + 700); let prov = new Set()
    const at = seg.indexOf('values={'); if (at >= 0) { const o = balanced(seg, at + 'values='.length); if (o) prov = provided(o) }
    if (isPlural(key)) prov.add('count')
    for (const v of placeholders(key)) if (!prov.has(v)) problems.push(`[MISSING VAR] ${rel(f)}  <Trans ${key}> → {{${v}}} not provided (given: ${[...prov].join(',') || 'none'})`)
  }
}

// ── 3) dynamic key families (runtime-built keys) — keep in sync with the code ──
const DYNAMIC = {
  'phase.* (HUD)': ['idle', 'dealing', 'preflop', 'flop', 'turn', 'river', 'showdown'].map(x => 'phase.' + x),
  'scen.* (SCENARIO_LABEL)': ['rfi', 'iso', 'vsopen', 'squeeze', 'vs3bet', 'vs4bet'].map(x => 'scen.' + x),
  'lb.tier* (leaderboard)': ['Crusher', 'Requin', 'Grinder', 'Regulier', 'Amateur'].map(x => 'lb.tier' + x),
  'htr.scen* (hand trainer)': ['htr.scenOpen', 'htr.scenVsopen'],
  'spos.street*': ['Preflop', 'Flop', 'Turn', 'River'].map(x => 'spos.street' + x),
  'spos.disc*': ['discTight', 'discTightHint', 'discNormal', 'discNormalHint', 'discLoose', 'discLooseHint'].map(x => 'spos.' + x),
  'crit.phase*': ['Preflop', 'Flop', 'Turn', 'River'].map(x => 'crit.phase' + x),
  'equity.v* (verdict)': ['vFold', 'vCall', 'vImplied', 'vRaiseValue', 'vRaiseBluff'].map(x => 'equity.' + x),
  'equity.realEquity*': ['equity.realEquityOuts', 'equity.realEquityPreflop', 'equity.realEquityRiver'],
  'prof.tier*': ['tierDebutant', 'tierApprenti', 'tierRegulier', 'tierGrinder', 'tierRequin'].map(x => 'prof.' + x),
}
let dynCount = 0
for (const [, keys] of Object.entries(DYNAMIC)) for (const k of keys) { dynCount++; if (!keyExists(k)) problems.push(`[MISSING DYNAMIC KEY] ${k}`) }

// ── report ───────────────────────────────────────────────────────────────────
console.log(`i18n-lint · ${KEYS.fr.size} keys × 3 langs · ${analysed} static calls · ${dynCount} dynamic keys · ${skipped} dynamic-concat skipped`)
if (problems.length === 0) { console.log('✅ No i18n problems found.'); process.exit(0) }
console.log(`❌ ${problems.length} problem(s):`); for (const p of problems) console.log('  ' + p); process.exit(1)
