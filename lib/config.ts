import { supabase } from './supabase'

// The financial-year revenue target, in USD. ONE definition, because Business Trend
// and Forecast both report progress against it and two copies drift the moment one
// is edited — leaving the two pages quietly disagreeing about what we are chasing.
// FY runs April to March.
export const FY_TARGET = 3200000
export const FY_TARGET_LABEL = '$3.2M'

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
