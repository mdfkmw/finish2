import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CalendarWrapper from './CalendarWrapper';
import { getBestAvailableSeat } from './reservationLogic';
import SeatMap from './SeatMap';
import ConfirmModal from './ConfirmModal';
import { format } from 'date-fns';

const turOrder = [
  'Botoșani – Iași',
  'Botoșani – București',
  'Dorohoi – Botoșani – Iași',
  'Botoșani – Brașov',
  'Iași – Rădăuți',
];

const returOrder = [
  'Iași – Botoșani',
  'București – Botoșani',
  'Iași – Dorohoi – Botoșani',
  'Brașov – Botoșani',
  'Rădăuți – Iași',
];

const normalizeDirection = (value) => (value === 'retur' ? 'retur' : 'tur');

const sortEntries = (entries, order) => {
  return [...entries].sort((a, b) => {
    const idxA = order.indexOf(a.route.name);
    const idxB = order.indexOf(b.route.name);
    if (idxA === -1 && idxB === -1) {
      return a.route.name.localeCompare(b.route.name);
    }
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });
};

export default function MoveToOtherTripPanel({ onClose, moveToOtherTripData, onMoveSuccess, stops: _stops = [] }) {
  const {
    passenger,
    reservation_id,
    boardAt,
    exitAt,
    originalTime,
    originalRouteId,
    originalDate,
    originalScheduleId,
    originalDirection,
    originalSchedule,
  } = moveToOtherTripData || {};

  const normalizedOriginalDirection = originalDirection ? normalizeDirection(originalDirection) : null;

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = originalDate ? new Date(originalDate) : new Date();
    return isNaN(d) ? new Date() : d;
  });
  const [routeDirections, setRouteDirections] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [selectedDirection, setSelectedDirection] = useState(normalizedOriginalDirection);
  const [selectedStations, setSelectedStations] = useState([]);
  const [selectedStops, setSelectedStops] = useState([]);
  const [selectedSchedule, setSelectedSchedule] = useState(originalSchedule || null);
  const [newSeats, setNewSeats] = useState([]);
  const [autoSelectedSeat, setAutoSelectedSeat] = useState(null);
  const [toast, setToast] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ done: 0, total: 0 });
  const [tripVehicles, setTripVehicles] = useState([]);
  const [selectedTripVehicle, setSelectedTripVehicle] = useState(null);

  const stopsCacheRef = useRef(new Map());

  const selectedScheduleId = selectedSchedule?.scheduleId ?? selectedSchedule?.id ?? null;
  const selectedHour = selectedSchedule?.departure ?? (typeof selectedSchedule?.time === 'string' ? selectedSchedule.time : null);
  const effectiveDirection = selectedSchedule?.direction
    ? normalizeDirection(selectedSchedule.direction)
    : selectedDirection || normalizedOriginalDirection || null;

  const toggleSeat = useCallback((seat) => {
    setAutoSelectedSeat((prev) => (prev && prev.id === seat.id ? null : seat));
  }, []);

  const getStationIdForName = useCallback(
    (name) => {
      if (!name) return null;
      const match = selectedStations.find((s) => s.name === name);
      return match ? match.station_id : null;
    },
    [selectedStations],
  );

  const getStationNameForId = useCallback(
    (id) => {
      if (id === null || id === undefined) return '';
      const match = selectedStations.find((s) => s.station_id === id);
      return match ? match.name : '';
    },
    [selectedStations],
  );

  const hydrateSeats = useCallback(
    (payload) => {
      if (!Array.isArray(payload)) return payload;

      return payload.map((item) => {
        if (Array.isArray(item?.seats)) {
          return { ...item, seats: hydrateSeats(item.seats) };
        }

        if (!item || typeof item !== 'object') return item;

        const passengersList = Array.isArray(item.passengers)
          ? item.passengers.map((p) => ({
              ...p,
              board_at: p.board_at ?? getStationNameForId(p.board_station_id),
              exit_at: p.exit_at ?? getStationNameForId(p.exit_station_id),
            }))
          : [];

        return { ...item, passengers: passengersList };
      });
    },
    [getStationNameForId],
  );

  const fetchStopsForDirection = useCallback(async (routeId, direction) => {
    if (!routeId) return [];
    const norm = normalizeDirection(direction);
    const cacheKey = `${routeId}:${norm}`;
    if (stopsCacheRef.current.has(cacheKey)) {
      return stopsCacheRef.current.get(cacheKey);
    }
    const qs = new URLSearchParams({ direction: norm });
    const res = await fetch(`/api/routes/${routeId}/stations?${qs.toString()}`);
    if (!res.ok) throw new Error('Eroare la citirea stațiilor');
    const rows = await res.json();
    const ordered = Array.isArray(rows)
      ? [...rows].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      : [];
    stopsCacheRef.current.set(cacheKey, ordered);
    return ordered;
  }, []);

  const applyRouteSelection = useCallback((entry, preferredScheduleId, preferredTime) => {
    if (!entry) return;
    const { route, direction, stops: routeStops } = entry;
    setSelectedRoute(route);
    setSelectedDirection(direction);
    setSelectedStations(routeStops);
    setSelectedStops(routeStops.map((s) => s.name));
    setToast('');
    setTripVehicles([]);
    setSelectedTripVehicle(null);
    setNewSeats([]);
    setAutoSelectedSeat(null);

    const scheduleOptions = Array.isArray(route.schedules)
      ? route.schedules.filter((s) => normalizeDirection(s.direction) === direction)
      : [];

    setSelectedSchedule((prevSchedule) => {
      const prevId = prevSchedule?.scheduleId ?? prevSchedule?.id ?? null;
      const prevTime = typeof prevSchedule?.departure === 'string'
        ? prevSchedule.departure
        : (typeof prevSchedule?.time === 'string' ? prevSchedule.time : null);
      return (
        scheduleOptions.find((s) => preferredScheduleId && (s.scheduleId ?? s.id) === preferredScheduleId) ||
        scheduleOptions.find((s) => preferredTime && s.departure === preferredTime) ||
        scheduleOptions.find((s) => prevId && (s.scheduleId ?? s.id) === prevId) ||
        scheduleOptions.find((s) => prevTime && s.departure === prevTime) ||
        scheduleOptions[0] ||
        null
      );
    });
  }, []);

  const handleScheduleSelect = useCallback((schedule) => {
    setToast('');
    setSelectedSchedule(schedule);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingRoutes(true);
        setLoadProgress({ done: 0, total: 0 });
        const res = await fetch('/api/routes');
        const routesPayload = await res.json();
        if (!Array.isArray(routesPayload)) throw new Error('Invalid response');

        const combos = routesPayload.reduce((acc, route) => {
          const flags = ['tur', 'retur'].filter(
            (dir) =>
              Array.isArray(route.schedules) &&
              route.schedules.some((s) => normalizeDirection(s.direction) === dir),
          );
          return acc + flags.length;
        }, 0);
        if (!cancelled) setLoadProgress({ done: 0, total: combos });

        const entries = [];
        for (const route of routesPayload) {
          for (const dir of ['tur', 'retur']) {
            const hasDir =
              Array.isArray(route.schedules) &&
              route.schedules.some((s) => normalizeDirection(s.direction) === dir);
            if (!hasDir) {
              if (!cancelled) {
                setLoadProgress((prev) => ({ done: prev.done + 1, total: combos || prev.total }));
              }
              continue;
            }
            try {
              const stopsRows = await fetchStopsForDirection(route.id, dir);
              const names = stopsRows.map((s) => s.name);
              const ib = boardAt ? names.indexOf(boardAt) : -1;
              const ie = exitAt ? names.indexOf(exitAt) : -1;
              if (ib !== -1 && ie !== -1 && ib < ie) {
                entries.push({ route, direction: dir, stops: stopsRows });
              }
            } catch (err) {
              if (process.env.NODE_ENV !== 'production') {
                console.error('[MoveToOtherTripPanel] failed to load stops', err);
              }
            } finally {
              if (!cancelled) {
                setLoadProgress((prev) => ({ done: prev.done + 1, total: combos || prev.total }));
              }
            }
          }
        }
        if (!cancelled) {
          setRouteDirections(entries);
          if (!entries.length) {
            setToast('Nu există trasee compatibile pentru stațiile selectate.');
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[MoveToOtherTripPanel] route fetch failed', err);
          setToast('Eroare la încărcarea rutelor!');
          setRouteDirections([]);
        }
      } finally {
        if (!cancelled) setLoadingRoutes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardAt, exitAt, fetchStopsForDirection]);

  useEffect(() => {
    if (!routeDirections.length) return;
    const preferredDir = normalizedOriginalDirection;
    let entry = null;
    if (originalRouteId) {
      entry = routeDirections.find(
        (e) =>
          e.route.id === originalRouteId && (!preferredDir || e.direction === preferredDir),
      );
      if (!entry && preferredDir) {
        entry = routeDirections.find((e) => e.route.id === originalRouteId);
      }
    }
    if (!entry) {
      entry = routeDirections[0];
    }
    if (entry) {
      applyRouteSelection(entry, originalScheduleId, originalTime);
    }
  }, [routeDirections, applyRouteSelection, originalRouteId, originalScheduleId, originalTime, normalizedOriginalDirection]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedRoute?.id || !selectedDirection) {
        setSelectedStations([]);
        setSelectedStops([]);
        return;
      }
      try {
        const stopsRows = await fetchStopsForDirection(selectedRoute.id, selectedDirection);
        if (cancelled) return;
        setSelectedStations(stopsRows);
        setSelectedStops(stopsRows.map((s) => s.name));
      } catch (err) {
        if (!cancelled) {
          console.error('[MoveToOtherTripPanel] failed to refresh stops', err);
          setSelectedStations([]);
          setSelectedStops([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRoute, selectedDirection, fetchStopsForDirection]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTripVehicle || !selectedRoute || !selectedScheduleId || !selectedDate) {
      setNewSeats([]);
      setAutoSelectedSeat(null);
      return;
    }
    const boardId = getStationIdForName(boardAt);
    const exitId = getStationIdForName(exitAt);
    if (boardId === null || exitId === null) {
      setNewSeats([]);
      setAutoSelectedSeat(null);
      return;
    }
    const qs = new URLSearchParams({
      route_id: String(selectedRoute.id),
      route_schedule_id: String(selectedScheduleId),
      date: format(selectedDate, 'yyyy-MM-dd'),
      board_station_id: String(boardId),
      exit_station_id: String(exitId),
    });
    if (selectedHour) qs.set('time', selectedHour);
    if (effectiveDirection) qs.set('direction', effectiveDirection);

    fetch(`/api/seats/${selectedTripVehicle.vehicle_id}?${qs.toString()}`)
      .then((res) => res.json())
      .then((seatsData) => {
        if (cancelled) return;
        const hydrated = hydrateSeats(seatsData);
        setNewSeats(Array.isArray(hydrated) ? hydrated : []);
        const bestSeat = getBestAvailableSeat(
          Array.isArray(hydrated) ? hydrated : selectedTripVehicle.seats || [],
          boardAt,
          exitAt,
          selectedStops,
        );
        setAutoSelectedSeat(bestSeat || null);
      })
      .catch(() => {
        if (cancelled) return;
        setToast('Eroare la încărcarea locurilor!');
        setNewSeats([]);
        setAutoSelectedSeat(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedTripVehicle,
    selectedRoute,
    selectedScheduleId,
    selectedDate,
    boardAt,
    exitAt,
    selectedHour,
    effectiveDirection,
    hydrateSeats,
    getStationIdForName,
    selectedStops,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedRoute || !selectedScheduleId || !selectedDate) {
      setNewSeats([]);
      setAutoSelectedSeat(null);
      setTripVehicles([]);
      setSelectedTripVehicle(null);
      return;
    }

    const boardId = getStationIdForName(boardAt);
    const exitId = getStationIdForName(exitAt);
    if (boardId === null || exitId === null) {
      setNewSeats([]);
      setAutoSelectedSeat(null);
      setTripVehicles([]);
      setSelectedTripVehicle(null);
      return;
    }

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const tripParams = new URLSearchParams({
      schedule_id: String(selectedScheduleId),
      route_id: String(selectedRoute.id),
      date: dateStr,
    });
    if (selectedHour) tripParams.set('time', selectedHour);

    fetch(`/api/trips/find?${tripParams.toString()}`)
      .then((res) => res.json())
      .then((tripData) => {
        if (cancelled) return;
        if (!tripData?.id) {
          setTripVehicles([]);
          setSelectedTripVehicle(null);
          setToast('Nu există cursă programată!');
          return;
        }

        const seatParams = new URLSearchParams({
          route_id: String(selectedRoute.id),
          route_schedule_id: String(selectedScheduleId),
          date: dateStr,
          board_station_id: String(boardId),
          exit_station_id: String(exitId),
        });
        if (selectedHour) seatParams.set('time', selectedHour);
        if (effectiveDirection) seatParams.set('direction', effectiveDirection);

        fetch(`/api/seats?${seatParams.toString()}`)
          .then((res) => res.json())
          .then((vehiclesData) => {
            if (cancelled) return;
            const hydrated = hydrateSeats(vehiclesData);
            setTripVehicles(Array.isArray(hydrated) ? hydrated : []);
            if (Array.isArray(hydrated) && hydrated.length > 0) {
              setSelectedTripVehicle(hydrated[0]);
            } else {
              setSelectedTripVehicle(null);
            }
          })
          .catch(() => {
            if (cancelled) return;
            setTripVehicles([]);
            setSelectedTripVehicle(null);
            setToast('Eroare la încărcarea vehiculelor!');
          });
      })
      .catch(() => {
        if (cancelled) return;
        setToast('Eroare la identificarea cursei!');
        setTripVehicles([]);
        setSelectedTripVehicle(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedRoute,
    selectedScheduleId,
    selectedDate,
    boardAt,
    exitAt,
    selectedHour,
    effectiveDirection,
    hydrateSeats,
    getStationIdForName,
  ]);

  const scheduleOptions = useMemo(() => {
    if (!selectedRoute?.schedules) return [];
    if (!selectedDirection && !effectiveDirection) return selectedRoute.schedules;
    const target = normalizeDirection(selectedDirection || effectiveDirection);
    return selectedRoute.schedules.filter((sch) => normalizeDirection(sch.direction) === target);
  }, [selectedRoute, selectedDirection, effectiveDirection]);

  const turEntries = useMemo(
    () => sortEntries(routeDirections.filter((entry) => entry.direction === 'tur'), turOrder),
    [routeDirections],
  );

  const returEntries = useMemo(
    () => sortEntries(routeDirections.filter((entry) => entry.direction === 'retur'), returOrder),
    [routeDirections],
  );

  const handleConfirmMove = async () => {
    if (!autoSelectedSeat || !selectedRoute || !selectedScheduleId || !selectedDate) {
      setToast('Selectează dată, rută, oră și loc!');
      return;
    }
    const boardId = getStationIdForName(boardAt);
    const exitId = getStationIdForName(exitAt);
    if (boardId === null || exitId === null) {
      setToast('Stațiile selectate nu sunt disponibile pe această rută.');
      return;
    }

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const tripParams = new URLSearchParams({
      schedule_id: String(selectedScheduleId),
      route_id: String(selectedRoute.id),
      date: dateStr,
    });
    if (selectedHour) tripParams.set('time', selectedHour);

    const tripRes = await fetch(`/api/trips/find?${tripParams.toString()}`);
    const tripData = await tripRes.json().catch(() => ({}));
    if (!tripRes.ok || !tripData?.id) {
      setToast('Nu există această cursă!');
      return;
    }

    const payload = {
      old_reservation_id: reservation_id,
      new_trip_id: tripData.id,
      new_seat_id: autoSelectedSeat.id,
      board_station_id: boardId,
      exit_station_id: exitId,
      phone: passenger?.phone,
      name: passenger?.name,
    };

    try {
      const res = await fetch('/api/reservations/moveToOtherTrip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(data.error || 'Eroare la mutare!');
        return;
      }

      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: 'Rezervare mutată cu succes!', type: 'success' },
      }));

      onClose();

      onMoveSuccess?.({
        tripId: tripData.id,
        vehicleId: tripData.vehicle_id,
        routeId: selectedRoute.id,
        date: selectedDate,
        hour: selectedHour,
        schedule: selectedSchedule
          ? { ...selectedSchedule, direction: effectiveDirection }
          : null,
      });
    } catch (err) {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: err.message || 'Eroare la mutare!', type: 'error' },
      }));
    }
  };

  const renderRoutesGroup = (title, entries) => (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {loadingRoutes && entries.length === 0 && (
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-600">
            <div className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-transparent animate-spin" />
            <span>
              Se încarcă rutele compatibile… {loadProgress.done}/{loadProgress.total || '—'}
            </span>
          </div>
        )}
        {entries.map((entry) => {
          const isActive = selectedRoute?.id === entry.route.id && selectedDirection === entry.direction;
          return (
            <button
              key={`${entry.route.id}-${entry.direction}`}
              onClick={() => applyRouteSelection(entry)}
              className={`px-3 py-1 rounded border text-sm ${
                isActive
                  ? 'bg-blue-500 text-white border-blue-600'
                  : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-800'
              }`}
            >
              {entry.route.name}
            </button>
          );
        })}
        {!loadingRoutes && entries.length === 0 && (
          <span className="text-sm text-gray-500">Nicio rută disponibilă</span>
        )}
      </div>
    </div>
  );

  const renderHours = () => {
    if (!selectedRoute || !scheduleOptions.length) return null;

    const origDate = originalDate ? new Date(originalDate) : null;

    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Ore disponibile</h3>
        <div className="flex flex-wrap gap-2">
          {scheduleOptions
            .filter((sch) => {
              if (!origDate) return true;
              const isSameRoute = selectedRoute.id === originalRouteId;
              const isSameDate =
                selectedDate.getFullYear() === origDate.getFullYear() &&
                selectedDate.getMonth() === origDate.getMonth() &&
                selectedDate.getDate() === origDate.getDate();
              const sameSchedule =
                (originalScheduleId && sch.scheduleId === originalScheduleId) ||
                (!originalScheduleId && originalTime && sch.departure === originalTime);
              return !(isSameRoute && isSameDate && sameSchedule);
            })
            .map((sch) => {
              const themeColor = sch.themeColor || '#2563eb';
              const isActive = selectedScheduleId === sch.scheduleId;
              const isDisabled = sch.disabledRun || sch.disabledOnline || sch.tripDisabled;
              return (
                <button
                  key={sch.scheduleId}
                  onClick={() => !isDisabled && handleScheduleSelect(sch)}
                  disabled={isDisabled}
                  className={`px-2 py-0 rounded border text-sm ${
                    isActive
                      ? 'bg-blue-500 text-white border-blue-600'
                      : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-800'
                  } ${isDisabled ? 'line-through text-gray-400 cursor-not-allowed' : ''}`}
                  style={{
                    backgroundColor: `${themeColor}20`,
                    borderColor: themeColor,
                  }}
                >
                  {sch.departure}
                </button>
              );
            })}
        </div>
      </div>
    );
  };

  const seatsForMap = useMemo(() => {
    if (Array.isArray(newSeats) && newSeats.length) return newSeats;
    if (selectedTripVehicle?.seats) return selectedTripVehicle.seats;
    return [];
  }, [newSeats, selectedTripVehicle]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-0 overflow-y-auto max-h-[90vh] relative">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">🔄 Mută pe altă cursă</h2>
          <button
            className="text-gray-600 hover:text-black text-2xl"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="p-6 text-gray-700 space-y-4">
          <CalendarWrapper selectedDate={selectedDate} setSelectedDate={setSelectedDate} />

          {renderRoutesGroup('Tururi', turEntries)}
          {renderRoutesGroup('Retururi', returEntries)}
          {renderHours()}

          {tripVehicles.length > 1 && (
            <div className="flex flex-wrap gap-2 items-center">
              {tripVehicles.map((tv, idx) => (
                <button
                  key={tv.vehicle_id || idx}
                  className={`px-3 py-1 rounded border text-sm ${
                    tv.vehicle_id === selectedTripVehicle?.vehicle_id
                      ? 'bg-blue-500 text-white border-blue-600'
                      : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-800'
                  }`}
                  onClick={() => setSelectedTripVehicle(tv)}
                >
                  {tv.vehicle_name || tv.name || `Vehicul ${idx + 1}`} {tv.is_primary ? '(Principal)' : '(Dublură)'}
                </button>
              ))}
            </div>
          )}

          {selectedScheduleId && seatsForMap.length > 0 && (
            <div className="mt-6 flex flex-col items-center">
              <h3 className="text-base font-semibold text-gray-700 mb-2">Alege locul:</h3>
              <SeatMap
                seats={seatsForMap}
                stops={selectedStops}
                selectedSeat={autoSelectedSeat}
                selectedSeats={autoSelectedSeat ? [autoSelectedSeat] : []}
                setSelectedSeats={(arr) => setAutoSelectedSeat(arr[0] || null)}
                toggleSeat={toggleSeat}
                selectedRoute={selectedRoute}
                boardAt={boardAt}
                exitAt={exitAt}
                readOnly={false}
              />
              {autoSelectedSeat && (
                <div className="mt-2 text-green-600 text-base">
                  Loc selectat: {autoSelectedSeat.label}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end mt-8">
            <button
              className="bg-green-600 text-white px-8 py-2 rounded-lg hover:bg-green-700 text-lg font-semibold shadow"
              onClick={() => setShowConfirmModal(true)}
              disabled={!autoSelectedSeat || !selectedScheduleId || !selectedRoute}
            >
              Mută rezervarea
            </button>
          </div>

          {toast && <div className="mt-4 text-center text-red-600 font-semibold">{toast}</div>}
        </div>
      </div>

      <ConfirmModal
        show={showConfirmModal}
        title="Confirmă mutarea"
        message="Ești sigur că vrei să muți această rezervare pe noua cursă și loc?"
        confirmText="Mută"
        cancelText="Renunță"
        onConfirm={async () => {
          setShowConfirmModal(false);
          await handleConfirmMove();
        }}
        onCancel={() => setShowConfirmModal(false)}
      />
    </div>
  );
}