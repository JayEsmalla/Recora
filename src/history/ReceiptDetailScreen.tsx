import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type {
  CategoryOption,
  HistoryLineItem,
  NormalizedItemOption,
  ReceiptHistoryDetail,
} from './types';
import { colors, radii, shadows, spacing, typography } from '../ui/theme';

interface ReceiptDetailScreenProps {
  initialDetail: ReceiptHistoryDetail;
  categories: CategoryOption[];
  normalizedItems: NormalizedItemOption[];
  onAssignIdentity: (input: {
    lineItemId: string;
    canonicalName: string;
    categoryId: string | null;
    rememberForMerchant: boolean;
  }) => Promise<ReceiptHistoryDetail>;
  onUnlinkIdentity: (lineItemId: string) => Promise<ReceiptHistoryDetail>;
  onResetRules: () => Promise<number>;
  onDelete: () => Promise<void>;
  onOpenItemHistory: (item: HistoryLineItem) => void;
  onBack: () => void;
}

export function ReceiptDetailScreen({
  initialDetail,
  categories,
  normalizedItems,
  onAssignIdentity,
  onUnlinkIdentity,
  onResetRules,
  onDelete,
  onOpenItemHistory,
  onBack,
}: ReceiptDetailScreenProps) {
  const [detail, setDetail] = useState(initialDetail);
  const [visibleItemCount, setVisibleItemCount] = useState(
    Math.min(30, initialDetail.items.length),
  );
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [canonicalName, setCanonicalName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [rememberForMerchant, setRememberForMerchant] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [busy, setBusy] = useState<
    'normalize' | 'unlink' | 'rules' | 'delete' | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editingItem = detail.items.find(
    (item) => item.lineItemId === editingItemId,
  );

  const suggestions = useMemo(() => {
    const query = canonicalName.trim().toUpperCase();
    if (!query) {
      return normalizedItems.slice(0, 5);
    }

    return normalizedItems
      .filter((item) => item.canonicalName.toUpperCase().includes(query))
      .slice(0, 5);
  }, [canonicalName, normalizedItems]);

  function startOrganizing(item: HistoryLineItem) {
    setEditingItemId(item.lineItemId);
    setCanonicalName(item.normalizedName || item.rawName);
    setCategoryId(item.categoryId);
    setRememberForMerchant(false);
    setNotice(null);
    setError(null);
  }

  async function saveIdentity() {
    if (!editingItem || busy) {
      return;
    }

    if (!canonicalName.trim()) {
      setError('Enter an organized item name before saving.');
      return;
    }

    setBusy('normalize');
    setError(null);
    try {
      const refreshed = await onAssignIdentity({
        lineItemId: editingItem.lineItemId,
        canonicalName: canonicalName.trim(),
        categoryId,
        rememberForMerchant,
      });
      setDetail(refreshed);
      setEditingItemId(null);
      setNotice(
        rememberForMerchant
          ? 'Item organized. Exact matches at this merchant will reuse this name.'
          : 'Item organized.',
      );
    } catch (cause) {
      setError(messageFromError(cause, 'Could not organize this item.'));
    } finally {
      setBusy(null);
    }
  }

  async function unlinkIdentity(item: HistoryLineItem) {
    if (busy) {
      return;
    }

    setBusy('unlink');
    setError(null);
    try {
      const refreshed = await onUnlinkIdentity(item.lineItemId);
      setDetail(refreshed);
      setNotice('Organized name removed. Receipt text was kept.');
      if (editingItemId === item.lineItemId) {
        setEditingItemId(null);
      }
    } catch (cause) {
      setError(messageFromError(cause, 'Could not unlink this item identity.'));
    } finally {
      setBusy(null);
    }
  }

  async function resetRules() {
    if (busy) {
      return;
    }

    setBusy('rules');
    setError(null);
    try {
      const removed = await onResetRules();
      setNotice(
        removed === 0
          ? 'No remembered matches for this merchant.'
          : 'Removed ' +
              removed +
              ' remembered match' +
              (removed === 1 ? '' : 'es') +
              ' for this merchant.',
      );
    } catch (cause) {
      setError(messageFromError(cause, 'Could not reset merchant learning rules.'));
    } finally {
      setBusy(null);
    }
  }

  function requestDeleteReceipt() {
    if (busy) {
      return;
    }

    Alert.alert(
      'Delete this receipt?',
      'This removes the saved receipt, its item history contribution, OCR evidence, and retained image from this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete receipt',
          style: 'destructive',
          onPress: () => {
            void deleteReceipt();
          },
        },
      ],
    );
  }

  async function deleteReceipt() {
    if (busy) {
      return;
    }

    setBusy('delete');
    setError(null);
    try {
      await onDelete();
    } catch (cause) {
      setError(messageFromError(cause, 'Could not delete this receipt.'));
      setBusy(null);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.linkButton}>
          <Text style={styles.linkText}>‹ History</Text>
        </Pressable>
        <Text style={styles.eyebrow}>RECEIPT</Text>
      </View>

      <Text style={styles.title}>{detail.merchantName || 'Unknown merchant'}</Text>
      <Text style={styles.date}>{formatDate(detail.purchasedAt)}</Text>

      <View style={styles.totalCard}>
        <View style={styles.totalCopy}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>
            {formatMoney(detail.totalMinor, detail.currencyCode)}
          </Text>
        </View>
        <View
          style={[
            styles.statusPill,
            detail.validationState === 'verified'
              ? styles.statusVerified
              : detail.validationState === 'review'
                ? styles.statusReview
                : styles.statusMismatch,
          ]}
        >
          <Text style={styles.statusPillText}>
            {capitalize(detail.validationState)}
          </Text>
        </View>
      </View>

      <View style={styles.summaryCard}>
        <SummaryValue
          label="Subtotal"
          value={formatMoney(detail.subtotalMinor, detail.currencyCode)}
        />
        <SummaryValue
          label="Type"
          value={capitalize(detail.transactionType)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items</Text>

        {detail.items.slice(0, visibleItemCount).map((item) => (
          <View key={item.lineItemId} style={styles.itemCard}>
            <View style={styles.itemHeader}>
              <View style={styles.itemCopy}>
                <Text style={styles.itemTitle}>
                  {item.normalizedName || item.rawName}
                </Text>
                {item.normalizedName ? (
                  <Text style={styles.rawName}>Receipt: {item.rawName}</Text>
                ) : null}
                <Text style={styles.itemMeta}>
                  {formatQuantity(item.quantityMilli)}
                  {item.unitPriceMinor !== null
                    ? ' · unit ' +
                      formatMoney(item.unitPriceMinor, detail.currencyCode)
                    : ''}
                </Text>
                {item.categoryName ? (
                  <Text style={styles.categoryTag}>{item.categoryName}</Text>
                ) : null}
              </View>
              <Text style={styles.lineMoney}>
                {formatMoney(item.lineTotalMinor, detail.currencyCode)}
              </Text>
            </View>

            <View style={styles.itemActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpenItemHistory(item)}
                style={styles.textButton}
              >
                <Text style={styles.textButtonText}>Price history</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => startOrganizing(item)}
                style={styles.textButton}
              >
                <Text style={styles.textButtonText}>
                  {item.normalizedItemId ? 'Reassign identity' : 'Organize item'}
                </Text>
              </Pressable>
              {item.normalizedItemId ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => unlinkIdentity(item)}
                  disabled={busy !== null}
                  style={styles.textButton}
                >
                  <Text style={styles.removeText}>Unlink</Text>
                </Pressable>
              ) : null}
            </View>

            {editingItemId === item.lineItemId ? (
              <View style={styles.organizeCard}>
                <Text style={styles.organizeTitle}>Organize item</Text>
                <Text style={styles.organizeHint}>
                  Group equivalent purchases under one stable name. Receipt text stays unchanged.
                </Text>

                <TextInput
                  accessibilityLabel="Organized item name"
                  value={canonicalName}
                  onChangeText={setCanonicalName}
                  placeholder="Example: Fresh Milk 1 Liter"
                  style={styles.textInput}
                />

                {suggestions.length > 0 ? (
                  <View style={styles.suggestions}>
                    <Text style={styles.fieldLabel}>Existing identities</Text>
                    <View style={styles.chipRow}>
                      {suggestions.map((option) => (
                        <Pressable
                          key={option.id}
                          accessibilityRole="button"
                          onPress={() => {
                            setCanonicalName(option.canonicalName);
                            setCategoryId(option.categoryId);
                          }}
                          style={styles.chip}
                        >
                          <Text style={styles.chipText}>{option.canonicalName}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}

                <Text style={styles.fieldLabel}>Category</Text>
                <View style={styles.chipRow}>
                  <ChoiceChip
                    label="Uncategorized"
                    selected={categoryId === null}
                    onPress={() => setCategoryId(null)}
                  />
                  {categories.map((category) => (
                    <ChoiceChip
                      key={category.id}
                      label={category.name}
                      selected={categoryId === category.id}
                      onPress={() => setCategoryId(category.id)}
                    />
                  ))}
                </View>

                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: rememberForMerchant }}
                  onPress={() =>
                    setRememberForMerchant((current) => !current)
                  }
                  style={styles.rememberRow}
                >
                  <View
                    style={[
                      styles.checkbox,
                      rememberForMerchant && styles.checkboxChecked,
                    ]}
                  >
                    <Text style={styles.checkboxText}>
                      {rememberForMerchant ? '✓' : ''}
                    </Text>
                  </View>
                  <Text style={styles.rememberText}>
                    Remember this exact receipt item name for{' '}
                    {detail.merchantName || 'this merchant'}.
                  </Text>
                </Pressable>
                <Text style={styles.learningHint}>
                  Exact text match for this merchant only; similar names are not guessed.
                </Text>

                <View style={styles.organizeActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={saveIdentity}
                    disabled={busy !== null}
                    style={styles.primarySmall}
                  >
                    {busy === 'normalize' ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : null}
                    <Text style={styles.primarySmallText}>Save identity</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setEditingItemId(null)}
                    style={styles.secondarySmall}
                  >
                    <Text style={styles.secondarySmallText}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ))}

        {visibleItemCount < detail.items.length ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setVisibleItemCount((current) =>
                Math.min(detail.items.length, current + 30),
              )
            }
            style={styles.secondaryWide}
          >
            <Text style={styles.secondaryWideText}>
              Show more items · {detail.items.length - visibleItemCount} remaining
            </Text>
          </Pressable>
        ) : null}
      </View>

      {detail.adjustments.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Discounts & charges</Text>
          {detail.adjustments.map((adjustment) => (
            <View key={adjustment.id} style={styles.adjustmentRow}>
              <View>
                <Text style={styles.adjustmentLabel}>{adjustment.label}</Text>
                <Text style={styles.itemMeta}>{capitalize(adjustment.kind)}</Text>
              </View>
              <Text style={styles.lineMoney}>
                {formatMoney(adjustment.amountMinor, detail.currencyCode)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowEvidence((current) => !current)}
          style={styles.evidenceHeader}
        >
          <View style={styles.itemCopy}>
            <Text style={styles.sectionTitle}>Source receipt</Text>
            <Text style={styles.sectionHint}>Read-only original evidence</Text>
          </View>
          <Ionicons
            name={showEvidence ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textMuted}
          />
        </Pressable>

        {showEvidence ? (
          <>
            {detail.imageUri ? (
              <Image
                accessibilityLabel="Original receipt image"
                source={{ uri: detail.imageUri }}
                resizeMode="contain"
                style={styles.receiptImage}
              />
            ) : (
              <Text style={styles.emptyText}>Receipt image is unavailable.</Text>
            )}
            <Text style={styles.ocrLabel}>RAW OCR EVIDENCE</Text>
            <Text selectable style={styles.ocrText}>
              {detail.rawOcrText?.trim() || 'No OCR text is available.'}
            </Text>
          </>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Local corrections</Text>
        <Text style={styles.sectionHint}>
          Reset exact item-name matches remembered for this merchant.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={resetRules}
          disabled={busy !== null}
          style={styles.secondaryWide}
        >
          <Text style={styles.secondaryWideText}>
            {busy === 'rules' ? 'Resetting…' : 'Reset remembered matches'}
          </Text>
        </Pressable>
      </View>

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
        onPress={requestDeleteReceipt}
        disabled={busy !== null}
        style={styles.deleteButton}
      >
        <Text style={styles.deleteText}>
          {busy === 'delete' ? 'Deleting receipt…' : 'Delete receipt'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryValue}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryText}>{value}</Text>
    </View>
  );
}

function formatMoney(value: number | null, currencyCode: string): string {
  if (value === null) {
    return '—';
  }

  const symbol = currencyCode === 'PHP' ? '₱' : currencyCode + ' ';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return (
    sign +
    symbol +
    Math.floor(absolute / 100).toLocaleString('en-US') +
    '.' +
    String(absolute % 100).padStart(2, '0')
  );
}

function formatQuantity(value: number | null): string {
  if (value === null) {
    return 'Quantity not shown';
  }

  const whole = Math.floor(value / 1000);
  const remainder = String(value % 1000).padStart(3, '0').replace(/0+$/, '');
  return 'Qty ' + (remainder ? whole + '.' + remainder : String(whole));
}

function formatDate(value: string | null): string {
  return value ? value.replace('T', ' ').slice(0, 16) : 'Date unavailable';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 54,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkButton: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  eyebrow: {
    color: colors.primaryAlt,
    ...typography.label,
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    ...typography.title,
    marginTop: spacing.sm,
  },
  date: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  totalCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadows.card,
  },
  totalCopy: { flex: 1 },
  totalLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  totalValue: {
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    marginTop: 4,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  statusVerified: { backgroundColor: 'rgba(255,255,255,0.18)' },
  statusReview: { backgroundColor: 'rgba(217,154,62,0.5)' },
  statusMismatch: { backgroundColor: 'rgba(201,74,74,0.58)' },
  statusPillText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  summaryCard: { marginTop: spacing.sm, flexDirection: 'row', gap: spacing.sm },
  summaryValue: {
    flex: 1,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
  summaryText: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 4 },
  section: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { color: colors.text, ...typography.section },
  sectionHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  itemCard: {
    marginTop: 12,
    padding: 13,
    borderRadius: radii.md,
    backgroundColor: '#FBFCFA',
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  itemCopy: { flex: 1 },
  itemTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  rawName: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  itemMeta: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  categoryTag: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
  },
  lineMoney: { color: colors.text, fontSize: 13, fontWeight: '900' },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  textButton: { paddingVertical: 5 },
  textButtonText: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  removeText: { color: colors.error, fontSize: 11, fontWeight: '900' },
  organizeCard: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E3E5E1' },
  organizeTitle: { color: colors.text, fontSize: 13, fontWeight: '900' },
  organizeHint: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
    marginBottom: 9,
  },
  textInput: {
    minHeight: 46,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
    paddingHorizontal: 11,
    color: colors.text,
    fontSize: 13,
  },
  suggestions: { marginTop: 8 },
  fieldLabel: { color: '#454A46', fontSize: 10, fontWeight: '900', marginTop: 10, marginBottom: 5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 9, borderRadius: 999, borderWidth: 1, borderColor: '#CCD0CC', backgroundColor: '#FFFFFF' },
  chipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: { color: colors.textMuted, fontSize: 10, fontWeight: '700' },
  chipTextSelected: { color: colors.primary, fontWeight: '900' },
  rememberRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#A0A69F', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxText: { color: '#FFFFFF', fontWeight: '900' },
  rememberText: { flex: 1, color: '#474C48', fontSize: 11, lineHeight: 17 },
  learningHint: { color: '#818681', fontSize: 10, lineHeight: 15, marginTop: 5, marginLeft: 31 },
  organizeActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  primarySmall: {
    minHeight: 40,
    borderRadius: radii.sm,
    paddingHorizontal: 13,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySmallText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  secondarySmall: {
    minHeight: 40,
    borderRadius: radii.sm,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
  },
  secondarySmallText: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  adjustmentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ECEDE9' },
  adjustmentLabel: { color: colors.text, fontSize: 13, fontWeight: '800' },
  evidenceHeader: { flexDirection: 'row', alignItems: 'center' },
  chevron: { color: colors.textMuted, fontSize: 22 },
  receiptImage: { width: '100%', height: 360, marginTop: 14, borderRadius: 12, backgroundColor: '#ECEDE9' },
  ocrLabel: {
    color: colors.primaryAlt,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 14,
  },
  ocrText: { color: '#303431', fontFamily: 'monospace', fontSize: 11, lineHeight: 17, marginTop: 7 },
  emptyText: { color: '#777D78', fontSize: 12, marginTop: 10 },
  secondaryWide: {
    minHeight: 46,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    marginTop: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryWideText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  noticeBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.successSoft,
  },
  noticeText: { color: colors.success, fontSize: 12, lineHeight: 18 },
  errorBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: radii.md,
    backgroundColor: colors.errorSoft,
  },
  errorText: { color: colors.error, fontSize: 12, lineHeight: 18 },
  deleteButton: { alignSelf: 'center', marginTop: 20, padding: 10 },
  deleteText: { color: colors.error, fontSize: 12, fontWeight: '900' },
});
