import Header from './Header'
export default function ComingSoon({ title, fields }: { title: string; fields: string[] }) {
  return (
    <div>
      <Header title={title} subtitle="Planned section — fields mapped, page not built yet" />
      <div className="bg-mav-panel border border-mav-line rounded-xl p-6">
        <p className="text-sm text-mav-muted mb-4">Data fields this page will surface:</p>
        <div className="flex flex-wrap gap-2">
          {fields.map(f => <span key={f} className="text-xs px-3 py-1 rounded-full bg-mav-dark border border-mav-line">{f}</span>)}
        </div>
      </div>
    </div>
  )
}
