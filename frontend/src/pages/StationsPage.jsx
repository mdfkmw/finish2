// src/pages/StationsPage.jsx
// Versiune fără Marker (deprecated) și fără useJsApiLoader în modal (evită conflictul de loader).
// Folosește AdvancedMarkerElement, mapId, gestureHandling: 'greedy'.
// IMPORTANT: Încarcă Google Maps JS O SINGURĂ DATĂ în aplicație (ex. într-un MapProvider la root)
// sau asigură-te că ORICE alt apel useJsApiLoader folosește exact aceleași opțiuni (id + libraries).

import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { GoogleMap } from "@react-google-maps/api";

// --- CONFIG ---
const GMAPS_KEY = import.meta.env.VITE_GMAPS_KEY;
const MAP_ID    = import.meta.env.VITE_GMAPS_MAP_ID;
const RO_CENTER = { lat: 45.9432, lng: 24.9668 };

// === AdvancedMarker wrapper (în loc de Marker deprecated) ===
function makeMarkerContent(label) {
  const el = document.createElement("div");
  el.style.transform = "translate(-50%,-50%)";
  el.style.padding = "4px 8px";
  el.style.borderRadius = "9999px";
  el.style.background = "white";
  el.style.boxShadow = "0 1px 4px rgba(0,0,0,.3)";
  el.style.fontSize = "12px";
  el.style.fontWeight = "600";
  el.textContent = label ?? "";
  return el;
}

function AdvancedMarker({ map, position, label, draggable = false, onClick, onDragEnd }) {
  const ref = useRef(null);
  const subClick = useRef(null);
  const subDrag  = useRef(null);

  useEffect(() => {
    if (!map || !window.google?.maps?.marker?.AdvancedMarkerElement) return;

    if (!ref.current) {
      ref.current = new window.google.maps.marker.AdvancedMarkerElement({
        map,
        position,
        content: makeMarkerContent(label),
        gmpDraggable: !!draggable,
      });
      if (onClick)  subClick.current = ref.current.addListener("click", onClick);
      if (onDragEnd && draggable) subDrag.current = ref.current.addListener("dragend", (e) => {
        const { latLng } = e;
        if (!latLng) return;
        onDragEnd({ lat: latLng.lat(), lng: latLng.lng() });
      });
    } else {
      ref.current.position = position;
      ref.current.content  = makeMarkerContent(label);
      ref.current.gmpDraggable = !!draggable;
    }

    return () => {
      if (subClick.current) { window.google.maps.event.removeListener(subClick.current); subClick.current = null; }
      if (subDrag.current)  { window.google.maps.event.removeListener(subDrag.current);  subDrag.current  = null; }
      if (ref.current) { ref.current.map = null; ref.current = null; }
    };
  }, [map, position?.lat, position?.lng, label, draggable, onClick, onDragEnd]);

  return null;
}

