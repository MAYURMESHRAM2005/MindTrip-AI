import React, { useEffect, useRef } from 'react';

/**
 * MapView — interactive map built on the Google Maps JavaScript API.
 *
 * Props (kept compatible with the previous react-leaflet component):
 *   center: [lat, lng]
 *   markers: [{ name, type, address, rating, coordinates: {lat,lng}, color, emphasis, googleMapsUri }]
 *   route:  [[lat,lng], ...] (already decoded polyline points)
 *   directions: optional backend directions payload (routes[].polyline encoded)
 *
 * The browser key (VITE_GOOGLE_MAPS_BROWSER_KEY) is HTTP-referrer restricted
 * to the Maps JavaScript API only. When it is missing the map shows a clear
 * "unavailable" panel — the rest of the app (geocoding/routing/places) keeps
 * working through the backend.
 *
 * The script is loaded once per session (module-level promise) so maps never
 * double-load, and all objects are cleaned up on unmount.
 */

function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let result = 0, shift = 0, b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

let googleMapsPromise = null;

function loadGoogleMaps() {
  if (googleMapsPromise) return googleMapsPromise;
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
  if (!key) {
    googleMapsPromise = Promise.reject(new Error('NO_BROWSER_KEY'));
    return googleMapsPromise;
  }
  googleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = `__gmapInit${Date.now()}`;
    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google.maps);
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callbackName}&loading=async&v=weekly`;
    script.async = true;
    script.onerror = () => {
      delete window[callbackName];
      reject(new Error('GOOGLE_MAPS_LOAD_FAILED'));
    };
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

const FALLBACK_CENTER = { lat: 20.5937, lng: 78.9629 };

export default function MapView({ center, markers = [], route = [], directions }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRefs = useRef([]);
  const polylineRefs = useRef([]);
  const [state, setState] = React.useState({ status: 'loading' }); // loading | ready | error

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (!cancelled) setState({ status: 'ready' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Create the map once the API is ready.
  useEffect(() => {
    if (state.status !== 'ready' || !containerRef.current || mapRef.current) return;
    const maps = window.google.maps;
    const map = new maps.Map(containerRef.current, {
      center: center ? { lat: Number(center[0]), lng: Number(center[1]) } : FALLBACK_CENTER,
      zoom: 12,
      mapId: undefined,
      disableDefaultUI: false,
      fullscreenControl: true,
      clickableIcons: true,
    });
    mapRef.current = map;
    return () => {
      mapRef.current = null;
    };
  }, [state.status, center]);

  // Fit bounds / fly when center or route changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || state.status !== 'ready') return;
    const maps = window.google.maps;
    if (route && route.length >= 2) {
      const bounds = new maps.LatLngBounds();
      route.forEach((p) => bounds.extend({ lat: Number(p[0] ?? p.lat), lng: Number(p[1] ?? p.lng) }));
      map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
    } else if (center) {
      map.setCenter({ lat: Number(center[0]), lng: Number(center[1]) });
      map.setZoom(12);
    }
  }, [state.status, center, route]);

  // Draw route polylines (already-decoded points or backend directions).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || state.status !== 'ready') return;
    polylineRefs.current.forEach((p) => p.setMap(null));
    polylineRefs.current = [];

    let lines = [];
    if (Array.isArray(route) && route.length >= 2) lines = [route];
    else if (directions?.isLive && Array.isArray(directions.directions?.routes)) {
      lines = directions.directions.routes
        .map((r) => (r.polyline ? decodePolyline(r.polyline) : null))
        .filter((l) => l && l.length >= 2);
    }

    lines.forEach((line, i) => {
      const path = line.map((p) => ({ lat: Number(p[0] ?? p.lat), lng: Number(p[1] ?? p.lng) }));
      const poly = new window.google.maps.Polyline({
        map,
        path,
        strokeColor: i === 0 ? '#257aeb' : '#94a3b8',
        strokeWeight: i === 0 ? 6 : 3,
        strokeOpacity: 0.9,
        ...(i === 0 ? {} : { strokeDashArray: '8 8' }),
      });
      polylineRefs.current.push(poly);
    });
    return () => {
      polylineRefs.current.forEach((p) => p.setMap(null));
      polylineRefs.current = [];
    };
  }, [state.status, route, directions]);

  // Draw markers + info windows.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || state.status !== 'ready') return;
    markerRefs.current.forEach((m) => m.setMap(null));
    markerRefs.current = [];

    const infos = [];
    let openInfo = null;

    markers.forEach((m) => {
      const lat = Number(m.coordinates?.lat ?? m.lat);
      const lng = Number(m.coordinates?.lng ?? m.lng);
      if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return;

      const pin = new window.google.maps.Marker({
        map,
        position: { lat, lng },
        title: m.name || '',
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: m.emphasis ? 6 : 4,
          fillColor: m.color || '#64748b',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: m.emphasis ? 3 : 2,
        },
      });

      const mapsUrl = m.googleMapsUri || (lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : '');
      const link = mapsUrl
        ? `<a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#1a73e8;text-decoration:none;font-weight:600">Open in Google Maps →</a>`
        : '';
      const content = `
        <div style="min-width:150px;font-family:inherit">
          <p style="margin:0 0 2px;font-weight:700;font-size:13px">${(m.name || '').replace(/</g, '&lt;')}</p>
          ${m.type ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b">${String(m.type).replace(/_/g, ' ')}</p>` : ''}
          ${m.address ? `<p style="margin:0 0 2px;font-size:11px;color:#94a3b8">${(m.address || '').replace(/</g, '&lt;')}</p>` : ''}
          ${m.rating != null ? `<p style="margin:0 0 2px;font-size:12px;color:#f59e0b;font-weight:700">★ ${Number(m.rating).toFixed(1)}</p>` : ''}
          ${m.priceLevel != null ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b">${'₹'.repeat(Number(m.priceLevel) + 1)}</p>` : ''}
          ${m.coordinates?.lat != null ? `<p style="margin:0 0 2px;font-family:monospace;font-size:10px;color:#94a3b8">${Number(m.coordinates.lat).toFixed(5)}, ${Number(m.coordinates.lng).toFixed(5)}</p>` : ''}
          ${link}
        </div>`;
      const info = new window.google.maps.InfoWindow({ content });
      infos.push({ marker: pin, info });
      pin.addListener('click', () => {
        if (openInfo) openInfo.close();
        info.open(map, pin);
        openInfo = info;
      });
      markerRefs.current.push(pin);
    });

    return () => {
      infos.forEach(({ info }) => info.close());
      markerRefs.current.forEach((m) => m.setMap(null));
      markerRefs.current = [];
    };
  }, [state.status, markers]);

  // Loading / error panels (same look as before so the UI stays consistent).
  if (state.status === 'error') {
    return (
      <div className="flex h-[520px] flex-col items-center justify-center gap-2 bg-slate-100 px-6 text-center dark:bg-slate-900">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Map unavailable</p>
        <p className="max-w-md text-xs text-slate-500 dark:text-slate-400">
          The interactive map needs the Maps JavaScript API browser key (VITE_GOOGLE_MAPS_BROWSER_KEY).
          Geocoding, routing, restaurants and attractions still work without it.
        </p>
      </div>
    );
  }

  if (state.status === 'loading') {
    return <div className="h-[520px] w-full animate-pulse bg-slate-100 dark:bg-slate-900" />;
  }

  return <div ref={containerRef} className="h-[520px] w-full" />;
}
