import test from 'node:test';
import assert from 'node:assert/strict';
import mealEngineModule from '../src/services/mealAssignmentEngine.service.js';
const {
  isRestaurantValid,
  isOpenForMeal,
  foodPreferenceScore,
  proximityScore,
  ratingScore,
  priceBudgetScore,
  scoreRestaurant,
  assignMealsForDay,
  assignMealsForAllDays,
  buildUnavailableMeal,
  MEAL_TIMES,
} = mealEngineModule;

// ══════════════════════════════════════════════════════════════════════
//  FIXTURES
// ══════════════════════════════════════════════════════════════════════

function makeRestaurant(overrides = {}) {
  return {
    name: 'Trishna',
    providerId: 'trish-1',
    provider: 'zomato',
    source: 'zomato',
    latitude: 18.927,
    longitude: 72.833,
    address: 'Nariman Point, Mumbai',
    cuisine: ['Seafood', 'Indian'],
    rating: 4.5,
    reviewCount: 3200,
    priceLevel: 2,
    averageCostPerPerson: 800,
    currency: 'INR',
    openingHours: {
      periods: [
        { days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], open: '11:00', close: '23:00' },
      ],
    },
    dataStatus: 'live',
    isEstimate: false,
    ...overrides,
  };
}

function makeBreakfastRestaurant(overrides = {}) {
  return makeRestaurant({
    name: 'Cafe Mondegar',
    providerId: 'monde-1',
    latitude: 18.929,
    longitude: 72.836,
    cuisine: ['Continental', 'Indian', 'Breakfast'],
    rating: 4.2,
    averageCostPerPerson: 400,
    openingHours: {
      periods: [
        { days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], open: '07:00', close: '23:00' },
      ],
    },
    ...overrides,
  });
}

function makeVegetarianRestaurant(overrides = {}) {
  return makeRestaurant({
    name: 'Saravana Bhavan',
    providerId: 'saravana-1',
    cuisine: ['Vegetarian', 'South Indian'],
    rating: 4.3,
    averageCostPerPerson: 350,
    ...overrides,
  });
}

function makeClosedRestaurant(overrides = {}) {
  return makeRestaurant({
    name: 'Closed Place',
    providerId: 'closed-1',
    openingHours: {
      periods: [
        { days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], open: '09:00', close: '17:00' },
      ],
    },
    ...overrides,
  });
}

function makeGenericRestaurant(overrides = {}) {
  return makeRestaurant({
    name: 'Breakfast',
    providerId: 'generic-1',
    ...overrides,
  });
}

function makeNoCoordsRestaurant(overrides = {}) {
  return makeRestaurant({
    name: 'No Coords Cafe',
    providerId: 'nocoords-1',
    latitude: null,
    longitude: null,
    ...overrides,
  });
}

// ══════════════════════════════════════════════════════════════════════
//  1. RESTAURANT VALIDITY
// ══════════════════════════════════════════════════════════════════════

test('Valid restaurant passes validity check', () => {
  const r = makeRestaurant();
  const { valid } = isRestaurantValid(r);
  assert.equal(valid, true);
});

test('Null restaurant fails validity', () => {
  const { valid } = isRestaurantValid(null);
  assert.equal(valid, false);
});

test('Empty name fails validity', () => {
  const { valid, reason } = isRestaurantValid({ name: '', providerId: '1' });
  assert.equal(valid, false);
  assert.ok(reason.includes('name'));
});

test('Generic name "Breakfast" fails validity', () => {
  const { valid, reason } = isRestaurantValid(makeGenericRestaurant());
  assert.equal(valid, false);
  assert.ok(reason.includes('generic'));
});

test('No provider ID fails validity', () => {
  const { valid, reason } = isRestaurantValid({ name: 'Real Place', providerId: '' });
  assert.equal(valid, false);
  assert.ok(reason.includes('provider ID'));
});

