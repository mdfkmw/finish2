import React, { useEffect, useState } from 'react';
import Select from 'react-select';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';

// Componenta principală pentru afișarea backupurilor de rezervări
export default function BackupPage() {
  // Stări pentru backupuri, curse (trips) și cursa selectată
  const [backups, setBackups] = useState([]);
  const [trips, setTrips] = useState([]);
  const [selectedTripId, setSelectedTripId] = useState(null);

  // La montarea componentei, încarcă toate backupurile de rezervări
  useEffect(() => {
    fetch('/api/reservations/backup')
      .then((res) => res.json())
      .then((data) => setBackups(data))
      .catch((err) => console.error('Eroare la backup:', err));
  }, []);

  // La montarea componentei, încarcă toate cursele disponibile (din trips)
  useEffect(() => {
    fetch('/api/trips/summary')
      .then((res) => res.json())
      .then((data) => setTrips(data))
      .catch((err) => console.error('Eroare la trips summary:', err));
  }, []);

  // Filtrare doar a curselor pentru care există backupuri (adică au rezervări mutate)
  const filteredTrips = trips.filter(trip =>
    backups.some(backup => backup.trip_id === trip.trip_id)
  );

  // Formatează opțiunile pentru dropdownul react-select
  const tripOptions = filteredTrips.map(trip => ({
    value: trip.trip_id,
    label: `${format(new Date(trip.date), 'dd MMMM yyyy', { locale: ro })} – ${trip.route_name} – ora ${trip.time} – [${trip.plate_number || 'fără nr.'}]`
  }));

  // Afișează doar backupurile pentru cursa selectată, dacă există una
  const filteredBackups = selectedTripId
    ? backups.filter(b => b.trip_id === selectedTripId)
    : backups;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Backupuri rezervări</h1>

      {/* Dropdown pentru filtrarea backupurilor după cursă */}
      <div className="mb-4">
        <label className="font-semibold mb-1 block">Filtrează backupuri după cursă:</label>
        <Select
          options={tripOptions}
          onChange={(option) => setSelectedTripId(option?.value || null)}
          isClearable
          placeholder="Selectează o cursă..."
        />
      </div>

      {/* Tabel cu rezervările backupate */}
      <div className="overflow-x-auto bg-white rounded shadow p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2">Data</th>
              <th className="p-2">Ora</th>
              <th className="p-2">Traseu</th>
              <th className="p-2">Nr. loc</th>
              <th className="p-2">Nume</th>
              <th className="p-2">Telefon</th>
              <th className="p-2">Backup time</th>
            </tr>
          </thead>
          <tbody>
            {filteredBackups.map((b) => {
              const trip = trips.find((t) => t.trip_id === b.trip_id);
              return (
                <tr key={b.backup_id} className="border-t">
                  {/* Coloană cu data cursei */}
                  <td className="p-2">{trip ? format(new Date(trip.date), 'dd.MM.yyyy') : '-'}</td>

                  {/* Coloană cu ora */}
                  <td className="p-2">{trip?.time || '-'}</td>

                  {/* Coloană cu traseul */}
                  <td className="p-2">{trip?.route_name || '-'}</td>

                  {/* Coloană cu eticheta locului */}
                  <td className="p-2">{b.label}</td>

                  {/* Coloană cu numele pasagerului */}
                  <td className="p-2">{b.passenger_name || '-'}</td>

                  {/* Coloană cu telefonul */}
                  <td className="p-2">{b.phone || '-'}</td>

                  {/* Data și ora la care s-a făcut backupul */}
                  <td className="p-2">{format(new Date(b.backup_time), 'dd.MM.yyyy HH:mm')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
