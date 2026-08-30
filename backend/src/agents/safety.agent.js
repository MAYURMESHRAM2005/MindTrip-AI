/**
 * Safety Agent: practical safety guidance using general knowledge.
 * Now purely deterministic — no Gemini calls. Tips are destination-aware
 * based on region detection for more relevant safety advice.
 */
import logger from '../utils/logger.js';

// ── Region detection (same logic as localGuide.agent.js) ─────────────
const INDIA_KEYWORDS = [
  'india', 'maharashtra', 'karnataka', 'tamil nadu', 'kerala', 'rajasthan',
  'gujarat', 'madhya pradesh', 'uttar pradesh', 'west bengal', 'goa',
  'mumbai', 'nagpur', 'pune', 'bangalore', 'bengaluru', 'chennai', 'kolkata',
  'hyderabad', 'jaipur', 'ahmedabad', 'delhi', 'lucknow', 'varanasi',
];

const SOUTHEAST_ASIA_KEYWORDS = [
  'thailand', 'bangkok', 'phuket', 'bali', 'indonesia', 'vietnam',
  'cambodia', 'siem reap', 'myanmar', 'laos', 'philippines', 'manila',
  'singapore', 'kuala lumpur', 'malaysia',
];

const MIDDLE_EAST_KEYWORDS = [
  'dubai', 'abu dhabi', 'uae', 'oman', 'qatar', 'doha', 'bahrain',
  'saudi arabia', 'jordan', 'israel',
];

const EUROPE_KEYWORDS = [
  'london', 'paris', 'rome', 'berlin', 'amsterdam', 'barcelona', 'madrid',
  'vienna', 'prague', 'istanbul', 'athens', 'lisbon', 'europe',
];

const EAST_ASIA_KEYWORDS = [
  'tokyo', 'osaka', 'japan', 'seoul', 'south korea', 'taipei', 'taiwan',
  'hong kong', 'beijing', 'shanghai', 'china',
];

const AMERICAS_KEYWORDS = [
  'new york', 'los angeles', 'san francisco', 'chicago', 'miami',
  'usa', 'united states', 'canada', 'toronto', 'vancouver', 'mexico',
  'brazil', 'rio',
];

function detectRegion(destination) {
  const d = (destination || '').toLowerCase();
  if (INDIA_KEYWORDS.some((k) => d.includes(k))) return 'india';
  if (SOUTHEAST_ASIA_KEYWORDS.some((k) => d.includes(k))) return 'southeast-asia';
  if (MIDDLE_EAST_KEYWORDS.some((k) => d.includes(k))) return 'middle-east';
  if (EUROPE_KEYWORDS.some((k) => d.includes(k))) return 'europe';
  if (EAST_ASIA_KEYWORDS.some((k) => d.includes(k))) return 'east-asia';
  if (AMERICAS_KEYWORDS.some((k) => d.includes(k))) return 'americas';
  return 'general';
}

// ── Region-specific safety content ───────────────────────────────────

