import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { resolveFstWebProfile, type FstWebUserProfile } from '@/lib/cloud/fstWebUsers'
import { isFstAdminEmail } from '@/lib/cloud/fstAdmin'
import {
  fetchWebAccessAllowlist,
  isEmailInWebAllowlist,
} from '@/lib/cloud/webAccessConfig'

type FstAuthContextValue = {
  user: User | null
  loading: boolean
  configured: boolean
  allowlistLoading: boolean
  profile: FstWebUserProfile | null
  isAllowed: boolean
  /** @deprecated use profile.roleId === 'sysadmin' */
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<never>
  logout: () => Promise<void>
}

const FstAuthContext = createContext<FstAuthContextValue | null>(null)

export function FstAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [allowlist, setAllowlist] = useState<string[] | null>(null)
  const [allowlistLoading, setAllowlistLoading] = useState(false)
  const configured = isFirebaseConfigured()

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }
    const auth = getFirebaseAuth()
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [configured])

  useEffect(() => {
    if (!configured || !user?.email) {
      setAllowlist(null)
      setAllowlistLoading(false)
      return
    }
    let cancelled = false
    setAllowlistLoading(true)
    void fetchWebAccessAllowlist()
      .then((list) => {
        if (!cancelled) setAllowlist(list)
      })
      .catch(() => {
        if (!cancelled) setAllowlist(null)
      })
      .finally(() => {
        if (!cancelled) setAllowlistLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [configured, user?.email])

  const login = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password)
  }, [])

  const register = useCallback(async (): Promise<never> => {
    throw new Error('registration_disabled')
  }, [])

  const logout = useCallback(async () => {
    await signOut(getFirebaseAuth())
  }, [])

  const isAllowed = useMemo(() => {
    if (!user?.email) return false
    const key = user.email.trim().toLowerCase()
    if (isFstAdminEmail(key)) return true
    if (isEmailInWebAllowlist(key, allowlist)) return true
    return false
  }, [user?.email, allowlist])

  const profile = useMemo(() => {
    if (!user?.email || !isAllowed) return null
    const resolved = resolveFstWebProfile(user.email, user.uid)
    if (resolved) return resolved
    return {
      email: user.email.trim().toLowerCase(),
      roleId: 'warehouse_keeper' as const,
      displayName: user.displayName || user.email,
      uid: user.uid,
    }
  }, [user, isAllowed])

  const value = useMemo(
    () => ({
      user,
      loading,
      configured,
      allowlistLoading,
      profile,
      isAllowed,
      isAdmin: profile?.roleId === 'sysadmin',
      login,
      register,
      logout,
    }),
    [user, loading, configured, allowlistLoading, profile, isAllowed, login, register, logout],
  )

  return <FstAuthContext.Provider value={value}>{children}</FstAuthContext.Provider>
}

export function useFstAuth(): FstAuthContextValue {
  const ctx = useContext(FstAuthContext)
  if (!ctx) throw new Error('useFstAuth outside provider')
  return ctx
}
