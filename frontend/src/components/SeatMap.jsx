// 📁 components/SeatMap.jsx
import React from 'react';

export default function SeatMap({
  seats,
  stops,
  selectedSeats,
  setSelectedSeats,
  moveSourceSeat,
  setMoveSourceSeat,
  popupPassenger,
  setPopupPassenger,
  popupSeat,
  setPopupSeat,
  popupPosition,
  setPopupPosition,
  handleMovePassenger,
  handleSeatClick,
  toggleSeat,
  isSeatFullyOccupiedViaSegments,
  checkSegmentOverlap,
  selectedRoute,
  setToastMessage,
  setToastType,
  driverName,
  intentHolds = {},
}) {


  /*
  console.log('[SeatMap] Render', {
    selectedRoute,
    stops,
    seats
  });
*/
  if (!Array.isArray(stops) || stops.length === 0) {
    console.log('[SeatMap] NU există stops pe selectedRoute, opresc render-ul SeatMap');
    return <div className="text-red-500 font-bold p-4">Nu există rute sau stații!</div>;
  }





  const maxCol = Math.max(...seats.map(s => s.seat_col || 1));
  const maxRow = Math.max(...seats.map(s => s.row || 1));



  return (
    <div
      className="relative mx-auto"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${maxCol}, 105px)`,   // fiecare seat are 105px
        gridTemplateRows: `repeat(${maxRow + 1}, 100px)`,
        gap: "5px",
        background: "#f3f4f6",
        padding: 16,
        borderRadius: 16,
        width: "fit-content",   // cheia ca să se adapteze la conținut!
        margin: "0 auto",
        minWidth: 0,
        boxSizing: "border-box"
      }}
    >


      {seats.map((seat) => {




        const isSelected = selectedSeats.find((s) => s.id === seat.id);
        const isDriver = seat.label.toLowerCase().includes('șofer');
        const status = seat.status; // 'free', 'partial', 'full'
        const holdInfo = intentHolds?.[seat.id];
        const heldByOther = holdInfo?.isMine === false;
        const heldByMe = holdInfo?.isMine === true;

        let baseColorClass;
        if (seat.label === 'Șofer' || seat.label === 'Ghid' || isDriver) {
          baseColorClass = 'bg-gray-600 cursor-not-allowed';
        } else if (status === 'full') {
          baseColorClass = 'bg-red-600 cursor-not-allowed';
        } else if (heldByOther) {
          baseColorClass = 'bg-orange-500 cursor-not-allowed';
        } else if (status === 'partial') {
          baseColorClass = 'bg-yellow-500 hover:bg-yellow-600';
        } else if (isSelected || heldByMe) {
          baseColorClass = 'bg-blue-500 hover:bg-blue-600';
        } else {
          baseColorClass = 'bg-green-500 hover:bg-green-600';
        }

        // ✅ Pasagerii activi de pe loc
        const activePassengers = (seat.passengers || []).filter(
          p => !p.status || p.status === 'active'
        );



        return (
          <div
            key={seat.id}
            data-seat-id={seat.id}
            onClick={(e) => {
              if (seat.label.toLowerCase().includes('șofer')) return;

              if (heldByOther) {
                setToastMessage('Locul e în curs de rezervare de alt agent');
                setToastType('error');
                setTimeout(() => setToastMessage(''), 3000);
                return;
              }

              if (moveSourceSeat && seat.id !== moveSourceSeat.id) {
                const passengerToMove = moveSourceSeat.passengers?.[0];
                if (!passengerToMove) return;


                const overlapExists = seat.passengers?.some((p) =>
                  checkSegmentOverlap(
                    p,
                    passengerToMove.board_at,
                    passengerToMove.exit_at,
                    stops
                  )
                );

                if (!overlapExists) {
                  handleMovePassenger(moveSourceSeat, seat);
                } else {
                  setToastMessage(`Segmentul se suprapune cu rezervările existente pe locul ${seat.label}`);
                  setToastType('error');
                  setTimeout(() => setToastMessage(''), 3000);
                }

                setMoveSourceSeat(null);
              }
              else if (activePassengers.length > 0) {
                handleSeatClick(e, seat);
              } else {
                toggleSeat(seat);
              }
            }}
            className={`relative text-white text-xs md:text-sm text-left rounded cursor-pointer flex flex-col justify-start p-2 transition overflow-hidden ${baseColorClass}
  ${isSelected ? 'animate-pulse ring-2 ring-white' : ''}
  ${moveSourceSeat?.id === seat.id ? 'ring-4 ring-yellow-400' : ''}
`}

            style={{
              gridRowStart: seat.row + 1,
              gridColumnStart: seat.seat_col,
              width: '105px',
              height: '100px',
            }}
          >
            <div className="flex justify-between font-semibold text-[13px] leading-tight mb-1">
              <span>{seat.label}</span>
              {activePassengers[0] && (
                <span className="truncate">{activePassengers[0].name || '(fără nume)'}</span>
              )}
            </div>

            {activePassengers[0] && (
              <div className="text-[11px] leading-tight">
                <div>{activePassengers[0].phone}</div>
                <div className="italic">{activePassengers[0].board_at} → {activePassengers[0].exit_at}</div>
              </div>
            )}

            {activePassengers[0]?.payment_method && (
              <div className="mt-1">
                <span className={`inline-block px-2 py-1 rounded text-xs font-semibold
      ${activePassengers[0].payment_method === 'cash'
                    ? 'bg-yellow-500 text-white'
                    : activePassengers[0].payment_method === 'card'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-400 text-white'}`}
                >
                  {(() => {
                    const paid = activePassengers.find(p => p?.payment_status === 'paid');
                    const pm = paid?.payment_method || activePassengers[0]?.payment_method;
                    if (pm === 'cash') return '💵 Cash';
                    if (pm === 'card') return '💳 Card';
                    return '📝 Rezervare';
                  })()}
                </span>
              </div>
            )}

            {activePassengers.length > 1 && (
              <div className="mt-1 text-[11px] leading-tight">
                {activePassengers.slice(1).map((p, i) => (
                  <div key={i} className="mt-1">
                    <div className="font-semibold">{p.name}</div>
                    <div>{p.phone}</div>
                    <div className="italic">{p.board_at} → {p.exit_at}</div>
                  </div>
                ))}
              </div>
            )}

            {isDriver && driverName && (
              <div className="text-xs text-center mt-1 text-gray-600">
                {driverName}
              </div>
            )}

            {heldByOther && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-45 text-[11px] font-semibold uppercase">
                Rezervare în curs
              </div>
            )}


          </div>
        );
      })}
    </div>
  );
}
