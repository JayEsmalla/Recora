import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import type {
  HistoryFilters,
  ItemSearchEntry,
  ReceiptHistoryEntry,
} from './types';
import type {
  HistoryLoadMode,
  HistoryOverview,
} from './HistoryService';
import { colors, radii, shadows, spacing, typography } from '../ui/theme';
import { HISTORY_PAGE_SIZE } from './paginateHistory';
import { validateHistoryDateRange } from './validateHistoryDateRange';
import { useAccessibleFade } from '../ui/useAccessibleFade';

interface HistoryScreenProps {
  initialOverview: HistoryOverview;
  initialViewState?: HistoryViewState | null;
  onSaveViewState: (state: HistoryViewState) => void;
  onSearch: (
    filters: HistoryFilters,
    mode: HistoryLoadMode,
  ) => Promise<HistoryOverview>;
  onOpenReceipt: (receiptId: string) => void;
  onOpenItem: (item: ItemSearchEntry) => void;
  onBack: () => void;
}

export type HistoryMode = 'receipts' | 'items';

export interface HistoryViewState {
  overview: HistoryOverview;
  mode: HistoryMode;
  itemsLoaded: boolean;
  query: string;
  merchantQuery: string;
  categoryId: string | null;
  fromDate: string;
  toDate: string;
  filtersOpen: boolean;
  page: number;
  scrollOffset: number;
}

