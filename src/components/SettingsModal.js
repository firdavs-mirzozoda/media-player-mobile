import { useState } from 'react'
import {
  Alert,
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
import { mdiClose, mdiPencil, mdiPlus, mdiTrashCan } from '@mdi/js'
import Icon from './Icon'
import { BUILTIN_IDS, searchSite, siteKind } from '../api/sites'
import { slugify } from '../utils'
import { ACCENT } from '../theme'
import { LANGS, useT } from '../i18n'

const BUILT_IN_SEARCH = ['youtube', 'vk']

function blankSite() {
  return {
    id: '',
    name: '',
    homeUrl: '',
    token: '',
    search: {
      mode: 'api',
      apiUrl: '',
      resultsPath: 'results',
      map: { id: '', idTemplate: '', title: '', img: '', duration: '' }
    }
  }
}

// Merge onto a blank so every form field is defined even for old configs.
function toForm(site) {
  const base = blankSite()
  const src = JSON.parse(JSON.stringify(site))
  return {
    ...base,
    ...src,
    search: {
      ...base.search,
      ...src.search,
      map: { ...base.search.map, ...(src.search && src.search.map) }
    }
  }
}

function Field({ label, value, onChange, placeholder, theme, secure }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.dim }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        style={[styles.input, { color: theme.text, borderColor: theme.border }]}
      />
    </View>
  )
}

