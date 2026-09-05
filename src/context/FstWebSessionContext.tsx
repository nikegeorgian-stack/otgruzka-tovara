import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { AppUser } from '@/lib/access/types'
import {
  buildWebAppUser,
  resolveFstWebProfile,
  type FstWebUserProfile,
} from '@/lib/cloud/fstWebUsers'
import { useFstAuth } from './FstAuthContext'

type FstWebSessionValue = {
  profile: FstWebUserProfile | null
  appUser: AppUser | null
  webLogout: (() => Promise<void>) | null
}

const FstWebSessionContext = createContext<FstWebSessionValue>({
  profile: null,
  appUser: null,
  webLogout: null,
})

export function FstWebSessionProvider({ children }: { children: ReactNode }) {
  const { user, logout, profile: authProfile } = useFstAuth()
  const profile = useMemo((): FstWebUserProfile | null => {
    if (authProfile) return authProfile
    if (!user?.email) return null
    return (
      resolveFstWebProfile(user.email, user.uid) ?? {
        email: user.email.trim().toLowerCase(),
        roleId: 'employee',
        displayName: user.displayName || user.email,
        uid: user.uid,
      }
    )
  }, [authProfile, user?.email, user?.uid, user?.displayName])
  const appUser = useMemo(() => (profile ? buildWebAppUser(profile) : null), [profile])

  const value = useMemo(
    () => ({ profile, appUser, webLogout: user ? logout : null }),
    [profile, appUser, user, logout],
  )

  return <FstWebSessionContext.Provider value={value}>{children}</FstWebSessionContext.Provider>
}

export function useFstWebSession(): FstWebSessionValue {
  return useContext(FstWebSessionContext)
}
