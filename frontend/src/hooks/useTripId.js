import { useMemo } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { tripApi } from '../services/apiClient';

/**
 * Resolves which trip is "active": from :id route param, ?trip= query, or the
 * most recent saved trip.
 */
export default function useTripId() {
  const { id } = useParams();
  const location = useLocation();
  const queryTrip = useMemo(() => new URLSearchParams(location.search).get('trip'), [location.search]);

  const { data: trips } = useQuery({
    queryKey: ['trips'],
    queryFn: () => tripApi.list().then((r) => r.data.data.trips),
    enabled: !id && !queryTrip,
  });

  const tripId = id || queryTrip || trips?.[0]?._id || null;
  return tripId;
}
