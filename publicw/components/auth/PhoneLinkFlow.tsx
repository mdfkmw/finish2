'use client'

import { useState, type FormEvent } from 'react'
import { startPhoneLink, verifyPhoneLink } from '@/lib/api'

interface PhoneLinkFlowProps {
  onCompleted?: () => void
}

type Step = 'idle' | 'code-sent' | 'completed'

export default function PhoneLinkFlow({ onCompleted }: PhoneLinkFlowProps) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleStart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (!phone) {
      setError('Introdu numărul de telefon pe care l-ai folosit la rezervările făcute prin agenți.')
      return
    }
    try {
      setLoading(true)
      const response = await startPhoneLink({ phone })
      setRequestId(response.requestId)
      setStep('code-sent')
      setMessage(response.message || 'Ți-am trimis un cod prin SMS. Introdu-l mai jos pentru a confirma.')
    } catch (err: any) {
      const fallback = err?.message || 'Nu am putut trimite codul SMS.'
      setError(fallback)
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (!requestId) {
      setError('Solicitarea de verificare nu a fost inițiată.')
      return
    }
    if (!code) {
      setError('Introdu codul SMS primit.')
      return
    }
    try {
      setLoading(true)
      const response = await verifyPhoneLink({ requestId, code })
      if (response.success) {
        setStep('completed')
        setMessage(response.message || 'Numărul a fost confirmat. Vom sincroniza rezervările tale offline în contul online.')
        onCompleted?.()
      } else {
        setError(response.message || 'Codul introdus nu este valid.')
      }
    } catch (err: any) {
      const fallback = err?.message || 'Nu am putut confirma codul SMS.'
      setError(fallback)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-white">
      <div>
        <h3 className="text-sm font-semibold">Unește rezervările offline</h3>
        <p className="mt-1 text-xs text-white/70">
          Completează numărul de telefon folosit la rezervările telefonice. Îți trimitem un cod prin SMS pentru a-l confirma
          și a lega istoricul de contul online.
        </p>
      </div>

      {step === 'completed' ? (
        <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {message || 'Numărul a fost verificat cu succes.'}
        </p>
      ) : (
        <>
          {error ? (
            <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>
          ) : null}
          {message ? (
            <p className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white/80">{message}</p>
          ) : null}

          {step === 'idle' ? (
            <form onSubmit={handleStart} className="space-y-3">
              <label className="block text-xs font-medium text-white/70" htmlFor="phone-link-number">
                Număr de telefon
              </label>
              <input
                id="phone-link-number"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="07xx xxx xxx"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
              />
              <button
                type="submit"
                className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand/80"
                disabled={loading}
              >
                {loading ? 'Se trimite...' : 'Trimite codul SMS'}
              </button>
            </form>
          ) : null}

          {step === 'code-sent' ? (
            <form onSubmit={handleVerify} className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-white/70" htmlFor="phone-link-code">
                  Cod SMS
                </label>
                <input
                  id="phone-link-code"
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="000000"
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand/80"
                disabled={loading}
              >
                {loading ? 'Verificăm...' : 'Confirmă codul'}
              </button>
            </form>
          ) : null}
        </>
      )}
    </div>
  )
}
