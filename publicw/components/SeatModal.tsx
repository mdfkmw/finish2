'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  DiscountTypeOption,
  IntentInfo,
  PromoApplyPayload,
  PublicTrip,
  SeatInfo,
  SeatMapResponse,
  SeatVehicle,
} from '@/lib/api'
import { ApiError, createIntent, deleteIntent, fetchTripDiscountTypes, fetchTripIntents, fetchTripSeatMap, validatePromoCode } from '@/lib/api'
import { usePublicSession } from '@/components/PublicSessionProvider'
import { formatPrice, formatRoDate } from '@/lib/format'
import MapPreviewDialog, { type MapPreviewData } from '@/components/MapPreviewDialog'
import { buildGoogleMapsUrls } from '@/lib/maps'

type SeatPassenger = {
  seatId: number
  name: string
  discountTypeId: number | null
}

type ContactInfo = {
  name: string
  phone: string
  email: string
}

type TripStopInfo = {
  note: string | null
  time: string | null
  latitude: number | null
  longitude: number | null
}

type ConfirmPayload = {
  seats: number[]
  passengers: SeatPassenger[]
  contact: ContactInfo
  promo?: PromoApplyPayload | null
}

export type SeatModalProps = {
  isOpen: boolean
  onClose: () => void
  onConfirm: (payload: ConfirmPayload) => Promise<void>
  trip: (PublicTrip & { fromName: string; toName: string; boardInfo: TripStopInfo | null; exitInfo: TripStopInfo | null }) | null
  travelDate?: string | null
}

const VEHICLE_TAB_CLASS = 'px-4 py-2 rounded-full text-sm font-semibold transition-colors'

function computeDiscountAmount(basePrice: number, discount: DiscountTypeOption | null | undefined): number {
  const priceValue = Number(basePrice)
  if (!discount || !Number.isFinite(priceValue) || priceValue <= 0) return 0
  const rawValue = Number(discount.value_off)
  if (!Number.isFinite(rawValue) || rawValue <= 0) return 0
  let computed = 0
  if (discount.type === 'percent') {
    computed = +(priceValue * rawValue / 100).toFixed(2)
  } else {
    computed = rawValue
  }
  if (!Number.isFinite(computed) || computed <= 0) return 0
  if (computed > priceValue) return priceValue
  return Number(computed.toFixed(2))
}

