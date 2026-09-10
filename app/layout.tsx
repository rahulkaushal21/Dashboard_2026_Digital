import './globals.css'
import AuthProvider from '@/components/AuthProvider'
export const metadata = { title: 'Digital Dashboard', description: 'Digital dashboard — revenue, clients & opportunities' }
// Without this every page is laid out at ~980px and then zoomed out on a phone,
// which is why the whole dashboard read as unusable on mobile regardless of the
// responsive classes underneath. maximum-scale is deliberately NOT set: capping
// zoom breaks pinch-to-zoom on the wide data tables.
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
