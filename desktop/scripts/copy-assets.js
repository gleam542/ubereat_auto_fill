'use strict';
// 打包前把 repo 根目錄的 userscript 與共用的 gm-shim.js 複製進 App
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
for (const [from, name] of [
  [path.join(root, 'ubereats-promo-autofill.user.js'), 'ubereats-promo-autofill.user.js'],
  [path.join(root, 'shared', 'gm-shim.js'), 'gm-shim.js'],
]) {
  fs.copyFileSync(from, path.join(out, name));
  console.log('copied', name);
}
