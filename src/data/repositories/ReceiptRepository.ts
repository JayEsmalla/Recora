import type {
  AdjustmentKind,
  Receipt,
  ReceiptStatus,
  TransactionType,
  ValidationState,
} from '../../domain/receipt';
import type {
  DatabaseConnection,
  DatabaseValue,
} from '../database/DatabaseConnection';

export interface UnfinishedReceiptSummary {
  id: string;
  status: ReceiptStatus;
  hasOcrText: boolean;
  updatedAt: string;
}

export interface CreateReceiptDraftInput {
  id: string;
  merchantRawName?: string | null;
  purchasedAt?: string | null;
  currencyCode?: string;
  transactionType?: TransactionType;
  imageUri?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  rawOcrText?: string | null;
  now: string;
}

export interface PersistLineItemInput {
  id: string;
  position: number;
  rawName: string;
  normalizedItemId?: string | null;
  categoryId?: string | null;
  quantityMilli?: number | null;
  rawQuantityText?: string | null;
  unitPriceMinor?: number | null;
  lineTotalMinor?: number | null;
  confidenceBasisPoints?: number | null;
  reviewState?: ValidationState;
}

export interface PersistAdjustmentInput {
  id: string;
  position: number;
  kind: AdjustmentKind;
  label: string;
  amountMinor: number;
  confidenceBasisPoints?: number | null;
  reviewState?: ValidationState;
}

export interface ReplaceReviewDataInput {
  receiptId: string;
  merchantId?: string | null;
  merchantRawName?: string | null;
  purchasedAt?: string | null;
  subtotalMinor?: number | null;
  totalMinor?: number | null;
  transactionType?: TransactionType;
  validationState: ValidationState;
  lineItems: readonly PersistLineItemInput[];
  adjustments: readonly PersistAdjustmentInput[];
  now: string;
}

export interface StoredLineItem {
  id: string;
  receiptId: string;
  position: number;
  rawName: string;
  normalizedItemId: string | null;
  categoryId: string | null;
  quantityMilli: number | null;
  rawQuantityText: string | null;
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  confidenceBasisPoints: number | null;
  reviewState: ValidationState;
  createdAt: string;
  updatedAt: string;
}

export interface StoredReceiptAdjustment {
  id: string;
  receiptId: string;
  position: number;
  kind: AdjustmentKind;
  label: string;
  amountMinor: number;
  confidenceBasisPoints: number | null;
  reviewState: ValidationState;
}

export interface StoredReceiptReview {
  receipt: Receipt;
  lineItems: StoredLineItem[];
  adjustments: StoredReceiptAdjustment[];
}

