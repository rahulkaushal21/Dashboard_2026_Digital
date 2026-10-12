import { PM_TEAM } from '@/lib/pm-team'
import PmDetail from './PmDetail'

// The build is a static export (output: 'export'), so every PM page has to be
// enumerated here at build time — there is no server to resolve a slug at runtime.
// Adding somebody to PM_TEAM is therefore all that is needed to get them a page.
export function generateStaticParams() {
  return PM_TEAM.map(m => ({ slug: m.slug }))
}

// `params` is a PROMISE since Next 15, not a plain object. It is still resolved at
// build time here — generateStaticParams above enumerates every slug and the export is
// static — so awaiting it changes nothing about when this runs or what it produces; it
// is the signature that changed, not the behaviour.
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <PmDetail slug={slug} />
}
