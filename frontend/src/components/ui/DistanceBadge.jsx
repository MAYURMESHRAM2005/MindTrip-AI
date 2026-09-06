import React from 'react';
import { Navigation, MapPin } from 'lucide-react';
import { useI18n } from '../../utils/i18n';
import { cn } from '../../utils/format';

/**
 * DistanceBadge — displays distance and travel time between two locations.
 *
 * Format examples:
 *   🚶 850 m · 10 min walk
 *   🚗 4.2 km · 16 min drive
 *   🚌 7.4 km · 28 min transit
 *   📍 4.2 km  (duration unavailable — haversine only)
 *
 * @param {object} props
 * @param {number|null} props.distanceKm     - distance in km (or null)
 * @param {number|null} props.distanceMeters  - distance in meters (alternative to km)
 * @param {number|null} props.durationMin     - travel time in minutes (or null)
 * @param {number|null} props.durationSeconds - travel time in seconds (alternative)
 * @param {string}      props.travelMode      - 'walking'|'driving'|'transit'|'taxi/auto'|'bus/metro'|etc.
 * @param {boolean}     props.isEstimate      - whether this is a haversine estimate
 * @param {string}      props.className       - additional classes
 * @param {string}      props.size            - 'sm' | 'md' (default 'md')
 */
export default function DistanceBadge({
  distanceKm,
  distanceMeters,
  durationMin,
  durationSeconds,
  travelMode = 'walking',
  isEstimate = false,
  className = '',
  size = 'sm',
}) {
  const { t } = useI18n();

  // Normalize distance to km
  let km = distanceKm;
  if (km == null && distanceMeters != null) {
    km = Math.round((distanceMeters / 1000) * 10) / 10;
  }

  // Normalize duration to minutes
  let mins = durationMin;
  if (mins == null && durationSeconds != null) {
    mins = Math.max(1, Math.round(durationSeconds / 60));
  }

  // If no distance data at all, don't render
  if (km == null && mins == null) return null;

  // Format distance
  let distanceLabel;
  if (km != null) {
    if (km < 1) {
      distanceLabel = `${Math.round(km * 1000)} m`;
    } else {
      distanceLabel = `${Math.round(km * 10) / 10} km`;
    }
  }

  // Determine travel mode icon and label
  const modeIcons = {
    walking: '🚶',
    walk: '🚶',
    driving: '🚗',
    drive: '🚗',
    taxi: '🚗',
    'taxi/auto': '🚗',
    transit: '🚌',
    'bus/metro': '🚌',
    bus: '🚌',
    metro: '🚇',
    flight: '✈️',
    train: '🚆',
  };

  const modeLabels = {
    walking: 'walk',
    walk: 'walk',
    driving: 'drive',
    drive: 'drive',
    taxi: 'drive',
    'taxi/auto': 'drive',
    transit: 'transit',
    'bus/metro': 'transit',
    bus: 'transit',
    metro: 'transit',
    flight: 'flight',
    train: 'train',
  };

  const icon = modeIcons[travelMode] || '📍';
  const label = modeLabels[travelMode] || travelMode || '';

  const isSm = size === 'sm';
  const textSize = isSm ? 'text-[11px]' : 'text-xs';

  return (
    <span className={cn('inline-flex items-center gap-1', textSize, 'text-slate-400 dark:text-slate-500', className)}>
      <span>{icon}</span>
      {distanceLabel && (
        <span className="font-medium">{distanceLabel}</span>
      )}
      {mins != null && (
        <>
          <span>·</span>
          <span className="font-medium">
            {mins} min{label ? ` ${label}` : ''}
          </span>
        </>
      )}
      {isEstimate && (
        <span className="text-slate-300 dark:text-slate-600">(est.)</span>
      )}
    </span>
  );
}
