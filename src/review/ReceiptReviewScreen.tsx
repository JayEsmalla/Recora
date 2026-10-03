import { useDeferredValue, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import type { AdjustmentKind, TransactionType, ValidationState } from '../domain/receipt';
import type { ValidationIssue } from '../validation/types';
import {
  createBlankAdjustment,
  createBlankReviewItem,
  evaluateReviewDraft,
} from './ReviewModel';
import type {
  ReviewAdjustmentDraft,
  ReviewDraft,
  ReviewLineItemDraft,
  ReviewSession,
} from './types';

interface ReceiptReviewScreenProps {
  initialSession: ReviewSession;
  onSaveDraft: (draft: ReviewDraft) => Promise<ReviewSession>;
  onAccept: (draft: ReviewDraft, acknowledgeReview: boolean) => Promise<void>;
  onDiscard: () => Promise<void>;
  onBack: () => void;
}

const TRANSACTION_TYPES: readonly TransactionType[] = [
  'purchase',
  'return',
  'refund',
  'unknown',
];

const ADJUSTMENT_KINDS: readonly AdjustmentKind[] = [
  'discount',
  'tax',
  'service',
  'rounding',
  'other',
];

const ITEM_RENDER_BATCH = 25;

export function ReceiptReviewScreen({
  initialSession,
  onSaveDraft,
  onAccept,
  onDiscard,
  onBack,
}: ReceiptReviewScreenProps) {
  const [draft, setDraft] = useState(initialSession.draft);
  const [acknowledgeReview, setAcknowledgeReview] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [visibleItemCount, setVisibleItemCount] = useState(
    Math.min(ITEM_RENDER_BATCH, initialSession.draft.items.length),
  );
  const [pendingIssueAnchor, setPendingIssueAnchor] = useState<string | null>(
    null,
  );
  const [busyAction, setBusyAction] = useState<
    'draft' | 'accept' | 'discard' | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const anchors = useRef<Record<string, number>>({});

  const deferredDraft = useDeferredValue(draft);
  const evaluation = useMemo(
    () => evaluateReviewDraft(deferredDraft),
    [deferredDraft],
  );
  const validationPending = deferredDraft !== draft;

  function updateDraft(next: ReviewDraft) {
    setDraft(next);
    setAcknowledgeReview(false);
    setNotice(null);
    setError(null);
  }

  async function saveDraft() {
    if (busyAction) {
      return;
    }

    const currentEvaluation = evaluateReviewDraft(draft);
    if (currentEvaluation.inputErrors.length > 0) {
      setError('Correct invalid input values before saving this review draft.');
      return;
    }

    setBusyAction('draft');
    setError(null);
    try {
      const session = await onSaveDraft(draft);
      setDraft(session.draft);
      setNotice('Review draft saved locally.');
    } catch (cause) {
      setError(messageFromError(cause, 'Could not save this review draft.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function acceptReceipt() {
    if (busyAction) {
      return;
    }

    const currentEvaluation = evaluateReviewDraft(draft);
    if (currentEvaluation.inputErrors.length > 0) {
      setError('Correct invalid input values before saving this receipt.');
      return;
    }

    setBusyAction('accept');
    setError(null);
    try {
      await onAccept(draft, acknowledgeReview);
    } catch (cause) {
      setError(messageFromError(cause, 'Could not accept this reviewed receipt.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function discardReceipt() {
    if (busyAction) {
      return;
    }

    setBusyAction('discard');
    setError(null);
    try {
      await onDiscard();
    } catch (cause) {
      setError(messageFromError(cause, 'Could not discard this receipt draft.'));
    } finally {
      setBusyAction(null);
    }
  }

  function registerAnchor(
    fieldPath: string,
    event: LayoutChangeEvent,
    parentPath?: string,
  ) {
    const parentY = parentPath ? anchors.current[parentPath] ?? 0 : 0;
    const y = parentY + event.nativeEvent.layout.y;
    anchors.current[fieldPath] = y;

    if (pendingIssueAnchor === fieldPath) {
      setPendingIssueAnchor(null);
      scrollRef.current?.scrollTo({
        y: Math.max(0, y - 18),
        animated: true,
      });
    }
  }

  function jumpToIssue(issue: ValidationIssue) {
    const parts = issue.fieldPath.split('.');

    if (parts[0] === 'items' && parts[1]) {
      const itemIndex = draft.items.findIndex((item) => item.id === parts[1]);
      if (itemIndex >= visibleItemCount) {
        setPendingIssueAnchor(`items.${parts[1]}`);
        setVisibleItemCount(itemIndex + 1);
        return;
      }
    }

    scrollToIssue(issue);
  }

  function scrollToIssue(issue: ValidationIssue) {
    const exact = anchors.current[issue.fieldPath];
    const parts = issue.fieldPath.split('.');
    const parent =
      parts.length > 1
        ? anchors.current[parts.slice(0, 2).join('.')]
        : undefined;

    scrollRef.current?.scrollTo({
      y: Math.max(0, (exact ?? parent ?? anchors.current.receipt ?? 0) - 18),
      animated: true,
    });
  }

  const canAccept =
    !validationPending &&
    evaluation.inputErrors.length === 0 &&
    evaluation.validation.state !== 'mismatch' &&
    (evaluation.validation.state !== 'review' || acknowledgeReview);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.linkButton}>
          <Text style={styles.linkText}>‹ Home</Text>
        </Pressable>
        <Text style={styles.eyebrow}>REVIEW RECEIPT</Text>
      </View>

      <Text style={styles.title}>Review receipt</Text>
      <Text style={styles.body}>
        Correct highlighted fields. Original image and OCR evidence stay unchanged.
      </Text>

      <StatusCard
        state={evaluation.validation.state}
        issueCount={evaluation.validation.issues.length}
      />

      {evaluation.validation.issues.length > 0 ? (
        <View style={styles.issueList}>
          <Text style={styles.sectionTitle}>Needs attention</Text>
          <Text style={styles.sectionHint}>
            Tap an issue to jump to the affected field.
          </Text>
          {evaluation.validation.issues.map((issue, index) => (
            <Pressable
              key={`${issue.code}-${issue.fieldPath}-${index}`}
              accessibilityRole="button"
              onPress={() => jumpToIssue(issue)}
              style={styles.issueRow}
            >
              <Text
                style={
                  issue.state === 'mismatch'
                    ? styles.issueMismatch
                    : styles.issueReview
                }
              >
                {issue.state === 'mismatch' ? '!' : '?'}
              </Text>
              <View style={styles.issueCopy}>
                <Text style={styles.issueState}>
                  {issue.state === 'mismatch' ? 'Mismatch' : 'Review'}
                </Text>
                <Text style={styles.issueMessage}>{issue.message}</Text>
              </View>
              <Text style={styles.jumpMark}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {evaluation.inputErrors.length > 0 ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Invalid input</Text>
          {evaluation.inputErrors.map((item, index) => (
            <Text key={`${item.fieldPath}-${index}`} style={styles.errorText}>
              • {item.message}
            </Text>
          ))}
        </View>
      ) : null}

      <View
        onLayout={(event) => registerAnchor('receipt', event)}
        style={styles.card}
      >
        <Text style={styles.sectionTitle}>Receipt details</Text>

        <View
          onLayout={(event) =>
            registerAnchor('receipt.merchant', event, 'receipt')
          }
        >
          <FieldLabel label="Merchant" />
          <TextInput
            accessibilityLabel="Merchant name"
            value={draft.merchantName}
            onChangeText={(merchantName) =>
              updateDraft({ ...draft, merchantName })
            }
            placeholder="Merchant name"
            style={styles.textInput}
          />
        </View>

        <View
          onLayout={(event) =>
            registerAnchor('receipt.date', event, 'receipt')
          }
        >
          <FieldLabel
            label="Purchase date / time"
            hint="Use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS"
          />
          <TextInput
            accessibilityLabel="Purchase date and time"
            value={draft.purchasedAtText}
            onChangeText={(purchasedAtText) =>
              updateDraft({ ...draft, purchasedAtText })
            }
            placeholder="2026-10-03"
            autoCapitalize="none"
            style={styles.textInput}
          />
        </View>

        <FieldLabel label="Transaction type" />
        <View style={styles.chipRow}>
          {TRANSACTION_TYPES.map((type) => (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.transactionType === type }}
              onPress={() => updateDraft({ ...draft, transactionType: type })}
              style={[
                styles.chip,
                draft.transactionType === type && styles.chipSelected,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  draft.transactionType === type && styles.chipTextSelected,
                ]}
              >
                {capitalize(type)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View
          onLayout={(event) =>
            registerAnchor('receipt.amounts', event, 'receipt')
          }
          style={styles.moneyRow}
        >
          <View
            onLayout={(event) =>
              registerAnchor(
                'receipt.subtotal',
                event,
                'receipt.amounts',
              )
            }
            style={styles.moneyColumn}
          >
            <EditableAmount
              label="Subtotal"
              value={draft.subtotalText}
              onChange={(subtotalText) =>
                updateDraft({ ...draft, subtotalText })
              }
            />
          </View>
          <View
            onLayout={(event) =>
              registerAnchor(
                'receipt.total',
                event,
                'receipt.amounts',
              )
            }
            style={styles.moneyColumn}
          >
            <EditableAmount
              label="Final total"
              value={draft.totalText}
              onChange={(totalText) => updateDraft({ ...draft, totalText })}
            />
          </View>
        </View>
      </View>

      <View
        onLayout={(event) => registerAnchor('items', event)}
        style={styles.card}
      >
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <Text style={styles.sectionTitle}>Items</Text>
            <Text style={styles.sectionHint}>
              Item name and line total are required. Quantity and unit price may stay
              blank when the receipt does not show them.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              updateDraft({
                ...draft,
                items: [
                  ...draft.items,
                  createBlankReviewItem(
                    initialSession.receipt.id,
                    draft.items.length,
                  ),
                ],
              });
              setVisibleItemCount(draft.items.length + 1);
            }}
            style={styles.smallButton}
          >
            <Text style={styles.smallButtonText}>+ Item</Text>
          </Pressable>
        </View>

        {draft.items.length === 0 ? (
          <Text style={styles.emptyText}>No items. Add at least one item before saving.</Text>
        ) : null}

        {draft.items.slice(0, visibleItemCount).map((item, index) => {
          const fieldPath = `items.${item.id}`;
          return (
            <View
              key={item.id}
              onLayout={(event) =>
                registerAnchor(fieldPath, event, 'items')
              }
              style={styles.itemCard}
            >
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>Item {index + 1}</Text>
                <StateBadge state={stateForField(fieldPath, evaluation.validation.issues)} />
              </View>

              <FieldLabel label="Item name" />
              <TextInput
                accessibilityLabel={`Item ${index + 1} name`}
                value={item.rawName}
                onChangeText={(rawName) =>
                  updateItem(draft, item.id, { rawName }, updateDraft)
                }
                placeholder="Item name"
                style={[
                  styles.textInput,
                  hasInputError(evaluation.inputErrors, `${fieldPath}.name`) &&
                    styles.invalidInput,
                ]}
              />

              <View style={styles.threeColumnRow}>
                <View style={styles.flexField}>
                  <FieldLabel label="Qty" />
                  <TextInput
                    accessibilityLabel={`Item ${index + 1} quantity`}
                    value={item.quantityText}
                    onChangeText={(quantityText) =>
                      updateItem(draft, item.id, { quantityText }, updateDraft)
                    }
                    keyboardType="decimal-pad"
                    placeholder="1"
                    style={[
                      styles.textInput,
                      hasInputError(
                        evaluation.inputErrors,
                        `${fieldPath}.quantity`,
                      ) && styles.invalidInput,
                    ]}
                  />
                </View>
                <View style={styles.flexField}>
                  <EditableAmount
                    label="Unit price"
                    value={item.unitPriceText}
                    invalid={hasInputError(
                      evaluation.inputErrors,
                      `${fieldPath}.unitPrice`,
                    )}
                    onChange={(unitPriceText) =>
                      updateItem(draft, item.id, { unitPriceText }, updateDraft)
                    }
                  />
                </View>
                <View style={styles.flexField}>
                  <EditableAmount
                    label="Line total"
                    value={item.lineTotalText}
                    invalid={hasInputError(
                      evaluation.inputErrors,
                      `${fieldPath}.lineTotal`,
                    )}
                    onChange={(lineTotalText) =>
                      updateItem(draft, item.id, { lineTotalText }, updateDraft)
                    }
                  />
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  updateDraft({
                    ...draft,
                    items: draft.items.filter(
                      (candidate) => candidate.id !== item.id,
                    ),
                  })
                }
                style={styles.removeButton}
              >
                <Text style={styles.removeButtonText}>Remove item</Text>
              </Pressable>
            </View>
          );
        })}

        {visibleItemCount < draft.items.length ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setVisibleItemCount((current) =>
                Math.min(draft.items.length, current + ITEM_RENDER_BATCH),
              )
            }
            style={styles.loadMoreButton}
          >
            <Text style={styles.loadMoreButtonText}>
              Show more items · {draft.items.length - visibleItemCount} remaining
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View
        onLayout={(event) => registerAnchor('adjustments', event)}
        style={styles.card}
      >
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <Text style={styles.sectionTitle}>Discounts & charges</Text>
            <Text style={styles.sectionHint}>
              Discounts negative; charges and taxes positive.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              updateDraft({
                ...draft,
                adjustments: [
                  ...draft.adjustments,
                  createBlankAdjustment(
                    initialSession.receipt.id,
                    draft.adjustments.length,
                  ),
                ],
              })
            }
            style={styles.smallButton}
          >
            <Text style={styles.smallButtonText}>+ Adjustment</Text>
          </Pressable>
        </View>

        {draft.adjustments.length === 0 ? (
          <Text style={styles.emptyText}>No discounts or charges reconstructed.</Text>
        ) : null}

        {draft.adjustments.map((adjustment, index) => {
          const fieldPath = `adjustments.${adjustment.id}`;
          return (
            <View
              key={adjustment.id}
              onLayout={(event) =>
                registerAnchor(fieldPath, event, 'adjustments')
              }
              style={styles.itemCard}
            >
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>Adjustment {index + 1}</Text>
                <StateBadge state={stateForField(fieldPath, evaluation.validation.issues)} />
              </View>

              <FieldLabel label="Type" />
              <View style={styles.chipRow}>
                {ADJUSTMENT_KINDS.map((kind) => (
                  <Pressable
                    key={kind}
                    accessibilityRole="button"
                    accessibilityState={{ selected: adjustment.kind === kind }}
                    onPress={() =>
                      updateAdjustment(
                        draft,
                        adjustment.id,
                        { kind },
                        updateDraft,
                      )
                    }
                    style={[
                      styles.chip,
                      adjustment.kind === kind && styles.chipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        adjustment.kind === kind && styles.chipTextSelected,
                      ]}
                    >
                      {capitalize(kind)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <FieldLabel label="Label" />
              <TextInput
                accessibilityLabel={`Adjustment ${index + 1} label`}
                value={adjustment.label}
                onChangeText={(label) =>
                  updateAdjustment(draft, adjustment.id, { label }, updateDraft)
                }
                placeholder="Discount, VAT, service charge…"
                style={styles.textInput}
              />

              <EditableAmount
                label="Amount"
                value={adjustment.amountText}
                invalid={hasInputError(
                  evaluation.inputErrors,
                  `${fieldPath}.amount`,
                )}
                onChange={(amountText) =>
                  updateAdjustment(
                    draft,
                    adjustment.id,
                    { amountText },
                    updateDraft,
                  )
                }
              />

              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  updateDraft({
                    ...draft,
                    adjustments: draft.adjustments.filter(
                      (candidate) => candidate.id !== adjustment.id,
                    ),
                  })
                }
                style={styles.removeButton}
              >
                <Text style={styles.removeButtonText}>Remove adjustment</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowEvidence((current) => !current)}
          style={styles.evidenceHeader}
        >
          <View style={styles.sectionHeaderCopy}>
            <Text style={styles.sectionTitle}>Original evidence</Text>
            <Text style={styles.sectionHint}>
              This source is read-only and is never overwritten by corrections.
            </Text>
          </View>
          <Text style={styles.jumpMark}>{showEvidence ? '⌃' : '⌄'}</Text>
        </Pressable>

        {showEvidence ? (
          <>
            {initialSession.receipt.imageUri ? (
              <Image
                accessibilityLabel="Original retained receipt image"
                source={{ uri: initialSession.receipt.imageUri }}
                resizeMode="contain"
                style={styles.receiptImage}
              />
            ) : (
              <Text style={styles.emptyText}>Original receipt image is unavailable.</Text>
            )}
            <Text style={styles.evidenceLabel}>RAW OCR EVIDENCE</Text>
            <Text selectable style={styles.ocrText}>
              {initialSession.rawOcrText.trim() || 'No OCR text is available.'}
            </Text>
          </>
        ) : null}
      </View>

      {evaluation.validation.state === 'review' ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acknowledgeReview }}
          onPress={() => setAcknowledgeReview((current) => !current)}
          style={styles.ackRow}
        >
          <View
            style={[
              styles.checkbox,
              acknowledgeReview && styles.checkboxChecked,
            ]}
          >
            <Text style={styles.checkboxText}>{acknowledgeReview ? '✓' : ''}</Text>
          </View>
          <Text style={styles.ackText}>
            I checked the remaining warnings against the original receipt and want
            to keep these values.
          </Text>
        </Pressable>
      ) : null}

      {notice ? (
        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={saveDraft}
        disabled={
          busyAction !== null ||
          validationPending ||
          evaluation.inputErrors.length > 0
        }
        style={[
          styles.secondaryButton,
          (busyAction !== null ||
            validationPending ||
            evaluation.inputErrors.length > 0) &&
            styles.disabledButton,
        ]}
      >
        {busyAction === 'draft' ? <ActivityIndicator /> : null}
        <Text style={styles.secondaryButtonText}>
          {busyAction === 'draft' ? 'Saving draft…' : 'Save review draft'}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={acceptReceipt}
        disabled={!canAccept || busyAction !== null}
        style={[
          styles.primaryButton,
          (!canAccept || busyAction !== null) && styles.disabledButton,
        ]}
      >
        {busyAction === 'accept' ? <ActivityIndicator color="#FFFFFF" /> : null}
        <Text style={styles.primaryButtonText}>
          {busyAction === 'accept' ? 'Saving receipt…' : 'Save to purchase history'}
        </Text>
      </Pressable>

      {evaluation.validation.state === 'mismatch' ? (
        <Text style={styles.blockingHint}>
          Resolve every mismatch before this receipt can enter purchase history.
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={discardReceipt}
        disabled={busyAction !== null}
        style={styles.discardButton}
      >
        <Text style={styles.discardButtonText}>
          {busyAction === 'discard' ? 'Discarding…' : 'Discard receipt draft'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function EditableAmount({
  label,
  value,
  invalid = false,
  onChange,
}: {
  label: string;
  value: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <View>
      <FieldLabel label={label} />
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0.00"
        style={[styles.textInput, invalid && styles.invalidInput]}
      />
    </View>
  );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function StatusCard({
  state,
  issueCount,
}: {
  state: ValidationState;
  issueCount: number;
}) {
  const message =
    state === 'verified'
      ? 'Arithmetic and required structured fields currently reconcile.'
      : state === 'review'
        ? `${issueCount} non-blocking warning${issueCount === 1 ? '' : 's'} still need human confirmation.`
        : `${issueCount} issue${issueCount === 1 ? '' : 's'} include at least one blocking mismatch.`;

  return (
    <View style={styles.statusCard}>
      <StateBadge state={state} />
      <Text style={styles.statusMessage}>{message}</Text>
    </View>
  );
}

function StateBadge({ state }: { state: ValidationState }) {
  return (
    <View style={styles.stateBadge}>
      <Text style={styles.stateBadgeIcon}>
        {state === 'verified' ? '✓' : state === 'review' ? '?' : '!'}
      </Text>
      <Text style={styles.stateBadgeText}>
        {state === 'verified'
          ? 'Verified'
          : state === 'review'
            ? 'Review'
            : 'Mismatch'}
      </Text>
    </View>
  );
}

function stateForField(
  fieldPath: string,
  issues: readonly ValidationIssue[],
): ValidationState {
  const related = issues.filter(
    (issue) =>
      issue.fieldPath === fieldPath ||
      issue.fieldPath.startsWith(`${fieldPath}.`),
  );

  if (related.some((issue) => issue.state === 'mismatch')) {
    return 'mismatch';
  }
  if (related.length > 0) {
    return 'review';
  }
  return 'verified';
}

function hasInputError(
  errors: readonly { fieldPath: string }[],
  fieldPath: string,
): boolean {
  return errors.some((error) => error.fieldPath === fieldPath);
}

function updateItem(
  draft: ReviewDraft,
  id: string,
  patch: Partial<ReviewLineItemDraft>,
  update: (next: ReviewDraft) => void,
) {
  update({
    ...draft,
    items: draft.items.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    ),
  });
}

function updateAdjustment(
  draft: ReviewDraft,
  id: string,
  patch: Partial<ReviewAdjustmentDraft>,
  update: (next: ReviewDraft) => void,
) {
  update({
    ...draft,
    adjustments: draft.adjustments.map((adjustment) =>
      adjustment.id === id ? { ...adjustment, ...patch } : adjustment,
    ),
  });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F6F2' },
  content: { padding: 20, paddingBottom: 48 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkButton: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#3F6B5B', fontSize: 14, fontWeight: '800' },
  eyebrow: { color: '#3F6B5B', fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: '#1F2321', fontSize: 28, fontWeight: '800', lineHeight: 34, marginTop: 10 },
  body: { color: '#6F756F', fontSize: 14, lineHeight: 21, marginTop: 8 },
  statusCard: { marginTop: 18, padding: 16, borderRadius: 16, backgroundColor: '#FFFFFF', borderColor: '#E2E1DC', borderWidth: 1, gap: 10 },
  stateBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#EEF3F0' },
  stateBadgeIcon: { color: '#2D5145', fontWeight: '900' },
  stateBadgeText: { color: '#2D5145', fontSize: 12, fontWeight: '900' },
  statusMessage: { color: '#4F5651', fontSize: 13, lineHeight: 19 },
  issueList: { marginTop: 16, borderRadius: 16, backgroundColor: '#FFFFFF', borderColor: '#E2E1DC', borderWidth: 1, padding: 16 },
  issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 52, paddingVertical: 8 },
  issueMismatch: { width: 24, height: 24, lineHeight: 24, textAlign: 'center', borderRadius: 12, backgroundColor: '#F6D7D7', color: '#8E2F2F', fontWeight: '900' },
  issueReview: { width: 24, height: 24, lineHeight: 24, textAlign: 'center', borderRadius: 12, backgroundColor: '#F7E9C8', color: '#6A4A17', fontWeight: '900' },
  issueCopy: { flex: 1 },
  issueState: { color: '#1F2321', fontSize: 12, fontWeight: '900' },
  issueMessage: { color: '#616761', fontSize: 13, lineHeight: 18, marginTop: 2 },
  jumpMark: { color: '#7B817C', fontSize: 24 },
  card: { marginTop: 16, padding: 16, borderRadius: 16, backgroundColor: '#FFFFFF', borderColor: '#E2E1DC', borderWidth: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, justifyContent: 'space-between' },
  sectionHeaderCopy: { flex: 1 },
  sectionTitle: { color: '#1F2321', fontSize: 17, fontWeight: '900' },
  sectionHint: { color: '#757B76', fontSize: 12, lineHeight: 18, marginTop: 3 },
  labelRow: { marginTop: 14, marginBottom: 6 },
  fieldLabel: { color: '#3D423F', fontSize: 12, fontWeight: '800' },
  fieldHint: { color: '#8A908B', fontSize: 10, marginTop: 2 },
  textInput: { minHeight: 46, borderRadius: 11, borderWidth: 1, borderColor: '#CFD3CF', backgroundColor: '#FAFAF8', color: '#1F2321', paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  invalidInput: { borderColor: '#B93D3D' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: '#CCD0CC', backgroundColor: '#FFFFFF' },
  chipSelected: { backgroundColor: '#E6EFEA', borderColor: '#739688' },
  chipText: { color: '#606661', fontSize: 12, fontWeight: '700' },
  chipTextSelected: { color: '#2D5145', fontWeight: '900' },
  moneyRow: { flexDirection: 'row', gap: 10 },
  moneyColumn: { flex: 1 },
  smallButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#E6EFEA' },
  smallButtonText: { color: '#2D5145', fontSize: 12, fontWeight: '900' },
  loadMoreButton: { minHeight: 44, marginTop: 14, borderRadius: 11, borderWidth: 1, borderColor: '#C6CBC7', alignItems: 'center', justifyContent: 'center' },
  loadMoreButtonText: { color: '#2D5145', fontSize: 12, fontWeight: '900' },
  emptyText: { color: '#797F7A', fontSize: 13, lineHeight: 19, marginTop: 12 },
  itemCard: { marginTop: 14, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E4E5E1', backgroundColor: '#FCFCFA' },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { color: '#1F2321', fontSize: 14, fontWeight: '900' },
  threeColumnRow: { flexDirection: 'row', gap: 7 },
  flexField: { flex: 1 },
  removeButton: { alignSelf: 'flex-start', marginTop: 14, paddingVertical: 5 },
  removeButtonText: { color: '#9A3030', fontSize: 12, fontWeight: '800' },
  evidenceHeader: { flexDirection: 'row', alignItems: 'center' },
  receiptImage: { width: '100%', height: 360, marginTop: 16, borderRadius: 12, backgroundColor: '#ECEDE9' },
  evidenceLabel: { color: '#3F6B5B', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginTop: 16 },
  ocrText: { color: '#303431', fontFamily: 'monospace', fontSize: 12, lineHeight: 18, marginTop: 8 },
  ackRow: { marginTop: 18, flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 14, backgroundColor: '#FFF8E8' },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#A0A69F', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#3F6B5B', borderColor: '#3F6B5B' },
  checkboxText: { color: '#FFFFFF', fontWeight: '900' },
  ackText: { flex: 1, color: '#4D514E', fontSize: 13, lineHeight: 19 },
  noticeBox: { marginTop: 14, backgroundColor: '#E6EFEA', borderRadius: 12, padding: 12 },
  noticeText: { color: '#2D5145', fontSize: 12, fontWeight: '700' },
  errorBox: { marginTop: 14, backgroundColor: '#FBECEC', borderRadius: 12, padding: 12 },
  errorTitle: { color: '#9A3030', fontSize: 12, fontWeight: '900', marginBottom: 4 },
  errorText: { color: '#9A3030', fontSize: 12, lineHeight: 18 },
  secondaryButton: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: '#BCC2BD', backgroundColor: '#FFFFFF', marginTop: 18, paddingHorizontal: 18, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#2D5145', fontSize: 14, fontWeight: '900' },
  primaryButton: { minHeight: 54, borderRadius: 14, backgroundColor: '#3F6B5B', marginTop: 10, paddingHorizontal: 18, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  disabledButton: { opacity: 0.45 },
  blockingHint: { color: '#8E2F2F', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 8 },
  discardButton: { alignSelf: 'center', marginTop: 18, padding: 10 },
  discardButtonText: { color: '#9A3030', fontSize: 12, fontWeight: '800' },
});