export class ReceiptRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async createDraft(input: CreateReceiptDraftInput): Promise<void> {
    await this.database.run(
      `INSERT INTO receipts (
        id, merchant_raw_name, purchased_at, currency_code, transaction_type,
        status, validation_state, image_uri, image_width, image_height,
        raw_ocr_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 'review', ?, ?, ?, ?, ?, ?);`,
      [
        input.id,
        input.merchantRawName ?? null,
        input.purchasedAt ?? null,
        input.currencyCode ?? 'PHP',
        input.transactionType ?? 'purchase',
        input.imageUri ?? null,
        input.imageWidth ?? null,
        input.imageHeight ?? null,
        input.rawOcrText ?? null,
        input.now,
        input.now,
      ],
    );
  }

  async getById(id: string): Promise<Receipt | null> {
    const row = await this.database.first<ReceiptRow>(
      'SELECT * FROM receipts WHERE id = ?;',
      [id],
    );
    return row ? mapReceipt(row) : null;
  }

  async getReviewData(id: string): Promise<StoredReceiptReview | null> {
    const receipt = await this.getById(id);
    if (!receipt) {
      return null;
    }

    return this.getReviewDataForReceipt(receipt);
  }

  async getReviewDataForReceipt(
    receipt: Receipt,
  ): Promise<StoredReceiptReview> {
    const [lineRows, adjustmentRows] = await Promise.all([
      this.database.all<LineItemRow>(
        `SELECT * FROM line_items
         WHERE receipt_id = ?
         ORDER BY position ASC;`,
        [receipt.id],
      ),
      this.database.all<AdjustmentRow>(
        `SELECT * FROM receipt_adjustments
         WHERE receipt_id = ?
         ORDER BY position ASC;`,
        [receipt.id],
      ),
    ]);

    return {
      receipt,
      lineItems: lineRows.map(mapLineItem),
      adjustments: adjustmentRows.map(mapAdjustment),
    };
  }

  async listImageUris(): Promise<string[]> {
    const rows = await this.database.all<{ image_uri: string }>(
      `SELECT image_uri
       FROM receipts
       WHERE image_uri IS NOT NULL
       ORDER BY created_at ASC;`,
    );
    return rows.map((row) => row.image_uri);
  }

  async listUnfinished(limit = 20): Promise<UnfinishedReceiptSummary[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows = await this.database.all<{
      id: string;
      status: ReceiptStatus;
      has_ocr_text: number;
      updated_at: string;
    }>(
      `SELECT
         id,
         status,
         CASE
           WHEN raw_ocr_text IS NOT NULL AND length(raw_ocr_text) > 0 THEN 1
           ELSE 0
         END AS has_ocr_text,
         updated_at
       FROM receipts
       WHERE status IN ('draft', 'processing', 'review')
       ORDER BY updated_at DESC
       LIMIT ?;`,
      [safeLimit],
    );

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      hasOcrText: row.has_ocr_text === 1,
      updatedAt: row.updated_at,
    }));
  }

  async setStatus(id: string, status: ReceiptStatus, now: string): Promise<void> {
    const result = await this.database.run(
      'UPDATE receipts SET status = ?, updated_at = ? WHERE id = ?;',
      [status, now, id],
    );

    if (result.changes !== 1) {
      throw new Error(`Receipt not found: ${id}`);
    }
  }

  async replaceReviewData(input: ReplaceReviewDataInput): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await writeReviewData(transaction, input, 'review', [
        'draft',
        'processing',
        'review',
      ]);
    });
  }

  async saveAcceptedReview(input: ReplaceReviewDataInput): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await writeReviewData(transaction, input, 'accepted', [
        'draft',
        'processing',
        'review',
      ]);
    });
  }

  async acceptReceipt(id: string, now: string): Promise<void> {
    const receipt = await this.getById(id);
    if (!receipt) {
      throw new Error(`Receipt not found: ${id}`);
    }
    if (receipt.status !== 'review') {
      throw new Error('Only reviewed receipts can be accepted.');
    }

    const result = await this.database.run(
      `UPDATE receipts
       SET status = 'accepted', updated_at = ?
       WHERE id = ? AND status = 'review';`,
      [now, id],
    );

    if (result.changes !== 1) {
      throw new Error('Receipt acceptance failed because its state changed.');
    }
  }

  async listAccepted(limit = 50): Promise<Receipt[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const rows = await this.database.all<ReceiptRow>(
      `SELECT * FROM receipts
       WHERE status = 'accepted'
       ORDER BY COALESCE(purchased_at, created_at) DESC
       LIMIT ?;`,
      [safeLimit],
    );
    return rows.map(mapReceipt);
  }

  async deleteReceipt(id: string): Promise<boolean> {
    const result = await this.database.run('DELETE FROM receipts WHERE id = ?;', [id]);
    return result.changes === 1;
  }
}

async function writeReviewData(
  transaction: DatabaseConnection,
  input: ReplaceReviewDataInput,
  targetStatus: 'review' | 'accepted',
  allowedStatuses: readonly ReceiptStatus[],
): Promise<void> {
  const placeholders = allowedStatuses.map(() => '?').join(', ');
  const update = await transaction.run(
    `UPDATE receipts SET
      merchant_id = ?,
      merchant_raw_name = ?,
      purchased_at = ?,
      subtotal_minor = ?,
      total_minor = ?,
      transaction_type = ?,
      validation_state = ?,
      status = ?,
      updated_at = ?
    WHERE id = ? AND status IN (${placeholders});`,
    [
      input.merchantId ?? null,
      input.merchantRawName ?? null,
      input.purchasedAt ?? null,
      input.subtotalMinor ?? null,
      input.totalMinor ?? null,
      input.transactionType ?? 'purchase',
      input.validationState,
      targetStatus,
      input.now,
      input.receiptId,
      ...allowedStatuses,
    ],
  );

  if (update.changes !== 1) {
    throw new Error(
      targetStatus === 'accepted'
        ? 'Receipt acceptance requires a current review draft.'
        : `Receipt not found or no longer editable: ${input.receiptId}`,
    );
  }

  await transaction.run('DELETE FROM line_items WHERE receipt_id = ?;', [
    input.receiptId,
  ]);
  await transaction.run('DELETE FROM receipt_adjustments WHERE receipt_id = ?;', [
    input.receiptId,
  ]);

  await insertLineItemChunks(transaction, input);
  await insertAdjustmentChunks(transaction, input);
}

