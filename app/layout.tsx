import './globals.css'
import AuthProvider from '@/components/AuthProvider'
import { themeScript } from '@/components/ThemeToggle'
import SectionTheme from '@/components/SectionTheme'
export const metadata = {
  title: 'Digital Dashboard',
  description: 'Digital dashboard — revenue, clients & opportunities',
  // Internal tool: keep it out of search engines. Mirrored by public/robots.txt.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
}
// Without this every page is laid out at ~980px and then zoomed out on a phone,
// which is why the whole dashboard read as unusable on mobile regardless of the
// responsive classes underneath. maximum-scale is deliberately NOT set: capping
// zoom breaks pinch-to-zoom on the wide data tables.
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        {/* Sets the saved theme before the first paint. Without it the page paints dark,
            then React mounts and switches to light — a black flash on every load for
            anybody using light mode. An inline blocking script is the only place that
            can be prevented. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        {/* Publishes the current section's colour for the heading rule, the nav and
            the headline cards to pick up. */}
        <SectionTheme />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
