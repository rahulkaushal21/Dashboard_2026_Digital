'use client'
import { useEffect, useState } from 'react'
import { getClients, getDirectoryMember, ownerMatches, type DirectoryMember } from './supabase'
import { currentEmail, getStoredProfile } from './access'

// "Mine" — which rows belong to the person looking.
//
// Five pages needed the same answer and each could have worked it out differently, which
// is how Client 360 and Delights end up disagreeing about whose client somebody is.
//
// TWO WAYS A ROW CAN BE YOURS, because the tables disagree about what they record:
//   • a deal names its PM directly (pm_owner)
//   • an escalation, a delight or a client names only the COMPANY, so ownership comes
//     from the client record's PC/SME
// A name cell can hold several people ("Malav Modi / Kalgi Shah"), which is why matching
// goes through ownerMatches and the directory's alias list rather than string equality —
// 'Rahul Kaushal' must never match Rahul Jain.
//
// This decides what a page OFFERS, not what it is allowed to load. Everything still comes
// down with the anon key; clearing the filter shows the lot, deliberately.

export interface Mine {
  /** null until the lookup finishes, so a page can avoid filtering to nothing on load. */
  me: DirectoryMember | null
  isAdmin: boolean
  ready: boolean
  /** Whether to default the page to this person's own rows at all. */
  canScope: boolean
  ownsPm: (pmOwnerCell?: string) => boolean
  ownsClient: (companyName?: string) => boolean
}

const key = (s?: string) => (s || '').trim().toLowerCase()

export function useMine(): Mine {
  const [me, setMe] = useState<DirectoryMember | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [ready, setReady] = useState(false)
  const [myClients, setMyClients] = useState<Set<string>>(new Set())

  useEffect(() => {
    setIsAdmin(!!getStoredProfile()?.is_admin)
    getDirectoryMember(currentEmail()).then(async m => {
      setMe(m)
      if (m) {
        const clients = await getClients()
        setMyClients(new Set(clients.filter(c => ownerMatches(c.pc_sme, m.aliases)).map(c => key(c.company_name))))
      }
      setReady(true)
    }).catch(() => setReady(true))
  }, [])

  return {
    me, isAdmin, ready,
    // Somebody not in the PM directory has no "mine" to scope to — an admin who owns no
    // accounts, a viewer. They get everything, which is the only sensible default when
    // the answer to "which of these are yours" is none of them.
    canScope: !!me,
    ownsPm: (cell?: string) => !!me && ownerMatches(cell, me.aliases),
    ownsClient: (name?: string) => myClients.has(key(name)),
  }
}
