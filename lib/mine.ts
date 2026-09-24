'use client'
import { useEffect, useState } from 'react'
import { getClientOwners, getDirectoryMember, ownerMatches, clientKey, type DirectoryMember } from './supabase'
import { currentEmail, getStoredProfile } from './access'

// "Mine" — which rows belong to the person looking.
//
// Five pages needed the same answer and each could have worked it out differently, which
// is how Client 360 and Delights end up disagreeing about whose client somebody is.
//
// TWO WAYS A ROW CAN BE YOURS, because the tables disagree about what they record:
//   • a deal names its PM directly (pm_owner)
//   • an escalation, a delight or a client names only the COMPANY, so ownership comes
//     from who owns that client — ALL of them. It used to be the client record's single
//     PC/SME cell, and on a client split across two people by service that hid one of
//     them from their own work: ZULU 8 reads as Nitin's on the record while most of its
//     revenue is Maitri's, so her own bookings were missing from her own dashboard.
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

// The view's own key, so a name written 'ZULU 8' one place and 'Zulu8' another
// still lands on one client.
const key = (s?: string) => clientKey(s)

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
        const owners = await getClientOwners()
        const mineNow = new Set<string>()
        for (const [ck, people] of owners) {
          if (people.some(p => ownerMatches(p, m.aliases))) mineNow.add(ck)
        }
        setMyClients(mineNow)
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
