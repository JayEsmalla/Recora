import { Image, StyleSheet, View } from 'react-native';

import { colors } from './theme';

interface BrandMarkProps {
  size?: number;
  compact?: boolean;
}

export function BrandMark({
  size = 88,
  compact = false,
}: BrandMarkProps) {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Recora"
      style={[
        styles.wrap,
        compact && styles.compact,
        { width: size, height: size },
      ]}
    >
      <Image
        source={require('../../assets/recora-logo.png')}
        resizeMode="contain"
        style={styles.image}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
