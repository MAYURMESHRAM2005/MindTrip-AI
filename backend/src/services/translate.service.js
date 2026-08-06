import geminiService from './gemini.service.js';

/**
 * Built-in dictionary for key UI strings in English, Hindi and Marathi.
 * AI responses use Gemini for full translation when configured.
 */
const DICTIONARY = {
  dashboard: { en: 'Dashboard', hi: 'डैशबोर्ड', mr: 'डॅशबोर्ड' },
  planTrip: { en: 'Plan a Trip', hi: 'यात्रा की योजना बनाएं', mr: 'सहलीचे नियोजन करा' },
  budget: { en: 'Budget', hi: 'बजट', mr: 'बजेट' },
  hotels: { en: 'Hotels', hi: 'होटल', mr: 'हॉटेल्स' },
  flights: { en: 'Flights', hi: 'उड़ानें', mr: 'विमाने' },
  restaurants: { en: 'Restaurants', hi: 'रेस्तरां', mr: 'रेस्टॉरंट्स' },
  weather: { en: 'Weather', hi: 'मौसम', mr: 'हवामान' },
  saved: { en: 'Saved', hi: 'सहेजा गया', mr: 'जतन केले' },
  loading: { en: 'Loading…', hi: 'लोड हो रहा है…', mr: 'लोड होत आहे…' },
  liveDataUnavailable: {
    en: 'Live data unavailable',
    hi: 'लाइव डेटा अनुपलब्ध',
    mr: 'लाइव्ह डेटा अनुपलब्ध',
  },
};

export function translateDict(key, lang) {
  const entry = DICTIONARY[key];
  if (!entry) return key;
  return entry[lang] || entry.en;
}

/**
 * Translate arbitrary text via Gemini, falling back to the original text
 * (with a notice) when AI is unavailable.
 */
export async function translateText(text, target = 'en') {
  if (target === 'en' && !text.match(/[^\x00-\x7F]/)) return { translated: text, viaAI: false };
  const res = await geminiService.generateText({
    system: `You are a professional travel-app translator. Translate the user's text into ${target === 'hi' ? 'Hindi' : target === 'mr' ? 'Marathi' : 'English'}. Respond with ONLY the translated text, nothing else. Preserve place names, numbers and emoji.`,
    prompt: text,
    agent: 'translation',
    action: 'translate',
  });
  if (res.success) {
    return { translated: res.text.trim(), viaAI: true, note: 'Translated by Gemini' };
  }
  return { translated: text, viaAI: false, note: res.message };
}

export default { translateDict, translateText };
