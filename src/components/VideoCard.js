import { memo } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { mdiDotsVertical } from '@mdi/js'
import Icon from './Icon'
import { ACCENT } from '../theme'
import { useT } from '../i18n'

// Thumbnail, then the title and "source · duration" under it, ⋮ menu on the right.
function VideoCard({ video, theme, source, current, playing, onPress, onMenu }) {
  const t = useT()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.thumbWrap}>
        {video.img ? (
          <Image source={{ uri: video.img }} style={styles.thumb} resizeMode="cover" />
        ) : null}
        {current ? (
          <View style={styles.nowBadge}>
            <Text style={styles.nowText}>{playing ? t('nowPlaying') : t('paused')}</Text>
          </View>
        ) : null}
        <View style={styles.duration}>
          <Text style={styles.durationText}>{video.durations}</Text>
        </View>
        {current ? <View style={styles.playingLine} /> : null}
      </View>

      <View style={styles.info}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={2} style={[styles.title, { color: theme.text }]}>
            {video.title.trim()}
          </Text>
          <Text numberOfLines={1} style={[styles.meta, { color: theme.dim }]}>
            {source} · {video.durations}
          </Text>
        </View>
        {onMenu ? (
          <Pressable hitSlop={10} onPress={onMenu} style={styles.menuBtn}>
            <Icon path={mdiDotsVertical} size={20} color={theme.dim} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  )
}

export default memo(VideoCard)

const styles = StyleSheet.create({
  card: { flex: 1, marginBottom: 22 },
  thumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000'
  },
  thumb: { width: '100%', height: '100%' },
  nowBadge: {
    position: 'absolute',
    left: 0,
    top: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderBottomRightRadius: 6,
    backgroundColor: ACCENT
  },
  nowText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  duration: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.8)'
  },
  durationText: { color: '#fff', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  playingLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: ACCENT
  },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingTop: 10, paddingLeft: 2 },
  title: { fontSize: 15, fontWeight: '500', lineHeight: 20 },
  meta: { fontSize: 12, marginTop: 4 },
  menuBtn: { paddingTop: 2 }
})
