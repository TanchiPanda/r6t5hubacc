/**
 * r6t5-lic —— 授权管理后端（Cloudflare Workers + D1）
 *
 * 路由一览
 *   GET  /api/license/list              当前账号的授权产品与绑定
 *   POST /api/github/start              发起 GitHub OAuth（校验 Star 用）
 *   GET  /api/github/callback           OAuth 回调：校验 Star → 发放席位
 *   POST /api/license/bind              绑定域名 / 项目名（只能绑一次）
 *   POST /api/license/verify-dns        校验域名 TXT 记录
 *   POST /api/license/redeem            登录状态下兑换 15 位密钥
 *   POST /api/license/redeem-host       专业版站点用密钥解锁某个域名
 *   GET  /api/license/check-host?host=  专业版域名判定
 *   GET  /api/admin/pending             待人工审核列表（管理员）
 *   POST /api/admin/review              审核通过 / 驳回（管理员）
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32
const KEY_LEN = 15;
const STATE_TTL_MS = 10 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/api/github/callback' && request.method === 'GET') {
        return await githubCallback(request, url, env);
      }
      if (url.pathname === '/api/license/check-host' && request.method === 'GET') {
        return await checkHost(url, env, cors);
      }
      if (url.pathname === '/api/license/redeem-host' && request.method === 'POST') {
        return await redeemHost(request, env, cors);
      }

      // 以下接口都需要登录态
      const user = await getUser(request, env);
      if (!user) return json({ ok: false, error: '未登录或登录已过期' }, 401, cors);

      if (url.pathname === '/api/license/list' && request.method === 'GET') {
        return await listLicenses(user, env, cors);
      }
      if (url.pathname === '/api/github/start' && request.method === 'POST') {
        return await githubStart(user, env, cors);
      }
      if (url.pathname === '/api/license/bind' && request.method === 'POST') {
        return await bind(request, user, env, cors);
      }
      if (url.pathname === '/api/license/verify-dns' && request.method === 'POST') {
        return await verifyDns(request, user, env, cors);
      }
      if (url.pathname === '/api/license/redeem' && request.method === 'POST') {
        return await redeem(request, user, env, cors);
      }
      if (url.pathname === '/api/admin/pending' && request.method === 'GET') {
        if (!isAdmin(user, env)) return json({ ok: false, error: '无权限' }, 403, cors);
        return await adminPending(env, cors);
      }
      if (url.pathname === '/api/admin/review' && request.method === 'POST') {
        if (!isAdmin(user, env)) return json({ ok: false, error: '无权限' }, 403, cors);
        return await adminReview(request, user, env, cors);
      }
      if (url.pathname === '/api/health') {
        return json({ ok: true, service: 'r6t5-lic' }, 200, cors);
      }
      return json({ ok: false, error: 'not found' }, 404, cors);
    } catch (err) {
      return json({ ok: false, error: String((err && err.message) || err) }, 500, cors);
    }
  },
};

/* ---------------- 基础工具 ---------------- */

const now = () => Date.now();
const uid = (prefix) => prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors || {}),
  });
}

function corsHeaders(env, origin) {
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = list.includes(origin) || list.includes('*');
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ipHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  return (await sha256hex(ip + '|' + (env.IP_SALT || 'r6t5'))).slice(0, 24);
}

async function audit(env, email, action, detail, ip) {
  await env.DB.prepare(
    'INSERT INTO audit_log (id,user_email,action,detail,ip_hash,created_at) VALUES (?,?,?,?,?,?)'
  ).bind(uid('log'), email || '', action, String(detail || '').slice(0, 300), ip || '', now()).run();
}

/* ---------------- 登录态 ---------------- */

async function getUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const nodes = [
    [env.SUPABASE_CN_URL, env.SUPABASE_CN_ANON],
    [env.SUPABASE_INTL_URL, env.SUPABASE_INTL_ANON],
  ];
  for (const [base, anon] of nodes) {
    if (!base || !anon) continue;
    try {
      const r = await fetch(base.replace(/\/$/, '') + '/auth/v1/user', {
        headers: { apikey: anon, Authorization: 'Bearer ' + token },
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && (d.email || d.id)) {
        return { email: String(d.email || '').toLowerCase(), id: d.id };
      }
    } catch (_) { /* 换下一个节点 */ }
  }
  return null;
}

