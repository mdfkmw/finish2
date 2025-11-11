import React from 'react';

export default function MultiPassengerPopup({ x, y, seat, onSelect, onClose }) {
  return (
    <div
      className="popup-container fixed bg-white shadow-xl border border-gray-300 rounded-lg z-50"
      style={{
        top: y,
        left: x,
        minWidth: '220px',
        maxWidth: '260px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-4 py-3 text-gray-800 font-semibold flex items-center gap-2">
        👥 Selectează un pasager:
      </div>

      <div className="p-2 space-y-2 text-sm text-gray-700">
        {seat.passengers.map((p, i) => (
          <button
            key={i}
            className="w-full text-left px-3 py-2 rounded hover:bg-blue-50 transition flex flex-col gap-1"
            onClick={() => onSelect(p)}
          >
            <div className="flex items-center gap-2 font-medium">
              👤 {p.name}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              📞 {p.phone}
            </div>
            <div className="flex items-center gap-2 text-xs italic text-gray-600">
              🚌 {p.board_at} → {p.exit_at}
            </div>
            {p.observations && (
              <div className="flex items-start gap-2 text-xs text-gray-500">
                📝 <span className="whitespace-pre-line">{p.observations}</span>
              </div>
            )}
          </button>
        ))}
      </div>

      <button
        className="text-xs text-gray-400 hover:text-gray-600 hover:underline w-full text-center py-2 border-t"
        onClick={onClose}
      >
        ✖️ Închide
      </button>
    </div>
  );
}
