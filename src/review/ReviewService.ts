import type {
  OcrRepository,
  StoredOcrRun,
} from '../data/repositories/OcrRepository';
import type {
  ReceiptRepository,
  ReplaceReviewDataInput,
} from '../data/repositories/ReceiptRepository';
import type { ValidationState } from '../domain/receipt';
import type { ParserProcessingService } from '../parser/ParserProcessingService';
import {
  createReviewDraft,
  createReviewDraftFromStored,
  evaluateReviewDraft,
  reviewDraftToCandidate,
} from './ReviewModel';
import type { ReviewDraft, ReviewSession } from './types';

export class ReviewService {
  constructor(
    private readonly receipts: ReceiptRepository,
    private readonly ocr: OcrRepository,
    private readonly parser: ParserProcessingService,
  ) {}

  async load(
    receiptId: string,
    now = new Date(),
    providedRun?: StoredOcrRun,
  ): Promise<ReviewSession> {
    if (providedRun && providedRun.receiptId !== receiptId) {
      throw new Error('Provided OCR evidence does not belong to this receipt.');
    }

    const [receipt, pages] = await Promise.all([
      this.receipts.getById(receiptId),
      this.receipts.listPages(receiptId),
    ]);

    if (!receipt) {
      throw new Error(`Receipt not found: ${receiptId}`);
    }
    if (receipt.status === 'accepted') {
      throw new Error('Accepted receipts cannot be reopened as an unreviewed draft.');
    }

    const sourceImageUris =
      pages.length > 0
        ? pages.map((page) => page.imageUri)
        : receipt.imageUri
          ? [receipt.imageUri]
          : [];

    if (receipt.status === 'review') {
      const stored = await this.receipts.getReviewDataForReceipt(receipt);
      const draft = createReviewDraftFromStored(stored);

      return {
        receipt,
        sourceImageUris,
        rawOcrText: receipt.rawOcrText ?? '',
        draft,
        evaluation: evaluateReviewDraft(draft, now),
      };
    }

    const run = providedRun ?? (await this.ocr.getForReceipt(receiptId));
    if (!run) {
      throw new Error('Receipt does not have completed OCR evidence.');
    }

    const candidate = this.parser.parseRun(run);
    const draft = createReviewDraft(candidate, receiptId);
    const evaluation = evaluateReviewDraft(draft, now);
    let currentReceipt = receipt;

    if (evaluation.inputErrors.length === 0) {
      const persisted = buildPersistenceInput(
        receiptId,
        draft,
        evaluation,
        now.toISOString(),
      );
      await this.receipts.replaceReviewData(persisted);
      currentReceipt = {
        ...currentReceipt,
        merchantId: persisted.merchantId ?? null,
        merchantRawName: persisted.merchantRawName ?? null,
        purchasedAt: persisted.purchasedAt ?? null,
        subtotalMinor: persisted.subtotalMinor ?? null,
        totalMinor: persisted.totalMinor ?? null,
        transactionType:
          persisted.transactionType ?? currentReceipt.transactionType,
        validationState: persisted.validationState,
        status: 'review',
        updatedAt: persisted.now,
      };
    }

    return {
      receipt: currentReceipt,
      sourceImageUris,
      rawOcrText: run.rawText,
      draft,
      evaluation,
    };
  }

  async saveDraft(
    receiptId: string,
    draft: ReviewDraft,
    now = new Date(),
  ): Promise<ReviewSession> {
    const evaluation = evaluateReviewDraft(draft, now);

    if (evaluation.inputErrors.length > 0) {
      throw new Error('Correct invalid review fields before saving the draft.');
    }

    await this.receipts.replaceReviewData(
      buildPersistenceInput(receiptId, draft, evaluation, now.toISOString()),
    );

    const [receipt, pages] = await Promise.all([
      this.receipts.getById(receiptId),
      this.receipts.listPages(receiptId),
    ]);
    if (!receipt) {
      throw new Error('Receipt review could not be reloaded after saving.');
    }

    return {
      receipt,
      sourceImageUris:
        pages.length > 0
          ? pages.map((page) => page.imageUri)
          : receipt.imageUri
            ? [receipt.imageUri]
            : [],
      rawOcrText: receipt.rawOcrText ?? '',
      draft,
      evaluation,
    };
  }