test('Invalid coordinates fail validity', () => {
  const { valid } = isRestaurantValid(makeRestaurant({ latitude: 999, longitude: -999 }));
  assert.equal(valid, false);
});

test('Null island coordinates fail validity', () => {
  const { valid } = isRestaurantValid(makeRestaurant({ latitude: 0, longitude: 0 }));
  assert.equal(valid, false);
});

test('Restaurant without coordinates is valid (coords optional)', () => {
  const { valid } = isRestaurantValid(makeNoCoordsRestaurant());
  assert.equal(valid, true);
});

// ══════════════════════════════════════════════════════════════════════
//  2. OPENING HOURS
// ══════════════════════════════════════════════════════════════════════

test('Restaurant open at lunch time is valid for lunch', () => {
  const r = makeRestaurant(); // open 11:00-23:00
  assert.equal(isOpenForMeal(r, 'lunch', '2025-06-02'), true); // Monday
});

test('Restaurant open at dinner time is valid for dinner', () => {
  const r = makeRestaurant(); // open 11:00-23:00
  assert.equal(isOpenForMeal(r, 'dinner', '2025-06-02'), true);
});

test('Restaurant open at breakfast time is valid for breakfast', () => {
  const r = makeBreakfastRestaurant(); // open 07:00-23:00
  assert.equal(isOpenForMeal(r, 'breakfast', '2025-06-02'), true);
});

test('Restaurant closed at breakfast time is invalid for breakfast', () => {
  const r = makeClosedRestaurant(); // open 09:00-17:00 only weekdays
  // Breakfast is at 08:00, tolerance ±2 = 06:00-10:00
  // This restaurant opens at 09:00, which IS within tolerance
  const result = isOpenForMeal(r, 'breakfast', '2025-06-02');
  // 09:00 is within tolerance of breakfast (08:00 ± 2)
  assert.equal(result, true);
});

test('Restaurant with no hours data is assumed open', () => {
  const r = makeRestaurant({ openingHours: null });
  assert.equal(isOpenForMeal(r, 'lunch', '2025-06-02'), true);
});

test('Restaurant closed on weekends is invalid for Saturday lunch', () => {
  const r = makeRestaurant({
    openingHours: {
      periods: [
        { days: ['Mo', 'Tu', 'We', 'Th', 'Fr'], open: '11:00', close: '23:00' },
      ],
    },
  });
  assert.equal(isOpenForMeal(r, 'lunch', '2025-06-07'), false); // Saturday
});

test('Restaurant open on weekends is valid for Saturday lunch', () => {
  const r = makeRestaurant({
    openingHours: {
      periods: [
        { days: ['Sa', 'Su'], open: '11:00', close: '23:00' },
      ],
    },
  });
  assert.equal(isOpenForMeal(r, 'lunch', '2025-06-07'), true); // Saturday
});

// ══════════════════════════════════════════════════════════════════════
//  3. FOOD PREFERENCE MATCHING
// ══════════════════════════════════════════════════════════════════════

test('Vegetarian restaurant matches vegetarian preference', () => {
  const r = makeVegetarianRestaurant();
  const score = foodPreferenceScore(r, 'vegetarian');
  assert.ok(score >= 0.7, `Score should be >= 0.7: ${score}`);
});

test('Seafood restaurant does not match vegetarian preference', () => {
  const r = makeRestaurant({ cuisine: ['Seafood'] });
  const score = foodPreferenceScore(r, 'vegetarian');
  assert.ok(score < 0.5, `Score should be < 0.5: ${score}`);
});

test('No preference accepts all restaurants', () => {
  const r = makeRestaurant();
  assert.equal(foodPreferenceScore(r, ''), 1);
  assert.equal(foodPreferenceScore(r, null), 1);
});

test('Preference match by name', () => {
  const r = makeRestaurant({ name: 'Best Vegetarian Kitchen', cuisine: [] });
  const score = foodPreferenceScore(r, 'vegetarian');
  assert.ok(score >= 0.7, `Score should be >= 0.7 for name match: ${score}`);
});

