#!/usr/bin/env node
/**
 * 密钥算法自测：生成 → 归一化 → 校验位验证 → 篡改检测
 * 用法：KEY_HMAC_SECRET=test node scripts/selftest-key.mjs
 */
import crypto from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_LEN = 15;
const secret = process.env.KEY_HMAC_SECRET || 'test-secret';

function check(payload) {
  const sig = crypto.createHmac('sha256', secret).update(payload).digest();
  const v = ((sig[0] << 8) | sig[1]) % 32768;
  return ALPHABET[(v >> 10) & 31] + ALPHABET[(v >> 5) & 31] + ALPHABET[v & 31];
}

function normalize(raw) {
  return String(raw).toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}

function verify(key) {
  if (key.length !== KEY_LEN) return false;
  for (const c of key) if (!ALPHABET.includes(c)) return false;
  return check(key.slice(0, 12)) === key.slice(12);
}

const payload = Array.from({ length: 12 }, () => ALPHABET[crypto.randomInt(0, 32)]).join('');
const full = payload + check(payload);
const grouped = full.slice(0, 5) + '-' + full.slice(5, 10) + '-' + full.slice(10);

const cases = [
  ['原始 15 位', full, true],
  ['带横线 + 小写', grouped.toLowerCase(), true],
  ['含易混字符 O/I/L', full.replace(/0/g, 'O').replace(/1/g, 'I'), true],
  ['末位被篡改', full.slice(0, 14) + (full[14] === 'A' ? 'B' : 'A'), false],
  ['中间被篡改', full.slice(0, 5) + (full[5] === 'A' ? 'B' : 'A') + full.slice(6), false],
  ['长度不足', full.slice(0, 14), false],
];

let bad = 0;
for (const [name, input, expect] of cases) {
  const got = verify(normalize(input));
  const ok = got === expect;
  if (!ok) bad++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  → ' + got);
}
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
