import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mav: {
          yellow: '#FFDB2D',
          dark: '#1B1B1B',
          panel: '#242424',
          line: '#333333',
          muted: '#9a9a9a',
        },
      },
      fontFamily: { sans: ['Montserrat', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
export default config
