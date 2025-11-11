import React, { useEffect, useState } from 'react';

export default function AdminDisabledSchedules() {
  // ---------------------------
  //  State
  // ---------------------------
  const [rules, setRules]         = useState([]);   // schedule_exceptions + meta
  const [routes, setRoutes]       = useState([]);   // toate route_schedules
  const [selectionType, setType]  = useState('permanent'); // permanent | weekly | specific
  const [blockFlags, setBlockFlags] = useState({ offline: true, online: true });
  const [newRule, setNewRule]     = useState({ date:'', weekday:'', routeId:'', schedule_id:'' });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [sortKey, setSort]        = useState('route');

  const weekdayLabel = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];

  const formatDirectionHour = (direction, hour) => {
    const dir = (direction || '').trim();
    return dir ? `${dir.toUpperCase()} ${hour}` : hour;
  };

  // ---------------------------
  //  Helpers
  // ---------------------------
  /**
   * Curăţă câmpurile dinamice ale formularului (dată / zi / traseu / oră), dar
   * nu resetează tipul selecţiei – astfel radio‑urile rămân pe ce alege userul.
   */
  const clearFormFields = () => {
    setNewRule({ date:'', weekday:'', routeId:'', schedule_id:'' });
    setBlockFlags({ offline: true, online: true });
  };

  // ---------------------------
  //  Fetch
  // ---------------------------
  const fetchData = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0,10);
      const [resRules, resRoutes] = await Promise.all([
        fetch('/api/trips/admin/disabled-schedules'),
        fetch(`/api/routes?date=${today}`)
      ]);
      if (!resRules.ok || !resRoutes.ok) throw new Error('Network error');

      const rulesJson   = await resRules.json();
      const routesJson  = await resRoutes.json();
      setRules(rulesJson);

      // Flatten schedules pentru selecte
      const flat = [];
      routesJson.forEach(r => {
        r.schedules.forEach(sch => {
          flat.push({
            routeId:    r.id,
            scheduleId: sch.scheduleId ?? sch.id,
            routeName:  r.name,
            departure:  sch.departure,
            direction:  sch.direction || '',
            key:        `${r.id}-${sch.scheduleId ?? sch.id}`
          });
        });
      });
      setRoutes(flat);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // ---------------------------
  //  Derived lists
  // ---------------------------
  const available = routes.filter(item => {
    return !rules.some(rule => {
      if (rule.schedule_id !== item.scheduleId) return false;
      if (rule.rule_type === 'permanent') return true;
      if (selectionType === 'weekly') {
        if (rule.rule_type === 'weekday' && rule.weekday.toString() === newRule.weekday) return true;
        if (rule.rule_type === 'date'    && newRule.weekday && (new Date(rule.exception_date).getDay().toString() === newRule.weekday)) return true;
      }
      if (selectionType === 'specific') {
        if (rule.rule_type === 'date'    && rule.exception_date === newRule.date) return true;
        if (rule.rule_type === 'weekday' && newRule.date && (new Date(newRule.date).getDay() === rule.weekday)) return true;
      }
      return false;
    });
  });

  const sortedRules = [...rules].sort((a,b) => {
    if (sortKey === 'route')  return a.route_name.localeCompare(b.route_name);
    if (sortKey === '-route') return b.route_name.localeCompare(a.route_name);
    if (sortKey === 'hour')   return formatDirectionHour(a.direction, a.hour).localeCompare(formatDirectionHour(b.direction, b.hour));
    if (sortKey === '-hour')  return formatDirectionHour(b.direction, b.hour).localeCompare(formatDirectionHour(a.direction, a.hour));
    return 0;
  });

  // ---------------------------
  //  Actions
  // ---------------------------
  const handleAdd = async e => {
    e.preventDefault();
    const payload = { schedule_id: Number(newRule.schedule_id) };
    if (selectionType === 'weekly')   payload.weekday        = Number(newRule.weekday);
    if (selectionType === 'specific') payload.exception_date = newRule.date;

    if (!blockFlags.offline && !blockFlags.online) {
      window.alert('Selectează cel puțin o opțiune de anulare (offline sau online).');
      return;
    }

    payload.disable_run    = Boolean(blockFlags.offline);
    payload.disable_online = Boolean(blockFlags.online);

    const res = await fetch('/api/trips/exceptions/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });

    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      window.alert(data.error || 'Există rezervări active în viitor pentru această cursă. Mută pasagerii înainte de a o dezactiva.');
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      window.alert(data.error || 'Eroare la salvarea regulii. Încearcă din nou.');
      return;
    }

    clearFormFields();      // reset doar câmpuri
    setType('permanent');   // după salvare revine la permanent by‑default
    fetchData();
  };

  const toggleFlag = async (item, flag) => {
    const payload = {
      schedule_id:    item.schedule_id,
      exception_date: item.rule_type === 'date'    ? item.exception_date : null,
      weekday:        item.rule_type === 'weekday' ? item.weekday        : null,
      disable_run:    flag === 'disable_run'    ? !item.disable_run    : item.disable_run,
      disable_online: flag === 'disable_online' ? !item.disable_online : item.disable_online
    };
    const res = await fetch('/api/trips/exceptions/update', {
      method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });

    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      window.alert(data.error || 'Există rezervări active în viitor pentru această cursă. Mută pasagerii înainte de a o dezactiva.');
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      window.alert(data.error || 'Eroare la actualizarea regulii. Încearcă din nou.');
      return;
    }

    fetchData();
  };

  const deleteRule = async item => {
    if (!window.confirm('Sigur ştergi regula?')) return;
    await fetch(`/api/trips/admin/disabled-schedules/${item.id}`, { method: 'DELETE' });
    fetchData();
  };

  // ---------------------------
  //  Render
  // ---------------------------
  if (loading) return <div>Loading…</div>;
  if (error)   return <div className="text-red-600">{error.message}</div>;

  return (
    <div className="p-4 space-y-6">
      {/* ----------------- FORM ----------------- */}
      <form onSubmit={handleAdd} className="p-4 bg-white rounded shadow space-y-4">
        <div>
          <span className="font-medium mr-4">Cum vrei să anulezi?</span>
          {['permanent','weekly','specific'].map(t => (
            <label key={t} className="inline-flex items-center mr-4 capitalize">
              <input
                type="radio"
                className="accent-blue-600"
                checked={selectionType === t}
                onChange={() => { setType(t); clearFormFields(); }}
              />
              <span className="ml-1">{t}</span>
            </label>
          ))}
        </div>

        {selectionType === 'weekly' && (
          <select
            required
            value={newRule.weekday}
            onChange={e => setNewRule(prev => ({ ...prev, weekday: e.target.value }))}
            className="border p-2 rounded"
          >
            <option value="">Zi săptămână</option>
            {weekdayLabel.map((d,i)=>(<option key={i} value={i}>{d}</option>))}
          </select>
        )}

        {selectionType === 'specific' && (
          <input
            type="date"
            required
            value={newRule.date}
            onChange={e => setNewRule(prev => ({ ...prev, date: e.target.value }))}
            className="border p-2 rounded"
          />
        )}

        <div className="flex flex-wrap gap-4 items-end">
          <select
            required
            value={newRule.routeId}
            onChange={e => setNewRule(prev => ({ ...prev, routeId:e.target.value, schedule_id:'' }))}
            className="border p-2 rounded"
          >
            <option value="">Alege traseu</option>
            {[...new Set(available.map(a => a.routeId))].map(id => {
              const name = available.find(a => a.routeId === id)?.routeName;
              return <option key={id} value={id}>{name}</option>;
            })}
          </select>

          <select
            required
            value={newRule.schedule_id}
            onChange={e => setNewRule(prev => ({ ...prev, schedule_id: e.target.value }))}
            className="border p-2 rounded"
          >
            <option value="">Alege oră</option>
            {available.filter(a => a.routeId === Number(newRule.routeId)).map(a => (
              <option key={a.scheduleId} value={a.scheduleId}>{formatDirectionHour(a.direction, a.departure)}</option>
            ))}
          </select>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Opţiuni anulare</span>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-blue-600"
                  checked={blockFlags.offline}
                  onChange={e => setBlockFlags(prev => ({ ...prev, offline: e.target.checked }))}
                />
                <span>Anulat offline</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-blue-600"
                  checked={blockFlags.online}
                  onChange={e => setBlockFlags(prev => ({ ...prev, online: e.target.checked }))}
                />
                <span>Anulat online</span>
              </label>
            </div>
          </div>

          <button type="submit" className="bg-green-600 text-white px-3 py-2 rounded">Adaugă</button>
        </div>
      </form>

      {/* ----------------- TABLE ----------------- */}
      <div className="overflow-x-auto">
        <table className="table-auto w-full text-sm divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 cursor-pointer" onClick={() => setSort(sortKey==='route' ? '-route' : 'route')}>Rută {sortKey==='route'?'▲':sortKey==='-route'?'▼':''}</th>
              <th className="px-4 py-2 cursor-pointer" onClick={() => setSort(sortKey==='hour' ? '-hour' : 'hour')}>Oră {sortKey==='hour'?'▲':sortKey==='-hour'?'▼':''}</th>
              <th className="px-4 py-2">Tip</th>
              <th className="px-4 py-2">Dată/Zi</th>
              <th className="px-4 py-2 text-center">Anulat offline</th>
              <th className="px-4 py-2 text-center">Anulat online</th>
              <th className="px-4 py-2 text-center">Acţiuni</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedRules.map(item => (
              <tr key={item.id} className={item.disable_run ? 'bg-red-50' : ''}>
                <td className="px-4 py-2 whitespace-nowrap">{item.route_name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatDirectionHour(item.direction, item.hour)}</td>
                <td className="px-4 py-2 capitalize">{item.rule_type}</td>
                <td className="px-4 py-2">
                  {item.rule_type === 'date'    && item.exception_date}
                  {item.rule_type === 'weekday' && weekdayLabel[item.weekday]}
                  {item.rule_type === 'permanent' && 'Permanent'}
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-red-600"
                    checked={item.disable_run}
                    onChange={() => toggleFlag(item,'disable_run')}
                    aria-label="Anulat offline"
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-amber-500"
                    checked={item.disable_online}
                    onChange={() => toggleFlag(item,'disable_online')}
                    aria-label="Anulat online"
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => deleteRule(item)} className="text-red-600 hover:underline">Şterge</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
