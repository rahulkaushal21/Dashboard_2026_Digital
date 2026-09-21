'use client'

// Opening a page with one record already selected.
//
// The dashboard is a static export, so there is no server to route /clients/acme — a
// deep link has to be a query string the page reads once it is running. This is how the
// pages join up: a deal's client name opens Client 360 on that client, and a client's
// open quotes open Opportunities on that deal.
//
// Read on mount only. It is a starting position, not a two-way binding: once the page is
// open, clicking through it should not keep rewriting the address bar, and the back
// button should leave the page rather than step through every record you looked at.
export function readDeepLink(key: string): string | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(key)
  return v && v.trim() ? v.trim() : null
}

/**
 * Drop the parameter once it has been used, without adding a history entry.
 *
 * Otherwise a refresh reopens a drawer somebody deliberately closed, and the link stays
 * in the address bar long after it stopped describing what is on screen.
 */
export function clearDeepLink(key: string) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has(key)) return
  url.searchParams.delete(key)
  window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash)
}
