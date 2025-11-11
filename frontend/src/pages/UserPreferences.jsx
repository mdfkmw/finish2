// File: UserPreferences.jsx
import React, { useEffect, useState, useMemo } from 'react';

export default function UserPreferences() {
  const [routes, setRoutes] = useState([]);
  const [order, setOrder] = useState([]); // [{route_id, position_idx}]
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r1, r2] = await Promise.all([
          fetch('/api/routes').then(r => r.json()),
          fetch('/api/user/route-order', { credentials: 'include' }).then(r => r.json()),
        ]);

        if (!alive) return;

        // map preferințe
        const prefMap = {};
        (Array.isArray(r2) ? r2 : []).forEach(it => { prefMap[it.route_id] = it.position_idx; });

        // sortăm rutele după pref, altfel alfabetic
        const sorted = [...r1].sort((a,b) => {
          const ia = prefMap[a.id] ?? Infinity;
          const ib = prefMap[b.id] ?? Infinity;
          if (ia !== ib) return ia - ib;
          return a.name.localeCompare(b.name);
        });

        // construim vectorul de lucru
        setRoutes(sorted);
        setOrder(sorted.map((r, i) => ({ route_id: r.id, position_idx: i + 1 })));
      } catch (e) {
        console.error(e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const move = (idx, dir) => {
    setOrder(prev => {
      const arr = [...prev];
      const j = dir === 'up' ? idx - 1 : idx + 1;
      if (j < 0 || j >= arr.length) return arr;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      // reindexare 1..n
      arr.forEach((it, k) => it.position_idx = k + 1);
      return arr;
    });
    setRoutes(prev => {
      const arr = [...prev];
      const j = dir === 'up' ? idx - 1 : idx + 1;
      if (j < 0 || j >= arr.length) return arr;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr;
    });
  };

  const save = async () => {
    try {
      await fetch('/api/user/route-order', {
        method: 'PUT',
        headers: { 'Content-Type':'application/json' },
        credentials: 'include',
        body: JSON.stringify({ order }),
      });
      alert('Salvat!');
    } catch (e) {
      console.error(e);
      alert('Eroare la salvare.');
    }
  };

  if (loading) return <div>Se încarcă…</div>;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Preferințe utilizator</h2>

      <div className="p-3 bg-white rounded shadow">
        <div className="text-sm mb-2">Ordinea rutelor (se aplică în pagina de rezervări doar pentru utilizatorul curent):</div>
        <ul className="space-y-1">
          {routes.map((r, idx) => (
            <li key={r.id} className="flex items-center justify-between border rounded px-2 py-1">
              <div className="truncate">{idx + 1}. {r.name}</div>
              <div className="flex gap-2">
                <button
                  className="px-2 py-1 border rounded text-xs"
                  onClick={() => move(idx, 'up')}
                  disabled={idx === 0}
                  title="Mută în sus"
                >▲</button>
                <button
                  className="px-2 py-1 border rounded text-xs"
                  onClick={() => move(idx, 'down')}
                  disabled={idx === routes.length - 1}
                  title="Mută în jos"
                >▼</button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-3">
          <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={save}>Salvează ordinea</button>
        </div>
      </div>

      <div className="p-3 bg-white rounded shadow">
        <div className="text-sm mb-2">Preferințe UI (exemplu – de extins pe viitor):</div>
        <div className="text-xs text-gray-500">Dark mode, culori diagramă etc. vor apărea aici când decizi.</div>
      </div>
    </div>
  );
}
