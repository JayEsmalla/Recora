import type {
  DatabaseConnection,
  DatabaseValue,
} from '../data/database/DatabaseConnection';
import type {
  AdjustmentKind,
  TransactionType,
  ValidationState,
} from '../domain/receipt';
import type {
  AcceptedLineItemContext,
  CategoryOption,
  CorrectionRuleRecord,
  HistoryAdjustment,
  HistoryFilters,
  HistoryLineItem,
  ItemHistoryPoint,
  ItemHistorySummary,
  ItemSearchEntry,
  NormalizedItemOption,
  ReceiptHistoryDetail,
  ReceiptHistoryEntry,
} from './types';

export interface CreateNormalizedItemInput {
  id: string;
  canonicalName: string;
  categoryId?: string | null;
  now: string;
}

export interface EnsureMerchantInput {
  id: string;
  canonicalName: string;
  alias?: string | null;
  now: string;
}

export interface SaveCorrectionRuleInput {
  id: string;
  merchantId: string;
  pattern: string;
  correction: string;
  normalizedItemId: string;
  now: string;
}

export class HistoryRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async listReceipts(
    filters: HistoryFilters = {},
  ): Promise<ReceiptHistoryEntry[]> {
    const clauses = ["r.status = 'accepted'"];
    const params: DatabaseValue[] = [];

    if (filters.merchantQuery?.trim()) {
      clauses.push(
        "COALESCE(r.merchant_raw_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
      );
      params.push(likePattern(filters.merchantQuery));
    }

    if (filters.fromDate?.trim()) {
      clauses.push('COALESCE(r.purchased_at, r.created_at) >= ?');
      params.push(filters.fromDate.trim());
    }

    if (filters.toDate?.trim()) {
      clauses.push('COALESCE(r.purchased_at, r.created_at) <= ?');
      params.push(normalizeRangeEnd(filters.toDate.trim()));
    }

    if (filters.categoryId) {
      clauses.push(
        [
          'EXISTS (',
          '  SELECT 1',
          '  FROM line_items li_filter',
          '  LEFT JOIN normalized_items ni_filter',
          '    ON ni_filter.id = li_filter.normalized_item_id',
          '  WHERE li_filter.receipt_id = r.id',
          '    AND COALESCE(li_filter.category_id, ni_filter.category_id) = ?',
          ')',
        ].join('\n'),
      );
      params.push(filters.categoryId);
    }

    if (filters.query?.trim()) {
      const query = likePattern(filters.query);
      clauses.push(
        [
          '(',
          "  COALESCE(r.merchant_raw_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
          '  OR EXISTS (',
          '    SELECT 1',
          '    FROM line_items li_search',
          '    LEFT JOIN normalized_items ni_search',
          '      ON ni_search.id = li_search.normalized_item_id',
          '    WHERE li_search.receipt_id = r.id',
          '      AND (',
          "        li_search.raw_name LIKE ? ESCAPE '\\' COLLATE NOCASE",
          "        OR COALESCE(ni_search.canonical_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
          '      )',
          '  )',
          ')',
        ].join('\n'),
      );
      params.push(query, query, query);
    }

    const rows = await this.database.all<ReceiptHistoryRow>(
      [
        'SELECT',
        '  r.id AS receipt_id,',
        '  r.merchant_raw_name,',
        '  r.purchased_at,',
        '  r.total_minor,',
        '  r.currency_code,',
        '  r.transaction_type,',
        '  r.validation_state,',
        '  COUNT(li.id) AS item_count',
        'FROM receipts r',
        'LEFT JOIN line_items li ON li.receipt_id = r.id',
        'WHERE ' + clauses.join(' AND '),
        'GROUP BY r.id',
        'ORDER BY COALESCE(r.purchased_at, r.created_at) DESC, r.created_at DESC',
        'LIMIT ?;',
      ].join('\n'),
      [...params, boundedLimit(filters.limit, 100)],
    );

    return rows.map(mapReceiptHistory);
  }

  async getReceiptDetail(
    receiptId: string,
  ): Promise<ReceiptHistoryDetail | null> {
    const receipt = await this.database.first<ReceiptDetailRow>(
      [
        'SELECT',
        '  id AS receipt_id,',
        '  merchant_raw_name,',
        '  purchased_at,',
        '  subtotal_minor,',
        '  total_minor,',
        '  currency_code,',
        '  transaction_type,',
        '  validation_state,',
        '  image_uri,',
        '  raw_ocr_text',
        'FROM receipts',
        "WHERE id = ? AND status = 'accepted';",
      ].join('\n'),
      [receiptId],
    );

    if (!receipt) {
      return null;
    }

    const [items, adjustments] = await Promise.all([
      this.database.all<HistoryLineItemRow>(
        [
          'SELECT',
          '  li.id AS line_item_id,',
          '  li.receipt_id,',
          '  li.position,',
          '  li.raw_name,',
          '  li.normalized_item_id,',
          '  ni.canonical_name AS normalized_name,',
          '  COALESCE(li.category_id, ni.category_id) AS category_id,',
          '  c.name AS category_name,',
          '  li.quantity_milli,',
          '  li.unit_price_minor,',
          '  li.line_total_minor,',
          '  li.review_state',
          'FROM line_items li',
          'LEFT JOIN normalized_items ni ON ni.id = li.normalized_item_id',
          'LEFT JOIN categories c',
          '  ON c.id = COALESCE(li.category_id, ni.category_id)',
          'WHERE li.receipt_id = ?',
          'ORDER BY li.position ASC;',
        ].join('\n'),
        [receiptId],
      ),
      this.database.all<AdjustmentHistoryRow>(
        [
          'SELECT id, kind, label, amount_minor',
          'FROM receipt_adjustments',
          'WHERE receipt_id = ?',
          'ORDER BY position ASC;',
        ].join('\n'),
        [receiptId],
      ),
    ]);

    return {
      receiptId: receipt.receipt_id,
      merchantName: receipt.merchant_raw_name,
      purchasedAt: receipt.purchased_at,
      subtotalMinor: receipt.subtotal_minor,
      totalMinor: receipt.total_minor,
      currencyCode: receipt.currency_code,
      transactionType: receipt.transaction_type,
      validationState: receipt.validation_state,
      imageUri: receipt.image_uri,
      rawOcrText: receipt.raw_ocr_text,
      items: items.map(mapHistoryLineItem),
      adjustments: adjustments.map(mapAdjustment),
    };
  }

  async searchItems(
    filters: HistoryFilters = {},
  ): Promise<ItemSearchEntry[]> {
    const clauses = ["r.status = 'accepted'"];
    const params: DatabaseValue[] = [];

    if (filters.query?.trim()) {
      const query = likePattern(filters.query);
      clauses.push(
        [
          '(',
          "  li.raw_name LIKE ? ESCAPE '\\' COLLATE NOCASE",
          "  OR COALESCE(ni.canonical_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
          ')',
        ].join('\n'),
      );
      params.push(query, query);
    }

    if (filters.merchantQuery?.trim()) {
      clauses.push(
        "COALESCE(r.merchant_raw_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
      );
      params.push(likePattern(filters.merchantQuery));
    }

    if (filters.categoryId) {
      clauses.push('COALESCE(li.category_id, ni.category_id) = ?');
      params.push(filters.categoryId);
    }

    if (filters.fromDate?.trim()) {
      clauses.push('COALESCE(r.purchased_at, r.created_at) >= ?');
      params.push(filters.fromDate.trim());
    }

    if (filters.toDate?.trim()) {
      clauses.push('COALESCE(r.purchased_at, r.created_at) <= ?');
      params.push(normalizeRangeEnd(filters.toDate.trim()));
    }

    const rows = await this.database.all<ItemSearchRow>(
      [
        'SELECT',
        '  li.id AS line_item_id,',
        '  li.receipt_id,',
        '  li.position,',
        '  li.raw_name,',
        '  li.normalized_item_id,',
        '  ni.canonical_name AS normalized_name,',
        '  COALESCE(li.category_id, ni.category_id) AS category_id,',
        '  c.name AS category_name,',
        '  li.quantity_milli,',
        '  li.unit_price_minor,',
        '  li.line_total_minor,',
        '  li.review_state,',
        '  r.merchant_raw_name,',
        '  r.purchased_at,',
        '  r.currency_code',
        'FROM line_items li',
        'JOIN receipts r ON r.id = li.receipt_id',
        'LEFT JOIN normalized_items ni ON ni.id = li.normalized_item_id',
        'LEFT JOIN categories c',
        '  ON c.id = COALESCE(li.category_id, ni.category_id)',
        'WHERE ' + clauses.join(' AND '),
        'ORDER BY COALESCE(r.purchased_at, r.created_at) DESC, li.position ASC',
        'LIMIT ?;',
      ].join('\n'),
      [...params, boundedLimit(filters.limit, 200)],
    );

    return rows.map((row) => ({
      ...mapHistoryLineItem(row),
      merchantName: row.merchant_raw_name,
      purchasedAt: row.purchased_at,
      currencyCode: row.currency_code,
    }));
  }

  async getItemHistory(input: {
    normalizedItemId?: string | null;
    rawName?: string | null;
    limit?: number;
  }): Promise<ItemHistorySummary | null> {
    const normalizedItemId = input.normalizedItemId?.trim() || null;
    const rawName = input.rawName?.trim() || null;

    if (!normalizedItemId && !rawName) {
      throw new Error(
        'Item history requires a normalized item or raw item name.',
      );
    }

    const clauses = ["r.status = 'accepted'"];
    const params: DatabaseValue[] = [];

    if (normalizedItemId) {
      clauses.push('li.normalized_item_id = ?');
      params.push(normalizedItemId);
    } else {
      clauses.push('li.normalized_item_id IS NULL');
      clauses.push('li.raw_name = ? COLLATE NOCASE');
      params.push(rawName);
    }

    const rows = await this.database.all<ItemHistoryRow>(
      [
        'SELECT',
        '  li.id AS line_item_id,',
        '  li.receipt_id,',
        '  li.raw_name,',
        '  li.normalized_item_id,',
        '  ni.canonical_name AS normalized_name,',
        '  r.merchant_raw_name,',
        '  r.purchased_at,',
        '  li.quantity_milli,',
        '  li.unit_price_minor,',
        '  li.line_total_minor,',
        '  r.currency_code',
        'FROM line_items li',
        'JOIN receipts r ON r.id = li.receipt_id',
        'LEFT JOIN normalized_items ni ON ni.id = li.normalized_item_id',
        'WHERE ' + clauses.join(' AND '),
        'ORDER BY COALESCE(r.purchased_at, r.created_at) DESC',
        'LIMIT ?;',
      ].join('\n'),
      [...params, boundedLimit(input.limit, 200)],
    );

    if (rows.length === 0) {
      return null;
    }

    const points = rows.map(mapItemHistoryPoint);
    const dates = points
      .map((point) => point.purchasedAt)
      .filter((value): value is string => value !== null)
      .sort();

    return {
      identity: {
        normalizedItemId: points[0]?.normalizedItemId ?? null,
        normalizedName: points[0]?.normalizedName ?? null,
        rawName: normalizedItemId ? null : rawName,
      },
      purchaseCount: points.length,
      firstPurchasedAt: dates[0] ?? null,
      lastPurchasedAt: dates[dates.length - 1] ?? null,
      latestUnitPriceMinor:
        points.find((point) => point.unitPriceMinor !== null)
          ?.unitPriceMinor ?? null,
      points,
    };
  }

  listCategories(): Promise<CategoryOption[]> {
    return this.database.all<CategoryOption>(
      'SELECT id, name, icon FROM categories ORDER BY name COLLATE NOCASE ASC;',
    );
  }

  async listNormalizedItems(
    query = '',
    limit = 50,
  ): Promise<NormalizedItemOption[]> {
    const trimmed = query.trim();
    const rows = await this.database.all<NormalizedItemRow>(
      [
        'SELECT',
        '  ni.id,',
        '  ni.canonical_name,',
        '  ni.category_id,',
        '  c.name AS category_name',
        'FROM normalized_items ni',
        'LEFT JOIN categories c ON c.id = ni.category_id',
        "WHERE (? = '' OR ni.canonical_name LIKE ? ESCAPE '\\' COLLATE NOCASE)",
        'ORDER BY ni.canonical_name COLLATE NOCASE ASC',
        'LIMIT ?;',
      ].join('\n'),
      [trimmed, likePattern(trimmed), boundedLimit(limit, 100)],
    );

    return rows.map(mapNormalizedItem);
  }

  async findNormalizedItemByName(
    canonicalName: string,
  ): Promise<NormalizedItemOption | null> {
    const row = await this.database.first<NormalizedItemRow>(
      [
        'SELECT',
        '  ni.id,',
        '  ni.canonical_name,',
        '  ni.category_id,',
        '  c.name AS category_name',
        'FROM normalized_items ni',
        'LEFT JOIN categories c ON c.id = ni.category_id',
        'WHERE ni.canonical_name = ? COLLATE NOCASE;',
      ].join('\n'),
      [canonicalName.trim()],
    );

    return row ? mapNormalizedItem(row) : null;
  }

  async createNormalizedItem(
    input: CreateNormalizedItemInput,
  ): Promise<NormalizedItemOption> {
    const canonicalName = input.canonicalName.trim();
    if (!canonicalName) {
      throw new Error('Normalized item name is required.');
    }

    await this.database.run(
      [
        'INSERT INTO normalized_items (',
        '  id, canonical_name, category_id, created_at, updated_at',
        ') VALUES (?, ?, ?, ?, ?);',
      ].join('\n'),
      [
        input.id,
        canonicalName,
        input.categoryId ?? null,
        input.now,
        input.now,
      ],
    );

    const created = await this.findNormalizedItemByName(canonicalName);
    if (!created) {
      throw new Error('Normalized item could not be reloaded after creation.');
    }
    return created;
  }

  async setNormalizedItemCategory(
    normalizedItemId: string,
    categoryId: string | null,
    now: string,
  ): Promise<void> {
    const result = await this.database.run(
      [
        'UPDATE normalized_items',
        'SET category_id = ?, updated_at = ?',
        'WHERE id = ?;',
      ].join('\n'),
      [categoryId, now, normalizedItemId],
    );

    if (result.changes !== 1) {
      throw new Error('Normalized item not found: ' + normalizedItemId);
    }
  }

  async getAcceptedLineItemContext(
    lineItemId: string,
  ): Promise<AcceptedLineItemContext | null> {
    const row = await this.database.first<AcceptedLineContextRow>(
      [
        'SELECT',
        '  li.id AS line_item_id,',
        '  li.receipt_id,',
        '  li.raw_name,',
        '  li.normalized_item_id,',
        '  r.merchant_id,',
        '  r.merchant_raw_name',
        'FROM line_items li',
        'JOIN receipts r ON r.id = li.receipt_id',
        "WHERE li.id = ? AND r.status = 'accepted';",
      ].join('\n'),
      [lineItemId],
    );

    return row ? mapLineContext(row) : null;
  }

  async assignNormalizedItem(
    lineItemId: string,
    normalizedItemId: string | null,
    now: string,
  ): Promise<void> {
    const result = await this.database.run(
      [
        'UPDATE line_items',
        'SET normalized_item_id = ?,',
        '    category_id = NULL,',
        '    updated_at = ?',
        'WHERE id = ?',
        '  AND EXISTS (',
        '    SELECT 1 FROM receipts r',
        "    WHERE r.id = line_items.receipt_id AND r.status = 'accepted'",
        '  );',
      ].join('\n'),
      [normalizedItemId, now, lineItemId],
    );

    if (result.changes !== 1) {
      throw new Error('Only accepted receipt items can be normalized.');
    }
  }

  async ensureMerchant(
    input: EnsureMerchantInput,
  ): Promise<{ id: string; canonicalName: string }> {
    const name = input.canonicalName.trim();
    if (!name) {
      throw new Error('Merchant name is required.');
    }

    const existing = await this.database.first<{
      id: string;
      canonical_name: string;
    }>(
      [
        'SELECT id, canonical_name',
        'FROM merchants',
        'WHERE canonical_name = ? COLLATE NOCASE;',
      ].join('\n'),
      [name],
    );

    const merchantId = existing?.id ?? input.id;
    const canonicalName = existing?.canonical_name ?? name;

    if (!existing) {
      await this.database.run(
        [
          'INSERT INTO merchants (id, canonical_name, created_at, updated_at)',
          'VALUES (?, ?, ?, ?);',
        ].join('\n'),
        [merchantId, canonicalName, input.now, input.now],
      );
    }

    const alias = input.alias?.trim();
    if (alias) {
      await this.database.run(
        [
          'INSERT OR IGNORE INTO merchant_aliases (id, merchant_id, alias)',
          'VALUES (?, ?, ?);',
        ].join('\n'),
        [
          merchantId + ':alias:' + stableKey(alias),
          merchantId,
          alias,
        ],
      );
    }

    return { id: merchantId, canonicalName };
  }

  async linkReceiptMerchant(
    receiptId: string,
    merchantId: string,
    now: string,
  ): Promise<void> {
    const result = await this.database.run(
      [
        'UPDATE receipts SET merchant_id = ?, updated_at = ?',
        "WHERE id = ? AND status = 'accepted';",
      ].join('\n'),
      [merchantId, now, receiptId],
    );

    if (result.changes !== 1) {
      throw new Error(
        'Only accepted receipts can be linked to a merchant identity.',
      );
    }
  }

  async saveExactCorrectionRule(
    input: SaveCorrectionRuleInput,
  ): Promise<void> {
    const pattern = stableRulePattern(input.pattern);
    const existing = await this.database.first<{ id: string }>(
      [
        'SELECT id FROM correction_rules',
        'WHERE merchant_id = ?',
        '  AND pattern = ? COLLATE NOCASE',
        '  AND enabled = 1;',
      ].join('\n'),
      [input.merchantId, pattern],
    );

    if (existing) {
      await this.database.run(
        [
          'UPDATE correction_rules',
          'SET correction = ?, normalized_item_id = ?, updated_at = ?',
          'WHERE id = ?;',
        ].join('\n'),
        [
          input.correction,
          input.normalizedItemId,
          input.now,
          existing.id,
        ],
      );
      return;
    }

    await this.database.run(
      [
        'INSERT INTO correction_rules (',
        '  id, merchant_id, pattern, correction, normalized_item_id,',
        '  confidence_delta_basis_points, enabled, created_at, updated_at',
        ') VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?);',
      ].join('\n'),
      [
        input.id,
        input.merchantId,
        pattern,
        input.correction,
        input.normalizedItemId,
        input.now,
        input.now,
      ],
    );
  }

  async findExactCorrectionRule(
    merchantId: string,
    rawName: string,
  ): Promise<CorrectionRuleRecord | null> {
    const row = await this.database.first<CorrectionRuleRow>(
      [
        'SELECT',
        '  id, merchant_id, pattern, correction, normalized_item_id, enabled',
        'FROM correction_rules',
        'WHERE merchant_id = ?',
        '  AND pattern = ? COLLATE NOCASE',
        '  AND enabled = 1',
        'LIMIT 1;',
      ].join('\n'),
      [merchantId, stableRulePattern(rawName)],
    );

    return row ? mapCorrectionRule(row) : null;
  }

  async listCorrectionRules(
    merchantId: string,
  ): Promise<CorrectionRuleRecord[]> {
    const rows = await this.database.all<CorrectionRuleRow>(
      [
        'SELECT',
        '  id, merchant_id, pattern, correction, normalized_item_id, enabled',
        'FROM correction_rules',
        'WHERE merchant_id = ? AND enabled = 1',
        'ORDER BY pattern COLLATE NOCASE ASC;',
      ].join('\n'),
      [merchantId],
    );

    return rows.map(mapCorrectionRule);
  }

  async resetCorrectionRules(merchantId: string): Promise<number> {
    const result = await this.database.run(
      'DELETE FROM correction_rules WHERE merchant_id = ?;',
      [merchantId],
    );
    return result.changes;
  }

  async listUnnormalizedAcceptedItems(
    receiptId: string,
  ): Promise<AcceptedLineItemContext[]> {
    const rows = await this.database.all<AcceptedLineContextRow>(
      [
        'SELECT',
        '  li.id AS line_item_id,',
        '  li.receipt_id,',
        '  li.raw_name,',
        '  li.normalized_item_id,',
        '  r.merchant_id,',
        '  r.merchant_raw_name',
        'FROM line_items li',
        'JOIN receipts r ON r.id = li.receipt_id',
        'WHERE r.id = ?',
        "  AND r.status = 'accepted'",
        '  AND li.normalized_item_id IS NULL',
        'ORDER BY li.position ASC;',
      ].join('\n'),
      [receiptId],
    );

    return rows.map(mapLineContext);
  }

  async deleteAcceptedReceipt(receiptId: string): Promise<string | null> {
    const receipt = await this.database.first<{ image_uri: string | null }>(
      "SELECT image_uri FROM receipts WHERE id = ? AND status = 'accepted';",
      [receiptId],
    );

    if (!receipt) {
      return null;
    }

    await this.database.run(
      "DELETE FROM receipts WHERE id = ? AND status = 'accepted';",
      [receiptId],
    );

    return receipt.image_uri;
  }
}

