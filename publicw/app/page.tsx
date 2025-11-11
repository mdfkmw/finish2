'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Navbar from '@/components/Navbar'
import SearchCard, { type SearchValues } from '@/components/SearchCard'
import SeatModal from '@/components/SeatModal'
import MapPreviewDialog, { type MapPreviewData } from '@/components/MapPreviewDialog'
import { formatPrice, formatRoDate } from '@/lib/format'
import {
  ApiError,
  createPublicReservation,
  fetchRoutesMeta,
  searchPublicTrips,
  type PromoApplyPayload,
  type PublicTrip,
  type RouteStopDetail,
  type RoutesMeta,
} from '@/lib/api'
import { buildGoogleMapsUrls } from '@/lib/maps'

type TripStopInfo = {
  note: string | null
  time: string | null
  latitude: number | null
  longitude: number | null
}

type ExtendedTrip = PublicTrip & {
  fromName: string
  toName: string
  boardInfo: TripStopInfo | null
  exitInfo: TripStopInfo | null
}

type FeedbackState = { type: 'success' | 'error'; message: string } | null

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

function formatDurationLabel(startValue: string | null | undefined, endValue: string | null | undefined): string | null {
  const start = parseTimeToMinutes(startValue)
  const end = parseTimeToMinutes(endValue)
  if (start == null || end == null) return null
  let diff = end - start
  if (diff < 0) diff += 24 * 60
  if (diff <= 0) return null
  const hours = Math.floor(diff / 60)
  const minutes = diff % 60
  const parts: string[] = []
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (!parts.length) return null
  return parts.join(' ')
}

