import {
  HistoryRepository,
  stableRulePattern,
} from './HistoryRepository';
import type { NormalizedItemOption } from './types';

export interface AssignItemIdentityInput {
  lineItemId: string;
  canonicalName: string;
  categoryId?: string | null;
  rememberForMerchant?: boolean;
  now?: string;
}

export class NormalizationService {
  constructor(
    private readonly history: HistoryRepository,
    private readonly idFactory: (prefix: string) => string = createLocalId,
  ) {}

  async assignIdentity(
    input: AssignItemIdentityInput,
  ): Promise<NormalizedItemOption> {
    const context = await this.history.getAcceptedLineItemContext(
      input.lineItemId,
    );
    if (!context) {
      throw new Error(
        'Only an item from accepted purchase history can be normalized.',
      );
    }

    const canonicalName = input.canonicalName.trim();
    if (!canonicalName) {
      throw new Error('A canonical item name is required.');
    }

    const now = input.now ?? new Date().toISOString();
    let normalized = await this.history.findNormalizedItemByName(canonicalName);

    if (!normalized) {
      normalized = await this.history.createNormalizedItem({
        id: this.idFactory('normalized-item'),
        canonicalName,
        categoryId: input.categoryId ?? null,
        now,
      });
    } else if (
      input.categoryId !== undefined &&
      normalized.categoryId !== input.categoryId
    ) {
      await this.history.setNormalizedItemCategory(
        normalized.id,
        input.categoryId ?? null,
        now,
      );
      normalized = {
        ...normalized,
        categoryId: input.categoryId ?? null,
      };
    }

    await this.history.assignNormalizedItem(
      context.lineItemId,
      normalized.id,
      now,
    );

    if (input.rememberForMerchant && context.merchantRawName?.trim()) {
      const merchant = await this.ensureReceiptMerchant(
        context.receiptId,
        context.merchantRawName,
        context.merchantId,
        now,
      );

      await this.history.saveExactCorrectionRule({
        id: this.idFactory('correction-rule'),
        merchantId: merchant.id,
        pattern: stableRulePattern(context.rawName),
        correction: normalized.canonicalName,
        normalizedItemId: normalized.id,
        now,
      });
    }

    return normalized;
  }

  async unlinkIdentity(
    lineItemId: string,
    now = new Date().toISOString(),
  ): Promise<void> {
    const context = await this.history.getAcceptedLineItemContext(lineItemId);
    if (!context) {
      throw new Error(
        'Only an item from accepted purchase history can be changed.',
      );
    }

    await this.history.assignNormalizedItem(lineItemId, null, now);
  }

  async applyKnownRules(
    receiptId: string,
    now = new Date().toISOString(),
  ): Promise<number> {
    const items = await this.history.listUnnormalizedAcceptedItems(receiptId);
    const first = items[0];

    if (!first?.merchantRawName?.trim()) {
      return 0;
    }

    const merchant = await this.ensureReceiptMerchant(
      receiptId,
      first.merchantRawName,
      first.merchantId,
      now,
    );

    let applied = 0;
    for (const item of items) {
      const rule = await this.history.findExactCorrectionRule(
        merchant.id,
        item.rawName,
      );
      if (!rule?.normalizedItemId) {
        continue;
      }

      await this.history.assignNormalizedItem(
        item.lineItemId,
        rule.normalizedItemId,
        now,
      );
      applied += 1;
    }

    return applied;
  }

  async resetRulesForReceipt(
    receiptId: string,
    now = new Date().toISOString(),
  ): Promise<number> {
    const detail = await this.history.getReceiptDetail(receiptId);
    if (!detail?.merchantName?.trim()) {
      return 0;
    }

    const item = detail.items[0];
    const context = item
      ? await this.history.getAcceptedLineItemContext(item.lineItemId)
      : null;

    const merchant = await this.ensureReceiptMerchant(
      receiptId,
      detail.merchantName,
      context?.merchantId ?? null,
      now,
    );

    return this.history.resetCorrectionRules(merchant.id);
  }

  private async ensureReceiptMerchant(
    receiptId: string,
    rawName: string,
    existingMerchantId: string | null,
    now: string,
  ): Promise<{ id: string; canonicalName: string }> {
    if (existingMerchantId) {
      return {
        id: existingMerchantId,
        canonicalName: rawName.trim(),
      };
    }

    const merchant = await this.history.ensureMerchant({
      id: this.idFactory('merchant'),
      canonicalName: rawName.trim(),
      alias: rawName.trim(),
      now,
    });

    await this.history.linkReceiptMerchant(receiptId, merchant.id, now);
    return merchant;
  }
}

function createLocalId(prefix: string): string {
  return (
    prefix +
    '-' +
    Date.now() +
    '-' +
    Math.random().toString(36).slice(2, 10)
  );
}
