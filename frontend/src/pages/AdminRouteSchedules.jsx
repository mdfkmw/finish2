// File: AdminRouteSchedules.jsx
import React, { useEffect, useState } from 'react';

export default function AdminRouteSchedules({ routeId }) {
    const [items, setItems] = useState([]);
    const [operators, setOperators] = useState([]);
    const [hour, setHour] = useState('00:00');
    const [direction, setDirection] = useState('tur');
    const [operatorId, setOperatorId] = useState('');
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [editHour, setEditHour] = useState('');
    const [editDirection, setEditDirection] = useState('tur');
    const [editOperatorId, setEditOperatorId] = useState('');
    const [sortKey, setSortKey] = useState('time');   // 'time' | 'direction' | 'operator'
    const [sortDir, setSortDir] = useState('asc');    // 'asc' | 'desc'
    const [filterOperatorId, setFilterOperatorId] = useState(''); // '' = toți
    const [filterDirection, setFilterDirection] = useState('');   // '' = ambele, 'tur' | 'retur'







    const load = async () => {
        setLoading(true);
        try {
            console.log('DEBUG loading schedules for route', routeId);

            // încărcăm simultan operatorii și orele
            const [opsRes, schRes] = await Promise.all([
                fetch('/api/operators').then(r => r.json()),
                fetch(`/api/routes/${routeId}/schedules`).then(r => r.json()),

            ]);
            const normOps = (Array.isArray(opsRes) ? opsRes : []).map(o => ({
                id: Number(o.id ?? o.operator_id),
                name: o.name
            }));
            console.log('DEBUG operators:', opsRes);
            setOperators(normOps);
            setItems(Array.isArray(schRes) ? schRes : []);
            // la schimbarea rutei alegem clar primul operator disponibil
            setOperatorId(normOps.length && normOps[0].id ? String(normOps[0].id) : '');
        } catch (e) {
            console.error(e);
            setItems([]);
            setOperators([]);
        } finally {
            setLoading(false);


        }
    };

    useEffect(() => { load(); }, [routeId]);


    // UI: activăm butonul dacă există oră și operator. Backendul normalizează formatul.
    const canAdd = !loading && Boolean(operatorId);
    console.log('DEBUG canAdd:', { loading, hour, operatorId, canAdd });


    const filteredItems = React.useMemo(() => {
        let arr = [...items];
        if (filterOperatorId) {
            const opId = Number(filterOperatorId);
            arr = arr.filter(it => Number(it.operator_id) === opId);
        }
        if (filterDirection) {
            const dir = filterDirection.toLowerCase();
            arr = arr.filter(it => (it.direction || '').toLowerCase() === dir);
        }
        return arr;
    }, [items, filterOperatorId, filterDirection]);

    const sortedItems = React.useMemo(() => {
        const arr = [...filteredItems];
        const dirMul = sortDir === 'desc' ? -1 : 1;
        arr.sort((a, b) => {
            if (sortKey === 'time') {
                const [ah, am] = String(a.departure || '00:00').split(':').map(n => parseInt(n, 10) || 0);
                const [bh, bm] = String(b.departure || '00:00').split(':').map(n => parseInt(n, 10) || 0);
                const va = ah * 60 + am;
                const vb = bh * 60 + bm;
                if (va !== vb) return (va - vb) * dirMul;
                // tie-breaker pe operator apoi pe sens
            }
            if (sortKey === 'direction') {
                const order = { tur: 0, retur: 1 };
                const va = order[(a.direction || '').toLowerCase()] ?? 9;
                const vb = order[(b.direction || '').toLowerCase()] ?? 9;
                if (va !== vb) return (va - vb) * dirMul;
            }
            if (sortKey === 'operator') {
                const na = (a.operator_name || '').toLowerCase();
                const nb = (b.operator_name || '').toLowerCase();
                if (na !== nb) return na.localeCompare(nb) * dirMul;
            }
            // fallback stabil: după oră, apoi id
            const [ah, am] = String(a.departure || '00:00').split(':').map(n => parseInt(n, 10) || 0);
            const [bh, bm] = String(b.departure || '00:00').split(':').map(n => parseInt(n, 10) || 0);
            const fa = ah * 60 + am, fb = bh * 60 + bm;
            if (fa !== fb) return (fa - fb) * (sortKey === 'time' ? dirMul : 1);
            return (a.id - b.id);
        });
        return arr;
    }, [filteredItems, sortKey, sortDir]);




    const add = async () => {
        if (!operatorId) { alert('Alege operatorul'); return; }
        if (!hour) { alert('Completează ora'); return; }
        try {
            const res = await fetch(`/api/routes/${routeId}/schedules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ departure: hour, direction, operator_id: Number(operatorId) }),
            });
     if (!res.ok) {
       let msg = 'Eroare la adăugare';
       try { const data = await res.json(); if (data?.error) msg = data.error; } catch {}
       alert(msg);
       return;
     }
     setHour('00:00'); // sau '' — cum preferi tu
     await load();
        } catch (e) {
            console.error(e);
            alert('Eroare la adăugare');
        }
    };

    const delItem = async (id) => {
        if (!window.confirm('Ștergi ora?')) return;
        await fetch(`/api/routes/${routeId}/schedules/${id}`, { method: 'DELETE' });
        await load();
    };

    const startEdit = (it) => {
        setEditingId(it.id);
        setEditHour(it.departure);
        setEditDirection(it.direction || 'tur');
        setEditOperatorId(String(it.operator_id || ''));
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditHour('');
        setEditDirection('tur');
        setEditOperatorId('');
    };


    
    const saveEdit = async () => {
        if (!editingId) return;
        if (!/^\d{2}:\d{2}$/.test(editHour)) { alert('Completează ora (HH:MM)'); return; }
        try {
            await fetch(`/api/routes/${routeId}/schedules/${editingId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    departure: editHour,
                    direction: editDirection,
                    operator_id: editOperatorId ? Number(editOperatorId) : null,
                }),
            });
            cancelEdit();
            await load();
        } catch (e) {
            console.error(e);
            alert('Eroare la salvare');
        }
    };

    return (
        <div className="space-y-2">
            {/* filtre + sortare */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-1">
                    <span className="text-gray-600">Filtru operator</span>
                    <select
                        className="border rounded px-2 py-1"
                        value={filterOperatorId}
                        onChange={(e) => setFilterOperatorId(e.target.value)}
                    >
                        <option value="">Toți</option>
                        {operators.map(op => (
                            <option key={op.id} value={op.id}>{op.name}</option>
                        ))}
                    </select>
                </label>
                <label className="flex items-center gap-1">
                    <span className="text-gray-600">Filtru sens</span>
                    <select
                        className="border rounded px-2 py-1"
                        value={filterDirection}
                        onChange={(e) => setFilterDirection(e.target.value)}
                    >
                        <option value="">Ambele</option>
                        <option value="tur">Tur</option>
                        <option value="retur">Retur</option>
                    </select>
                </label>
                <label className="flex items-center gap-1">
                    <span className="text-gray-600">Sortează după</span>
                    <select
                        className="border rounded px-2 py-1"
                        value={sortKey}
                        onChange={(e) => setSortKey(e.target.value)}
                    >
                        <option value="time">Oră</option>
                        <option value="direction">Sens</option>
                        <option value="operator">Operator</option>
                    </select>
                </label>
                <label className="flex items-center gap-1">
                    <span className="text-gray-600">Ordine</span>
                    <select
                        className="border rounded px-2 py-1"
                        value={sortDir}
                        onChange={(e) => setSortDir(e.target.value)}
                    >
                        <option value="asc">Asc</option>
                        <option value="desc">Desc</option>
                    </select>
                </label>
                {(filterOperatorId || filterDirection) && (
                    <button
                        className="px-2 py-1 border rounded"
                        onClick={() => { setFilterOperatorId(''); setFilterDirection(''); }}
                        title="Resetează filtrele"
                    >
                        Reset
                    </button>
                )}
            </div>

            {/* bara de ADĂUGARE e vizibilă doar când NU editezi */}
            {editingId === null && (
                <div className="flex flex-wrap items-center gap-2">

                    <input
                        type="time"
                        step="60"             // doar minute; ascunde secunde
                        className="border rounded px-2 py-1"
                        value={hour}
                        onChange={(e) => setHour(e.target.value)}
                    />
                    <select
                        className="border rounded px-2 py-1"
                        value={direction}
                        onChange={(e) => setDirection(e.target.value)}
                    >
                        <option value="tur">Tur</option>
                        <option value="retur">Retur</option>
                    </select>
                    <select
                        className="border rounded px-2 py-1"
                        value={operatorId}
                        onChange={(e) => setOperatorId(e.target.value)}
                        title="Operator"
                    >
                        <option value="">— alege operator —</option>
                        {operators.map(op => (
                            <option key={op.id} value={op.id}>{op.name}</option>
                        ))}
                    </select>
                    <button
                        className="px-3 py-1 bg-green-600 text-white rounded disabled:opacity-50"
                        onClick={add}
                        disabled={!canAdd}
                        title={!operatorId ? 'Alege operatorul' : !hour ? 'Completează ora' : 'Adaugă'}
                    >
                        Adaugă
                    </button>
                    {/* DEBUG vizibil, o linie */}
                    {!canAdd && (
                        <span className="text-xs text-gray-500 ml-2">
                            {!hour ? 'Lipsește ora' : !operatorId ? 'Lipsește operatorul' : loading ? 'Se încarcă' : ''}
                        </span>
                    )}
                </div>
            )}

            {loading && <div className="text-sm text-gray-500">Se încarcă orele…</div>}
            {!loading && items.length === 0 && <div className="text-sm text-gray-500">Nicio oră pentru rută.</div>}

            {!loading && sortedItems.length > 0 && (
                <ul className="space-y-1">
                    {sortedItems.map(it => (
                        <li key={it.id} className="flex items-center justify-between border rounded px-2 py-1 bg-white">
                            {editingId === it.id ? (
                                <>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <input
                                            type="time"
                                            step="60"             // doar minute; ascunde secunde
                                            className="border rounded px-2 py-1"
                                            value={editHour}
                                            onChange={(e) => setEditHour(e.target.value)}
                                        />
                                        <select
                                            className="border rounded px-2 py-1"
                                            value={editDirection}
                                            onChange={(e) => setEditDirection(e.target.value)}
                                        >
                                            <option value="tur">Tur</option>
                                            <option value="retur">Retur</option>
                                        </select>
                                        <select
                                            className="border rounded px-2 py-1"
                                            value={editOperatorId}
                                            onChange={(e) => setEditOperatorId(e.target.value)}
                                            title="Operator"
                                        >
                                            <option value="">— alege operator —</option>
                                            {operators.map(op => (
                                                <option key={op.id} value={op.id}>{op.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button className="px-3 py-1 bg-blue-600 text-white rounded text-sm" onClick={saveEdit}>Salvează</button>
                                        <button className="px-3 py-1 border rounded text-sm" onClick={cancelEdit}>Anulează</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <span className="font-mono">{it.departure}</span>
                                        <span className="text-gray-500"> — {it.direction}</span>
                                        {it.operator_name
                                            ? <span className="ml-2 text-xs text-gray-600">({it.operator_name})</span>
                                            : it.operator_id
                                                ? <span className="ml-2 text-xs text-gray-500">(operator #{it.operator_id})</span>
                                                : null}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            className={`text-blue-700 text-sm ${editingId ? 'opacity-50 pointer-events-none' : ''}`}
                                            onClick={() => startEdit(it)}
                                            disabled={!!editingId}
                                        >
                                            Editează
                                        </button>
                                        <button
                                            className={`text-red-600 text-sm ${editingId ? 'opacity-50 pointer-events-none' : ''}`}
                                            onClick={() => delItem(it.id)}
                                            disabled={!!editingId}
                                        >
                                            Șterge
                                        </button>
                                    </div>
                                </>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
