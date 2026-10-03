import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
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

interface HistoryScreenProps {
  initialOverview: HistoryOverview;
  onSearch: (
    filters: HistoryFilters,
    mode: HistoryLoadMode,
  ) => Promise<HistoryOverview>;
  onOpenReceipt: (receiptId: string) => void;
  onOpenItem: (item: ItemSearchEntry) => void;
  onBack: () => void;
}

type HistoryMode = 'receipts' | 'items';

export function HistoryScreen({
  initialOverview,
  onSearch,
  onOpenReceipt,
  onOpenItem,
  onBack,
}: HistoryScreenProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [mode, setMode] = useState<HistoryMode>('receipts');
  const [itemsLoaded, setItemsLoaded] = useState(
    initialOverview.items.length > 0,
  );
  const [query, setQuery] = useState('');
  const [merchantQuery, setMerchantQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(
    overrides: Partial<HistoryFilters> = {},
    targetMode: HistoryMode = mode,
  ): Promise<void> {
    if (busy) {
      return;
    }

    const filters: HistoryFilters = {
      query,
      merchantQuery,
      categoryId,
      fromDate: fromDate || null,
      toDate: toDate || null,
      ...overrides,
    };

    setBusy(true);
    setError(null);
    try {
      const next = await onSearch(filters, targetMode);
      setOverview((current) =>
        targetMode === 'receipts'
          ? {
              ...current,
              receipts: next.receipts,
              categories:
                next.categories.length > 0 ? next.categories : current.categories,
            }
          : {
              ...current,
              items: next.items,
              categories:
                next.categories.length > 0 ? next.categories : current.categories,
            },
      );
      if (targetMode === 'items') {
        setItemsLoaded(true);
      }
    } catch (cause) {
      setError(messageFromError(cause, 'Could not search local purchase history.'));
    } finally {
      setBusy(false);
    }
  }

  async function selectCategory(nextCategoryId: string | null) {
    setCategoryId(nextCategoryId);
    await search({ categoryId: nextCategoryId });
  }

  function selectMode(nextMode: HistoryMode) {
    setMode(nextMode);
    if (nextMode === 'items' && !itemsLoaded) {
      void search({}, 'items');
    }
  }

  async function clearFilters() {
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
              categories:
                next.categories.length > 0 ? next.categories : current.categories,
            }
          : {
              ...current,
              items: next.items,
              categories:
                next.categories.length > 0 ? next.categories : current.categories,
            },
      );
      if (mode === 'items') {
        setItemsLoaded(true);
      }
    } catch (cause) {
      setError(messageFromError(cause, 'Could not reset history filters.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.linkButton}>
          <Text style={styles.linkText}>‹ Home</Text>
        </Pressable>
        <Text style={styles.eyebrow}>PURCHASE HISTORY</Text>
      </View>

      <Text style={styles.title}>Receipts & items</Text>
      <Text style={styles.body}>Only reviewed receipts appear in history.</Text>

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
              : 'Search raw or organized item name'
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
            {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={styles.primarySmallText}>Search</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFiltersOpen((current) => !current)}
            style={styles.secondarySmall}
          >
            <Text style={styles.secondarySmallText}>
              {filtersOpen ? 'Hide filters' : 'Filters'}
            </Text>
          </Pressable>
        </View>

        {filtersOpen ? (
          <View style={styles.filters}>
            <Text style={styles.fieldLabel}>Merchant</Text>
            <TextInput
              accessibilityLabel="Merchant filter"
              value={merchantQuery}
              onChangeText={setMerchantQuery}
              placeholder="Merchant name"
              style={styles.textInput}
            />

            <Text style={styles.fieldLabel}>Date range</Text>
            <View style={styles.twoColumn}>
              <TextInput
                accessibilityLabel="Start date"
                value={fromDate}
                onChangeText={setFromDate}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                style={[styles.textInput, styles.flexInput]}
              />
              <TextInput
                accessibilityLabel="End date"
                value={toDate}
                onChangeText={setToDate}
                placeholder="YYYY-MM-DD"
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

      {mode === 'receipts' ? (
        <ReceiptList
          receipts={overview.receipts}
          onOpenReceipt={onOpenReceipt}
        />
      ) : (
        <ItemList items={overview.items} onOpenItem={onOpenItem} />
      )}
    </ScrollView>
  );
}

function ReceiptList({
  receipts,
  onOpenReceipt,
}: {
  receipts: ReceiptHistoryEntry[];
  onOpenReceipt: (receiptId: string) => void;
}) {
  if (receipts.length === 0) {
    return (
      <EmptyState
        title="No matching receipts"
        text="Accepted receipts that match your filters will appear here."
      />
    );
  }

  return (
    <View style={styles.resultSection}>
      <Text style={styles.resultCount}>
        {receipts.length} receipt{receipts.length === 1 ? '' : 's'}
      </Text>
      {receipts.map((receipt) => (
        <Pressable
          key={receipt.receiptId}
          accessibilityRole="button"
          onPress={() => onOpenReceipt(receipt.receiptId)}
          style={styles.resultCard}
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
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function ItemList({
  items,
  onOpenItem,
}: {
  items: ItemSearchEntry[];
  onOpenItem: (item: ItemSearchEntry) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No matching items"
        text="Items from accepted receipts that match your filters will appear here."
      />
    );
  }

  return (
    <View style={styles.resultSection}>
      <Text style={styles.resultCount}>
        {items.length} item purchase{items.length === 1 ? '' : 's'}
      </Text>
      {items.map((item) => (
        <Pressable
          key={item.lineItemId}
          accessibilityRole="button"
          onPress={() => onOpenItem(item)}
          style={styles.resultCard}
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
            <Text style={styles.chevron}>›</Text>
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
      style={[styles.modeButton, selected && styles.modeButtonSelected]}
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
  screen: { flex: 1, backgroundColor: '#F7F6F2' },
  content: { padding: 20, paddingBottom: 48 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkButton: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#3F6B5B', fontSize: 14, fontWeight: '800' },
  eyebrow: {
    color: '#3F6B5B',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  title: {
    color: '#1F2321',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
    marginTop: 10,
  },
  body: {
    color: '#6F756F',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  modeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFD3CF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  modeButtonSelected: {
    backgroundColor: '#3F6B5B',
    borderColor: '#3F6B5B',
  },
  modeText: { color: '#59605B', fontSize: 13, fontWeight: '800' },
  modeTextSelected: { color: '#FFFFFF' },
  searchCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E1DC',
    backgroundColor: '#FFFFFF',
  },
  textInput: {
    minHeight: 46,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#CFD3CF',
    backgroundColor: '#FAFAF8',
    color: '#1F2321',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  searchActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  primarySmall: {
    minHeight: 42,
    borderRadius: 11,
    paddingHorizontal: 14,
    backgroundColor: '#3F6B5B',
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primarySmallText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  secondarySmall: {
    minHeight: 42,
    borderRadius: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#C7CCC8',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondarySmallText: { color: '#2D5145', fontSize: 12, fontWeight: '900' },
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
  flexInput: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CCD0CC',
    backgroundColor: '#FFFFFF',
  },
  chipSelected: { backgroundColor: '#E6EFEA', borderColor: '#739688' },
  chipText: { color: '#606661', fontSize: 11, fontWeight: '700' },
  chipTextSelected: { color: '#2D5145', fontWeight: '900' },
  filterActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  errorBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FBECEC',
  },
  errorText: { color: '#9A3030', fontSize: 12, lineHeight: 18 },
  resultSection: { marginTop: 18, gap: 10 },
  resultCount: { color: '#6F756F', fontSize: 12, fontWeight: '700' },
  resultCard: {
    minHeight: 86,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#E2E1DC',
    backgroundColor: '#FFFFFF',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultCopy: { flex: 1 },
  resultTitle: { color: '#1F2321', fontSize: 15, fontWeight: '900' },
  rawName: { color: '#777D78', fontSize: 11, marginTop: 2 },
  resultMeta: { color: '#6B716C', fontSize: 11, lineHeight: 16, marginTop: 4 },
  categoryLabel: {
    alignSelf: 'flex-start',
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#EEF3F0',
    color: '#3F6B5B',
    fontSize: 10,
    fontWeight: '800',
  },
  resultRight: { alignItems: 'flex-end', gap: 5 },
  money: { color: '#1F2321', fontSize: 14, fontWeight: '900' },
  chevron: { color: '#777D78', fontSize: 22 },
  emptyCard: {
    marginTop: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E1DC',
    backgroundColor: '#FFFFFF',
    padding: 20,
  },
  emptyTitle: { color: '#1F2321', fontSize: 15, fontWeight: '900' },
  emptyText: { color: '#6F756F', fontSize: 13, lineHeight: 19, marginTop: 5 },
});