export default function Page() {
  const [meta, setMeta] = useState<RoutesMeta | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [metaError, setMetaError] = useState<string | null>(null)

  const [searchValues, setSearchValues] = useState<SearchValues | null>(null)
  const [trips, setTrips] = useState<PublicTrip[]>([])
  const [tripsLoading, setTripsLoading] = useState(false)
  const [tripsError, setTripsError] = useState<string | null>(null)

  const [open, setOpen] = useState(false)
  const [activeTrip, setActiveTrip] = useState<ExtendedTrip | null>(null)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [mapPreview, setMapPreview] = useState<MapPreviewData | null>(null)

  useEffect(() => {
    let ignore = false
    setMetaLoading(true)
    setMetaError(null)
    fetchRoutesMeta()
      .then((data) => {
        if (ignore) return
        setMeta(data)
      })
      .catch((err: any) => {
        if (ignore) return
        setMetaError(err?.message || 'Nu am putut încărca stațiile disponibile.')
      })
      .finally(() => {
        if (!ignore) setMetaLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [])

  const stationNameById = useMemo(() => {
    const map = new Map<number, string>()
    meta?.stations.forEach((st) => map.set(st.id, st.name))
    return map
  }, [meta])

  const stopDetailMap = useMemo(() => {
    const map = new Map<string, RouteStopDetail>()
    meta?.stopDetails?.forEach((detail) => {
      const key = `${detail.route_id}|${detail.direction}|${detail.station_id}`
      map.set(key, detail)
    })
    return map
  }, [meta])

  const computeStopTime = useCallback((baseTime: string | null, offsetMinutes: number | null) => {
    if (!baseTime || offsetMinutes == null) return null
    const match = baseTime.trim().match(/^(\d{1,2}):(\d{2})/)
    if (!match) return null
    const base = Number(match[1]) * 60 + Number(match[2])
    if (!Number.isFinite(base)) return null
    const total = (base + Number(offsetMinutes) + 24 * 60) % (24 * 60)
    const hh = String(Math.floor(total / 60)).padStart(2, '0')
    const mm = String(total % 60).padStart(2, '0')
    return `${hh}:${mm}`
  }, [])

  const onlineRoutes = useMemo(() => meta?.routes ?? [], [meta])

  const performSearch = async (values: SearchValues) => {
    setTripsLoading(true)
    setTripsError(null)
    try {
      const data = await searchPublicTrips({
        fromStationId: values.fromStationId,
        toStationId: values.toStationId,
        date: values.date,
        passengers: values.passengers,
      })
      setTrips(data)
    } catch (err: any) {
      const message = err?.message || 'Nu am putut căuta cursele disponibile.'
      setTripsError(message)
      setTrips([])
    } finally {
      setTripsLoading(false)
    }
  }

  const handleSearch = async (values: SearchValues) => {
    setFeedback(null)
    setSearchValues(values)
    await performSearch(values)
  }

  const handleReserve = (trip: ExtendedTrip) => {
    setActiveTrip(trip)
    setOpen(true)
  }

  const handleShowMap = useCallback(
    (title: string, subtitle: string | null | undefined, lat: number | null | undefined, lng: number | null | undefined) => {
      const urls = buildGoogleMapsUrls(lat, lng)
      if (!urls) return
      setMapPreview({
        title,
        subtitle: subtitle ?? null,
        embedUrl: urls.embed,
        directUrl: urls.direct,
      })
    },
    [],
  )

  const handleCloseMap = useCallback(() => setMapPreview(null), [])

  const handleConfirm = async ({
    seats,
    passengers,
    contact,
    promo,
  }: {
    seats: number[]
    passengers: { seatId: number; name: string; discountTypeId: number | null }[]
    contact: { name: string; phone: string; email: string }
    promo?: PromoApplyPayload | null
  }) => {
    if (!activeTrip) return
    try {
      const response = await createPublicReservation({
        trip_id: activeTrip.trip_id,
        board_station_id: activeTrip.board_station_id,
        exit_station_id: activeTrip.exit_station_id,
        seats,
        passengers: passengers.map((passenger) => ({
          seat_id: passenger.seatId,
          name: passenger.name,
          discount_type_id: passenger.discountTypeId ?? null,
        })),
        contact,
        promo: promo ?? null,
      })
      const discount = response.discount_total && response.discount_total > 0
        ? ` Reducere aplicată: -${formatPrice(response.discount_total, response.currency || 'RON')}.`
        : ''
      setFeedback({
        type: 'success',
        message: `Rezervarea a fost înregistrată! Te vom contacta pentru confirmarea locurilor.${discount}`,
      })
      setOpen(false)
      setActiveTrip(null)
      if (searchValues) {
        await performSearch(searchValues)
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        throw err
      }
      if (err instanceof Error) {
        throw err
      }
      throw new Error('Nu am putut finaliza rezervarea.')
    }
  }

  const tripsWithNames: ExtendedTrip[] = useMemo(() => {
    return trips.map((trip) => {
      const fromName = stationNameById.get(trip.board_station_id) || 'Stație'
      const toName = stationNameById.get(trip.exit_station_id) || 'Stație'
      const boardKey = `${trip.route_id}|${trip.direction}|${trip.board_station_id}`
      const exitKey = `${trip.route_id}|${trip.direction}|${trip.exit_station_id}`
      const boardDetail = stopDetailMap.get(boardKey) || null
      const exitDetail = stopDetailMap.get(exitKey) || null
      const boardInfo: TripStopInfo | null = boardDetail
        ? {
            note: boardDetail.note,
            time: computeStopTime(trip.departure_time, boardDetail.offset_minutes ?? null),
            latitude: boardDetail.latitude ?? null,
            longitude: boardDetail.longitude ?? null,
          }
        : null
      const exitInfo: TripStopInfo | null = exitDetail
        ? {
            note: exitDetail.note,
            time: computeStopTime(trip.departure_time, exitDetail.offset_minutes ?? null),
            latitude: exitDetail.latitude ?? null,
            longitude: exitDetail.longitude ?? null,
          }
        : null

      return {
        ...trip,
        fromName,
        toName,
        boardInfo,
        exitInfo,
      }
    })
  }, [trips, stationNameById, stopDetailMap, computeStopTime])

  return (
    <main>
      <Navbar />
      <section className="hero-aurora pb-12 md:pb-20">
        <div className="max-w-6xl mx-auto px-4 pt-16 md:pt-24 relative z-10 space-y-10">
          <div className="bg-black/30 rounded-3xl ring-1 ring-white/10 p-3 shadow-[0_25px_50px_-12px_rgba(15,23,42,0.6)]">
            <SearchCard
              stations={meta?.stations ?? []}
              relations={meta?.relations ?? []}
              loading={metaLoading}
              onSearch={handleSearch}
            />
            {metaError && <p className="text-sm text-rose-300 mt-3 text-center">{metaError}</p>}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 mt-10 md:mt-12" id="rezervari">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl md:text-3xl font-bold">Rezultatele căutării</h2>
          {searchValues && (
            <div className="text-sm text-white/60">
              {stationNameById.get(searchValues.fromStationId) || '—'} →{' '}
              {stationNameById.get(searchValues.toStationId) || '—'} · {formatRoDate(searchValues.date)}
            </div>
          )}
        </div>

        {feedback && feedback.type === 'success' && (
          <div className="mt-6 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-200 px-5 py-4 text-sm">
            {feedback.message}
          </div>
        )}

        {tripsError && (
          <div className="mt-6 rounded-2xl bg-rose-500/10 border border-rose-400/40 text-rose-200 px-5 py-4 text-sm">
            {tripsError}
          </div>
        )}

        {tripsLoading && (
          <div className="mt-10 text-center text-white/70">Se încarcă rezultatele...</div>
        )}

        {!tripsLoading && !tripsError && tripsWithNames.length === 0 && searchValues && (
          <div className="mt-10 text-center text-white/70">Nu există curse disponibile pentru criteriile selectate.</div>
        )}

        <div className="mt-6 grid gap-6">
          {tripsWithNames.map((trip) => {
            const boardTime = trip.boardInfo?.time ?? trip.departure_time
            const exitTime = trip.exitInfo?.time ?? trip.arrival_time
            const durationLabel = formatDurationLabel(boardTime, exitTime)
            const boardMap = buildGoogleMapsUrls(trip.boardInfo?.latitude ?? null, trip.boardInfo?.longitude ?? null)
            const exitMap = buildGoogleMapsUrls(trip.exitInfo?.latitude ?? null, trip.exitInfo?.longitude ?? null)
            const formatLocationLabel = (base: string, note?: string | null) => {
              if (!note) {
                return base
              }

              const normalizedNote = note.trim().replace(/\s+/g, ' ')
              if (!normalizedNote) {
                return base
              }

              return `${base}, ${normalizedNote}`
            }

            const boardTitle = trip.boardInfo?.note?.trim() || trip.fromName
            const exitTitle = trip.exitInfo?.note?.trim() || trip.toName
            const boardLocationLabel = formatLocationLabel(
              trip.fromName,
              trip.boardInfo?.note ?? null,
            )
            const exitLocationLabel = formatLocationLabel(
              trip.toName,
              trip.exitInfo?.note ?? null,
            )
            const parseLocationLabel = (label: string) => {
              const [city, ...restParts] = label.split(',')
              const trimmedCity = city.trim()
              const details = restParts.join(',').trim()

              return {
                city: trimmedCity,
                details: details.length > 0 ? details : null,
              }
            }
            const boardLocationParts = parseLocationLabel(boardLocationLabel)
            const exitLocationParts = parseLocationLabel(exitLocationLabel)
            const boardSubtitle = boardTime ? `Stație urcare · ${boardTime}` : 'Stație urcare'
            const exitSubtitle = exitTime ? `Stație coborâre · ${exitTime}` : 'Stație coborâre'

            return (
              <article key={trip.trip_id} className="trip-card overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-stretch">
                  <div className="flex-1 p-5 md:p-7 space-y-6">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div>
                        <div className="text-white/80 text-sm">
                          <span className="font-semibold text-white">
                            {boardLocationParts.city}
                          </span>
                          {boardLocationParts.details && (
                            <span className="text-white/80">, {boardLocationParts.details}</span>
                          )}
                        </div>
                        <div className="text-3xl font-bold text-brand">{boardTime || '—'}</div>
                        {boardMap && (
                          <button
                            type="button"
                            onClick={() =>
                              handleShowMap(
                                boardTitle,
                                boardSubtitle,
                                trip.boardInfo?.latitude,
                                trip.boardInfo?.longitude,
                              )
                            }
                            className="mt-2 text-xs text-brand hover:underline"
                          >
                            Vezi locația pe hartă
                          </button>
                        )}
                      </div>
                      <div className="flex-1 text-center route-line-demo min-w-[120px]">
                        <span className="text-sm">
                          {boardTime && exitTime ? `${boardTime} → ${exitTime}` : 'Durată variabilă'}
                        </span>
                        <div className="line" />
                        {durationLabel && (
                          <div className="mt-1 text-xs text-white/50">Durată estimată: {durationLabel}</div>
                        )}
                      </div>
                      <div className="md:text-right">
                        <div className="text-white/80 text-sm">
                          <span className="font-semibold text-white">
                            {exitLocationParts.city}
                          </span>
                          {exitLocationParts.details && (
                            <span className="text-white/80">, {exitLocationParts.details}</span>
                          )}
                        </div>
                        <div className="text-3xl font-bold text-brand">
                          {exitTime || '—'}
                        </div>
                        {exitMap && (
                          <button
                            type="button"
                            onClick={() =>
                              handleShowMap(
                                exitTitle,
                                exitSubtitle,
                                trip.exitInfo?.latitude,
                                trip.exitInfo?.longitude,
                              )
                            }
                            className="mt-2 text-xs text-brand hover:underline"
                          >
                            Vezi locația pe hartă
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-3 text-sm text-white/70">
                      <div>
                        <span className="text-white/50">Rută:</span> {trip.route_name}
                      </div>
                      <div>
                        <span className="text-white/50">Locuri disponibile:</span> {trip.available_seats ?? 'n/a'}
                      </div>
                      <div>
                        <span className="text-white/50">Direcție:</span> {trip.direction === 'retur' ? 'Retur' : 'Tur'}
                      </div>
                    </div>
                  </div>
                  <div className="md:w-[220px] bg-white/5 border-t md:border-l border-white/10 grid place-items-center p-6">
                    <div className="text-center space-y-2">
                      <div className="inline-flex items-baseline justify-center rounded-full bg-brand/20 px-6 py-4">
                        <div className="text-3xl font-extrabold">{formatPrice(trip.price, trip.currency)}</div>
                      </div>
                      <div className="text-xs text-white/70">per loc</div>
                      <button
                        className="btn-primary w-full"
                        onClick={() => handleReserve(trip)}
                        disabled={!trip.can_book}
                      >
                        {trip.can_book ? 'Alege locuri' : 'Indisponibil'}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 mt-16" id="trasee">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold">Trasee disponibile</h2>
            <p className="text-white/70 text-sm md:text-base">
              Traseele pe care le poți rezerva direct online.
            </p>
          </div>
          <div className="text-sm text-white/60">
            {metaLoading ? 'Se încarcă traseele...' : `${onlineRoutes.length} trasee disponibile`}
          </div>
        </div>
        {metaError ? (
          <div className="mt-4 rounded-2xl bg-rose-500/10 border border-rose-400/40 px-4 py-3 text-sm text-rose-200">
            {metaError}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {onlineRoutes.map((route) => {
              const start = route.stations[0] ?? '—'
              const end = route.stations[route.stations.length - 1] ?? '—'
              const middle = route.stations.slice(1, -1)
              return (
                <article
                  key={route.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-soft backdrop-blur"
                >
                  <h3 className="text-lg font-semibold text-white">{route.name}</h3>
                  <p className="mt-2 text-sm text-white/70">
                    {start} → {end}
                  </p>
                  {middle.length > 0 && (
                    <p className="mt-3 text-xs text-white/50">
                      Stații intermediare: {middle.join(', ')}
                    </p>
                  )}
                </article>
              )
            })}
            {!metaLoading && onlineRoutes.length === 0 && (
              <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 px-5 py-6 text-center text-sm text-white/60">
                Momentan nu sunt trasee disponibile online.
              </div>
            )}
          </div>
        )}
      </section>

      <footer className="mt-20 border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-10 text-white/60 text-sm">
          2025 Auto Dimas & Pris Com Univers — Toate drepturile rezervate.
        </div>
      </footer>

      <SeatModal
        isOpen={open}
        onClose={() => {
          setOpen(false)
          setActiveTrip(null)
        }}
        onConfirm={handleConfirm}
        trip={activeTrip}
        travelDate={searchValues?.date ?? null}
      />
      <MapPreviewDialog data={mapPreview} onClose={handleCloseMap} />
    </main>
  )
}
