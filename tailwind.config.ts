import type { Config } from 'tailwindcss'

// The five theme tokens plus the text colour, all backed by CSS variables so the
// whole app switches theme with one attribute on <html>.
//
// `<alpha-value>` is what keeps opacity modifiers working — text-mav-fg/60,
// bg-mav-fg/5, border-mav-line/40 are used several hundred times across the app
// and would all break silently without it.
//
// `fill` is the one colour that does NOT follow the theme: a filled yellow button
// carries its contrast through the dark text sitting on it, so it stays bright in
// both themes. `yellow` is the one that darkens on light, because it is used as
// text and as hairline borders, where #FFDB2D on white is a 1.3:1 ratio.
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mav: {
          yellow: rgb('--mav-yellow'),
          fill: '#FFDB2D',
          dark: rgb('--mav-bg'),
          panel: rgb('--mav-panel'),
          line: rgb('--mav-line'),
          muted: rgb('--mav-muted'),
          fg: rgb('--mav-fg'),
        },
      },
      fontFamily: { sans: ['Montserrat', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
export default config
