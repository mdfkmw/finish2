import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function BlacklistAdmin() {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState([]);
  const [historyName, setHistoryName] = useState('');

  const loadEntries = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/blacklist');
      setEntries(res.data);
    } catch (err) {
      console.error('Eroare la încărcare blacklist:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const handleAddToBlacklist = async (personId) => {
    if (!window.confirm('Adaugi acest pasager în blacklist?')) return;
    try {
      await axios.post('/api/blacklist', { person_id: personId });
      await loadEntries();
    } catch (err) {
      console.error(err);
      alert('Nu am putut adăuga în blacklist.');
    }
  };

  const handleRemoveBlacklist = async (blacklistId) => {
    if (!window.confirm('Ștergi acest pasager din blacklist?')) return;
    try {
      await axios.delete(`/api/blacklist/${blacklistId}`);
      await loadEntries();
    } catch (err) {
      console.error(err);
      alert('Nu am putut șterge din blacklist.');
    }
  };

  const handleRemoveNoShows = async (personId) => {
    if (!window.confirm('Ștergi toate neprezentările pentru acest pasager?')) return;
    try {
      await axios.delete(`/api/no-shows/${personId}`);
      await loadEntries();
    } catch (err) {
      console.error(err);
      alert('Nu am putut șterge neprezentările.');
    }
  };

  const handleShowHistory = async (personId, displayName) => {
    try {
      const res = await axios.get(`/api/people/${personId}/report`);
      setHistoryData(res.data.noShows || []);
      setHistoryName(displayName);
      setShowHistory(true);
    } catch (err) {
      console.error(err);
      alert('Nu am putut încărca istoricul.');
    }
  };

  const lowerFilter = filter.toLowerCase();
  const normalizedPhoneFilter = filter.replace(/\s+/g, '');
  const filtered = entries.filter((e) => {
    const name = (e.person_name || '').toLowerCase();
    const phone = String(e.phone || '').replace(/\s+/g, '');
    return name.includes(lowerFilter) || phone.includes(normalizedPhoneFilter);
  });

  return (
    <>
      <div className="p-4 max-w-4xl">
        <h1 className="text-2xl font-semibold mb-4">Administrare Blacklist</h1>

        <input
          type="text"
          placeholder="Caută după nume sau telefon…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-4 p-2 border rounded w-full text-sm max-w-full"
        />

        {loading ? (
          <div>Loading…</div>
        ) : (
          <table className="w-full text-sm table-auto border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-2 py-1 border text-left">Nume</th>
                <th className="px-2 py-1 border text-left">Telefon</th>
                <th className="px-2 py-1 border text-left">Angajat</th>

                <th className="px-2 py-1 border text-left">Motiv</th>
                <th className="px-2 py-1 border text-left">Adăugat la</th>
                <th className="px-2 py-1 border text-left">Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, idx) => (
                <tr
                  key={`${e.person_id}-${e.source}`}
                  className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-2 py-1 border">{e.person_name || '—'}</td>
                  <td className="px-2 py-1 border">{e.phone}</td>
                  <td className="px-2 py-1 border">{e.added_by_employee || '—'}</td>
                  <td className="px-2 py-1 border">{e.reason || '—'}</td>
                  <td className="px-2 py-1 border">{e.added_at || '—'}</td>
                  <td className="px-2 py-1 border">
                    {e.source === 'blacklist' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleShowHistory(e.person_id, e.person_name || e.phone)}
                          className="px-2 py-1 bg-gray-600 text-white rounded text-xs"
                        >
                          Istoric
                        </button>
                        <button
                          onClick={() => handleRemoveBlacklist(e.blacklist_id)}
                          className="px-2 py-1 bg-red-600 text-white rounded text-xs"
                        >
                          Scoate
                        </button>
                      </div>
                    )}
                    {e.source === 'no_show' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleShowHistory(e.person_id, e.person_name || e.phone)}
                          className="px-2 py-1 bg-gray-600 text-white rounded text-xs"
                        >
                          Istoric
                        </button>
                        <button
                          onClick={() => handleRemoveNoShows(e.person_id)}
                          className="px-2 py-1 bg-orange-600 text-white rounded text-xs"
                        >
                          Șterge
                        </button>
                        <button
                          onClick={() => handleAddToBlacklist(e.person_id)}
                          className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
                        >
                          Adaugă
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center py-4 text-gray-500">
                    Nu există persoane în blacklist sau cu neprezentări.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Popup istoric neprezentări */}
      {showHistory && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded shadow-lg w-120 max-h-[70vh] overflow-auto text-sm">
            <h3 className="text-lg font-semibold mb-2">
              Istoric neprezentări: {historyName}
            </h3>
            {historyData.length === 0 ? (
              <div>Nu există înregistrări.</div>
            ) : (
              <div className="space-y-1">
 {historyData.map((ns, idx) => {
   const date = ns.date || ns.created_at || ns.created_at_date || '-';
   const time = ns.time || ns.hour || ns.trip_time || '';
   const route = ns.route_name || ns.route || ns.routeName || '-';
   const seatsText = Array.isArray(ns.seats)
     ? ns.seats.join(', ')
     : (ns.seats ?? ns.seat_numbers ?? ns.seat ?? ns.seat_ids ?? '-');
   return (
     <div key={idx} className="text-sm whitespace-nowrap">
       {date} {time} – {route}
       <span className="font-semibold">
         {' '}| Locuri: {seatsText}
       </span>
     </div>
   );
 })}

              </div>
            )}
            <div className="text-right mt-4">
              <button
                onClick={() => setShowHistory(false)}
                className="px-3 py-1 bg-gray-300 text-sm rounded"
              >
                Închide
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
