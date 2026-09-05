import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function extractKeys(content) {
  const keys = {};
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m1 = line.match(/^\s*['"]([^'"]+)['"]\s*:/);
    const m2 = line.match(/^\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*:/);
    const key = m1 ? m1[1] : m2 ? m2[1] : null;
    if (key && !line.trimStart().startsWith('//')) {
      keys[key] = i + 1;
    }
  }
  return keys;
}

function extractKeyValues(content) {
  const entries = {};
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m1 = line.match(/^\s*['"]([^'"]+)['"]\s*:\s*(.*)$/);
    const m2 = line.match(/^\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*:\s*(.*)$/);
    const match = m1 || m2;
    if (!match) {
      i++;
      continue;
    }
    const key = m1 ? m1[1] : m2[1];
    let rest = match[2].trim();
    if (rest.startsWith('//')) {
      i++;
      continue;
    }

    // Collect full value (handle multiline strings)
    let valueLines = [rest];
    let j = i;
    while (!isCompleteValue(valueLines.join('\n'))) {
      j++;
      if (j >= lines.length) break;
      valueLines.push(lines[j]);
    }
    const fullValue = valueLines.join('\n');
    entries[key] = fullValue.replace(/,\s*$/, '').trim();
    i = j + 1;
  }
  return entries;
}

function isCompleteValue(s) {
  // Remove trailing comma for check
  const trimmed = s.replace(/,\s*$/, '').trim();
  if (trimmed.startsWith("'")) {
    let count = 0;
    for (let k = 0; k < trimmed.length; k++) {
      if (trimmed[k] === "'" && (k === 0 || trimmed[k - 1] !== '\\')) count++;
    }
    return count % 2 === 0 && count >= 2;
  }
  if (trimmed.startsWith('`')) {
    let count = 0;
    for (let k = 0; k < trimmed.length; k++) {
      if (trimmed[k] === '`' && (k === 0 || trimmed[k - 1] !== '\\')) count++;
    }
    return count % 2 === 0 && count >= 2;
  }
  if (trimmed.startsWith('"')) {
    let count = 0;
    for (let k = 0; k < trimmed.length; k++) {
      if (trimmed[k] === '"' && (k === 0 || trimmed[k - 1] !== '\\')) count++;
    }
    return count % 2 === 0 && count >= 2;
  }
  return true;
}

const ruPath = path.join(root, 'src/i18n/ru.ts');
const enPath = path.join(root, 'src/i18n/en.ts');

const ru = fs.readFileSync(ruPath, 'utf8');
const en = fs.readFileSync(enPath, 'utf8');

const ruKeys = extractKeys(ru);
const enKeys = extractKeys(en);
const ruValues = extractKeyValues(ru);

const missing = Object.keys(ruKeys).filter((k) => !enKeys[k]).sort();
const extra = Object.keys(enKeys).filter((k) => !ruKeys[k]).sort();

console.log('RU keys:', Object.keys(ruKeys).length);
console.log('EN keys:', Object.keys(enKeys).length);
console.log('Missing in EN:', missing.length);
console.log('Extra in EN:', extra.length);

if (process.argv.includes('--list-missing')) {
  console.log('---MISSING KEYS---');
  missing.forEach((k) => console.log(k));
}

if (process.argv.includes('--dump-missing')) {
  const out = {};
  for (const k of missing) {
    out[k] = ruValues[k] || '(not found)';
  }
  fs.writeFileSync(path.join(root, 'scripts/i18n-missing-ru.json'), JSON.stringify(out, null, 2));
  console.log('Wrote scripts/i18n-missing-ru.json');
}
