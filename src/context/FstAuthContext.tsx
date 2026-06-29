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

type FstAuthContextValue = {
  user: User | null
  loading: boolean
  configured: boolean
  profile: FstWebUserProfile | null
  isAllowed: boolean
  /** @deprecated use profile.roleId === 'sysadmin' */
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  /** Регистрация отключена — пользователи создаются в Firebase Console. */
  register: (email: string, password: string) => Promise<never>
  logout: () => Promise<void>
}

const FstAuthContext = createContext<FstAuthContextValue | null>(null)

export function FstAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
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

  const login = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password)
  }, [])

  const register = useCallback(async (): Promise<never> => {
    throw new Error('registration_disabled')
  }, [])

  const logout = useCallback(async () => {
    await signOut(getFirebaseAuth())
  }, [])

  const profile = useMemo(
    () => resolveFstWebProfile(user?.email ?? null, user?.uid ?? null),
    [user?.email, user?.uid],
  )

  const value = useMemo(
    () => ({
      user,
      loading,
      configured,
      profile,
      isAllowed: profile !== null,
      isAdmin: profile?.roleId === 'sysadmin',
      login,
      register,
      logout,
    }),
    [user, loading, configured, profile, login, register, logout],
  )

  return <FstAuthContext.Provider value={value}>{children}</FstAuthContext.Provider>
}

export function useFstAuth(): FstAuthContextValue {
  const ctx = useContext(FstAuthContext)
  if (!ctx) throw new Error('useFstAuth outside provider')
  return ctx
}