interface ReceiptHistoryRow {
  receipt_id: string;
  merchant_raw_name: string | null;
  purchased_at: string | null;
  total_minor: number | null;
  currency_code: string;
  transaction_type: TransactionType;
  validation_state: ValidationState;
  item_count: number;
}

interface ReceiptDetailRow {
  receipt_id: string;
  merchant_raw_name: string | null;
  purchased_at: string | null;
  subtotal_minor: number | null;
  total_minor: number | null;
  currency_code: string;
  transaction_type: TransactionType;
  validation_state: ValidationState;
  image_uri: string | null;
  raw_ocr_text: string | null;
}

interface HistoryLineItemRow {
  line_item_id: string;
  receipt_id: string;
  position: number;
  raw_name: string;
  normalized_item_id: string | null;
  normalized_name: string | null;
  category_id: string | null;
  category_name: string | null;
  quantity_milli: number | null;
  unit_price_minor: number | null;
  line_total_minor: number | null;
  review_state: ValidationState;
}

interface ItemSearchRow extends HistoryLineItemRow {
  merchant_raw_name: string | null;
  purchased_at: string | null;
  currency_code: string;
}

interface ItemHistoryRow {
  line_item_id: string;
  receipt_id: string;
  raw_name: string;
  normalized_item_id: string | null;
  normalized_name: string | null;
  merchant_raw_name: string | null;
  purchased_at: string | null;
  quantity_milli: number | null;
  unit_price_minor: number | null;
  line_total_minor: number | null;
  currency_code: string;
}

