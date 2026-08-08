import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateBudget,
  allocationForStyle,
  sumCosts,
  optimizeCosts,
  roomsForParty,
  budgetUtilization,
  planDailyBudgets,
} from '../src/services/budget.service.js';

test('allocateBudget parts always sum to the total', () => {
  const total = 50000;
  const allocation = allocateBudget(total);
  const sum = Object.values(allocation).reduce((s, v) => s + v.amount, 0);
  assert.ok(Math.abs(sum - total) < 0.01, `sum ${sum} should equal ${total}`);
});

test('allocateBudget rejects invalid totals', () => {
  assert.throws(() => allocateBudget(-5));
  assert.throws(() => allocateBudget(NaN));
});

test('allocationForStyle produces style-specific splits', () => {
  const luxury = allocationForStyle('luxury', 100000);
  const budget = allocationForStyle('budget', 100000);
  assert.ok(luxury.hotels.amount > budget.hotels.amount, 'luxury should allocate more to hotels');
  const sum = Object.values(luxury).reduce((s, v) => s + v.amount, 0);
  assert.ok(Math.abs(sum - 100000) < 0.01);
});

test('sumCosts sums amounts ignoring non-amount fields', () => {
  const items = [{ amount: 100 }, { amount: 250.5 }, { amount: 0 }, {}];
  assert.equal(sumCosts(items), 350.5);
});

test('optimizeCosts drops low-priority items when over budget', () => {
  const budget = 1000;
  const items = [
    { id: 'a', category: 'hotel', amount: 600, droppable: false, priority: 1 },
    { id: 'b', category: 'attraction', amount: 300, droppable: true, priority: 2 },
    { id: 'c', category: 'attraction', amount: 400, droppable: true, priority: 3 },
    { id: 'd', category: 'restaurant', amount: 200, droppable: true, priority: 2 },
  ];
  const result = optimizeCosts(items, budget, { emergencyReserve: 0 });
  assert.ok(result.withinBudget, 'result should fit budget');
  assert.equal(result.saved, 700, 'saved should equal dropped 700 (400+300)');
  assert.equal(result.dropped.length, 2);
  assert.equal(result.dropped[0].id, 'c', 'highest priority number (most droppable) dropped first');
});

test('optimizeCosts preserves must-keep items even over budget', () => {
  const budget = 500;
  const items = [
    { id: 'flight', category: 'flight', amount: 800, droppable: false, priority: 1 },
    { id: 'fun', category: 'activity', amount: 300, droppable: true, priority: 3 },
  ];
  const result = optimizeCosts(items, budget);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.optimized, 800, 'must-keep flight stays');
  assert.equal(result.withinBudget, false, 'still over budget - flagged honestly');
});

test('optimizeCosts reduces flexible items when dropping is not enough', () => {
  const budget = 1000;
  const items = [
    { id: 'hotel', category: 'hotel', amount: 900, droppable: false, priority: 1 },
    { id: 'food1', category: 'restaurant', amount: 400, droppable: false, priority: 1, flexible: true },
    { id: 'food2', category: 'restaurant', amount: 300, droppable: false, priority: 1, flexible: true },
  ];
  const result = optimizeCosts(items, budget);
  assert.ok(result.reductions.length > 0, 'should apply reductions');
  assert.ok(result.optimized <= budget + 1, 'optimized should fit budget');
});

test('optimizeCosts with no overspend leaves everything untouched', () => {
  const items = [{ id: 'a', category: 'hotel', amount: 500, droppable: true, priority: 3 }];
  const result = optimizeCosts(items, 1000);
  assert.equal(result.dropped.length, 0);
  assert.equal(result.saved, 0);
  assert.equal(result.withinBudget, true);
});

test('roomsForParty computes rooms from occupancy', () => {
  assert.equal(roomsForParty({ adults: 1, children: 0 }), 1);
  assert.equal(roomsForParty({ adults: 2, children: 0 }), 1);
  assert.equal(roomsForParty({ adults: 4, children: 0 }), 2);
  assert.equal(roomsForParty({ adults: 5, children: 0 }), 3);
  assert.equal(roomsForParty({ adults: 0, children: 4 }), 2);
  assert.equal(roomsForParty({ adults: 0, children: 0 }), 1);
});

test('budgetUtilization reports used %, remaining and withinBudget', () => {
  const u = budgetUtilization({ total: 50000, spent: 46800 });
  assert.equal(u.remaining, 3200);
  assert.equal(u.usedPct, 93.6);
  assert.equal(u.withinBudget, true);
  const over = budgetUtilization({ total: 1000, spent: 1500 });
  assert.equal(over.withinBudget, false);
  assert.equal(over.remaining, -500);
  assert.equal(over.usedPct, 100);
});

test('planDailyBudgets spreads categories across days and nights', () => {
  const plan = planDailyBudgets({
    allocation: { hotels: { amount: 15000 }, food: { amount: 10000 }, transport: { amount: 10000 }, activities: { amount: 7000 }, misc: { amount: 3000 } },
    daysCount: 5,
    nights: 4,
    rooms: 2,
  });
  assert.equal(plan.perDay.food, 2000);
  assert.equal(plan.perDay.activities, 1400);
  assert.equal(plan.perDay.hotelPerRoomNight, 1875); // 15000 / 4 nights / 2 rooms
  assert.equal(plan.totals.hotels, 15000);
});
