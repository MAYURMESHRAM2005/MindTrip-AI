/**
 * provenanceValidator.test.js — Tests for Data Provenance Validation
 *
 * Tests the strict data provenance validation system that ensures every
 * factual itinerary entity contains a valid provenance block with:
 *   - sourceType: "provider" | "estimated" | "unavailable"
 *   - provider: string (provider name)
 *   - providerId: string (provider's unique ID)
 *   - fetchedAt: ISO timestamp
 *   - dataStatus: "live" | "estimated" | "unavailable"
 *   - isEstimate: boolean
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProvenance,
  createProviderProvenance,
  createEstimatedProvenance,
  createUnavailableProvenance,
  validateActivityProvenance,
  validateDayProvenance,
  validateItineraryProvenance,
  ensureProvenance,
} from '../src/validators/provenanceValidator.js';

describe('Provenance Validator', () => {
  describe('validateProvenance', () => {
    it('should validate a valid provider provenance block', () => {
      const provenance = {
        sourceType: 'provider',
        provider: 'google',
        providerId: 'place-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'live',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it('should validate a valid estimated provenance block', () => {
      const provenance = {
        sourceType: 'estimated',
        provider: 'system',
        providerId: 'estimated-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'estimated',
        isEstimate: true,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it('should validate a valid unavailable provenance block', () => {
      const provenance = {
        sourceType: 'unavailable',
        provider: 'none',
        providerId: 'unavailable-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'unavailable',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it('should reject missing provenance block', () => {
      const result = validateProvenance(null, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('[test] Missing provenance block'));
    });

    it('should reject missing sourceType', () => {
      const provenance = {
        provider: 'google',
        providerId: 'place-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'live',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('[test] Missing sourceType'));
    });

    it('should reject invalid sourceType', () => {
      const provenance = {
        sourceType: 'invalid',
        provider: 'google',
        providerId: 'place-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'live',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('Invalid sourceType')));
    });

    it('should reject missing provider', () => {
      const provenance = {
        sourceType: 'provider',
        providerId: 'place-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'live',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('[test] Missing provider'));
    });

    it('should reject missing providerId', () => {
      const provenance = {
        sourceType: 'provider',
        provider: 'google',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'live',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('[test] Missing providerId'));
    });

    it('should reject missing fetchedAt', () => {
      const provenance = {
        sourceType: 'provider',
        provider: 'google',
        providerId: 'place-123',
        dataStatus: 'live',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('[test] Missing fetchedAt'));
    });

    it('should reject invalid fetchedAt format', () => {
      const provenance = {
        sourceType: 'provider',
        provider: 'google',
        providerId: 'place-123',
        fetchedAt: 'not-a-date',
        dataStatus: 'live',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('fetchedAt must be a valid ISO timestamp')));
    });

    it('should reject missing dataStatus', () => {
      const provenance = {
        sourceType: 'provider',
        provider: 'google',
        providerId: 'place-123',
        fetchedAt: new Date().toISOString(),
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('[test] Missing dataStatus'));
    });

    it('should reject invalid dataStatus', () => {
      const provenance = {
        sourceType: 'provider',
        provider: 'google',
        providerId: 'place-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'invalid-status',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('Invalid dataStatus')));
    });

    it('should reject non-boolean isEstimate', () => {
      const provenance = {
        sourceType: 'provider',
        provider: 'google',
        providerId: 'place-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'live',
        isEstimate: 'true',
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.includes('[test] isEstimate must be a boolean'));
    });

    it('should reject live dataStatus with isEstimate true', () => {
      const provenance = {
        sourceType: 'provider',
        provider: 'google',
        providerId: 'place-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'live',
        isEstimate: true,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('dataStatus "live" cannot coexist with isEstimate: true')));
    });

    it('should reject estimated dataStatus with isEstimate false', () => {
      const provenance = {
        sourceType: 'estimated',
        provider: 'system',
        providerId: 'estimated-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'estimated',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('dataStatus "estimated" must have isEstimate: true')));
    });

    it('should reject provider sourceType with unavailable dataStatus', () => {
      const provenance = {
        sourceType: 'provider',
        provider: 'google',
        providerId: 'place-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'unavailable',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('sourceType "provider" cannot coexist with dataStatus "unavailable"')));
    });

    it('should reject estimated sourceType with live dataStatus', () => {
      const provenance = {
        sourceType: 'estimated',
        provider: 'system',
        providerId: 'estimated-123',
        fetchedAt: new Date().toISOString(),
        dataStatus: 'live',
        isEstimate: false,
      };
      const result = validateProvenance(provenance, 'test');
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('sourceType "estimated" cannot coexist with dataStatus "live"')));
    });
  });

  describe('createProviderProvenance', () => {
    it('should create a valid live provider provenance', () => {
      const provenance = createProviderProvenance('google', 'place-123');
      assert.equal(provenance.sourceType, 'provider');
      assert.equal(provenance.provider, 'google');
      assert.equal(provenance.providerId, 'place-123');
      assert.equal(provenance.dataStatus, 'live');
      assert.equal(provenance.isEstimate, false);
      assert.ok(provenance.fetchedAt);
    });

    it('should create a valid estimated provider provenance', () => {
      const provenance = createProviderProvenance('zomato', 'rest-456', 'estimated');
      assert.equal(provenance.sourceType, 'provider');
      assert.equal(provenance.provider, 'zomato');
      assert.equal(provenance.providerId, 'rest-456');
      assert.equal(provenance.dataStatus, 'estimated');
      assert.equal(provenance.isEstimate, true);
    });

    it('should throw on invalid dataStatus', () => {
      assert.throws(() => createProviderProvenance('google', 'place-123', 'invalid'), /Invalid dataStatus/);
    });
  });

  describe('createEstimatedProvenance', () => {
    it('should create a valid estimated provenance', () => {
      const provenance = createEstimatedProvenance('google', 'place-123');
      assert.equal(provenance.sourceType, 'estimated');
      assert.equal(provenance.provider, 'google');
      assert.equal(provenance.providerId, 'place-123');
      assert.equal(provenance.dataStatus, 'estimated');
      assert.equal(provenance.isEstimate, true);
    });

    it('should use defaults when provider is not provided', () => {
      const provenance = createEstimatedProvenance(null, null);
      assert.equal(provenance.provider, 'system');
      assert.equal(provenance.providerId, 'estimated');
    });
  });

  describe('createUnavailableProvenance', () => {
    it('should create a valid unavailable provenance', () => {
      const provenance = createUnavailableProvenance('google', 'API rate limit exceeded');
      assert.equal(provenance.sourceType, 'unavailable');
      assert.equal(provenance.provider, 'google');
      assert.equal(provenance.dataStatus, 'unavailable');
      assert.equal(provenance.isEstimate, false);
      assert.equal(provenance.unavailableReason, 'API rate limit exceeded');
    });

    it('should use defaults when provider is not provided', () => {
      const provenance = createUnavailableProvenance(null, null);
      assert.equal(provenance.provider, 'none');
      assert.equal(provenance.unavailableReason, 'No reliable data available');
    });
  });

  describe('validateActivityProvenance', () => {
    it('should validate an activity with valid provenance', () => {
      const activity = {
        title: 'Visit Taj Mahal',
        place: 'Taj Mahal',
        provenance: {
          sourceType: 'provider',
          provider: 'google',
          providerId: 'place-123',
          fetchedAt: new Date().toISOString(),
          dataStatus: 'live',
          isEstimate: false,
        },
      };
      const result = validateActivityProvenance(activity);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it('should reject an activity without provenance', () => {
      const activity = {
        title: 'Visit Taj Mahal',
        place: 'Taj Mahal',
      };
      const result = validateActivityProvenance(activity);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('Missing provenance block')));
    });

    it('should reject live status with no real provider', () => {
      const activity = {
        title: 'Visit Taj Mahal',
        place: 'Taj Mahal',
        provenance: {
          sourceType: 'provider',
          provider: 'none',
          providerId: 'place-123',
          fetchedAt: new Date().toISOString(),
          dataStatus: 'live',
          isEstimate: false,
        },
      };
      const result = validateActivityProvenance(activity);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('dataStatus "live" requires a real provider name')));
    });

    it('should reject live status with unavailable providerId', () => {
      const activity = {
        title: 'Visit Taj Mahal',
        place: 'Taj Mahal',
        provenance: {
          sourceType: 'provider',
          provider: 'google',
          providerId: 'unavailable-123',
          fetchedAt: new Date().toISOString(),
          dataStatus: 'live',
          isEstimate: false,
        },
      };
      const result = validateActivityProvenance(activity);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => e.includes('dataStatus "live" requires a real providerId')));
    });
  });

  describe('validateDayProvenance', () => {
    it('should validate a day with all valid activities', () => {
      const day = {
        dayNumber: 1,
        activities: [
          {
            title: 'Visit Taj Mahal',
            provenance: {
              sourceType: 'provider',
              provider: 'google',
              providerId: 'place-123',
              fetchedAt: new Date().toISOString(),
              dataStatus: 'live',
              isEstimate: false,
            },
          },
          {
            title: 'Lunch at Restaurant',
            provenance: {
              sourceType: 'provider',
              provider: 'zomato',
              providerId: 'rest-456',
              fetchedAt: new Date().toISOString(),
              dataStatus: 'live',
              isEstimate: false,
            },
          },
        ],
      };
      const result = validateDayProvenance(day);
      assert.equal(result.valid, true);
      assert.equal(result.summary.totalActivities, 2);
      assert.equal(result.summary.liveCount, 2);
    });

    it('should reject a day with invalid activities', () => {
      const day = {
        dayNumber: 1,
        activities: [
          {
            title: 'Visit Taj Mahal',
            provenance: {
              sourceType: 'provider',
              provider: 'google',
              providerId: 'place-123',
              fetchedAt: new Date().toISOString(),
              dataStatus: 'live',
              isEstimate: false,
            },
          },
          {
            title: 'Invalid Activity',
            // Missing provenance
          },
        ],
      };
      const result = validateDayProvenance(day);
      assert.equal(result.valid, false);
      assert.ok(result.errors.length > 0);
    });
  });

  describe('validateItineraryProvenance', () => {
    it('should validate an entire itinerary', () => {
      const days = [
        {
          dayNumber: 1,
          activities: [
            {
              title: 'Visit Taj Mahal',
              provenance: {
                sourceType: 'provider',
                provider: 'google',
                providerId: 'place-123',
                fetchedAt: new Date().toISOString(),
                dataStatus: 'live',
                isEstimate: false,
              },
            },
          ],
        },
        {
          dayNumber: 2,
          activities: [
            {
              title: 'Visit Red Fort',
              provenance: {
                sourceType: 'provider',
                provider: 'google',
                providerId: 'place-456',
                fetchedAt: new Date().toISOString(),
                dataStatus: 'live',
                isEstimate: false,
              },
            },
          ],
        },
      ];
      const result = validateItineraryProvenance(days);
      assert.equal(result.valid, true);
      assert.equal(result.summary.totalDays, 2);
      assert.equal(result.summary.totalActivities, 2);
      assert.equal(result.summary.livePercentage, 100);
    });
  });

  describe('ensureProvenance', () => {
    it('should not modify an activity with existing provenance', () => {
      const activity = {
        title: 'Visit Taj Mahal',
        provenance: {
          sourceType: 'provider',
          provider: 'google',
          providerId: 'place-123',
          fetchedAt: new Date().toISOString(),
          dataStatus: 'live',
          isEstimate: false,
        },
      };
      const result = ensureProvenance(activity);
      assert.equal(result.provenance.provider, 'google');
    });

    it('should add provenance to an activity without one', () => {
      const activity = {
        title: 'Visit Taj Mahal',
        place: 'Taj Mahal',
        providerId: 'place-123',
      };
      const result = ensureProvenance(activity, 'google', 'live');
      assert.ok(result.provenance);
      assert.equal(result.provenance.sourceType, 'provider');
      assert.equal(result.provenance.provider, 'google');
      assert.equal(result.provenance.dataStatus, 'live');
    });

    it('should add unavailable provenance when no provider specified', () => {
      const activity = {
        title: 'Unknown Activity',
      };
      const result = ensureProvenance(activity);
      assert.equal(result.provenance.sourceType, 'unavailable');
      assert.equal(result.provenance.dataStatus, 'unavailable');
    });
  });
});
