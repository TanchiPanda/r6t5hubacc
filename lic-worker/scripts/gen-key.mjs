#!/usr/bin/env node
/**
 * 15 位产品密钥生成器
 *
 * 格式：XXXXX-XXXXX-XXXXX（15 个 Crockford Base32 字符 + 2 个分隔符）
 *   前 12 位 = 随机载荷（60 bit）
 *   后 3 位  = HMAC-SHA256(secret, payload) 截断 15 bit 校验位（挡手误）
 *   入库以 sha256(15位原文) 存储，一次性、可吊销
 *
 * 用法：
 *   KEY_HMAC_SECRET=xxx node scripts/gen-key.mjs --count 20 --product docs-pro --batch 2026Q1
 *   KEY_HMAC_SECRET=xxx node scripts/gen-key.mjs --count 20 --hash-only
 *
 * 输出 CSV：key,product,batch,key_hash
 */

import crypto from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_LEN = 15;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const secret = process.env.KEY_HMAC_SECRET;
if (!secret) {
  console.error('缺少 KEY_HMAC_SECRET 环境变量（必须与 Worker 的 secret 一致）');
  process.exit(2);
}

const count = Number(arg('count', 20));
const product = String(arg('product', 'docs-pro'));
const batch = String(arg('batch', new Date().toISOString().slice(0, 10)));
const hashOnly = !!arg('hash-only', false);

function randomPayload() {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[crypto.randomInt(0, 32)];
  return s;
}

function checksum(payload) {
  const sig = crypto.createHmac('sha256', secret).update(payload).digest();
  const v = ((sig[0] << 8) | sig[1]) % 32768;
  return ALPHABET[(v >> 10) & 31] + ALPHABET[(v >> 5) & 31] + ALPHABET[v & 31];
}

function makeKey() {
  const payload = randomPayload();
  return payload + checksum(payload);
}

function group(key) {
  return key.slice(0, 5) + '-' + key.slice(5, 10) + '-' + key.slice(10, 15);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const lines = ['key,product,batch,key_hash'];
const seen = new Set();
let made = 0;
while (made < count) {
  const raw = makeKey();
  if (seen.has(raw)) continue;
  seen.add(raw);
  lines.push([group(raw), product, batch, sha256(raw)].join(','));
  made++;
}

console.log(lines.join('\n'));
if (!hashOnly) console.error(`\n已生成 ${count} 个密钥（仅本次可见，请妥善保存）`);
