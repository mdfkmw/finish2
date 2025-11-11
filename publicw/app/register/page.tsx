'use client'

import { Suspense, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import SocialLoginButtons from '@/components/auth/SocialLoginButtons'
import { usePublicSession } from '@/components/PublicSessionProvider'
import { registerWithEmail } from '@/lib/api'

function RegisterPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams?.get('redirect') || '/account'
  const { refresh: refreshSession, setSession } = usePublicSession()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setInfo(null)

    if (!phone.trim()) {
      setError('Introdu un număr de telefon pentru a continua.')
      return
    }
    if (password !== confirmPassword) {
      setError('Parolele nu coincid.')
      return
    }

    try {
      setLoading(true)
      const trimmedName = name.trim()
      const response = await registerWithEmail({
        name: trimmedName ? trimmedName : undefined,
        email,
        password,
        phone: phone.trim(),
      })
      if (response.success) {
        if (response.session) {
          setSession(response.session)
          setInfo(response.message || 'Cont creat cu succes! Te redirecționăm în câteva momente.')
          setTimeout(() => {
            router.push(redirectTo || '/')
          }, 600)
        } else if (response.pendingVerification) {
          const fallbackMessage = response.emailSent === false
            ? 'Contul a fost creat, însă nu am putut trimite emailul de confirmare automat. Te rugăm să contactezi echipa Pris-Com pentru activare.'
            : 'Contul a fost creat. Verifică emailul pentru a confirma adresa și a activa accesul la cont.'
          setInfo(response.message || fallbackMessage)
          setName('')
          setEmail('')
          setPhone('')
          setPassword('')
          setConfirmPassword('')
        } else {
          await refreshSession()
          setInfo(response.message || 'Cont creat cu succes!')
          setTimeout(() => {
            router.push(redirectTo || '/')
          }, 600)
        }
      } else {
        setError(response.message || 'Nu am putut finaliza înregistrarea.')
      }
    } catch (err: any) {
      const fallback = err?.message || 'Nu am putut finaliza înregistrarea.'
      setError(fallback)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slatebg text-white">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-12 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-lg space-y-6">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white">
              ← Înapoi la pagina principală
            </Link>
            <h1 className="mt-4 text-3xl font-semibold md:text-4xl">Creează-ți contul Pris Com</h1>
            <p className="mt-2 text-sm text-white/70">
              Înregistrează-te pentru a face și gestiona rezervări mai rapid, direct din aplicația web publică.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold">Înregistrare cu email</h2>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="space-y-1">
                <label htmlFor="register-name" className="block text-xs font-medium text-white/70">
                  Nume complet
                </label>
                <input
                  id="register-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
                  placeholder="Ex. Maria Popescu"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="register-email" className="block text-xs font-medium text-white/70">
                  Email
                </label>
                <input
                  id="register-email"
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
                <label htmlFor="register-phone" className="block text-xs font-medium text-white/70">
                  Telefon
                </label>
                <input
                  id="register-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
                  placeholder="07xx xxx xxx"
                  required
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="register-password" className="block text-xs font-medium text-white/70">
                  Parolă
                </label>
                <input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
                  placeholder="Minim 8 caractere"
                  required
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="register-password-confirm" className="block text-xs font-medium text-white/70">
                  Confirmă parola
                </label>
                <input
                  id="register-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
                  placeholder="Repetă parola"
                  required
                />
              </div>

              {error ? <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
              {info ? <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{info}</p> : null}

              <button
                type="submit"
                className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand/80 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
              >
                {loading ? 'Se creează contul...' : 'Creează contul'}
              </button>
            </form>

            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-white/40">
                <span className="h-px flex-1 bg-white/10" aria-hidden />
                sau
                <span className="h-px flex-1 bg-white/10" aria-hidden />
              </div>
              <SocialLoginButtons redirectTo={redirectTo} variant="register" />
            </div>
          </div>

          <p className="text-sm text-white/70">
            Ai deja cont?{' '}
            <Link href={`/login?redirect=${encodeURIComponent(redirectTo)}`} className="text-white hover:underline">
              Intră în cont
            </Link>
          </p>
        </div>

        <div className="w-full max-w-xs rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-lg font-semibold">De ce să îți faci cont?</h2>
          <ul className="mt-4 space-y-3 text-sm text-white/70">
            <li>✔️ Rezervări salvate și istoricul biletelor într-un singur loc.</li>
            <li>✔️ Notificări rapide prin email despre confirmări și modificări.</li>
            <li>✔️ Pregătim conectarea cu numărul tău de telefon pentru rezervările făcute la agenți.</li>
          </ul>
          <p className="mt-4 text-xs text-white/50">
            Poți actualiza datele oricând din cont și vei putea alege ulterior dacă imporți și rezervările făcute offline.
          </p>
        </div>
      </div>
    </main>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slatebg" />}>
      <RegisterPageContent />
    </Suspense>
  )
}
