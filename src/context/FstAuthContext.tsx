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
import { clearPasswordChangeComplete } from '@/lib/cloud/passwordChangeSession'
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
  mustChangePasswordClaim: boolean
  /** Пока не прочитан первый ID token — не показывать основной UI (избегаем мигания). */
  claimsLoading: boolean
  /** @deprecated use profile.roleId === 'sysadmin' */
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<never>
  logout: () => Promise<void>
  refreshClaims: () => Promise<void>
  dismissMustChangePassword: () => void
}

const FstAuthContext = createContext<FstAuthContextValue | null>(null)

export function FstAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [allowlist, setAllowlist] = useState<string[] | null>(null)
  const [allowlistLoading, setAllowlistLoading] = useState(false)
  const [mustChangePasswordClaim, setMustChangePasswordClaim] = useState(false)
  const [claimsLoading, setClaimsLoading] = useState(false)
  const configured = isFirebaseConfigured()

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }
    const auth = getFirebaseAuth()
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      if (u?.email) {
        // Синхронно с логином — иначе кадр без allowlist → isAllowed=false → logout.
        setAllowlist(null)
        setAllowlistLoading(true)
      } else {
        setAllowlist(null)
        setAllowlistLoading(false)
      }
      setLoading(false)
    })
  }, [configured])

  useEffect(() => {
    if (!configured || !user?.email) {
      return
    }
    let cancelled = false
    const email = user.email.trim().toLowerCase()
    setAllowlistLoading(true)
    void (async () => {
      try {
        let list = await fetchWebAccessAllowlist()
        // После создания учётки allowlist в Firestore может догнать с задержкой — один повтор.
        if (
          !cancelled &&
          !isFstAdminEmail(email) &&
          !isEmailInWebAllowlist(email, list)
        ) {
          await new Promise((r) => setTimeout(r, 900))
          if (!cancelled) list = await fetchWebAccessAllowlist()
        }
        if (!cancelled) setAllowlist(list)
      } catch {
        if (!cancelled) setAllowlist([])
      } finally {
        if (!cancelled) setAllowlistLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [configured, user?.email])

  useEffect(() => {
    if (!configured || !user) {
      setMustChangePasswordClaim(false)
      setClaimsLoading(false)
      return
    }
    let cancelled = false
    setClaimsLoading(true)
    void user.getIdTokenResult().then((result) => {
      if (!cancelled) {
        setMustChangePasswordClaim(result.claims.mustChangePassword === true)
        setClaimsLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [configured, user])

  const login = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password)
  }, [])

  const register = useCallback(async (): Promise<never> => {
    throw new Error('registration_disabled')
  }, [])

  const logout = useCallback(async () => {
    clearPasswordChangeComplete(user?.email)
    await signOut(getFirebaseAuth())
  }, [user?.email])

  const refreshClaims = useCallback(async () => {
    if (!user) {
      setMustChangePasswordClaim(false)
      return
    }
    const result = await user.getIdTokenResult(true)
    setMustChangePasswordClaim(result.claims.mustChangePassword === true)
  }, [user])

  const dismissMustChangePassword = useCallback(() => {
    setMustChangePasswordClaim(false)
  }, [])

  const isAllowed = useMemo(() => {
    if (!user?.email) return false
    const key = user.email.trim().toLowerCase()
    if (isFstAdminEmail(key)) return true
    // Пока allowlist не пришёл — не считаем «запрещён» (гейт ждёт allowlistLoading).
    if (allowlist === null) return false
    if (isEmailInWebAllowlist(key, allowlist)) return true
    return false
  }, [user?.email, allowlist])

  const profile = useMemo(() => {
    if (!user?.email || !isAllowed) return null
    const resolved = resolveFstWebProfile(user.email, user.uid)
    if (resolved) return resolved
    // Неизвестная учётка в allowlist — по умолчанию личный кабинет, не склад/табель.
    return {
      email: user.email.trim().toLowerCase(),
      roleId: 'employee' as const,
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
      mustChangePasswordClaim,
      claimsLoading,
      isAdmin: profile?.roleId === 'sysadmin',
      login,
      register,
      logout,
      refreshClaims,
      dismissMustChangePassword,
    }),
    [
      user,
      loading,
      configured,
      allowlistLoading,
      profile,
      isAllowed,
      mustChangePasswordClaim,
      claimsLoading,
      login,
      register,
      logout,
      refreshClaims,
      dismissMustChangePassword,
    ],
  )

  return <FstAuthContext.Provider value={value}>{children}</FstAuthContext.Provider>
}

export function useFstAuth(): FstAuthContextValue {
  const ctx = useContext(FstAuthContext)
  if (!ctx) throw new Error('useFstAuth outside provider')
  return ctx
}

export function useFstAuthOptional(): FstAuthContextValue | null {
  return useContext(FstAuthContext)
}