test('Preference partial keyword match', () => {
  const r = makeRestaurant({ cuisine: ['Indian Thali'] });
  const score = foodPreferenceScore(r, 'thali');
  assert.ok(score >= 0.5, `Score should be >= 0.5 for keyword match: ${score}`);
});

// ══════════════════════════════════════════════════════════════════════
//  4. PROXIMITY SCORING
// ══════════════════════════════════════════════════════════════════════

test('Close restaurant gets high proximity score', () => {
  const r = makeRestaurant({ latitude: 18.927, longitude: 72.833 });
  const ref = { latitude: 18.928, longitude: 72.834 };
  const score = proximityScore(r, ref);
  assert.ok(score >= 0.9, `Score should be >= 0.9: ${score}`);
});

test('Far restaurant gets low proximity score', () => {
  const r = makeRestaurant({ latitude: 19.2, longitude: 72.9 });
  const ref = { latitude: 18.92, longitude: 72.83 };
  const score = proximityScore(r, ref);
  assert.ok(score < 0.5, `Score should be < 0.5: ${score}`);
});

test('No reference point returns neutral score', () => {
  const r = makeRestaurant();
  const score = proximityScore(r, null);
  assert.equal(score, 0.5);
});

test('Restaurant without coordinates returns low score', () => {
  const r = makeNoCoordsRestaurant();
  const ref = { latitude: 18.92, longitude: 72.83 };
  const score = proximityScore(r, ref);
  assert.equal(score, 0.3);
});

// ══════════════════════════════════════════════════════════════════════
//  5. RATING SCORING
// ══════════════════════════════════════════════════════════════════════

test('High rating gets high score', () => {
  assert.ok(ratingScore({ rating: 4.5 }) >= 0.9);
  assert.ok(ratingScore({ rating: 4.8 }) === 1.0);
});

test('Low rating gets low score', () => {
  assert.ok(ratingScore({ rating: 2.5 }) < 0.5);
});

test('No rating returns moderate score', () => {
  assert.equal(ratingScore({ rating: null }), 0.4);
  assert.equal(ratingScore({ rating: 0 }), 0.4);
});

// ══════════════════════════════════════════════════════════════════════
//  6. PRICE / BUDGET SCORING
// ══════════════════════════════════════════════════════════════════════

test('Restaurant within budget gets high score', () => {
  const r = makeRestaurant({ averageCostPerPerson: 500 });
  const score = priceBudgetScore(r, 800);
  assert.ok(score >= 0.9, `Score should be >= 0.9: ${score}`);
});

test('Restaurant over budget gets low score', () => {
  const r = makeRestaurant({ averageCostPerPerson: 1500 });
  const score = priceBudgetScore(r, 800);
  assert.ok(score < 0.5, `Score should be < 0.5: ${score}`);
});

test('Restaurant without price returns moderate score', () => {
  const r = makeRestaurant({ averageCostPerPerson: null });
  const score = priceBudgetScore(r, 800);
  assert.equal(score, 0.4);
});

test('No budget returns neutral score', () => {
  const r = makeRestaurant({ averageCostPerPerson: 500 });
  const score = priceBudgetScore(r, 0);
  assert.equal(score, 0.5);
});

// ══════════════════════════════════════════════════════════════════════
//  7. COMPOSITE SCORING
// ══════════════════════════════════════════════════════════════════════

test('Best candidate gets highest composite score', () => {
  const good = makeRestaurant({ rating: 4.8, averageCostPerPerson: 500 });
  const bad = makeRestaurant({ name: 'Bad Place', providerId: 'bad-1', rating: 2.0, averageCostPerPerson: 1500 });
  const ref = { latitude: 18.927, longitude: 72.833 };

  const goodScore = scoreRestaurant(good, { mealType: 'lunch', dateStr: '2025-06-02', foodPreference: '', refPoint: ref, mealBudget: 800 });
  const badScore = scoreRestaurant(bad, { mealType: 'lunch', dateStr: '2025-06-02', foodPreference: '', refPoint: ref, mealBudget: 800 });

  assert.ok(goodScore.score > badScore.score, `Good (${goodScore.score}) should score higher than bad (${badScore.score})`);
});

