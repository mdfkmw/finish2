'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  fetchPublicSession,
  logoutPublicSession,
  type AuthSessionInfo,
} from '@/lib/api'

type PublicSessionContextValue = {
  session: AuthSessionInfo | null
  loading: boolean
  refresh: () => Promise<void>
  setSession: (session: AuthSessionInfo | null) => void
  logout: () => Promise<void>
}

const PublicSessionContext = createContext<PublicSessionContextValue | undefined>(undefined)

export function usePublicSession(): PublicSessionContextValue {
  const context = useContext(PublicSessionContext)
  if (!context) {
    throw new Error('usePublicSession must be used within a PublicSessionProvider')
  }
  return context
}

export default function PublicSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSessionInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchPublicSession()
      setSession(data)
    } catch (err) {
      console.warn('[public session] refresh failed:', err)
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const data = await fetchPublicSession()
        if (active) {
          setSession(data)
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[public session] initial load failed:', err)
        }
        if (active) {
          setSession(null)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutPublicSession()
      setSession(null)
    } catch (err) {
      console.warn('[public session] logout failed:', err)
      throw err
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      loading,
      refresh,
      setSession,
      logout,
    }),
    [session, loading, refresh, logout]
  )

  return <PublicSessionContext.Provider value={value}>{children}</PublicSessionContext.Provider>
}
