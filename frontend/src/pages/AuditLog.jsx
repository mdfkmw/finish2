import { useState, useEffect } from 'react';

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', action: '' });

  const load = () => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([_, v]) => v));
    fetch(`/api/audit-logs?${qs}`)
      .then(r => r.json())
      .then(setRows)
      .catch(console.error);
  };

  useEffect(load, []);

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">🕓 Jurnal operațiuni</h1>
      <div className="flex gap-2 mb-4">
        <input placeholder="De la (YYYY-MM-DD)" value={filters.from} onChange={e=>setFilters({...filters, from:e.target.value})} />
        <input placeholder="Până la (YYYY-MM-DD)" value={filters.to} onChange={e=>setFilters({...filters, to:e.target.value})} />
        <input placeholder="Acțiune" value={filters.action} onChange={e=>setFilters({...filters, action:e.target.value})} />
        <button onClick={load} className="bg-blue-600 text-white px-3 py-1 rounded">Filtrează</button>
      </div>

      <table className="w-full text-sm border">
        <thead className="bg-gray-100">
          <tr>
            <th className="border p-2">Dată</th>
            <th className="border p-2">Acțiune</th>
            <th className="border p-2">Rezervare</th>
        <th className="border p-2">Din</th>
           <th className="border p-2">Data cursă</th>
           <th className="border p-2">Traseu</th>
           <th className="border p-2">Ora</th>
            <th className="border p-2">Segment</th>
            <th className="border p-2">Loc</th>
            <th className="border p-2">Actor</th>
            <th className="border p-2">Sumă</th>
            <th className="border p-2">Metodă</th>
            <th className="border p-2">Channel</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.event_id}>
              <td className="border p-2">{r.at}</td>
              <td className="border p-2">{r.action_label || r.action}</td>
              <td className="border p-2">
                <a href={`/rezervare/${r.reservation_id}`} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                  #{r.reservation_id}
                </a>
              </td>
          <td className="border p-2">
            {r.from_reservation_id ? (
              <span>
                {r.from_trip_date || ''}{r.from_hour ? ` ${r.from_hour}` : ''}{' '}
                {r.from_route_name ? `| ${r.from_route_name}` : ''}{' '}
                {r.from_segment ? `| ${r.from_segment}` : ''}{' '}
                {r.from_seat ? `| loc ${r.from_seat}` : ''}
              </span>
            ) : ''}
          </td>
          <td className="border p-2">{r.trip_date || ''}</td>
              <td className="border p-2">{r.route_name}</td>
              <td className="border p-2">{r.hour}</td>
              <td className="border p-2">{r.segment}</td>
              <td className="border p-2">{r.seat}</td>
              <td className="border p-2">{r.actor_name || r.actor_id}</td>
              <td className="border p-2">{r.amount ?? ''}</td>
              <td className="border p-2">{r.payment_method ?? ''}</td>
              <td className="border p-2">{r.channel ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
