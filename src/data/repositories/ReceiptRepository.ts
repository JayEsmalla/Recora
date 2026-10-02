import type {
  AdjustmentKind,
  Receipt,
  ReceiptStatus,
  TransactionType,
  ValidationState,
} from '../../domain/receipt';
import type { DatabaseConnection } from '../database/DatabaseConnection';

export interface CreateReceiptDraftInput {
  id: string;
  merchantRawName?: string | null;
  purchasedAt?: string | null;
  currencyCode?: string;
  transactionType?: TransactionType;
  imageUri?: string | null;
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
  rawOcrText?: string | null;
  lineItems: readonly PersistLineItemInput[];
  adjustments: readonly PersistAdjustmentInput[];
  now: string;
}

export class ReceiptRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async createDraft(input: CreateReceiptDraftInput): Promise<void> {
    await this.database.run(
      `INSERT INTO receipts (
        id, merchant_raw_name, purchased_at, currency_code, transaction_type,
        status, validation_state, image_uri, raw_ocr_text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'draft', 'review', ?, ?, ?, ?);`,
      [
        input.id,
        input.merchantRawName ?? null,
        input.purchasedAt ?? null,
        input.currencyCode ?? 'PHP',
        input.transactionType ?? 'purchase',
        input.imageUri ?? null,
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
      const update = await transaction.run(
        `UPDATE receipts SET
          merchant_id = ?,
          merchant_raw_name = ?,
          purchased_at = ?,
          subtotal_minor = ?,
          total_minor = ?,
          transaction_type = ?,
          validation_state = ?,
          raw_ocr_text = ?,
          status = 'review',
          updated_at = ?
        WHERE id = ?;`,
        [
          input.merchantId ?? null,
          input.merchantRawName ?? null,
          input.purchasedAt ?? null,
          input.subtotalMinor ?? null,
          input.totalMinor ?? null,
          input.transactionType ?? 'purchase',
          input.validationState,
          input.rawOcrText ?? null,
          input.now,
          input.receiptId,
        ],
      );

      if (update.changes !== 1) {
        throw new Error(`Receipt not found: ${input.receiptId}`);
      }

      await transaction.run('DELETE FROM line_items WHERE receipt_id = ?;', [
        input.receiptId,
      ]);
      await transaction.run('DELETE FROM receipt_adjustments WHERE receipt_id = ?;', [
        input.receiptId,
      ]);

      for (const item of input.lineItems) {
        await transaction.run(
          `INSERT INTO line_items (
            id, receipt_id, position, raw_name, normalized_item_id, category_id,
            quantity_milli, raw_quantity_text, unit_price_minor, line_total_minor,
            confidence_basis_points, review_state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
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
          ],
        );
      }

      for (const adjustment of input.adjustments) {
        await transaction.run(
          `INSERT INTO receipt_adjustments (
            id, receipt_id, position, kind, label, amount_minor,
            confidence_basis_points, review_state
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            adjustment.id,
            input.receiptId,
            adjustment.position,
            adjustment.kind,
            adjustment.label,
            adjustment.amountMinor,
            adjustment.confidenceBasisPoints ?? null,
            adjustment.reviewState ?? 'review',
          ],
        );
      }
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
  raw_ocr_text: string | null;
  created_at: string;
  updated_at: string;
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
    rawOcrText: row.raw_ocr_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
