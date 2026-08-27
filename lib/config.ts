import { supabase } from './supabase'

// The financial-year revenue target, in USD. ONE definition, because Business Trend
// and Forecast both report progress against it and two copies drift the moment one
// is edited — leaving the two pages quietly disagreeing about what we are chasing.
// FY runs April to March.
export const FY_TARGET = 3200000
export const FY_TARGET_LABEL = '$3.2M'

export interface Settings { business_sheet_url?: string; scan_gmail_address?: string; updated_at?: string }
export async function getSettings(): Promise<Settings> {
  if (!supabase) return {}
  const { data } = await supabase.from('app_settings').select('*').eq('id', 1).single()
  return (data as Settings) || {}
}
export async function saveSettings(s: Settings): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase.from('app_settings').upsert({ id: 1, ...s, updated_at: new Date().toISOString() })
  if (error) throw error
}
