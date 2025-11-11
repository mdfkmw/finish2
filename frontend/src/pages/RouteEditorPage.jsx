/*************************************************************************
 * RouteEditorPage — toolbar mutat (top-right) + markere personalizate
 *************************************************************************/

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { GoogleMap, Polyline, Polygon, Circle } from "@react-google-maps/api";
import { Trash2, X, ChevronDown, ChevronRight } from "lucide-react";


/* ------------ CONFIG ------------ */
const MAP_ID    = import.meta.env.VITE_GMAPS_MAP_ID;
const RO_CENTER = { lat: 45.9432, lng: 24.9668 };
const MAP_STYLE = { height: "100vh", width: "100%" };


/* ---------- numeric helpers ---------- */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toLatLng = (lat, lng) => {
  const la = num(lat), ln = num(lng);
  return la != null && ln != null ? { lat: la, lng: ln } : null;
};



/* ---------- polygon helpers ---------- */
function toLatLngArray(input) {
  if (!input) return null;

  if (Array.isArray(input) && input.length) {
    if (typeof input[0] === "object" && "lat" in input[0] && "lng" in input[0]) return input;
    if (Array.isArray(input[0])) {
      const a = input;
      const useLngLat = Math.abs(a[0][0]) > 90 || Math.abs(a[0][1]) <= 90;
      return a.map(p => (useLngLat ? ({ lat: p[1], lng: p[0] }) : ({ lat: p[0], lng: p[1] })));
    }
  }

  if (typeof input === "string") {
    const s = input.trim();
    if (s.toUpperCase().startsWith("POLYGON")) {
      try {
        const inner = s.substring(s.indexOf("((") + 2, s.lastIndexOf("))"));
        const pairs = inner.split(",").map(x => x.trim().split(/\s+/).map(Number));
        return pairs.map(([lng, lat]) => ({ lat, lng }));
      } catch {}
    }
    try {
      const parsed = JSON.parse(s);
      return toLatLngArray(parsed);
    } catch { return null; }
  }

  if (typeof input === "object" && input.type === "Polygon" && Array.isArray(input.coordinates)) {
    const ring = input.coordinates[0] || [];
    return ring.map(([lng, lat]) => ({ lat, lng }));
  }

  return null;
}

/* ----------------- AdvancedMarker helpers ----------------- */
function pinEl(label, active = false, opts = {}) {
  const {
    color,
    activeColor,
    textColor,
    size,
    activeSize,
  } = opts;

  const baseColor = color ?? "#1e90ff";
  const highlightColor = activeColor ?? (color ? color : "#2563eb");
  const resolvedColor = active ? highlightColor : baseColor;
  const baseSize = size ?? "20px";
  const highlightSize = activeSize ?? (size ?? "26px");
  const resolvedSize = active ? highlightSize : baseSize;
  const resolvedTextColor = textColor ?? "white";

  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.style.transform = "translate(-50%, -50%)";

  const pin = document.createElement("div");
  pin.style.width = resolvedSize;
  pin.style.height = resolvedSize;
  pin.style.borderRadius = "9999px";
  pin.style.background = resolvedColor;
  pin.style.border = "2px solid white";
  pin.style.boxShadow = "0 2px 6px rgba(0,0,0,0.35)";
  pin.style.display = "flex";
  pin.style.alignItems = "center";
  pin.style.justifyContent = "center";
  pin.style.color = resolvedTextColor;
  pin.style.fontWeight = "700";
  pin.style.fontSize = active ? "12px" : "11px";
  pin.textContent = label ?? "";

  const tail = document.createElement("div");
  tail.style.position = "absolute";
  tail.style.left = "50%";
  tail.style.bottom = "-8px";
  tail.style.transform = "translateX(-50%)";
  tail.style.width = "0";
  tail.style.height = "0";
  tail.style.borderLeft = "6px solid transparent";
  tail.style.borderRight = "6px solid transparent";
  tail.style.borderTop = `8px solid ${resolvedColor}`;

  wrap.appendChild(pin);
  wrap.appendChild(tail);
  return wrap;
}

