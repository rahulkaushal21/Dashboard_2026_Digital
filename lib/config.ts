import { supabase } from './supabase'
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