  async saveAccepted(
    receiptId: string,
    draft: ReviewDraft,
    acknowledgeReview: boolean,
    now = new Date(),
  ): Promise<void> {
    const evaluation = evaluateReviewDraft(draft, now);

    if (evaluation.inputErrors.length > 0) {
      throw new Error('Correct invalid review fields before saving.');
    }
    if (evaluation.validation.state === 'mismatch') {
      throw new Error('Resolve receipt mismatches before saving purchase history.');
    }
    if (evaluation.validation.state === 'review' && !acknowledgeReview) {
      throw new Error(
        'Acknowledge the remaining review warnings before saving purchase history.',
      );
    }

    const receipt = await this.receipts.getById(receiptId);
    if (!receipt || receipt.status !== 'review') {
      throw new Error('Receipt must be saved as a review draft before acceptance.');
    }

    await this.receipts.saveAcceptedReview(
      buildPersistenceInput(receiptId, draft, evaluation, now.toISOString()),
    );
  }

  async discard(receiptId: string): Promise<string[] | null> {
    const [receipt, imageUris] = await Promise.all([
      this.receipts.getById(receiptId),
      this.receipts.listReceiptImageUris(receiptId),
    ]);
    if (!receipt) {
      return null;
    }
    if (receipt.status === 'accepted') {
      throw new Error('Accepted receipts cannot be discarded as review drafts.');
    }

    await this.receipts.deleteReceipt(receiptId);
    return imageUris.length > 0
      ? imageUris
      : receipt.imageUri
        ? [receipt.imageUri]
        : [];
  }
}

function buildPersistenceInput(
  receiptId: string,
  draft: ReviewDraft,
  evaluation: ReturnType<typeof evaluateReviewDraft>,
  now: string,
): ReplaceReviewDataInput {
  const candidate = reviewDraftToCandidate(draft);
  const confidenceByField = new Map(
    evaluation.validation.confidence.map((field) => [
      field.fieldPath,
      field.confidenceBasisPoints,
    ]),
  );
  const reviewStateByField = indexReviewStates(
    evaluation.validation.issues,
  );

  return {
    receiptId,
    merchantRawName: candidate.merchant?.rawName ?? null,
    purchasedAt: candidate.date?.isoDateTime ?? null,
    subtotalMinor: candidate.summary.subtotalMinor,
    totalMinor: candidate.summary.totalMinor,
    transactionType: candidate.transactionType,
    validationState: evaluation.validation.state,
    lineItems: candidate.items.map((item) => ({
      id: item.id,
      position: item.position,
      rawName: item.rawName,
      quantityMilli: item.quantityMilli,
      rawQuantityText: item.rawQuantityText,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
      confidenceBasisPoints:
        confidenceByField.get(`items.${item.id}`) ?? null,
      reviewState:
        reviewStateByField.get(`items.${item.id}`) ?? 'verified',
    })),
    adjustments: candidate.summary.adjustments.map((adjustment) => ({
      id: adjustment.id,
      position: adjustment.position,
      kind: adjustment.kind,
      label: adjustment.label,
      amountMinor: adjustment.amountMinor,
      confidenceBasisPoints:
        confidenceByField.get(`adjustments.${adjustment.id}`) ?? null,
      reviewState:
        reviewStateByField.get(`adjustments.${adjustment.id}`) ?? 'verified',
    })),
    now,
  };
}

function indexReviewStates(
  issues: readonly {
    fieldPath: string;
    state: Exclude<ValidationState, 'verified'>;
  }[],
): Map<string, ValidationState> {
  const states = new Map<string, ValidationState>();

  for (const issue of issues) {
    const segments = issue.fieldPath.split('.');
    const fieldPath =
      (segments[0] === 'items' || segments[0] === 'adjustments') &&
      segments.length > 2
        ? segments.slice(0, 2).join('.')
        : issue.fieldPath;
    const current = states.get(fieldPath);

    if (issue.state === 'mismatch' || !current) {
      states.set(fieldPath, issue.state);
    }
  }

  return states;
}
