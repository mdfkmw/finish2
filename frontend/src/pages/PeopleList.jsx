import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

export default function PeopleList() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name');    // 'name' | 'phone'
  const [order, setOrder] = useState('asc');   // 'asc' | 'desc'
  const [page, setPage] = useState(0);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const limit = 25;
  const offset = page * limit;

  // debounce simplu pt. search
  const debouncedQ = useMemo(() => q, [q]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: debouncedQ,
          sort, order, limit: String(limit), offset: String(offset)
        });
        const r = await fetch(`/api/people?${params.toString()}`);
        const js = await r.json();
        if (!alive) return;
        setItems(js.items || []);
        setTotal(js.total || 0);
      } catch (e) {
        if (!alive) return;
        console.error('Eroare la încărcarea pasagerilor', e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [debouncedQ, sort, order, offset]);

  const pageCount = Math.ceil(total / limit);

  const toggleSort = (col) => {
    if (sort !== col) {
      setSort(col);
      setOrder('asc');
      setPage(0);
    } else {
      setOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
      setPage(0);
    }
  };

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Pasageri</h1>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="border rounded px-3 py-2 w-64"
          placeholder="Caută după nume sau telefon"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
        />
        <div className="ml-auto flex items-center gap-2 text-sm">
          <button
            className={`px-3 py-2 border rounded ${sort==='name'?'bg-gray-100':''}`}
            onClick={() => toggleSort('name')}
            title="Sortează după nume"
          >
            Nume {sort==='name' ? (order==='asc'?'↑':'↓') : ''}
          </button>
          <button
            className={`px-3 py-2 border rounded ${sort==='phone'?'bg-gray-100':''}`}
            onClick={() => toggleSort('phone')}
            title="Sortează după telefon"
          >
            Telefon {sort==='phone' ? (order==='asc'?'↑':'↓') : ''}
          </button>
        </div>
      </div>

      <div className="bg-white border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2 border">#</th>
              <th className="text-left p-2 border">Nume</th>
              <th className="text-left p-2 border">Telefon</th>
              <th className="text-left p-2 border">Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="p-4 text-center">Se încarcă…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={4} className="p-4 text-center text-gray-500">Niciun rezultat</td></tr>
            ) : (
              items.map((p, idx) => (
                <tr key={p.id}>
                  <td className="p-2 border">{offset + idx + 1}</td>
                  <td className="p-2 border">{p.name || '—'}</td>
                  <td className="p-2 border">{p.phone || '—'}</td>
                  <td className="p-2 border">
                    <Link
                      to={`/raport/${p.id}`}
                      className="inline-flex items-center px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                      title="Vezi raport"
                    >
                      Vizualizează
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>Total: {total}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page===0}
              className="px-3 py-1 border rounded disabled:opacity-50"
              onClick={() => setPage(p => Math.max(p-1,0))}
            >← Înapoi</button>
            <span>Pagina {page+1} / {pageCount}</span>
            <button
              disabled={page>=pageCount-1}
              className="px-3 py-1 border rounded disabled:opacity-50"
              onClick={() => setPage(p => Math.min(p+1,pageCount-1))}
            >Înainte →</button>
          </div>
        </div>
      )}
    </div>
  );
}
