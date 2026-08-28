import Trip from '../models/Trip.js';
import Itinerary from '../models/Itinerary.js';
import AIConversation from '../models/AIConversation.js';
import geminiService from './gemini.service.js';
import logger from '../utils/logger.js';
import orchestrator from '../orchestrator/tripOrchestrator.js';
import weatherProvider from '../providers/weather.provider.js';
import placesProvider from '../providers/places.provider.js';
import budgetService from './budget.service.js';
import itineraryService from './itinerary.service.js';
import Expense from '../models/Expense.js';

/**
 * Intent detection - lightweight, deterministic keyword matching so the
 * chatbot reliably triggers REAL actions even when the LLM is unavailable.
 */
export function detectIntent(message) {
  const m = message.toLowerCase();
  if (/cheap|budget|save|reduce|afford/.test(m)) return 'make_cheaper';
  if (/replace|change|different|swap/.test(m) && /hotel|stay|accommodation|place to sleep/.test(m)) return 'replace_hotel';
  if (/(vegetarian|vegan|veg food|pure veg|veg\b)/.test(m) && /restaurant|eat|food|dining/.test(m)) return 'veg_restaurants';
  if (/move|shift|reschedule|tomorrow|another day/.test(m) && /attraction|activity|visit|thing/.test(m)) return 'move_activity';
  if (/rain|weather|umbrella|forecast/.test(m)) return 'weather';
  if (/emergency|hospital|police|help|sos/.test(m)) return 'emergency';
  if (/expense|spend|cost so far|how much.*spent/.test(m)) return 'expenses';
  return 'chat';
}

async function loadTripContext(userId, tripId) {
  const trip = tripId
    ? await Trip.findOne({ _id: tripId, user: userId })
    : await Trip.findOne({ user: userId }).sort({ createdAt: -1 });
  if (!trip) return null;
  const itinerary = await Itinerary.findOne({ trip: trip._id });
  return { trip, itinerary };
}

async function handleMakeCheaper(userId, trip, itinerary) {
  const result = await orchestrator.optimizeTripBudget({ trip, itinerary, user: { _id: userId } });
  return {
    title: 'Budget optimized',
    body: `Saved ${result.saved} (${result.currency}). Optimized total: ${result.optimized}. ${result.withinBudget ? 'Your trip now fits the budget.' : 'Still over budget - consider cheaper dates or destinations.'}`,
    link: `/budget?trip=${trip._id}`,
    result,
  };
}

async function handleReplaceHotel(userId, trip, itinerary) {
  const hotelAgent = (await import('../agents/hotel.agent.js')).default;
  const hotelResult = await hotelAgent.run({
    destination: trip.destination,
    checkIn: new Date(trip.startDate).toISOString().slice(0, 10),
    checkOut: new Date(trip.endDate).toISOString().slice(0, 10),
    adults: trip.travelers?.adults || 1,
    totalBudget: trip.budget.total,
    hotelPreference: trip.preferences?.hotelPreference || '',
    userId,
  });
  const hotel = hotelResult.data?.recommended || hotelResult.data?.hotels?.[0];
  if (hotel) {
    itinerary.accommodation = {
      name: hotel.name,
      address: hotel.address || '',
      pricePerNight: hotel.price?.amount ?? null,
      isLive: hotelResult.data?.isLive === true,
      source: 'amadeus-hotels',
    };
    await itinerary.save();
    return {
      title: 'Hotel replaced',
      body: `Switched to ${hotel.name}${hotel.price?.amount ? ` at ${hotel.price.amount} ${hotel.price.currency}/night` : ''}. ${hotelResult.data?.isLive ? 'Live offer from Amadeus.' : hotelResult.data?.message}`,
      link: `/itinerary/${trip._id}`,
    };
  }
  return { title: 'Hotel replacement unavailable', body: hotelResult.data?.message || 'No alternative found from live providers.' };
}

async function handleVegRestaurants(trip) {
  const result = await placesProvider.textSearch({
    query: `${trip.destination} vegetarian restaurants`,
    type: 'restaurant',
    limit: 6,
  });
  if (!result.isLive) {
    return { title: 'Restaurants', body: result.message, link: `/restaurants?q=${encodeURIComponent(trip.destination)}` };
  }
  const names = result.data.map((r) => `• ${r.name} (rating ${r.rating ?? 'n/a'})`).join('\n');
  return {
    title: 'Vegetarian restaurants',
    body: `Near ${trip.destination}:\n${names}`,
    link: `/restaurants?q=${encodeURIComponent(trip.destination)}&veg=1`,
  };
}

async function handleMoveActivity(userId, trip, itinerary) {
  // Move the next non-core activity from today to tomorrow
  const today = itinerary.days[0];
  const movable = today?.activities.find((a) => (a.priority || 1) > 1);
  if (!movable || !itinerary.days[1]) {
    return { title: 'Move activity', body: 'No movable activity found to reschedule.' };
  }
  const idx = today.activities.indexOf(movable);
  today.activities.splice(idx, 1);
  itinerary.days[1].activities.push(movable);
  await itinerary.save();
  return { title: 'Activity moved', body: `Moved "${movable.title}" to Day ${itinerary.days[1].dayNumber}.`, link: `/itinerary/${trip._id}` };
}

