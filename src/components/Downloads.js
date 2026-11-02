import { useState } from 'react'
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { mdiChevronUp, mdiClose, mdiDownload } from '@mdi/js'
import Icon from './Icon'
import { ACCENT } from '../theme'
import { useT } from '../i18n'

function ProgressLine({ pct, theme }) {
  return (
    <View style={[styles.track, { backgroundColor: theme.border }]}>
      <View style={{ height: '100%', width: Math.max(2, pct) + '%', backgroundColor: ACCENT }} />
    </View>
  )
}

// Bottom bar summarising the queue; tap it for the full list.
export default function Downloads({ jobs, theme, bottom, onCancel }) {
  const t = useT()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  if (!jobs.length) return null

  const active = jobs.filter((j) => j.status === 'downloading')
  const waiting = jobs.length - active.length
  const head = active[0] || jobs[0]
  const pct = active.length ? active.reduce((s, j) => s + j.pct, 0) / active.length : 0

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.bar, { bottom, backgroundColor: theme.surface2, shadowColor: theme.shadow }]}
      >
        <View style={styles.barTop}>
          <Icon path={mdiDownload} size={18} color={ACCENT} />
          <Text numberOfLines={1} style={[styles.barTitle, { color: theme.text }]}>
            {head.item.title}
          </Text>
          <Text style={[styles.barPct, { color: theme.text }]}>{Math.floor(pct)}%</Text>
          <Icon path={mdiChevronUp} size={20} color={theme.dim} />
        </View>
        <ProgressLine pct={pct} theme={theme} />
        {jobs.length > 1 ? (
          <Text style={[styles.barSub, { color: theme.dim }]}>
            {t('downloadsActive', { n: active.length })}
            {waiting ? t('downloadsWaiting', { n: waiting }) : ''}
          </Text>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.sheet,
              { backgroundColor: theme.surface, paddingBottom: insets.bottom + 12 }
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: theme.faint }]} />
            <Text style={[styles.h, { color: theme.text }]}>{t('downloads')}</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              {jobs.map((j) => (
                <View key={j.id} style={styles.row}>
                  {j.item.img ? (
                    <Image source={{ uri: j.item.img }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: theme.surface2 }]} />
                  )}
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text numberOfLines={2} style={[styles.rowTitle, { color: theme.text }]}>
                      {j.item.title}
                    </Text>
                    <Text style={[styles.rowSub, { color: theme.dim }]}>
                      {j.label} ·{' '}
                      {j.cancelled
                        ? t('cancelling')
                        : j.status === 'downloading'
                          ? Math.floor(j.pct) + '%'
                          : t('inQueue')}
                    </Text>
                    {j.status === 'downloading' ? <ProgressLine pct={j.pct} theme={theme} /> : null}
                  </View>
                  <Pressable hitSlop={10} onPress={() => onCancel(j.id)} style={styles.cancel}>
                    <Icon path={mdiClose} size={20} color={theme.dim} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 10,
    right: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    zIndex: 90,
    elevation: 10,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }
  },
  barTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  barTitle: { flex: 1, fontSize: 13, fontWeight: '600' },
  barPct: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  barSub: { fontSize: 12, marginTop: 6 },
  track: { height: 5, borderRadius: 5, overflow: 'hidden' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
  h: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  thumb: { width: 96, height: 54, borderRadius: 10, backgroundColor: '#000' },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowSub: { fontSize: 12 },
  cancel: { padding: 4 }
})