interface AdjustmentHistoryRow {
  id: string;
  kind: AdjustmentKind;
  label: string;
  amount_minor: number;
}

interface NormalizedItemRow {
  id: string;
  canonical_name: string;
  category_id: string | null;
  category_name: string | null;
}

interface AcceptedLineContextRow {
  line_item_id: string;
  receipt_id: string;
  raw_name: string;
  normalized_item_id: string | null;
  merchant_id: string | null;
  merchant_raw_name: string | null;
}

interface CorrectionRuleRow {
  id: string;
  merchant_id: string;
  pattern: string;
  correction: string;
  normalized_item_id: string | null;
  enabled: number;
}

function mapReceiptHistory(row: ReceiptHistoryRow): ReceiptHistoryEntry {
  return {
    receiptId: row.receipt_id,
    merchantName: row.merchant_raw_name,
    purchasedAt: row.purchased_at,
    totalMinor: row.total_minor,
    currencyCode: row.currency_code,
    transactionType: row.transaction_type,
    validationState: row.validation_state,
    itemCount: Number(row.item_count),
  };
}

function mapHistoryLineItem(row: HistoryLineItemRow): HistoryLineItem {
  return {
    lineItemId: row.line_item_id,
    receiptId: row.receipt_id,
    position: row.position,
    rawName: row.raw_name,
    normalizedItemId: row.normalized_item_id,
    normalizedName: row.normalized_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    quantityMilli: row.quantity_milli,
    unitPriceMinor: row.unit_price_minor,
    lineTotalMinor: row.line_total_minor,
    reviewState: row.review_state,
  };
}

