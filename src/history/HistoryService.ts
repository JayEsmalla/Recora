import { HistoryRepository } from './HistoryRepository';
import { NormalizationService } from './NormalizationService';
import { HISTORY_PAGE_SIZE } from './paginateHistory';
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
  receiptTotal: number;
  itemTotal: number;
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
    const pagedFilters = { limit: HISTORY_PAGE_SIZE, offset: 0, ...filters };
    const [receipts, items, categories, receiptTotal, itemTotal] = await Promise.all([
      mode === 'items'
        ? Promise.resolve([])
        : this.repository.listReceipts(pagedFilters),
      mode === 'receipts'
        ? Promise.resolve([])
        : this.repository.searchItems(pagedFilters),
      includeCategories ? this.repository.listCategories() : Promise.resolve([]),
      mode === 'items' ? Promise.resolve(0) : this.repository.countReceipts(filters),
      mode === 'receipts' ? Promise.resolve(0) : this.repository.countItems(filters),
    ]);

    return { receipts, items, categories, receiptTotal, itemTotal };
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