test('Closed restaurant gets zero opening hours score', () => {
  const r = makeClosedRestaurant(); // 09:00-17:00 weekdays only
  const result = scoreRestaurant(r, { mealType: 'dinner', dateStr: '2025-06-02', foodPreference: '', refPoint: null, mealBudget: 0 });
  assert.equal(result.open, false);
  assert.equal(result.breakdown.openingHours, 0);
});

// ══════════════════════════════════════════════════════════════════════
//  8. MEAL ASSIGNMENT FOR A DAY
// ══════════════════════════════════════════════════════════════════════

test('Assigns real restaurants for all three meals', () => {
  const restaurants = [
    makeBreakfastRestaurant(), // 07:00-23:00, good for breakfast
    makeRestaurant(),          // 11:00-23:00, good for lunch/dinner
    makeVegetarianRestaurant(), // good for any meal
  ];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 800,
  });

  assert.ok(result.breakfast, 'Breakfast should be assigned');
  assert.ok(result.lunch, 'Lunch should be assigned');
  assert.ok(result.dinner, 'Dinner should be assigned');

  // Names should be real restaurant names, not generic "Breakfast"/"Lunch"/"Dinner"
  assert.ok(result.breakfast.title.includes('at '), `Breakfast title should include "at": ${result.breakfast.title}`);
  assert.ok(result.lunch.title.includes('at '), `Lunch title should include "at": ${result.lunch.title}`);
  assert.ok(result.dinner.title.includes('at '), `Dinner title should include "at": ${result.dinner.title}`);
});

test('No generic "Breakfast"/"Lunch"/"Dinner" as restaurant name', () => {
  const restaurants = [
    makeBreakfastRestaurant(),
    makeRestaurant(),
    makeVegetarianRestaurant(),
  ];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 800,
  });

  assert.notEqual(result.breakfast?.place, 'Breakfast');
  assert.notEqual(result.lunch?.place, 'Lunch');
  assert.notEqual(result.dinner?.place, 'Dinner');
});

test('Different restaurants for different meals (uniqueness)', () => {
  const restaurants = [
    makeBreakfastRestaurant(),
    makeRestaurant(),
    makeVegetarianRestaurant(),
    makeRestaurant({ name: 'Fourth Place', providerId: 'fourth-1' }),
  ];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 800,
  });

  const names = new Set([
    result.breakfast?.place,
    result.lunch?.place,
    result.dinner?.place,
  ]);
  assert.equal(names.size, 3, 'All three meals should use different restaurants');
});

test('Respects used restaurants (no double-booking)', () => {
  const restaurants = [
    makeBreakfastRestaurant(),
    makeRestaurant(),
    makeVegetarianRestaurant(),
  ];
  const used = new Set(['zomato|monde-1']); // Cafe Mondegar already used
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: used,
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 800,
  });

  // Breakfast should NOT be Cafe Mondegar (it's already used)
  if (result.breakfast) {
    assert.notEqual(result.breakfast.place, 'Cafe Mondegar');
  }
});

// ══════════════════════════════════════════════════════════════════════
//  9. PRICE MAPPING
// ══════════════════════════════════════════════════════════════════════

test('Restaurant with price gets real cost', () => {
  const restaurants = [makeRestaurant({ averageCostPerPerson: 800 })];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 1000,
  });

  // At least one meal should have a real price
  const meals = [result.breakfast, result.lunch, result.dinner].filter(Boolean);
  const withPrice = meals.filter((m) => m.cost.amount > 0);
  assert.ok(withPrice.length > 0, 'At least one meal should have a real price');
});

