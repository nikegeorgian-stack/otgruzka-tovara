/**
 * Массовая замена «мягких» Tailwind-классов на строгие.
 * Запуск: node scripts/apply-strict-ui.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('src')

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

function shouldKeepRoundedFull(line) {
  return (
    line.includes('animate-spin') ||
    /overflow-hidden rounded-sm bg-/.test(line) ||
    /h-full rounded-sm/.test(line) ||
    /h-\d.*overflow-hidden rounded-sm/.test(line)
  )
}

function transform(content) {
  let s = content

  const simple = [
    ['rounded-3xl', 'rounded-sm'],
    ['rounded-2xl', 'rounded-sm'],
    ['rounded-xl', 'rounded-sm'],
    ['rounded-lg', 'rounded-sm'],
    ['rounded-md', 'rounded-sm'],
    ['shadow-2xl', 'shadow-sm'],
    ['shadow-xl', 'shadow-sm'],
    ['shadow-lg', 'shadow-sm'],
    ['ring-1 ring-black/5', ''],
    ['backdrop-blur-sm', ''],
    ['backdrop-blur(4px)', ''],
  ]
  for (const [from, to] of simple) {
    s = s.split(from).join(to)
  }

  // Градиенты → плоские фоны
  const gradientFlat = [
    [/bg-gradient-to-r from-paper to-white/g, 'bg-stone-50'],
    [/bg-gradient-to-br from-stone-50 to-orange-50\/40/g, 'bg-stone-50'],
    [/bg-gradient-to-r from-stone-50 to-orange-50\/40/g, 'bg-stone-50'],
    [/bg-gradient-to-br from-violet-50 to-teal-50/g, 'bg-stone-50'],
    [/bg-gradient-to-r from-violet-50 to-teal-50/g, 'bg-stone-50'],
    [/bg-gradient-to-br from-sky-50\/90 to-white/g, 'bg-sky-50'],
    [/bg-gradient-to-br from-sky-50\/80 to-white/g, 'bg-sky-50'],
    [/bg-gradient-to-br from-emerald-50\/80 to-white/g, 'bg-emerald-50'],
    [/bg-gradient-to-br from-teal-50\/80 to-white/g, 'bg-teal-50'],
    [/bg-gradient-to-br from-violet-600 to-teal-600/g, 'bg-violet-700'],
    [/bg-gradient-to-r from-sky-600 to-cyan-600/g, 'bg-sky-700'],
    [/hover:from-sky-700 hover:to-cyan-700/g, 'hover:bg-sky-800'],
    [/hover:from-teal-800 hover:to-teal-900/g, 'hover:bg-teal-900'],
    [/bg-gradient-to-r from-teal-700 to-teal-800/g, 'bg-teal-700'],
    [/bg-gradient-to-br from-sky-50 via-cyan-50\/80 to-teal-50\/70/g, 'bg-sky-50'],
    [/bg-gradient-to-br from-accent\/15 to-accent\/5/g, 'bg-accent/10'],
  ]
  for (const [re, rep] of gradientFlat) {
    s = s.replace(re, rep)
  }

  // rounded-full → rounded-sm (кроме спиннеров и progress-bar)
  s = s
    .split('\n')
    .map((line) => {
      if (!line.includes('rounded-full')) return line
      if (shouldKeepRoundedFull(line)) return line
      return line.replace(/rounded-full/g, 'rounded-sm')
    })
    .join('\n')

  // inline-flex rounded-sm px- → fc-badge где это бейдж
  s = s.replace(
    /inline-flex rounded-sm px-2 py-0\.5 text-\[(10|11)px\] font-(bold|semibold)/g,
    'fc-badge inline-flex px-2 py-0.5 text-[$1px] font-$2',
  )

  return s
}

let changed = 0
for (const file of walk(root)) {
  const before = fs.readFileSync(file, 'utf8')
  const after = transform(before)
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8')
    changed++
  }
}
console.log(`Updated ${changed} files`)
