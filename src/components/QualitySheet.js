import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { mdiChevronRight, mdiFilmstrip, mdiMusicNote } from '@mdi/js'
import Icon from './Icon'
import { ACCENT, qualityLabel } from '../theme'
import { useT } from '../i18n'

const HINTS = {
  1080: () => 'Full HD',
  720: () => 'HD',
  480: (t) => t('q480'),
  360: (t) => t('q360'),
  audio: (t) => t('qAudioHint'),
  orig: (t) => t('qOrigHint')
}

// Bottom sheet for choosing what to download (like YouTube's own picker).
export default function QualitySheet({ target, theme, onPick, onClose }) {
  const t = useT()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, paddingBottom: insets.bottom + 12 }
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.faint }]} />
          <Text style={[styles.h, { color: theme.text }]}>{t('download')}</Text>
          <Text numberOfLines={2} style={[styles.sub, { color: theme.dim }]}>
            {target?.item.title}
          </Text>
          {(target?.qualities || []).map((q) => (
            <Pressable
              key={q}
              onPress={() => onPick(q)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surface2 }]}
            >
              <View style={[styles.rowIcon, { backgroundColor: theme.surface2 }]}>
                <Icon path={q === 'audio' ? mdiMusicNote : mdiFilmstrip} size={20} color={ACCENT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>{qualityLabel(q)}</Text>
                {HINTS[q] ? (
                  <Text style={[styles.rowHint, { color: theme.dim }]}>{HINTS[q](t)}</Text>
                ) : null}
              </View>
              <Icon path={mdiChevronRight} size={22} color={theme.faint} />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 12,
    paddingTop: 8
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
  h: { fontSize: 20, fontWeight: '700', paddingHorizontal: 8 },
  sub: { fontSize: 13, paddingHorizontal: 8, marginTop: 4, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderRadius: 14 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowHint: { fontSize: 12, marginTop: 1 }
})
