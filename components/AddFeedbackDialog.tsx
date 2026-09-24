'use client'
import { useEffect, useState } from 'react'
import { submitManualFeedback, getFeedbackApprovers, getClients, getDirectoryMember, type FeedbackApprover } from '@/lib/supabase'
import { currentEmail } from '@/lib/access'
import { SERVICE_DEPTS } from '@/lib/deal-fields'

// Feedback that arrived on Slack, a call, or across a table.
//
// The board reads the feedback tab and the email review, and praise said out loud reaches
// neither — so the warmest thing a client said all quarter can be invisible, and the PM
// who heard it has nowhere to put it.
//
// IT GOES TO SOMEBODY ELSE TO SIGN OFF. Not as ceremony: everything else on this board
// was scraped, and is scored on its words because nobody vouched for it. A typed entry
// has no such check, so the check is a second person. That is also why the form asks for
// what the client actually SAID rather than a summary — an approver cannot judge "client
// was happy", and neither can anybody reading it in six months.

const CHANNELS = ['Slack', 'Call', 'Meeting', 'WhatsApp', 'In person', 'Other']

const ctl = 'mt-1 w-full bg-mav-dark border border-mav-fg/20 rounded-md px-3 py-2 text-sm text-mav-fg ' +
  'placeholder:text-mav-fg/35 focus:outline-none focus:border-mav-yellow focus:ring-1 focus:ring-mav-yellow/40 transition-colors'

const F = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block">
    <span className="text-xs font-medium text-mav-fg/85">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-mav-fg/50 mt-0.5">{hint}</span>}
  </label>
)

export default function AddFeedbackDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [company, setCompany] = useState('')
  const [quote, setQuote] = useState('')
  const [channel, setChannel] = useState('Slack')
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10))
  const [dept, setDept] = useState('')
  const [pm, setPm] = useState('')
  const [project, setProject] = useState('')
  const [email, setEmail] = useState('')
  const [approvers, setApprovers] = useState<FeedbackApprover[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Every client we have ever booked, so the name typed here is the name the rest of the
  // dashboard already uses. A feedback row filed under "zulu" instead of "ZULU 8" is
  // invisible on that client's page, which is the one place anybody would look for it.
  const [clientNames, setClientNames] = useState<string[]>([])
  useEffect(() => {
    getClients().then(cs => setClientNames(
      Array.from(new Set(cs.map(c => (c.company_name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
    )).catch(() => {})
  }, [])

  useEffect(() => { getFeedbackApprovers().then(setApprovers).catch(() => {}) }, [])

  // The PM defaults to whoever is filling this in. Praise usually reaches the person it
  // is about, and retyping your own name is the kind of small friction that ends with
  // the field left blank. Still editable — you can log praise for somebody else.
  useEffect(() => {
    getDirectoryMember(currentEmail()).then(m => { if (m?.name) setPm(prev => prev || m.name) }).catch(() => {})
  }, [])

  // Named before it is sent, not after. Knowing who has to agree changes how people write.
  const approver = approvers.find(a => a.dept_pattern.toUpperCase() === dept.toUpperCase())

  const tooShort = quote.trim().length > 0 && quote.trim().length < 20

  const save = async () => {
    setSaving(true); setError('')
    const res = await submitManualFeedback({
      company, quote, channel, happened_on: on,
      client_email: email, service_dept: dept, pm_owner: pm, project,
    })
    setSaving(false)
    if (!res.ok) { setError(res.error || 'Could not save it'); return }
    onAdded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-xl bg-mav-panel border border-mav-line rounded-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold">Add feedback</h2>
            <p className="text-xs text-mav-fg/60 mt-0.5">
              Praise that came in on Slack, a call or in person. It reaches the board once its
              department&rsquo;s approver signs it off.
            </p>
          </div>
          <button onClick={onClose} className="text-mav-fg/60 hover:text-mav-fg text-xl leading-none">&times;</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <F label="Client *" hint={company.trim() && !clientNames.some(n => n.toLowerCase() === company.trim().toLowerCase())
              ? 'Not a client we have booked — check the spelling, or carry on if they are new.' : undefined}>
              <input className={ctl} value={company} onChange={e => setCompany(e.target.value)} autoFocus
                list="feedback-clients" placeholder="Start typing — we will find them" autoComplete="off" />
              <datalist id="feedback-clients">
                {clientNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </F>
          </div>

          <div className="sm:col-span-2">
            <F label="What they said *"
              hint={tooShort
                ? 'A few words is not feedback — write down what they actually said.'
                : 'Their words, not a summary. Nobody can judge "client was happy", including you in six months.'}>
              <textarea className={ctl} rows={4} value={quote} onChange={e => setQuote(e.target.value)}
                placeholder="&ldquo;The team turned this around in a day and the client has not stopped talking about it…&rdquo;" />
            </F>
          </div>

          <F label="Where">
            <select className={ctl} value={channel} onChange={e => setChannel(e.target.value)}>
              {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </F>
          <F label="When"><input type="date" className={ctl} value={on} onChange={e => setOn(e.target.value)} /></F>

          <F label="Service / dept" hint={approver ? `${approver.name} approves this one.` : dept ? 'No approver set for that department.' : 'Decides who signs it off.'}>
            <select className={ctl} value={dept} onChange={e => setDept(e.target.value)}>
              <option value="">—</option>
              {SERVICE_DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </F>
          <F label="PM it is about" hint="Defaults to you — change it if the praise is about somebody else.">
            <input className={ctl} value={pm} onChange={e => setPm(e.target.value)} placeholder="Who did the work" />
          </F>

          <F label="Project"><input className={ctl} value={project} onChange={e => setProject(e.target.value)} placeholder="Optional" /></F>
          <F label="Their email"><input className={ctl} value={email} onChange={e => setEmail(e.target.value)} placeholder="Optional" /></F>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-md border border-mav-line text-mav-muted hover:text-mav-fg">Cancel</button>
          <button onClick={save} disabled={saving || !company.trim() || quote.trim().length < 20}
            className="text-sm px-4 py-2 rounded-md bg-mav-yellow text-black font-medium hover:bg-mav-yellow/90 disabled:opacity-40">
            {saving ? 'Sending…' : approver ? `Send to ${approver.name}` : 'Send for approval'}
          </button>
        </div>
      </div>
    </div>
  )
}
