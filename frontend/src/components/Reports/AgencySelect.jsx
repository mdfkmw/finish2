import { useEffect, useState } from 'react';

export default function AgencySelect({ value, onChange }) {
  const [agencies, setAgencies] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch('/api/agencies')
      .then(r => r.json())
      .then(data => { setAgencies(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <span className="text-gray-400 text-sm">Agenții…</span>;

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="border rounded px-2 py-1"
    >
      <option value="">Toate agențiile</option>
      {agencies.map(a => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  );
}
