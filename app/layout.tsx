import './globals.css'
import Sidebar from '@/components/Sidebar'
export const metadata = { title: 'Mavlers CRM Dashboard', description: 'CRM revenue, clients & opportunities' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 p-8 max-w-[1400px] h-screen overflow-y-auto">{children}</main>
        </div>
      </body>
    </html>
  )
}
