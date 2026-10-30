import { StyleSheet } from 'react-native'
import { RADIUS, SPACE, type Theme } from '../theme'

function make(theme: Theme) {
  return StyleSheet.create({
    container: { padding: SPACE.large, gap: SPACE.medium },
    heading: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textSecondary,
      marginTop: SPACE.small
    },
    block: { gap: SPACE.small },
    row: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small },
    line: { fontSize: 15, color: theme.text },
    muted: { fontSize: 13, color: theme.textMuted },
    link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    linkText: { fontSize: 15, color: theme.accent, fontWeight: '600' },
    input: {
      minHeight: 96,
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      color: theme.text,
      borderRadius: RADIUS,
      padding: SPACE.medium,
      fontSize: 15,
      textAlignVertical: 'top'
    },
    button: {
      alignSelf: 'flex-start',
      minHeight: 44,
      justifyContent: 'center',
      backgroundColor: theme.accent,
      borderRadius: RADIUS,
      paddingHorizontal: SPACE.large
    },
    secondaryButton: {
      alignSelf: 'flex-start',
      minHeight: 44,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.borderStrong,
      backgroundColor: theme.surface,
      borderRadius: RADIUS,
      paddingHorizontal: SPACE.large
    },
    disabled: { opacity: 0.5 },
    buttonText: { color: theme.accentContrast, fontSize: 15, fontWeight: '600' },
    secondaryButtonText: { color: theme.text, fontSize: 15, fontWeight: '600' },
    card: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderRadius: RADIUS,
      padding: SPACE.medium,
      gap: SPACE.small / 2
    },
    code: { fontSize: 40, fontWeight: '700', letterSpacing: 6, color: theme.text },
    cardTitle: { fontSize: 16, fontWeight: '600', color: theme.text },
    good: {
      fontSize: 15,
      color: theme.success,
      backgroundColor: theme.successSubtle,
      borderRadius: RADIUS,
      padding: SPACE.medium
    },
    bad: {
      fontSize: 15,
      color: theme.danger,
      backgroundColor: theme.dangerSubtle,
      borderRadius: RADIUS,
      padding: SPACE.medium
    }
  })
}

const cache = new Map<Theme, ReturnType<typeof make>>()

/** The styles Settings, Join and Pairing share, in the given theme's colours. */
export function formStyles(theme: Theme): ReturnType<typeof make> {
  let styles = cache.get(theme)
  if (styles === undefined) {
    styles = make(theme)
    cache.set(theme, styles)
  }
  return styles
}
