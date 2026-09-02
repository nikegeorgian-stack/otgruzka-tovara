const fs = require('fs');
const path = require('path');

const ru = require('./_chunk-2-ru-temp.json');
const parts = [1, 2, 3, 4, 5].map((n) => require(`./_en-chunk-2-map-part${n}.js`));
const map = Object.assign({}, ...parts);

const missing = [];
const en = ru.map(({ k, v }) => {
  if (!(k in map)) {
    missing.push(k);
    return { k, v };
  }
  return { k, v: map[k] };
});

if (missing.length) {
  console.error('Missing translations:', missing.length);
  missing.forEach((k) => console.error('  -', k));
  process.exit(1);
}

const outPath = path.join(__dirname, '_en-chunk-2.json');
fs.writeFileSync(outPath, JSON.stringify(en, null, 2) + '\n');
console.log('count:', en.length);
console.log('path:', outPath);
