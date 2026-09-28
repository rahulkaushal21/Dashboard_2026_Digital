'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import { NotSplitNote } from '@/components/UnitToggle'
import MultiSelect from '@/components/MultiSelect'
import KPICard from '@/components/KPICard'
import { fmtDay, type CardDetails } from '@/components/CardDetail'
import { KPIRow, FilterBar, Panel } from '@/components/PageParts'
import { getSqlLeads, type SqlLead } from '@/lib/supabase'

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.map(x => (x || '').trim()).filter(Boolean))).sort()
const selCls = 'bg-mav-panel border border-mav-line rounded-md px-2 py-2 text-sm outline-none focus:border-mav-yellow'

// An empty selection means "all", exactly as the old "All …" option did.
const keeps = (picked: string[], v?: string | null) => picked.length === 0 || picked.includes((v || '').trim())

export default function SqlLeads() {
  const [all, setAll] = useState<SqlLead[]>([])
  const [search, setSearch] = useState('')
  const [fVenture, setFVenture] = useState<string[]>([])
  const [fRegion, setFRegion] = useState<string[]>([])
  const [fOwner, setFOwner] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  useEffect(() => { getSqlLeads().then(setAll) }, [])

  const inRange = (d?: string) => { if (!d) return !from && !to; if (from && d < from) return false; if (to && d > to) return false; return true }
  const s = useMemo(() => all
    .filter(x => (x.company_name || '').toLowerCase().includes(search.toLowerCase()))
    .filter(x => keeps(fVenture, x.venture))
    .filter(x => keeps(fRegion, x.prospect_region))
    .filter(x => keeps(fOwner, x.assigned_to))
    .filter(x => inRange(x.lead_date)), [all, search, fVenture, fRegion, fOwner, from, to])

  const topIndustry = useMemo(() => {
    const m: Record<string, number> = {}; s.forEach(x => { const k = (x.industry || '').trim(); if (k) m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'
  }, [s])
  const filtered = !!(search || fVenture.length || fRegion.length || fOwner.length || from || to)

  // What sits behind each card: the filtered leads, split the way the card counts them.
  // Ventures and Regions count distinct values, so their panels list the leads under
  // each value as tabs (leads with the field blank don't count toward the figure and are
  // left out); Top industry lists that industry's leads. Leads carry no amount.
  const leadDetails = useMemo(() => {
    const mk = (rows: SqlLead[], subtitle: string, groupBy: (x: SqlLead) => string): CardDetails<SqlLead> => ({
      subtitle, rows, groupBy,
      rowKey: x => x.id,
      columns: [
        { key: 'company', label: 'Company', value: x => x.company_name || '—', wide: true, sort: x => (x.company_name || '').toLowerCase() },
        { key: 'date', label: 'Date', value: x => x.lead_date ? fmtDay(x.lead_date) : `${x.month || ''} ${x.year || ''}`.trim() || '—', sort: x => x.lead_date || '' },
        { key: 'industry', label: 'Industry', value: x => x.industry || '—', wide: true, sort: x => (x.industry || '').toLowerCase() },
        { key: 'venture', label: 'Venture', value: x => x.venture || '—', sort: x => (x.venture || '').toLowerCase() },
        { key: 'region', label: 'Region', value: x => x.prospect_region || '—', sort: x => (x.prospect_region || '').toLowerCase() },
        { key: 'owner', label: 'Owner', value: x => x.assigned_to || '—', sort: x => (x.assigned_to || '').toLowerCase() },
      ],
      defaultSort: 'date',
    })
    const t = (v?: string) => (v || '').trim()
    return {
      sqls: mk(s, filtered ? 'Leads matching the filters' : 'All leads', x => t(x.prospect_region) || 'No region'),
      ventures: mk(s.filter(x => t(x.venture)), 'Leads per venture', x => t(x.venture)),
      regions: mk(s.filter(x => t(x.prospect_region)), 'Leads per region', x => t(x.prospect_region)),
      industry: mk(s.filter(x => t(x.industry) === topIndustry), 'Leads in the most common industry', x => t(x.prospect_region) || 'No region'),
    }
  }, [s, topIndustry, filtered])
  const reset = () => { setSearch(''); setFVenture([]); setFRegion([]); setFOwner([]); setFrom(''); setTo('') }


  return (
    <div>
      <Header title="SQL / Leads" subtitle="Sales-qualified leads — filter by venture, region, owner and date" />
      {/* Not filtered by business unit, and says so. Every one of the 99 rows carries the
          same services_bifurcation value ('Web'), so there is nothing here to split —
          and a filter that silently returned everything would be worse than none. */}
      <NotSplitNote what="Leads" reason="are not split by business unit" className="-mt-3 mb-4" />

      <KPIRow cols={4}>
        <KPICard tone="accent" label="SQLs" value={String(s.length)} sub={filtered ? `of ${all.length}` : undefined} details={leadDetails.sqls} />
        <KPICard label="Ventures" value={String(uniq(s.map(x => x.venture)).length)} details={leadDetails.ventures} />
        <KPICard label="Regions" value={String(uniq(s.map(x => x.prospect_region)).length)} details={leadDetails.regions} />
        <KPICard label="Top industry" value={topIndustry} details={topIndustry === '—' ? undefined : leadDetails.industry} />
      </KPIRow>

      <FilterBar right={
        <button onClick={reset} className="rounded-full border border-mav-line text-mav-muted hover:text-mav-fg px-3 py-1.5 text-xs">Reset</button>
      }>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company…" className={`${selCls} w-44`} />
        <MultiSelect label="All ventures" options={uniq(all.map(x => x.venture))} selected={fVenture} onChange={setFVenture} className="w-40" />
        <MultiSelect label="All regions" options={uniq(all.map(x => x.prospect_region))} selected={fRegion} onChange={setFRegion} className="w-40" />
        <MultiSelect label="All owners" options={uniq(all.map(x => x.assigned_to))} selected={fOwner} onChange={setFOwner} className="w-40" />
        <div className="basis-full h-0" />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">From</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-mav-muted">To</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} />
      </FilterBar>

      <Panel flush title="Leads" right={<span className="font-mono text-xs text-mav-muted">{s.length} rows</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-left text-mav-muted border-b border-mav-line"><tr>{['Date', 'Company', 'Industry', 'Persona', 'Venture', 'Region', 'Owner'].map(h => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{s.map(x => (
              <tr key={x.id} className="border-b border-mav-line/60 hover:bg-mav-dark/40">
                <td className="px-4 py-3 text-mav-muted whitespace-nowrap">{x.lead_date || `${x.month || ''} ${x.year || ''}`}</td>
                <td className="px-4 py-3">{x.company_name}</td>
                <td className="px-4 py-3 text-mav-muted">{x.industry}</td>
                <td className="px-4 py-3 text-mav-muted">{x.persona}</td>
                <td className="px-4 py-3 text-mav-muted">{x.venture}</td>
                <td className="px-4 py-3 text-mav-muted">{x.prospect_region}</td>
                <td className="px-4 py-3 text-mav-muted">{x.assigned_to}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
