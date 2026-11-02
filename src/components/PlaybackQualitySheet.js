import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { mdiCheck } from '@mdi/js'
import Icon from './Icon'
import { ACCENT } from '../theme'
import { useT } from '../i18n'

// "Качество" sheet of the player, like YouTube's: Авто + every height the stream has.
export default function PlaybackQualitySheet({
  visible,
  theme,
  options,
  pref,
  currentHeight,
  onPick,
  onClose
}) {
  const insets = useSafeAreaInsets()
  const t = useT()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, paddingBottom: insets.bottom + 12 }
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.faint }]} />
          <Text style={[styles.h, { color: theme.text }]}>{t('quality')}</Text>
          <Text style={[styles.sub, { color: theme.dim }]}>
            {currentHeight ? t('qualityCurrent', { h: currentHeight }) : t('videoLoading')}
          </Text>
          {options.map((o) => {
            const active = o.value === pref
            return (
              <Pressable
                key={o.value}
                onPress={() => onPick(o.value)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { backgroundColor: theme.surface2 }
                ]}
              >
                <View style={styles.check}>
                  {active ? <Icon path={mdiCheck} size={20} color={ACCENT} /> : null}
                </View>
                <Text
                  style={[
                    styles.label,
                    { color: active ? ACCENT : theme.text },
                    active && styles.bold
                  ]}
                >
                  {o.label}
                </Text>
                {o.hint ? <Text style={[styles.hint, { color: theme.dim }]}>{o.hint}</Text> : null}
                {o.hd ? <Text style={styles.hd}>HD</Text> : null}
              </Pressable>
            )
          })}
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
  sub: { fontSize: 13, paddingHorizontal: 8, marginTop: 2, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderRadius: 12
  },
  check: { width: 22, alignItems: 'center' },
  label: { fontSize: 16 },
  bold: { fontWeight: '700' },
  hint: { fontSize: 13, flex: 1 },
  hd: { marginLeft: 'auto', color: ACCENT, fontSize: 11, fontWeight: '800' }
})
