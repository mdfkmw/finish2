import { useEffect, useState } from 'react';

export default function AgentSelect({ value, onChange, agencyId }) {
  const [agents, setAgents]   = useState([]);
  const [loading, setLoading] = useState(true);

useEffect(() => {
  if (!agencyId) {
    setAgents([]);
    setLoading(false);
    return;
  }
  setLoading(true);
  fetch(`/api/employees?agency_id=${agencyId}`)
    .then(r => r.json())
    .then(data => {
      // backend deja filtrează după role='agent' și active=true
      setAgents(data);
      setLoading(false);
    })
    .catch(() => setLoading(false));
}, [agencyId]);


  if (loading) return <span className="text-gray-400 text-sm">Agenți…</span>;

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="border rounded px-2 py-1"
    >
      <option value="">Toți agenții</option>
      {agents.map(a => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  );
}
