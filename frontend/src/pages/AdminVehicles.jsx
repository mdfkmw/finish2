import React, { useEffect, useMemo, useState } from "react";

/**
 * AdminVehicles.jsx – complet
 * - listă + filtre
 * - editor detalii
 * - editor layout: preview grilă (cu rând 0 pentru Șofer/Ghid), tabel editabil
 * - + Rând jos (crește zona de lucru; adaugi prin click pe celula nouă)
 * - Adaugă mașină (cu șablon de locuri): POST /api/vehicles, apoi /api/vehicles/:id/seats/bulk
 * - drag & drop: mută locul pe o celulă liberă
 */

const TYPE_OPTIONS = [
    { value: "microbuz", label: "Microbuz" },
    { value: "autocar", label: "Autocar" },
];

const TEMPLATES = [
  { value: "empty", label: "Gol (configurez manual)" },
  { value: "microbus_2x1_20", label: "Microbuz 2+1 (20 locuri, cu șofer/ghid)" },
  { value: "coach_2x2_51", label: "Autocar 2+2 (51 locuri, cu șofer/ghid)" },
  { value: "copy_other", label: "Copiază layout de la altă mașină" },
];



function Field({ label, children }) {
    return (
        <label className="block mb-3">
            <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
            {children}
        </label>
    );
}
function TextInput(props) {
    return (
        <input
            {...props}
            className={
                "w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 " +
                (props.className || "")
            }
        />
    );
}
function Select(props) {
    return (
        <select
            {...props}
            className={
                "w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 " +
                (props.className || "")
            }
        />
    );
}

