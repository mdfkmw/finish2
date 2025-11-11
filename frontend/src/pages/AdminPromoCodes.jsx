// File: src/pages/AdminPromoCodes.jsx
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export default function AdminPromoCodes() {
    const [items, setItems] = useState([]);
    const defaultForm = () => ({
        code: '', label: '', type: 'percent', value_off: 0,
        valid_from: '', valid_to: '', active: true,
        channels: { online: true, agent: false },
        min_price: '', max_discount: '', max_total_uses: '', max_uses_per_person: '',
        combinable: false,
        route_ids: [],
        route_schedule_ids: [],
        hours: [],
        weekdays: []
    });
    const [form, setForm] = useState(defaultForm());
    const [editId, setEditId] = useState(null); // null=create, number=edit
    const [routes, setRoutes] = useState([]);      // [{id,name}]
    const [schedules, setSchedules] = useState([]); // [{id,label,routeId}]
    const load = async () => {
        try {
            const r = await fetch('/api/promo-codes');
            const data = r.ok ? await r.json() : [];
            setItems(Array.isArray(data) ? data : []);
        } catch {
            setItems([]);
        }
    };
    useEffect(() => {
        load();
        const today = new Date().toISOString().slice(0, 10);
        fetch(`/api/routes?date=${today}`)
            .then(r => r.ok ? r.json() : [])
            .then(data => {
                const safe = Array.isArray(data) ? data : [];
                // rutele pentru checkbox „Trasee permise”
                setRoutes(safe.map(r => ({ id: r.id, name: r.name })));
                // aplatizăm orarele ca în AdminDisabledSchedules
                const flat = [];
                safe.forEach(r => {
                    (r.schedules || []).forEach(sch => {
                        flat.push({
                            id: sch.scheduleId ?? sch.id,                 // ID de schedule folosit în restul aplicației
                            label: `${r.name} — ${sch.departure}`,        // etichetă afișată
                            routeId: r.id
                        });
                    });
                });
                setSchedules(flat);
            })
            .catch(() => { setRoutes([]); setSchedules([]); });
    }, []);
    const save = async (e) => {
        e.preventDefault();
        if (!form.code.trim() || !form.label.trim() || !String(form.value_off).trim()) {
            alert('Completează: Cod, Label și Valoare');
            return;
        }
        const payload = {
            ...form,
            code: (form.code || '').toUpperCase().trim(),
            channels: [
                form.channels.online ? 'online' : null,
                form.channels.agent ? 'agent' : null
            ].filter(Boolean).join(',')
        };
    const url = editId ? `/api/promo-codes/${editId}` : '/api/promo-codes';
    const method = editId ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
       if (r.ok) {
            setForm(defaultForm());
            setEditId(null);
            load();
        } else {
            const err = await r.json().catch(() => null);
            alert(err?.error || 'Eroare la salvare');
        }
    };


  const startEdit = (item) => {
    setEditId(item.id);
    setForm({
      code: item.code,
      label: item.label,
      type: item.type,
      value_off: item.value_off,
      valid_from: item.valid_from ? item.valid_from.replace('Z','').slice(0,16) : '',
      valid_to: item.valid_to ? item.valid_to.replace('Z','').slice(0,16) : '',
      active: !!item.active,
      channels: {
        online: (item.channels||'').includes('online'),
        agent:  (item.channels||'').includes('agent'),
      },
      min_price: item.min_price ?? '',
      max_discount: item.max_discount ?? '',
      max_total_uses: item.max_total_uses ?? '',
      max_uses_per_person: item.max_uses_per_person ?? '',
      combinable: !!item.combinable,
      route_ids: [],            // pentru simplitate: le poți popula la nevoie dintr-un editor dedicat
      route_schedule_ids: [],
      hours: [],
      weekdays: []
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => { setEditId(null); setForm(defaultForm()); };

  const toggleActive = async (id) => {
    const r = await fetch(`/api/promo-codes/${id}/toggle`, { method: 'PATCH' });
    if (r.ok) load();
  };

  const removeCode = async (id) => {
    if (!window.confirm('Sigur ștergi acest cod promo?')) return;
    const r = await fetch(`/api/promo-codes/${id}`, { method: 'DELETE' });
    if (r.ok) load();
  };
    return (
        <div className="space-y-6">
            <Card>
                <CardContent className="p-4">
                    <form onSubmit={save} className="grid md:grid-cols-3 gap-4">
                        <div>
                            <Label>Cod</Label>
                            <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="EX: FALL25" />
                        </div>
                        <div>
                            <Label>Label</Label>
                            <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Tip</Label>
                            <select className="w-full border rounded h-10 px-2" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                                <option value="percent">Procent</option>
                                <option value="fixed">Fix (lei)</option>
                            </select>
                        </div>
                        <div>
                            <Label>Valoare</Label>
                            <Input type="number" step="0.01" value={form.value_off} onChange={e => setForm(f => ({ ...f, value_off: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Valabil de la</Label>
                            <Input type="datetime-local" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Valabil până la</Label>
                            <Input type="datetime-local" value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} />
                        </div>
                        <div className="flex items-center gap-3">
                            <input id="online" type="checkbox" checked={form.channels.online} onChange={e => setForm(f => ({ ...f, channels: { ...f.channels, online: e.target.checked } }))} />
                            <Label htmlFor="online" className="m-0">Online</Label>
                            <input id="agent" type="checkbox" checked={form.channels.agent} onChange={e => setForm(f => ({ ...f, channels: { ...f.channels, agent: e.target.checked } }))} />
                            <Label htmlFor="agent" className="m-0">Offline (agent)</Label>
                        </div>
                        <div>
                            <Label>Prag minim (lei)</Label>
                            <Input type="number" step="0.01" value={form.min_price} onChange={e => setForm(f => ({ ...f, min_price: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Plafon reducere (lei)</Label>
                            <Input type="number" step="0.01" value={form.max_discount} onChange={e => setForm(f => ({ ...f, max_discount: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Max. utilizări total</Label>
                            <Input type="number" value={form.max_total_uses} onChange={e => setForm(f => ({ ...f, max_total_uses: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Max. utilizări/persoană</Label>
                            <Input type="number" value={form.max_uses_per_person} onChange={e => setForm(f => ({ ...f, max_uses_per_person: e.target.value }))} />
                        </div>
                        <div className="flex items-center gap-2">
                            <input id="combinable" type="checkbox" checked={form.combinable} onChange={e => setForm(f => ({ ...f, combinable: e.target.checked }))} />
                            <Label htmlFor="combinable" className="m-0">Combinabil cu alte reduceri</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <input id="active" type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                            <Label htmlFor="active" className="m-0">Activ</Label>
                        </div>

                        {/* ==== FILTRARE / SCOPE ==== */}
                        <div className="md:col-span-3 mt-2 p-3 border rounded">
                            <div className="font-semibold mb-3">Filtrare (scope) — opțional</div>
                            {/* Trasee */}
                            <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                    <Label>Trasee permise</Label>
                                    <div className="border rounded max-h-40 overflow-auto p-2">
                                        {routes.map(r => (
                                            <label key={r.id} className="flex items-center gap-2 py-1">
                                                <input
                                                    type="checkbox"
                                                    checked={(form.route_ids || []).includes(r.id)}
                                                    onChange={e => {
                                                        setForm(f => {
                                                            const s = new Set(f.route_ids);
                                                            e.target.checked ? s.add(r.id) : s.delete(r.id);
                                                            return { ...f, route_ids: [...s] };
                                                        });
                                                    }}
                                                />
                                                <span>{r.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">Dacă nu selectezi nimic: valabil pe toate traseele.</div>
                                </div>
                                {/* Orar / Route schedules (din /api/routes?date=..., aplatizat) */}
                                <div>
                                    <Label>Orar(e) permise</Label>
                                    {Array.isArray(schedules) && schedules.length > 0 ? (
                                        <div className="border rounded max-h-40 overflow-auto p-2">
                                            {schedules.map(s => (
                                                <label key={s.id} className="flex items-center gap-2 py-1">
                                                    <input
                                                        type="checkbox"
                                                        checked={(form.route_schedule_ids || []).includes(s.id)}
                                                        onChange={e => {
                                                            setForm(f => {
                                                                const sids = new Set(f.route_schedule_ids || []);
                                                                e.target.checked ? sids.add(s.id) : sids.delete(s.id);
                                                                return { ...f, route_schedule_ids: [...sids] };
                                                            });
                                                        }}
                                                    />
                                                    <span>{s.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-gray-500 mt-1">
                                            Nu există orare returnate de /api/routes. Poți folosi „Intervale orare zilnice”.
                                        </div>
                                    )}
                                    <div className="text-xs text-gray-500 mt-1">
                                        Dacă nu selectezi nimic: valabil pe toate orele.
                                    </div>

                                </div>
                            </div>

                            {/* Interval(e) orare zilnice */}
                            <div className="mt-4">
                                <Label>Intervale orare zilnice (opțional)</Label>
                                <HoursEditor
                                    value={form.hours}
                                    onChange={(hours) => setForm(f => ({ ...f, hours }))}
                                />
                                <div className="text-xs text-gray-500 mt-1">Ex.: 08:00–10:00 și 16:00–18:00. Dacă nu pui nimic: valabil toată ziua.</div>
                            </div>

                            {/* Zile săptămână */}
                            <div className="mt-4">
                                <Label>Zile ale săptămânii (opțional)</Label>
                                <div className="flex flex-wrap gap-3 mt-2">
                                    {['D', 'L', 'Ma', 'Mi', 'J', 'V', 'S'].map((lbl, idx) => (
                                        <label key={idx} className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={(form.weekdays || []).includes(idx)}
                                                onChange={e => {
                                                    setForm(f => {
                                                        const s = new Set(f.weekdays);
                                                        e.target.checked ? s.add(idx) : s.delete(idx);
                                                        return { ...f, weekdays: [...s].sort() };
                                                    });
                                                }}
                                            />
                                            <span>{lbl}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">Dacă nu bifezi: valabil în toate zilele.</div>
                            </div>
                        </div>

                        <div className="md:col-span-3 flex items-center gap-2">
                            <Button type="submit">{editId ? 'Salvează modificările' : 'Salvează'}</Button>
                            {editId && (
                                <button type="button" onClick={cancelEdit} className="h-10 px-3 rounded border">
                                    Anulează editarea
                                </button>
                            )}
                        </div>
                    </form>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-4">
                    <div className="font-semibold mb-2">Coduri existente</div>
                    <div className="overflow-auto">
                        <table className="min-w-[1100px] w-full text-sm">
                            <thead><tr className="text-left border-b">
                                <th className="py-2">ID</th><th>Cod</th><th>Label</th><th>Tip</th><th>Valoare</th><th>Active</th><th>Canale</th><th>Scope</th><th className="py-2">Acțiuni</th>
                            </tr></thead>
                            <tbody>
                                {items.map(it => (
                                    <tr key={it.id} className="border-b">
                                        <td className="py-2">{it.id}</td>
                                        <td>{it.code}</td>
                                        <td>{it.label}</td>
                                        <td>{it.type}</td>
                                        <td>{it.value_off}</td>
                                        <td>{it.active ? 'DA' : 'NU'}</td>
                                        <td>{it.channels}</td>
                    <td className="text-xs text-gray-600">
                      r:{it._scope?.routes ?? 0} / s:{it._scope?.schedules ?? 0} / h:{it._scope?.hours ?? 0} / d:{it._scope?.weekdays ?? 0}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button onClick={()=>startEdit(it)} className="px-2 py-1 border rounded">Editează</button>
                        <button onClick={()=>toggleActive(it.id)} className="px-2 py-1 border rounded">
                          {it.active ? 'Dezactivează' : 'Activează'}
                        </button>
                        <button onClick={()=>removeCode(it.id)} className="px-2 py-1 border rounded text-red-600">Șterge</button>
                      </div>
                    </td>
                                   </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );

}

function HoursEditor({ value, onChange }) {
    const [start, setStart] = useState('08:00');
    const [end, setEnd] = useState('10:00');
    const add = () => {
        if (!start || !end) return;
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        const sOk = sh * 60 + sm, eOk = eh * 60 + em;
        if (eOk <= sOk) return;
        onChange([...(value || []), { start, end }]);
    };
    const remove = (idx) => {
        const next = [...(value || [])];
        next.splice(idx, 1);
        onChange(next);
    };
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <input type="time" className="border rounded px-2 h-10" value={start} onChange={e => setStart(e.target.value)} />
                <span>–</span>
                <input type="time" className="border rounded px-2 h-10" value={end} onChange={e => setEnd(e.target.value)} />
                <button type="button" onClick={add} className="h-10 px-3 rounded bg-gray-800 text-white">Adaugă</button>
            </div>
            {(value || []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {value.map((h, idx) => (
                        <span key={idx} className="px-2 py-1 border rounded inline-flex items-center gap-2">
                            {h.start}–{h.end}
                            <button type="button" onClick={() => remove(idx)} className="text-red-600">×</button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

