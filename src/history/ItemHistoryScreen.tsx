import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { ItemHistorySummary } from './types';

interface ItemHistoryScreenProps {
  summary: ItemHistorySummary;
  onOpenReceipt: (receiptId: string) => void;
  onBack: () => void;
}

export function ItemHistoryScreen({
  summary,
  onOpenReceipt,
  onBack,
}: ItemHistoryScreenProps) {
  const title =
    summary.identity.normalizedName ||
    summary.identity.rawName ||
    'Item history';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.linkButton}>
          <Text style={styles.linkText}>‹ History</Text>
        </Pressable>
        <Text style={styles.eyebrow}>ITEM HISTORY</Text>
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>
        These entries come only from reviewed and accepted receipts stored on this
        device.
      </Text>

      <View style={styles.summaryRow}>
        <SummaryBox
          label="Purchases"
          value={String(summary.purchaseCount)}
        />
        <SummaryBox
          label="Latest unit price"
          value={formatMoney(
            summary.latestUnitPriceMinor,
            summary.points[0]?.currencyCode ?? 'PHP',
          )}
        />
      </View>

      <View style={styles.rangeCard}>
        <Text style={styles.rangeLabel}>Observed purchase range</Text>
        <Text style={styles.rangeValue}>
          {formatDate(summary.firstPurchasedAt)} → {formatDate(summary.lastPurchasedAt)}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Price and purchase history</Text>
        <Text style={styles.sectionHint}>
          Tap any entry to reopen the source receipt.
        </Text>

        {summary.points.map((point, index) => (
          <Pressable
            key={point.lineItemId}
            accessibilityRole="button"
            onPress={() => onOpenReceipt(point.receiptId)}
            style={styles.historyRow}
          >
            <View style={styles.historyCopy}>
              <Text style={styles.historyTitle}>
                {point.merchantName || 'Unknown merchant'}
              </Text>
              <Text style={styles.historyMeta}>
                {formatDate(point.purchasedAt)} · {formatQuantity(point.quantityMilli)}
              </Text>
              {point.normalizedName && point.rawName !== point.normalizedName ? (
                <Text style={styles.rawName}>Receipt: {point.rawName}</Text>
              ) : null}
            </View>
            <View style={styles.priceCopy}>
              <Text style={styles.price}>
                {formatMoney(
                  point.unitPriceMinor ?? point.lineTotalMinor,
                  point.currencyCode,
                )}
              </Text>
              <Text style={styles.priceLabel}>
                {point.unitPriceMinor !== null ? 'unit price' : 'line total'}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {summary.identity.normalizedName ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Grouped identity</Text>
          <Text style={styles.infoText}>
            Different receipt descriptions are grouped here only because they were
            explicitly assigned to “{summary.identity.normalizedName}”. The original
            descriptions remain attached to each receipt.
          </Text>
        </View>
      ) : (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Raw-description history</Text>
          <Text style={styles.infoText}>
            This history uses an exact case-insensitive receipt description because
            the item has not been assigned an organized identity yet.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
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
  return value ? value.replace('T', ' ').slice(0, 16) : 'Unknown date';
}

function formatQuantity(value: number | null): string {
  if (value === null) {
    return 'quantity not shown';
  }

  const whole = Math.floor(value / 1000);
  const remainder = String(value % 1000).padStart(3, '0').replace(/0+$/, '');
  return 'qty ' + (remainder ? whole + '.' + remainder : String(whole));
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
  summaryRow: { flexDirection: 'row', gap: 9, marginTop: 18 },
  summaryBox: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E1DC',
  },
  summaryLabel: { color: '#777D78', fontSize: 10, fontWeight: '800' },
  summaryValue: {
    color: '#1F2321',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 5,
  },
  rangeCard: {
    marginTop: 10,
    padding: 13,
    borderRadius: 13,
    backgroundColor: '#EEF3F0',
  },
  rangeLabel: { color: '#547064', fontSize: 10, fontWeight: '900' },
  rangeValue: { color: '#2D5145', fontSize: 12, fontWeight: '800', marginTop: 4 },
  section: {
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E1DC',
  },
  sectionTitle: { color: '#1F2321', fontSize: 16, fontWeight: '900' },
  sectionHint: { color: '#757B76', fontSize: 12, lineHeight: 18, marginTop: 3 },
  historyRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#ECEDE9',
  },
  historyCopy: { flex: 1 },
  historyTitle: { color: '#1F2321', fontSize: 13, fontWeight: '900' },
  historyMeta: { color: '#6F756F', fontSize: 11, lineHeight: 16, marginTop: 3 },
  rawName: { color: '#858A86', fontSize: 10, lineHeight: 15, marginTop: 3 },
  priceCopy: { alignItems: 'flex-end' },
  price: { color: '#1F2321', fontSize: 13, fontWeight: '900' },
  priceLabel: { color: '#858A86', fontSize: 9, marginTop: 2 },
  chevron: { color: '#858A86', fontSize: 18, marginTop: 3 },
  infoCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#EEF3F0',
  },
  infoTitle: { color: '#2D5145', fontSize: 12, fontWeight: '900' },
  infoText: { color: '#58605B', fontSize: 11, lineHeight: 17, marginTop: 4 },
});