export default function AdminVehicles() {
    // listă + filtre
    const [vehicles, setVehicles] = useState([]);
    const [loadingList, setLoadingList] = useState(false);
    const [error, setError] = useState("");

    const [operators, setOperators] = useState([]);
    const [operatorFilter, setOperatorFilter] = useState("");
    const [typeFilter, setTypeFilter] = useState("");

    // adăugare mașină
    const [showAddVehicle, setShowAddVehicle] = useState(false);
    const [newVehicle, setNewVehicle] = useState({
        name: "",
        plate_number: "",
        type: "",
        operator_id: "",
        seat_count: "",
        template: "empty",
    });

    // editor vehicul
    const [selectedId, setSelectedId] = useState(null);
    const [vehicle, setVehicle] = useState(null);
    const [savingVehicle, setSavingVehicle] = useState(false);

    // layout
    const [seats, setSeats] = useState([]);
    const [savingSeats, setSavingSeats] = useState(false);

    // grilă
    const [extraRows, setExtraRows] = useState(0); // pentru „+ Rând jos”
    const [extraCols, setExtraCols] = useState(0); // pentru „+ Coloană dreapta”
    const [dragKey, setDragKey] = useState(null);  // drag & drop

    // cheie stabilă (id sau _tmpId)
    const getKey = (s) => s.id ?? s._tmpId;

    // === utils grilă: suport rând 0 (șofer/ghid) ===
    function getDims(list) {
        const minRow = Math.min(
            ...[...list.filter(s => !s._delete).map(s => Number(s.row)).filter(x => Number.isFinite(x)), 1]
        );
        const maxRow = Math.max(
            ...[...list.filter(s => !s._delete).map(s => Number(s.row)).filter(x => Number.isFinite(x)), 1]
        );
        const cols = Math.max(
            ...[...list.filter(s => !s._delete).map(s => Number(s.seat_col)).filter(x => Number.isFinite(x)), 1]
        );
        return { minRow, maxRow, cols };
    }
    function isOccupied(list, r, c) {
        return list.some(s => !s._delete && Number(s.row) === r && Number(s.seat_col) === c);
    }
    function nextFreePosition(list) {
        const { minRow, maxRow, cols } = getDims(list);
        const targetRow = maxRow;
        for (let c = 1; c <= Math.max(cols, 1); c++) {
            if (!isOccupied(list, targetRow, c)) return { row: targetRow, col: c };
        }
        return { row: maxRow + 1, col: 1 };
    }
    function bumpToFree(list, fromRow, fromCol, dir = +1) {
        let { minRow, maxRow, cols } = getDims(list);
        let r = fromRow, c = fromCol;
        while (true) {
            if (!isOccupied(list, r, c)) return { row: r, col: c };
            c += dir;
            if (c < 1) {
                r = Math.max(minRow, r - 1);
                c = cols;
            }
            if (c > cols) {
                r += 1;
                c = 1;
                maxRow = Math.max(maxRow, r);
            }
        }
    }

    // efecte
    useEffect(() => { loadOperators(); }, []);
    useEffect(() => { loadVehicles(); /* eslint-disable-next-line */ }, [operatorFilter, typeFilter]);

    // API
    async function loadOperators() {
        try {
            const r = await fetch("/api/operators");
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            setOperators(Array.isArray(data) ? data : []);
        } catch (e) { console.error(e); }
    }
    async function loadVehicles() {
        try {
            setLoadingList(true); setError("");
            const params = new URLSearchParams();
            if (operatorFilter) params.set("operator_id", operatorFilter);
            if (typeFilter) params.set("type", typeFilter);
            const url = `/api/vehicles${params.toString() ? "?" + params : ""}`;
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            setVehicles(Array.isArray(data) ? data : []);
        } catch (e) { console.error(e); setError("Nu am putut încărca lista de mașini."); }
        finally { setLoadingList(false); }
    }
    async function openEditor(id) {
        setSelectedId(id); setVehicle(null); setSeats([]); setExtraRows(0);
        setExtraCols(0);
        try {
            const r1 = await fetch(`/api/vehicles/${id}`); if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
            const v = await r1.json(); setVehicle(v);

            const r2 = await fetch(`/api/vehicles/${id}/seats`); if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
            const s = await r2.json();
            const withKeys = (Array.isArray(s) ? s : []).map(seat => ({
                ...seat,
                _tmpId: seat._tmpId || seat.id || `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
            }));
            setSeats(withKeys);
        } catch (e) { console.error(e); setError("Nu am putut încărca editorul pentru această mașină."); }
    }

    async function saveVehicleDetails() {
        if (!vehicle?.id) return;
        setSavingVehicle(true); setError("");
        try {
            const r = await fetch(`/api/vehicles/${vehicle.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: vehicle.name ?? "",
                    seat_count: vehicle.seat_count ?? null,
                    type: vehicle.type ?? "",
                    plate_number: vehicle.plate_number ?? "",
                    operator_id: vehicle.operator_id ?? null,
                }),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            await loadVehicles();
        } catch (e) { console.error(e); setError("Nu am putut salva detaliile mașinii."); }
        finally { setSavingVehicle(false); }
    }


    async function deleteVehicle(id) {
        if (!window.confirm("Sigur ștergi această mașină? Operația nu poate fi anulată.")) return;
        try {
            const r = await fetch(`/api/vehicles/${id}`, { method: "DELETE" });
            if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                if (r.status === 409) {
                    alert(data.error || "Mașina este folosită pe curse și nu poate fi ștearsă.");
                } else {
                    alert(data.error || `Eroare la ștergere (HTTP ${r.status})`);
                }
                return;
            }
            // dacă editorul deschis e pentru mașina ștearsă, îl închidem
            if (selectedId === id) {
                setSelectedId(null);
                setVehicle(null);
                setSeats([]);
            }
            await loadVehicles();
        } catch (e) {
            console.error(e);
            alert("Eroare la ștergerea vehiculului.");
        }
    }



    async function saveSeatsLayout() {
        if (!vehicle?.id) return;
        setSavingSeats(true); setError("");
        try {
            for (const s of seats) {
                if (s._delete) continue;
                if (s.row == null || s.seat_col == null) {
                    setSavingSeats(false); setError("Toate locurile trebuie să aibă rând și coloană."); return;
                }
            }
            const r = await fetch(`/api/vehicles/${vehicle.id}/seats/bulk`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(seats),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);

            const r2 = await fetch(`/api/vehicles/${vehicle.id}/seats`);
            const s2 = await r2.json();
            const withKeys = (Array.isArray(s2) ? s2 : []).map(seat => ({
                ...seat,
                _tmpId: seat._tmpId || seat.id || `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
            }));
            setSeats(withKeys);
            await loadVehicles();
        } catch (e) { console.error(e); setError("Nu am putut salva layoutul locurilor."); }
        finally { setSavingSeats(false); }
    }

    // layout actions
    function suggestNextLabel(list) {
        const nums = list.map(s => Number(String(s.label).trim())).filter(n => Number.isFinite(n));
        const next = nums.length ? Math.max(...nums) + 1 : 1;
        return String(next);
    }
    function addSeat() {
        const nextLabel = suggestNextLabel(seats);
        const p = nextFreePosition(seats);
        setSeats(prev => [...prev, {
            vehicle_id: vehicle?.id, seat_number: null, position: null,
            row: p.row, seat_col: p.col, is_available: 1, label: nextLabel,
            seat_type: "normal", pair_id: null,
            _tmpId: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        }]);
    }
    function addSeatAt(row, col) {
        if (isOccupied(seats, row, col)) return;
        const nextLabel = suggestNextLabel(seats);
        setSeats(prev => [...prev, {
            vehicle_id: vehicle?.id, seat_number: null, position: null,
            row, seat_col: col, is_available: 1, label: nextLabel,
            seat_type: "normal", pair_id: null,
            _tmpId: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        }]);
    }
    function updateSeatByKey(key, patch) {
        setSeats(prev => prev.map(s => (getKey(s) === key ? { ...s, ...patch } : s)));
    }
    function markDeleteSeatByKey(key) {
        setSeats(prev => prev.flatMap(s => {
            if (getKey(s) !== key) return [s];
            if (!s.id) return []; // nou → îl scot
            return [{ ...s, _delete: !s._delete }];
        }));
    }

    // template seats generator
    function generateTemplateSeats(template, vehicleId) {
        const out = [];
        let label = 1;

        const pushSeat = (row, col, type = "normal", lbl = null) => {
            out.push({
                vehicle_id: vehicleId,
                row, seat_col: col,
                seat_number: null, position: null, is_available: 1,
                label: lbl ?? String(label++),
                seat_type: type,
                pair_id: null
            });
        };

        // Șofer/Ghid la rând 0 (mereu)
        pushSeat(0, 1, "driver", "Șofer");
        pushSeat(0, 3, "guide", "Ghid");

    if (template === "empty") return out;

    if (template === "microbus_2x1_20") {
      // 2+1 până la 20 locuri pasageri (exclus șofer/ghid)
      // r=1..6 -> 3/row (2 stânga: col1-2, 1 dreapta: col4) => 18
      for (let r = 1; r <= 6; r++) {
        pushSeat(r, 1); pushSeat(r, 2); pushSeat(r, 4);
      }
      // spate: 2 locuri (stânga/dreapta) => total 20
      pushSeat(7, 1); pushSeat(7, 4);
      return out;
    }

    if (template === "coach_2x2_51") {
      // 2+2 standard, 12 rânduri (4/row) => 48
      for (let r = 1; r <= 12; r++) {
        pushSeat(r, 1); pushSeat(r, 2); // stânga
        pushSeat(r, 4); pushSeat(r, 5); // dreapta (col3 = culoar)
      }
      // spate: 3 locuri (fără col3) => 51 total
      pushSeat(13, 1); pushSeat(13, 2); pushSeat(13, 4);
      return out;
    }
        return out;
    }

    // grilă calculată
    const dims = useMemo(() => getDims(seats), [seats]);
    const totalRows = (dims.maxRow - dims.minRow + 1) + extraRows;
    const totalCols = Math.max(1, dims.cols) + extraCols;

    // render
    return (
        <div className="p-4">
            <h2 className="text-xl font-semibold mb-4">Administrare — Mașini</h2>

            {/* FILTRE + LISTĂ */}
            <div className="mb-6 rounded-2xl border border-gray-200 p-4 shadow-sm bg-white">
                <div className="flex flex-wrap items-end gap-3 mb-4">
                    <Field label="Operator">
                        <Select value={operatorFilter} onChange={e => setOperatorFilter(e.target.value)}>
                            <option value="">Toți</option>
                            {operators.map(op => (<option key={op.id} value={op.id}>{op.name}</option>))}
                        </Select>
                    </Field>
                    <Field label="Tip">
                        <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                            <option value="">Toate</option>
                            {TYPE_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                        </Select>
                    </Field>
                    <button className="ml-auto rounded-xl bg-gray-100 hover:bg-gray-200 px-4 py-2" onClick={loadVehicles}>Reîncarcă</button>
                    <button className="rounded-xl bg-blue-600 text-white px-4 py-2 hover:bg-blue-700" onClick={() => setShowAddVehicle(true)}>Adaugă mașină</button>
                </div>

                {loadingList ? <div className="text-gray-500">Se încarcă lista…</div> :
                    error ? <div className="text-red-600">{error}</div> :
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="text-left text-gray-600">
                                        <th className="py-2 pr-4">Nume</th>
                                        <th className="py-2 pr-4">Nr. înmatr.</th>
                                        <th className="py-2 pr-4">Tip</th>
                                        <th className="py-2 pr-4">Operator</th>
                                        <th className="py-2 pr-4">Locuri</th>
                                        <th className="py-2"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vehicles.map(v => (
                                        <tr key={v.id} className="border-t">
                                            <td className="py-2 pr-4">{v.name}</td>
                                            <td className="py-2 pr-4">{v.plate_number}</td>
                                            <td className="py-2 pr-4 capitalize">{v.type}</td>
                                                            <td className="py-2 pr-4">
                  {v.operator_name
                    ?? (operators.find(o => o.id === v.operator_id)?.name)
                    ?? "-"}
                </td>
                                            <td className="py-2 pr-4">{v.seat_count}</td>
                                            <td className="py-2">
                                                <div className="flex gap-2">
                                                    <button
                                                        className="rounded-xl bg-blue-600 text-white px-3 py-1.5 hover:bg-blue-700"
                                                        onClick={() => openEditor(v.id)}
                                                    >
                                                        Editează
                                                    </button>
                                                    <button
                                                        className="rounded-xl bg-red-600 text-white px-3 py-1.5 hover:bg-red-700"
                                                        onClick={() => deleteVehicle(v.id)}
                                                    >
                                                        Șterge
                                                    </button>
                                                </div>
                                            </td>

                                        </tr>
                                    ))}
                                    {vehicles.length === 0 && (
                                        <tr><td colSpan={6} className="py-4 text-gray-500">Nu există mașini pentru filtrul selectat.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>}
            </div>

            {/* MODAL ADĂUGARE MAȘINĂ */}
            {showAddVehicle && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[999]">
                    <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-xl">
                        <h3 className="text-lg font-semibold mb-4">Adaugă mașină</h3>
                        <div className="grid grid-cols-1 gap-3">
                            <Field label="Nume"><TextInput value={newVehicle.name} onChange={e => setNewVehicle({ ...newVehicle, name: e.target.value })} /></Field>
                            <Field label="Număr înmatriculare"><TextInput value={newVehicle.plate_number} onChange={e => setNewVehicle({ ...newVehicle, plate_number: e.target.value })} /></Field>
                            <Field label="Tip">
                                <Select value={newVehicle.type} onChange={e => setNewVehicle({ ...newVehicle, type: e.target.value })}>
                                    <option value="">—</option>
                                    {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </Select>
                            </Field>
                            <Field label="Operator">
                                <Select value={newVehicle.operator_id} onChange={e => setNewVehicle({ ...newVehicle, operator_id: e.target.value })}>
                                    <option value="">—</option>
                                    {operators.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
                                </Select>
                            </Field>
                            <Field label="Nr. locuri (informativ)">
                                <TextInput type="number" value={newVehicle.seat_count} onChange={e => setNewVehicle({ ...newVehicle, seat_count: e.target.value })} />
                            </Field>
                            <Field label="Șablon locuri">
                                <Select value={newVehicle.template} onChange={e => setNewVehicle({ ...newVehicle, template: e.target.value })}>
                                    {TEMPLATES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </Select>
                                {newVehicle.template === "copy_other" && (
  <div className="mt-2">
    <label className="block text-sm text-gray-700 mb-1">Alege mașina sursă</label>
    <select
      value={newVehicle.copyFromId || ""}
      onChange={(e) =>
        setNewVehicle((prev) => ({ ...prev, copyFromId: e.target.value }))
      }
      className="border rounded-lg px-2 py-1 w-full"
    >
      <option value="">Selectează o mașină existentă</option>
      {vehicles.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name} ({v.plate_number})
        </option>
      ))}
    </select>
  </div>
)}

                            </Field>
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                            <button className="rounded-xl bg-gray-100 px-4 py-2" onClick={() => setShowAddVehicle(false)}>Anulează</button>
                            <button className="rounded-xl bg-green-600 text-white px-4 py-2" onClick={handleCreateVehicle}>Creează</button>
                        </div>
                    </div>
                </div>
            )}

            {/* EDITOR VEHICUL + LAYOUT */}
            {selectedId && vehicle && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Detalii */}
                    <div className="rounded-2xl border border-gray-200 p-4 shadow-sm bg-white">
                        <h3 className="text-lg font-medium mb-4">Detalii vehicul</h3>
                        <div className="grid grid-cols-1 gap-3">
                            <Field label="Nume"><TextInput value={vehicle.name || ""} onChange={e => setVehicle({ ...vehicle, name: e.target.value })} /></Field>
                            <Field label="Număr înmatriculare"><TextInput value={vehicle.plate_number || ""} onChange={e => setVehicle({ ...vehicle, plate_number: e.target.value })} /></Field>
                            <Field label="Tip">
                                <Select value={vehicle.type || ""} onChange={e => setVehicle({ ...vehicle, type: e.target.value })}>
                                    <option value="">—</option>
                                    {TYPE_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
                                </Select>
                            </Field>
                            <Field label="Operator">
                                <Select value={vehicle.operator_id || ""} onChange={e => setVehicle({ ...vehicle, operator_id: e.target.value ? Number(e.target.value) : null })}>
                                    <option value="">—</option>
                                    {operators.map(op => (<option key={op.id} value={op.id}>{op.name}</option>))}
                                </Select>
                            </Field>
                            <Field label="Locuri (informativ)">
                                <TextInput type="number" value={vehicle.seat_count ?? ""} onChange={e => setVehicle({ ...vehicle, seat_count: Number(e.target.value) || null })} />
                            </Field>
                        </div>
                        <div className="mt-4 flex gap-3">
                            <button onClick={saveVehicleDetails} disabled={savingVehicle} className="rounded-xl bg-blue-600 text-white px-4 py-2 hover:bg-blue-700 disabled:opacity-60">
                                {savingVehicle ? "Se salvează…" : "Salvează detalii"}
                            </button>
                        </div>
                    </div>

                    {/* Layout */}
                    <div className="rounded-2xl border border-gray-200 p-4 shadow-sm bg-white">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-lg font-medium">Layout locuri</h3>
                            <div className="flex gap-2">
                                <button onClick={()=>setExtraCols(c=>c+1)} className="rounded-xl bg-gray-100 px-3 py-2 hover:bg-gray-200">+ Coloană dreapta</button>
                                <button onClick={() => setExtraRows(r => r + 1)} className="rounded-xl bg-gray-100 px-3 py-2 hover:bg-gray-200">+ Rând jos</button>
                                <button onClick={addSeat} className="rounded-xl bg-gray-100 px-3 py-2 hover:bg-gray-200">+ Adaugă loc</button>
                                <button onClick={saveSeatsLayout} disabled={savingSeats} className="rounded-xl bg-green-600 text-white px-4 py-2 hover:bg-green-700 disabled:opacity-60">
                                    {savingSeats ? "Se salvează…" : "Salvează layout"}
                                </button>
                            </div>
                        </div>

                        {/* PREVIEW GRID (cu drag & drop) */}
                        <div className="mb-4">
                            <div className="bg-gray-50 rounded-2xl p-4 overflow-auto" style={{ border: "1px solid #e5e7eb" }}>
                                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${totalCols}, minmax(44px, 1fr))` }}>
                                    {Array.from({ length: totalRows * totalCols }).map((_, i) => {
                                        const displayRow = Math.floor(i / totalCols); // 0..N
                                        const realRow = dims.minRow + displayRow;     // poate fi 0
                                        const c = (i % totalCols) + 1;

                                        const seat = seats.find(s => Number(s.row) === realRow && Number(s.seat_col) === c && !s._delete);

                                        if (!seat) {
                                            return (
                                                <div
                                                    key={`empty_${realRow}_${c}`}
                                                    onDragOver={(e) => e.preventDefault()}
                                                    onDrop={() => {
                                                        if (!dragKey) return;
                                                        // dacă e liber, mutăm acolo
                                                        if (!isOccupied(seats, realRow, c)) {
                                                            updateSeatByKey(dragKey, { row: realRow, seat_col: c });
                                                        }
                                                        setDragKey(null);
                                                    }}
                                                    className="h-11 rounded-lg bg-transparent border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition"
                                                    title={`Adaugă loc la r${realRow} c${c}`}
                                                    onClick={() => addSeatAt(realRow, c)}
                                                />
                                            );
                                        }

                                        const isDriver = seat.seat_type === "driver" ||
                                            String(seat.label || "").toLowerCase().includes("șofer") ||
                                            String(seat.label || "").toLowerCase().includes("sofer");
                                        const isGuide = seat.seat_type === "guide" ||
                                            String(seat.label || "").toLowerCase().includes("ghid");

                                        return (
                                            <div
                                                key={`${getKey(seat)}_${i}`}
                                                draggable
                                                onDragStart={() => setDragKey(getKey(seat))}
                                                onDragEnd={() => setDragKey(null)}
                                                title={`r${realRow} c${c}`}
                                                className={`h-11 rounded-lg flex items-center justify-center text-sm font-semibold select-none
                          ${seat._delete ? "bg-red-100 text-red-600 border border-red-300" :
                                                        isDriver ? "bg-gray-700 text-white" :
                                                            isGuide ? "bg-slate-500 text-white" :
                                                                "bg-emerald-500 text-white"}`}
                                            >
                                                {seat.label || `${realRow}:${c}`}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                • Rândul 0 (sus) este pentru Șofer/Ghid. Poți trage un loc în altă celulă liberă sau poți da click pe o celulă liberă ca să adaugi acolo.
                            </p>
                        </div>

                        {/* TABEL EDITABIL */}
                        <div className="overflow-auto max-h-[420px] border rounded-xl">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr className="text-left text-gray-600">
                                        <th className="py-2 px-3">Label</th>
                                        <th className="py-2 px-3">Tip</th>
                                        <th className="py-2 px-3">Rând</th>
                                        <th className="py-2 px-3">Coloană</th>
                                        <th className="py-2 px-3">Pair ID</th>
                                        <th className="py-2 px-3"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {seats
                                        .slice()
                                        .sort((a, b) =>
                                            (a.row - b.row) || (a.seat_col - b.seat_col) || String(a.label).localeCompare(String(b.label))
                                        )
                                        .map((s) => {
                                            const key = getKey(s);
                                            return (
                                                <tr key={key} className={`border-t ${s._delete ? "bg-red-50" : ""}`}>
                                                    <td className="py-1.5 px-3"><TextInput value={s.label ?? ""} onChange={e => updateSeatByKey(key, { label: e.target.value })} /></td>
                                                    <td className="py-1.5 px-3">
                                                        <Select value={s.seat_type || "normal"} onChange={e => updateSeatByKey(key, { seat_type: e.target.value })}>
                                                            <option value="normal">norm.</option>
                                                            <option value="driver">driver</option>
                                                            <option value="guide">guide</option>
                                                            <option value="foldable">foldable</option>
                                                            <option value="wheelchair">wheelchair</option>
                                                        </Select>
                                                    </td>
                                                    {/* RÂND */}
                                                    <td className="py-1.5 px-3 w-36">
                                                        <div className="flex items-center gap-1">
                                                            <button type="button" className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                                                                onClick={() => {
                                                                    const list = seats.filter(x => getKey(x) !== key);
                                                                    const target = bumpToFree(list, (s.row ?? 0) - 1, s.seat_col, -1);
                                                                    updateSeatByKey(key, { row: target.row });
                                                                }}>−</button>
                                                            <TextInput
                                                                type="number" value={s.row ?? ""}
                                                                onChange={e => updateSeatByKey(key, { row: Number(e.target.value) || 0 })}
                                                                onBlur={() => {
                                                                    const list = seats.filter(x => getKey(x) !== key);
                                                                    const r = Number(s.row) || 0, c = Number(s.seat_col) || 1;
                                                                    if (isOccupied(list, r, c)) {
                                                                        const t = bumpToFree(list, r, c, +1);
                                                                        updateSeatByKey(key, { row: t.row, seat_col: t.col });
                                                                    }
                                                                }}
                                                            />
                                                            <button type="button" className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                                                                onClick={() => {
                                                                    const list = seats.filter(x => getKey(x) !== key);
                                                                    const target = bumpToFree(list, (s.row ?? 0) + 1, s.seat_col, +1);
                                                                    updateSeatByKey(key, { row: target.row });
                                                                }}>＋</button>
                                                        </div>
                                                    </td>
                                                    {/* COLOANĂ */}
                                                    <td className="py-1.5 px-3 w-36">
                                                        <div className="flex items-center gap-1">
                                                            <button type="button" className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                                                                onClick={() => {
                                                                    const c = Math.max(1, (s.seat_col || 1) - 1);
                                                                    const list = seats.filter(x => getKey(x) !== key);
                                                                    const t = bumpToFree(list, s.row ?? 0, c, -1);
                                                                    updateSeatByKey(key, { row: t.row, seat_col: t.col });
                                                                }}>−</button>
                                                            <TextInput
                                                                type="number" value={s.seat_col ?? ""}
                                                                onChange={e => updateSeatByKey(key, { seat_col: Number(e.target.value) || 0 })}
                                                                onBlur={() => {
                                                                    const list = seats.filter(x => getKey(x) !== key);
                                                                    const r = Number(s.row) || 0, c = Number(s.seat_col) || 1;
                                                                    if (isOccupied(list, r, c)) {
                                                                        const t = bumpToFree(list, r, c, +1);
                                                                        updateSeatByKey(key, { row: t.row, seat_col: t.col });
                                                                    }
                                                                }}
                                                            />
                                                            <button type="button" className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                                                                onClick={() => {
                                                                    const list = seats.filter(x => getKey(x) !== key);
                                                                    const t = bumpToFree(list, s.row ?? 0, (s.seat_col || 1) + 1, +1);
                                                                    updateSeatByKey(key, { row: t.row, seat_col: t.col });
                                                                }}>＋</button>
                                                        </div>
                                                    </td>
                                                    {/* Pair ID */}
                                                    <td className="py-1.5 px-3 w-28">
                                                        <TextInput type="number" value={s.pair_id ?? ""} onChange={e => updateSeatByKey(key, { pair_id: Number(e.target.value) || null })} />
                                                    </td>
                                                    <td className="py-1.5 px-3">
                                                        <button className={`rounded-lg px-3 py-1.5 text-sm ${s._delete ? "bg-gray-200" : "bg-red-600 text-white hover:bg-red-700"}`} onClick={() => markDeleteSeatByKey(key)}>
                                                            {s._delete ? "Anulează" : "Șterge"}
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    {seats.length === 0 && (<tr><td colSpan={6} className="py-4 px-3 text-gray-500">Nu există locuri. Apasă „+ Adaugă loc”.</td></tr>)}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    // === handlers pentru creare vehicul nou + template
    async function handleCreateVehicle() {
        try {
            if (!newVehicle.name || !newVehicle.type) {
                alert("Completează Nume și Tip."); return;
            }
            const body = {
                name: newVehicle.name,
                plate_number: newVehicle.plate_number || "",
                type: newVehicle.type,
                operator_id: newVehicle.operator_id ? Number(newVehicle.operator_id) : null,
                seat_count: newVehicle.seat_count ? Number(newVehicle.seat_count) : null,
            };
            const r = await fetch("/api/vehicles", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
            });
            if (!r.ok) { alert("Nu am putut crea mașina. Verifică backend-ul pentru POST /api/vehicles."); return; }
      const created = await r.json();
      const newId = created?.id ?? created?.insertId ?? null;
      if (!newId) {
        alert("Nu am primit ID-ul noii mașini de la server."); 
        return;
      }

      // dacă e template ≠ empty → seed layout înainte de a deschide editorul
      if (newVehicle.template === "copy_other" && newVehicle.copyFromId) {
  console.log("Copiere layout de la vehicul:", newVehicle.copyFromId);
  const src = await fetch(`/api/vehicles/${newVehicle.copyFromId}/seats`);
  const srcSeats = await src.json();
  if (Array.isArray(srcSeats) && srcSeats.length > 0) {
    const newSeats = srcSeats.map((s) => ({
      ...s,
      id: undefined,
      vehicle_id: newId,
    }));
    const rCopy = await fetch(`/api/vehicles/${newId}/seats/bulk`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newSeats),
    });
    if (!rCopy.ok) {
      alert("Nu s-a putut copia layoutul.");
    }
  }
} else if (newVehicle.template !== "empty") {
  const templateSeats = generateTemplateSeats(newVehicle.template, newId);
  await fetch(`/api/vehicles/${newId}/seats/bulk`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(templateSeats),
  });
}


      setShowAddVehicle(false);
      setNewVehicle({ name:"", plate_number:"", type:"", operator_id:"", seat_count:"", template:"empty", copyFromId: "", });
      await loadVehicles();
      await openEditor(newId);
       } catch (e) {
            console.error(e);
            alert("Eroare la crearea mașinii.");
        }
    }
}
