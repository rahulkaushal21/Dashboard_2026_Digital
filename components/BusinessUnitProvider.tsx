'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthProvider'
import { Unit, readUnit, writeUnit, unitFromUrl } from '@/lib/business-unit'

interface UnitState {
  unit: Unit
  setUnit: (u: Unit) => void
  /** Whether this viewer is offered the control at all. */
  canSwitch: boolean
  /** False until the saved choice has been read, so nothing renders a filtered total from the default. */
  ready: boolean
}

const Ctx = createContext<UnitState>({ unit: 'all', setUnit: () => {}, canSwitch: false, ready: true })
export const useUnit = () => useContext(Ctx)

export default function BusinessUnitProvider({ children }: { children: React.ReactNode }) {
  const { profile, email } = useAuth()
  const canSwitch = !!profile?.is_admin

  // Always starts at 'all'. The saved choice is read in an effect rather than in the
  // initial state because this is a static export — localStorage does not exist when the
  // HTML is built, and seeding state from it would hydrate a different tree than was
  // served.
  const [unit, setUnitState] = useState<Unit>('all')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!canSwitch) { setUnitState('all'); setReady(true); return }
    setUnitState(unitFromUrl() ?? readUnit(email))
    setReady(true)
  }, [email, canSwitch])

  const setUnit = (u: Unit) => {
    setUnitState(u)
    writeUnit(email, u)
  }

  return <Ctx.Provider value={{ unit, setUnit, canSwitch, ready }}>{children}</Ctx.Provider>
}
