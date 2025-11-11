'use client'

import { useEffect, useMemo, useState } from 'react'

export type SearchValues = {
  fromStationId: number
  toStationId: number
  date: string
  passengers: number
}

export type StationOption = {
  id: number
  name: string
}

export type StationRelation = {
  from_station_id: number
  to_station_id: number
}

interface SearchCardProps {
  stations: StationOption[]
  relations: StationRelation[]
  loading?: boolean
  onSearch: (values: SearchValues) => void
}

const PASSENGER_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8]

export default function SearchCard({ stations, relations, loading = false, onSearch }: SearchCardProps) {
  const [fromStation, setFromStation] = useState<number | null>(null)
  const [toStation, setToStation] = useState<number | null>(null)
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [passengers, setPassengers] = useState<number>(1)

  const reachableMap = useMemo(() => {
    const map = new Map<number, Set<number>>()
    for (const rel of relations) {
      if (!map.has(rel.from_station_id)) {
        map.set(rel.from_station_id, new Set())
      }
      map.get(rel.from_station_id)!.add(rel.to_station_id)
    }
    return map
  }, [relations])

  useEffect(() => {
    if (!stations.length) {
      setFromStation(null)
      setToStation(null)
      return
    }

    const fallbackFrom = stations.find((st) => {
      const reachable = reachableMap.get(st.id)
      return reachable && reachable.size > 0
    })?.id

    setFromStation((prev) => {
      if (prev && reachableMap.get(prev)?.size) {
        return prev
      }
      if (fallbackFrom !== undefined) {
        return fallbackFrom
      }
      return stations[0]?.id ?? null
    })
  }, [stations, reachableMap])

  const toOptions = useMemo(() => {
    if (!fromStation) return []
    const reachable = reachableMap.get(fromStation)
    if (!reachable || !reachable.size) return []
    return stations.filter((st) => reachable.has(st.id))
  }, [fromStation, reachableMap, stations])

  useEffect(() => {
    if (!fromStation) {
      setToStation(null)
      return
    }
    setToStation((prev) => {
      if (prev && toOptions.some((opt) => opt.id === prev)) {
        return prev
      }
      return toOptions[0]?.id ?? null
    })
  }, [fromStation, toOptions])

  const canSubmit = Boolean(fromStation && toStation && !loading)

  const handleSubmit = () => {
    if (!canSubmit || !fromStation || !toStation) return
    onSearch({ fromStationId: fromStation, toStationId: toStation, date, passengers })
  }

  return (
    <div className="bg-white/5 shadow-soft rounded-3xl p-4 sm:p-6 md:p-8 ring-1 ring-white/10">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-white/60 mb-2">Plecare din</label>
          <select
            value={fromStation ?? ''}
            onChange={(e) => setFromStation(Number(e.target.value) || null)}
            className="select"
            disabled={loading || !stations.length}
          >
            {stations.map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-white/60 mb-2">Destinație</label>
          <select
            value={toStation ?? ''}
            onChange={(e) => setToStation(Number(e.target.value) || null)}
            className="select"
            disabled={loading || !toOptions.length}
          >
            {toOptions.map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-white/60 mb-2">Data</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
            min={new Date().toISOString().slice(0, 10)}
            disabled={loading}
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-white/60 mb-2">Pasageri</label>
          <select
            value={passengers}
            onChange={(e) => setPassengers(Number(e.target.value))}
            className="select"
            disabled={loading}
          >
            {PASSENGER_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-6 space-y-3 sm:flex sm:items-center sm:justify-between sm:space-y-0">
        <p className="text-xs text-white/60 sm:max-w-sm">
          Verificăm automat disponibilitatea și rutele compatibile. Poți ajusta ulterior numărul de pasageri și codul promoțional.
        </p>
        <button className="btn-primary w-full sm:w-auto sm:min-w-[180px]" onClick={handleSubmit} disabled={!canSubmit}>
          <span className="inline-flex size-2 rounded-full bg-emerald-400 animate-pulse mr-2" />
          Caută curse
        </button>
      </div>
    </div>
  )
}
