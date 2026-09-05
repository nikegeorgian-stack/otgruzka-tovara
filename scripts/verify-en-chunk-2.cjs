const fs = require('fs');
const ru = require('./_ru-i18n-keys.json');
const en = require('./_en-chunk-2.json');
const ruChunk = ru.slice(2152, 3228);
let ok = true;
if (ruChunk.length !== en.length) { console.error('length mismatch'); ok = false; }
for (let i = 0; i < ruChunk.length; i++) {
  if (ruChunk[i].k !== en[i].k) { console.error('key mismatch at', i, ruChunk[i].k, en[i].k); ok = false; break; }
  if (en[i].v === ruChunk[i].v) { console.warn('untranslated?', en[i].k); }
}
console.log(ok ? 'OK' : 'FAIL', 'count:', en.length, 'first:', en[0].k, 'last:', en[en.length-1].k);