function isAdmin(user, env) {
  const list = String(env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!user && list.includes(String(user.email || '').toLowerCase());
}

/* ---------------- 产品 / 授权查询 ---------------- */

function products(env) {
  try { return JSON.parse(env.PRODUCTS || '{}'); } catch (_) { return {}; }
}

function productLabel(env, code) {
  const p = products(env)[code];
  return p && p.label ? p.label : code;
}

async function listLicenses(user, env, cors) {
  const rows = await env.DB.prepare(
    'SELECT * FROM licenses WHERE user_email = ? ORDER BY created_at DESC'
  ).bind(user.email).all();
  const lic = (rows.results || []).map((l) => ({
    id: l.id,
    product: l.product,
    productLabel: productLabel(env, l.product),
    seats: l.seat_total,
    source: l.source,
    status: l.status,
    note: l.note || '',
    createdAt: l.created_at,
    binding: null,
  }));

  for (const l of lic) {
    const b = await env.DB.prepare('SELECT * FROM bindings WHERE license_id = ?').bind(l.id).first();
    if (b) {
      l.binding = {
        id: b.id,
        kind: b.kind,
        value: b.value,
        status: b.status,
        verifyToken: b.verify_token,
        verifiedAt: b.verified_at,
        lockedAt: b.locked_at,
        reviewNote: b.review_note,
      };
    }
  }
  return json({ ok: true, isAdmin: isAdmin(user, env), licenses: lic }, 200, cors);
}

/* ---------------- GitHub OAuth / Star 校验 ---------------- */

async function githubStart(user, env, cors) {
  const state = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare('INSERT INTO oauth_states (state,user_email,created_at) VALUES (?,?,?)')
    .bind(state, user.email, now()).run();

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: String(env.PUBLIC_BASE || '').replace(/\/$/, '') + '/api/github/callback',
    scope: 'read:user',
    state,
    allow_signup: 'true',
  });
  return json({ ok: true, url: 'https://github.com/login/oauth/authorize?' + params.toString() }, 200, cors);
}

