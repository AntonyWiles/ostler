import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { BRAND } from '@shared/brand'
import { itemLinkUrl } from '@shared/item-links'
import { linkTargets, type LinkTarget } from '../data/plan'
import type { QueryDb } from '../data/queries'
import { RADIUS, SPACE, type Theme } from '../theme'

/** The Markdown for a link to an item: its title as the words, brackets kept out of them. */
export function itemLinkMarkdown(target: LinkTarget): string {
  const words = target.title.replace(/[[\]]/g, '').trim() || t(`mobile:links.kind.${target.kind}`)
  return `[${words}](${itemLinkUrl(target, BRAND.urlScheme)})`
}

/** Finds a task, milestone or decision of the project to link to, by words of its title. */
export function LinkPicker({
  db,
  theme,
  projectId,
  excludeId,
  onPick
}: {
  db: QueryDb
  theme: Theme
  projectId: string
  excludeId?: string
  onPick: (target: LinkTarget) => void
}) {
  const [filter, setFilter] = useState('')
  const found = useMemo(
    () => linkTargets(db, projectId, filter, excludeId ?? null),
    [db, projectId, filter, excludeId]
  )
  return (
    <View style={[styles.box, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <TextInput
        accessibilityLabel={t('mobile:links.find')}
        placeholder={t('mobile:links.find')}
        placeholderTextColor={theme.textMuted}
        value={filter}
        onChangeText={setFilter}
        autoFocus
        style={[styles.input, { color: theme.text, borderColor: theme.borderStrong }]}
      />
      {found.length === 0 ? (
        <Text style={[styles.none, { color: theme.textMuted }]}>{t('mobile:links.none')}</Text>
      ) : (
        found.map((target) => (
          <Pressable
            key={`${target.kind}:${target.id}`}
            accessibilityRole="button"
            onPress={() => onPick(target)}
            style={({ pressed }) => [
              styles.row,
              { borderColor: theme.border },
              pressed && { backgroundColor: theme.surfaceSunken }
            ]}
          >
            <Text style={[styles.kind, { color: theme.textMuted }]}>
              {t(`mobile:links.kind.${target.kind}`)}
            </Text>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
              {target.title}
            </Text>
          </Pressable>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.small, gap: SPACE.small },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.medium,
    fontSize: 15
  },
  none: { fontSize: 14, padding: SPACE.small },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.small,
    minHeight: 44,
    paddingHorizontal: SPACE.small,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  kind: { fontSize: 12, width: 72 },
  title: { fontSize: 15, flex: 1 }
})