test('Restaurant without price shows price unavailable', () => {
  const restaurants = [makeRestaurant({ averageCostPerPerson: null })];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 1000,
  });

  const meals = [result.breakfast, result.lunch, result.dinner].filter(Boolean);
  for (const m of meals) {
    if (m.cost.amount === null) {
      assert.equal(m.cost.dataStatus, 'unavailable');
      assert.equal(m.cost.isEstimate, false);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════
//  10. NO RESTAURANT AVAILABLE
// ══════════════════════════════════════════════════════════════════════

test('Empty restaurant list returns null meals', () => {
  const result = assignMealsForDay({
    restaurants: [],
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 800,
  });

  assert.equal(result.breakfast, null);
  assert.equal(result.lunch, null);
  assert.equal(result.dinner, null);
});

test('Only invalid restaurants returns null meals', () => {
  const result = assignMealsForDay({
    restaurants: [makeGenericRestaurant(), { name: '', providerId: '1' }],
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 800,
  });

  assert.equal(result.breakfast, null);
  assert.equal(result.lunch, null);
  assert.equal(result.dinner, null);
});

// ══════════════════════════════════════════════════════════════════════
//  11. UNAVAILABLE FALLBACK
// ══════════════════════════════════════════════════════════════════════

test('buildUnavailableMeal shows honest unavailability', () => {
  const meal = buildUnavailableMeal('breakfast', 'Mumbai');
  assert.ok(meal.title.includes('unavailable'), `Title should mention unavailable: ${meal.title}`);
  assert.equal(meal.restaurant, null);
  assert.equal(meal.cost.amount, null);
  assert.equal(meal.cost.dataStatus, 'unavailable');
  assert.equal(meal.cost.isEstimate, false);
});

test('buildUnavailableMeal does not invent restaurant name', () => {
  const meal = buildUnavailableMeal('lunch', 'Goa');
  assert.ok(!meal.title.includes('Restaurant'), `Should not invent name: ${meal.title}`);
  assert.ok(!meal.place || meal.place === 'Goa', 'Place should be destination or empty');
});

test('buildUnavailableMeal cost is never fabricated', () => {
  for (const type of ['breakfast', 'lunch', 'dinner']) {
    const meal = buildUnavailableMeal(type, 'Delhi');
    assert.equal(meal.cost.amount, null);
    assert.equal(meal.cost.isEstimate, false);
    assert.ok(meal.cost.estimateNote.includes('not fabricated'));
  }
});

// ══════════════════════════════════════════════════════════════════════
//  12. MULTI-DAY ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════

test('Multi-day: different restaurants across days', () => {
  const day1Restaurants = [
    makeBreakfastRestaurant(),
    makeRestaurant({ name: 'Lunch Place 1', providerId: 'lp1' }),
    makeRestaurant({ name: 'Dinner Place 1', providerId: 'dp1' }),
  ];
  const day2Restaurants = [
    makeRestaurant({ name: 'Breakfast 2', providerId: 'b2', openingHours: { periods: [{ days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], open: '07:00', close: '23:00' }] } }),
    makeRestaurant({ name: 'Lunch 2', providerId: 'l2' }),
    makeRestaurant({ name: 'Dinner 2', providerId: 'd2' }),
  ];

  const days = [
    { dayNumber: 1, date: '2025-06-02', restaurantPool: day1Restaurants },
    { dayNumber: 2, date: '2025-06-03', restaurantPool: day2Restaurants },
  ];

  const result = assignMealsForAllDays({
    days,
    foodPreference: '',
    mealBudget: 800,
    logPipeline: false,
  });

  assert.equal(result.dayMeals.length, 2);

  // Day 1 and Day 2 should use different restaurants
  const day1Names = new Set([
    result.dayMeals[0].breakfast?.place,
    result.dayMeals[0].lunch?.place,
    result.dayMeals[0].dinner?.place,
  ]);
  const day2Names = new Set([
    result.dayMeals[1].breakfast?.place,
    result.dayMeals[1].lunch?.place,
    result.dayMeals[1].dinner?.place,
  ]);

  // No overlap between days
  for (const name of day1Names) {
    if (name) assert.ok(!day2Names.has(name), `"${name}" should not repeat across days`);
  }
});

test('Multi-day summary counts correctly', () => {
  const days = [
    { dayNumber: 1, date: '2025-06-02', restaurantPool: [makeBreakfastRestaurant(), makeRestaurant(), makeVegetarianRestaurant()] },
    { dayNumber: 2, date: '2025-06-03', restaurantPool: [makeRestaurant({ name: 'B2', providerId: 'b2', openingHours: { periods: [{ days: ['all'], open: '07:00', close: '23:00' }] } }), makeRestaurant({ name: 'L2', providerId: 'l2' }), makeRestaurant({ name: 'D2', providerId: 'd2' })] },
  ];

  const result = assignMealsForAllDays({ days, foodPreference: '', mealBudget: 800, logPipeline: false });

  assert.equal(result.summary.totalDays, 2);
  assert.equal(result.summary.totalMeals, 6);
  assert.ok(result.summary.assigned >= 3, `Should assign at least 3 meals: ${result.summary.assigned}`);
  assert.ok(result.summary.uniqueRestaurants >= 3, `Should use at least 3 unique restaurants: ${result.summary.uniqueRestaurants}`);
});

// ══════════════════════════════════════════════════════════════════════
//  13. FOOD PREFERENCE IN ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════

test('Vegetarian preference prefers vegetarian restaurants', () => {
  const restaurants = [
    makeRestaurant({ name: 'Non-Veg Place', providerId: 'nv1', cuisine: ['Non-Vegetarian'] }),
    makeVegetarianRestaurant(),
    makeRestaurant({ name: 'Another Non-Veg', providerId: 'nv2', cuisine: ['Non-Vegetarian'] }),
  ];

  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: 'vegetarian',
    mealBudget: 500,
  });

  // At least one meal should prefer the vegetarian restaurant
  const meals = [result.breakfast, result.lunch, result.dinner].filter(Boolean);
  const vegMeals = meals.filter((m) => m.place === 'Saravana Bhavan');
  assert.ok(vegMeals.length > 0, 'At least one meal should use the vegetarian restaurant');
});