async function githubCallback(request, url, env) {
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const back = (q) => Response.redirect(String(env.HUB_RETURN || '') + '?' + q, 302);

  if (!code || !state) return back('claim=error');

  const row = await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?').bind(state).first();
  if (!row) return back('claim=expired');
  if (now() - row.created_at > STATE_TTL_MS) {
    await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
    return back('claim=expired');
  }
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  const email = row.user_email;

  // 换取 GitHub token
  let token = '';
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const d = await r.json();
    token = d.access_token || '';
  } catch (_) {}
  if (!token) {
    await audit(env, email, 'star_token_fail', '', '');
    return back('claim=error');
  }

  // 取 GitHub 身份
  let gh = null;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'r6t5-lic', Accept: 'application/vnd.github+json' },
    });
    if (r.ok) gh = await r.json();
  } catch (_) {}
  if (!gh || !gh.id) return back('claim=error');

  // 校验 Star
  let starred = false;
  try {
    const r = await fetch('https://api.github.com/user/starred/' + String(env.STAR_REPO || ''), {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'r6t5-lic', Accept: 'application/vnd.github+json' },
    });
    starred = r.status === 204;
  } catch (_) {}
  if (!starred) {
    await audit(env, email, 'star_missing', 'github:' + gh.login, '');
    return back('claim=nostar');
  }

  const githubId = String(gh.id);
  const ip = await ipHash(request, env);

  // 同一 GitHub 账号只能领一次：这是防止「多个 r6t5 账号共用一个 Star」的关键约束
  const used = await env.DB.prepare('SELECT * FROM licenses WHERE github_id = ?').bind(githubId).first();
  if (used) {
    await audit(env, email, 'star_reuse', 'github:' + gh.login + ' → 已被 ' + used.user_email + ' 使用', ip);
    return used.user_email === email ? back('claim=exists') : back('claim=reused');
  }

  // 同一 hub 账号同一产品只能持有一个席位
  const own = await env.DB.prepare('SELECT * FROM licenses WHERE user_email = ? AND product = ?')
    .bind(email, 'docs-pro').first();
  if (own) return back('claim=exists');

  // 新号或异常账号转人工审核
  const ageDays = gh.created_at ? (now() - new Date(gh.created_at).getTime()) / 86400000 : 0;
  const minAge = Number(env.MIN_GITHUB_AGE_DAYS || 30);
  const status = ageDays < minAge ? 'pending_review' : 'active';
  const note = ageDays < minAge ? ('GitHub 账号仅 ' + Math.floor(ageDays) + ' 天，需人工审核') : '';

  await env.DB.prepare(
    `INSERT INTO licenses (id,user_email,product,source,github_id,github_login,seat_total,seat_used,status,note,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(uid('lic'), email, 'docs-pro', 'github_star', githubId, gh.login, 1, 0, status, note, now()).run();

  await audit(env, email, 'star_claim', 'github:' + gh.login + ' status=' + status, ip);
  return back(status === 'active' ? 'claim=ok' : 'claim=review');
}

/* ---------------- 绑定 ---------------- */

function normalizeHost(raw) {
  let host = String(raw || '').trim().toLowerCase();
  if (!host) return '';
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\/$/, '');
  try {
    if (/[^\x00-\x7f]/.test(host)) host = new URL('https://' + host).hostname;
  } catch (_) { return ''; }
  const parts = host.split(':');
  host = parts[0];
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return '';
  if (host.length > 253) return '';
  return host;
}

function normalizeRepo(raw) {
  const v = String(raw || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v) ? v : '';
}

async function bind(request, user, env, cors) {
  const body = await readJson(request);
  const kind = String(body.kind || '');
  if (kind !== 'domain' && kind !== 'repo') return json({ ok: false, error: '绑定类型无效' }, 400, cors);

  const lic = await env.DB.prepare("SELECT * FROM licenses WHERE user_email = ? AND status != 'revoked' ORDER BY created_at DESC")
    .bind(user.email).first();
  if (!lic) return json({ ok: false, error: '没有可绑定的授权产品，请先领取' }, 400, cors);
  if (lic.status === 'pending_review') return json({ ok: false, error: '该授权正在人工审核，暂不能绑定' }, 403, cors);

  const existing = await env.DB.prepare('SELECT * FROM bindings WHERE license_id = ?').bind(lic.id).first();
  if (existing) return json({ ok: false, error: '该授权已绑定，不能修改' }, 409, cors);

  let value = '';
  if (kind === 'domain') {
    value = normalizeHost(body.value);
    if (!value) return json({ ok: false, error: '域名格式不正确' }, 400, cors);
  } else {
    value = normalizeRepo(body.value);
    if (!value) return json({ ok: false, error: '项目名格式应为 owner/repo' }, 400, cors);
  }

  const taken = await env.DB.prepare('SELECT * FROM bindings WHERE kind = ? AND value = ?').bind(kind, value).first();
  if (taken) {
    await audit(env, user.email, 'bind_conflict', kind + ':' + value, await ipHash(request, env));
    return json({ ok: false, error: '该' + (kind === 'domain' ? '域名' : '项目名') + '已被其他授权占用' }, 409, cors);
  }

  const token = kind === 'domain' ? crypto.randomUUID().replace(/-/g, '') : null;
  const status = kind === 'domain' ? 'pending_dns' : 'pending_review';
  const id = uid('bnd');

  await env.DB.prepare(
    'INSERT INTO bindings (id,license_id,kind,value,verify_token,status,created_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(id, lic.id, kind, value, token, status, now()).run();

  await env.DB.prepare('UPDATE licenses SET seat_used = 1 WHERE id = ?').bind(lic.id).run();
  await audit(env, user.email, 'bind', kind + ':' + value + ' status=' + status, await ipHash(request, env));

  return json({
    ok: true,
    binding: {
      id, kind, value, status, verifyToken: token,
      recordName: kind === 'domain' ? '_r6t5-verify.' + value : null,
      recordValue: kind === 'domain' ? 'r6t5-verify=' + token : null,
    },
    message: kind === 'repo' ? '已提交，等待人工审核' : '请添加 TXT 记录后点击验证',
  }, 200, cors);
}

async function readJson(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

/* ---------------- DNS TXT 校验 ---------------- */

async function fetchTxt(name) {
  try {
    const r = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(name) + '&type=TXT', {
      headers: { accept: 'application/dns-json' },
    });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.Answer || [])
      .filter((a) => a.type === 16)
      .map((a) => String(a.data).replace(/\\"/g, '"').replace(/^"/, '').replace(/"$/, ''));
  } catch (_) { return []; }
}

async function verifyDns(request, user, env, cors) {
  const lic = await env.DB.prepare("SELECT * FROM licenses WHERE user_email = ? AND status != 'revoked' ORDER BY created_at DESC")
    .bind(user.email).first();
  if (!lic) return json({ ok: false, error: '没有授权产品' }, 400, cors);

  const b = await env.DB.prepare('SELECT * FROM bindings WHERE license_id = ?').bind(lic.id).first();
  if (!b) return json({ ok: false, error: '尚未绑定域名' }, 400, cors);
  if (b.kind !== 'domain') return json({ ok: false, error: '当前绑定不是域名' }, 400, cors);
  if (b.status === 'active') return json({ ok: true, already: true, binding: { id: b.id, kind: b.kind, value: b.value, status: b.status } }, 200, cors);

  const expect = 'r6t5-verify=' + b.verify_token;
  const names = ['_r6t5-verify.' + b.value, b.value];
  let found = false;
  for (const n of names) {
    const txts = await fetchTxt(n);
    if (txts.some((t) => t.trim() === expect)) { found = true; break; }
  }

  if (!found) {
    await audit(env, user.email, 'dns_fail', b.value, await ipHash(request, env));
    return json({
      ok: false,
      error: '未查到 TXT 记录，DNS 可能有延迟（通常 1–10 分钟）',
      recordName: '_r6t5-verify.' + b.value,
      recordValue: expect,
    }, 200, cors);
  }

  await env.DB.prepare("UPDATE bindings SET status='active', verified_at=?, locked_at=? WHERE id=?")
    .bind(now(), now(), b.id).run();
  await audit(env, user.email, 'dns_ok', b.value, await ipHash(request, env));
  return json({ ok: true, binding: { id: b.id, kind: b.kind, value: b.value, status: 'active' } }, 200, cors);
}

/* ---------------- 15 位产品密钥 ---------------- */

const CROCKFORD_MAP = { O: '0', I: '1', L: '1', U: 'V' };

function normalizeKey(raw) {
  let k = String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  k = k.replace(/[OILU]/g, (c) => CROCKFORD_MAP[c] || c);
  return k;
}

function charsFrom15(v) {
  return ALPHABET[(v >> 10) & 31] + ALPHABET[(v >> 5) & 31] + ALPHABET[v & 31];
}

async function keyChecksum(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  const v = ((sig[0] << 8) | sig[1]) % 32768;
  return charsFrom15(v);
}

async function verifyKeyFormat(key, secret) {
  if (key.length !== KEY_LEN) return false;
  for (const c of key) if (!ALPHABET.includes(c)) return false;
  const payload = key.slice(0, 12);
  const check = await keyChecksum(payload, secret);
  return check === key.slice(12);
}

async function useKey(key, env, consume) {
  const hash = await sha256hex(key);
  const rec = await env.DB.prepare('SELECT * FROM product_keys WHERE key_hash = ?').bind(hash).first();
  if (!rec) return { error: '密钥不存在' };
  if (rec.revoked) return { error: '密钥已停用' };
  if (rec.used_at && !consume) return { error: '密钥已被使用', record: rec };
  return { record: rec };
}

async function redeem(request, user, env, cors) {
  const body = await readJson(request);
  const key = normalizeKey(body.key);
  const ip = await ipHash(request, env);

  const fails = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM audit_log WHERE action='redeem_fail' AND ip_hash=? AND created_at > ?"
  ).bind(ip, now() - 3600000).first();
  if ((fails && fails.c) >= 5) return json({ ok: false, error: '尝试次数过多，请 1 小时后再试' }, 429, cors);

  if (!(await verifyKeyFormat(key, env.KEY_HMAC_SECRET))) {
    await audit(env, user.email, 'redeem_fail', 'format', ip);
    return json({ ok: false, error: '密钥格式不正确' }, 400, cors);
  }
  const r = await useKey(key, env, true);
  if (r.error) {
    await audit(env, user.email, 'redeem_fail', r.error, ip);
    return json({ ok: false, error: r.error }, 400, cors);
  }

  const own = await env.DB.prepare('SELECT * FROM licenses WHERE user_email = ? AND product = ?')
    .bind(user.email, r.record.product).first();
  if (own) return json({ ok: false, error: '该账号已拥有此产品' }, 409, cors);

  const lid = uid('lic');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO licenses (id,user_email,product,source,seat_total,seat_used,status,created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(lid, user.email, r.record.product, 'key', r.record.seat_total, 0, 'active', now()),
    env.DB.prepare('UPDATE product_keys SET used_by_email=?, used_at=? WHERE key_hash=?')
      .bind(user.email, now(), await sha256hex(key)),
  ]);

  await audit(env, user.email, 'redeem_ok', r.record.product, ip);
  return json({ ok: true, product: r.record.product, productLabel: productLabel(env, r.record.product) }, 200, cors);
}

/* ---------------- 专业版域名判定 / 站点解锁 ---------------- */

async function checkHost(url, env, cors) {
  const host = normalizeHost(url.searchParams.get('host') || '');
  if (!host) return json({ ok: false, error: 'host 无效' }, 400, cors);

  const rows = await env.DB.prepare("SELECT value FROM bindings WHERE kind='domain' AND status='active'").all();
  const domains = (rows.results || []).map((r) => r.value);
  const hit = domains.find((d) => host === d || host.endsWith('.' + d));

  let authorized = !!hit;
  if (!authorized) {
    const keyed = await env.DB.prepare('SELECT used_host FROM product_keys WHERE used_host IS NOT NULL').all();
    authorized = (keyed.results || []).some((r) => host === r.used_host || host.endsWith('.' + r.used_host));
  }
  return json({ ok: true, host, authorized, product: 'docs-pro' }, 200, cors);
}

async function redeemHost(request, env, cors) {
  const body = await readJson(request);
  const key = normalizeKey(body.key);
  const host = normalizeHost(body.host || '');
  const ip = await ipHash(request, env);
  if (!host) return json({ ok: false, error: '域名无效' }, 400, cors);

  const fails = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM audit_log WHERE action='redeem_fail' AND ip_hash=? AND created_at > ?"
  ).bind(ip, now() - 3600000).first();
  if ((fails && fails.c) >= 5) return json({ ok: false, error: '尝试次数过多，请稍后再试' }, 429, cors);

  if (!(await verifyKeyFormat(key, env.KEY_HMAC_SECRET))) {
    await audit(env, null, 'redeem_fail', 'host-format ' + host, ip);
    return json({ ok: false, error: '密钥格式不正确' }, 400, cors);
  }
  const r = await useKey(key, env, true);
  if (r.error) {
    await audit(env, null, 'redeem_fail', 'host-' + r.error, ip);
    return json({ ok: false, error: r.error }, 400, cors);
  }

  const taken = await env.DB.prepare('SELECT used_host FROM product_keys WHERE used_host = ?').bind(host).first();
  if (taken) return json({ ok: false, error: '该域名已被其他密钥解锁' }, 409, cors);

  await env.DB.prepare('UPDATE product_keys SET used_host=?, used_at=? WHERE key_hash=?')
    .bind(host, now(), await sha256hex(key)).run();
  await audit(env, null, 'redeem_host_ok', host, ip);
  return json({ ok: true, host, product: r.record.product }, 200, cors);
}

/* ---------------- 管理员人工审核 ---------------- */

async function adminPending(env, cors) {
  const bindings = await env.DB.prepare(
    `SELECT b.*, l.user_email, l.product, l.github_login
       FROM bindings b JOIN licenses l ON l.id = b.license_id
      WHERE b.status = 'pending_review' ORDER BY b.created_at ASC`
  ).all();
  const licenses = await env.DB.prepare(
    "SELECT * FROM licenses WHERE status = 'pending_review' ORDER BY created_at ASC"
  ).all();
  return json({ ok: true, bindings: bindings.results || [], licenses: licenses.results || [] }, 200, cors);
}

async function adminReview(request, user, env, cors) {
  const body = await readJson(request);
  const target = String(body.target || '');
  const id = String(body.id || '');
  const approve = !!body.approve;
  const note = String(body.note || '').slice(0, 200);

  if (target === 'binding') {
    const b = await env.DB.prepare('SELECT * FROM bindings WHERE id = ?').bind(id).first();
    if (!b) return json({ ok: false, error: '记录不存在' }, 404, cors);
    if (b.status !== 'pending_review') return json({ ok: false, error: '该记录不在待审核状态' }, 400, cors);
    await env.DB.prepare("UPDATE bindings SET status=?, locked_at=?, review_note=?, verified_at=CASE WHEN ?='active' THEN ? ELSE verified_at END WHERE id=?")
      .bind(approve ? 'active' : 'rejected', approve ? now() : null, note, approve ? 'active' : 'rejected', now(), id).run();
    await audit(env, user.email, 'review_binding', (approve ? 'approve ' : 'reject ') + b.value, '');
    return json({ ok: true }, 200, cors);
  }
  if (target === 'license') {
    const l = await env.DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(id).first();
    if (!l) return json({ ok: false, error: '记录不存在' }, 404, cors);
    await env.DB.prepare('UPDATE licenses SET status=?, note=? WHERE id=?')
      .bind(approve ? 'active' : 'revoked', note || l.note || '', id).run();
    await audit(env, user.email, 'review_license', (approve ? 'approve ' : 'reject ') + l.user_email, '');
    return json({ ok: true }, 200, cors);
  }
  return json({ ok: false, error: 'target 无效' }, 400, cors);
}
