import { supabase } from './supabase'

// The financial-year revenue target, in USD. ONE definition, because Business Trend
// and Forecast both report progress against it and two copies drift the moment one
// is edited — leaving the two pages quietly disagreeing about what we are chasing.
// FY runs April to March.
export const FY_TARGET = 3200000
export const FY_TARGET_LABEL = '$3.2M'
// Per-unit targets, from Rahul on 6 Oct 2026. They add to the company figure exactly:
// 729,652 + 2,470,348 = 3,200,000.
//
// BOTH PAGES READ THESE NOW. Business Trend used to measure whatever unit you had
// selected against the whole company's $3.2M and say so in a footnote — "there is no
// per-unit target" — which was true when it was written and stopped being true the day
// these were set. Looking at LP/HUB it reported 16% of target against a figure LP/HUB
// was never chasing. Rahul, 15 Oct 2026: "lp/hub yearly targets are $729,652 ... it
// should be based on the targets given".
export const FY_TARGETS: Record<'all' | 'lp-hub' | 'web', number> = { all: 3200000, 'lp-hub': 729652, web: 2470348 }
// Web's target by GEO, same source. AU + UK + US = the Web target.
export const WEB_GEO_TARGETS: Record<'AU' | 'UK' | 'US', number> = { AU: 420933, UK: 773517, US: 1275898 }

/** The target for the unit on screen. 'all' is the company figure, as it always was. */
export const fyTargetFor = (unit: 'all' | 'lp-hub' | 'web') => FY_TARGETS[unit] ?? FY_TARGET
/**
 * How that target is written on screen: $3.2M, $2.47M, $730k. Short, because it sits
 * inside sentences and beside headings rather than in a figure column.
 */
export const fyTargetLabel = (unit: 'all' | 'lp-hub' | 'web') => {
  const n = fyTargetFor(unit)
  if (unit === 'all') return FY_TARGET_LABEL
  return n >= 1_000_000 ? '$' + (n / 1_000_000).toFixed(2) + 'M' : '$' + Math.round(n / 1000) + 'k'
}

export interface Settings {
  business_sheet_url?: string
  scan_gmail_address?: string
  updated_at?: string
  /** The theme anybody who has not picked one for themselves gets. */
  default_theme?: string
}
export async function getSettings(): Promise<Settings> {
  if (!supabase) return {}
  const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single()
  return (data as Settings) || {}
}
export async function saveSettings(s: Settings): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  // MERGE, do not replace. This is an upsert on a single row, so a caller sending one
  // field — the theme picker sends only default_theme — would otherwise null the sheet
  // URL and the scan mailbox, and the next sync would fail with nothing to point at.
  const current = await getSettings()
  const next: Record<string, unknown> = { ...current, ...s }
  delete next.id
  const { error } = await supabase.from('app_settings')
    .upsert({ id: 1, ...next, updated_at: new Date().toISOString() })
  if (error) throw error
}
