'use client'
import { useState } from 'react'
import { saveClientQbr, type ClientQbr } from '@/lib/supabase'

// The quarterly review, written up.
//
// Every other block on Client 360 is derived from a sheet or a mailbox that already
// syncs. This one cannot be: what was agreed on a QBR call exists in a recording or in
// somebody's minutes, and nothing here can reach either. So it is typed, once, by whoever
// ran the call — and from then on it is the only record of what both sides promised.
//
// The newest review shows its action items first and open, because the question this
// panel is usually opened to answer is "what did we say we'd do last time". Older ones
// collapse.

const SOURCES = ['Call recording', 'Minutes of meeting', 'My notes']

const Field = ({ label, hint, value, onChange }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void
}) => (
  <label className="block">
    <span className="text-xs font-medium text-mav-fg/85">{label}</span>
    {hint && <span className="block text-[11px] text-mav-fg/50 mb-1">{hint}</span>}
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
      className="mt-1 w-full bg-mav-dark border border-mav-fg/20 rounded-md px-3 py-2 text-sm text-mav-fg
        placeholder:text-mav-fg/35 outline-none focus:border-mav-yellow transition-colors resize-y" />
  </label>
)

const Block = ({ title, text, tone }: { title: string; text?: string; tone?: string }) => {
  if (!text?.trim()) return null
  return (
    <div className="mt-3">
      <div className={`text-[11px] uppercase tracking-wide mb-1 ${tone || 'text-mav-muted'}`}>{title}</div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  )
}

const blank = { qbr_date: '', summary: '', action_mavlers: '', action_client: '', opportunities: '', next_roadmap: '', source: SOURCES[0] }

export default function ClientQbrPanel({ company, rows, canEdit, onSaved }: {
  company: string; rows: ClientQbr[]; canEdit: boolean; onSaved: () => void
}) {
  const [form, setForm] = useState<typeof blank | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const set = (k: keyof typeof blank) => (v: string) => setForm(f => f ? { ...f, [k]: v } : f)

  const start = (r?: ClientQbr) => {
    setError('')
    setForm(r
      ? { qbr_date: (r.qbr_date || '').slice(0, 10), summary: r.summary || '', action_mavlers: r.action_mavlers || '',
          action_client: r.action_client || '', opportunities: r.opportunities || '', next_roadmap: r.next_roadmap || '',
          source: r.source || SOURCES[0] }
      // A new review carries the last one's roadmap in as its starting point: the whole
      // value of "next QBR roadmap" is that the next QBR opens on it.
      : { ...blank, qbr_date: new Date().toISOString().slice(0, 10), next_roadmap: '', summary: '',
          action_mavlers: rows[0]?.next_roadmap || '' })
  }

  const save = async () => {
    if (!form) return
    if (!form.qbr_date) { setError('A date is needed — reviews are filed per client per date.'); return }
    setBusy(true); setError('')
    const res = await saveClientQbr(company, form.qbr_date, form)
    setBusy(false)
    if (!res.ok) { setError(res.error || 'Could not save'); return }
    setForm(null); onSaved()
  }

  return (
    <div className="mt-6 border-t border-mav-line pt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-mav-muted">Quarterly business reviews</span>
          {rows.length > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-mav-yellow/20 text-mav-yellow font-medium">{rows.length}</span>}
        </div>
        {canEdit && !form && (
          <button onClick={() => start()} className="text-xs px-3 py-1.5 rounded-md bg-mav-fill text-black font-medium hover:brightness-110 transition">
            Record a QBR
          </button>
        )}
      </div>
      <p className="text-[11px] text-mav-muted mb-4 max-w-2xl">
        The one part of this page nothing can work out on its own &mdash; what was agreed on the call lives in the
        recording or the minutes. Whoever ran it writes it up here, and the next review opens with these action items
        already in front of it.
      </p>

      {form && (
        <div className="rounded-lg border border-mav-yellow/30 bg-mav-yellow/5 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-mav-fg/85">QBR date</span>
              <input type="date" value={form.qbr_date} onChange={e => set('qbr_date')(e.target.value)}
                className="mt-1 w-full bg-mav-dark border border-mav-fg/20 rounded-md px-3 py-2 text-sm text-mav-fg outline-none focus:border-mav-yellow" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-mav-fg/85">Taken from</span>
              <select value={form.source} onChange={e => set('source')(e.target.value)}
                className="mt-1 w-full bg-mav-dark border border-mav-fg/20 rounded-md px-3 py-2 text-sm text-mav-fg outline-none focus:border-mav-yellow">
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <Field label="Summary" hint="What the review covered, in the client's own terms." value={form.summary} onChange={set('summary')} />
          <Field label="Action items — Mavlers" hint="What we committed to. Prefilled from the last review's roadmap." value={form.action_mavlers} onChange={set('action_mavlers')} />
          <Field label="Action items — client" hint="What they committed to. Worth writing down: a slipped date is usually here." value={form.action_client} onChange={set('action_client')} />
          <Field label="Opportunities" hint="Work they hinted at. This is where the next quote comes from." value={form.opportunities} onChange={set('opportunities')} />
          <Field label="Next QBR roadmap" hint="What the next review should open on." value={form.next_roadmap} onChange={set('next_roadmap')} />
          {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy}
              className="text-xs px-4 py-1.5 rounded-md bg-mav-fill text-black font-medium disabled:opacity-50 hover:brightness-110 transition">
              {busy ? 'Saving…' : 'Save review'}
            </button>
            <button onClick={() => setForm(null)} className="text-xs px-3 py-1.5 rounded-md border border-mav-fg/20 text-mav-fg/70 hover:text-mav-fg">Cancel</button>
            <span className="text-[11px] text-mav-fg/50">Saving over the same date replaces that review.</span>
          </div>
        </div>
      )}

      {rows.length === 0 && !form && (
        <p className="text-sm text-mav-muted">
          No review recorded for this client yet.{canEdit ? '' : ' A PM or an admin can add one.'}
        </p>
      )}

      <div className="space-y-3">
        {rows.map((r, i) => {
          // Newest open, the rest collapsed: the question this is opened for is almost
          // always "what did we agree last time".
          const open = openId === null ? i === 0 : openId === r.id
          return (
            <div key={r.id} className="rounded-lg border border-mav-line bg-mav-dark/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => setOpenId(open ? -1 : r.id)} className="text-left min-w-0">
                  <div className="text-sm font-medium">{(r.qbr_date || '').slice(0, 10)}</div>
                  <div className="text-[11px] text-mav-muted mt-0.5">
                    {r.source || 'source not stated'} · written up by {r.updated_by || r.added_by}
                    {!open && r.summary ? ` · ${r.summary.slice(0, 70)}${r.summary.length > 70 ? '…' : ''}` : ''}
                  </div>
                </button>
                {canEdit && <button onClick={() => start(r)} className="shrink-0 text-xs text-mav-yellow hover:underline">Edit</button>}
              </div>
              {open && (
                <>
                  <Block title="Summary" text={r.summary} />
                  <Block title="Action items — Mavlers" text={r.action_mavlers} tone="text-mav-yellow/80" />
                  <Block title="Action items — client" text={r.action_client} tone="text-blue-300/80" />
                  <Block title="Opportunities" text={r.opportunities} tone="text-green-400/80" />
                  <Block title="Next QBR roadmap" text={r.next_roadmap} />
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
