# r6t5-lic — 授权管理后端

Cloudflare Workers + D1，负责：Star 领取席位、域名/项目名绑定、TXT 验证、15 位密钥兑换、专业版域名判定、人工审核。

## 一次性部署步骤

```bash
cd lic-worker
npm i -g wrangler            # 或 npx wrangler

wrangler login
wrangler d1 create r6t5-lic-db
# 把输出里的 database_id 填进 wrangler.toml

wrangler d1 execute r6t5-lic-db --file=./schema.sql --remote
```

### 需要的 secret

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put KEY_HMAC_SECRET      # 与 gen-key.mjs 保持一致
wrangler secret put IP_SALT
wrangler secret put SUPABASE_CN_URL      # https://bxanbosouqnezggwdqhs.supabase.co
wrangler secret put SUPABASE_CN_ANON
wrangler secret put SUPABASE_INTL_URL
wrangler secret put SUPABASE_INTL_ANON
```

### GitHub OAuth App

- Homepage URL：`https://acc.r6t5.dpdns.org`
- Authorization callback URL：`https://lic.r6t5.dpdns.org/api/github/callback`

### wrangler.toml 里要改的 vars

`ADMIN_EMAILS`（当前 `r6t5storage@outlook.com`）、`ALLOWED_ORIGINS`、`STAR_REPO`（默认 `TanchiPanda/r6t5-docs-community`）、`ADMIN_EMAILS`、`PUBLIC_BASE`、`HUB_RETURN`。

```bash
wrangler deploy
# 自定义域（可选）：Cloudflare 控制台给 Worker 绑定 lic.r6t5.dpdns.org
```

部署后访问 `https://lic.r6t5.dpdns.org/api/health` 应返回 `{"ok":true}`。

## 生成 15 位产品密钥

```bash
KEY_HMAC_SECRET=你的密钥 node scripts/gen-key.mjs --count 50 --product docs-pro --batch 2026Q1 > keys.csv
```

输出 CSV：`key,product,batch,key_hash`。**只用 `key_hash` 入库，明文密钥只发给客户一次。**

```sql
INSERT INTO product_keys (id,key_hash,product,batch,seat_total,revoked,created_at)
VALUES ('k_'||lower(hex(randomblob(8))), '<key_hash>', 'docs-pro', '2026Q1', 1, 0, <ms>);
```

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/license/list` | 登录 | 授权 + 绑定 + 是否管理员 |
| POST | `/api/github/start` | 登录 | 返回 GitHub 授权 URL |
| GET | `/api/github/callback` | state | 校验 Star → 发放席位 |
| POST | `/api/license/bind` | 登录 | 绑定域名（待 TXT）/ 项目名（待人工审核） |
| POST | `/api/license/verify-dns` | 登录 | 查 TXT 并激活 |
| POST | `/api/license/redeem` | 登录 | 兑换 15 位密钥 |
| POST | `/api/license/redeem-host` | 无 | 专业版站点用密钥解锁当前域名 |
| GET | `/api/license/check-host?host=` | 无 | 专业版域名判定 |
| GET | `/api/admin/pending` | 管理员 | 待审核列表 |
| POST | `/api/admin/review` | 管理员 | 通过 / 驳回 |

## 防滥用设计

- `licenses.github_id` 唯一：**一个 GitHub 账号只能领一次**，多个 r6t5 账号共用一个 Star 会被拒（返回 `claim=reused` 并记审计）。
- `bindings(kind,value)` 唯一：同一域名/项目名不能被两个授权占用。
- GitHub 账号注册不足 `MIN_GITHUB_AGE_DAYS`（默认 30 天）→ 自动转人工审核。
- 项目名绑定一律人工审核（只校验格式，不做自动归属判断）。
- 绑定后不可改：二次绑定返回 409，管理端无解绑接口。
- 密钥一次性、可吊销，只存 sha256；兑换失败按 IP 限流 5 次/小时。

## 本地自测

```bash
node --check src/index.js
KEY_HMAC_SECRET=test node scripts/selftest-key.mjs
```
