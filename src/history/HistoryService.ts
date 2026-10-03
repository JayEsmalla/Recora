import { HistoryRepository } from './HistoryRepository';
import { NormalizationService } from './NormalizationService';
import type {
  CategoryOption,
  HistoryFilters,
  ItemHistorySummary,
  ItemSearchEntry,
  NormalizedItemOption,
  ReceiptHistoryDetail,
  ReceiptHistoryEntry,
} from './types';

export interface HistoryOverview {
  receipts: ReceiptHistoryEntry[];
  items: ItemSearchEntry[];
  categories: CategoryOption[];
}

export type HistoryLoadMode = 'receipts' | 'items' | 'both';

export class HistoryService {
  constructor(
    private readonly repository: HistoryRepository,
    private readonly normalization: NormalizationService,
  ) {}

  async loadOverview(
    filters: HistoryFilters = {},
    mode: HistoryLoadMode = 'both',
    includeCategories = true,
  ): Promise<HistoryOverview> {
    const [receipts, items, categories] = await Promise.all([
      mode === 'items'
        ? Promise.resolve([])
        : this.repository.listReceipts(filters),
      mode === 'receipts'
        ? Promise.resolve([])
        : this.repository.searchItems(filters),
      includeCategories ? this.repository.listCategories() : Promise.resolve([]),
    ]);

    return { receipts, items, categories };
  }

  getReceiptDetail(receiptId: string): Promise<ReceiptHistoryDetail | null> {
    return this.repository.getReceiptDetail(receiptId);
  }

  getItemHistory(input: {
    normalizedItemId?: string | null;
    rawName?: string | null;
    limit?: number;
  }): Promise<ItemHistorySummary | null> {
    return this.repository.getItemHistory(input);
  }

  listNormalizedItems(
    query = '',
    limit = 50,
  ): Promise<NormalizedItemOption[]> {
    return this.repository.listNormalizedItems(query, limit);
  }

  async assignItemIdentity(input: {
    lineItemId: string;
    canonicalName: string;
    categoryId?: string | null;
    rememberForMerchant?: boolean;
  }): Promise<void> {
    await this.normalization.assignIdentity(input);
  }

  unlinkItemIdentity(lineItemId: string): Promise<void> {
    return this.normalization.unlinkIdentity(lineItemId);
  }

  applyKnownRules(receiptId: string): Promise<number> {
    return this.normalization.applyKnownRules(receiptId);
  }

  resetRulesForReceipt(receiptId: string): Promise<number> {
    return this.normalization.resetRulesForReceipt(receiptId);
  }

  deleteReceipt(receiptId: string): Promise<string[] | null> {
    return this.repository.deleteAcceptedReceipt(receiptId);
  }
}
