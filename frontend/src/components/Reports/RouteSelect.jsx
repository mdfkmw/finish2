import { useEffect, useState } from 'react';

export default function RouteSelect({ value, onChange, operatorId }) {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);

 useEffect(() => {
   if (!operatorId) {
     setRoutes([]);
     setLoading(false);
     return;
   }
   setLoading(true);
   fetch(`/api/routes?operator_id=${operatorId}`)
     .then(r => r.json())
     .then(data => { setRoutes(data); setLoading(false); })
     .catch(() => setLoading(false));
 }, [operatorId]);


  if (loading) return <span className="text-gray-400 text-sm">Rute…</span>;

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="border rounded px-2 py-1"
    >
      <option value="">Toate rutele</option>
      {routes.map(r => (
        <option key={r.id} value={r.id}>{r.name}</option>
      ))}
    </select>
  );
}
