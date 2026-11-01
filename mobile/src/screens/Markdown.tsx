import { useMemo, useState, type ReactNode } from 'react'
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle
} from 'react-native'
import { marked, type Token, type Tokens } from 'marked'
import { t } from '@shared/i18n/index'
import { autolinkBareUrls } from '@shared/autolink'
import { BRAND } from '@shared/brand'
import { itemLinkTarget } from '@shared/item-links'
import type { ItemLinkRef } from '@shared/ostler-api'
import { RADIUS, SPACE, type Theme } from '../theme'
import { tableColumnWidth } from './tableLayout'

interface Props {
  theme: Theme
  children: string
  /** Opens an item a link points at (`ostler://task/…`); without it item links show as text. */
  onOpenItem?: (ref: ItemLinkRef) => void
  /** The linked item's current title, or null when it is not on the phone. */
  itemTitle?: (ref: ItemLinkRef) => string | null
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

/** Links that open outside the app: the web's and email addresses. */
function isWebLink(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href)
}

/**
 * A task's description or a comment, rendered from Markdown as the desktop
 * renders it: headings, emphasis, code, quotes, lists, checklists, links and
 * tables. Raw HTML and pictures show as text, so nothing runs or loads.
 */
export function Markdown({ theme, children, onOpenItem, itemTitle }: Props) {
  const tokens = useMemo(
    () => marked.lexer(autolinkBareUrls(children), { gfm: true, breaks: true }),
    [children]
  )
  const base: TextStyle = { color: theme.text, fontSize: 15, lineHeight: 21 }

  const inline = (items: Token[] | undefined, key = ''): ReactNode[] =>
    (items ?? []).map((token, index) => {
      const k = `${key}${index}`
      switch (token.type) {
        case 'strong':
          return (
            <Text key={k} style={styles.strong}>
              {inline((token as Tokens.Strong).tokens, k)}
            </Text>
          )
        case 'em':
          return (
            <Text key={k} style={styles.em}>
              {inline((token as Tokens.Em).tokens, k)}
            </Text>
          )
        case 'del':
          return (
            <Text key={k} style={styles.del}>
              {inline((token as Tokens.Del).tokens, k)}
            </Text>
          )
        case 'codespan':
          return (
            <Text
              key={k}
              style={[styles.code, { backgroundColor: theme.surfaceSunken, color: theme.text }]}
            >
              {decode((token as Tokens.Codespan).text)}
            </Text>
          )
        case 'link': {
          const link = token as Tokens.Link
          const ref = onOpenItem ? itemLinkTarget(link.href, BRAND.urlScheme) : null
          if (ref && onOpenItem) {
            const title = itemTitle?.(ref) ?? null
            // A pasted link's words are its address: show the item's title instead.
            const bare = link.text === link.href || /^\w[\w-]*:\/\//.test(link.text)
            return (
              <Text
                key={k}
                accessibilityRole="link"
                accessibilityHint={t(`mobile:links.open.${ref.kind}`)}
                style={{ color: theme.accent, fontWeight: '600' }}
                onPress={() => onOpenItem(ref)}
              >
                {bare
                  ? (title ?? t(`mobile:links.missing.${ref.kind}`))
                  : inline(link.tokens, k)}
              </Text>
            )
          }
          const web = isWebLink(link.href)
          return (
            <Text
              key={k}
              accessibilityRole={web ? 'link' : undefined}
              style={web ? { color: theme.accent, textDecorationLine: 'underline' } : styles.strong}
              onPress={web ? () => void Linking.openURL(link.href) : undefined}
            >
              {inline(link.tokens, k)}
            </Text>
          )
        }
        case 'image':
          return <Text key={k}>{(token as Tokens.Image).text || '🖼'}</Text>
        case 'br':
          return <Text key={k}>{'\n'}</Text>
        case 'text': {
          const text = token as Tokens.Text
          return text.tokens ? (
            <Text key={k}>{inline(text.tokens, k)}</Text>
          ) : (
            <Text key={k}>{decode(text.text)}</Text>
          )
        }
        default:
          return <Text key={k}>{decode('text' in token ? String(token.text) : token.raw)}</Text>
      }
    })

  const block = (token: Token, key: string): ReactNode => {
    switch (token.type) {
      case 'space':
        return null
      case 'heading': {
        const heading = token as Tokens.Heading
        return (
          <Text
            key={key}
            accessibilityRole="header"
            style={[base, styles.strong, { fontSize: heading.depth <= 2 ? 18 : 16 }]}
          >
            {inline(heading.tokens, key)}
          </Text>
        )
      }
      case 'paragraph':
        return (
          <Text key={key} style={base}>
            {inline((token as Tokens.Paragraph).tokens, key)}
          </Text>
        )
      case 'code':
        return (
          <Text
            key={key}
            style={[
              base,
              styles.code,
              styles.codeBlock,
              { backgroundColor: theme.surfaceSunken, borderColor: theme.border }
            ]}
          >
            {(token as Tokens.Code).text}
          </Text>
        )
      case 'blockquote':
        return (
          <View key={key} style={[styles.quote, { borderColor: theme.borderStrong }]}>
            {(token as Tokens.Blockquote).tokens.map((child, i) => block(child, `${key}.${i}`))}
          </View>
        )
      case 'list': {
        const list = token as Tokens.List
        const start = typeof list.start === 'number' ? list.start : 1
        return (
          <View key={key} style={styles.list}>
            {list.items.map((item, i) => (
              <View key={`${key}.${i}`} style={styles.item}>
                <Text style={[base, styles.bullet, { color: theme.textMuted }]}>
                  {item.task ? (item.checked ? '☑' : '☐') : list.ordered ? `${start + i}.` : '•'}
                </Text>
                <View style={styles.itemBody}>
                  {item.tokens.map((child, j) =>
                    child.type === 'text' ? (
                      <Text key={`${key}.${i}.${j}`} style={base}>
                        {inline((child as Tokens.Text).tokens ?? [child], `${key}.${i}.${j}`)}
                      </Text>
                    ) : (
                      block(child, `${key}.${i}.${j}`)
                    )
                  )}
                </View>
              </View>
            ))}
          </View>
        )
      }
      case 'hr':
        return <View key={key} style={[styles.hr, { backgroundColor: theme.border }]} />
      case 'table': {
        const table = token as Tokens.Table
        const row = (cells: Tokens.TableCell[], k: string) =>
          cells.map((cell, i) => inline(cell.tokens, `${k}.${i}`))
        return (
          <Table
            key={key}
            theme={theme}
            textStyle={base}
            header={row(table.header, `${key}.h`)}
            rows={table.rows.map((cells, i) => row(cells, `${key}.${i}`))}
          />
        )
      }
      default:
        return (
          <Text key={key} style={base}>
            {'text' in token ? String(token.text) : token.raw}
          </Text>
        )
    }
  }

  return <View style={styles.root}>{tokens.map((token, i) => block(token, String(i)))}</View>
}

