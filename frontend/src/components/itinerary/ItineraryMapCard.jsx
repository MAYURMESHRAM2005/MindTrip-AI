import React, { useMemo } from 'react';
import { Map as MapIcon, Hotel, UtensilsCrossed, Landmark } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import MapView from '../MapView';
import { useI18n } from '../../utils/i18n';

/**
 * Interactive map of the trip: hotel, restaurants, attractions markers plus
 * the daily route polylines. Reuses the existing MapView (react-leaflet).
 */
export default function ItineraryMapCard({ mapData }) {
  const { t } = useI18n();
  const markers = useMemo(() => {
    if (!mapData?.markers) return [];
    return mapData.markers.filter((m) => m.coordinates?.lat != null && m.coordinates?.lng != null);
  }, [mapData]);

  const routes = useMemo(
    () => (Array.isArray(mapData?.routes) ? mapData.routes.filter((r) => r.points?.length >= 2).map((r) => r.points) : []),
    [mapData]
  );

  if (!markers.length && !routes.length) return null;

  const count = (type) => markers.filter((m) => m.type === type).length;

  return (
    <Card className="mb-6">
      <CardHeader
        icon={MapIcon}
        title={t('Interactive map')}
        subtitle={t('Hotels, restaurants, attractions and your daily route')}
        action={
          <div className="flex flex-wrap gap-1.5">
            {count('hotel') > 0 && <Badge tone="violet"><Hotel className="h-3 w-3" /> {count('hotel')}</Badge>}
            {count('restaurant') > 0 && <Badge tone="rose"><UtensilsCrossed className="h-3 w-3" /> {count('restaurant')}</Badge>}
            {count('attraction') > 0 && <Badge tone="amber"><Landmark className="h-3 w-3" /> {count('attraction')}</Badge>}
          </div>
        }
      />
      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
        <MapView
          center={mapData?.center || [20.5937, 78.9629]}
          markers={markers}
          route={routes[0] || []}
        />
      </div>
      {routes.length > 1 && (
        <p className="mt-2 text-xs text-slate-400">{routes.length} {t('daily route(s) available — showing the first day on the map.')}</p>
      )}
    </Card>
  );
}
