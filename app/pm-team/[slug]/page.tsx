import { PM_TEAM } from '@/lib/pm-team'
import PmDetail from './PmDetail'

// The build is a static export (output: 'export'), so every PM page has to be
// enumerated here at build time — there is no server to resolve a slug at runtime.
// Adding somebody to PM_TEAM is therefore all that is needed to get them a page.
export function generateStaticParams() {
  return PM_TEAM.map(m => ({ slug: m.slug }))
}

export default function Page({ params }: { params: { slug: string } }) {
  return <PmDetail slug={params.slug} />
}
