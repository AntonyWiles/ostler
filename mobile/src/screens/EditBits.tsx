import { useEffect, useRef, useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions
} from 'react-native'
import { t } from '@shared/i18n/index'
import { isRefusal } from '@shared/refusal'
import { EditRefused } from '../data/edits'
import { RADIUS, SPACE, type Theme } from '../theme'

/** The text the person sees for an edit that failed: a refusal says why, anything else is generic. */
export function editErrorText(error: unknown): string {
  if (error instanceof EditRefused) return t(`mobile:edit.refused.${error.reason}`)
  // A desktop service's refusal (time tracking, say) is already written for the person.
  if (isRefusal(error)) return error.message
  return t('mobile:edit.failed')
}

/** A small button; `selected` marks the current choice in a row of choices. */
export function Chip({
  label,
  theme,
  selected,
  onPress
}: {
  label: string
  theme: Theme
  selected?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: selected === true }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.accent : theme.surface,
          borderColor: selected ? theme.accent : theme.borderStrong
        }
      ]}
    >
      <Text style={{ color: selected ? theme.accentContrast : theme.text, fontSize: 15 }}>
        {label}
      </Text>
    </Pressable>
  )
}

/** A text box with a button that sends it; used for a comment and for a new task's title. */
export function TextSender({
  theme,
  placeholder,
  button,
  initial = '',
  multiline,
  autoFocus,
  keyboardType,
  append,
  onSend
}: {
  theme: Theme
  placeholder: string
  button: string
  initial?: string
  multiline?: boolean
  autoFocus?: boolean
  keyboardType?: KeyboardTypeOptions
  /** Text to add to what is typed (a picked link); a new `key` adds it again. */
  append?: { text: string; key: number }
  /** Sends the text; throws to keep what was typed. */
  onSend: (text: string) => void
}) {
  const [text, setText] = useState(initial)
  // A link picked before this box opened is not added again.
  const added = useRef(append?.key)
  useEffect(() => {
    if (!append || added.current === append.key) return
    added.current = append.key
    setText((now) => (now && !/\s$/.test(now) ? `${now} ` : now) + append.text)
  }, [append?.key])
  const send = () => {
    try {
      onSend(text)
      setText(initial)
    } catch {
      // The caller shows why; the text stays so nothing typed is lost.
    }
  }
  return (
    <View style={multiline ? styles.sender : styles.senderRow}>
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        value={text}
        onChangeText={setText}
        multiline={multiline}
        autoFocus={autoFocus}
        keyboardType={keyboardType}
        returnKeyType={multiline ? 'default' : 'done'}
        onSubmitEditing={multiline ? undefined : send}
        style={[
          styles.input,
          multiline ? styles.inputMultiline : styles.inputRow,
          { color: theme.text, borderColor: theme.borderStrong, backgroundColor: theme.surface }
        ]}
      />
      <Chip label={button} theme={theme} selected onPress={send} />
    </View>
  )
}

export const editStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.small },
  error: { padding: SPACE.small, borderRadius: RADIUS, fontSize: 14 }
})

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: SPACE.medium,
    borderWidth: 1,
    borderRadius: RADIUS
  },
  sender: { alignSelf: 'stretch', gap: SPACE.small, alignItems: 'flex-end' },
  senderRow: { flexDirection: 'row', gap: SPACE.small, alignItems: 'center' },
  input: {
    alignSelf: 'stretch',
    minHeight: 44,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.medium,
    fontSize: 15
  },
  // Beside its button the box takes the row's spare width; above it, it sizes to its text.
  inputRow: { flexGrow: 1, flexShrink: 1 },
  inputMultiline: { minHeight: 88, maxHeight: 200, textAlignVertical: 'top' }
})