export default function SeatModal({ isOpen, onClose, onConfirm, trip, travelDate }: SeatModalProps) {
  const router = useRouter()
  const { session } = usePublicSession()
  const [seatData, setSeatData] = useState<SeatMapResponse | null>(null)
  const [activeVehicle, setActiveVehicle] = useState<number | null>(null)
  const [selectedSeats, setSelectedSeats] = useState<number[]>([])
  const selectedSeatsRef = useRef<number[]>([])
  const [contact, setContact] = useState<ContactInfo>({ name: '', phone: '', email: '' })
  const [contactNameTouched, setContactNameTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const [promoFeedback, setPromoFeedback] = useState<string | null>(null)
  const [promoLoading, setPromoLoading] = useState(false)
  const [appliedPromo, setAppliedPromo] = useState<PromoApplyPayload | null>(null)
  const [seatFeedback, setSeatFeedback] = useState<string | null>(null)
  const [mapPreview, setMapPreview] = useState<MapPreviewData | null>(null)
  const [intentHolds, setIntentHolds] = useState<Map<number, 'mine' | 'other'>>(new Map())
  const [discountTypes, setDiscountTypes] = useState<DiscountTypeOption[]>([])
  const [discountTypesLoading, setDiscountTypesLoading] = useState(false)
  const [discountTypesError, setDiscountTypesError] = useState<string | null>(null)
  const [passengerDetails, setPassengerDetails] = useState<Record<number, { name: string; discountTypeId: number | null }>>({})
  const lastSeatCountRef = useRef(0)
  const intentTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const seatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTripIdRef = useRef<number | null>(null)
  const previousDiscountSignatureRef = useRef<string>('')
  const showMapPreview = useCallback(
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

  const closeMapPreview = useCallback(() => setMapPreview(null), [])
  const accountContact = useMemo(() => {
    if (!session) {
      return { name: '', phone: '', email: '' }
    }
    const rawName = session.user.name?.trim() || ''
    const email = session.user.email?.trim() || ''
    const phone = session.user.phone?.trim() || ''
    const name = rawName || email
    return {
      name,
      phone,
      email,
    }
  }, [session])
  const hasAccountContact = Boolean(session)

  const refreshIntents = useCallback(async (): Promise<Map<number, 'mine' | 'other'> | null> => {
    if (!trip) return null
    try {
      const data = await fetchTripIntents(trip.trip_id)
      const map = new Map<number, 'mine' | 'other'>()
      data.forEach((intent: IntentInfo) => {
        const seatId = Number(intent.seat_id)
        if (!Number.isFinite(seatId)) return
        map.set(seatId, intent.is_mine === 1 ? 'mine' : 'other')
      })
      setIntentHolds(map)
      return map
    } catch {
      return null
    }
  }, [trip])

  const reloadSeatData = useCallback(async (showSpinner = false) => {
    if (!trip) return
    if (showSpinner) {
      setLoading(true)
      setError(null)
    }
    try {
      const data = await fetchTripSeatMap(trip.trip_id, trip.board_station_id, trip.exit_station_id)
      setSeatData(data)
      setActiveVehicle((prev) => {
        if (!data?.vehicles?.length) return null
        if (prev && data.vehicles.some((veh) => veh.vehicle_id === prev)) {
          return prev
        }
        return data.vehicles[0]?.vehicle_id ?? null
      })
    } catch (err: any) {
      if (showSpinner) {
        setError(err?.message || 'Nu am putut încărca diagrama de locuri.')
      }
    } finally {
      if (showSpinner) {
        setLoading(false)
      }
    }
  }, [trip])

  useEffect(() => {
    if (!isOpen || !trip) return

    let cancelled = false
    setError(null)
    setSeatData(null)
    setSelectedSeats([])
    setPassengerDetails({})
    setContact(hasAccountContact ? { ...accountContact } : { name: '', phone: '', email: '' })
    setContactNameTouched(hasAccountContact)
    setSeatFeedback(null)
    setIntentHolds(new Map())

    reloadSeatData(true).then(() => {
      if (!cancelled) {
        refreshIntents()
      }
    })

    if (intentTimerRef.current) {
      clearInterval(intentTimerRef.current)
      intentTimerRef.current = null
    }
    if (seatTimerRef.current) {
      clearInterval(seatTimerRef.current)
      seatTimerRef.current = null
    }

    intentTimerRef.current = setInterval(() => {
      refreshIntents()
    }, 2500)

    seatTimerRef.current = setInterval(() => {
      reloadSeatData(false)
    }, 7000)

    return () => {
      cancelled = true
      if (intentTimerRef.current) {
        clearInterval(intentTimerRef.current)
        intentTimerRef.current = null
      }
      if (seatTimerRef.current) {
        clearInterval(seatTimerRef.current)
        seatTimerRef.current = null
      }
    }
  }, [isOpen, trip, reloadSeatData, refreshIntents, accountContact, hasAccountContact])

  useEffect(() => {
    if (!isOpen || !trip) {
      setDiscountTypes([])
      setDiscountTypesError(null)
      setDiscountTypesLoading(false)
      return
    }

    let cancelled = false
    setDiscountTypesLoading(true)
    setDiscountTypesError(null)

    fetchTripDiscountTypes(trip.trip_id)
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data) ? data : []
        setDiscountTypes(list)
      })
      .catch((err: any) => {
        if (cancelled) return
        setDiscountTypes([])
        setDiscountTypesError(err?.message || 'Nu am putut încărca reducerile disponibile.')
      })
      .finally(() => {
        if (!cancelled) {
          setDiscountTypesLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, trip])

  useEffect(() => {
    if (!isOpen) {
      setSeatData(null)
      setActiveVehicle(null)
      setSelectedSeats([])
      setPassengerDetails({})
      setSubmitError(null)
      setContact({ name: '', phone: '', email: '' })
      setContactNameTouched(false)
      setPromoCode('')
      setPromoFeedback(null)
      setAppliedPromo(null)
      setPromoLoading(false)
      setSeatFeedback(null)
      setIntentHolds(new Map())
      setDiscountTypes([])
      setDiscountTypesError(null)
      setDiscountTypesLoading(false)

      const tripId = trip?.trip_id ?? lastTripIdRef.current
      const seatsToRelease = selectedSeatsRef.current.slice()
      if (tripId && seatsToRelease.length) {
        seatsToRelease.forEach((seatId) => {
          deleteIntent(tripId, seatId).catch(() => {})
        })
      }
      selectedSeatsRef.current = []
    }
  }, [isOpen, trip])

  useEffect(() => {
    if (!isOpen || !hasAccountContact) {
      return
    }
    setContact((prev) => {
      const sameName = prev.name.trim() === accountContact.name
      const samePhone = prev.phone.trim() === accountContact.phone
      const sameEmail = prev.email.trim() === accountContact.email
      if (sameName && samePhone && sameEmail) {
        return prev
      }
      return { ...accountContact }
    })
  }, [isOpen, hasAccountContact, accountContact])

  useEffect(() => {
    selectedSeatsRef.current = selectedSeats
  }, [selectedSeats])

  useEffect(() => {
    setPassengerDetails((prev) => {
      const next: Record<number, { name: string; discountTypeId: number | null }> = {}
      let modified = false
      selectedSeats.forEach((seatId) => {
        if (prev[seatId]) {
          next[seatId] = prev[seatId]
        } else {
          next[seatId] = { name: '', discountTypeId: null }
          modified = true
        }
      })
      if (Object.keys(prev).length !== Object.keys(next).length) {
        modified = true
      }
      return modified ? next : prev
    })
  }, [selectedSeats])

  useEffect(() => {
    if (!hasAccountContact || !selectedSeats.length || !accountContact.name) {
      return
    }
    setPassengerDetails((prev) => {
      const firstSeatId = selectedSeats[0]
      const existing = prev[firstSeatId] ?? { name: '', discountTypeId: null }
      if (existing.name === accountContact.name) {
        return prev
      }
      return {
        ...prev,
        [firstSeatId]: { ...existing, name: accountContact.name },
      }
    })
  }, [hasAccountContact, accountContact.name, selectedSeats])

  useEffect(() => {
    if (!discountTypes.length) {
      setPassengerDetails((prev) => {
        let changed = false
        const next: Record<number, { name: string; discountTypeId: number | null }> = {}
        Object.entries(prev).forEach(([seatId, data]) => {
          const numericSeatId = Number(seatId)
          if (data.discountTypeId !== null) {
            next[numericSeatId] = { ...data, discountTypeId: null }
            changed = true
          } else {
            next[numericSeatId] = data
          }
        })
        return changed ? next : prev
      })
      return
    }
    const validIds = new Set(discountTypes.map((item) => item.id))
    setPassengerDetails((prev) => {
      let changed = false
      const next: Record<number, { name: string; discountTypeId: number | null }> = {}
      Object.entries(prev).forEach(([seatId, data]) => {
        const numericSeatId = Number(seatId)
        if (data.discountTypeId && !validIds.has(data.discountTypeId)) {
          next[numericSeatId] = { ...data, discountTypeId: null }
          changed = true
        } else {
          next[numericSeatId] = data
        }
      })
      return changed ? next : prev
    })
  }, [discountTypes])

  useEffect(() => {
    if (trip?.trip_id) {
      lastTripIdRef.current = trip.trip_id
    }
  }, [trip])

  useEffect(() => {
    if (!isOpen) {
      setMapPreview(null)
    }
  }, [isOpen])

  useEffect(() => {
    if (!trip || !seatData) return

    const availabilityMap = new Map<
      number,
      { isAvailable: boolean; status: SeatInfo['status']; holdStatus: 'mine' | 'other' | null }
    >()
    seatData.vehicles?.forEach((veh) => {
      veh.seats.forEach((seat) => {
        availabilityMap.set(seat.id, {
          isAvailable: seat.is_available,
          status: seat.status,
          holdStatus: seat.hold_status ?? null,
        })
      })
    })

    const toRemove: number[] = []
    selectedSeatsRef.current.forEach((seatId) => {
      const seat = availabilityMap.get(seatId)
      const hold = intentHolds.get(seatId) ?? seat?.holdStatus ?? null
      const heldByOther = hold === 'other'
      const heldByMe = hold === 'mine'
      const isPartial = seat?.status === 'partial'
      if (!seat || heldByOther || (!isPartial && !seat.isAvailable && !heldByMe)) {
        toRemove.push(seatId)
      }
    })

    if (!toRemove.length) return

    const tripId = trip.trip_id
    setSelectedSeats((prev) => prev.filter((id) => !toRemove.includes(id)))
    toRemove.forEach((seatId) => {
      deleteIntent(tripId, seatId).catch(() => {})
    })
    setSeatFeedback((prev) => prev || 'Unele locuri au devenit indisponibile și au fost eliminate din selecție.')
  }, [seatData, intentHolds, trip])

  useEffect(() => {
    const prevCount = lastSeatCountRef.current
    if (appliedPromo && prevCount !== selectedSeats.length) {
      setAppliedPromo(null)
      if (selectedSeats.length > 0) {
        setPromoFeedback('Selecția locurilor s-a schimbat. Aplică din nou codul de reducere.')
      } else {
        setPromoFeedback(null)
      }
    }
    lastSeatCountRef.current = selectedSeats.length
  }, [selectedSeats.length, appliedPromo])

  const discountSignature = useMemo(() => {
    if (!selectedSeats.length) return ''
    return selectedSeats
      .map((seatId) => passengerDetails[seatId]?.discountTypeId ?? 0)
      .join('|')
  }, [selectedSeats, passengerDetails])

  useEffect(() => {
    if (!isOpen) {
      previousDiscountSignatureRef.current = ''
      return
    }
    const prev = previousDiscountSignatureRef.current
    if (prev && prev !== discountSignature && appliedPromo) {
      setAppliedPromo(null)
      setPromoFeedback('Selecția reducerilor s-a schimbat. Aplică din nou codul de reducere.')
    }
    previousDiscountSignatureRef.current = discountSignature
  }, [discountSignature, appliedPromo, isOpen])

  const currentVehicle = useMemo<SeatVehicle | null>(() => {
    if (!seatData || !Array.isArray(seatData.vehicles)) return null
    if (activeVehicle) {
      return seatData.vehicles.find((veh) => veh.vehicle_id === activeVehicle) ?? seatData.vehicles[0] ?? null
    }
    return seatData.vehicles[0] ?? null
  }, [seatData, activeVehicle])

  const seatLookup = useMemo(() => {
    const map = new Map<number, string>()
    if (seatData?.vehicles) {
      for (const veh of seatData.vehicles) {
        for (const seat of veh.seats) {
          map.set(seat.id, seat.label)
        }
      }
    }
    return map
  }, [seatData])

  const maxRow = useMemo(() => {
    if (!currentVehicle) return 0
    return Math.max(0, ...currentVehicle.seats.map((seat) => Number(seat.row ?? 0)))
  }, [currentVehicle])

  const maxCol = useMemo(() => {
    if (!currentVehicle) return 0
    return Math.max(1, ...currentVehicle.seats.map((seat) => Number(seat.seat_col ?? 1)))
  }, [currentVehicle])

  const discountTypeMap = useMemo(() => {
    const map = new Map<number, DiscountTypeOption>()
    discountTypes.forEach((item) => {
      map.set(item.id, item)
    })
    return map
  }, [discountTypes])

  const subtotal = useMemo(() => {
    if (!trip?.price || !selectedSeats.length) return 0
    return trip.price * selectedSeats.length
  }, [trip, selectedSeats])

  const passengerList = useMemo(
    () =>
      selectedSeats.map((seatId) => {
        const data = passengerDetails[seatId] ?? { name: '', discountTypeId: null }
        const discountOption = data.discountTypeId ? discountTypeMap.get(data.discountTypeId) ?? null : null
        return {
          seatId,
          seatLabel: seatLookup.get(seatId) ?? `Loc ${seatId}`,
          name: data.name,
          discountTypeId: data.discountTypeId ?? null,
          discountOption,
        }
      }),
    [selectedSeats, passengerDetails, seatLookup, discountTypeMap],
  )

  const firstPassengerName = useMemo(() => {
    if (!passengerList.length) return ''
    const base = passengerList[0]?.name ?? ''
    if (!base && hasAccountContact) {
      return accountContact.name
    }
    return base
  }, [passengerList, hasAccountContact, accountContact.name])

  const typeDiscountTotal = useMemo(() => {
    if (!trip?.price || !passengerList.length) return 0
    const base = Number(trip.price)
    if (!Number.isFinite(base) || base <= 0) return 0
    let sum = 0
    passengerList.forEach(({ discountOption }) => {
      sum += computeDiscountAmount(base, discountOption)
    })
    return Number(sum.toFixed(2))
  }, [trip?.price, passengerList])

  const promoDiscountAmount = useMemo(() => {
    if (!appliedPromo || !passengerList.length) return 0
    const perSeatPrice = Number(trip?.price || 0)
    if (!Number.isFinite(perSeatPrice) || perSeatPrice <= 0) return 0
    let potential = 0
    passengerList.forEach(({ discountOption }) => {
      const afterType = Math.max(0, perSeatPrice - computeDiscountAmount(perSeatPrice, discountOption))
      potential += afterType
    })
    if (potential <= 0) return 0
    const raw = Math.min(Number(appliedPromo.discount_amount || 0), potential)
    if (!Number.isFinite(raw) || raw <= 0) return 0
    return Number(raw.toFixed(2))
  }, [appliedPromo, passengerList, trip?.price])

  const totalDiscount = useMemo(() => {
    return Number((typeDiscountTotal + promoDiscountAmount).toFixed(2))
  }, [typeDiscountTotal, promoDiscountAmount])

  const totalDue = useMemo(() => {
    return Math.max(0, subtotal - totalDiscount)
  }, [subtotal, totalDiscount])

  useEffect(() => {
    if (!isOpen || contactNameTouched || hasAccountContact) return
    const trimmed = firstPassengerName.trim()
    setContact((prev) => {
      if (trimmed) {
        if (prev.name.trim() === trimmed) return prev
        return { ...prev, name: trimmed }
      }
      if (!trimmed && prev.name !== '') {
        return { ...prev, name: '' }
      }
      return prev
    })
  }, [firstPassengerName, contactNameTouched, hasAccountContact, isOpen])

  const toggleSeat = useCallback(async (seatId: number) => {
    if (!trip || !currentVehicle) return
    const seat = currentVehicle.seats.find((s) => s.id === seatId)
    if (!seat) return
    if (seat.seat_type === 'driver' || seat.seat_type === 'guide') return

    const holdStatus = intentHolds.get(seatId) ?? seat.hold_status ?? null
    const heldByOther = holdStatus === 'other'
    const isSelected = selectedSeatsRef.current.includes(seatId)

    if (heldByOther) {
      setSeatFeedback('Locul este rezervat temporar de alt client.')
      return
    }

    if (isSelected) {
      setSelectedSeats((prev) => prev.filter((id) => id !== seatId))
      try {
        await deleteIntent(trip.trip_id, seatId)
      } catch {}
      await refreshIntents()
      setSeatFeedback(null)
      return
    }

    try {
      await createIntent({ trip_id: trip.trip_id, seat_id: seatId })
      setSelectedSeats((prev) => [...prev, seatId])
      await refreshIntents()
      setSeatFeedback(null)
    } catch (err: any) {
      setSeatFeedback(err?.message || 'Locul a fost selectat de un alt călător.')
      await reloadSeatData(false)
      await refreshIntents()
    }
  }, [trip, currentVehicle, intentHolds, refreshIntents, reloadSeatData])

  const handleSubmit = async () => {
    if (!trip || !selectedSeats.length) return
    const trimmedName = contact.name.trim()
    const trimmedPhone = contact.phone.trim()
    const trimmedEmail = contact.email.trim()
    const emailValid = /.+@.+\..+/.test(trimmedEmail)
    if (!trimmedName || !trimmedPhone || !trimmedEmail || !emailValid) {
      setSubmitError(
        hasAccountContact
          ? 'Actualizează numele, telefonul și emailul din cont pentru a continua.'
          : 'Completează numele, telefonul și emailul pentru confirmare.',
      )
      return
    }
    const missingPassenger = passengerList.some((passenger, index) => {
      if (hasAccountContact && index === 0) {
        return !(passenger.name.trim() || accountContact.name)
      }
      return !passenger.name.trim()
    })
    if (missingPassenger) {
      setSubmitError('Te rugăm să completezi numele pentru fiecare pasager.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onConfirm({
        seats: selectedSeats,
        passengers: passengerList.map((passenger, index) => ({
          seatId: passenger.seatId,
          name:
            (hasAccountContact && index === 0 ? passenger.name.trim() || accountContact.name : passenger.name.trim()) || '',
          discountTypeId: passenger.discountTypeId ?? null,
        })),
        contact: {
          name: trimmedName,
          phone: trimmedPhone,
          email: trimmedEmail,
        },
        promo: appliedPromo,
      })
    } catch (err: any) {
      if (err instanceof ApiError) {
        const needsProfileUpdate = Boolean((err as ApiError & { payload?: any })?.payload?.needsProfileUpdate)
        if (needsProfileUpdate || err.status === 428) {
          const message = err.message || 'Completează numărul de telefon din cont pentru a continua.'
          setSubmitError(message)
          setSubmitting(false)
          onClose()
          router.push('/account?missing=contact')
          return
        }
        setSubmitError(err.message || 'Nu am putut finaliza rezervarea. Încearcă din nou.')
      } else {
        setSubmitError(err?.message || 'Nu am putut finaliza rezervarea. Încearcă din nou.')
      }
      setSubmitting(false)
      return
    }
    setSubmitting(false)
  }

  const handleApplyPromo = async () => {
    if (!trip) return
    const code = promoCode.trim()
    if (!code) {
      setPromoFeedback('Introdu un cod de reducere înainte de a aplica.')
      return
    }
    if (!selectedSeats.length) {
      setPromoFeedback('Selectează locurile înainte de a aplica un cod.')
      return
    }
    if (!trip.price || trip.price <= 0) {
      setPromoFeedback('Codurile promoționale se pot aplica doar curselor cu tarif afișat.')
      return
    }

    setPromoLoading(true)
    setPromoFeedback(null)
    try {
      const result = await validatePromoCode({
        code,
        trip_id: trip.trip_id,
        board_station_id: trip.board_station_id,
        exit_station_id: trip.exit_station_id,
        seat_count: selectedSeats.length,
        phone: contact.phone,
        discount_type_id: null,
        discount_type_ids: passengerList.map((passenger) => passenger.discountTypeId ?? null),
      })

      if (!result.valid || !result.promo_code_id || !result.discount_amount) {
        setAppliedPromo(null)
        setPromoFeedback(result.reason || 'Codul nu este valabil pentru această rezervare.')
      } else {
        setAppliedPromo({
          code: (result.code || code).toUpperCase(),
          promo_code_id: result.promo_code_id,
          discount_amount: Number(result.discount_amount),
          value_off: Number(result.value_off ?? result.discount_amount),
        })
        const perSeatPriceValue = Number(trip.price || 0)
        let totalAfterType = 0
        passengerList.forEach((passenger) => {
          const afterType = Math.max(0, perSeatPriceValue - computeDiscountAmount(perSeatPriceValue, passenger.discountOption))
          totalAfterType += afterType
        })
        const cappedPromo = Math.min(Number(result.discount_amount), totalAfterType)
        const appliedValue = Math.max(0, cappedPromo)
        const formattedPromo = appliedValue > 0 ? formatPrice(appliedValue, trip.currency) : '0'
        setPromoFeedback(`Reducere aplicată: -${formattedPromo}`)
      }
    } catch (err: any) {
      setAppliedPromo(null)
      setPromoFeedback(err?.message || 'Nu am putut valida codul. Încearcă din nou.')
    } finally {
      setPromoLoading(false)
    }
  }

  const handleRemovePromo = () => {
    setAppliedPromo(null)
    setPromoFeedback('Codul a fost eliminat.')
  }

  if (!isOpen || !trip) return null

  const boardMap = buildGoogleMapsUrls(trip.boardInfo?.latitude ?? null, trip.boardInfo?.longitude ?? null)
  const exitMap = buildGoogleMapsUrls(trip.exitInfo?.latitude ?? null, trip.exitInfo?.longitude ?? null)
  const boardTime = trip.boardInfo?.time ?? trip.departure_time
  const exitTime = trip.exitInfo?.time ?? trip.arrival_time
  const boardTitle = trip.boardInfo?.note?.trim() || trip.fromName
  const exitTitle = trip.exitInfo?.note?.trim() || trip.toName
  const boardSubtitle = boardTime ? `Stație urcare · ${boardTime}` : 'Stație urcare'
  const exitSubtitle = exitTime ? `Stație coborâre · ${exitTime}` : 'Stație coborâre'

  return (
    <>
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="absolute inset-0 grid place-items-center p-4">
          <div className="w-full max-w-5xl rounded-2xl bg-[#1b2338] ring-1 ring-white/10 shadow-soft overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 bg-black/20">
            <div>
              <h3 className="text-2xl font-extrabold">Selectează Locurile Tale</h3>
              <p className="text-sm text-white/60 mt-1">
                {trip.fromName} → {trip.toName}
                {travelDate ? ` · ${formatRoDate(travelDate)}` : ''}
              </p>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white text-xl" aria-label="Închide">
              ×
            </button>
          </div>

          <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center gap-4 text-sm">
            <Legend color="bg-transparent ring-1 ring-white/30" label="Disponibil" />
            <Legend color="bg-brand text-white" label="Selectat" />
            <Legend color="bg-amber-500/80 text-black" label="În curs de rezervare" />
            <Legend color="bg-white/20" label="Ocupat" />
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-6 py-6 space-y-6">
            {loading && <div className="text-center text-white/70">Se încarcă diagrama locurilor...</div>}
            {error && <div className="text-center text-rose-400 font-semibold">{error}</div>}
            {seatFeedback && !loading && !error && (
              <div className="rounded-xl bg-amber-500/15 px-4 py-2 text-sm text-amber-100">
                {seatFeedback}
              </div>
            )}

            {!loading && !error && currentVehicle && (
              <div className="space-y-4">
                {seatData && seatData.vehicles.length > 1 && (
                  <div className="flex flex-wrap gap-3">
                    {seatData.vehicles.map((veh) => {
                      const active = veh.vehicle_id === (currentVehicle?.vehicle_id ?? null)
                      return (
                        <button
                          key={veh.vehicle_id}
                          onClick={() => setActiveVehicle(veh.vehicle_id)}
                          className={`${VEHICLE_TAB_CLASS} ${active ? 'bg-brand text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                        >
                          {veh.vehicle_name}
                          {veh.is_primary ? ' · Principal' : ''}
                        </button>
                      )
                    })}
                  </div>
                )}

                <div className="mx-auto w-full overflow-x-auto">
                  <div
                    className="mx-auto rounded-2xl bg-[#151c2f] ring-1 ring-white/10 p-6"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${maxCol || 1}, minmax(3.5rem, 4rem))`,
                      gridTemplateRows: `repeat(${maxRow + 1}, 4rem)`,
                      gap: '0.75rem',
                      justifyContent: 'center',
                    }}
                  >
                    {currentVehicle.seats.map((seat) => {
                      const hold = intentHolds.get(seat.id) ?? seat.hold_status ?? null
                      const heldByOther = hold === 'other'
                      const heldByMe = hold === 'mine'
                      const isSelected = selectedSeats.includes(seat.id)
                      const isDriver = seat.seat_type === 'driver' || seat.seat_type === 'guide'
                      const isPartial = seat.status === 'partial'
                      const baseUnavailable = seat.status === 'full' || (!isPartial && !seat.is_available && !heldByMe)
                      const isUnavailable = isDriver || heldByOther || baseUnavailable

                      const baseClasses = [
                        'seat',
                        'rounded-xl text-sm font-semibold grid place-items-center transition-all duration-200 ease-out',
                        'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]',
                      ]

                      let stateClasses = ''
                      if (isDriver) {
                        stateClasses = 'bg-white/10 text-white/60 cursor-not-allowed'
                      } else if (heldByOther) {
                        stateClasses = 'bg-amber-500/80 text-black cursor-not-allowed'
                      } else if (isSelected || heldByMe) {
                        stateClasses = 'bg-brand text-white shadow-[0_0_14px_rgba(47,168,79,0.7)] scale-105'
                      } else if (baseUnavailable) {
                        stateClasses = 'bg-white/15 text-white/40 cursor-not-allowed'
                      } else if (seat.status === 'partial') {
                        stateClasses = 'bg-amber-400/80 text-black hover:bg-amber-400'
                      } else {
                        stateClasses = 'bg-white/10 text-white hover:bg-white/20 hover:scale-105'
                      }

                      return (
                        <button
                          key={seat.id}
                          onClick={() => toggleSeat(seat.id)}
                          disabled={isUnavailable}
                          className={[...baseClasses, stateClasses, isSelected ? 'ring-2 ring-white' : ''].join(' ')}
                          style={{
                            gridColumnStart: (seat.seat_col || 1),
                            gridRowStart: (seat.row ?? 0) + 1,
                          }}
                        >
                          {seat.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {(trip.boardInfo || trip.exitInfo) && (
                  <div className="mt-6 rounded-2xl bg-white/5 ring-1 ring-white/10 p-5">
                    <div className="grid gap-4 text-sm text-white md:grid-cols-2">
                      {trip.boardInfo && (
                        <div className="rounded-xl bg-black/30 p-4 space-y-2">
                          <div className="text-xs uppercase tracking-wide text-white/60">Stație urcare</div>
                          {boardTime && <div className="text-lg font-semibold text-white">{boardTime}</div>}
                          {trip.boardInfo.note && (
                            <div className="text-sm text-white/80 leading-relaxed">{trip.boardInfo.note}</div>
                          )}
                          {boardMap && (
                            <button
                              type="button"
                              className="text-xs text-brand hover:underline"
                              onClick={() =>
                                showMapPreview(
                                  boardTitle,
                                  boardSubtitle,
                                  trip.boardInfo?.latitude,
                                  trip.boardInfo?.longitude,
                                )
                              }
                            >
                              Vezi locația pe hartă
                            </button>
                          )}
                        </div>
                      )}
                      {trip.exitInfo && (
                        <div className="rounded-xl bg-black/30 p-4 space-y-2 md:text-right">
                          <div className="text-xs uppercase tracking-wide text-white/60">Stație coborâre</div>
                          {exitTime && <div className="text-lg font-semibold text-white">{exitTime}</div>}
                          {trip.exitInfo.note && (
                            <div className="text-sm text-white/80 leading-relaxed md:text-right">{trip.exitInfo.note}</div>
                          )}
                          {exitMap && (
                            <button
                              type="button"
                              className="text-xs text-brand hover:underline"
                              onClick={() =>
                                showMapPreview(
                                  exitTitle,
                                  exitSubtitle,
                                  trip.exitInfo?.latitude,
                                  trip.exitInfo?.longitude,
                                )
                              }
                            >
                              Vezi locația pe hartă
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-5 space-y-4">
                  <div className="grid md:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1">
                      <div className="text-white/70">Traseu selectat</div>
                      <div className="font-medium">{trip.fromName} → {trip.toName}</div>
                    </div>
                    <div className="space-y-1 md:text-right">
                      <div className="text-white/70">Plecare</div>
                      <div className="font-medium">{trip.departure_time}{travelDate ? `, ${formatRoDate(travelDate)}` : ''}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-white/70">Locuri selectate</div>
                      <div className="font-medium">
                        {selectedSeats.length ? selectedSeats.map((id) => seatLookup.get(id)).filter(Boolean).join(', ') : '-'}
                      </div>
                    </div>
                    <div className="space-y-1 md:text-right">
                      <div className="text-white/70">Total estimat</div>
                      <div className="text-lg font-extrabold">
                        {subtotal > 0 ? formatPrice(subtotal, trip.currency) : '0'}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6 max-w-xl">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs uppercase tracking-wide text-white/60">Pasageri</label>
                        <p className="text-sm text-white/70">
                          {hasAccountContact
                            ? 'Numele titularului este completat automat. Adaugă numele pentru ceilalți pasageri și selectează reducerea potrivită.'
                            : 'Completează numele și, dacă este cazul, selectează reducerea pentru fiecare loc rezervat.'}
                        </p>
                      </div>
                      {discountTypesError && <p className="text-sm text-rose-300">{discountTypesError}</p>}
                      {discountTypesLoading && <p className="text-sm text-white/60">Se încarcă reducerile disponibile...</p>}
                      {!passengerList.length && (
                        <p className="text-sm text-white/60">Selectează cel puțin un loc din diagramă pentru a adăuga pasagerii.</p>
                      )}
                      {passengerList.length > 0 && (
                        <div className="space-y-3">
                          {passengerList.map((passenger, index) => {
                            const isPrimaryPassenger = hasAccountContact && index === 0
                            const displayName = passenger.name || (isPrimaryPassenger ? accountContact.name : '')
                            return (
                              <div
                                key={passenger.seatId}
                                className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 space-y-3"
                              >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-white/80">
                                <span>{passenger.seatLabel}</span>
                                <span className="text-xs uppercase tracking-wide text-white/50">Pasager #{index + 1}</span>
                              </div>
                              <div className="grid gap-3 sm:[grid-template-columns:220px_1fr]">
                                <div>
                                  <label className="block text-xs uppercase tracking-wide text-white/60 mb-2">Categorie</label>
                                  {discountTypes.length > 0 ? (
                                    <select
                                      className="input sm:max-w-[220px]"
                                      value={passenger.discountTypeId ?? ''}
                                      onChange={(e) => {
                                        const value = e.target.value ? Number(e.target.value) : null
                                        setPassengerDetails((prev) => ({
                                          ...prev,
                                          [passenger.seatId]: {
                                            ...(prev[passenger.seatId] ?? { name: '', discountTypeId: null }),
                                            discountTypeId: value,
                                          },
                                        }))
                                      }}
                                      disabled={discountTypesLoading}
                                    >
                                      <option value="">Adult (preț întreg)</option>
                                      {discountTypes.map((item) => (
                                        <option key={item.id} value={item.id}>
                                          {item.label}
                                          {item.type === 'percent'
                                            ? ` · ${item.value_off}%`
                                            : ` · ${formatPrice(item.value_off, trip?.currency || 'RON')}`}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <div className="input bg-white/10 border-transparent text-white/80">
                                      Adult (preț întreg)
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-xs uppercase tracking-wide text-white/60 mb-2">Nume pasager</label>
                                  {isPrimaryPassenger ? (
                                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/80">
                                      <div className="font-semibold text-white">{displayName || '—'}</div>
                                      <div className="text-xs text-white/50">Preluat automat din cont.</div>
                                    </div>
                                  ) : (
                                    <input
                                      type="text"
                                      className="input"
                                      placeholder="Introdu numele complet"
                                      value={displayName}
                                      onChange={(e) => {
                                        const value = e.target.value
                                        setPassengerDetails((prev) => ({
                                          ...prev,
                                          [passenger.seatId]: {
                                            ...(prev[passenger.seatId] ?? { discountTypeId: null }),
                                            name: value,
                                          },
                                        }))
                                      }}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          )})}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="promo-code-input" className="block text-xs uppercase tracking-wide text-white/60">
                        Cod reducere
                      </label>
                      <p className="text-sm text-white/70">Ai un voucher? Introdu-l mai jos și aplică reducerea instant.</p>
                      {appliedPromo && (
                        <p className="text-sm text-emerald-200">
                          Cod activ · <span className="font-semibold">{appliedPromo.code}</span>
                        </p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <input
                          id="promo-code-input"
                          type="text"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                          className="input uppercase tracking-[0.25em] text-sm font-semibold"
                        />
                        <button
                          type="button"
                          onClick={handleApplyPromo}
                          className="btn-primary !py-2.5 w-full sm:w-auto sm:min-w-[160px] disabled:opacity-60 disabled:cursor-not-allowed"
                          disabled={promoLoading}
                        >
                          {promoLoading ? 'Se verifică…' : 'Aplică codul'}
                        </button>
                      </div>

                      {appliedPromo && (
                        <div className="flex flex-col gap-2 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
                          <span>
                            Reducere aplicată: -{formatPrice(promoDiscountAmount, trip.currency)}
                          </span>
                          <button
                            type="button"
                            onClick={handleRemovePromo}
                            className="inline-flex items-center gap-1 text-emerald-200 hover:text-emerald-100"
                          >
                            Elimină codul
                          </button>
                        </div>
                      )}

                      {promoFeedback && (
                        <p className="text-sm text-white/70">{promoFeedback}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1">
                      <div className="text-white/60">Subtotal</div>
                      <div className="font-semibold">
                        {subtotal > 0 ? formatPrice(subtotal, trip.currency) : '0'}
                      </div>
                    </div>
                    {typeDiscountTotal > 0 && (
                      <div className="space-y-1 md:text-right">
                        <div className="text-white/60">Reducere tip</div>
                        <div className="font-semibold text-emerald-300">
                          -{formatPrice(typeDiscountTotal, trip.currency)}
                        </div>
                      </div>
                    )}
                    {promoDiscountAmount > 0 && (
                      <div className="space-y-1 md:text-right">
                        <div className="text-white/60">Reducere cod</div>
                        <div className="font-semibold text-emerald-300">
                          -{formatPrice(promoDiscountAmount, trip.currency)}
                        </div>
                      </div>
                    )}
                    <div className="space-y-1 md:text-right">
                      <div className="text-white/60">Reduceri totale</div>
                      <div className="font-semibold text-emerald-300">
                        {totalDiscount > 0 ? `-${formatPrice(totalDiscount, trip.currency)}` : '0'}
                      </div>
                    </div>
                    <div className="space-y-1 md:text-right md:col-span-2">
                      <div className="text-white/70 uppercase text-xs tracking-wide">Total de plată</div>
                      <div className="text-2xl font-extrabold">
                        {totalDue > 0 ? formatPrice(totalDue, trip.currency) : '0'}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-xs uppercase tracking-wide text-white/60">Date contact</div>
                    {hasAccountContact ? (
                      <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/70 space-y-2">
                        <p>Rezervarea va fi confirmată folosind datele din cont:</p>
                        <ul className="space-y-1">
                          <li className="flex items-center gap-2">
                            <span className="text-white/50 text-xs uppercase tracking-wide">Nume</span>
                            <span className="font-semibold text-white">{accountContact.name || '—'}</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-white/50 text-xs uppercase tracking-wide">Telefon</span>
                            <span className="font-semibold text-white">{accountContact.phone || '—'}</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="text-white/50 text-xs uppercase tracking-wide">Email</span>
                            <span className="font-semibold text-white">{accountContact.email || '—'}</span>
                          </li>
                        </ul>
                        <p className="text-xs text-white/50">Actualizează aceste detalii din pagina „Contul meu”.</p>
                      </div>
                    ) : (
                      <div className="grid md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs uppercase tracking-wide text-white/60 mb-2">Nume complet</label>
                          <input
                            type="text"
                            value={contact.name}
                            onChange={(e) => {
                              setContactNameTouched(true)
                              setContact((prev) => ({ ...prev, name: e.target.value }))
                            }}
                            className="input"
                            placeholder="Introduceți numele"
                          />
                        </div>
                        <div>
                          <label className="block text-xs uppercase tracking-wide text-white/60 mb-2">Telefon</label>
                          <input
                            type="tel"
                            value={contact.phone}
                            onChange={(e) => setContact((prev) => ({ ...prev, phone: e.target.value }))}
                            className="input"
                            placeholder="07xxxxxxxx"
                          />
                        </div>
                        <div>
                          <label className="block text-xs uppercase tracking-wide text-white/60 mb-2">Email</label>
                          <input
                            type="email"
                            value={contact.email}
                            onChange={(e) => setContact((prev) => ({ ...prev, email: e.target.value }))}
                            className="input"
                            placeholder="nume@example.com"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {submitError && (
                    <div className="text-sm text-rose-400">{submitError}</div>
                  )}

                  <button
                    className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={submitting || !selectedSeats.length}
                    onClick={handleSubmit}
                  >
                    {submitting ? 'Se procesează…' : 'Continuă la rezervare 🔒'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
      <MapPreviewDialog data={mapPreview} onClose={closeMapPreview} />
    </>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`inline-block size-6 rounded-md ${color}`} />
      <span className="text-white/80">{label}</span>
    </div>
  )
}
