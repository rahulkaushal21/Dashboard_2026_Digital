import './globals.css'
import AuthProvider from '@/components/AuthProvider'
export const metadata = { title: 'Digital Dashboard', description: 'Digital dashboard — revenue, clients & opportunities' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
