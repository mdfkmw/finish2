import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import AdminRouteSchedules from './AdminRouteSchedules';

/**
 * Tab-ul „Trasee” din pagina de administrare.
 * — Afișează toate rutele într-un tabel simplu (stil identic cu AdminDiscountType / AdminDrivers)
 * — Coloane: nume + buton „Editează”
 * — Sortare asc/desc după nume la click pe header
 */
export default function AdminRouteTab() {
  const [routes, setRoutes] = useState([]);
  const [expandedRouteId, setExpandedRouteId] = useState(null); // id rută cu editor „Ore” deschis
  const [newName, setNewName] = useState('');
  const [newVisFE, setNewVisFE] = useState(true);
  const [newVisDRV, setNewVisDRV] = useState(true);
  const [newVisOnline, setNewVisOnline] = useState(true);

  // ordonare simplă (similar cu AdminDiscountType)
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

  /*────────────────────────── Fetch */
  const fetchRoutes = async () => {
    try {
      const res = await axios.get('/api/routes');
      setRoutes(res.data);
    } catch (err) {
      console.error('Eroare la încărcarea rutelor:', err);
      alert('Nu s-au putut încărca rutele');
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, []);

  /*────────────────────────── Sortare */
  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const sortedRoutes = useMemo(() => {
    const sortable = [...routes];
    sortable.sort((a, b) => {
      let aVal = (a[sortConfig.key] || '').toLowerCase();
      let bVal = (b[sortConfig.key] || '').toLowerCase();
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sortable;
  }, [routes, sortConfig]);

  /*────────────────────────── Update (toggle-uri) */
  const updateRoute = async (id, payload) => {
    try {
      await axios.patch(`/api/routes/${id}`, payload);
      await fetchRoutes();
    } catch (err) {
      console.error('Eroare la actualizarea rutei:', err);
      alert('Nu s-a putut salva modificarea.');
    }
  };



  /*────────────────────────── Create (adăugare rută) */
  const addRoute = async () => {
    const name = newName.trim();
    if (!name) { alert('Scrie numele rutei'); return; }
    try {
      await axios.post('/api/routes', {
        name,
        visible_in_reservations: newVisFE,
        visible_for_drivers: newVisDRV,
        visible_online: newVisOnline,
      });
      setNewName('');
      setNewVisFE(true);
      setNewVisDRV(true);
      setNewVisOnline(true);
      await fetchRoutes();
    } catch (err) {
      console.error('Eroare la adăugare rută:', err);
      alert('Nu s-a putut adăuga ruta.');
    }
  };

  const handleDeleteRoute = async (id, name) => {
    if (!window.confirm(`Sigur vrei să ștergi ruta "${name}"?`)) return;
    try {
      await axios.delete(`/api/routes/${id}`);
      await fetchRoutes();
    } catch (err) {
      const msg = err.response?.data?.error || 'Eroare la ștergere.';
      alert(msg);
    }
  };

  /*────────────────────────── Edit */
  const handleEdit = (routeId) => {
    // Deschide în tab nou (mai sigur cu noopener/noreferrer)
    window.open(`/admin/routes/${routeId}/edit`, '_blank', 'noopener,noreferrer');
  };

  /*────────────────────────── UI */
  return (
    <div className="overflow-x-auto">
      <h2 className="text-lg font-semibold mb-4">Trasee</h2>

      <table className="w-auto text-sm table-auto border-collapse">
        <thead>
          <tr>
            <th
              onClick={() => requestSort('name')}
              className="p-1 border text-left cursor-pointer select-none bg-gray-200"
            >
              Nume
              {sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
            </th>
            <th className="p-1 border text-center bg-gray-200">Apare în rezervări</th>
            <th className="p-1 border text-center bg-gray-200">Apare la șofer</th>
            <th className="p-1 border text-center bg-gray-200">Apare online</th>
            <th className="p-1 border text-left bg-gray-200">Acțiuni</th>
          </tr>
        </thead>
        
        <tbody>

          {/* rând de ADĂUGARE rută */}
          <tr className="bg-white">
            <td className="p-1 border">
              <input
                className="w-full border rounded px-2 py-1"
                placeholder="Nume rută (ex: Botoșani – Iași)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </td>
            <td className="p-1 border text-center">
              <input type="checkbox" checked={newVisFE} onChange={(e) => setNewVisFE(e.target.checked)} />
            </td>
            <td className="p-1 border text-center">
              <input type="checkbox" checked={newVisDRV} onChange={(e) => setNewVisDRV(e.target.checked)} />
            </td>
            <td className="p-1 border text-center">
              <input type="checkbox" checked={newVisOnline} onChange={(e) => setNewVisOnline(e.target.checked)} />
            </td>
            <td className="p-1 border">
              <button className="px-3 py-1 bg-green-600 text-white rounded text-sm" onClick={addRoute}>
                Adaugă
              </button>
            </td>
          </tr>

          {sortedRoutes.map((route, idx) => (
            <React.Fragment key={route.id}>
              <tr className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="p-1 border">{route.name}</td>
              <td className="p-1 border text-center">
                <input
                  type="checkbox"
                  checked={!!route.visible_in_reservations}
                  onChange={(e) => updateRoute(route.id, { visible_in_reservations: e.target.checked })}
                />
              </td>
              <td className="p-1 border text-center">
                <input
                  type="checkbox"
                  checked={!!route.visible_for_drivers}
                  onChange={(e) => updateRoute(route.id, { visible_for_drivers: e.target.checked })}
                />
              </td>
              <td className="p-1 border text-center">
                <input
                  type="checkbox"
                  checked={!!route.visible_online}
                  onChange={(e) => updateRoute(route.id, { visible_online: e.target.checked })}
                />
              </td>
              <td className="p-1 border">
                <button
                  className="px-2 py-1 text-xs bg-blue-500 text-white rounded"
                  onClick={() => handleEdit(route.id)}
                  title="Deschide în tab nou"
                >
                  Editează
                </button>
                <button
                  className="px-2 py-1 text-xs bg-gray-700 text-white rounded"
                  onClick={() => setExpandedRouteId(expandedRouteId === route.id ? null : route.id)}
                  title="Gestionează ore"
                >
                  Ore
                </button>
  <button
    className="px-2 py-1 bg-red-600 text-white rounded text-sm ml-1"
    onClick={() => handleDeleteRoute(route.id, route.name)}
  >
    Șterge
  </button>
              </td>
              </tr>
              {expandedRouteId === route.id && (
                <tr>
                  <td className="p-2 border bg-gray-50" colSpan={5}>
                    <AdminRouteSchedules routeId={route.id} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}