// The themes, and which family each belongs to.
//
// Family decides the things CSS cannot work out on its own: which shade of a section hue
// to use for the filled nav item, and whether the status colours need darkening. A theme
// is 'dark' or 'light' by whether its PAGE is dark or light, not by its name — Dim Slate
// is a dark family theme even though nothing in it is black.
//
// The palettes themselves live in globals.css, where they belong. This file is the list
// the picker renders and the swatches it shows.

export type ThemeFamily = 'dark' | 'light'

export interface Theme {
  id: string
  name: string
  blurb: string
  family: ThemeFamily
  /** page, card, border, text — for the swatch in the picker. */
  swatch: [string, string, string, string]
}

export const THEMES: Theme[] = [
  {
    id: 'dark', name: 'Charcoal', family: 'dark',
    blurb: 'The original. Near-black, high contrast, what the team has been using.',
    swatch: ['#1B1B1B', '#242424', '#333333', '#F2F2F2'],
  },
  {
    id: 'midnight', name: 'Midnight', family: 'dark',
    blurb: 'Deep navy instead of grey. Same contrast, warmer to sit with for a long day.',
    swatch: ['#0F1521', '#18202F', '#28334A', '#E8EDF7'],
  },
  {
    id: 'dim', name: 'Dim Slate', family: 'dark',
    blurb: 'Neither dark nor light — a mid grey-blue. The least glare of any of them, day or night.',
    swatch: ['#222830', '#2B323C', '#3B4451', '#DCE2EA'],
  },
  {
    id: 'light', name: 'Warm Paper', family: 'light',
    blurb: 'Sand and ivory. Reads like paper, and the brand yellow belongs on it.',
    swatch: ['#EFEBE4', '#FAF7F1', '#DDD6CA', '#23201B'],
  },
  {
    id: 'cool', name: 'Cool Light', family: 'light',
    blurb: 'Crisp blue-grey. The familiar modern-tool look, brighter and cooler than Warm Paper.',
    swatch: ['#E9EDF2', '#F8FAFC', '#D5DCE5', '#161F2B'],
  },
]

export const THEME_IDS = THEMES.map(t => t.id)
export const themeById = (id?: string | null) => THEMES.find(t => t.id === id)
export const isTheme = (id?: string | null): boolean => !!id && THEME_IDS.includes(id)