async function insertLineItemChunks(
  transaction: DatabaseConnection,
  input: ReplaceReviewDataInput,
): Promise<void> {
  // 14 values per row. 60 rows stays below the common SQLite 999-parameter
  // ceiling and avoids one native bridge round-trip per receipt item.
  const chunkSize = 60;

  for (let offset = 0; offset < input.lineItems.length; offset += chunkSize) {
    const chunk = input.lineItems.slice(offset, offset + chunkSize);
    const placeholders = chunk
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const params: DatabaseValue[] = chunk.flatMap((item) => [
      item.id,
      input.receiptId,
      item.position,
      item.rawName,
      item.normalizedItemId ?? null,
      item.categoryId ?? null,
      item.quantityMilli ?? null,
      item.rawQuantityText ?? null,
      item.unitPriceMinor ?? null,
      item.lineTotalMinor ?? null,
      item.confidenceBasisPoints ?? null,
      item.reviewState ?? 'review',
      input.now,
      input.now,
    ]);

    await transaction.run(
      `INSERT INTO line_items (
        id, receipt_id, position, raw_name, normalized_item_id, category_id,
        quantity_milli, raw_quantity_text, unit_price_minor, line_total_minor,
        confidence_basis_points, review_state, created_at, updated_at
      ) VALUES ${placeholders};`,
      params,
    );
  }
}

async function insertAdjustmentChunks(
  transaction: DatabaseConnection,
  input: ReplaceReviewDataInput,
): Promise<void> {
  const chunkSize = 100;

  for (let offset = 0; offset < input.adjustments.length; offset += chunkSize) {
    const chunk = input.adjustments.slice(offset, offset + chunkSize);
    const placeholders = chunk
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const params: DatabaseValue[] = chunk.flatMap((adjustment) => [
      adjustment.id,
      input.receiptId,
      adjustment.position,
      adjustment.kind,
      adjustment.label,
      adjustment.amountMinor,
      adjustment.confidenceBasisPoints ?? null,
      adjustment.reviewState ?? 'review',
    ]);

    await transaction.run(
      `INSERT INTO receipt_adjustments (
        id, receipt_id, position, kind, label, amount_minor,
        confidence_basis_points, review_state
      ) VALUES ${placeholders};`,
      params,
    );
  }
}

interface ReceiptRow {
  id: string;
  merchant_id: string | null;
  merchant_raw_name: string | null;
  purchased_at: string | null;
  subtotal_minor: number | null;
  total_minor: number | null;
  currency_code: string;
  transaction_type: TransactionType;
  status: ReceiptStatus;
  validation_state: ValidationState;
  image_uri: string | null;
  image_width: number | null;
  image_height: number | null;
  raw_ocr_text: string | null;
  created_at: string;
  updated_at: string;
}

interface LineItemRow {
  id: string;
  receipt_id: string;
  position: number;
  raw_name: string;
  normalized_item_id: string | null;
  category_id: string | null;
  quantity_milli: number | null;
  raw_quantity_text: string | null;
  unit_price_minor: number | null;
  line_total_minor: number | null;
  confidence_basis_points: number | null;
  review_state: ValidationState;
  created_at: string;
  updated_at: string;
}

interface AdjustmentRow {
  id: string;
  receipt_id: string;
  position: number;
  kind: AdjustmentKind;
  label: string;
  amount_minor: number;
  confidence_basis_points: number | null;
  review_state: ValidationState;
}

function mapReceipt(row: ReceiptRow): Receipt {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    merchantRawName: row.merchant_raw_name,
    purchasedAt: row.purchased_at,
    subtotalMinor: row.subtotal_minor,
    totalMinor: row.total_minor,
    currencyCode: row.currency_code,
    transactionType: row.transaction_type,
    status: row.status,
    validationState: row.validation_state,
    imageUri: row.image_uri,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    rawOcrText: row.raw_ocr_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLineItem(row: LineItemRow): StoredLineItem {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    position: row.position,
    rawName: row.raw_name,
    normalizedItemId: row.normalized_item_id,
    categoryId: row.category_id,
    quantityMilli: row.quantity_milli,
    rawQuantityText: row.raw_quantity_text,
    unitPriceMinor: row.unit_price_minor,
    lineTotalMinor: row.line_total_minor,
    confidenceBasisPoints: row.confidence_basis_points,
    reviewState: row.review_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAdjustment(row: AdjustmentRow): StoredReceiptAdjustment {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    position: row.position,
    kind: row.kind,
    label: row.label,
    amountMinor: row.amount_minor,
    confidenceBasisPoints: row.confidence_basis_points,
    reviewState: row.review_state,
  };
}
