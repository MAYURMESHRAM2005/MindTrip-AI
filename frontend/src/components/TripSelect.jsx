import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { tripApi } from '../services/apiClient';

/**
 * Selector for the user's saved trips; used by itinerary, budget, expenses,
 * chatbot and other trip-scoped pages.
 */
export default function TripSelect({ value, onChange, allowAll = false }) {
  const { data, isLoading } = useQuery({
    queryKey: ['trips'],
    queryFn: () => tripApi.list().then((r) => r.data.data.trips),
  });

  const trips = data || [];

  return (
    <select
      className="input max-w-xs"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={isLoading}
    >
      <option value="">{allowAll ? 'All trips' : 'Select a trip…'}</option>
      {trips.map((t) => (
        <option key={t._id} value={t._id}>
          {t.title} • {t.destination}
        </option>
      ))}
    </select>
  );
}
