'use client'
import { Info } from 'lucide-react'

/**
 * The explanation, one hover away instead of a paragraph on the page.
 *
 * Pages here explain themselves carefully, and that care is worth keeping — but a line of
 * small print under every heading pushed the numbers below the fold and made every page
 * look like a document. The words are unchanged; they now sit behind an ⓘ. Keyboard
 * users get it on focus, and the text is also the button's accessible label.
 */
export default function InfoTip({ text, className = '', align = 'left' }: { text: React.ReactNode; className?: string; align?: 'left' | 'right' }) {
  if (!text) return null
  return (
    <span className={`relative inline-flex group align-middle ${className}`}>
      <button type="button" aria-label={typeof text === 'string' ? text : 'More information'}
        className="text-mav-muted hover:text-mav-fg focus:text-mav-fg outline-none">
        <Info size={14} />
      </button>
      <span role="tooltip"
        className={`pointer-events-none absolute top-full mt-2 z-50 w-72 sm:w-80 rounded-lg border border-mav-line bg-mav-panel
          px-3 py-2 text-xs font-normal normal-case tracking-normal leading-relaxed text-mav-fg shadow-lg
          opacity-0 translate-y-1 transition group-hover:opacity-100 group-hover:translate-y-0
          group-focus-within:opacity-100 group-focus-within:translate-y-0 ${align === 'right' ? 'right-0' : 'left-0'}`}>
        {text}
      </span>
    </span>
  )
}