// ===================== PAGE =====================
export default function StationsPage() {
  const [stations, setStations] = useState([]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(null);   // obiect stație | null
  const [loading, setLoading] = useState(false);
  const [countyFilter, setCountyFilter] = useState("");
  const [sortState, setSortState] = useState({ field: null, direction: "asc" });

  useEffect(() => {
    (async () => {
      const { data } = await axios.get("/api/stations", { headers: { "Cache-Control": "no-cache" } });
      setStations(data ?? []);
    })();
  }, []);

  const saveStation = async (st) => {
    setLoading(true);
    try {
      if (st.id) {
        await axios.put(`/api/stations/${st.id}`, st);
        setStations((prev) => prev.map((s) => (s.id === st.id ? st : s)));
      } else {
        const { data } = await axios.post("/api/stations", st);
        setStations((prev) => [...prev, data]);
      }
      setEditing(null);
    } finally {
      setLoading(false);
    }
  };

  const counties = Array.from(
    new Set((stations ?? []).map((s) => s?.county).filter(Boolean))
  ).sort((a, b) => String(a).localeCompare(String(b), "ro", { sensitivity: "base" }));

  const handleSort = (field) => {
    if (!field) return;
    setSortState((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "asc" };
    });
  };

  const searchTerm = filter.trim().toLowerCase();
  const sortableFields = new Set(["name", "locality", "county"]);
  const filteredStations = (stations ?? [])
    .filter((s) => (s?.name || "").toLowerCase().includes(searchTerm))
    .filter((s) => {
      if (!countyFilter) return true;
      return (s?.county || "") === countyFilter;
    });

  const displayedStations = (() => {
    const { field, direction } = sortState;
    if (!field || !sortableFields.has(field)) return filteredStations;
    const factor = direction === "desc" ? -1 : 1;
    return [...filteredStations].sort((a, b) => {
      const valA = String(a?.[field] ?? "");
      const valB = String(b?.[field] ?? "");
      return valA.localeCompare(valB, "ro", { sensitivity: "base" }) * factor;
    });
  })();

  const renderSortHeader = (field, label) => {
    const isActive = sortState.field === field;
    const indicator = isActive ? (sortState.direction === "asc" ? "↑" : "↓") : "↕";
    return (
      <th className="p-2 border text-left">
        <button
          type="button"
          onClick={() => handleSort(field)}
          className="flex items-center gap-1 text-left font-medium"
        >
          <span>{label}</span>
          <span className={`text-xs ${isActive ? "text-gray-700" : "text-gray-400"}`}>{indicator}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Stații</h1>
      <div className="flex flex-wrap gap-4 mb-4">
        <label className="flex flex-col text-sm text-gray-700">
          <span className="mb-1">Caută după nume</span>
          <input
            placeholder="Ex: București Nord"
            className="border rounded px-3 py-1"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-sm text-gray-700 min-w-[200px]">
          <span className="mb-1">Filtrează după județ</span>
          <select
            className="border rounded px-3 py-1"
            value={countyFilter}
            onChange={(e) => setCountyFilter(e.target.value)}
          >
            <option value="">Toate județele</option>
            {counties.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <table className="w-full border text-sm">
        <thead className="bg-gray-100">
          <tr>
            {renderSortHeader("name", "Nume")}
            {renderSortHeader("locality", "Localitate")}
            {renderSortHeader("county", "Județ")}
            <th className="p-2 border">Lat</th>
            <th className="p-2 border">Lon</th>
            <th className="p-2 border">Acțiuni</th>
          </tr>
        </thead>
        <tbody>
          {displayedStations.map((s) => (
              <tr key={s.id} className="text-center">
                <td className="border p-2">{s.name}</td>
                <td className="border p-2">{s.locality}</td>
                <td className="border p-2">{s.county}</td>
                <td className="border p-2">{s.latitude}</td>
                <td className="border p-2">{s.longitude}</td>
                <td className="border p-2 space-x-2">
                  <button
                    onClick={() => setEditing({ ...s })}
                    className="bg-blue-600 text-white px-2 py-1 rounded"
                  >
                    Editează
                  </button>
                  <button
                    onClick={async () => {
                      await axios.delete(`/api/stations/${s.id}`);
                      setStations((prev) => prev.filter((x) => x.id !== s.id));
                    }}
                    className="bg-red-600 text-white px-2 py-1 rounded"
                  >
                    Șterge
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <button
        onClick={() =>
          setEditing({
            id: null,
            name: "",
            locality: "",
            county: "",
            latitude: null,
            longitude: null,
          })
        }
        className="mt-4 bg-blue-600 text-white px-4 py-2 rounded"
      >
        + Adaugă stație
      </button>

      {editing && (
        <EditStationModal
          data={editing}
          onClose={() => setEditing(null)}
          onSave={saveStation}
          saving={loading}
        />
      )}
    </div>
  );
}

// ===================== MODAL =====================
function EditStationModal({ data, onClose, onSave, saving }) {
  const [form, setForm] = useState({
    id: data.id ?? null,
    name: data.name ?? "",
    locality: data.locality ?? "",
    county: data.county ?? "",
    latitude: data.latitude ?? "",
    longitude: data.longitude ?? "",
  });

  const [map, setMap] = useState(null);
  const [markerPos, setMarkerPos] = useState(
    Number.isFinite(+data.latitude) && Number.isFinite(+data.longitude)
      ? { lat: +data.latitude, lng: +data.longitude }
      : null
  );

  // NU mai apelăm useJsApiLoader aici – evităm conflictul cu alte componente.
  // Presupunem că script-ul Google Maps e deja încărcat la root (MapProvider) SAU
  // că o altă pagină l-a încărcat anterior cu aceleași opțiuni.
  const mapsReady = !!window.google?.maps;

  const onMapClick = (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    setMarkerPos({ lat, lng });
    setForm((f) => ({ ...f, latitude: lat, longitude: lng }));
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg mt-10">
        <h2 className="text-lg font-medium px-6 py-4 border-b">
          {form.id ? "Editează stația" : "Adaugă stație"}
        </h2>

        <div className="p-6 space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
          />
          <Input
            label="Locality"
            value={form.locality}
            onChange={(v) => setForm((f) => ({ ...f, locality: v }))}
          />
          <Input
            label="County"
            value={form.county}
            onChange={(v) => setForm((f) => ({ ...f, county: v }))}
          />

          <Input label="Latitude" value={form.latitude} onChange={(v)=>setForm(f=>({...f, latitude: v}))} />
          <Input label="Longitude" value={form.longitude} onChange={(v)=>setForm(f=>({...f, longitude: v}))} />

          {mapsReady ? (
            <GoogleMap
              onLoad={(m)=>setMap(m)}
              onClick={onMapClick}
              center={markerPos ?? RO_CENTER}
              zoom={markerPos ? 12 : 6}
              options={{ mapId: MAP_ID, gestureHandling: "greedy", scrollwheel: true }}
              mapContainerStyle={{ width: "100%", height: 300 }}
            >
              {map && markerPos && (
                <AdvancedMarker
                  map={map}
                  position={markerPos}
                  label="S"
                  draggable
                  onDragEnd={({ lat, lng }) => {
                    setMarkerPos({ lat, lng });
                    setForm((f) => ({ ...f, latitude: lat, longitude: lng }));
                  }}
                />
              )}
            </GoogleMap>
          ) : (
            <div className="text-sm text-gray-500 border rounded p-3">
              Harta nu e încă disponibilă. Asigură-te că Google Maps JS e încărcat la nivelul aplicației (MapProvider).
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-300">
            Anulează
          </button>
          <button
            disabled={saving}
            onClick={() => onSave({
              ...form,
              latitude: form.latitude === "" ? null : Number(form.latitude),
              longitude: form.longitude === "" ? null : Number(form.longitude),
            })}
            className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50"
          >
            {saving ? "Se salvează…" : "Salvează"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===================== INPUT =====================
function Input({ label, value, onChange, readOnly = false }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-600">{label}</span>
      <input
        className="w-full border rounded px-3 py-1 mt-1 disabled:bg-gray-100"
        value={value ?? ""}              // <- nu mai trecem null către input
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  );
}
