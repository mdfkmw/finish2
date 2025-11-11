import React, { useEffect, useState } from 'react';

export default function AddVehicleModal({
  tripId,
  show,
  onClose,
  onAdded,            // callback(tv) pentru ADD
  onUpdated,          // callback(tv) pentru EDIT
  existingVehicleIds, // id-urile vehiculelor deja asociate
  editTvId,           // dacă e null → mod ADD, altfel → mod EDIT
}) {
  const [available, setAvailable] = useState([]);

  useEffect(() => {
    if (!show) return;
    fetch(`/api/vehicles/${tripId}/available`)
      .then(r => r.json())
      .then(data => {
        // excludem vehiculele deja asociate
        setAvailable(data.filter(v => !existingVehicleIds.includes(v.id)));
      })
      .catch(console.error);
  }, [show, existingVehicleIds, editTvId]);

  const handleSubmit = async (vid) => {
    // construim URL‐ul și payload‐ul
    let url, opts;
    if (editTvId === 'main') {
      // schimbăm mașina principală
      url = `/api/trips/${tripId}/vehicle`;
      opts = {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVehicleId: vid }),
      };
    } else if (editTvId) {
      // schimbăm o dublură
      url = `/api/trips/${tripId}/vehicles/${editTvId}`;
      opts = {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVehicleId: vid }),
      };
    } else {
      // adăugăm o nouă dublură
      url = `/api/trips/${tripId}/vehicles`;
      opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vid }),
      };
    }

    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Eroare la salvare');
      return;
    }

    if (editTvId === 'main') {
      // la principal trimitem doar newVehicleId
      onUpdated(vid);
    } else {
      // la dubluri ne aşteptăm la un obiect trip_vehicle
      const tv = await res.json();
      onUpdated(tv);
    }
    onClose();
  
};

if (!show) return null;
return (
  <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center">
    <div className="bg-white p-6 rounded shadow-lg w-full max-w-xl">

      <h2 className="text-lg font-semibold mb-4">
        {editTvId ? 'Modifică maşină' : 'Adaugă dublură'}
      </h2>
      <ul className="space-y-2 max-h-56 overflow-auto">
        {available.map(v => (
          <li key={v.id} className="flex justify-between">
            <span>
              {v.name} (
              {v.plate_number || v.plate}
              )
            </span>
            <button
              onClick={() => handleSubmit(v.id)}
              className="px-2 py-1 bg-blue-600 text-white rounded"
            >
              {editTvId ? 'Modifică' : 'Adaugă'}
            </button>
          </li>
        ))}
        {available.length === 0 && (
          <li>Nu mai sunt vehicule disponibile</li>
        )}
      </ul>
      <button
        onClick={onClose}
        className="mt-4 px-3 py-1 bg-gray-300 rounded"
      >
        Anulează
      </button>
    </div>
  </div>
);
}
