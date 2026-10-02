import type { DatabaseConnection } from './DatabaseConnection';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_local_first_schema',
    sql: `
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY NOT NULL,
  canonical_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_aliases (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(merchant_id, alias)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS normalized_items (
  id TEXT PRIMARY KEY NOT NULL,
  canonical_name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT REFERENCES merchants(id) ON DELETE SET NULL,
  merchant_raw_name TEXT,
  purchased_at TEXT,
  subtotal_minor INTEGER,
  total_minor INTEGER,
  currency_code TEXT NOT NULL DEFAULT 'PHP',
  transaction_type TEXT NOT NULL DEFAULT 'purchase'
    CHECK(transaction_type IN ('purchase', 'return', 'refund', 'unknown')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft', 'processing', 'review', 'accepted')),
  validation_state TEXT NOT NULL DEFAULT 'review'
    CHECK(validation_state IN ('verified', 'review', 'mismatch')),
  image_uri TEXT,
  raw_ocr_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(subtotal_minor IS NULL OR typeof(subtotal_minor) = 'integer'),
  CHECK(total_minor IS NULL OR typeof(total_minor) = 'integer')
);

CREATE TABLE IF NOT EXISTS line_items (
  id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  raw_name TEXT NOT NULL,
  normalized_item_id TEXT REFERENCES normalized_items(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  quantity_milli INTEGER,
  raw_quantity_text TEXT,
  unit_price_minor INTEGER,
  line_total_minor INTEGER,
  confidence_basis_points INTEGER
    CHECK(confidence_basis_points IS NULL OR confidence_basis_points BETWEEN 0 AND 10000),
  review_state TEXT NOT NULL DEFAULT 'review'
    CHECK(review_state IN ('verified', 'review', 'mismatch')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(receipt_id, position),
  CHECK(quantity_milli IS NULL OR typeof(quantity_milli) = 'integer'),
  CHECK(unit_price_minor IS NULL OR typeof(unit_price_minor) = 'integer'),
  CHECK(line_total_minor IS NULL OR typeof(line_total_minor) = 'integer')
);

CREATE TABLE IF NOT EXISTS receipt_adjustments (
  id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  kind TEXT NOT NULL CHECK(kind IN ('discount', 'tax', 'service', 'rounding', 'other')),
  label TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  confidence_basis_points INTEGER
    CHECK(confidence_basis_points IS NULL OR confidence_basis_points BETWEEN 0 AND 10000),
  review_state TEXT NOT NULL DEFAULT 'review'
    CHECK(review_state IN ('verified', 'review', 'mismatch')),
  UNIQUE(receipt_id, position),
  CHECK(typeof(amount_minor) = 'integer')
);

CREATE TABLE IF NOT EXISTS correction_rules (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  correction TEXT NOT NULL,
  confidence_delta_basis_points INTEGER NOT NULL DEFAULT 0
    CHECK(confidence_delta_basis_points BETWEEN -10000 AND 10000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receipts_status_date
  ON receipts(status, purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_merchant
  ON receipts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_line_items_receipt
  ON line_items(receipt_id, position);
CREATE INDEX IF NOT EXISTS idx_line_items_normalized
  ON line_items(normalized_item_id);
CREATE INDEX IF NOT EXISTS idx_line_items_raw_name
  ON line_items(raw_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_adjustments_receipt
  ON receipt_adjustments(receipt_id, position);
CREATE INDEX IF NOT EXISTS idx_correction_rules_merchant
  ON correction_rules(merchant_id, enabled);

CREATE VIEW IF NOT EXISTS accepted_price_history AS
SELECT
  li.id AS line_item_id,
  li.normalized_item_id,
  li.raw_name,
  r.merchant_id,
  r.merchant_raw_name,
  r.purchased_at,
  li.unit_price_minor,
  li.line_total_minor,
  li.quantity_milli,
  r.currency_code
FROM line_items li
JOIN receipts r ON r.id = li.receipt_id
WHERE r.status = 'accepted';
`,
  },
  {
    version: 2,
    name: 'persist_spatial_ocr_evidence',
    sql: `
ALTER TABLE receipts ADD COLUMN image_width INTEGER
  CHECK(image_width IS NULL OR image_width > 0);
ALTER TABLE receipts ADD COLUMN image_height INTEGER
  CHECK(image_height IS NULL OR image_height > 0);

CREATE TABLE IF NOT EXISTS ocr_runs (
  id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE REFERENCES receipts(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  image_width INTEGER NOT NULL CHECK(image_width > 0),
  image_height INTEGER NOT NULL CHECK(image_height > 0),
  raw_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ocr_observations (
  id TEXT PRIMARY KEY NOT NULL,
  ocr_run_id TEXT NOT NULL REFERENCES ocr_runs(id) ON DELETE CASCADE,
  parent_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('block', 'line', 'element')),
  position INTEGER NOT NULL CHECK(position >= 0),
  text TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL CHECK(width >= 0),
  height REAL NOT NULL CHECK(height >= 0),
  confidence REAL
    CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  UNIQUE(ocr_run_id, id)
);

CREATE INDEX IF NOT EXISTS idx_ocr_runs_receipt
  ON ocr_runs(receipt_id);
CREATE INDEX IF NOT EXISTS idx_ocr_observations_run_kind_position
  ON ocr_observations(ocr_run_id, kind, position);
CREATE INDEX IF NOT EXISTS idx_ocr_observations_parent
  ON ocr_observations(ocr_run_id, parent_id);
`,
  },
];

export async function migrateDatabase(database: DatabaseConnection): Promise<void> {
  await database.exec('PRAGMA foreign_keys = ON;');
  await database.exec('PRAGMA journal_mode = WAL;');
  await database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);

  const appliedRows = await database.all<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC;',
  );
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }

    await database.transaction(async (transaction) => {
      await transaction.exec(migration.sql);
      await transaction.run(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);',
        [migration.version, migration.name, new Date().toISOString()],
      );
    });
  }
}
