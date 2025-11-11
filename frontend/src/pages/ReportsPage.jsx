import { useCallback, useEffect, useMemo, useState } from 'react';
import OperatorSelect from '../components/OperatorSelect';
import DateRangePicker from '../components/DateRangePicker';
import AgencySelect from '../components/Reports/AgencySelect';
import AgentSelect from '../components/Reports/AgentSelect';
import TripsTable from '../components/Reports/TripsTable';

export default function ReportsPage({ user }) {
  const today = new Date().toISOString().slice(0, 10);

  const [operatorId, setOperatorId] = useState(null);
  const [routeOptions, setRouteOptions] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [agencyId, setAgencyId] = useState(null);
  const [agentId, setAgentId] = useState(null);
  const [range, setRange] = useState({ start: today, end: today });
  const [hourOptions, setHourOptions] = useState([]);   // orele rutei selectate
  const [selectedHour, setSelectedHour] = useState(null); // "HH:MM" sau null


  const [data, setData] = useState({ trips: [], summary: {}, toHandOver: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);





  const employeeId = user?.id ?? null;

  // State pentru „predă banii”
  const [unsettled, setUnsettled] = useState([]);       // grupuri pe operator
  const [handoverHistory, setHandoverHistory] = useState([]);
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [selectedOperatorIds, setSelectedOperatorIds] = useState([]);
  const [selectionSummary, setSelectionSummary] = useState({
    rows: 0,
    payments: 0,
    total: 0,
  });

  const fetchUnsettled = useCallback(async () => {
    if (!employeeId) {
      setUnsettled([]);
      return;
    }
    try {
      const res = await fetch(`/api/cash/unsettled?employeeId=${employeeId}`);
      const json = await res.json();
      setUnsettled(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error(err);
      setUnsettled([]);
    }
  }, [employeeId]);

  const fetchHandoverHistory = useCallback(async () => {
    if (!employeeId) {
      setHandoverHistory([]);
      return;
    }
    try {
      const res = await fetch(`/api/cash/handovers/history?employeeId=${employeeId}`);
      const json = await res.json();
      setHandoverHistory(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error(err);
      setHandoverHistory([]);
    }
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) {
      setUnsettled([]);
      setHandoverHistory([]);
      return;
    }
    fetchUnsettled();
    fetchHandoverHistory();
  }, [employeeId, fetchHandoverHistory, fetchUnsettled]);

  const unsettledTotal = useMemo(
    () => unsettled.reduce((s, r) => s + Number(r.total_amount || 0), 0),
    [unsettled]
  );


  useEffect(() => {
    setSelectedOperatorIds((prev) =>
      prev.filter((id) => unsettled.some((row) => String(row.operator_id) === String(id)))
    );
  }, [unsettled]);

  useEffect(() => {
    const selectedRows = unsettled.filter((row) =>
      selectedOperatorIds.some((id) => String(id) === String(row.operator_id))
    );
    const payments = selectedRows.reduce(
      (sum, row) => sum + Number(row.payments_count || 0),
      0
    );
    const total = selectedRows.reduce(
      (sum, row) => sum + Number(row.total_amount || 0),
      0
    );
    setSelectionSummary({
      rows: selectedRows.length,
      payments,
      total,
    });
  }, [selectedOperatorIds, unsettled]);

  const toggleOperatorSelection = (operatorId) => {
    setSelectedOperatorIds((prev) => {
      const idStr = String(operatorId);
      const exists = prev.some((id) => String(id) === idStr);
      if (exists) {
        return prev.filter((id) => String(id) !== idStr);
      }
      return [...prev, operatorId];
    });
  };

  const toggleAllOperators = () => {
    if (!unsettled.length) {
      setSelectedOperatorIds([]);
      return;
    }
    const allSelected =
      selectedOperatorIds.length && selectedOperatorIds.length === unsettled.length;
    if (allSelected) {
      setSelectedOperatorIds([]);
    } else {
      setSelectedOperatorIds(unsettled.map((row) => row.operator_id));
    }
  };

  const selectedOperatorIdsNormalized = useMemo(
    () => selectedOperatorIds.map((id) => Number(id)).filter((id) => !Number.isNaN(id)),
    [selectedOperatorIds]
  );


  const handlePredaBanii = async () => {
    if (!unsettled.length) {
      alert('Nu ai nimic de predat.');
      return;
    }
    if (!employeeId) {
      alert('Nu ești autentificat ca agent.');
      return;
    }
    const selectedCount = selectionSummary.rows;
    const confirmationMessage = selectedCount
      ? `Predai încasările CASH pentru ${selectedCount} operator(i), total ${selectionSummary.total.toFixed(2)} lei?`
      : 'Nu ai selectat niciun operator. Predai toate încasările CASH nepredate (grupate pe operator)?';

    if (!window.confirm(confirmationMessage)) return;

    setHandoverBusy(true);
    try {
      const res = await fetch('/api/cash/handovers/preda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, operatorIds: selectedOperatorIdsNormalized }),
      });
      const data = await res.json();
      if (data?.ok) {
        // reîncarcă listele
        await fetchUnsettled();
        await fetchHandoverHistory();
        const total = (data.handovers || []).reduce((s, h) => s + Number(h.amount || 0), 0);
        const messagePrefix = selectedCount
          ? 'Predare parțială reușită'
          : 'Predare reușită';
        alert(`${messagePrefix}: ${data.handovers?.length || 0} lot(uri), total ${total.toFixed(2)} lei.`);
        setSelectedOperatorIds([]);
      } else {
        alert('A apărut o eroare la predare. Verifică selecția și încearcă din nou.');
      }
    } catch (e) {
      console.error(e);
      alert('Eroare la predare. Verifică conexiunea și încearcă din nou.');
    } finally {
      setHandoverBusy(false);
    }
  };


  // Populează dropdown-ul de rute apelând endpoint-ul dedicat
useEffect(() => {
  if (!operatorId || isNaN(Number(operatorId))) {
    setRouteOptions([]);
    return;
  }

  fetch(`/api/routes?operator_id=${Number(operatorId)}&date=${range.start}`)
    .then(r => r.json())
    .then(json => {
      // endpointul poate întoarce fie {routes:[...]} fie direct [...]
      const arr = Array.isArray(json?.routes) ? json.routes
                : Array.isArray(json)         ? json
                : [];
      const mapped = arr.map(rt => {
        const hours = Array.isArray(rt.schedules)
          ? rt.schedules
              .map(s => ({
                departure: s?.departure,
                direction: s?.direction || '',
              }))
              .filter(s => s.departure)
          : [];
        return { id: rt.id, name: rt.name, hours };
      });
      setRouteOptions(mapped);
    })
   .catch(console.error);
}, [operatorId, range.start]);


  // Când se schimbă ruta sau lista de rute, calculează orele disponibile.
  // Dacă nu e selectată o rută => folosim uniunea tuturor orelor.
  useEffect(() => {
    let hours = [];
    if (selectedRoute) {
      const route = routeOptions.find(r => String(r.id) === String(selectedRoute));
      hours = Array.isArray(route?.hours) ? route.hours : [];
    } else {
      const all = [];
      for (const r of routeOptions) {
        (r.hours || []).forEach(h => all.push(h));
      }
      hours = all;
    }
    // ordonăm după direcție și oră
    const sorted = hours
      .sort((a, b) => {
        if (a.direction === b.direction) return a.departure.localeCompare(b.departure);
        return a.direction.localeCompare(b.direction);
      });
    setHourOptions(sorted);
    if (selectedHour && !sorted.some(h => h.departure === selectedHour)) {
      setSelectedHour(null);
    }
  }, [selectedRoute, routeOptions]);


  // Apoi fetch-ul principal pentru tabel rămâne separat:
  useEffect(() => {
    if (!operatorId) return;
    setLoading(true);

    const params = {
      operator_id: operatorId,
      start: range.start,
      end: range.end,
    };
    if (selectedRoute) params.route_id = selectedRoute;
    if (agencyId) params.agency_id = agencyId;
    if (agentId) params.agent_id = agentId;
    if (selectedHour) params.hour = selectedHour;
    fetch(`/api/reports/trips?${new URLSearchParams(params)}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        setData(json);
        setError(null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [operatorId, range, selectedRoute, agencyId, agentId, selectedHour]);

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 items-end">
        <OperatorSelect value={operatorId} onChange={setOperatorId} />
        <select
          value={selectedRoute ?? ''}
          onChange={e => setSelectedRoute(e.target.value || null)}
          className="border rounded px-2 py-1"
        >
          <option value="">Toate rutele</option>
          {routeOptions.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select
          value={selectedHour ?? ''}
          onChange={e => setSelectedHour(e.target.value || null)}
          className="border rounded px-2 py-1"
          disabled={!hourOptions.length}
        >
          <option value="">{hourOptions.length ? 'Toate orele' : 'Fără ore'}</option>
{hourOptions.map((h, idx) => (
  <option
    key={`${h.direction || 'tur'}-${h.departure}-${h.route_name || ''}-${idx}`}
    value={h.departure}
  >
    {`${h.direction?.toUpperCase() || 'TUR'} ${h.departure}${
      h.route_name ? ' – ' + h.route_name : ''
    }`}
  </option>
))}

        </select>
        <AgencySelect value={agencyId} onChange={id => { setAgencyId(id); setAgentId(null); }} />
        <AgentSelect value={agentId} onChange={setAgentId} agencyId={agencyId} />
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {error && <div className="text-red-600">{error}</div>}
      {loading && <div className="animate-pulse text-gray-400">Se încarcă…</div>}

      {!loading && !error && (
        <>
          <TripsTable rows={data.trips} />

          {/* ====== CASH: Bani de predat & Istoric predări ====== */}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Bani de predat */}
            <div className="border rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">
                  Bani de predat {employeeId ? `(agent #${employeeId})` : ''}
                </h3>
                <button
                  onClick={handlePredaBanii}
                  disabled={!unsettled.length || handoverBusy}
                  className={`px-3 py-2 rounded-lg text-white ${(!unsettled.length || handoverBusy) ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {handoverBusy ? 'Se predă…' : 'Predă banii'}
                </button>
              </div>

              {unsettled.length === 0 ? (
                <div className="text-sm text-gray-500">
                  {employeeId
                    ? 'Nu există plăți CASH nepredate.'
                    : 'Autentifică-te pentru a vedea plățile CASH nepredate.'}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 w-10">
                        <input
                          type="checkbox"
                          checked={
                            unsettled.length > 0 &&
                            selectedOperatorIds.length === unsettled.length
                          }
                          onChange={toggleAllOperators}
                          aria-label="Selectează toți operatorii"
                        />
                      </th>
                      <th className="py-2">Operator</th>
                      <th className="py-2"># Plăți</th>
                      <th className="py-2">Sumă</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unsettled.map((row) => (
                      <tr key={row.operator_id} className="border-b last:border-0">
                        <td className="py-2">
                          <input
                            type="checkbox"
                            checked={selectedOperatorIds.some(
                              (id) => String(id) === String(row.operator_id)
                            )}
                            onChange={() => toggleOperatorSelection(row.operator_id)}
                            aria-label={`Selectează ${row.operator_name}`}
                          />
                        </td>
                        <td className="py-2">{row.operator_name}</td>
                        <td className="py-2">{row.payments_count}</td>
                        <td className="py-2">{Number(row.total_amount || 0).toFixed(2)} lei</td>
                      </tr>
                    ))}
                    {selectionSummary.rows > 0 && (
                      <tr className="font-semibold text-blue-700">
                        <td className="py-2"></td>
                        <td className="py-2">Selectat</td>
                        <td className="py-2">{selectionSummary.payments}</td>
                        <td className="py-2">{selectionSummary.total.toFixed(2)} lei</td>
                      </tr>
                    )}
                    <tr className="font-semibold">
                      <td className="py-2"></td>
                      <td className="py-2">TOTAL</td>
                      <td className="py-2">
                        {unsettled.reduce((s, r) => s + Number(r.payments_count || 0), 0)}
                      </td>
                      <td className="py-2">{unsettledTotal.toFixed(2)} lei</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* Istoric predări */}
            <div className="border rounded-xl p-4 shadow-sm">
              <h3 className="text-lg font-semibold mb-3">Istoric predări</h3>
              {handoverHistory.length === 0 ? (
                <div className="text-sm text-gray-500">Încă nu există predări.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2">Data</th>
                      <th className="py-2">Operator</th>
                      <th className="py-2"># Plăți</th>
                      <th className="py-2">Sumă</th>
                    </tr>
                  </thead>
                  <tbody>
                    {handoverHistory.map((h) => (
                      <tr key={h.id} className="border-b last:border-0">
                        <td className="py-2">{new Date(h.created_at).toLocaleString()}</td>
                        <td className="py-2">{h.operator_name}</td>
                        <td className="py-2">{h.payments_count}</td>
                        <td className="py-2">{Number(h.amount || 0).toFixed(2)} lei</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>


          <div className="mt-4 flex items-center justify-between">
            <div className="font-semibold">Achitate</div>
          </div>


          {/* SUMAR – ACHITATE (zebra) */}
          <table className="w-full mt-4 text-sm border">
            <tbody className="[&>tr:nth-child(odd)]:bg-gray-50">
              <tr>
                <td className="px-2 py-1 whitespace-nowrap">Bilete achitate (nr.)</td>
                <td className="px-2 py-1 text-right">{data.summary?.paid_seats ?? 0}</td>
              </tr>
              <tr>
                <td className="px-2 py-1 whitespace-nowrap">Încasări nete (lei)</td>
                <td className="px-2 py-1 text-right">{Number(data.summary?.paid_total ?? 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td className="px-2 py-1 whitespace-nowrap">Reduceri aplicate (lei)</td>
                <td className="px-2 py-1 text-right">{Number(data.summary?.paid_discounts ?? 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td className="px-2 py-1 whitespace-nowrap font-semibold">Bani de predat (cash)</td>
                <td className="px-2 py-1 text-right font-semibold">{unsettledTotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          {/* SUMAR – DOAR REZERVĂRI (zebra) */}
          <table className="w-full mt-4 text-sm border">
            <tbody className="[&>tr:nth-child(odd)]:bg-gray-50">
              <tr>
                <td className="px-2 py-1 whitespace-nowrap">Rezervări neplătite (nr.)</td>
                <td className="px-2 py-1 text-right">{data.summary?.reserved_seats ?? 0}</td>
              </tr>
              <tr>
                <td className="px-2 py-1 whitespace-nowrap">Valoare rezervări (lei)</td>
                <td className="px-2 py-1 text-right">{Number(data.summary?.reserved_total ?? 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td className="px-2 py-1 whitespace-nowrap">Reduceri rezervări (lei)</td>
                <td className="px-2 py-1 text-right">{Number(data.summary?.reserved_discounts ?? 0).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          {/* (Opțional) Reduceri pe tip – apare doar dacă backend a trimis discountsByType */}
          {Array.isArray(data.discountsByType) && data.discountsByType.length > 0 && (
            <div className="mt-4">
              <div className="font-semibold mb-1">Reducerile pe tip</div>
              <table className="w-full text-sm border">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="border px-2 py-1 text-left">Tip reducere</th>
                    <th className="border px-2 py-1 text-right">Nr. achitate</th>
                    <th className="border px-2 py-1 text-right">Lei achitate</th>
                    <th className="border px-2 py-1 text-right">Nr. rezervări</th>
                    <th className="border px-2 py-1 text-right">Lei rezervări</th>
                  </tr>
                </thead>
                <tbody className="[&>tr:nth-child(odd)]:bg-gray-50">
                  {data.discountsByType.map(d => (
                    <tr key={d.discount_type_id}>
                      <td className="border px-2 py-1">{d.discount_label}</td>
                      <td className="border px-2 py-1 text-right">{d.paid_count}</td>
                      <td className="border px-2 py-1 text-right">{Number(d.paid_total).toFixed(2)}</td>
                      <td className="border px-2 py-1 text-right">{d.reserved_count}</td>
                      <td className="border px-2 py-1 text-right">{Number(d.reserved_total).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="border px-2 py-1">TOTAL</td>
                    <td className="border px-2 py-1 text-right">
                      {data.discountsByType.reduce((s, d) => s + Number(d.paid_count || 0), 0)}
                    </td>
                    <td className="border px-2 py-1 text-right">
                      {data.discountsByType.reduce((s, d) => s + Number(d.paid_total || 0), 0).toFixed(2)}
                    </td>
                    <td className="border px-2 py-1 text-right">
                      {data.discountsByType.reduce((s, d) => s + Number(d.reserved_count || 0), 0)}
                    </td>
                    <td className="border px-2 py-1 text-right">
                      {data.discountsByType.reduce((s, d) => s + Number(d.reserved_total || 0), 0).toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}


        </>
      )}







    </div>
  );
}
