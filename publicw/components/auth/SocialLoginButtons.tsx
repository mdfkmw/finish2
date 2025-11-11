'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { fetchOAuthProviders, type OAuthProvider } from '@/lib/api'

interface SocialLoginButtonsProps {
  redirectTo?: string | null
  variant?: 'login' | 'register'
}

const providers: { id: OAuthProvider; label: string; description?: string; icon: ReactNode }[] = [
  {
    id: 'google',
    label: 'Continuă cu Google',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className="size-5"
        aria-hidden
      >
        <path
          fill="#EA4335"
          d="M12 10.2v3.72h5.18c-.22 1.2-.9 2.22-1.9 2.9l3.06 2.38c1.78-1.64 2.8-4.06 2.8-6.94 0-.74-.06-1.45-.18-2.12H12z"
        />
        <path
          fill="#34A853"
          d="M6.56 14.32l-.87.66-2.45 1.9C4.86 19.5 8.2 21.6 12 21.6c2.16 0 3.98-.72 5.3-1.96l-3.06-2.38c-.84.56-1.9.9-3.1.9-2.4 0-4.44-1.62-5.17-3.84z"
        />
        <path
          fill="#4A90E2"
          d="M3.24 7.56C2.46 9.36 2.46 11.44 3.24 13.24l3.32-2.58c-.2-.56-.3-1.16-.3-1.78s.1-1.22.3-1.78z"
        />
        <path
          fill="#FBBC05"
          d="M12 4.2c1.18 0 2.24.4 3.08 1.2l2.3-2.3C15.98 1.7 14.16.96 12 .96 8.2.96 4.86 3.06 3.24 6.24l3.32 2.58C7.56 6.6 9.6 4.2 12 4.2z"
        />
      </svg>
    ),
  },
  {
    id: 'apple',
    label: 'Continuă cu Apple',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className="size-5"
        aria-hidden
      >
        <path
          fill="currentColor"
          d="M16.48 2.04c0 1.14-.45 2.25-1.25 3.07-.9.97-1.92 1.55-3.11 1.46-.05-1.1.46-2.24 1.26-3.05.9-.97 2.01-1.58 3.1-1.64zM20.8 17.2c-.5 1.17-.74 1.68-1.37 2.72-.9 1.43-2.17 3.2-3.74 3.23-1.38.03-1.83-.93-3.4-.93s-2.06.9-3.35.96c-1.34.05-2.36-1.54-3.26-2.97-1.78-2.73-3.15-7.72-1.32-11.08.91-1.7 2.54-2.77 4.3-2.8 1.34-.03 2.6.93 3.4.93s2.33-1.15 3.93-.98c.67.03 2.55.27 3.76 2.06-.1.06-2.23 1.28-2.2 3.82.02 3.03 2.7 4.03 2.73 4.04z"
        />
      </svg>
    ),
  },
]

type ProviderState = { enabled: boolean; url: string | null; reason?: string | null }

function createEmptyState(): Record<OAuthProvider, ProviderState> {
  return {
    google: { enabled: false, url: null },
    apple: { enabled: false, url: null },
  }
}

export default function SocialLoginButtons({ redirectTo, variant = 'login' }: SocialLoginButtonsProps) {
  const [status, setStatus] = useState<Record<OAuthProvider, ProviderState>>(() => createEmptyState())
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setFeedback(null)

    const loadProviders = async () => {
      try {
        const providersInfo = await fetchOAuthProviders(redirectTo ?? undefined)
        if (!mounted) return
        const next = createEmptyState()
        for (const provider of providersInfo) {
          if (!provider || (provider.id !== 'google' && provider.id !== 'apple')) continue
          next[provider.id] = {
            enabled: Boolean(provider.enabled && provider.url),
            url: provider.url ?? null,
            reason: provider.reason ?? null,
          }
        }
        setStatus(next)
      } catch (err: any) {
        if (!mounted) return
        setFeedback('Momentan autentificarea socială nu este disponibilă. Încearcă din nou mai târziu.')
      }
    }

    loadProviders()

    return () => {
      mounted = false
    }
  }, [redirectTo])

  const handleClick = useCallback(
    (provider: OAuthProvider, label: string) => {
      const info = status[provider]
      if (!info?.enabled || !info.url) {
        setFeedback(`Autentificarea cu ${label} va fi disponibilă în curând.`)
        return
      }
      window.location.href = info.url
    },
    [status],
  )

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => handleClick(provider.id, provider.label)}
          className={`flex w-full items-center justify-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium text-white transition ${
            status[provider.id]?.enabled && status[provider.id]?.url
              ? 'border-white/10 bg-white/5 hover:bg-white/10'
              : 'border-white/5 bg-white/5 text-white/60 hover:bg-white/5 cursor-not-allowed'
          }`}
          aria-disabled={!status[provider.id]?.enabled || !status[provider.id]?.url}
        >
          {provider.icon}
          <span className="flex flex-col items-start">
            <span>{provider.label}</span>
            {!status[provider.id]?.enabled || !status[provider.id]?.url ? (
              <span className="text-[11px] font-normal uppercase tracking-wide text-white/40">În curând</span>
            ) : null}
          </span>
        </button>
      ))}
      {feedback ? <p className="rounded-xl bg-white/10 px-3 py-2 text-center text-xs text-white/80">{feedback}</p> : null}
      <p className="text-center text-xs text-white/60">
        Continuând, ești de acord cu prelucrarea datelor pentru autentificare {variant === 'register' ? 'și crearea contului' : 'în contul tău'}.
      </p>
    </div>
  )
}