async function handleWeather(trip, userId) {
  const result = await weatherProvider.forecast({ city: trip.destination });
  if (!result.isLive) {
    // Live forecast unavailable - ask Gemini for general destination advice instead
    const ai = await geminiService.generateText({
      system: 'You are the TravelMind AI weather advisor. Give practical, concise travel advice. Never present invented live weather as fact - clearly say live data is unavailable.',
      prompt: `The live weather provider is not configured for ${trip.destination}. Give practical advice for the user's question about rain/weather there (packing, indoor alternatives, what to expect by season). Mark clearly that live data is unavailable.`,
      agent: 'chatbot',
      action: 'weatherAdvice',
      userId,
    });
    return {
      title: 'Weather advice',
      body: ai.success ? ai.text : `${result.message} Meanwhile, pack an umbrella and keep indoor backups.`,
      link: `/weather?city=${encodeURIComponent(trip.destination)}`,
    };
  }
  const d = result.data[0];
  return {
    title: 'Weather forecast',
    body: `${trip.destination}: ${d.condition} (${d.tempMin}–${d.tempMax}°C), rain ${d.rainProbability}%. ${d.rainProbability > 50 ? 'Carry an umbrella and plan indoor backups.' : ''}`,
    link: `/weather?city=${encodeURIComponent(trip.destination)}`,
  };
}

async function handleExpenses(userId, trip) {
  const expenses = await Expense.find({ user: userId, trip: trip._id });
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const byCat = {};
  for (const e of expenses) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const breakdown = Object.entries(byCat).map(([k, v]) => `${k}: ${v}`).join(', ') || 'No expenses recorded yet';
  return {
    title: 'Expense summary',
    body: `Spent ${total} of ${trip.budget.total} ${trip.budget.currency}. ${breakdown}.`,
    link: `/expenses?trip=${trip._id}`,
  };
}

async function handleEmergency(trip) {
  return {
    title: 'Emergency assistance',
    body: 'Use the Emergency Center to find nearby hospitals, police stations and pharmacies with live data. For immediate help call your local emergency number (112 works in many regions).',
    link: '/emergency',
  };
}

/**
 * Main chat handler. Executes real actions for known intents, otherwise asks
 * Gemini for a contextual answer using the user's saved trip.
 */
export async function processMessage({ userId, tripId, message, conversationId }) {
  logger.entry('[CHAT]', 'processMessage', { userId, tripId, messageLength: message?.length, conversationId });
  const started = Date.now();
  const context = await loadTripContext(userId, tripId);
  const intent = detectIntent(message);
  logger.info(`[CHAT] Detected intent: '${intent}' for message: '${message?.slice(0, 50)}...'`);
  let actionResult = null;

  switch (intent) {
    case 'make_cheaper':
      if (context) actionResult = await handleMakeCheaper(userId, context.trip, context.itinerary);
      break;
    case 'replace_hotel':
      if (context) actionResult = await handleReplaceHotel(userId, context.trip, context.itinerary);
      break;
    case 'veg_restaurants':
      if (context) actionResult = await handleVegRestaurants(context.trip);
      break;
    case 'move_activity':
      if (context) actionResult = await handleMoveActivity(userId, context.trip, context.itinerary);
      break;
    case 'weather':
      if (context) actionResult = await handleWeather(context.trip, userId);
      break;
    case 'emergency':
      actionResult = await handleEmergency(context?.trip);
      break;
    case 'expenses':
      if (context) actionResult = await handleExpenses(userId, context.trip);
      break;
    default:
      break;
  }

  // Build the AI answer
  let reply;
  if (actionResult) {
    reply = `✅ ${actionResult.title}\n${actionResult.body}`;
  } else {
    const tripSummary = context
      ? `User's saved trip: ${context.trip.title} to ${context.trip.destination}, ${context.trip.budget.total} ${context.trip.budget.currency} budget, ${new Date(context.trip.startDate).toDateString()} to ${new Date(context.trip.endDate).toDateString()}. Itinerary days: ${context.itinerary?.days?.length || 0}.`
      : 'User has no saved trip yet.';
    const ai = await geminiService.generateText({
      system: 'You are the TravelMind AI travel assistant. Answer helpfully and concisely. Never invent live prices, schedules or availability; if you do not know live data, say so clearly.',
      prompt: `${tripSummary}\nUser question: ${message}`,
      agent: 'chatbot',
      action: 'chat',
      userId,
    });
    reply = ai.success ? ai.text : `I could not generate an AI response right now (${ai.message}). Meanwhile: try "Make my trip cheaper", "Find vegetarian restaurants" or "What should I do if it rains?".`;
  }

  // Persist conversation
  let conversation;
  if (conversationId) conversation = await AIConversation.findById(conversationId);
  if (!conversation) {
    conversation = await AIConversation.create({
      user: userId,
      trip: context?.trip?._id || null,
      title: message.slice(0, 60),
    });
  }
  conversation.messages.push(
    { role: 'user', content: message, timestamp: new Date() },
    { role: 'assistant', content: reply, toolCalls: actionResult ? { intent, ...actionResult } : null, timestamp: new Date() }
  );
  conversation.messages = conversation.messages.slice(-40);
  await conversation.save();

  logger.exit('[CHAT]', 'processMessage', { status: 'success', intent, actionExecuted: Boolean(actionResult), latencyMs: Date.now() - started });
  return {
    reply,
    intent,
    actionExecuted: Boolean(actionResult),
    actionResult,
    conversationId: conversation._id,
  };
}

export default { processMessage, detectIntent };
