import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

export default function ReservationDetails() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/reservations/${id}/details`)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j?.error || 'Eroare server')))
      .then(j => { if (alive) { setData(j); setErr(''); } })
      .catch(e => { if (alive) setErr(String(e || 'Eroare la încărcare detalii')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  if (loading) return <div className="p-4">Se încarcă…</div>;
  if (err) return <div className="p-4 text-red-600">Eroare: {err}</div>;
  if (!data) return <div className="p-4">Nu s-au găsit detalii.</div>;

  const r = data.reservation || {};
  const p = data.pricing || {};
  const payments = data.payments || [];
  const events = data.events || [];

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-xl font-semibold">Detalii rezervare #{id}</h1>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded p-3">
          <h2 className="font-medium mb-2">Rezervare</h2>
          <div>Stare: <b>{r.status}</b></div>
          <div>Cursă: <b>{r.trip_date}</b> {r.trip_time} — {r.route_name}</div>
          <div>Segment: <b>{r.board_name} → {r.exit_name}</b></div>
          <div>Loc: <b>{r.seat_label}</b></div>
          <div>Creată de: <b>{r.created_by ?? '—'}</b></div>
          <div>Creată la: <b>{r.reservation_time ?? '—'}</b></div>
          {r.observations ? <div>Observații: {r.observations}</div> : null}
        </div>

        <div className="border rounded p-3">
          <h2 className="font-medium mb-2">Preț & Plăți</h2>
          <div>Preț net: <b>{p?.price_value ?? '—'}</b></div>
          <div>Channel: <b>{p?.booking_channel ?? '—'}</b></div>
          <div>Operator: <b>{p?.employee_id ?? '—'}</b></div>
          <div className="mt-2">
            <div className="font-medium">Plăți</div>
            {payments.length === 0 ? <div>—</div> : (
              <ul className="list-disc pl-5">
                {payments.map(pay => (
                  <li key={pay.id}>
                    {pay.ts}: {pay.amount} RON — {pay.payment_method} {pay.transaction_id ? `(txn ${pay.transaction_id})` : ''} {pay.collected_by ? `| casier ${pay.collected_by}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="border rounded p-3">
        <h2 className="font-medium mb-2">Evenimente (audit)</h2>
        {events.length === 0 ? <div>—</div> : (
          <table className="w-full text-sm border">
            <thead className="bg-gray-100">
              <tr>
                <th className="border p-2">Dată</th>
                <th className="border p-2">Acțiune</th>
                <th className="border p-2">Actor</th>
                <th className="border p-2">Sumă</th>
                <th className="border p-2">Metodă</th>
                <th className="border p-2">Channel</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev.event_id || ev.id}>
                  <td className="border p-2">{ev.at}</td>
                  <td className="border p-2">{ev.action}</td>
                  <td className="border p-2">{ev.actor_id}</td>
                  <td className="border p-2">{ev.amount ?? ''}</td>
                  <td className="border p-2">{ev.payment_method ?? ''}</td>
                  <td className="border p-2">{ev.channel ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
