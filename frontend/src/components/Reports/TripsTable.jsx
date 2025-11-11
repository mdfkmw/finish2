import React, { useState, useMemo } from 'react';
import dayjs from 'dayjs';

export default function TripsTable({ rows }) {
  const [sortConfig, setSortConfig] = useState({ key: 'route_name', direction: 'asc' });

  const safeRows = Array.isArray(rows) ? rows : [];

  // grupare pe trip_id
  const groupedArray = useMemo(() => {
    const grouped = {};
    safeRows.forEach(r => {
      if (!grouped[r.trip_id]) grouped[r.trip_id] = { meta: r, online: null, offline: null };
      if (r.channel === 'online') grouped[r.trip_id].online = r;
      else grouped[r.trip_id].offline = r;
    });
    return Object.values(grouped);
  }, [safeRows]);

  const sorted = useMemo(() => {
    const { key, direction } = sortConfig;
    return [...groupedArray].sort((a, b) => {
      let aVal = a.meta[key];
      let bVal = b.meta[key];
      if (key === 'seats_total') { aVal = Number(aVal); bVal = Number(bVal); }
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [groupedArray, sortConfig]);

  const totals = useMemo(() => {
    const base = {
      offline: { seats: 0, discountCount: 0, discountTotal: 0, paid: 0, due: 0 },
      online: { seats: 0, discountCount: 0, discountTotal: 0, paid: 0, due: 0 }
    };

    groupedArray.forEach(({ offline, online }) => {
      const off = offline || {};
      const on = online || {};

      base.offline.seats += Number(off.seats_booked || 0);
      base.online.seats += Number(on.seats_booked || 0);

      base.offline.discountCount += Number(off.discount_count || 0);
      base.online.discountCount += Number(on.discount_count || 0);

      base.offline.discountTotal += Number(off.discount_total || 0);
      base.online.discountTotal += Number(on.discount_total || 0);

      base.offline.paid += Number(off.paid_total || 0);
      base.online.paid += Number(on.paid_total || 0);

      base.offline.due += Number(off.due_total || 0);
      base.online.due += Number(on.due_total || 0);
    });

    return base;
  }, [groupedArray]);

  if (!safeRows.length) {
    return <div className="text-gray-500 italic">Nu există curse în intervalul selectat.</div>;
  }

  const requestSort = key => {
    setSortConfig(prev => prev.key === key
      ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
  };

  const getIndicator = key =>
    sortConfig.key === key ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : '';

  // helper pentru celulele duale (offline / online)
  const dual = (offlineVal, onlineVal, clsOff = '', clsOn = '', align = 'text-center') => (
    <div className={`flex flex-col ${align}`}>
      <div className={`${clsOff} px-1`}>{offlineVal}</div>
      <div className={`${clsOn} px-1`}>{onlineVal}</div>
    </div>
  );

  const headers = [
    { label: 'Rută', key: 'route_name', sortable: true },
    { label: 'Ora', key: 'trip_time', sortable: true },
    { label: 'Nr. mașină', key: 'vehicle_name', sortable: true }, // folosit ca cheie de sortare
    { label: 'Locuri', key: 'seats_total', sortable: true },
    { label: 'Rezervări (off/online)', key: null },
    { label: 'Reduceri # (off/online)', key: null },
    { label: 'Reduceri lei (off/online)', key: null },
    { label: 'Încasări efective (off/online)', key: null },
    { label: 'De încasat (off/online)', key: null },
    { label: 'Data', key: null }
  ];

  const cssOff = 'bg-yellow-50';
  const cssOn = 'bg-pink-50';

  return (
    <table className="w-full table-auto border text-sm">
      <thead className="bg-gray-100">
        <tr>
          {headers.map(h => (
            <th
              key={h.label}
              className={`border px-2 py-1 whitespace-nowrap ${h.sortable ? 'cursor-pointer select-none' : ''}`}
              onClick={() => h.sortable && requestSort(h.key)}
            >
              {h.label}{h.sortable && getIndicator(h.key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(({ meta, online, offline }) => {
          const seatsTotal = Number(meta.seats_total) || 0;

          // preferă numărul mașinii, dacă există în date; altfel păstrează câmpul existent
          const vehicleNumber =
            meta.vehicle_plate ?? meta.plate_number ?? meta.vehicle_name ?? '—';
          const o = online || { seats_booked: 0, discount_count: 0, discount_total: 0, paid_total: 0, due_total: 0 };
          const f = offline || { seats_booked: 0, discount_count: 0, discount_total: 0, paid_total: 0, due_total: 0 };

          return (
            <tr key={meta.trip_id} className="hover:bg-blue-50">
              <td className="border px-2 py-1 whitespace-nowrap">{meta.route_name}</td>
              <td className="border px-2 py-1 whitespace-nowrap">{meta.trip_time}</td>
              <td className="border px-2 py-1 whitespace-nowrap">{vehicleNumber}</td>
              <td className="border px-1 py-1 text-center whitespace-nowrap">{seatsTotal}</td>

              {/* Rezervări # */}
              <td className="border px-1 py-1 whitespace-nowrap">
                {dual(f.seats_booked, o.seats_booked, cssOff, cssOn)}
              </td>

              {/* Reduceri # */}
              <td className="border px-1 py-1 whitespace-nowrap">
                {dual(f.discount_count, o.discount_count, cssOff, cssOn)}
              </td>

              {/* Reduceri lei */}
              <td className="border px-1 py-1 whitespace-nowrap">
                {dual(Number(f.discount_total).toFixed(2), Number(o.discount_total).toFixed(2), cssOff, cssOn, 'text-right')}
              </td>

              {/* Încasări efective */}
              <td className="border px-1 py-1 whitespace-nowrap">
                {dual(Number(f.paid_total).toFixed(2), Number(o.paid_total).toFixed(2), cssOff, cssOn, 'text-right')}
              </td>

              {/* De încasat */}
              <td className="border px-1 py-1 whitespace-nowrap">
                {dual(Number(f.due_total).toFixed(2), Number(o.due_total).toFixed(2), cssOff, cssOn, 'text-right')}
              </td>

              <td className="border px-2 py-1 whitespace-nowrap">
                {meta.trip_date ? dayjs(meta.trip_date).format('DD.MM.YYYY') : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="bg-gray-100 font-semibold">
          <td colSpan={4} className="border px-2 py-1 text-right">TOTAL</td>
          <td className="border px-1 py-1 whitespace-nowrap">{dual(totals.offline.seats, totals.online.seats, cssOff, cssOn)}</td>
          <td className="border px-1 py-1 whitespace-nowrap">{dual(totals.offline.discountCount, totals.online.discountCount, cssOff, cssOn)}</td>
          <td className="border px-1 py-1 whitespace-nowrap">{dual(totals.offline.discountTotal.toFixed(2), totals.online.discountTotal.toFixed(2), cssOff, cssOn, 'text-right')}</td>
          <td className="border px-1 py-1 whitespace-nowrap">{dual(totals.offline.paid.toFixed(2), totals.online.paid.toFixed(2), cssOff, cssOn, 'text-right')}</td>
          <td className="border px-1 py-1 whitespace-nowrap">{dual(totals.offline.due.toFixed(2), totals.online.due.toFixed(2), cssOff, cssOn, 'text-right')}</td>
          <td className="border px-2 py-1" />
        </tr>
      </tfoot>
    </table>
  );
}