const REGION_SAFETY = {
  india: {
    safetyTips: [
      'Use only registered taxis or ride-sharing apps (Ola/Uber) — avoid unmarked vehicles',
      'Keep your hotel address written down or saved offline — show it to taxi drivers',
      'Drink only sealed bottled water — avoid ice in drinks from street vendors',
      'Be cautious at train stations — keep bags close and use locks on luggage',
      'Avoid isolated areas after dark, especially in unfamiliar cities',
      'Use the Emergency Helpline 112 (unified) for police, fire, or medical emergencies',
      'Keep digital and physical copies of your passport and visa separately',
    ],
    scamAlerts: [
      'Auto-rickshaw drivers may claim the meter is broken — insist on meter or agree fare beforehand',
      'Fake tour guides at tourist sites — only use licensed guides from tourism offices',
      'Gem/craft shop scams where touts lead you to overpriced shops for commission',
      '有人 approaching with unsolicited help at train stations — politely decline',
      'Taxi drivers taking long routes — use GPS navigation on your phone',
    ],
    healthNotes: 'Carry ORS (oral rehydration salts) for stomach issues. Pharmacies (medical stores) are widely available. Travel insurance covering medical emergencies is strongly recommended.',
    emergencyAdvice: 'Emergency: 112 (unified). Police: 100. Ambulance: 108. Tourist Helpline: 1363. Use the Emergency Center page for nearby hospitals, police stations and pharmacies.',
    insuranceAdvice: 'Travel insurance is strongly recommended for India. Ensure it covers medical emergencies, trip cancellation, and lost luggage.',
  },
  'southeast-asia': {
    safetyTips: [
      'Use Grab or Gojek app for reliable transport — avoid unlicensed taxis',
      'Keep your belongings close in crowded markets and on motorbikes',
      'Drink bottled water only — check the seal before drinking',
      'Be aware of motorcycle bag snatching in some cities — wear crossbody bags',
      'Keep emergency contacts saved offline — WiFi may not always be available',
      'Carry a basic first-aid kit — pharmacies may not have your usual medicines',
    ],
    scamAlerts: [
      'Tuk-tuk drivers offering "special tours" to commission shops — negotiate fare upfront',
      'Jet ski and boat tour scams where damage is falsely claimed — take photos before',
      'Friendliness scams at bars where you end up with an inflated bill',
      'Fake travel agencies selling non-existent bus/train tickets — book online',
    ],
    healthNotes: 'Mosquito-borne diseases (dengue, malaria) are a risk in some areas — use repellent. Carry anti-diarrheal medicine. Tap water is not safe in most countries.',
    emergencyAdvice: 'Emergency numbers vary by country. Thailand: 191. Indonesia: 112. Vietnam: 113. Save the local emergency number before arriving.',
    insuranceAdvice: 'Travel insurance is recommended, especially for activities like motorbike riding (often excluded from basic policies — check coverage).',
  },
  europe: {
    safetyTips: [
      'Watch for pickpockets in crowded tourist areas, metro stations, and on public transport',
      'Keep your bag in front of you and zipped closed in busy areas',
      'Use a money belt or neck wallet for passports and large cash amounts',
      'Be cautious at ATMs — cover your PIN and check for card skimmers',
      'Save offline maps — mobile data may be expensive while roaming',
      'Know the local emergency number (112 for EU countries)',
    ],
    scamAlerts: [
      'Petition signature scams in tourist areas — politely decline and walk away',
      'Friendship bracelet scams where someone ties a bracelet and demands payment',
      'Fake police asking to see your wallet — real police won\'t do this',
      'Restaurant bill scams with hidden charges — always check the menu prices',
    ],
    healthNotes: 'European healthcare is excellent but can be expensive for non-residents. European Health Insurance Card (EHIC) covers EU citizens. Carry travel insurance for non-EU visitors.',
    emergencyAdvice: 'Emergency: 112 (all EU countries). Police: varies by country. Use the Emergency Center page for local numbers.',
    insuranceAdvice: 'Travel insurance is recommended for non-EU visitors. EU citizens should carry their EHIC card.',
  },
  'middle-east': {
    safetyTips: [
      'Dress modestly — covering shoulders and knees is required in many areas',
      'Alcohol laws vary by country — check local regulations before consuming',
      'Photography restrictions near government buildings and military areas',
      'Respect local customs during religious observances (Ramadan, etc.)',
      'Keep valuables in hotel safe — hotel security is generally excellent',
    ],
    scamAlerts: [
      'Gold/souk scams with fake or overpriced goods — buy from reputable shops',
      'Perfume/attar scams in markets — test before buying and negotiate',
      'Taxi meter tampering — use ride-hailing apps where available',
    ],
    healthNotes: 'Heat exhaustion is a real risk — stay hydrated and avoid midday sun. Medical facilities are excellent in major cities.',
    emergencyAdvice: 'Emergency: 999 (UAE), 911 (Saudi), 199 (Qatar). Ambulance: 998 (UAE). Use the Emergency Center page for local numbers.',
    insuranceAdvice: 'Travel insurance is recommended. Some countries require proof of insurance for entry.',
  },
  'east-asia': {
    safetyTips: [
      'Japan and South Korea are among the safest countries — but still stay aware',
      'Keep your belongings close on crowded trains during rush hour',
      'Earthquake preparedness in Japan — learn the basic safety procedures',
      'Carry your passport at all times in Japan — it is legally required',
      'Save offline maps — English signage may be limited outside tourist areas',
    ],
    scamAlerts: [
      'Overpriced bars in entertainment districts (Kabukicho, Roppongi) — check prices before entering',
      'Fake monk scams in some areas — legitimate monks won\'t ask for money',
      'Currency exchange scams — use banks or ATMs instead of street exchange',
    ],
    healthNotes: 'Healthcare is excellent and affordable in Japan and South Korea. Carry your passport for pharmacy purchases. Air quality can vary in Chinese cities.',
    emergencyAdvice: 'Japan: 110 (Police), 119 (Fire/Ambulance). South Korea: 112 (Police), 119 (Fire/Ambulance). Use the Emergency Center page for local numbers.',
    insuranceAdvice: 'Travel insurance is recommended. Japan\'s healthcare is good but can be expensive for non-residents.',
  },
  americas: {
    safetyTips: [
      'Be aware of your surroundings, especially in large cities at night',
      'Use ATMs inside banks or shopping centers — avoid street ATMs after dark',
      'Keep your phone and valuables out of sight in crowded areas',
      'Use ride-sharing apps instead of hailing cabs on the street at night',
      'Know the local emergency number (911 in USA/Canada)',
      'Keep a copy of your passport separate from the original',
    ],
    scamAlerts: [
      'Fake charity collectors in tourist areas — donate to established organizations',
      'Distraction theft in crowded areas — one person distracts while another steals',
      'Overpriced restaurant bills with automatic gratuity — check before paying',
    ],
    healthNotes: 'Healthcare is excellent but very expensive in the USA. Travel insurance is essential. Pharmacies (CVS, Walgreens) are widely available.',
    emergencyAdvice: 'Emergency: 911 (USA/Canada). Use the Emergency Center page for local hospitals and pharmacies.',
    insuranceAdvice: 'Travel insurance is essential for the USA due to high healthcare costs. Other American countries: recommended but less critical.',
  },
  general: {
    safetyTips: [
      'Save your hotel address and share it with someone you trust',
      'Use the Emergency Center page for nearby hospitals, police and pharmacies',
      'Keep digital and physical copies of important documents',
      'Use registered taxis or ride-sharing apps for transport',
      'Keep valuables in a secure bag and be aware of your surroundings',
      'Carry a basic first-aid kit and any personal medications',
      'Learn the local emergency number before you arrive',
    ],
    scamAlerts: [
      'Be cautious of unlicensed tour guides offering unsolicited help',
      'Verify prices before accepting services from street vendors',
      'Be wary of strangers offering food or drinks in nightlife areas',
    ],
    healthNotes: 'Drink bottled water if unsure about tap water safety. Carry any personal medications with prescriptions. Know the location of the nearest hospital.',
    emergencyAdvice: 'Use the Emergency Center page for verified contacts — do not rely on unofficial sources.',
    insuranceAdvice: 'Consider travel insurance covering medical emergencies and trip cancellation.',
  },
};

class SafetyAgent {
  constructor() {
    this.name = 'safety';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ destination }) {
    logger.entry('[AGENT:safety]', 'run', { destination });
    const region = detectRegion(destination);
    const content = REGION_SAFETY[region] || REGION_SAFETY.general;

    const result = {
      agent: this.name,
      status: 'success',
      data: {
        ...content,
        region,
        note: `Safety tips customized for ${region} region (detected from "${destination}")`,
      },
      message: `Safety guidance for ${region} region (${destination})`,
      latencyMs: 0,
      usedAI: false,
      source: 'deterministic',
    };
    logger.exit('[AGENT:safety]', 'run', { status: 'success', region, safetyTips: content.safetyTips.length, scamAlerts: content.scamAlerts.length });
    return result;
  }

  report(result) {
    return {
      agent: this.name,
      status: result.status,
      message: result.message,
      latencyMs: result.latencyMs,
      usedAI: result.usedAI,
    };
  }
}

export default new SafetyAgent();
