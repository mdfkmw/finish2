import { useEffect, useState } from 'react';

export default function OperatorSelect({ value, onChange }) {
  const [ops, setOps] = useState([]);

  useEffect(() => {
    fetch('/api/operators')
      .then(r => r.json())
      .then(setOps)
      .catch(console.error);
  }, []);

  if (!ops.length) {
    return <span className="text-gray-400 text-sm">Se încarcă operatorii…</span>;
  }

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(Number(e.target.value))}
      className="border rounded px-2 py-1"
    >
      <option value="" disabled>Alege operator…</option>
      {ops.map(o => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
