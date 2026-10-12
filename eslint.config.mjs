// ESLint, flat config.
//
// There was never an eslint config in this repo. The `lint` script called `next lint`,
// which Next 16 removed outright — so the script failed with "no such directory: lint",
// and before that it had no rules to apply anyway. This makes `npm run lint` a real
// command for the first time.
//
// IT IS NOT IN THE BUILD AND NOT IN CI, on purpose. next.config.js sets
// `eslint: { ignoreDuringBuilds: true }`, and a deploy that can be blocked by a style
// rule is a deploy that goes stale for a reason nobody acted on. This is a tool to run
// when you want it, not a gate.
import next from 'eslint-config-next'
import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

export default [
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      // Deno, not Node. These import from jsr: URLs and reference a Deno global that
      // does not exist here, so every one of them is a wall of false errors — the same
      // reason `tsc --noEmit` reports them and the Next build does not.
      'supabase/functions/**',
    ],
  },
  ...next,
  ...coreWebVitals,
  ...typescript,
]
