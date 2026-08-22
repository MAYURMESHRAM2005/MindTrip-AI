import React from 'react';
import TripSummaryCard from './TripSummaryCard';
import BudgetPlanningCard from './BudgetPlanningCard';
import NearbyPlacesCard from './NearbyPlacesCard';
import TransportPlanCard from './TransportPlanCard';
import WeatherSection from './WeatherSection';
import TravelTipsCard from './TravelTipsCard';
import RecommendationsCard from './RecommendationsCard';
import ItineraryMapCard from './ItineraryMapCard';
import { useI18n } from '../../utils/i18n';

/**
 * Enriched itinerary sections rendered on the AI Itinerary page.
 * All data comes from the itinerary `extras` object built by the backend at
 * generation time — nothing is computed client-side from live APIs.
 */
export default function ItineraryEnrichment({ extras, currency = 'INR' }) {
  const { t } = useI18n();
  if (!extras) return null;

  return (
    <>
      <TripSummaryCard summary={extras.tripSummary} currency={currency} />
      <BudgetPlanningCard planning={extras.budgetPlanning} currency={currency} />
      <TransportPlanCard plan={extras.transportPlan} currency={currency} />
      <WeatherSection weatherDaily={extras.weatherDaily} isLive={extras.tripSummary?.weatherLive} note={extras.weatherNote} />
      <NearbyPlacesCard variant="hotel" items={extras.hotels} currency={currency} />
      <NearbyPlacesCard variant="restaurant" items={extras.restaurants} currency={currency} />
      <NearbyPlacesCard
        variant="attraction"
        items={extras.attractions?.top}
        currency={currency}
        note={t('Top attractions unavailable right now.')}
      />
      <ItineraryMapCard mapData={extras.mapData} />
      <RecommendationsCard recommendations={extras.recommendations} />
      <TravelTipsCard tips={extras.travelTips} />
    </>
  );
}
