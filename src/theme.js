import { t } from './i18n'

// Design tokens shared by every screen: warm greys and one accent, no gradients.
export const ACCENT = '#E0583F'
export const DANGER = '#D64545'

export const THEMES = {
  dark: {
    name: 'dark',
    bg: '#141312',
    surface: '#1D1B19', // sheets, dropdowns
    surface2: '#282522', // chips, inputs, cards
    text: '#ECE7E0',
    dim: 'rgba(236,231,224,0.6)',
    faint: 'rgba(236,231,224,0.36)',
    placeholder: 'rgba(236,231,224,0.36)',
    border: 'rgba(255,255,255,0.08)',
    card: '#1D1B19',
    shadow: '#000',
    status: 'light'
  },
  light: {
    name: 'light',
    bg: '#F4F1EC',
    surface: '#FFFFFF',
    surface2: '#E8E3DB',
    text: '#1E1B18',
    dim: 'rgba(30,27,24,0.6)',
    faint: 'rgba(30,27,24,0.38)',
    placeholder: 'rgba(30,27,24,0.38)',
    border: 'rgba(0,0,0,0.09)',
    card: '#FFFFFF',
    shadow: '#8A7F72',
    status: 'dark'
  }
}

export function qualityLabel(q) {
  if (q === 'audio') return t('audioOnly')
  if (q === 'orig') return t('originalFile')
  return q + 'p'
}
