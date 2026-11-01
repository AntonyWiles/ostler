import { useMemo } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { contactRoleLabel, contactSubtitle, mailtoHref, telHref } from '@shared/contacts'
import type { EditDb } from '../data/edits'
import { taskContacts } from '../data/people'
import type { QueryDb } from '../data/queries'
import { SPACE, type Theme } from '../theme'
import { Chip } from './EditBits'

/**
 * The contacts a task names (the client who asked for it, the supplier), each with a Call and an
 * Email button. Shows nothing when the task names none.
 */
export function TaskContacts({
  db,
  taskId,
  version,
  theme
}: {
  db: EditDb & QueryDb
  taskId: string
  version: number
  theme: Theme
}) {
  const links = useMemo(() => (version >= 0 ? taskContacts(db, taskId) : []), [db, taskId, version])
  if (links.length === 0) return null
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.textSecondary }]}>
        {t('views:contacts.title')}
      </Text>
      {links.map((link) => {
        const phone = link.contact.phones[0]
        const email = link.contact.emails[0]
        const subtitle = [contactRoleLabel(link.role), contactSubtitle(link.contact)]
          .filter(Boolean)
          .join(' · ')
        return (
          <View key={link.id} style={styles.contact}>
            <View style={styles.grow}>
              <Text style={[styles.name, { color: theme.text }]}>{link.contact.name}</Text>
              <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            {phone && (
              <Chip
                label={t('views:contacts.call')}
                theme={theme}
                onPress={() => {
                  const url = telHref(phone.number)
                  if (url) void Linking.openURL(url).catch(() => {})
                }}
              />
            )}
            {email && (
              <Chip
                label={t('views:contacts.sendEmail')}
                theme={theme}
                onPress={() => {
                  const url = mailtoHref(email)
                  if (url) void Linking.openURL(url).catch(() => {})
                }}
              />
            )}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: SPACE.small, marginTop: SPACE.medium },
  heading: { fontSize: 13, fontWeight: '600' },
  contact: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small, minHeight: 48 },
  grow: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 }
})