export function HistoryScreen({
  initialOverview,
  initialViewState,
  onSaveViewState,
  onSearch,
  onOpenReceipt,
  onOpenItem,
  onBack,
}: HistoryScreenProps) {
  const { width } = useWindowDimensions();
  const [overview, setOverview] = useState(initialViewState?.overview ?? initialOverview);
  const [mode, setMode] = useState<HistoryMode>(initialViewState?.mode ?? 'receipts');
  const [itemsLoaded, setItemsLoaded] = useState(
    initialViewState?.itemsLoaded ?? initialOverview.items.length > 0,
  );
  const [query, setQuery] = useState(initialViewState?.query ?? '');
  const [merchantQuery, setMerchantQuery] = useState(initialViewState?.merchantQuery ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initialViewState?.categoryId ?? null);
  const [fromDate, setFromDate] = useState(initialViewState?.fromDate ?? '');
  const [toDate, setToDate] = useState(initialViewState?.toDate ?? '');
  const [filtersOpen, setFiltersOpen] = useState(initialViewState?.filtersOpen ?? false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(initialViewState?.page ?? 1);
  const scrollRef = useRef<ScrollView | null>(null);
  const resultsY = useRef(0);
  const scrollOffset = useRef(initialViewState?.scrollOffset ?? 0);
  const initialScrollRestored = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const advancedFiltersActive = Boolean(
    merchantQuery.trim() || categoryId || fromDate.trim() || toDate.trim(),
  );
  const hasFilters = Boolean(query.trim() || advancedFiltersActive);
  const receiptPage = pageFromResults(overview.receipts, overview.receiptTotal, page);
  const itemPage = pageFromResults(overview.items, overview.itemTotal, page);
  const visiblePage = mode === 'receipts' ? receiptPage : itemPage;
  const resultsOpacity = useAccessibleFade(`${mode}:${visiblePage.page}`);

  function saveViewState() {
    onSaveViewState({
      overview, mode, itemsLoaded, query, merchantQuery, categoryId,
      fromDate, toDate, filtersOpen, page, scrollOffset: scrollOffset.current,
    });
  }

  function openReceipt(receiptId: string) {
    saveViewState();
    onOpenReceipt(receiptId);
  }

  function openItem(item: ItemSearchEntry) {
    saveViewState();
    onOpenItem(item);
  }

  async function changePage(nextPage: number) {
    if (await search({}, mode, nextPage)) {
      scrollOffset.current = Math.max(0, resultsY.current - 12);
      scrollRef.current?.scrollTo({
        y: scrollOffset.current,
        animated: false,
      });
    }
  }

  async function search(
    overrides: Partial<HistoryFilters> = {},
    targetMode: HistoryMode = mode,
    targetPage = 1,
  ): Promise<boolean> {
    if (busy) {
      return false;
    }

    const filters: HistoryFilters = {
      query,
      merchantQuery,
      categoryId,
      fromDate: fromDate || null,
      toDate: toDate || null,
      ...overrides,
      limit: HISTORY_PAGE_SIZE,
      offset: (targetPage - 1) * HISTORY_PAGE_SIZE,
    };

    const dateError = validateHistoryDateRange(filters.fromDate, filters.toDate);
    if (dateError) {
      setError(dateError);
      setFiltersOpen(true);
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      const next = await onSearch(filters, targetMode);
      setOverview((current) =>
        targetMode === 'receipts'
          ? {
              ...current,
              receipts: next.receipts,
              receiptTotal: next.receiptTotal,
              categories:
                next.categories.length > 0 ? next.categories : current.categories,
            }
          : {
              ...current,
              items: next.items,
              itemTotal: next.itemTotal,
              categories:
                next.categories.length > 0 ? next.categories : current.categories,
            },
      );
      if (targetMode === 'items') {
        setItemsLoaded(true);
      }
      setPage(targetPage);
      return true;
    } catch (cause) {
      setError(messageFromError(cause, 'Could not search local purchase history.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function selectCategory(nextCategoryId: string | null) {
    if (busy) return;
    setCategoryId(nextCategoryId);
    await search({ categoryId: nextCategoryId });
  }

  function selectMode(nextMode: HistoryMode) {
    if (busy || nextMode === mode) {
      return;
    }
    setMode(nextMode);
    setPage(1);
    void search({}, nextMode, 1);
  }

  async function clearFilters() {
    if (busy) return;
    setQuery('');
    setMerchantQuery('');
    setCategoryId(null);
    setFromDate('');
    setToDate('');
    setBusy(true);
    setError(null);
    try {
      const next = await onSearch({}, mode);
      setOverview((current) =>
        mode === 'receipts'
          ? {
              ...current,
              receipts: next.receipts,
              receiptTotal: next.receiptTotal,
              categories:
                next.categories.length > 0 ? next.categories : current.categories,
            }
          : {
              ...current,
              items: next.items,
              itemTotal: next.itemTotal,
              categories:
                next.categories.length > 0 ? next.categories : current.categories,
            },
      );
      if (mode === 'items') {
        setItemsLoaded(true);
      }
      setPage(1);
    } catch (cause) {
      setError(messageFromError(cause, 'Could not reset history filters.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
      scrollEventThrottle={32}
      onContentSizeChange={() => {
        if (!initialScrollRestored.current && initialViewState?.scrollOffset) {
          initialScrollRestored.current = true;
          scrollRef.current?.scrollTo({ y: initialViewState.scrollOffset, animated: false });
        }
      }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" onPress={() => { saveViewState(); onBack(); }} style={styles.linkButton}>
          <Text style={styles.linkText}>‹ Home</Text>
        </Pressable>
        <Text style={styles.eyebrow}>HISTORY</Text>
      </View>

      <Text style={styles.title}>Purchase history</Text>
      <Text style={styles.body}>
        Look up past receipts, what you bought, and how prices changed.
      </Text>

      <View style={styles.modeRow}>
        <ModeButton
          label="Receipts"
          selected={mode === 'receipts'}
          onPress={() => selectMode('receipts')}
        />
        <ModeButton
          label="Items"
          selected={mode === 'items'}
          onPress={() => selectMode('items')}
        />
      </View>

      <View style={styles.searchCard}>
        <TextInput
          accessibilityLabel="Search purchase history"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => search()}
          returnKeyType="search"
          placeholder={
            mode === 'receipts'
              ? 'Search merchant or item'
              : 'Search an item name'
          }
          style={styles.textInput}
        />
        <View style={styles.searchActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => search()}
            disabled={busy}
            style={styles.primarySmall}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Ionicons name="search" size={17} color="#FFFFFF" />
            )}
            <Text style={styles.primarySmallText}>Search</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersOpen }}
            onPress={() => setFiltersOpen((current) => !current)}
            style={styles.secondarySmall}
          >
            <Ionicons
              name="options-outline"
              size={17}
              color={colors.primary}
            />
            <Text style={styles.secondarySmallText}>
              {filtersOpen
                ? 'Hide filters'
                : advancedFiltersActive
                  ? 'Filters · On'
                  : 'Filters'}
            </Text>
          </Pressable>
        </View>

        {filtersOpen ? (
          <View style={styles.filters}>
            <Text style={styles.fieldLabel}>Store name</Text>
            <TextInput
              accessibilityLabel="Merchant filter"
              value={merchantQuery}
              onChangeText={setMerchantQuery}
              placeholder="Merchant name"
              style={styles.textInput}
            />

            <Text style={styles.fieldLabel}>Purchase dates</Text>
            <Text style={styles.filterHint}>Enter dates as YYYY-MM-DD, for example 2026-10-03.</Text>
            <View style={styles.chipRow}>
              <FilterChip
                label="Any date"
                selected={!fromDate && !toDate}
                onPress={() => { setFromDate(''); setToDate(''); }}
              />
              <FilterChip
                label="This month"
                selected={fromDate === currentMonthStart() && toDate === currentMonthEnd()}
                onPress={() => {
                  setFromDate(currentMonthStart());
                  setToDate(currentMonthEnd());
                }}
              />
            </View>
            <View style={[styles.twoColumn, width < 390 && styles.stackedInputs]}>
              <TextInput
                accessibilityLabel="Start date"
                value={fromDate}
                onChangeText={setFromDate}
                placeholder="From: YYYY-MM-DD"
                autoCapitalize="none"
                style={[styles.textInput, styles.flexInput]}
              />
              <TextInput
                accessibilityLabel="End date"
                value={toDate}
                onChangeText={setToDate}
                placeholder="To: YYYY-MM-DD"
                autoCapitalize="none"
                style={[styles.textInput, styles.flexInput]}
              />
            </View>

            <Text style={styles.fieldLabel}>Category</Text>
            <View style={styles.chipRow}>
              <FilterChip
                label="All"
                selected={categoryId === null}
                onPress={() => selectCategory(null)}
              />
              {overview.categories.map((category) => (
                <FilterChip
                  key={category.id}
                  label={category.name}
                  selected={categoryId === category.id}
                  onPress={() => selectCategory(category.id)}
                />
              ))}
            </View>

            <View style={styles.filterActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => search()}
                disabled={busy}
                style={styles.primarySmall}
              >
                <Text style={styles.primarySmallText}>Apply filters</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={clearFilters}
                disabled={busy}
                style={styles.secondarySmall}
              >
                <Text style={styles.secondarySmallText}>Clear</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Animated.View style={{ opacity: resultsOpacity }} onLayout={(event) => { resultsY.current = event.nativeEvent.layout.y; }}>
        {mode === 'receipts' ? (
          <ReceiptList
            receipts={receiptPage.entries}
            total={receiptPage.total}
            hasFilters={hasFilters}
            onOpenReceipt={openReceipt}
          />
        ) : (
          <ItemList
            items={itemPage.entries}
            total={itemPage.total}
            hasFilters={hasFilters}
            onOpenItem={openItem}
          />
        )}
        {visiblePage.pageCount > 1 ? (
          <View style={styles.pagination}>
            <Text style={styles.paginationSummary} accessibilityLiveRegion="polite">
              Showing {visiblePage.start}–{visiblePage.end} of {visiblePage.total}
            </Text>
            <View style={styles.paginationActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous page"
                accessibilityState={{ disabled: visiblePage.page === 1 }}
                disabled={busy || visiblePage.page === 1}
                onPress={() => { void changePage(visiblePage.page - 1); }}
                style={[styles.pageButton, visiblePage.page === 1 && styles.pageButtonDisabled]}
              >
                <Ionicons name="chevron-back" size={16} color={colors.primary} />
                <Text style={styles.pageButtonText}>Previous</Text>
              </Pressable>
              <Text style={styles.pageNumber}>
                {visiblePage.page} / {visiblePage.pageCount}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next page"
                accessibilityState={{ disabled: visiblePage.page === visiblePage.pageCount }}
                disabled={busy || visiblePage.page === visiblePage.pageCount}
                onPress={() => { void changePage(visiblePage.page + 1); }}
                style={[styles.pageButton, visiblePage.page === visiblePage.pageCount && styles.pageButtonDisabled]}
              >
                <Text style={styles.pageButtonText}>Next</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </Pressable>
            </View>
          </View>
        ) : null}
      </Animated.View>
    </ScrollView>
  );
}

function ReceiptList({
  receipts,
  total,
  hasFilters,
  onOpenReceipt,
}: {
  receipts: ReceiptHistoryEntry[];
  total: number;
  hasFilters: boolean;
  onOpenReceipt: (receiptId: string) => void;
}) {
  if (receipts.length === 0) {
    return (
      <EmptyState
        title={hasFilters ? 'No matching receipts' : 'No receipts yet'}
        text={
          hasFilters
            ? 'Try a different search or clear a filter.'
            : 'Scan and save a receipt to start your purchase history.'
        }
      />
    );
  }

  return (
    <View style={styles.resultSection}>
      <Text style={styles.resultCount}>
        {total} receipt{total === 1 ? '' : 's'}
      </Text>
      {receipts.map((receipt) => (
        <Pressable
          key={receipt.receiptId}
          accessibilityRole="button"
          onPress={() => onOpenReceipt(receipt.receiptId)}
          style={({ pressed }) => [styles.resultCard, pressed && styles.pressedCard]}
        >
          <View style={styles.resultCopy}>
            <Text style={styles.resultTitle}>
              {receipt.merchantName || 'Unknown merchant'}
            </Text>
            <Text style={styles.resultMeta}>
              {formatDate(receipt.purchasedAt)} · {receipt.itemCount} item
              {receipt.itemCount === 1 ? '' : 's'}
            </Text>
            <Text style={styles.resultMeta}>
              {capitalize(receipt.transactionType)} · {capitalize(receipt.validationState)}
            </Text>
          </View>
          <View style={styles.resultRight}>
            <Text style={styles.money}>
              {formatMoney(receipt.totalMinor, receipt.currencyCode)}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textMuted}
            />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function ItemList({
  items,
  total,
  hasFilters,
  onOpenItem,
}: {
  items: ItemSearchEntry[];
  total: number;
  hasFilters: boolean;
  onOpenItem: (item: ItemSearchEntry) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title={hasFilters ? 'No matching items' : 'No item history yet'}
        text={
          hasFilters
            ? 'Try another item name or clear a filter.'
            : 'Reviewed receipt items will appear here after you save a receipt.'
        }
      />
    );
  }

  return (
    <View style={styles.resultSection}>
      <Text style={styles.resultCount}>
        {total} item purchase{total === 1 ? '' : 's'}
      </Text>
      {items.map((item) => (
        <Pressable
          key={item.lineItemId}
          accessibilityRole="button"
          onPress={() => onOpenItem(item)}
          style={({ pressed }) => [styles.resultCard, pressed && styles.pressedCard]}
        >
          <View style={styles.resultCopy}>
            <Text style={styles.resultTitle}>
              {item.normalizedName || item.rawName}
            </Text>
            {item.normalizedName ? (
              <Text style={styles.rawName}>Receipt: {item.rawName}</Text>
            ) : null}
            <Text style={styles.resultMeta}>
              {item.merchantName || 'Unknown merchant'} · {formatDate(item.purchasedAt)}
            </Text>
            {item.categoryName ? (
              <Text style={styles.categoryLabel}>{item.categoryName}</Text>
            ) : null}
          </View>
          <View style={styles.resultRight}>
            <Text style={styles.money}>
              {formatMoney(
                item.unitPriceMinor ?? item.lineTotalMinor,
                item.currencyCode,
              )}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textMuted}
            />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function ModeButton({
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
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.modeButton, selected && styles.modeButtonSelected, pressed && styles.pressedCard]}
    >
      <Text style={[styles.modeText, selected && styles.modeTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function FilterChip({
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

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function pageFromResults<T>(entries: T[], total: number, requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const page = Math.max(1, Math.min(pageCount, requestedPage));
  return {
    entries, total, page, pageCount,
    start: total === 0 ? 0 : (page - 1) * HISTORY_PAGE_SIZE + 1,
    end: Math.min(total, (page - 1) * HISTORY_PAGE_SIZE + entries.length),
  };
}

function currentMonthStart(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function currentMonthEnd(now = new Date()): string {
  const finalDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
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

function formatDate(value: string | null): string {
  if (!value) {
    return 'Date unavailable';
  }
  return value.replace('T', ' ').slice(0, 16);
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
    paddingBottom: 48,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
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
  body: {
    color: colors.textMuted,
    ...typography.body,
    marginTop: spacing.sm,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  modeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  modeButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modeText: { color: colors.textMuted, fontSize: 13, fontWeight: '800' },
  modeTextSelected: { color: '#FFFFFF' },
  searchCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  textInput: {
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
    color: colors.text,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 14,
  },
  searchActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  primarySmall: {
    minHeight: 44,
    borderRadius: 11,
    paddingHorizontal: 14,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySmallText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  secondarySmall: {
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondarySmallText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  filters: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#ECEDE9',
  },
  fieldLabel: {
    color: '#424743',
    fontSize: 11,
    fontWeight: '900',
    marginTop: 10,
    marginBottom: 5,
  },
  twoColumn: { flexDirection: 'row', gap: 8 },
  stackedInputs: { flexDirection: 'column' },
  flexInput: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CCD0CC',
    backgroundColor: '#FFFFFF',
  },
  chipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  chipTextSelected: { color: colors.primary, fontWeight: '900' },
  filterActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  errorBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.errorSoft,
  },
  errorText: { color: colors.error, fontSize: 12, lineHeight: 18 },
  filterHint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: spacing.sm },
  resultSection: { marginTop: spacing.lg, gap: spacing.sm },
  pressedCard: { opacity: 0.78 },
  pagination: { marginTop: spacing.lg, gap: spacing.sm, alignItems: 'center' },
  paginationSummary: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  paginationActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  pageButton: { minHeight: 46, minWidth: 104, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, borderRadius: radii.md, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center' },
  pageButtonDisabled: { opacity: 0.45 },
  pageButtonText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  pageNumber: { color: colors.text, fontSize: 13, fontWeight: '800' },
  resultCount: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  resultCard: {
    minHeight: 86,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.card,
  },
  resultCopy: { flex: 1 },
  resultTitle: { color: colors.text, fontSize: 15, fontWeight: '900', flexShrink: 1 },
  rawName: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  resultMeta: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 16,
    marginTop: 4,
  },
  categoryLabel: {
    alignSelf: 'flex-start',
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
  },
  resultRight: { alignItems: 'flex-end', gap: 5, maxWidth: '45%' },
  money: { color: colors.text, fontSize: 14, fontWeight: '900' },
  chevron: { color: colors.textMuted, fontSize: 22 },
  emptyCard: {
    marginTop: 20,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 20,
  },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
});
