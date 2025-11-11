import React, { useMemo } from 'react';

const normalize = (value) => (value ?? '').toString().trim().toLowerCase();
const isServiceSeat = (label = '') => {
  const normalized = normalize(label);
  return normalized.includes('șofer') || normalized.includes('sofer') || normalized.includes('ghid');
};

const getSeatOrderValue = (seat) => {
  const label = String(seat?.label ?? '');
  const numberMatch = label.match(/\d+/);
  const numericLabel = numberMatch ? Number(numberMatch[0]) : null;
  const row = Number.isFinite(Number(seat?.row)) ? Number(seat.row) : Number.POSITIVE_INFINITY;
  const col = Number.isFinite(Number(seat?.seat_col)) ? Number(seat.seat_col) : Number.POSITIVE_INFINITY;

  return {
    isService: isServiceSeat(label),
    numericLabel: Number.isFinite(numericLabel) ? numericLabel : Number.POSITIVE_INFINITY,
    row,
    col,
    label,
  };
};

const getPassengerSegments = (passengers = [], stops = []) => {
  if (!Array.isArray(stops) || stops.length < 2) {
    return [];
  }

  const positions = stops.map((stop, index) => ({
    normalized: normalize(stop),
    index,
  }));

  return passengers
    .map((passenger) => {
      const boardIndex = positions.find((pos) => normalize(passenger.board_at) === pos.normalized)?.index ?? -1;
      const exitIndex = positions.find((pos) => normalize(passenger.exit_at) === pos.normalized)?.index ?? -1;

      if (boardIndex === -1 || exitIndex === -1 || exitIndex <= boardIndex) {
        return null;
      }

      return {
        passenger,
        startIndex: boardIndex,
        endIndex: exitIndex,
      };
    })
    .filter(Boolean);
};

const getSeatStatusLabel = ({ activePassengers, heldByOther, heldByMe, seat }) => {
  const label = String(seat?.label ?? '').toLowerCase();
  if (label.includes('șofer') || label.includes('sofer') || label.includes('ghid')) {
    return 'Loc de serviciu';
  }

  if (heldByOther) {
    return 'Rezervare în curs';
  }

  if (heldByMe) {
    return 'Rezervare inițiată de tine';
  }

  if (activePassengers.length === 0) {
    return 'Liber';
  }

  if (activePassengers.length === 1) {
    const passenger = activePassengers[0];
    const name = passenger.name || '(fără nume)';
    return `${name} (${passenger.board_at} → ${passenger.exit_at})`;
  }

  return `${activePassengers.length} pasageri activi`;
};

const getRowHeight = ({ segmentCount, passengerCount }) => {
  const layers = Math.max(segmentCount, passengerCount, 1);
  return 32 + layers * 28;
};

export default function SeatTimeline({ seats = [], stops = [], intentHolds = {} }) {
  const orderedSeats = useMemo(() => {
    if (!Array.isArray(seats)) {
      return [];
    }

    return [...seats]
      .filter((seat) => seat && seat.label)
      .sort((a, b) => {
        const orderA = getSeatOrderValue(a);
        const orderB = getSeatOrderValue(b);

        if (orderA.isService !== orderB.isService) {
          return orderA.isService ? 1 : -1;
        }
        if (orderA.numericLabel !== orderB.numericLabel) {
          return orderA.numericLabel - orderB.numericLabel;
        }
        if (orderA.row !== orderB.row) {
          return orderA.row - orderB.row;
        }
        if (orderA.col !== orderB.col) {
          return orderA.col - orderB.col;
        }
        return orderA.label.localeCompare(orderB.label, 'ro');
      });
  }, [seats]);

  const stopPositions = useMemo(() => {
    if (!Array.isArray(stops) || stops.length === 0) {
      return [];
    }

    const segmentCount = Math.max(stops.length - 1, 1);
    return stops.map((_, index) => ({
      index,
      position: segmentCount === 0 ? 0 : (index / segmentCount) * 100,
    }));
  }, [stops]);

  if (!Array.isArray(stops) || stops.length === 0) {
    return <div className="text-red-500 font-semibold p-4">Nu există stații configurate pentru această rută.</div>;
  }

  return (
    <div className="w-full border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="flex border-b border-gray-200 bg-gray-50">
        <div className="w-44 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Loc / Status
        </div>
        <div className="flex-1 px-6 py-3">
          <div className="relative h-16">
            {stopPositions.map(({ position, index }) => (
              <div
                key={`stop-header-${index}`}
                className="absolute inset-y-0 flex flex-col items-center"
                style={{
                  left: `${position}%`,
                  transform:
                    index === 0
                      ? 'translateX(0%)'
                      : index === stopPositions.length - 1
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)',
                }}
              >
                <div className="px-3 py-1 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded shadow-sm">
                  {stops[index]}
                </div>
                <div className="mt-2 flex-1 border-l border-gray-300" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-200">
        {orderedSeats.map((seat) => {
          const holdInfo = intentHolds?.[seat.id];
          const heldByOther = holdInfo?.isMine === false;
          const heldByMe = holdInfo?.isMine === true;

          const activePassengers = (seat.passengers || []).filter(
            (p) => !p.status || p.status === 'active'
          );
          const segments = getPassengerSegments(activePassengers, stops);

          const rowHeight = getRowHeight({
            segmentCount: segments.length,
            passengerCount: activePassengers.length,
          });
          const statusLabel = getSeatStatusLabel({ activePassengers, heldByOther, heldByMe, seat });

          return (
            <div key={seat.id} className="flex">
              <div className="w-44 px-4 py-3 bg-gray-50 border-r border-gray-200">
                <div className="text-sm font-semibold text-gray-800">{seat.label}</div>
                <div className="mt-1 text-xs text-gray-600 leading-5">
                  {statusLabel}
                </div>
              </div>

              <div className="flex-1 px-6 py-3">
                <div className="relative" style={{ minHeight: rowHeight }}>
                  {stopPositions.map(({ position, index }) => (
                    <div
                      key={`stop-line-${seat.id}-${index}`}
                      className="absolute inset-y-0 border-l border-dashed border-gray-200"
                      style={{ left: `${position}%` }}
                    />
                  ))}

                  {segments.length > 0 ? (
                    segments.map(({ passenger, startIndex, endIndex }, idx) => {
                      const start = stopPositions[startIndex]?.position ?? 0;
                      const end = stopPositions[endIndex]?.position ?? 100;
                      const width = Math.max(end - start, 2);

                      return (
                        <div
                          key={`${seat.id}-${passenger.id || idx}-${startIndex}-${endIndex}`}
                          className="absolute flex flex-col gap-1 rounded-md bg-blue-500/90 text-white text-xs px-3 py-2 shadow-sm"
                          style={{
                            left: `${start}%`,
                            width: `calc(${width}% - 12px)`,
                            top: 8 + idx * 28,
                          }}
                        >
                          <span className="font-semibold truncate">{passenger.name || '(fără nume)'}</span>
                          <span className="text-[11px] whitespace-nowrap opacity-80">
                            {passenger.board_at} → {passenger.exit_at}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                      {heldByOther ? 'Rezervare în curs…' : 'Liber pe tot traseul'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