function mapAdjustment(row: AdjustmentHistoryRow): HistoryAdjustment {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    amountMinor: row.amount_minor,
  };
}

function mapItemHistoryPoint(row: ItemHistoryRow): ItemHistoryPoint {
  return {
    lineItemId: row.line_item_id,
    receiptId: row.receipt_id,
    rawName: row.raw_name,
    normalizedItemId: row.normalized_item_id,
    normalizedName: row.normalized_name,
    merchantName: row.merchant_raw_name,
    purchasedAt: row.purchased_at,
    quantityMilli: row.quantity_milli,
    unitPriceMinor: row.unit_price_minor,
    lineTotalMinor: row.line_total_minor,
    currencyCode: row.currency_code,
  };
}

function mapNormalizedItem(row: NormalizedItemRow): NormalizedItemOption {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
  };
}

function mapLineContext(row: AcceptedLineContextRow): AcceptedLineItemContext {
  return {
    lineItemId: row.line_item_id,
    receiptId: row.receipt_id,
    rawName: row.raw_name,
    normalizedItemId: row.normalized_item_id,
    merchantId: row.merchant_id,
    merchantRawName: row.merchant_raw_name,
  };
}

function mapCorrectionRule(row: CorrectionRuleRow): CorrectionRuleRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    pattern: row.pattern,
    correction: row.correction,
    normalizedItemId: row.normalized_item_id,
    enabled: row.enabled === 1,
  };
}

function normalizeRangeEnd(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value + 'T23:59:59.999'
    : value;
}

function boundedLimit(value: number | undefined, max: number): number {
  const integer = Math.trunc(value ?? 50);
  return Math.max(1, Math.min(max, integer));
}

function likePattern(value: string): string {
  const escaped = value
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');

  return '%' + escaped + '%';
}

export function stableRulePattern(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function stableKey(value: string): string {
  return stableRulePattern(value)
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
