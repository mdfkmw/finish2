'use client'

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import Navbar from '@/components/Navbar'
import { usePublicSession } from '@/components/PublicSessionProvider'
import {
  fetchAccountReservations,
  updatePublicProfile,
  type AccountReservation,
  type AccountReservationsResponse,
} from '@/lib/api'
import { formatRoDate } from '@/lib/format'

type StatusMeta = { label: string; className: string }

function formatCurrency(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) {
    return '—'
  }
  try {
    return new Intl.NumberFormat('ro-RO', {
      style: 'currency',
      currency: currency || 'RON',
      minimumFractionDigits: 0,
    }).format(Number(value))
  } catch {
    return `${value} ${currency || 'RON'}`
  }
}

function formatTimeLabel(value: string | null | undefined): string {
  if (!value) return '—'
  if (value.length >= 5) return value.slice(0, 5)
  return value
}

function getStatusMeta(status: string | null | undefined): StatusMeta {
  const value = (status || '').toLowerCase()
  switch (value) {
    case 'active':
    case 'confirmed':
      return { label: 'Confirmată', className: 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30' }
    case 'pending':
    case 'held':
      return { label: 'În curs', className: 'bg-amber-500/15 text-amber-200 border border-amber-400/30' }
    case 'cancelled':
    case 'canceled':
      return { label: 'Anulată', className: 'bg-rose-500/15 text-rose-200 border border-rose-400/40' }
    case 'completed':
      return { label: 'Finalizată', className: 'bg-sky-500/15 text-sky-200 border border-sky-400/30' }
    default:
      return { label: status || 'Necunoscut', className: 'bg-white/10 text-white/80 border border-white/20' }
  }
}

function ReservationCard({
  reservation,
  fallbackPassengerName,
}: {
  reservation: AccountReservation
  fallbackPassengerName: string
}) {
  const statusMeta = getStatusMeta(reservation.status)
  const passengerName = reservation.passenger_name?.trim() || fallbackPassengerName
  const tripDateSource = reservation.trip_date ? `${reservation.trip_date}T00:00:00` : reservation.travel_datetime
  const formattedDate = tripDateSource ? formatRoDate(tripDateSource) : '—'
  const timeLabel = formatTimeLabel(reservation.trip_time)
  const directionLabel = reservation.direction === 'retur' ? 'Retur' : reservation.direction === 'tur' ? 'Tur' : null
  const priceValue = reservation.price_value != null ? Number(reservation.price_value) : null
  const discountValue = reservation.discount_total != null ? Number(reservation.discount_total) : 0
  const paidValue = reservation.paid_amount != null ? Number(reservation.paid_amount) : 0
  const dueValue = priceValue != null ? Number((priceValue - paidValue).toFixed(2)) : null
  const showDiscount = discountValue > 0
  const showPaid = paidValue > 0
  const showDue = dueValue != null && dueValue > 0.01
  const reservationDateLabel = reservation.reservation_time ? formatRoDate(reservation.reservation_time) : null

  return (
    <article className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur p-5 md:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-xl font-semibold text-white">
            {reservation.route_name || 'Cursă'}{' '}
            {directionLabel && <span className="text-sm text-white/60">· {directionLabel}</span>}
          </h3>
          <p className="text-sm text-white/60">
            {formattedDate}
            {timeLabel !== '—' ? ` · ${timeLabel}` : ''}
          </p>
          {reservationDateLabel && (
            <p className="text-xs text-white/40">Rezervare înregistrată la {reservationDateLabel}</p>
          )}
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1 text-xs font-semibold uppercase tracking-wide ${statusMeta.className}`}>
          {statusMeta.label}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-4 text-sm text-white/70">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Pasager:{' '}
              <span className="font-semibold text-white">{passengerName}</span>
            </span>
            <span>
              Loc:{' '}
              <span className="font-semibold text-white">{reservation.seat_label || '—'}</span>
            </span>
            <span className="text-white/40 text-xs uppercase tracking-wide">ID #{reservation.id}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-white/50">Îmbarcare</div>
              <div className="font-medium text-white">{reservation.board_name || '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-white/50">Debarcare</div>
              <div className="font-medium text-white">{reservation.exit_name || '—'}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-4 space-y-2 text-sm text-white/70">
          <div className="text-xs uppercase tracking-wide text-white/50">Total bilet</div>
          <div className="text-2xl font-semibold text-white">
            {formatCurrency(priceValue, reservation.currency)}
          </div>
          {showDiscount && (
            <div className="text-emerald-200 text-sm">
              Reduceri: -{formatCurrency(discountValue, reservation.currency)}
            </div>
          )}
          {showPaid && (
            <div>
              Plătit: <span className="font-medium text-white">{formatCurrency(paidValue, reservation.currency)}</span>
              {reservation.payment_method && (
                <span className="text-white/50"> · {reservation.payment_method}</span>
              )}
            </div>
          )}
          {showDue && (
            <div>
              De achitat: <span className="font-medium text-white">{formatCurrency(dueValue, reservation.currency)}</span>
            </div>
          )}
          {reservation.is_paid ? (
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-200">
              Plătit integral
            </div>
          ) : showDue ? (
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-200">
              Plata se achită la îmbarcare
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function AccountPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session, loading, setSession } = usePublicSession()
  const [reservations, setReservations] = useState<AccountReservationsResponse | null>(null)
  const [reservationsLoading, setReservationsLoading] = useState(false)
  const [reservationsError, setReservationsError] = useState<string | null>(null)
  const [profileName, setProfileName] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileSubmitting, setProfileSubmitting] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null)

  const needsContactUpdate = searchParams?.get('missing') === 'contact'

  const loadReservations = useCallback(async () => {
    if (!session) return
    setReservationsLoading(true)
    setReservationsError(null)
    try {
      const data = await fetchAccountReservations()
      setReservations(data)
    } catch (err: any) {
      setReservationsError(err?.message || 'Nu am putut încărca rezervările online.')
    } finally {
      setReservationsLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (!loading && !session) {
      router.replace(`/login?redirect=${encodeURIComponent('/account')}`)
    }
  }, [loading, session, router])

  useEffect(() => {
    if (session) {
      setProfileName(session.user.name?.trim() || '')
      setProfilePhone(session.user.phone?.trim() || '')
      setProfileError(null)
      setProfileSuccess(null)
    }
  }, [session])

  useEffect(() => {
    if (!loading && session) {
      loadReservations()
    }
  }, [loading, session, loadReservations])

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfileError(null)
    setProfileSuccess(null)
    const trimmedName = profileName.trim()
    const trimmedPhone = profilePhone.trim()
    if (!trimmedPhone) {
      setProfileError('Completează numărul de telefon pentru a putea continua rezervările online.')
      return
    }
    try {
      setProfileSubmitting(true)
      const response = await updatePublicProfile({
        name: trimmedName ? trimmedName : null,
        phone: trimmedPhone,
      })
      setProfileSuccess(response.message || 'Datele au fost actualizate.')
      setSession(response.session)
    } catch (err: any) {
      const message = err?.message || 'Nu am putut actualiza profilul.'
      setProfileError(message)
    } finally {
      setProfileSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slatebg text-white">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 py-20 text-center text-white/70">
          Se încarcă datele contului...
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-slatebg text-white">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 py-20 text-center text-white/70">
          Te redirecționăm către autentificare...
        </div>
      </main>
    )
  }

  const displayName = session.user.name?.trim() || session.user.email || 'utilizator'
  const phoneMissing = !session.user.phone || !session.user.phone.trim()
  const accountEmail = session.user.email || ''
  const upcomingReservations = reservations?.upcoming ?? []
  const pastReservations = reservations?.past ?? []
  const initialLoading = reservationsLoading && !reservations

  const renderReservationGroup = (items: AccountReservation[], emptyMessage: string) => {
    if (!items.length) {
      if (initialLoading && !reservationsError) {
        return <p className="text-sm text-white/60">Se încarcă rezervările...</p>
      }
      return <p className="text-sm text-white/60">{emptyMessage}</p>
    }
    return (
      <div className="space-y-4">
        {items.map((reservation) => (
          <ReservationCard
            key={reservation.id}
            reservation={reservation}
            fallbackPassengerName={displayName}
          />
        ))}
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-slatebg text-white">
      <Navbar />
      <section className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <p className="text-sm uppercase tracking-wide text-white/50">Contul tău</p>
          <h1 className="mt-2 text-3xl font-semibold">Bine ai revenit, {displayName}!</h1>
          <p className="mt-3 text-sm text-white/70">
            Rezervările realizate online sunt afișate mai jos. Rezervările efectuate telefonic sau la autogară nu sunt sincronizate automat cu contul online.
          </p>
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur px-5 py-6 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Datele contului</h2>
              <p className="text-sm text-white/60">Actualizează numele și numărul de telefon folosite pentru rezervările online.</p>
            </div>
            {phoneMissing && (
              <span className="inline-flex items-center rounded-full border border-amber-300/40 bg-amber-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-100">
                Telefon lipsă
              </span>
            )}
          </div>

          {needsContactUpdate && (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Completează numărul de telefon pentru a finaliza rezervarea începută. După salvare, reia procesul de rezervare.
            </div>
          )}

          {profileError && (
            <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{profileError}</p>
          )}
          {profileSuccess && (
            <p className="rounded-2xl border border-emerald-300/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{profileSuccess}</p>
          )}

          <form onSubmit={handleProfileSubmit} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="account-email" className="block text-xs font-medium uppercase tracking-wide text-white/50">
                Email
              </label>
              <input
                id="account-email"
                type="email"
                value={accountEmail}
                readOnly
                disabled
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/70"
              />
            </div>
            <div>
              <label htmlFor="account-name" className="block text-xs font-medium text-white/70">
                Nume complet
              </label>
              <input
                id="account-name"
                type="text"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                autoComplete="name"
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
                placeholder="Ex. Maria Popescu"
              />
            </div>
            <div>
              <label htmlFor="account-phone" className="block text-xs font-medium text-white/70">
                Telefon
              </label>
              <input
                id="account-phone"
                type="tel"
                inputMode="tel"
                value={profilePhone}
                onChange={(event) => setProfilePhone(event.target.value)}
                autoComplete="tel"
                className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
                placeholder="07xx xxx xxx"
                required
              />
            </div>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand/80 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={profileSubmitting}
              >
                {profileSubmitting ? 'Se salvează...' : 'Salvează modificările'}
              </button>
              <p className="text-xs text-white/50">Numărul de telefon este folosit pentru confirmarea rezervărilor online.</p>
            </div>
          </form>
        </section>

        {reservationsError && (
          <div className="rounded-3xl border border-rose-400/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{reservationsError}</span>
            <button
              type="button"
              onClick={loadReservations}
              className="inline-flex items-center justify-center rounded-lg border border-rose-200/40 px-3 py-1.5 text-sm font-semibold text-rose-50 transition hover:bg-rose-500/20"
            >
              Încearcă din nou
            </button>
          </div>
        )}

        <section className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur px-5 py-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-white">Rezervări viitoare</h2>
            {reservationsLoading && (
              <span className="text-xs uppercase tracking-wide text-white/50">Se actualizează…</span>
            )}
          </div>
          {renderReservationGroup(upcomingReservations, 'Nu ai rezervări viitoare în acest moment.')}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur px-5 py-6 space-y-4">
          <h2 className="text-xl font-semibold text-white">Rezervări anterioare</h2>
          {renderReservationGroup(pastReservations, 'Nu există încă rezervări anterioare înregistrate online.')}
        </section>

        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur px-6 py-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 text-sm text-white/70">
            <p className="text-white font-semibold">Planifică următoarea călătorie</p>
            <p className="text-white/60">Caută curse noi și rezervă locurile direct din platformă.</p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-black shadow-soft transition hover:bg-brand/80"
          >
            Caută o cursă nouă
          </Link>
        </div>
      </section>
    </main>
  )
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slatebg text-white">
          <Navbar />
          <div className="max-w-4xl mx-auto px-4 py-20 text-center text-white/70">
            Se încarcă datele contului...
          </div>
        </main>
      }
    >
      <AccountPageContent />
    </Suspense>
  )
}
