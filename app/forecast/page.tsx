'use client'
// Forecast has moved into Business Trend as a tab. This route stays so old bookmarks and
// links still land somewhere real rather than bouncing to the dashboard — it renders the
// same panel, standalone.
import ForecastPanel from '@/components/ForecastPanel'

export default function ForecastPage() {
  return <ForecastPanel />
}
