-- r6t5-lic D1 schema
-- 应用：npx wrangler d1 execute r6t5-lic-db --file=./schema.sql --remote

PRAGMA foreign_keys = ON;

-- 授权记录：一个 hub 账号在一个产品下只能有一条
CREATE TABLE IF NOT EXISTS licenses (
  id            TEXT PRIMARY KEY,
  user_email    TEXT NOT NULL,
  product       TEXT NOT NULL,
  source        TEXT NOT NULL,              -- github_star | key
  github_id     TEXT,                       -- GitHub 数字 ID，用于防止同一 Star 被多账号复用
  github_login  TEXT,
  seat_total    INTEGER NOT NULL DEFAULT 1,
  seat_used     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,              -- active | pending_review | revoked
  note          TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (user_email, product)
);

-- 同一 GitHub 账号只能领一次（多 r6t5 账号共用一个 Star 会被这里挡住）
CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_github
  ON licenses (github_id) WHERE github_id IS NOT NULL;

-- 绑定：一条授权只能绑一个域名/仓库，绑后不可改
CREATE TABLE IF NOT EXISTS bindings (
  id            TEXT PRIMARY KEY,
  license_id    TEXT NOT NULL REFERENCES licenses(id),
  kind          TEXT NOT NULL,              -- domain | repo
  value         TEXT NOT NULL,              -- 归一化域名 或 owner/repo
  verify_token  TEXT,
  status        TEXT NOT NULL,              -- pending_dns | pending_review | active | rejected
  review_note   TEXT,
  created_at    INTEGER NOT NULL,
  verified_at   INTEGER,
  locked_at     INTEGER,
  UNIQUE (kind, value)                      -- 同一域名/仓库不能被两个授权占用（一个授权可绑多条，受 seat_total 限制）
);

-- 产品密钥：15 位，入库只存 sha256
CREATE TABLE IF NOT EXISTS product_keys (
  id            TEXT PRIMARY KEY,
  key_hash      TEXT NOT NULL UNIQUE,
  product       TEXT NOT NULL,
  batch         TEXT,
  seat_total    INTEGER NOT NULL DEFAULT 1,
  used_by_email TEXT,
  used_host     TEXT,
  used_at       INTEGER,
  revoked       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- GitHub OAuth state，绑定发起人身份
CREATE TABLE IF NOT EXISTS oauth_states (
  state         TEXT PRIMARY KEY,
  user_email    TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- 审计日志：领取、绑定、兑换、失败尝试
CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  user_email    TEXT,
  action        TEXT NOT NULL,
  detail        TEXT,
  ip_hash       TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_log (action, created_at);
CREATE INDEX IF NOT EXISTS idx_bindings_status ON bindings (status);
