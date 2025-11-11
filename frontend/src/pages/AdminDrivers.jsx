import React, { useEffect, useState } from "react";

// Pagina de planificare şoferi.  Singura noutate: foloseşte exclusiv câmpul
// `disabled` venit din backend pentru a marca vizual cursele anulate.
export default function AdminDrivers() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [operatorId, setOperatorId] = useState(null);
  const [operators, setOperators] = useState([]);
  const [slots, setSlots] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [routesOrderTur, setRoutesOrderTur] = useState([]);
  const [routesOrderRetur, setRoutesOrderRetur] = useState([]);

  /*────────────────────────── Operatorii disponibili */
  useEffect(() => {
    fetch("/api/operators")
      .then((r) => r.json())
      .then((ops) => {
        setOperators(ops);
        if (ops.length && !operatorId) setOperatorId(ops[0].id);
      });
  }, []);

  /*────────────────────────── Sloturi + ordinea rutelor */
  useEffect(() => {
    if (!operatorId) return;

    const params = `date=${date}&operator_id=${operatorId}`;
    fetch(`/api/trip_assignments?${params}`)
      .then((r) => r.json())
      .then(setSlots);

    fetch(`/api/employees?operator_id=${operatorId}&role=driver`)
      .then((r) => r.json())
      .then((list) => {
        const safe = Array.isArray(list) ? list : [];
        const onlyDrivers = safe.filter((emp) => (emp.role || '').toLowerCase() === 'driver');
        setEmployees(onlyDrivers);
      })
      .catch(() => setEmployees([]));

    fetch(`/api/routes_order?operator_id=${operatorId}`)
      .then((r) => r.json())
      .then((o) => {
        setRoutesOrderTur(o.tur);
        setRoutesOrderRetur(o.retur);
      });
  }, [date, operatorId]);

  /*────────────────────────── Autogenerare trips (lazy) */
  useEffect(() => {
    fetch("/api/trips/autogenerate", { method: "POST" });
  }, []);

  /*────────────────────────── Helper: butoane operator */
  const OperatorButtons = () => (
    <div className="flex flex-wrap gap-2 mb-3">
      {operators.map((op) => (
        <button
          key={op.id}
          onClick={() => setOperatorId(op.id)}
          className={`px-3 py-2 rounded transition-colors ${
            operatorId === op.id
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
          {op.name}
        </button>
      ))}
    </div>
  );

  /*────────────────────────── Helper: rând slot (Tur/Retur) */
  const SlotRow = ({ slot }) => {
    // Backend trimite acum exact `disabled`
    const isDisabled = slot.disabled;
    const clsDisabled = isDisabled
      ? "line-through text-gray-400 opacity-60 cursor-not-allowed"
      : "";

    const handleAssign = (e) => {
      if (isDisabled) return; // securitate suplimentară în UI
      const newDriver = e.target.value || null;

      fetch("/api/trip_assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_vehicle_id: slot.trip_vehicle_id,
          employee_id: newDriver,
        }),
      })
        .then((r) => {
          if (!r.ok) return r.text().then((t) => Promise.reject(t || r.statusText));
        })
        .then(() =>
          fetch(`/api/trip_assignments?date=${date}&operator_id=${operatorId}`)
            .then((r) => r.json())
            .then(setSlots)
        )
        .catch((err) => {
          console.error("Eroare la salvare șofer:", err);
          alert("Nu s-a putut salva șoferul: " + err);
        });
    };

    return (
      <div
        key={slot.trip_vehicle_id}
        className={`flex items-center gap-2 pl-4 py-1 ${clsDisabled}`}
        title={isDisabled ? "Cursa anulată" : undefined}
      >
        <span className="w-16">{slot.trip_time?.slice(0, 5)}</span>
        <span className="w-40">
          {slot.vehicle_name} ({slot.plate_number})
        </span>
        <select
          disabled={isDisabled}
          value={slot.employee_id || ""}
          onChange={handleAssign}
          className={`border px-2 py-1 rounded ${isDisabled ? "bg-gray-100" : ""}`}
        >
          <option value="">— Alege șofer —</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
        {!slot.is_primary && (
          <span className="text-xs bg-blue-100 rounded px-1 ml-2">Dublură</span>
        )}
      </div>
    );
  };

  /*────────────────────────── Grupare rute Tur / Retur */
  const turGrouped = routesOrderTur.map((route) => ({
    routeName: route,
    slots: slots.filter((s) => s.route_name === route && s.direction === "tur"),
  }));
  const returGrouped = routesOrderRetur.map((route) => ({
    routeName: route,
    slots: slots.filter((s) => s.route_name === route && s.direction === "retur"),
  }));

  /*────────────────────────── UI */
  return (
    <div className="p-4 space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <label className="font-medium flex items-center gap-2">
          Data:
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border px-2 py-1 rounded"
          />
        </label>
        <OperatorButtons />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* TUR */}
        <div>
          <div className="font-bold text-lg mb-2">Tur</div>
          {turGrouped.map((g) => (
            <div key={g.routeName} className="mb-4">
              <div className="font-semibold bg-gray-100 px-2 py-1 rounded">
                {g.routeName}
              </div>
              {g.slots.length === 0 && (
                <div className="text-xs text-gray-400 italic pl-2">Fără curse</div>
              )}
              {g.slots.map((slot) => (
                <SlotRow key={slot.trip_vehicle_id} slot={slot} />
              ))}
            </div>
          ))}
        </div>

        {/* RETUR */}
        <div>
          <div className="font-bold text-lg mb-2">Retur</div>
          {returGrouped.map((g) => (
            <div key={g.routeName} className="mb-4">
              <div className="font-semibold bg-gray-100 px-2 py-1 rounded">
                {g.routeName}
              </div>
              {g.slots.length === 0 && (
                <div className="text-xs text-gray-400 italic pl-2">Fără curse</div>
              )}
              {g.slots.map((slot) => (
                <SlotRow key={slot.trip_vehicle_id} slot={slot} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
