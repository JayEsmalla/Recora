import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { ItemHistorySummary } from './types';
import { colors, radii, shadows, spacing, typography } from '../ui/theme';

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
  const [visiblePointCount, setVisiblePointCount] = useState(
    Math.min(40, summary.points.length),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.linkButton}>
          <Text style={styles.linkText}>‹ History</Text>
        </Pressable>
        <Text style={styles.eyebrow}>ITEM</Text>
      </View>

      <Text style={styles.title}>{title}</Text>

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
        <Text style={styles.rangeLabel}>PURCHASE RANGE</Text>
        <Text style={styles.rangeValue}>
          {formatDate(summary.firstPurchasedAt)} → {formatDate(summary.lastPurchasedAt)}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Price history</Text>
        <Text style={styles.sectionHint}>Tap an entry to open its receipt.</Text>

        {summary.points.slice(0, visiblePointCount).map((point) => (
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
              <Ionicons
                name="chevron-forward"
                size={17}
                color={colors.textMuted}
              />
            </View>
          </Pressable>
        ))}

        {visiblePointCount < summary.points.length ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setVisiblePointCount((current) =>
                Math.min(summary.points.length, current + 40),
              )
            }
            style={styles.loadMoreButton}
          >
            <Text style={styles.loadMoreText}>
              Show more · {summary.points.length - visiblePointCount} remaining
            </Text>
          </Pressable>
        ) : null}
      </View>

      {summary.identity.normalizedName ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Organized item</Text>
          <Text style={styles.infoText}>
            Grouped as “{summary.identity.normalizedName}”. Original receipt names stay unchanged.
          </Text>
        </View>
      ) : (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Receipt-name history</Text>
          <Text style={styles.infoText}>
            Using the exact receipt name until this item is organized.
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
  summaryRow: { flexDirection: 'row', gap: 9, marginTop: 18 },
  summaryBox: {
    flex: 1,
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  summaryLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800' },
  summaryValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    marginTop: 5,
  },
  rangeCard: {
    marginTop: 10,
    padding: 13,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
  },
  rangeLabel: { color: colors.primaryAlt, fontSize: 10, fontWeight: '900' },
  rangeValue: { color: colors.primary, fontSize: 12, fontWeight: '800', marginTop: 4 },
  section: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { color: colors.text, ...typography.section },
  sectionHint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  historyRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#ECEDE9',
  },
  historyCopy: { flex: 1 },
  historyTitle: { color: colors.text, fontSize: 13, fontWeight: '900' },
  historyMeta: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  rawName: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  priceCopy: { alignItems: 'flex-end' },
  price: { color: colors.text, fontSize: 13, fontWeight: '900' },
  priceLabel: { color: colors.textMuted, fontSize: 9, marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: 18, marginTop: 3 },
  loadMoreButton: { minHeight: 44, marginTop: 10, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  loadMoreText: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  infoCard: {
    marginTop: spacing.lg,
    padding: 14,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  infoTitle: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  infoText: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 4 },
});
