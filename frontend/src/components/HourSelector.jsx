import React, { useMemo } from 'react';

const normalizeDirection = (value) => (value === 'retur' ? 'retur' : 'tur');

export default function HourSelector({ selectedRoute, selectedSchedule, onSelectSchedule }) {
  const { tur, retur } = useMemo(() => {
    const all = Array.isArray(selectedRoute?.schedules) ? selectedRoute.schedules : [];
    const tur = all.filter((s) => normalizeDirection(s.direction) === 'tur');
    const retur = all.filter((s) => normalizeDirection(s.direction) === 'retur');
    return { tur, retur };
  }, [selectedRoute]);

  const renderGroup = (title, items) => {
    if (!items.length) return null;
    // ✅ DEDUP: eliminăm intrările duplicate pe (operatorId, direction, departure, scheduleId)
    const seen = new Set();
    const uniqueItems = [];
    for (const s of items) {
      const dir = normalizeDirection(s?.direction);
      const dep = s?.departure || '';
      const op  = s?.operatorId ?? 'x';
      const sid = s?.scheduleId ?? s?.id ?? 'noid';
      const key = `${op}|${dir}|${dep}|${sid}`;
      if (dep && !seen.has(key)) {
        seen.add(key);
        uniqueItems.push(s);
      }
    }
    return (
      <div className="mt-2">
        <div className="text-sm font-semibold mb-1">{title}</div>
        <div className="flex flex-wrap gap-2">
          {uniqueItems.map((sch) => {
            const { scheduleId, id, operatorId, direction, departure, themeColor, disabledRun, disabledOnline, tripDisabled } = sch;
            // id intern pentru cheie (stabil, unic)
            const keyId = (scheduleId ?? id) ?? `${operatorId ?? 'x'}-${normalizeDirection(direction)}-${departure}`;
            // id pentru comparația de selecție (dacă nu ai id pe schedule, lăsăm numai după id existent)
            const selectedId = (selectedSchedule?.scheduleId ?? selectedSchedule?.id) ?? null;
            const isActive = selectedId != null && selectedId === (scheduleId ?? id);
            const isDisabled = !!(Number(tripDisabled) || Number(disabledRun) || Number(disabledOnline));
            return (
              <button
                key={String(keyId)} 
                onClick={() => !isDisabled && onSelectSchedule?.(sch)}
                disabled={isDisabled}
                aria-pressed={isActive}
                className={`
                  px-2 py-0 rounded-lg border-1 focus:outline-none
                  ${isActive ? 'ring-2 ring-offset-2 ring-opacity-50' : 'hover:ring-1 hover:ring-offset-1'}
                  ${isDisabled ? 'line-through text-gray-400 cursor-not-allowed' : ''}
                `}
                style={{
                  backgroundColor: (themeColor || '#2563eb') + '20',
                  borderColor: themeColor || '#2563eb'
                }}
              >
                {departure}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  if (!tur.length && !retur.length) {
    return <div className="text-gray-500">Nicio oră disponibilă pentru această rută.</div>;
  }

  return (
    <div className="mt-2 space-y-2">
      {renderGroup('Tur', tur)}
      {renderGroup('Retur', retur)}
    </div>
  );
}