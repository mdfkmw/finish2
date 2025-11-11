import React, { useRef, useLayoutEffect, useState, useEffect } from 'react';
import ConfirmModal from './ConfirmModal';
import { useNavigate } from 'react-router-dom'; // adaugă la începutul fișierului



export default function PassengerPopup({
  x, y,
  passenger, seat,
  onDelete, onMove, onEdit,
  onMoveToOtherTrip,    // ← aici
  onPay,
  selectedDate,         // ← aici
  selectedHour,         // ← aici
  originalRouteId,      // ← aici
  onClose,
  tripId,
  setToastMessage, setToastType
}) {



  const openReport = () => {
    if (passenger.person_id) {
      window.open(
        `${window.location.origin}/raport/${passenger.person_id}`,
        '_blank',
        'noopener,noreferrer'
      );
      onClose(); // închidem popupul
    }
  };





  const navigate = useNavigate(); // ✅ necesar pentru a funcționa navigate(...)






  const popupRef = useRef(null);
  const [position, setPosition] = useState({ top: y, left: x });

  // Confirm modals state
  const [showNoShowConfirm, setShowNoShowConfirm] = useState(false);
  const [showBlacklistConfirm, setShowBlacklistConfirm] = useState(false);
  const [blacklistReason, setBlacklistReason] = useState('Are multe neprezentari');



  // ─── 1️⃣ State + fetch no-shows ───
  const [noShowResIds, setNoShowResIds] = useState(new Set());
  const [loadingNoShows, setLoadingNoShows] = useState(true);

  useEffect(() => {
    setLoadingNoShows(true);
    fetch(`/api/no-shows/${tripId}`)
      .then(r => r.json())
      .then(arr => setNoShowResIds(new Set(arr)))
      .catch(console.error)
      .finally(() => setLoadingNoShows(false));
  }, [tripId]);

  // pentru render
  const isNoShow = !loadingNoShows && noShowResIds.has(passenger.reservation_id);








  // ─── 2️⃣ Blacklist State ───
  const [blacklistedIds, setBlacklistedIds] = useState(new Set());
  useEffect(() => {
    fetch('/api/blacklist')
      .then(r => r.json())
      .then(rows => {
        /*  
           /api/blacklist returnează atât persoane din
           blacklist, cât şi persoane doar cu “no-show”.
           Considerăm „blacklistat” DOAR dacă:
             • source === 'blacklist'  (vezi backend)
             • sau blacklist_id !== null
        */
        const ids = new Set(
          rows
            .filter(
              row =>
                row.source === 'blacklist' ||
                row.blacklist_id !== null
            )
            .map(row => row.person_id)
        );
        setBlacklistedIds(ids);
      })
      .catch(console.error);
  }, []);
  const isBlacklisted = blacklistedIds.has(passenger.person_id || passenger.id);



















  useLayoutEffect(() => {
    if (popupRef.current) {
      const popupRect = popupRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newLeft = x;
      let newTop = y;

      // Dacă iese în dreapta, mută spre stânga
      if (x + popupRect.width > viewportWidth - 8) {
        newLeft = viewportWidth - popupRect.width - 8;
      }
      if (newLeft < 8) newLeft = 8;

      // Dacă iese jos, urcă deasupra
      if (y + popupRect.height > viewportHeight - 8) {
        newTop = y - popupRect.height;
        if (newTop < 8) newTop = viewportHeight - popupRect.height - 8;
      }
      if (newTop < 8) newTop = 8;

      setPosition({ top: newTop, left: newLeft });
    }
  }, [x, y, passenger]);

  const handleMoveToOtherTripClick = () => {
    if (!onMoveToOtherTrip) return console.error("…");
    onMoveToOtherTrip({
      passenger,
      reservation_id: passenger.reservation_id,
      fromSeat: seat,
      boardAt: passenger.board_at,
      exitAt: passenger.exit_at,
      originalTime: selectedHour,
      originalRouteId,
      originalDate: selectedDate.toISOString().split('T')[0],
    });
    onClose();
  };


















  // 1️⃣ Extragi logica „avansată” într-o funcție dedicată
  const markNoShow = async () => {
    if (!passenger.reservation_id) {
      console.error('❌ reservation_id missing');
      return;
    }
    const payload = { reservation_id: passenger.reservation_id };
    console.log("📤 Trimitem către /api/no-shows:", payload);
    await fetch('/api/no-shows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    onClose();
  };

  const addToBlacklist = async (reason) => {

    const payload = {
      person_id: passenger.person_id || passenger.id,
      reason: 'Adăugat manual din popup',
      // added_by_employee_id implicit în backend
    };

    if (!payload.person_id) {
      console.error('❌ person_id lipsă');
      return;
    }

    console.log("📤 Trimitem către /api/blacklist:", payload);

    fetch('/api/blacklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(json => {
        if (json.error) {
          console.error(json.error);
        } else {
          console.log('🚫 Adăugat în blacklist');
        }
      });

    onClose();

  };

  // 2️⃣ handler-ul de confirmare simplu
  const handleConfirmNoShow = () => {
    markNoShow()
      .catch(err => console.error(err));
    setShowNoShowConfirm(false);
    onClose();
  };

  const handleConfirmBlacklist = () => {
    addToBlacklist(blacklistReason)
      .catch(err => console.error(err));
    setShowBlacklistConfirm(false);
    onClose();
  };
























  return (
    <div
      ref={popupRef}
      className="popup-container fixed bg-white shadow-xl border border-gray-300 rounded-lg z-50 text-sm"
      style={{
        top: position.top,
        left: position.left,
        minWidth: '220px',
        maxWidth: '260px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Nume pasager */}
      <button
        onClick={openReport}
        className="w-full text-left px-4 pt-3 pb-2 hover:bg-gray-50"
      >
        <div className="text-gray-800 font-semibold flex items-center gap-2">
          👤 {passenger.name || 'Pasager'}
        </div>
        <div className="text-gray-700 text-sm">
          <div className="flex items-center gap-2">
            📞 <span>{passenger.phone}</span>
          </div>
          <div className="flex items-center gap-2 italic text-gray-600">
            🚌 <span>{passenger.board_at} → {passenger.exit_at}</span>
          </div>
          {passenger.observations && (
            <div className="flex items-start gap-2 text-gray-500 mt-1">
              📝 <span className="whitespace-pre-line">{passenger.observations}</span>
            </div>
          )}
        </div>
      </button>

      {/* Acțiuni */}
      <div className="border-t divide-y">
        <button
          onClick={onEdit}
          className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-gray-100"
        >
          ✏️ <span>Editare</span>
        </button>







        <button
          onClick={onMove}
          className="block w-full text-left px-4 py-2 hover:bg-gray-100"
        >
          🔁 Mută
        </button>

        <button
          className="block w-full text-left px-4 py-2 hover:bg-gray-100"
          onClick={handleMoveToOtherTripClick}
        >
          🔁 Mută pe altă cursă
        </button>


        <button
          onClick={onPay}
          className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-emerald-700"
        >
          💰 Achită
        </button>



        <button
          onClick={onDelete}
          className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-red-600"
        >
          🗑️ Șterge
        </button>

        <button
          onClick={() => !isNoShow && setShowNoShowConfirm(true)}
          disabled={isNoShow || loadingNoShows}
          className={
            `flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-gray-100 ` +
            `${isNoShow ? 'opacity-50 cursor-not-allowed' : 'text-orange-600'}`
          }
        >
          ❗ <span>{isNoShow ? 'Înregistrat deja!' : 'Înregistrează neprezentare'}</span>
        </button>

        <button
          onClick={() => !isBlacklisted && setShowBlacklistConfirm(true)}
          disabled={isBlacklisted}
          className={
            `flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-gray-100 ` +
            `${isBlacklisted ? 'opacity-50 cursor-not-allowed' : 'text-orange-600'}`
          }
        >
          🚫 <span>{isBlacklisted ? 'Deja în blacklist' : 'Adaugă în blacklist'}</span>
        </button>









      </div>

      {/* Închidere */}
      <button
        className="text-xs text-gray-400 hover:text-gray-600 hover:underline w-full text-center py-2 border-t"
        onClick={onClose}
      >
        ✖️ Închide
      </button>




      {/*** Modalele de confirmare ***/}
      {/* Confirmare neprezentare */}
      <ConfirmModal
        show={showNoShowConfirm}
        title="Confirmare neprezentare"
        message="Ești sigur că vrei să marchezi ca neprezentat?"
        cancelText="Renunță"
        confirmText="Confirmă"
        onCancel={() => setShowNoShowConfirm(false)}
        onConfirm={async () => {
          try {
            if (!passenger.reservation_id) throw new Error('reservation_id missing');
            const payload = { reservation_id: passenger.reservation_id };
            const res = await fetch('/api/no-shows', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setToastMessage('Neprezentare înregistrată cu succes');
            setToastType('success');
          } catch (err) {
            setToastMessage(err.message || 'Eroare la înregistrare neprezentare');
            setToastType('error');
          } finally {
            setShowNoShowConfirm(false);
            onClose();
            setTimeout(() => setToastMessage(''), 3000);
          }
        }}
      />

      {/* Confirmare blacklist */}
      <ConfirmModal
        show={showBlacklistConfirm}
        title="Confirmare blacklist"
        cancelText="Renunță"
        confirmText="Adaugă"
        onCancel={() => setShowBlacklistConfirm(false)}
        onConfirm={async () => {

          const payload = {
            person_id: passenger.person_id || passenger.id,
            reason: blacklistReason,
            // added_by_employee_id implicit în backend
          };
          const res = await fetch('/api/blacklist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.already) {
            setToastMessage('Persoana era deja în blacklist');
            setToastType('info');
          } else if (!res.ok) {
            setToastMessage(data.error || 'Eroare la adăugare în blacklist');
            setToastType('error');
          } else {
            setToastMessage('Adăugat în blacklist cu succes');
            setToastType('success');
          }
          setShowBlacklistConfirm(false);
          onClose();
          setTimeout(() => setToastMessage(''), 3000);
        }}
      >
        <div className="text-sm mb-2">
          Ești sigur că vrei să adaugi în blacklist?
        </div>
        <textarea
          className="w-full border p-2 rounded text-sm"
          rows={3}
          value={blacklistReason}
          onChange={e => setBlacklistReason(e.target.value)}
        />
      </ConfirmModal>












    </div >
  );
}
