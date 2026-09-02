import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadDict(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');
  src = src.replace(/^import type \{ Dict \} from '\.\/types'\s*\n/, '');
  src = src.replace(/^export const \w+: Dict = /, 'return ');
  src = src.replace(/;\s*$/, '');
  // eslint-disable-next-line no-new-func
  return new Function(src)();
}

function escapeSingle(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatValue(value, key) {
  if (value.includes('\n') || value.length > 80) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    return `\`${escaped}\``;
  }
  if (value.includes("'") && !value.includes('"')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${escapeSingle(value)}'`;
}

const ru = loadDict(path.join(root, 'src/i18n/ru.ts'));
const en = loadDict(path.join(root, 'src/i18n/en.ts'));

const missing = Object.keys(ru).filter((k) => !(k in en)).sort();
console.log('Missing:', missing.length);

if (process.argv.includes('--generate')) {
  const lines = missing.map((key) => {
    const value = ru[key];
    const formatted = formatValue(value, key);
    if (formatted.startsWith('`')) {
      return `  '${key}': ${formatted},`;
    }
    return `  '${key}': ${formatted},`;
  });
  fs.writeFileSync(path.join(root, 'scripts/i18n-missing-entries.txt'), lines.join('\n') + '\n');
  fs.writeFileSync(
    path.join(root, 'scripts/i18n-missing-ru-values.json'),
    JSON.stringify(Object.fromEntries(missing.map((k) => [k, ru[k]])), null, 2)
  );
  console.log('Wrote scripts/i18n-missing-ru-values.json');
}
