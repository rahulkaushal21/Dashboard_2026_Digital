'use client'
import Link from 'next/link'

// A client name, anywhere in the dashboard, that opens that client in Client 360.
//
// One component rather than the same <Link> written out in a dozen tables, because the
// deep link has three details that are easy to get wrong and silently break:
//
//   * The name has to be encoded. Real clients here are called "Mighty // Advertising
//     Agency" and "Hunter Public Relations, LLC" — a bare slash in a query string ends
//     the value early and opens the wrong record, or none.
//
//   * The click must not bubble. Most of these names sit inside a row that already has
//     an onClick opening a drawer; without stopPropagation you navigate AND open the
//     drawer, and land on Client 360 with a panel over it.
//
//   * A blank name must not render a link. `/clients?client=` matches nothing and looks
//     broken, so an empty name falls back to plain text.
//
// Client 360 matches on the name, exactly first and then loosely, because there is no id
// on a client record — see the deep-link handler in app/clients/page.tsx.
export default function ClientLink({ name, className = '', title }: { name?: string | null; className?: string; title?: string }) {
  const v = (name || '').trim()
  if (!v) return <span className={className}>—</span>
  return (
    <Link
      href={`/clients?client=${encodeURIComponent(v)}`}
      onClick={e => e.stopPropagation()}
      title={title || `Open ${v} in Client 360`}
      className={`hover:text-mav-yellow hover:underline underline-offset-2 decoration-dotted transition-colors ${className}`}>
      {v}
    </Link>
  )
}
