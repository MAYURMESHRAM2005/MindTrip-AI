import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Bundled default marker icons (works offline, no CDN dependency)
import 'leaflet-defaulticon-compatibility';
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css';

function Fit({ center, bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length >= 2) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
    } else if (center) {
      map.flyTo(center, 12, { duration: 1.2 });
    }
  }, [center?.[0], center?.[1], bounds]);
  return null;
}

function coloredIcon(color = '#64748b', size = 18, emphasis = false) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:${emphasis ? 3 : 2.5}px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

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
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export default function MapView({ center, markers = [], route = [], directions }) {
  // Prefer the backend route polyline; fall back to backend-provided directions
  const routeLines = route.length
    ? [route]
    : directions?.isLive
      ? (directions.directions?.routes || []).map((r) => (r.polyline ? decodePolyline(r.polyline) : null)).filter(Boolean)
      : [];

  const bounds = route.length >= 2 ? route : null;

  return (
    <MapContainer center={center} zoom={12} style={{ height: '520px', width: '100%' }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit center={center} bounds={bounds} />
      {routeLines.map((line, i) => (
        <Polyline
          key={i}
          positions={line}
          pathOptions={{ color: i === 0 ? '#257aeb' : '#94a3b8', weight: i === 0 ? 5 : 3, dashArray: i === 0 ? null : '6 6' }}
        />
      ))}
      {markers.map((m, i) =>
        m.coordinates?.lat != null && m.coordinates?.lng != null ? (
          <Marker
            key={i}
            position={[m.coordinates.lat, m.coordinates.lng]}
            icon={coloredIcon(m.color, m.emphasis ? 26 : 18, Boolean(m.emphasis))}
          >
            <Popup>
              <p className="text-sm font-bold">{m.name}</p>
              {m.type && <p className="text-xs text-slate-500">{String(m.type).replace(/_/g, ' ')}</p>}
              {m.address && <p className="text-xs text-slate-400">{m.address}</p>}
              {m.rating != null && <p className="text-xs text-amber-500">★ {m.rating}</p>}
              {m.coordinates?.lat != null && m.coordinates?.lng != null && (
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  {Number(m.coordinates.lat).toFixed(5)}, {Number(m.coordinates.lng).toFixed(5)}
                </p>
              )}
            </Popup>
          </Marker>
        ) : null
      )}
    </MapContainer>
  );
}
