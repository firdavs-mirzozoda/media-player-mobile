import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  mdiContentPaste,
  mdiImageMultiple,
  mdiLink,
  mdiMagnify,
  mdiMusicNote,
  mdiPlayCircleOutline
} from '@mdi/js'
import Icon from './Icon'
import { ACCENT } from '../theme'
import { useT } from '../i18n'

function Action({ icon, label, primary, theme, onPress }) {
  const inner = (
    <>
      <Icon path={icon} size={20} color={primary ? '#fff' : theme.text} />
      <Text numberOfLines={1} style={[styles.actionText, { color: primary ? '#fff' : theme.text }]}>
        {label}
      </Text>
    </>
  )
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.action, { backgroundColor: primary ? ACCENT : theme.surface2 }]}>
        {inner}
      </View>
    </Pressable>
  )
}

// Result of "find the film by a frame": the frame, Yandex's film card (or its
// best guesses), and the song Shazam heard in the clip, if any.
export default function MovieSheet({
  state,
  theme,
  onSearch,
  onClose,
  onLinkChange,
  onSubmitLink,
  onPaste,
  onPickGallery
}) {
  const insets = useSafeAreaInsets()
  const t = useT()
  if (!state) return null
  const { stage, preview, card, tags = [], query, song, error } = state

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: theme.surface, paddingBottom: insets.bottom + 16 }
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.faint }]} />
          <ScrollView>
            <Text style={[styles.h, { color: theme.text }]}>{t('whatFilm')}</Text>
            {preview ? (
              <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" />
            ) : null}

            {stage === 'input' ? (
              <View style={{ gap: 12 }}>
                <Text style={[styles.dim, { color: theme.dim }]}>{t('movieIntro')}</Text>
                <View style={[styles.linkBox, { backgroundColor: theme.surface2 }]}>
                  <Icon path={mdiLink} size={20} color={theme.dim} />
                  <TextInput
                    value={state.link || ''}
                    onChangeText={onLinkChange}
                    onSubmitEditing={onSubmitLink}
                    placeholder="https://www.instagram.com/reel/…"
                    placeholderTextColor={theme.placeholder}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="search"
                    style={[styles.linkInput, { color: theme.text }]}
                  />
                  <Pressable hitSlop={8} onPress={onPaste}>
                    <Icon path={mdiContentPaste} size={20} color={ACCENT} />
                  </Pressable>
                </View>
                <View style={styles.actions}>
                  <Action
                    primary
                    icon={mdiMagnify}
                    label={t('byLink')}
                    theme={theme}
                    onPress={onSubmitLink}
                  />
                  <Action
                    icon={mdiImageMultiple}
                    label={t('fromGallery')}
                    theme={theme}
                    onPress={onPickGallery}
                  />
                </View>
              </View>
            ) : null}

            {stage === 'working' ? (
              <View style={styles.center}>
                <ActivityIndicator color={ACCENT} size="large" />
                <Text style={[styles.dim, { color: theme.dim }]}>
                  {state.link ? t('searchingByLink') : t('searchingByFrame')}
                </Text>
              </View>
            ) : null}

            {stage === 'error' ? (
              <Text style={[styles.dim, { color: theme.dim }]}>
                {t('didntWork', { msg: error })}
              </Text>
            ) : null}

            {stage === 'done' && card ? (
              <View style={{ gap: 6 }}>
                <Text style={[styles.title, { color: theme.text }]}>{card.title}</Text>
                {card.subtitle ? (
                  <Text style={[styles.dim, { color: theme.dim }]}>{card.subtitle}</Text>
                ) : null}
                {card.description ? (
                  <Text numberOfLines={5} style={[styles.desc, { color: theme.text }]}>
                    {card.description}
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  <Action
                    primary
                    icon={mdiMagnify}
                    label={t('find')}
                    theme={theme}
                    onPress={() => onSearch(query)}
                  />
                  <Action
                    icon={mdiPlayCircleOutline}
                    label={t('trailer')}
                    theme={theme}
                    onPress={() => onSearch(t('trailerQuery', { title: card.title }))}
                  />
                </View>
              </View>
            ) : null}

            {stage === 'done' && !card ? (
              <Text style={[styles.dim, { color: theme.dim, marginBottom: 6 }]}>
                {tags.length ? t('looksLike') : t('filmNotFound')}
              </Text>
            ) : null}

            {stage === 'done' && tags.length ? (
              <View style={styles.tags}>
                {(card ? tags.slice(0, 4) : tags.slice(0, 8)).map((tag) => (
                  <Pressable
                    key={tag}
                    onPress={() => onSearch(tag)}
                    style={[styles.tag, { backgroundColor: theme.surface2 }]}
                  >
                    <Text style={{ color: theme.text, fontSize: 13 }}>{tag}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {song ? (
              <Pressable
                onPress={() => onSearch([song.artist, song.title].filter(Boolean).join(' '))}
                style={[styles.song, { backgroundColor: theme.surface2 }]}
              >
                {song.cover ? <Image source={{ uri: song.cover }} style={styles.cover} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dim, { color: theme.dim }]}>{t('songInVideo')}</Text>
                  <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '700' }}>
                    {song.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: theme.dim }}>
                    {song.artist}
                  </Text>
                </View>
                <Icon path={mdiMusicNote} size={22} color={ACCENT} />
              </Pressable>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 8
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
  h: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
  preview: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    backgroundColor: '#000',
    marginBottom: 14
  },
  center: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  title: { fontSize: 22, fontWeight: '800' },
  dim: { fontSize: 13 },
  desc: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 6 },
  action: {
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12
  },
  actionText: { fontSize: 15, fontWeight: '700' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  tag: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  song: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    marginTop: 14
  },
  cover: { width: 48, height: 48, borderRadius: 8 },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 14
  },
  linkInput: { flex: 1, fontSize: 15, paddingVertical: 12 }
})
