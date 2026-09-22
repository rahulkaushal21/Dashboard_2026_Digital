// A colour per section.
//
// Every page was grey cards and one yellow accent, so they all looked alike and nothing
// told you where you were or what kind of thing you were reading. Each section now owns a
// hue, carried on its heading rule, its nav item and the top edge of its headline cards.
//
// The hues are chosen to MEAN something rather than to decorate: money is green and teal,
// pipeline is blue, people are violet, trouble is red. They are also all dark enough to
// read on the warm paper background and bright enough on the dark one, which rules out
// most of the pretty ones.
//
// Yellow is deliberately not in this list. It stays the brand — the logo, filled buttons,
// text selection — and a brand colour that also means "you are on the Delights page"
// stops meaning anything.

export interface Hue { name: string; light: string; dark: string }

// Longest prefix wins, so /operations/revenue-history gets its own colour rather than
// inheriting whatever /operations would have.
const HUES: [string, Hue][] = [
  ['/business-numbers',           { name: 'teal',   light: '#0F766E', dark: '#2DD4BF' }],
  ['/opportunities',              { name: 'blue',   light: '#1D4ED8', dark: '#60A5FA' }],
  ['/revenue-sheet',              { name: 'indigo', light: '#4338CA', dark: '#818CF8' }],
  ['/clients',                    { name: 'violet', light: '#6D28D9', dark: '#A78BFA' }],
  ['/critical-escalations',       { name: 'red',    light: '#B91C1C', dark: '#F87171' }],
  ['/escalations',                { name: 'orange', light: '#C2410C', dark: '#FB923C' }],
  ['/delights',                   { name: 'green',  light: '#047857', dark: '#34D399' }],
  ['/sql-leads',                  { name: 'lime',   light: '#4D7C0F', dark: '#A3E635' }],
  ['/business-trend',             { name: 'cyan',   light: '#0E7490', dark: '#22D3EE' }],
  ['/forecast',                   { name: 'cyan',   light: '#0E7490', dark: '#22D3EE' }],
  ['/last-year',                  { name: 'sky',    light: '#0369A1', dark: '#38BDF8' }],
  ['/pm-team',                    { name: 'fuchsia',light: '#A21CAF', dark: '#E879F9' }],
  ['/operations/revenue-history', { name: 'stone',  light: '#57534E', dark: '#D6D3D1' }],
  ['/operations/lnd',             { name: 'emerald',light: '#065F46', dark: '#6EE7B7' }],
  ['/needs-input',                { name: 'amber',  light: '#B45309', dark: '#FCD34D' }],
  ['/admin',                      { name: 'slate',  light: '#475569', dark: '#94A3B8' }],
  ['/',                           { name: 'amber',  light: '#B45309', dark: '#FBBF24' }],
]

export function hueFor(path: string | null | undefined): Hue {
  const p = (path || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  let best: Hue | null = null
  let bestLen = -1
  for (const [href, hue] of HUES) {
    const match = href === '/' ? p === '/' : (p === href || p.startsWith(href + '/'))
    if (match && href.length > bestLen) { best = hue; bestLen = href.length }
  }
  return best || HUES[HUES.length - 1][1]
}
