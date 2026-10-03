export const colors = {
  background: '#F7F6F3',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF3F0',
  surfaceStrong: '#E2ECE6',
  primary: '#185541',
  primaryAlt: '#2A6750',
  accent: '#5EA57E',
  accentSoft: '#DDEBE3',
  text: '#2D3D40',
  textMuted: '#6D7772',
  border: '#D8DED9',
  borderStrong: '#BCC8C0',
  warning: '#D99A3E',
  warningSoft: '#FFF4E3',
  error: '#C94A4A',
  errorSoft: '#FCEAEA',
  success: '#2F7659',
  successSoft: '#E4F1E9',
  overlay: 'rgba(21, 32, 29, 0.58)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999,
} as const;

export const typography = {
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '800' as const },
  title: { fontSize: 27, lineHeight: 33, fontWeight: '800' as const },
  section: { fontSize: 17, lineHeight: 22, fontWeight: '800' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '800' as const },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '400' as const },
} as const;

export const shadows = {
  card: {
    shadowColor: '#20332C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 2,
  },
} as const;
