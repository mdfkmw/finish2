'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import SocialLoginButtons from '@/components/auth/SocialLoginButtons'
import { usePublicSession } from '@/components/PublicSessionProvider'
import { loginWithEmail, resendEmailVerification } from '@/lib/api'

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams?.get('redirect') || '/account'
  const { refresh: refreshSession, setSession } = usePublicSession()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setPendingVerificationEmail(null)

    if (!email || !password) {
      setError('Introduce adresa de email și parola pentru a continua.')
      return
    }

    try {
      setLoading(true)
      const response = await loginWithEmail({ email, password, remember })
      if (response.success) {
        if (response.session) {
          setSession(response.session)
        } else {
          await refreshSession()
        }
        setInfo(response.message || 'Autentificare reușită. Te redirecționăm către contul tău.')
        setTimeout(() => {
          router.push(redirectTo || '/')
        }, 600)
        setPendingVerificationEmail(null)
      } else {
        if (response.needsVerification) {
          const fallbackMessage = response.emailSent === false
            ? 'Trebuie să confirmi adresa de email, însă nu am putut retrimite automat mesajul. Contactează echipa Pris-Com pentru activare.'
            : 'Verifică emailul pentru a confirma adresa și încearcă din nou după activarea contului.'
          setInfo(response.message || fallbackMessage)
          setPendingVerificationEmail(email)
          setError(null)
        } else {
          setError(response.message || 'Nu am putut finaliza autentificarea.')
          setPendingVerificationEmail(null)
        }
      }
    } catch (err: any) {
      const fallback = err?.message || 'Nu am putut finaliza autentificarea.'
      setError(fallback)
    } finally {
      setLoading(false)
    }
  }

  const handleResendEmail = async () => {
    if (!pendingVerificationEmail) {
      return
    }

    try {
      setResendLoading(true)
      setError(null)
      const response = await resendEmailVerification({ email: pendingVerificationEmail })
      setInfo(response.message || 'Dacă există un cont pentru această adresă, vei primi în scurt timp un email.')
    } catch (err: any) {
      setError(err?.message || 'Nu am putut retrimite emailul de confirmare.')
    } finally {
      setResendLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slatebg text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-lg space-y-6">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white">
              ← Înapoi la pagina principală
            </Link>
            <h1 className="mt-4 text-3xl font-semibold md:text-4xl">Autentifică-te în cont</h1>
            <p className="mt-2 text-sm text-white/70">
              Gestionează-ți rezervările online, vezi istoricul și pregătește-ți rapid următoarea călătorie.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold">Autentificare cu email</h2>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="space-y-1">
                <label htmlFor="login-email" className="block text-xs font-medium text-white/70">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
                  placeholder="nume@exemplu.ro"
                  required
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="login-password" className="block text-xs font-medium text-white/70">
                  Parolă
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
                  placeholder="Parola ta"
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="size-4 rounded border-white/20 bg-black/40 text-brand focus:ring-brand"
                />
                Ține-mă minte pe acest dispozitiv
              </label>

              {error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
              {info ? <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{info}</p> : null}
              {pendingVerificationEmail ? (
                <button
                  type="button"
                  onClick={handleResendEmail}
                  className="w-full rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={resendLoading}
                >
                  {resendLoading ? 'Se retrimite emailul...' : 'Retrimite emailul de confirmare'}
                </button>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand/80 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
              >
                {loading ? 'Se verifică...' : 'Intră în cont'}
              </button>
            </form>

            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-white/40">
                <span className="h-px flex-1 bg-white/10" aria-hidden />
                sau
                <span className="h-px flex-1 bg-white/10" aria-hidden />
              </div>
              <SocialLoginButtons redirectTo={redirectTo} variant="login" />
            </div>
          </div>

          <p className="text-sm text-white/70">
            Nu ai cont?{' '}
            <Link href={`/register?redirect=${encodeURIComponent(redirectTo)}`} className="text-white hover:underline">
              Creează unul în câteva secunde
            </Link>
          </p>
        </div>

        <aside className="w-full max-w-sm space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold">Totul într-un singur cont</h2>
            <p className="mt-2 text-sm text-white/70">
              Odată autentificat, poți continua rapid rezervările începute online și vei găsi într-un singur loc istoricul plăților și datele de călătorie pentru cursele create din contul tău.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold">Ai nevoie de ajutor?</h2>
            <p className="mt-2 text-sm text-white/70">
              Suntem disponibili zilnic pentru a te sprijini cu rezervările online. Ne poți scrie la{' '}
              <a href="mailto:rezervari@pris-com.ro" className="font-semibold text-white hover:underline">
                rezervari@pris-com.ro
              </a>{' '}
              sau la numerele de telefon din{' '}
              <Link href="/contact" className="font-semibold text-white hover:underline">
                pagina de contact
              </Link>
              .
            </p>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slatebg" />}>
      <LoginPageContent />
    </Suspense>
  )
}