/** marked escapes `&`, `<`, `>`, quotes in inline text for HTML; Text shows them as they are. */
function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * A table whose columns share its width but keep a few words each
 * (tableColumnWidth); a table too wide for the screen scrolls sideways.
 */
function Table({
  theme,
  textStyle,
  header,
  rows
}: {
  theme: Theme
  textStyle: TextStyle
  header: ReactNode[][]
  rows: ReactNode[][][]
}) {
  const [available, setAvailable] = useState(0)
  const width = tableColumnWidth(
    Math.max(header.length, ...rows.map((cells) => cells.length)),
    available
  )
  const row = (cells: ReactNode[][], isHeader: boolean, key: string) => (
    <View key={key} style={[styles.tableRow, { borderColor: theme.border }]}>
      {cells.map((cell, i) => (
        <Text key={i} style={[textStyle, styles.cell, { width }, isHeader && styles.strong]}>
          {cell}
        </Text>
      ))}
    </View>
  )
  return (
    <View
      onLayout={(event) => setAvailable(Math.floor(event.nativeEvent.layout.width))}
      style={[styles.table, { borderColor: theme.border }]}
    >
      <ScrollView horizontal>
        <View>
          {row(header, true, 'h')}
          {rows.map((cells, i) => row(cells, false, String(i)))}
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: SPACE.small },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  code: { fontFamily: MONO, fontSize: 13 },
  codeBlock: { padding: SPACE.small, borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth },
  quote: { borderLeftWidth: 3, paddingLeft: SPACE.medium, gap: SPACE.small },
  list: { gap: 2 },
  item: { flexDirection: 'row', gap: SPACE.small },
  bullet: { minWidth: 16 },
  itemBody: { flex: 1, gap: 2 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: SPACE.small },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS },
  tableRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  cell: { padding: SPACE.small, fontSize: 13 }
})
