import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

// Fix default marker icon paths for bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function Fit({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, 12, { duration: 1.2 });
  }, [center?.[0], center?.[1]]);
  return null;
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

export default function MapView({ center, markers = [], directions }) {
  const routeLines = directions?.isLive
    ? (directions.directions?.routes || []).map((r) => (r.polyline ? decodePolyline(r.polyline) : null)).filter(Boolean)
    : [];

  return (
    <MapContainer center={center} zoom={12} style={{ height: '520px', width: '100%' }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit center={center} />
      {routeLines.map((line, i) => (
        <Polyline key={i} positions={line} pathOptions={{ color: i === 0 ? '#257aeb' : '#94a3b8', weight: i === 0 ? 5 : 3, dashArray: i === 0 ? null : '6 6' }} />
      ))}
      {markers.map((m, i) => (
        <Marker key={i} position={[m.coordinates.lat, m.coordinates.lng]}>
          <Popup>
            <p className="text-sm font-bold">{m.name}</p>
            <p className="text-xs text-slate-500">{m.type?.replace(/_/g, ' ')}</p>
            {m.address && <p className="text-xs text-slate-400">{m.address}</p>}
            {m.rating != null && <p className="text-xs text-amber-500">★ {m.rating}</p>}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
