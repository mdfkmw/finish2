// src/MapProvider.jsx
import React, { useMemo } from "react";
import { useJsApiLoader } from "@react-google-maps/api";

const LIBRARIES = ["places", "geometry", "marker"];

function resolveGoogleMapsKey() {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isLocalHost = ["localhost", "127.0.0.1"].includes(host);
  const isLan = /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  const prefersLocal = isLocalHost || isLan || host.endsWith(".local");

  const localKey = import.meta.env.VITE_GMAPS_KEY_LOCAL || import.meta.env.VITE_GMAPS_KEY_DEV;
  const defaultKey = import.meta.env.VITE_GMAPS_KEY;

  return (prefersLocal && localKey) ? localKey : defaultKey;
}

export default function MapProvider({ children }) {
  const apiKey = useMemo(() => resolveGoogleMapsKey(), []);

  const { isLoaded, loadError } = useJsApiLoader({
    id: "gmaps-js",
    googleMapsApiKey: apiKey || "",
    libraries: LIBRARIES,
  });

  if (!apiKey) {
    console.error("Google Maps API key nu este configurată.");
    return (
      <div className="p-4 text-red-600">
        Google Maps nu poate fi încărcat: lipsește cheia API. Configurează <code>VITE_GMAPS_KEY</code>
        pentru producție și, opțional, <code>VITE_GMAPS_KEY_LOCAL</code> pentru mediul local.
      </div>
    );
  }

  if (loadError) {
    const msg = loadError?.message || "";
    const isRefererError = msg.includes("RefererNotAllowedMapError");
    console.error("Eroare la încărcarea Google Maps:", loadError);

    return (
      <div className="p-4 text-red-600">
        {isRefererError ? (
          <>
            Cheia Google Maps refuză referer-ul {" "}
            <strong>{typeof window !== "undefined" ? window.location.origin : ""}</strong>.{" "}
            Adaugă această origine în restricțiile cheii sau setează o cheie locală prin{" "}
            <code>VITE_GMAPS_KEY_LOCAL</code> / <code>VITE_GMAPS_KEY_DEV</code>.
          </>
        ) : (
          <>Eroare la încărcarea hărții.</>
        )}
      </div>
    );
  }

  if (!isLoaded) {
    return <div className="p-4 text-gray-500">Se încarcă harta...</div>;
  }

  return children;
}
