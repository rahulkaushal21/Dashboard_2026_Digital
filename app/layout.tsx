import './globals.css'
import Sidebar from '@/components/Sidebar'
export const metadata = { title: 'Digital Dashboard', description: 'Digital dashboard — revenue, clients & opportunities' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <div className="flex">
          <Sidebar />
          <main className="flex-1 p-8 max-w-[1400px]">{children}</main>
        </div>
      </body>
    </html>
  )
}
