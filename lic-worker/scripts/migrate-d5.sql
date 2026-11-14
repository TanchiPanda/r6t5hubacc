-- 把 bindings 从「一个授权只能一条」升级为「按 seat_total 多条」
-- 在已有库上执行一次；新建库直接用 schema.sql 即可（里面已去掉 UNIQUE(license_id)）

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS bindings_new (
  id            TEXT PRIMARY KEY,
  license_id    TEXT NOT NULL REFERENCES licenses(id),
  kind          TEXT NOT NULL,
  value         TEXT NOT NULL,
  verify_token  TEXT,
  status        TEXT NOT NULL,
  review_note   TEXT,
  created_at    INTEGER NOT NULL,
  verified_at   INTEGER,
  locked_at     INTEGER,
  UNIQUE (kind, value)
);

INSERT INTO bindings_new (id,license_id,kind,value,verify_token,status,review_note,created_at,verified_at,locked_at)
SELECT id,license_id,kind,value,verify_token,status,review_note,created_at,verified_at,locked_at FROM bindings;

DROP TABLE bindings;
ALTER TABLE bindings_new RENAME TO bindings;

CREATE INDEX IF NOT EXISTS idx_bindings_status ON bindings (status);
CREATE INDEX IF NOT EXISTS idx_bindings_license ON bindings (license_id);

PRAGMA foreign_keys = ON;
