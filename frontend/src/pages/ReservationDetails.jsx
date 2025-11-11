import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

export default function ReservationDetails() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr]   = useState(null);

  useEffect(() => {
    fetch(`/api/reservations/${id}/details`, { credentials: 'include' })
      .then(r => r.json()).then(setData).catch(setErr);
  }, [id]);

  if (err)   return <div>Eroare: {String(err)}</div>;
  if (!data) return <div>Se încarcă…</div>;

  const r = data.reservation, p = data.pricing;

  return (
    <div className="p-4">
      <h2>Rezervare #{r.reservation_id}</h2>
      <p><b>Traseu:</b> {r.route_name} • <b>Dată:</b> {r.trip_date} • <b>Ora:</b> {r.trip_time}</p>
      <p><b>Segment:</b> {r.board_name} → {r.exit_name} • <b>Loc:</b> {r.seat_label} • <b>Status:</b> {r.status}</p>
      {p && (
        <p><b>Preț:</b> {p.price_value} RON • <b>Canal:</b> {p.booking_channel} • <b>Operat de:</b> #{p.employee_id}</p>
      )}

      <h3 className="mt-4">Evenimente</h3>
      <ul>
        {data.events.map(ev => (
          <li key={ev.id}>
            <small>{ev.at}</small> — <b>{ev.action}</b>
            {ev.details && <> — <code>{JSON.stringify(ev.details)}</code></>}
          </li>
        ))}
      </ul>

      <h3 className="mt-4">Plăți</h3>
      <ul>
        {data.payments.map(pay => (
          <li key={pay.id}>
            {pay.ts} — {pay.payment_method} — {pay.amount} RON — {pay.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