/** Generic wrapper around AdvancedMarkerElement */
function AdvancedMarker({ map, position, label, contentEl, onClick, draggable=false, onDragEnd }) {
  const markerRef = useRef(null);
  const listenersRef = useRef([]);

  useEffect(() => {
    if (!map || !window.google?.maps?.marker?.AdvancedMarkerElement) return;

    const content = contentEl ?? pinEl(label, false);

    if (!markerRef.current) {
      markerRef.current = new window.google.maps.marker.AdvancedMarkerElement({
        map,
        position,
        content,
        gmpDraggable: !!draggable,
      });
      if (onClick) listenersRef.current.push(markerRef.current.addListener("click", onClick));
      if (onDragEnd && draggable) {
        listenersRef.current.push(
          markerRef.current.addListener("dragend", (e) => {
            const { latLng } = e;
            if (!latLng) return;
            onDragEnd({ lat: latLng.lat(), lng: latLng.lng() });
          })
        );
      }
    } else {
      markerRef.current.position = position;
      markerRef.current.content = content;
      markerRef.current.gmpDraggable = !!draggable;
    }

    return () => {
      listenersRef.current.forEach((l) => window.google.maps.event.removeListener(l));
      listenersRef.current = [];
      if (markerRef.current) {
        markerRef.current.map = null;
        markerRef.current = null;
      }
    };
  }, [map, position?.lat, position?.lng, label, contentEl, onClick, draggable, onDragEnd]);

  return null;
}

/* Marker special pentru stații (active/inactive) */
function StationMarker({ map, position, index, active, onClick }) {
  const el = pinEl(String(index), !!active);
  return (
    <AdvancedMarker map={map} position={position} contentEl={el} onClick={onClick} />
  );
}

function PublicMarker({ map, position, type, active, draggable, onClick, onDragEnd }) {
  const isTur = type === "tur";
  const label = isTur ? "U" : "C";
  const baseColor = isTur ? "#f97316" : "#8b5cf6";
  const highlightColor = isTur ? "#ea580c" : "#7c3aed";
  const el = pinEl(label, !!active, {
    color: baseColor,
    activeColor: highlightColor,
    textColor: "white",
    size: "18px",
    activeSize: "24px",
  });
  return (
    <AdvancedMarker
      map={map}
      position={position}
      contentEl={el}
      onClick={onClick}
      draggable={!!draggable}
      onDragEnd={onDragEnd}
    />
  );
}