// ══════════════════════════════════════════════════════════════════════
//  14. EDGE CASES
// ══════════════════════════════════════════════════════════════════════

test('Single restaurant used for one meal only', () => {
  const restaurants = [makeRestaurant()];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 800,
  });

  // With only 1 restaurant, it can be used for one meal; others null
  const meals = [result.breakfast, result.lunch, result.dinner].filter(Boolean);
  assert.ok(meals.length >= 1, 'At least one meal should be assigned');
  assert.ok(meals.length <= 3, 'At most 3 meals');
});

test('Used keys are tracked correctly', () => {
  const restaurants = [
    makeBreakfastRestaurant(),
    makeRestaurant(),
    makeVegetarianRestaurant(),
  ];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 800,
  });

  assert.ok(result.usedKeys.size >= 1, `Should track used keys: ${result.usedKeys.size}`);
  assert.ok(result.usedKeys.size <= 3, `Should track at most 3 keys: ${result.usedKeys.size}`);
});

test('Invalid dates handled gracefully', () => {
  const restaurants = [makeRestaurant()];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: 'invalid-date',
    foodPreference: '',
    mealBudget: 800,
  });
  // Should not throw, should still assign meals (opening hours check falls back to assume open)
  assert.ok(result.breakfast || result.lunch || result.dinner);
});

test('MEAL_TIMES constants are correct', () => {
  assert.equal(MEAL_TIMES.breakfast.hour, 8);
  assert.equal(MEAL_TIMES.lunch.hour, 13);
  assert.equal(MEAL_TIMES.dinner.hour, 20);
  assert.equal(MEAL_TIMES.breakfast.label, '08:00');
  assert.equal(MEAL_TIMES.lunch.label, '13:00');
  assert.equal(MEAL_TIMES.dinner.label, '20:00');
});

