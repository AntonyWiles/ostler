import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '@shared/i18n/index'
import { formatIsoDate } from '@shared/dates'
import { formatMoney, type Cost } from '@shared/money'
import { quantityText, type ShoppingItem } from '@shared/shopping'
import type { EditDb } from '../data/edits'
import type { QueryDb } from '../data/queries'
import {
  addShoppingLine,
  buyShoppingItem,
  deleteShoppingItem,
  rebuyShoppingItem,
  restoreShoppingItem,
  shoppingList,
  unbuyShoppingItem
} from '../data/shopping'
import { RADIUS, SPACE, type Theme } from '../theme'
import { editErrorText, TextSender } from './EditBits'

const UNDO_MS = 5000

/**
 * A project's shopping list, made for using in the shop: add one line at a time ("3 packs wall
 * plugs £4.50", read as on the PC), tick an item bought (a paid cost at its estimate, today), and
 * the bought ones fold away. Every change has Undo for a few seconds.
 */
export function ShoppingList({
  db,
  projectId,
  version,
  theme,
  onEdited
}: {
  db: EditDb & QueryDb
  projectId: string
  version: number
  theme: Theme
  onEdited: () => void
}) {
  const [showBought, setShowBought] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ text: string; undo: () => void } | null>(null)
  const list = useMemo(
    () => (version >= 0 ? shoppingList(db, projectId) : null),
    [db, projectId, version]
  )
  useEffect(() => {
    if (done === null) return
    const timer = setTimeout(() => setDone(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [done])
  if (list === null) return null
  const money = (minor: number) => formatMoney(minor, list.currency)
  const toBuy = list.items.filter((item) => item.costId === null)
  const bought = list.items.filter((item) => item.costId !== null)

  const act = (run: () => (() => void) | void, text: string): boolean => {
    let undo: (() => void) | void
    try {
      undo = run()
    } catch (failure) {
      setError(editErrorText(failure))
      return false
    }
    setError(null)
    onEdited()
    if (undo) {
      const back = undo
      setDone({
        text,
        undo: () => {
          try {
            back()
            onEdited()
          } catch (failure) {
            setError(editErrorText(failure))
          }
        }
      })
    }
    return true
  }
  const buy = (item: ShoppingItem) =>
    act(
      () => {
        buyShoppingItem(db, projectId, item.id)
        return () => void unbuyShoppingItem(db, projectId, item.id)
      },
      t('projects:shopping.markBought', { name: item.name })
    )
  const unbuy = (item: ShoppingItem) =>
    act(
      () => {
        const cost: Cost = unbuyShoppingItem(db, projectId, item.id)
        return () => rebuyShoppingItem(db, projectId, item.id, cost)
      },
      t('mobile:shopping.unticked', { name: item.name })
    )
  const remove = (item: ShoppingItem) =>
    act(
      () => {
        const gone = deleteShoppingItem(db, projectId, item.id)
        return () => restoreShoppingItem(db, projectId, gone)
      },
      t('projects:shopping.deleted', { name: item.name })
    )

  return (
    <View style={styles.list}>
      <TextSender
        theme={theme}
        placeholder={t('projects:shopping.addPlaceholder', { price: money(450) })}
        button={t('projects:shopping.add')}
        onSend={(line) => {
          if (!line.trim()) throw new Error('empty')
          let added: ShoppingItem | null = null
          if (
            !act(
              () => {
                added = addShoppingLine(db, projectId, line)
                const id = added.id
                return () => void deleteShoppingItem(db, projectId, id)
              },
              t('projects:shopping.added', { name: line.trim() })
            )
          )
            throw new Error('refused')
        }}
      />
      <Text style={[styles.hint, { color: theme.textMuted }]}>
        {t('projects:shopping.addHint')}
      </Text>
      {error !== null && (
        <Text style={[styles.error, { color: theme.danger, backgroundColor: theme.dangerSubtle }]}>
          {error}
        </Text>
      )}
      {list.items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>
            {t('projects:shopping.noItems')}
          </Text>
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            {t('projects:shopping.noItemsDescription')}
          </Text>
        </View>
      ) : (
        <>
          {toBuy.length === 0 ? (
            <Text style={[styles.hint, { color: theme.success }]}>
              {t('projects:shopping.allBought')}
            </Text>
          ) : (
            list.stillToBuy > 0 && (
              <Text style={[styles.total, { color: theme.textSecondary }]}>
                {t('projects:shopping.stillToBuy', { amount: money(list.stillToBuy) })}
              </Text>
            )
          )}
          {toBuy.map((item) => (
            <Row
              key={item.id}
              item={item}
              theme={theme}
              money={money}
              onTick={() => buy(item)}
              onDelete={() => remove(item)}
            />
          ))}
          {bought.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showBought }}
              onPress={() => setShowBought(!showBought)}
              style={styles.foldHead}
            >
              <Text style={[styles.foldTitle, { color: theme.textSecondary }]}>
                {t('projects:shopping.boughtCount', { count: bought.length })}
              </Text>
              <Text style={[styles.link, { color: theme.accent }]}>
                {showBought ? t('mobile:needsYou.hide') : t('mobile:needsYou.show')}
              </Text>
            </Pressable>
          )}
          {showBought &&
            bought.map((item) => (
              <Row
                key={item.id}
                item={item}
                theme={theme}
                money={money}
                onTick={() => unbuy(item)}
                onDelete={() => remove(item)}
              />
            ))}
        </>
      )}
      {done !== null && (
        <View style={[styles.snack, { backgroundColor: theme.text }]}>
          <Text style={[styles.snackText, { color: theme.surface }]} numberOfLines={2}>
            {done.text}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const { undo } = done
              setDone(null)
              undo()
            }}
            hitSlop={8}
          >
            <Text style={[styles.snackAction, { color: theme.accentSubtle }]}>
              {t('mobile:inbox.undo')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

function Row({
  item,
  theme,
  money,
  onTick,
  onDelete
}: {
  item: ShoppingItem
  theme: Theme
  money: (minor: number) => string
  onTick: () => void
  onDelete: () => void
}) {
  const isBought = item.costId !== null
  const detail = isBought
    ? t('projects:shopping.boughtOn', {
        date: formatIsoDate(item.boughtOn ?? ''),
        price: money(item.pricePaid ?? 0)
      })
    : [
        item.quantity !== 1 || item.unit ? quantityText(item) : null,
        item.estimate !== null ? money(item.estimate) : null,
        item.supplierName
      ]
        .filter(Boolean)
        .join(' · ')
  return (
    <View style={[styles.row, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isBought }}
        accessibilityLabel={t('projects:shopping.markBought', { name: item.name })}
        onPress={onTick}
        hitSlop={SPACE.small}
        style={[
          styles.box,
          {
            borderColor: isBought ? theme.success : theme.borderStrong,
            backgroundColor: isBought ? theme.success : 'transparent'
          }
        ]}
      >
        {isBought && <Text style={[styles.tick, { color: theme.accentContrast }]}>✓</Text>}
      </Pressable>
      <View style={styles.text}>
        <Text
          style={[
            styles.name,
            { color: isBought ? theme.textMuted : theme.text },
            isBought && styles.struck
          ]}
        >
          {item.name}
        </Text>
        {detail !== '' && (
          <Text style={[styles.detail, { color: theme.textMuted }]} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('projects:shopping.deleteNamed', { name: item.name })}
        onPress={onDelete}
        hitSlop={SPACE.small}
        style={styles.remove}
      >
        <Text style={{ color: theme.textMuted, fontSize: 16 }}>✕</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: SPACE.small, paddingHorizontal: SPACE.large, paddingTop: SPACE.medium },
  hint: { fontSize: 13 },
  total: { fontSize: 14, fontWeight: '600' },
  error: { padding: SPACE.small, borderRadius: RADIUS, fontSize: 14 },
  empty: { gap: SPACE.small, paddingVertical: SPACE.medium },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.medium,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingLeft: SPACE.medium,
    minHeight: 56
  },
  box: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tick: { fontSize: 17, fontWeight: '800' },
  text: { flex: 1, paddingVertical: SPACE.small },
  name: { fontSize: 16 },
  struck: { textDecorationLine: 'line-through' },
  detail: { fontSize: 13 },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  foldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
    marginTop: SPACE.small
  },
  foldTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  link: { fontSize: 14, fontWeight: '600' },
  snack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.medium,
    borderRadius: RADIUS,
    paddingHorizontal: SPACE.large,
    minHeight: 48,
    marginTop: SPACE.small
  },
  snackText: { flex: 1, fontSize: 15 },
  snackAction: { fontSize: 15, fontWeight: '700' }
})