export default function SettingsModal({
  visible,
  onClose,
  theme,
  sites,
  userSites,
  setUserSites,
  setActiveSiteId,
  query,
  lang,
  onLangChange
}) {
  const t = useT()
  const insets = useSafeAreaInsets()
  const [editing, setEditing] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const close = () => {
    setEditing(null)
    setTestResult(null)
    onClose()
  }

  const canRemove = (s) => !BUILTIN_IDS.includes(s.id) || userSites.some((u) => u.id === s.id)

  const set = (path, v) =>
    setEditing((d) => {
      const next = JSON.parse(JSON.stringify(d))
      const keys = path.split('.')
      let o = next
      for (const k of keys.slice(0, -1)) o = o[k]
      o[keys[keys.length - 1]] = v
      return next
    })

  const save = () => {
    const d = JSON.parse(JSON.stringify(editing))
    if (!d.name.trim()) return Alert.alert(t('fillName'))
    if (!BUILT_IN_SEARCH.includes(siteKind(d))) {
      const m = d.search.map || {}
      if (
        !d.search.apiUrl.includes('{q}') ||
        (!(m.id || '').trim() && !(m.idTemplate || '').trim())
      ) {
        return Alert.alert(t('apiNeeds'))
      }
    }
    if (!d.id) d.id = slugify(d.name)
    delete d.builtin
    const idx = userSites.findIndex((s) => s.id === d.id)
    const next = [...userSites]
    if (idx >= 0) next.splice(idx, 1, d)
    else next.push(d)
    setUserSites(next)
    setActiveSiteId(d.id)
    setEditing(null)
    setTestResult(null)
  }

  const remove = (site) => {
    const isBuiltin = BUILTIN_IDS.includes(site.id)
    Alert.alert(
      isBuiltin ? t('resetSite', { name: site.name }) : t('deleteSite', { name: site.name }),
      '',
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: isBuiltin ? t('reset') : t('delete'),
          style: 'destructive',
          onPress: () => setUserSites(userSites.filter((s) => s.id !== site.id))
        }
      ]
    )
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await searchSite(editing, query.trim() || 'test')
      setTestResult({ count: res.videos.length, sample: res.videos.slice(0, 3) })
    } catch (err) {
      setTestResult({ error: String(err?.message || err) })
    } finally {
      setTesting(false)
    }
  }

  // YouTube and VK are searched through their own built-in clients — nothing to configure
  const isBuiltInSearch = editing && BUILT_IN_SEARCH.includes(siteKind(editing))

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => (editing ? setEditing(null) : close())}
    >
      <View style={[styles.sheet, { backgroundColor: theme.surface, paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Text style={[styles.h2, { color: theme.text }]}>
            {editing ? editing.name || t('newSite') : t('sources')}
          </Text>
          <Pressable hitSlop={10} onPress={close}>
            <Icon path={mdiClose} color={theme.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {!editing ? (
            <>
              <Text style={[styles.legend, styles.langTitle, { color: theme.dim }]}>
                {t('language')}
              </Text>
              <View style={styles.langRow}>
                {LANGS.map((l) => {
                  const active = l.id === lang
                  return (
                    <Pressable
                      key={l.id}
                      onPress={() => onLangChange(l.id)}
                      style={[
                        styles.langBtn,
                        { borderColor: active ? theme.text : theme.border },
                        active && { backgroundColor: theme.text }
                      ]}
                    >
                      <Text style={{ color: active ? theme.bg : theme.text, fontWeight: '600' }}>
                        {l.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              <Text style={[styles.legend, styles.langTitle, { color: theme.dim }]}>
                {t('sources')}
              </Text>
              {sites.map((s) => (
                <View key={s.id} style={[styles.siteRow, { borderColor: theme.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.siteName, { color: theme.text }]}>
                      {s.name}
                      {BUILTIN_IDS.includes(s.id) ? (
                        <Text style={{ color: theme.dim, fontWeight: '400' }}>{t('builtin')}</Text>
                      ) : null}
                    </Text>
                    <Text style={{ color: theme.dim, fontSize: 12 }}>{s.homeUrl}</Text>
                  </View>
                  <Pressable
                    hitSlop={8}
                    style={styles.iconBtn}
                    onPress={() => (setEditing(toForm(s)), setTestResult(null))}
                  >
                    <Icon path={mdiPencil} size={20} color={theme.text} />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    style={[styles.iconBtn, !canRemove(s) && { opacity: 0.3 }]}
                    disabled={!canRemove(s)}
                    onPress={() => remove(s)}
                  >
                    <Icon path={mdiTrashCan} size={20} color={theme.text} />
                  </Pressable>
                </View>
              ))}
              <Pressable
                style={[styles.btn, styles.primary]}
                onPress={() => (setEditing(blankSite()), setTestResult(null))}
              >
                <Icon path={mdiPlus} size={18} />
                <Text style={styles.primaryText}>{t('addSite')}</Text>
              </Pressable>
              <Text style={[styles.hint, { color: theme.dim }]}>{t('sitesHint')}</Text>
            </>
          ) : (
            <View style={{ gap: 12 }}>
              <Field
                theme={theme}
                label={t('fieldName')}
                value={editing.name}
                onChange={(v) => set('name', v)}
                placeholder="Rutube"
              />
              <Field
                theme={theme}
                label={t('fieldSiteUrl')}
                value={editing.homeUrl}
                onChange={(v) => set('homeUrl', v)}
                placeholder="https://rutube.ru"
              />

              {isBuiltInSearch ? (
                <Text style={[styles.hint, { color: theme.dim }]}>
                  {t('builtinSearch', { name: editing.name })}
                </Text>
              ) : (
                <>
                  <Field
                    theme={theme}
                    label={t('fieldToken')}
                    value={editing.token}
                    onChange={(v) => set('token', v)}
                    placeholder="vk1.a.…"
                    secure
                  />
                  <View style={[styles.fieldset, { borderColor: theme.border }]}>
                    <Text style={[styles.legend, { color: theme.dim }]}>{t('apiFields')}</Text>
                    <Field
                      theme={theme}
                      label={t('fieldApiUrl')}
                      value={editing.search.apiUrl}
                      onChange={(v) => set('search.apiUrl', v)}
                      placeholder="https://site/api/search?q={q}"
                    />
                    <Field
                      theme={theme}
                      label={t('fieldResultsPath')}
                      value={editing.search.resultsPath}
                      onChange={(v) => set('search.resultsPath', v)}
                      placeholder={t('resultsPathPh')}
                    />
                    <Field
                      theme={theme}
                      label={t('fieldId')}
                      value={editing.search.map.id}
                      onChange={(v) => set('search.map.id', v)}
                      placeholder="video_url"
                    />
                    <Field
                      theme={theme}
                      label={t('fieldIdTemplate')}
                      value={editing.search.map.idTemplate}
                      onChange={(v) => set('search.map.idTemplate', v)}
                      placeholder="https://site/video{owner_id}_{id}"
                    />
                    <Field
                      theme={theme}
                      label={t('fieldTitle')}
                      value={editing.search.map.title}
                      onChange={(v) => set('search.map.title', v)}
                      placeholder="title"
                    />
                    <Field
                      theme={theme}
                      label={t('fieldThumb')}
                      value={editing.search.map.img}
                      onChange={(v) => set('search.map.img', v)}
                      placeholder={t('thumbPh')}
                    />
                    <Field
                      theme={theme}
                      label={t('fieldDuration')}
                      value={editing.search.map.duration}
                      onChange={(v) => set('search.map.duration', v)}
                      placeholder={t('durationPh')}
                    />
                  </View>
                </>
              )}

              {testResult ? (
                <View style={[styles.testBox, { borderColor: theme.border }]}>
                  {testResult.error ? (
                    <Text style={{ color: '#d33' }}>
                      {t('errorPrefix', { msg: testResult.error })}
                    </Text>
                  ) : (
                    <>
                      <Text style={{ color: theme.text, fontWeight: '700' }}>
                        {t('foundN', { n: testResult.count })}
                      </Text>
                      <View style={styles.sample}>
                        {testResult.sample.map((r, i) => (
                          <View key={i} style={{ flex: 1 }}>
                            <Image source={{ uri: r.img || undefined }} style={styles.sampleImg} />
                            <Text numberOfLines={2} style={{ color: theme.text, fontSize: 11 }}>
                              {r.title || t('noTitle')}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}
                </View>
              ) : null}

              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, { borderColor: theme.border }]}
                  disabled={testing}
                  onPress={test}
                >
                  <Text style={{ color: theme.text }}>{testing ? t('testing') : t('test')}</Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable
                  style={[styles.btn, { borderColor: theme.border }]}
                  onPress={() => (setEditing(null), setTestResult(null))}
                >
                  <Text style={{ color: theme.text }}>{t('cancel')}</Text>
                </Pressable>
                <Pressable style={[styles.btn, styles.primary]} onPress={save}>
                  <Text style={styles.primaryText}>{t('save')}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  h2: { fontSize: 20, fontWeight: '700' },
  siteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  siteName: { fontWeight: '700', fontSize: 15 },
  iconBtn: { padding: 8 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignSelf: 'flex-start',
    marginTop: 14
  },
  primary: { backgroundColor: ACCENT, borderColor: ACCENT },
  primaryText: { color: '#fff', fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 14 },
  field: { gap: 4 },
  label: { fontSize: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14
  },
  fieldset: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 10 },
  legend: { fontSize: 12, fontWeight: '700' },
  testBox: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, padding: 10 },
  sample: { flexDirection: 'row', gap: 8, marginTop: 8 },
  sampleImg: { width: '100%', aspectRatio: 16 / 9, borderRadius: 5, backgroundColor: '#000' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  langTitle: { marginTop: 4, marginBottom: 8 },
  langRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  langBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, borderWidth: 1 }
})
