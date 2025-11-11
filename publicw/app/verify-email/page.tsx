'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { usePublicSession } from '@/components/PublicSessionProvider'
import { verifyEmailToken } from '@/lib/api'

function VerifyEmailPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setSession, refresh: refreshSession } = usePublicSession()

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string>('Confirmăm adresa ta de email...')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = searchParams?.get('token') || ''
    const redirectTo = searchParams?.get('redirect') || '/account'

    if (!token) {
      setStatus('error')
      setError('Linkul de confirmare este invalid sau incomplet. Poți cere un nou email din pagina de autentificare.')
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    ;(async () => {
      try {
        setStatus('loading')
        setMessage('Confirmăm adresa ta de email...')
        setError(null)

        const response = await verifyEmailToken({ token })
        if (cancelled) {
          return
        }

        if (response.success) {
          if (response.session) {
            setSession(response.session)
          } else {
            await refreshSession()
            if (cancelled) {
              return
            }
          }

          setMessage(response.message || 'Email confirmat! Te redirecționăm către cont.')
          setStatus('success')

          timeoutId = setTimeout(() => {
            router.replace(redirectTo || '/account')
          }, 1500)
        } else {
          setStatus('error')
          setError(response.message || 'Linkul de verificare nu mai este valid. Cere unul nou din pagina de autentificare.')
        }
      } catch (err: any) {
        if (cancelled) {
          return
        }
        const fallback = err?.message || 'Nu am putut confirma emailul. Încearcă din nou.'
        setStatus('error')
        setError(fallback)
      }
    })()

    return () => {
      cancelled = true
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [refreshSession, router, searchParams, setSession])

  return (
    <main className="min-h-screen bg-slatebg text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-4 py-16 text-center">
        <div className="w-full space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <h1 className="text-3xl font-semibold">Confirmare email</h1>
          {status === 'loading' ? (
            <p className="text-sm text-white/70">{message}</p>
          ) : null}
          {status === 'success' ? (
            <div className="space-y-4">
              <p className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</p>
              <p className="text-sm text-white/70">
                Dacă nu ești redirecționat automat, poți continua către{' '}
                <Link href="/account" className="font-semibold text-white hover:underline">
                  pagina contului tău
                </Link>
                .
              </p>
            </div>
          ) : null}
          {status === 'error' ? (
            <div className="space-y-4">
              <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>
              <p className="text-sm text-white/70">
                Poți încerca din nou să intri în cont și să retrimiți emailul de confirmare din pagina de{' '}
                <Link href="/login" className="font-semibold text-white hover:underline">
                  autentificare
                </Link>
                .
              </p>
            </div>
          ) : null}
          <div className="pt-4 text-sm text-white/60">
            <p>
              Ai ajuns aici din greșeală?{' '}
              <Link href="/" className="font-semibold text-white hover:underline">
                Înapoi la pagina principală
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slatebg" />}>
      <VerifyEmailPageContent />
    </Suspense>
  )
}
