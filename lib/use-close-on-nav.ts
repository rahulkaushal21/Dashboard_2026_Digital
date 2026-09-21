'use client'
import { useEffect } from 'react'

// Closing a page's drawer when somebody uses the sidebar.
//
// The client drawer stops at the main nav on purpose, so you can move to another page
// without closing the client first. That worked for every destination except the one you
// are already on: clicking "Client 360" while a client is open is a navigation to the
// same route, so nothing re-renders, no effect fires, and the drawer just sits there —
// looking, reasonably enough, like a broken link.
//
// usePathname cannot see it (the path did not change) and popstate does not fire on a
// same-route Link. So the sidebar announces the click and any open drawer listens.
export const NAV_EVENT = 'dashboard:nav'

export function useCloseOnNav(close: () => void) {
  useEffect(() => {
    const onNav = () => close()
    window.addEventListener(NAV_EVENT, onNav)
    return () => window.removeEventListener(NAV_EVENT, onNav)
  }, [close])
}
