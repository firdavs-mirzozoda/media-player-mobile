import AsyncStorage from '@react-native-async-storage/async-storage'

const KEYS = [
  'searchList',
  'sites',
  'activeSite',
  'size-mode',
  'muted',
  'theme',
  'quality-pref',
  'lang'
]

// Everything the app persists, loaded once at start-up.
export async function loadAll() {
  const out = {}
  try {
    const pairs = await AsyncStorage.multiGet(KEYS)
    for (const [k, v] of pairs) {
      if (v == null) continue
      try {
        out[k] = JSON.parse(v)
      } catch {
        out[k] = v
      }
    }
  } catch {
    /* noop */
  }
  return out
}

export function save(key, value) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {
    /* noop */
  })
}
