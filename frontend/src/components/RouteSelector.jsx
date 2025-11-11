import React, { useMemo, useEffect, useState } from 'react';

export default function RouteSelector({ routes, selectedRoute, onSelectRoute }) {
  const [orderMap, setOrderMap] = useState(null); // { route_id: position_idx }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/user/route-order', { credentials: 'include' });
        const data = await r.json().catch(() => []);
        if (!alive) return;
        const map = {};
        (Array.isArray(data) ? data : []).forEach(it => { map[it.route_id] = it.position_idx; });
        setOrderMap(map);
      } catch {
        setOrderMap(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  const items = useMemo(() => {
    const arr = Array.isArray(routes) ? [...routes] : [];
    if (orderMap && Object.keys(orderMap).length) {
      arr.sort((a, b) => {
        const ia = orderMap[a.id] ?? Infinity;
        const ib = orderMap[b.id] ?? Infinity;
        if (ia !== ib) return ia - ib;
        return a.name.localeCompare(b.name);
      });
      return arr;
    }
    // fallback alfabetic
    return arr.sort((a, b) => a.name.localeCompare(b.name));
  }, [routes, orderMap]);

  return (
    <div className="space-y-2 w-full">
      <h2 className="font-bold text-lg mb-0">Rute</h2>
      <div className="flex flex-nowrap gap-2 w-full overflow-x-auto py-1">
        {items.map((route) => {
          const isActive = selectedRoute?.id === route.id;
          return (
            <button
              key={route.id}
              className={`px-3 py-1 rounded border ${isActive ? 'bg-blue-500 text-white' : 'bg-white'}`}
              onClick={() => onSelectRoute?.(route)}
            >
              {route.name}
            </button>
          );
        })}
        {items.length === 0 && <span className="text-sm text-gray-500">Nicio rută disponibilă</span>}
      </div>
    </div>
  );
}