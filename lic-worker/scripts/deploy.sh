#!/usr/bin/env bash
# 一键部署：需要 CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID 两个环境变量
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?请先导出 CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?请先导出 CLOUDFLARE_ACCOUNT_ID}"
DB=${DB_NAME:-r6t5-lic-db}

echo "== 1. 创建 D1（已存在会报错，可忽略）"
OUT=$(npx wrangler d1 create "$DB" 2>&1 || true)
echo "$OUT"
ID=$(echo "$OUT" | grep -oE 'database_id[^"]*"[0-9a-f-]{36}"' | grep -oE '[0-9a-f-]{36}' | head -1)
if [ -z "$ID" ] && [ -n "${D1_DATABASE_ID:-}" ]; then ID="$D1_DATABASE_ID"; fi
if [ -z "$ID" ]; then echo "未拿到 database_id，请把已有库的 ID 传入 D1_DATABASE_ID 重跑"; exit 1; fi
echo "database_id = $ID"
sed -i "s/REPLACE_WITH_D1_DATABASE_ID/$ID/" wrangler.toml

echo "== 2. 建表"
npx wrangler d1 execute "$DB" --file=./schema.sql --remote

echo "== 3. 校验必填 secret"
for s in GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET KEY_HMAC_SECRET IP_SALT SUPABASE_CN_URL SUPABASE_CN_ANON SUPABASE_INTL_URL SUPABASE_INTL_ANON; do
  if [ -z "$(npx wrangler secret list 2>/dev/null | grep -c "$s" || true)" ]; then
    echo "⚠️ 缺少 secret: $s（先执行 wrangler secret put $s）"
  fi
done

echo "== 4. 部署"
npx wrangler deploy
echo "完成。访问 https://<你的域名>/api/health 应返回 {\"ok\":true}"
