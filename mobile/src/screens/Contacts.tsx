import { useMemo, useState } from 'react'
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { t } from '@shared/i18n/index'
import {
  contactRoleLabel,
  contactSubtitle,
  mailtoHref,
  telHref,
  websiteHref,
  type Contact
} from '@shared/contacts'
import type { EditDb } from '../data/edits'
import { addContact, contactTasks, contacts, deleteContact } from '../data/people'
import type { QueryDb } from '../data/queries'
import { RADIUS, SPACE, statusColor, useTheme, type Theme } from '../theme'
import { Chip, editErrorText } from './EditBits'
import { TopBar } from './TopBar'

interface Props {
  db: EditDb & QueryDb
  version: number
  onBack: () => void
  onOpenTask: (taskId: string) => void
  onEdited: () => void
}

/**
 * Contacts (the PC's, N6.5): the clients, suppliers and others the projects involve. Search, add
 * one with a phone and email, and open one to call, email or visit its website, or to see the tasks
 * that name it.
 */
export function Contacts({ db, version, onBack, onOpenTask, onEdited }: Props) {
  const theme = useTheme()
  const [words, setWords] = useState('')
  const [opened, setOpened] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = useMemo(() => (version >= 0 ? contacts(db, words) : []), [db, words, version])
  const open = (url: string | null) => {
    if (url === null) return
    Linking.openURL(url).catch(() => setError(t('views:contacts.couldNotOpen')))
  }
  const remove = (item: Contact) =>
    Alert.alert(
      t('views:contacts.deleteTitle', { name: item.name }),
      t('views:contacts.deleteBody'),
      [
        { text: t('views:contacts.cancel'), style: 'cancel' },
        {
          text: t('mobile:status.delete'),
          style: 'destructive',
          onPress: () => {
            try {
              deleteContact(db, item.id)
              setError(null)
              setOpened(null)
              onEdited()
            } catch (failure) {
              setError(editErrorText(failure))
            }
          }
        }
      ]
    )

  return (
    <View style={styles.page}>
      <TopBar
        theme={theme}
        title={t('views:contacts.title')}
        onBack={onBack}
        actions={[
          { icon: 'plus', label: t('views:contacts.new'), onPress: () => setAdding(!adding) }
        ]}
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {adding && (
          <NewContact
            theme={theme}
            onCancel={() => setAdding(false)}
            onSave={(input) => {
              try {
                const made = addContact(db, input)
                setError(null)
                setAdding(false)
                setOpened(made.id)
                onEdited()
                return true
              } catch (failure) {
                setError(editErrorText(failure))
                return false
              }
            }}
          />
        )}
        <TextInput
          accessibilityLabel={t('views:contacts.search')}
          placeholder={t('views:contacts.search')}
          placeholderTextColor={theme.textMuted}
          value={words}
          onChangeText={setWords}
          style={[styles.input, { color: theme.text, borderColor: theme.borderStrong }]}
        />
        {error !== null && (
          <Text
            style={[styles.error, { color: theme.danger, backgroundColor: theme.dangerSubtle }]}
          >
            {error}
          </Text>
        )}
        {list.length === 0 && (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {words.trim() ? t('views:contacts.noMatches') : t('views:contacts.emptyTitle')}
            </Text>
            {!words.trim() && (
              <Text style={[styles.meta, { color: theme.textMuted }]}>
                {t('views:contacts.emptyBody')}
              </Text>
            )}
          </View>
        )}
        {list.map((item) => {
          const isOpen = opened === item.id
          const subtitle = contactSubtitle(item)
          return (
            <View
              key={item.id}
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                onPress={() => setOpened(isOpen ? null : item.id)}
              >
                <Text style={[styles.name, { color: theme.text }]}>{item.name}</Text>
                {subtitle !== '' && (
                  <Text style={[styles.meta, { color: theme.textMuted }]}>{subtitle}</Text>
                )}
              </Pressable>
              {(item.phones.length > 0 || item.emails.length > 0 || item.website !== '') && (
                <View style={styles.row}>
                  {item.phones.map((phone) => (
                    <Chip
                      key={phone.number}
                      label={`${t('views:contacts.call')} ${phone.label || phone.number}`}
                      theme={theme}
                      onPress={() => open(telHref(phone.number))}
                    />
                  ))}
                  {item.emails.map((email) => (
                    <Chip
                      key={email}
                      label={t('views:contacts.sendEmail')}
                      theme={theme}
                      onPress={() => open(mailtoHref(email))}
                    />
                  ))}
                  {item.website !== '' && (
                    <Chip
                      label={t('views:contacts.openWebsite')}
                      theme={theme}
                      onPress={() => open(websiteHref(item.website))}
                    />
                  )}
                </View>
              )}
              {isOpen && (
                <ContactDetail
                  item={item}
                  theme={theme}
                  tasks={contactTasks(db, item.id)}
                  onOpenTask={onOpenTask}
                  onDelete={() => remove(item)}
                />
              )}
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

function ContactDetail({
  item,
  theme,
  tasks,
  onOpenTask,
  onDelete
}: {
  item: Contact
  theme: Theme
  tasks: ReturnType<typeof contactTasks>
  onOpenTask: (taskId: string) => void
  onDelete: () => void
}) {
  const line = (label: string, value: string) =>
    value.trim() === '' ? null : (
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{label}</Text>
        <Text selectable style={[styles.fieldValue, { color: theme.text }]}>
          {value}
        </Text>
      </View>
    )
  return (
    <View style={styles.detail}>
      {line(
        t('views:contacts.phones'),
        item.phones
          .map((phone) => [phone.label, phone.number].filter(Boolean).join(': '))
          .join('\n')
      )}
      {line(t('views:contacts.emails'), item.emails.join('\n'))}
      {line(t('views:contacts.website'), item.website)}
      {line(t('views:contacts.address'), item.address)}
      {line(t('views:contacts.notes'), item.notes)}
      <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
        {t('views:contacts.tasks')}
      </Text>
      {tasks.length === 0 && (
        <Text style={[styles.meta, { color: theme.textMuted }]}>{t('views:contacts.noTasks')}</Text>
      )}
      {tasks.map((task) => (
        <Pressable
          key={task.linkId}
          accessibilityRole="button"
          onPress={() => onOpenTask(task.workItemId)}
          style={styles.task}
        >
          <View style={[styles.status, { backgroundColor: statusColor(theme, task.status) }]} />
          <Text
            style={[
              styles.taskTitle,
              { color: task.closed ? theme.textMuted : theme.text },
              task.closed && styles.struck
            ]}
            numberOfLines={1}
          >
            {task.title}
          </Text>
          <Text style={[styles.meta, { color: theme.textMuted }]}>
            {contactRoleLabel(task.role)}
          </Text>
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" onPress={onDelete} style={styles.deleteButton}>
        <Text style={[styles.deleteText, { color: theme.danger }]}>
          {t('views:contacts.delete')}
        </Text>
      </Pressable>
    </View>
  )
}

function NewContact({
  theme,
  onSave,
  onCancel
}: {
  theme: Theme
  onSave: (input: {
    name: string
    organisation: string
    phones: { label: string; number: string }[]
    emails: string[]
  }) => boolean
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [organisation, setOrganisation] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const field = (
    label: string,
    value: string,
    set: (text: string) => void,
    keyboardType?: 'phone-pad' | 'email-address'
  ) => (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={theme.textMuted}
      value={value}
      onChangeText={set}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
      style={[styles.input, { color: theme.text, borderColor: theme.borderStrong }]}
    />
  )
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
      <Text style={[styles.name, { color: theme.text }]}>{t('views:contacts.newHeading')}</Text>
      {field(t('views:contacts.name'), name, setName)}
      {field(t('views:contacts.organisation'), organisation, setOrganisation)}
      {field(t('views:contacts.phones'), phone, setPhone, 'phone-pad')}
      {field(t('views:contacts.emails'), email, setEmail, 'email-address')}
      <View style={styles.row}>
        <Chip
          label={t('views:contacts.create')}
          theme={theme}
          selected
          onPress={() => {
            if (!name.trim()) return
            onSave({
              name,
              organisation,
              phones: phone.trim() ? [{ label: '', number: phone.trim() }] : [],
              emails: email.trim() ? [email.trim()] : []
            })
          }}
        />
        <Chip label={t('views:contacts.cancel')} theme={theme} onPress={onCancel} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { padding: SPACE.large, gap: SPACE.medium, paddingBottom: 48 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.medium,
    fontSize: 15
  },
  error: { padding: SPACE.small, borderRadius: RADIUS, fontSize: 14 },
  empty: { gap: SPACE.small },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: RADIUS, padding: SPACE.medium, gap: SPACE.small },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  detail: { gap: SPACE.small, marginTop: SPACE.small },
  field: { gap: 2 },
  fieldLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  fieldValue: { fontSize: 15 },
  task: { flexDirection: 'row', alignItems: 'center', gap: SPACE.small, minHeight: 40 },
  status: { width: 4, height: 20, borderRadius: 2 },
  taskTitle: { flex: 1, fontSize: 15 },
  struck: { textDecorationLine: 'line-through' },
  deleteButton: { alignSelf: 'flex-start', paddingVertical: SPACE.small },
  deleteText: { fontSize: 14, fontWeight: '600' }
})
