/**
 * Проверка: у каждого обязательного ViewId есть гид; у гидов есть i18n-ключи в ru.ts.
 * Run: node scripts/audit-coach-coverage.mjs
 */
import fs from 'node:fs'

const catalogSrc = fs.readFileSync('src/lib/coach/guides/catalog.ts', 'utf8')
const extraSrc = fs.readFileSync('src/lib/coach/guides/extraGuides.ts', 'utf8')
const ruSrc = fs.readFileSync('src/i18n/ru.ts', 'utf8')

const REQUIRED = [
  'month',
  'hr',
  'hr_inspector',
  'finance',
  'warehouse',
  'production',
  'planner',
  'director',
  'procurement',
  'technologist',
  'mixer',
  'directories',
  'journals',
  'settings',
  'summary',
  'my',
  'it',
  'engineer_log',
]

const viewHits = new Map(REQUIRED.map((v) => [v, 0]))

// view: 'xxx' in guide definitions
const viewRe = /view:\s*'([^']+)'/g
let m
for (const src of [catalogSrc, extraSrc]) {
  while ((m = viewRe.exec(src))) {
    const v = m[1]
    if (viewHits.has(v)) viewHits.set(v, viewHits.get(v) + 1)
  }
}

const missingViews = REQUIRED.filter((v) => (viewHits.get(v) ?? 0) === 0)

// Collect i18n keys referenced as coach.guide.*
const keyRe = /'coach\.guide\.[^']+'/g
const keys = new Set()
for (const src of [catalogSrc, extraSrc, fs.readFileSync('src/lib/coach/guides/makeTabGuide.ts', 'utf8')]) {
  // makeTabGuide builds keys dynamically — extract from extraGuides slug patterns instead
  void src
}

// From extraGuides + catalog string literals
const litRe = /(?:titleKey|blurbKey|titleKey|bodyKey):\s*'([^']+)'/g
const needed = new Set()
for (const src of [catalogSrc, extraSrc]) {
  while ((m = litRe.exec(src))) needed.add(m[1])
}
// Dynamic keys from makeTabGuide in extraGuides — reconstruct
const tabRe =
  /makeTabGuide\(\{\s*view:\s*'([^']+)',\s*slug:\s*'([^']+)'[\s\S]*?\}\)/g
while ((m = tabRe.exec(extraSrc))) {
  const [, view, slug] = m
  const base = `coach.guide.${view}.${slug}`
  needed.add(`${base}.title`)
  needed.add(`${base}.blurb`)
  needed.add(`${base}.s1.title`)
  needed.add(`${base}.s1.body`)
  if (m[0].includes('stepKey:')) {
    const sk = /stepKey:\s*'([^']+)'/.exec(m[0])
    if (sk) {
      needed.add(`${base}.${sk[1]}.title`)
      needed.add(`${base}.${sk[1]}.body`)
    }
  }
}
const actRe =
  /makeActionGuide\(\{\s*view:\s*'([^']+)',\s*slug:\s*'([^']+)'[\s\S]*?\}\)/g
while ((m = actRe.exec(extraSrc))) {
  const [, view, slug] = m
  const base = `coach.guide.${view}.${slug}`
  needed.add(`${base}.title`)
  needed.add(`${base}.blurb`)
  needed.add(`${base}.s1.title`)
  needed.add(`${base}.s1.body`)
}

// nav keys for required views
for (const v of REQUIRED) {
  needed.add(`coach.guide.nav.${v}.title`)
  needed.add(`coach.guide.nav.${v}.body`)
}

const missingKeys = [...needed].filter((k) => !ruSrc.includes(`'${k}'`))

let failed = false
if (missingViews.length) {
  failed = true
  console.error('Views without guides:', missingViews.join(', '))
}
if (missingKeys.length) {
  failed = true
  console.error('Missing i18n keys (' + missingKeys.length + '):')
  for (const k of missingKeys.slice(0, 40)) console.error(' ', k)
  if (missingKeys.length > 40) console.error('  …')
}

if (failed) process.exit(1)
console.log('OK: guides for', REQUIRED.length, 'views; i18n keys present:', needed.size)