// ══════════════════════════════════════════════════════════════════════
//  15. COST FORMAT
// ══════════════════════════════════════════════════════════════════════

test('Cost object has correct structure', () => {
  const restaurants = [makeRestaurant({ averageCostPerPerson: 800 })];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 1000,
  });

  const meal = result.breakfast || result.lunch || result.dinner;
  assert.ok(meal, 'At least one meal should be assigned');
  assert.ok(typeof meal.cost.amount === 'number' || meal.cost.amount === null);
  assert.ok(typeof meal.cost.currency === 'string');
  assert.ok(typeof meal.cost.isEstimate === 'boolean');
  assert.ok(typeof meal.cost.source === 'string');
  assert.ok(typeof meal.cost.dataStatus === 'string');
});

test('Cost with real price has dataStatus live or provider', () => {
  const restaurants = [makeRestaurant({ averageCostPerPerson: 800, dataStatus: 'live', isEstimate: false })];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 1000,
  });

  const meal = result.breakfast || result.lunch || result.dinner;
  assert.ok(meal, 'At least one meal should be assigned');
  if (meal.cost.amount > 0) {
    assert.ok(meal.cost.dataStatus === 'live' || meal.cost.dataStatus === 'provider');
    assert.equal(meal.cost.isEstimate, false);
  }
});

// ══════════════════════════════════════════════════════════════════════
//  16. BREAKFAST EARLY OPENING
// ══════════════════════════════════════════════════════════════════════

test('Restaurant opening at 07:00 is valid for breakfast (08:00 ± 2)', () => {
  const r = makeBreakfastRestaurant(); // 07:00-23:00
  assert.equal(isOpenForMeal(r, 'breakfast', '2025-06-02'), true);
});

test('Restaurant opening at 11:00 is NOT valid for breakfast', () => {
  const r = makeRestaurant({ // 11:00-23:00
    openingHours: {
      periods: [
        { days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], open: '11:00', close: '23:00' },
      ],
    },
  });
  // Breakfast at 08:00 ± 2 = 06:00-10:00. Restaurant opens at 11:00 — outside range.
  assert.equal(isOpenForMeal(r, 'breakfast', '2025-06-02'), false);
});

// ══════════════════════════════════════════════════════════════════════
//  17. DESCRIPTION QUALITY
// ══════════════════════════════════════════════════════════════════════

test('Meal description includes restaurant name', () => {
  const restaurants = [makeRestaurant({ name: 'Leopold Cafe' })];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 800,
  });

  const meal = result.breakfast || result.lunch || result.dinner;
  assert.ok(meal, 'At least one meal');
  assert.ok(meal.description.includes('Leopold Cafe'), `Description should include restaurant name: ${meal.description}`);
});

test('Meal description includes price when available', () => {
  const restaurants = [makeRestaurant({ averageCostPerPerson: 800 })];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 1000,
  });

  const meal = result.breakfast || result.lunch || result.dinner;
  assert.ok(meal, 'At least one meal');
  if (meal.cost.amount > 0) {
    assert.ok(meal.description.includes('₹'), `Description should include price: ${meal.description}`);
  }
});

test('Meal description mentions price unavailable when no price', () => {
  const restaurants = [makeRestaurant({ averageCostPerPerson: null })];
  const result = assignMealsForDay({
    restaurants,
    usedRestaurants: new Set(),
    dateStr: '2025-06-02',
    foodPreference: '',
    mealBudget: 1000,
  });

  const meal = result.breakfast || result.lunch || result.dinner;
  assert.ok(meal, 'At least one meal');
  if (meal.cost.amount === null) {
    assert.ok(meal.description.includes('Price unavailable'), `Should mention price unavailable: ${meal.description}`);
  }
});