export default function RouteEditorPage() {
  /* ---------------------- routeId din URL ---------------------- */
  const params = useParams();
  const routeId = Number(params.routeId ?? params.id ?? params.route_id ?? 0) || Number(import.meta.env.VITE_DEFAULT_ROUTE_ID) || 1;

  /* ---------------------- state ---------------------- */
  const [stops, setStops]             = useState([]);
  const [selected, setSelected]       = useState(null); // index
  const [allStations, setAllStations] = useState([]);
  const [showAdd, setShowAdd]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [search, setSearch]           = useState("");
  const [expandedStops, setExpandedStops] = useState(() => new Set());

  const [mode, setMode] = useState("idle"); // "idle" | "drawCircle" | "drawPolygon" | "setPublicTur" | "setPublicRetur"
  const [previewPts, setPreviewPts] = useState([]);

  const mapRef = useRef(null);
  const circleRefs = useRef({}); // multiple circles
  const didFitOnce = useRef(false);

  useEffect(() => {
    setExpandedStops(() => new Set());
  }, [routeId]);

  /* ---------------------- fetch (depinde de routeId) ---------------------- */
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    // reset local state când se schimbă ruta
    setStops([]);
    setSelected(null);
    setMode("idle");
    setPreviewPts([]);
    didFitOnce.current = false;

    (async () => {
      try {
        const [stRes, stationsRes] = await Promise.all([
          axios.get(`/api/routes/${routeId}/stations`, { signal: controller.signal, headers: { "Cache-Control": "no-cache" } }),
          axios.get("/api/stations", { signal: controller.signal, headers: { "Cache-Control": "no-cache" } }),
        ]);
        if (cancelled) return;

 const routeStops = (stRes.data ?? []).sort((a,b)=>a.sequence-b.sequence);
 console.log('[API /routes/:id/stations]', routeStops.map(s => ({
   id: s.id, station_id: s.station_id, type: s.geofence_type,
   radius: s.geofence_radius_m, poly: s.geofence_polygon?.slice?.(0, 40) || s.geofence_polygon
 })));
        const normalized = routeStops.map((s) => {
          const poly = toLatLngArray(s.geofence_polygon);
          const type = s.geofence_type ?? (poly ? "polygon" : (s.geofence_radius_m ? "circle" : "none"));
          return {
            ...s,
            latitude: num(s.latitude),
            longitude: num(s.longitude),
            public_note_tur: typeof s.public_note_tur === "string" ? s.public_note_tur : "",
            public_note_retur: typeof s.public_note_retur === "string" ? s.public_note_retur : "",
            public_latitude_tur: num(s.public_latitude_tur),
            public_longitude_tur: num(s.public_longitude_tur),
            public_latitude_retur: num(s.public_latitude_retur),
            public_longitude_retur: num(s.public_longitude_retur),
            geofence_polygon: poly,
            geofence_radius_m: s.geofence_radius_m ?? null,
            geofence_type: type,
          };
        });
        setStops(normalized);
        const all = (stationsRes.data ?? []).map(st => ({
          ...st,
          latitude: num(st.latitude),
          longitude: num(st.longitude),
        }));
        setAllStations(all);
      } catch (err) {
        if (axios.isCancel?.(err) || err?.name === "CanceledError") return;
        console.error("Fetch route failed", err);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [routeId]);

  /* ---------------------- DnD reorder ---------------------- */
  const [dragIdx, setDragIdx] = useState(null);
  const onDragStart = (e, i) => { setDragIdx(i); e.dataTransfer.effectAllowed="move"; };
  const onDragOver = (e, i) => {
    e.preventDefault();
    if (dragIdx === i) return;
    const list = [...stops];
    const [m] = list.splice(dragIdx, 1);
    list.splice(i, 0, m);
    setDragIdx(i);
    setStops(list.map((s,k)=>({ ...s, sequence:k+1 })));
  };
  const onDrop = () => setDragIdx(null);

  /* ---------------------- helpers ---------------------- */
  const EPS = 1e-6;
  const updateStop = useCallback((idx, patch) => {
    setStops(prev => {
      const old = prev[idx];
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        const ov = old[k];
        if (typeof v === "number" && typeof ov === "number") {
          if (Math.abs(v - ov) > EPS) { changed = true; break; }
        } else if (JSON.stringify(ov) !== JSON.stringify(v)) { changed = true; break; }
      }
      if (!changed) return prev;
      const next = [...prev];
      next[idx] = { ...old, ...patch };
      return next;
    });
  }, []);

  const addStation = (st) => {
    if (stops.some((s) => s.station_id === st.id)) return;
    setStops(prev => [
      ...prev,
      {
        id: null,
        station_id: st.id,
        name: st.name,
        latitude: num(st.latitude),
        longitude: num(st.longitude),
        sequence: prev.length + 1,
        geofence_type: "circle",
        geofence_radius_m: 200,
        geofence_polygon: null,
        distance_km: 0,
        duration_min: 0,
        public_note_tur: "",
        public_note_retur: "",
        public_latitude_tur: null,
        public_longitude_tur: null,
        public_latitude_retur: null,
        public_longitude_retur: null,
      },
    ]);
    setShowAdd(false);
    setSearch("");
  };

  const deleteStation = async (routeStationId) => {
    if (!routeStationId) {
      setStops(prev =>
        prev.filter(s => s.id !== null).map((s,i)=>({ ...s, sequence:i+1 }))
      );
      return;
    }
    if (!confirm("Ștergi stația din traseu?")) return;
    await axios.delete(`/api/routes/route-stations/${routeStationId}`);
    setStops(prev =>
      prev.filter(s => s.id !== routeStationId).map((s,i)=>({ ...s, sequence:i+1 }))
    );
  };




 // serializează [{lat,lng},...] -> 'POLYGON((lng lat, ... , lng lat))'
 const toWktPolygon = (pts) => {
   if (!Array.isArray(pts) || pts.length < 3) return null;
   const ring = pts.map(p => [Number(p.lng), Number(p.lat)]);
   // închidem poligonul dacă nu e închis
   const [fLng, fLat] = ring[0];
   const [lLng, lLat] = ring[ring.length - 1];
   if (Math.abs(fLng - lLng) > 1e-9 || Math.abs(fLat - lLat) > 1e-9) {
     ring.push([fLng, fLat]);
   }
   const coords = ring.map(([lng, lat]) => `${lng} ${lat}`).join(", ");
   return `POLYGON((${coords}))`;
 };





  const saveRoute = async () => {
    setSaving(true);
    try {
      const toNullableText = (value) => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      };
      const toNullableNumber = (value) => {
        if (value === "" || value === null || value === undefined) return null;
        const numVal = Number(value);
        return Number.isFinite(numVal) ? numVal : null;
      };
      const payload = stops.map((s, i) => {
        const type = s.geofence_type === "polygon" ? "polygon" : "circle";
        const wkt  = type === "polygon" ? toWktPolygon(s.geofence_polygon) : null;
        const rad  = type === "circle"  ? (Number(s.geofence_radius_m) || 0) : null;
        return {
          id: s.id ?? null,
          route_id: Number(routeId),
          station_id: Number(s.station_id),
          sequence: i + 1,
          distance_km: toNullableNumber(s.distance_km),
          duration_min: toNullableNumber(s.duration_min),
          dwell_time_minutes: Number(s.dwell_time_minutes || 0),
          geofence_type: type,
          geofence_radius_m: rad,
          geofence_polygon: wkt, // <- WKT POLYGON sau null
          public_note_tur: toNullableText(s.public_note_tur),
          public_note_retur: toNullableText(s.public_note_retur),
          public_latitude_tur: toNullableNumber(s.public_latitude_tur),
          public_longitude_tur: toNullableNumber(s.public_longitude_tur),
          public_latitude_retur: toNullableNumber(s.public_latitude_retur),
          public_longitude_retur: toNullableNumber(s.public_longitude_retur),
        };
      });

      // validare minimă: dacă e polygon, trebuie >=3 puncte (altfel wkt=null)
      const bad = payload.find(p => p.geofence_type === "polygon" && !p.geofence_polygon);
      if (bad) {
        alert("Poligonul trebuie să aibă minim 3 puncte.");
        setSaving(false);
        return;
      }

      await axios.put(`/api/routes/${routeId}/stations`, payload);
    } catch (err) {
      console.error("[SaveRoute] payload=", err?.config?.data || "(no data)");
      console.error("[SaveRoute] 500 response=", err?.response?.data);
      alert("Eroare la salvat stațiile.\n" + (err?.response?.data?.error || err?.message || "Server 500"));
    } finally {
      setSaving(false);
    }
  };




  /* ---------------------- Map events ---------------------- */
  const handleMapLoad = (map) => {
    mapRef.current = map;
    if (stops.length && !didFitOnce.current) {
      const b = new window.google.maps.LatLngBounds();
      stops.forEach(s => {
        const p = toLatLng(s.latitude, s.longitude);
        if (p) b.extend(new window.google.maps.LatLng(p.lat, p.lng));
      });
      map.fitBounds(b);
      didFitOnce.current = true;
    }
  };

  useEffect(() => {
    if (mapRef.current && stops.length && !didFitOnce.current) {
      const b = new window.google.maps.LatLngBounds();
      stops.forEach(s => {
        const p = toLatLng(s.latitude, s.longitude);
        if (p) b.extend(new window.google.maps.LatLng(p.lat, p.lng));
      });
      mapRef.current.fitBounds(b);
      didFitOnce.current = true;
    }
  }, [stops]);

  useEffect(() => {
    if (typeof selected === "number" && mapRef.current) {
      const s = stops[selected];
      if (s) {
        const p = toLatLng(s.latitude, s.longitude);
        if (p) mapRef.current.panTo(p);
      }
    }
  }, [selected, stops]);

  useEffect(() => {
    if (typeof selected !== "number") {
      setMode("idle");
      setPreviewPts([]);
    }
  }, [selected]);

  const onMapClick = useCallback((e) => {
    if (typeof selected !== "number") return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    if (mode === "setPublicTur") {
      updateStop(selected, {
        public_latitude_tur: lat,
        public_longitude_tur: lng,
      });
      setMode("idle");
      return;
    }
    if (mode === "setPublicRetur") {
      updateStop(selected, {
        public_latitude_retur: lat,
        public_longitude_retur: lng,
      });
      setMode("idle");
      return;
    }
    if (mode === "drawCircle") {
      const s = stops[selected];
      const r = Number.isFinite(+s.geofence_radius_m) ? +s.geofence_radius_m : 200;
      updateStop(selected, {
        geofence_type: "circle",
        geofence_radius_m: r,
        geofence_polygon: null,
        latitude: lat,
        longitude: lng,
      });
      setMode("idle");
    } else if (mode === "drawPolygon") {
      setPreviewPts(prev => [...prev, { lat, lng }]);
    }
  }, [mode, selected, stops, updateStop]);

  const finalizePolygon = () => {
    if (typeof selected !== "number") return;
    if (previewPts.length < 3) { alert("Poligonul are nevoie de minim 3 puncte."); return; }
    updateStop(selected, {
      geofence_type: "polygon",
      geofence_polygon: previewPts,
      geofence_radius_m: null,
    });
    setPreviewPts([]);
    setMode("idle");
  };
  const cancelDrawing = () => { setPreviewPts([]); setMode("idle"); };

  const startPublicPinMode = useCallback((nextMode) => {
    setPreviewPts([]);
    setMode(prev => (prev === nextMode ? "idle" : nextMode));
  }, []);

  const toggleStopExpansion = useCallback((key) => {
    setExpandedStops(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  /* ---------------------- derive: stations list for Add ---------------------- */
  const usedIds = new Set(stops.map(s => s.station_id));
  const filteredStations = (allStations || [])
    .filter(st => !usedIds.has(st.id))
    .filter(st => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (st.name?.toLowerCase().includes(q)
           || String(st.id).includes(q)
           || (st.city?.toLowerCase() || "").includes(q));
    })
    .slice(0, 200);

  // close Add panel on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setShowAdd(false); };
    if (showAdd) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAdd]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setMode("idle");
        setPreviewPts([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mapsReady = !!window.google?.maps;

  const modeHint = (() => {
    switch (mode) {
      case "drawCircle":
        return "Click pe hartă pentru a repoziționa cercul stației.";
      case "drawPolygon":
        return "Adaugă puncte pe hartă pentru poligon, apoi finalizează.";
      case "setPublicTur":
        return "Click pe hartă pentru a seta pinul public de urcare.";
      case "setPublicRetur":
        return "Click pe hartă pentru a seta pinul public de coborâre.";
      default:
        return null;
    }
  })();

  /* ==================== RENDER ==================== */
  return (
    <div className="flex">
      {/* ########## SIDEBAR ########## */}
      <aside className="w-80 border-r p-4 overflow-y-auto">
        <div className="flex items-baseline justify-between mb-2">
          <h1 className="font-semibold text-lg">Stații traseu</h1>
          <span className="text-xs text-gray-500">ruta #{routeId}</span>
        </div>

        {stops.map((s, idx) => {
          const stopKey = s.id ?? `tmp-${idx}`;
          const isExpanded = expandedStops.has(stopKey);
          return (
            <div
              key={`${s.station_id}-${idx}`}
              draggable
              onDragStart={(e)=>{ setDragIdx(idx); e.dataTransfer.effectAllowed="move"; }}
              onDragOver={(e)=>onDragOver(e,idx)}
              onDrop={onDrop}
              onClick={()=>setSelected(idx)}
              className={`border rounded p-3 mb-3 cursor-pointer select-none ${idx === selected ? "bg-blue-50 border-blue-400" : ""}`}
            >
              <div className={`flex justify-between items-center ${isExpanded ? "mb-2" : ""}`}>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="p-1 rounded hover:bg-blue-100"
                    onClick={(e)=>{
                      e.stopPropagation();
                      setSelected(idx);
                      toggleStopExpansion(stopKey);
                    }}
                    aria-label={isExpanded ? "Restrânge detalii stație" : "Extinde detalii stație"}
                  >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <span className="font-medium">{idx + 1}. {s.name}</span>
                </div>
                <button className="p-1 hover:text-red-600" onClick={(e)=>{ e.stopPropagation(); deleteStation(s.id); }}>
                  <Trash2 size={16} />
                </button>
              </div>

              {isExpanded && (
                <>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <label className="flex flex-col">
                      <span className="text-gray-500">Distanță km</span>
                      <input
                        type="number"
                        className="border rounded px-2 py-0.5"
                        value={s.distance_km ?? ""}
                        onChange={(e)=>{
                          const val = e.target.value;
                          if (val === "") {
                            updateStop(idx, { distance_km: null });
                            return;
                          }
                          const parsed = Number(val);
                          updateStop(idx, { distance_km: Number.isFinite(parsed) ? parsed : s.distance_km });
                        }}
                        disabled={idx === stops.length - 1}
                      />
                    </label>
                    <label className="flex flex-col">
                      <span className="text-gray-500">Timp min</span>
                      <input
                        type="number"
                        className="border rounded px-2 py-0.5"
                        value={s.duration_min ?? ""}
                        onChange={(e)=>{
                          const val = e.target.value;
                          if (val === "") {
                            updateStop(idx, { duration_min: null });
                            return;
                          }
                          const parsed = Number(val);
                          updateStop(idx, { duration_min: Number.isFinite(parsed) ? parsed : s.duration_min });
                        }}
                        disabled={idx === stops.length - 1}
                      />
                    </label>
                    <label className="flex flex-col">
                      <span className="text-gray-500">Rază m</span>
                      <input
                        type="number"
                        className="border rounded px-2 py-0.5"
                        value={s.geofence_radius_m ?? ""}
                        onChange={(e)=>updateStop(idx,{
                          geofence_radius_m: Number.isFinite(+e.target.value) ? +e.target.value : 0,
                          geofence_type: "circle",
                          geofence_polygon: null,
                        })}
                      />
                    </label>
                  </div>

                  <div className="mt-3 space-y-3 text-xs">
                    <div>
                      <div className="font-semibold text-gray-600">Public (tur)</div>
                      <div className="grid grid-cols-3 gap-2 mt-1">
                        <label className="flex flex-col col-span-3">
                          <span className="text-gray-500">Detaliu afișat pasagerilor</span>
                          <input
                            type="text"
                            className="border rounded px-2 py-0.5"
                            value={s.public_note_tur ?? ""}
                            onChange={(e)=>updateStop(idx,{ public_note_tur: e.target.value })}
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-gray-500">Lat tur</span>
                          <input
                            type="number"
                            step="0.000001"
                            className="border rounded px-2 py-0.5"
                            value={s.public_latitude_tur ?? ""}
                            onChange={(e)=>{
                              const val = e.target.value;
                              if (val === "") { updateStop(idx,{ public_latitude_tur: null }); return; }
                              const parsed = Number(val);
                              updateStop(idx,{ public_latitude_tur: Number.isFinite(parsed) ? parsed : s.public_latitude_tur });
                            }}
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-gray-500">Lng tur</span>
                          <input
                            type="number"
                            step="0.000001"
                            className="border rounded px-2 py-0.5"
                            value={s.public_longitude_tur ?? ""}
                            onChange={(e)=>{
                              const val = e.target.value;
                              if (val === "") { updateStop(idx,{ public_longitude_tur: null }); return; }
                              const parsed = Number(val);
                              updateStop(idx,{ public_longitude_tur: Number.isFinite(parsed) ? parsed : s.public_longitude_tur });
                            }}
                          />
                        </label>
                        <div className="col-span-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={`text-xs px-2 py-1 rounded border ${mode === "setPublicTur" && selected === idx ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-blue-50"}`}
                            onClick={(e)=>{
                              e.stopPropagation();
                              setSelected(idx);
                              startPublicPinMode("setPublicTur");
                            }}
                          >
                            {mode === "setPublicTur" && selected === idx ? "Click pe hartă…" : "Alege pe hartă"}
                          </button>
                          {Number.isFinite(s.public_latitude_tur) && Number.isFinite(s.public_longitude_tur) && (
                            <button
                              type="button"
                              className="text-xs px-2 py-1 rounded border bg-white hover:bg-red-50 text-red-600 border-red-200"
                              onClick={(e)=>{
                                e.stopPropagation();
                                setMode("idle");
                                updateStop(idx, { public_latitude_tur: null, public_longitude_tur: null });
                              }}
                            >
                              Șterge pin
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="font-semibold text-gray-600">Public (retur)</div>
                      <div className="grid grid-cols-3 gap-2 mt-1">
                        <label className="flex flex-col col-span-3">
                          <span className="text-gray-500">Detaliu afișat pasagerilor</span>
                          <input
                            type="text"
                            className="border rounded px-2 py-0.5"
                            value={s.public_note_retur ?? ""}
                            onChange={(e)=>updateStop(idx,{ public_note_retur: e.target.value })}
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-gray-500">Lat retur</span>
                          <input
                            type="number"
                            step="0.000001"
                            className="border rounded px-2 py-0.5"
                            value={s.public_latitude_retur ?? ""}
                            onChange={(e)=>{
                              const val = e.target.value;
                              if (val === "") { updateStop(idx,{ public_latitude_retur: null }); return; }
                              const parsed = Number(val);
                              updateStop(idx,{ public_latitude_retur: Number.isFinite(parsed) ? parsed : s.public_latitude_retur });
                            }}
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-gray-500">Lng retur</span>
                          <input
                            type="number"
                            step="0.000001"
                            className="border rounded px-2 py-0.5"
                            value={s.public_longitude_retur ?? ""}
                            onChange={(e)=>{
                              const val = e.target.value;
                              if (val === "") { updateStop(idx,{ public_longitude_retur: null }); return; }
                              const parsed = Number(val);
                              updateStop(idx,{ public_longitude_retur: Number.isFinite(parsed) ? parsed : s.public_longitude_retur });
                            }}
                          />
                        </label>
                        <div className="col-span-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={`text-xs px-2 py-1 rounded border ${mode === "setPublicRetur" && selected === idx ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-blue-50"}`}
                            onClick={(e)=>{
                              e.stopPropagation();
                              setSelected(idx);
                              startPublicPinMode("setPublicRetur");
                            }}
                          >
                            {mode === "setPublicRetur" && selected === idx ? "Click pe hartă…" : "Alege pe hartă"}
                          </button>
                          {Number.isFinite(s.public_latitude_retur) && Number.isFinite(s.public_longitude_retur) && (
                            <button
                              type="button"
                              className="text-xs px-2 py-1 rounded border bg-white hover:bg-red-50 text-red-600 border-red-200"
                              onClick={(e)=>{
                                e.stopPropagation();
                                setMode("idle");
                                updateStop(idx, { public_latitude_retur: null, public_longitude_retur: null });
                              }}
                            >
                              Șterge pin
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs italic mt-1">
                    {s.geofence_type !== "none" ? `geofence: ${s.geofence_type}` : "fără geofence"}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <button onClick={()=>setShowAdd(true)} className="w-full bg-blue-600 text-white py-2 rounded mb-3">
          + Adaugă stație
        </button>
        <button onClick={saveRoute} disabled={saving} className="w-full bg-green-600 text-white py-2 rounded disabled:opacity-50">
          {saving ? "Se salvează…" : "Salvează traseul"}
        </button>
      </aside>

      {/* ########## MAP ########## */}
      <main className="flex-1 relative">
        {modeHint && (
          <div className="absolute top-4 left-1/2 z-20 -translate-x-1/2 bg-white/95 text-gray-800 px-3 py-1.5 rounded shadow pointer-events-none text-sm">
            {modeHint}
          </div>
        )}
        {/* Toolbar mutat în dreapta sus, cu offset mai mare */}
        <div className="absolute left-4 bottom-40 z-10 bg-white/90 backdrop-blur px-3 py-2 rounded shadow border flex gap-2 items-center pointer-events-auto">
          <span className="text-sm font-medium">Geofence</span>
          <button className={`text-sm px-2 py-1 rounded border ${mode==="drawCircle"?"bg-blue-600 text-white":"bg-white"}`}
                  onClick={()=>setMode(mode==="drawCircle"?"idle":"drawCircle")}
                  disabled={typeof selected !== "number"}
                  title="Plasează cerc (click pe hartă)">
            Cerc
          </button>
          <button className={`text-sm px-2 py-1 rounded border ${mode==="drawPolygon"?"bg-blue-600 text-white":"bg-white"}`}
                  onClick={()=>{ setMode(mode==="drawPolygon"?"idle":"drawPolygon"); setPreviewPts([]); }}
                  disabled={typeof selected !== "number"}
                  title="Desenează poligon (click-uri succesive)">
            Poligon
          </button>
          {mode==="drawPolygon" && (
            <>
              <button className="text-sm px-2 py-1 rounded border" onClick={finalizePolygon}>Finalizează</button>
              <button className="text-sm px-2 py-1 rounded border" onClick={cancelDrawing}>Anulează</button>
            </>
          )}
        </div>

        {/* Add Station Panel */}
        {showAdd && (
          <div className="absolute right-4 top-4 z-20 w-96 max-h-[80vh] overflow-hidden rounded-xl shadow-lg border bg-white">
            <div className="flex items-center justify-between p-3 border-b">
              <div className="font-medium">Adaugă stație</div>
              <button className="p-1" onClick={()=>setShowAdd(false)} aria-label="Închide">
                <X size={16} />
              </button>
            </div>
            <div className="p-3">
              <input
                autoFocus
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="Caută după nume, id, oraș..."
                value={search}
                onChange={(e)=>setSearch(e.target.value)}
              />
            </div>
            <div className="px-3 pb-3 text-xs text-gray-500">Rezultate: {filteredStations.length}</div>
            <div className="overflow-auto max-h-[60vh] px-3 pb-3">
              {filteredStations.map(st => (
                <button
                  key={st.id}
                  onClick={()=>addStation(st)}
                  className="w-full text-left border rounded p-2 mb-2 hover:bg-blue-50"
                  title={`Lat: ${st.latitude}, Lng: ${st.longitude}`}
                >
                  <div className="font-medium text-sm">{st.name}</div>
                  <div className="text-xs text-gray-500">#{st.id}{st.city ? ` • ${st.city}` : ""}</div>
                </button>
              ))}
              {filteredStations.length === 0 && (
                <div className="text-sm text-gray-500">Nu s-au găsit stații disponibile.</div>
              )}
            </div>
          </div>
        )}

        {/* Guard: API ready */}
        {!mapsReady ? (
          <div className="p-4 text-gray-500">Se încarcă harta...</div>
        ) : (
          <GoogleMap
            key={`map-${routeId}`}
            mapContainerStyle={MAP_STYLE}
            defaultCenter={RO_CENTER}
            zoom={6}
            options={{ mapId: MAP_ID, gestureHandling: "greedy", scrollwheel: true }}
            onLoad={(map)=>{
              handleMapLoad(map);
              setTimeout(() => {
                if (showAdd) {
                  const el = document.querySelector('input[placeholder="Caută după nume, id, oraș..."]');
                  el && el.focus();
                }
              }, 0);
            }}
            onClick={onMapClick}
          >
            {/* traseu */}
            {stops.length > 1 && (
              <Polyline
                path={stops.map(s => toLatLng(s.latitude, s.longitude)).filter(Boolean)}
                options={{ strokeWeight: 3 }}
              />
            )}

            {/* markere stații cu stil personalizat */}
            {mapRef.current && stops.map((s, idx) => {
              const pos = toLatLng(s.latitude, s.longitude);
              if (!pos) return null;
              return (
                <StationMarker
                  key={`m-${s.station_id}-${idx}`}
                  map={mapRef.current}
                  position={pos}
                  index={idx+1}
                  active={idx === selected}
                  onClick={()=>setSelected(idx)}
                />
              );
            })}

            {/* pin public urcare/coborâre */}
            {mapRef.current && stops.map((s, idx) => {
              const pos = toLatLng(s.public_latitude_tur, s.public_longitude_tur);
              if (!pos) return null;
              const isSelected = idx === selected;
              return (
                <PublicMarker
                  key={`tur-${s.station_id}-${idx}`}
                  map={mapRef.current}
                  position={pos}
                  type="tur"
                  active={isSelected && mode === "setPublicTur"}
                  draggable={isSelected}
                  onClick={()=>setSelected(idx)}
                  onDragEnd={(coords)=>{
                    updateStop(idx, { public_latitude_tur: coords.lat, public_longitude_tur: coords.lng });
                  }}
                />
              );
            })}
            {mapRef.current && stops.map((s, idx) => {
              const pos = toLatLng(s.public_latitude_retur, s.public_longitude_retur);
              if (!pos) return null;
              const isSelected = idx === selected;
              return (
                <PublicMarker
                  key={`retur-${s.station_id}-${idx}`}
                  map={mapRef.current}
                  position={pos}
                  type="retur"
                  active={isSelected && mode === "setPublicRetur"}
                  draggable={isSelected}
                  onClick={()=>setSelected(idx)}
                  onDragEnd={(coords)=>{
                    updateStop(idx, { public_latitude_retur: coords.lat, public_longitude_retur: coords.lng });
                  }}
                />
              );
            })}

            {/* geofence pentru TOATE stațiile */}
            {stops.map((s, idx) => {
              const isSel = idx === selected;
              const commonCircleOpts = {
                editable: isSel,
                draggable: isSel,
                strokeWeight: isSel ? 2 : 1,
                strokeOpacity: isSel ? 0.9 : 0.6,
                fillOpacity: isSel ? 0.15 : 0.08,
              };
              const commonPolyOpts = {
                editable: isSel,
                draggable: isSel,
                strokeWeight: isSel ? 2 : 1,
                strokeOpacity: isSel ? 0.9 : 0.6,
                fillOpacity: isSel ? 0.15 : 0.08,
              };

             if (s.geofence_type === "circle" && Number.isFinite(+s.geofence_radius_m) && +s.geofence_radius_m > 0) {
                const center = toLatLng(s.latitude, s.longitude);
                if (!center) return null;
                return (
                  <Circle
                    key={`c-${idx}`}
                    center={center}
                    radius={+s.geofence_radius_m}
                    options={commonCircleOpts}
                    onLoad={(c)=>{ if(isSel) circleRefs.current[idx] = c; }}
                    onUnmount={()=>{ delete circleRefs.current[idx]; }}
                    onCenterChanged={() => {
                      if (!isSel) return;
                      const c = circleRefs.current[idx]; if (!c) return;
                      const ctr = c.getCenter(); if (!ctr) return;
                      updateStop(idx, { latitude: ctr.lat(), longitude: ctr.lng() });
                    }}
                    onRadiusChanged={() => {
                      if (!isSel) return;
                      const c = circleRefs.current[idx]; if (!c) return;
                      const r = c.getRadius();
                      updateStop(idx, { geofence_radius_m: r, geofence_type: "circle", geofence_polygon: null });
                    }}
                  />
                );
              }
              if (s.geofence_type === "polygon" && s.geofence_polygon?.length) {
                return (
                  <Polygon
                    key={`p-${idx}`}
                    paths={s.geofence_polygon}
                    options={commonPolyOpts}
                    onMouseUp={(poly)=>{
                      if (!isSel) return;
                      const path = poly.getPath().getArray().map((p)=>({ lat:p.lat(), lng:p.lng() }));
                      updateStop(idx, { geofence_polygon: path, geofence_type: "polygon", geofence_radius_m: null });
                    }}
                  />
                );
              }
              return null;
            })}

            {/* preview în modul desenare poligon */}
            {mode==="drawPolygon" && previewPts.length > 0 && (
              <Polyline path={previewPts} options={{ strokeWeight: 2 }} />
            )}
          </GoogleMap>
        )}
      </main>
    </div>
  );
}
