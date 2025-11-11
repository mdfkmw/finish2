// 📁 components/VehicleSelector.jsx
import React from 'react';

export default function VehicleSelector({
  availableVehicles = [],
  vehicleInfo,
  setVehicleInfo,
  showPopup,
  setShowPopup,
  setSelectedSeats,
  setSeats,
  setSelectedRoute,
  tripId,
  setToastMessage,
  setToastType,
}) {
  const handleVehicleAssign = async (vehicle) => {
    try {
      const response = await fetch('/api/trips/' + tripId + '/vehicle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: vehicle.id })
      });

      // adaugă această linie, să existe data!
      const data = await response.json();

      if (response.ok) {
        setToastMessage('Vehicul atribuit cu succes!');
        setToastType('success');
        setTimeout(() => setToastMessage(''), 3000);

        setShowPopup(false);
        setSelectedSeats([]);
        setSeats([]);
        setSelectedRoute((prev) => ({ ...prev, vehicle_id: vehicle.id }));
        setVehicleInfo(vehicle);
      } else {
        let msg = data.message || "Eroare la schimbarea vehiculului!";
        if (data.unmatched && data.unmatched.length > 0) {
          msg += "\nLocuri fără corespondent: " + data.unmatched.map(x => x.label).join(", ");
        }
        if (typeof window !== "undefined" && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent("toast", {
            detail: {
              message: msg,
              type: "error",
            },
          }));
        }
        
      }
    } catch (err) {
      // În loc de alert, folosește tot dispatchEvent ca la celelalte erori:
      if (typeof window !== "undefined" && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent("toast", {
          detail: {
            message: 'Eroare de rețea la atribuire vehicul.',
            type: "error",
          },
        }));
      }
      console.error(err);
    }
  };


  return (
    <>
      

      {showPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow p-6 max-w-md w-full">
            <h2 className="text-lg font-bold mb-4">Alege un vehicul</h2>
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {availableVehicles.map((vehicle) => (
                <li key={vehicle.id}>
                  <button
                    onClick={() => handleVehicleAssign(vehicle)}
                    className="w-full text-left px-4 py-2 rounded border hover:bg-gray-100"
                  >
                    {vehicle.name} ({vehicle.plate_number || 'fără număr'})
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setShowPopup(false)}
              className="mt-4 px-4 py-2 bg-gray-300 rounded"
            >
              Anulează
            </button>
          </div>
        </div>
      )}
    </>
  );

}