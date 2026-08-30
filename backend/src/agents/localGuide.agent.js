/**
 * Local Guide Agent: cultural and practical tips using general knowledge.
 * Now purely deterministic — no Gemini calls. Never invents specific prices,
 * hours or availability. Tips are destination-aware based on region detection.
 */
import logger from '../utils/logger.js';

// ── Region detection ─────────────────────────────────────────────────
const INDIA_STATES = [
  'maharashtra', 'karnataka', 'tamil nadu', 'kerala', 'rajasthan', 'gujarat',
  'madhya pradesh', 'uttar pradesh', 'west bengal', 'goa', 'punjab', 'haryana',
  'delhi', 'mumbai', 'nagpur', 'pune', 'bangalore', 'bengaluru', 'chennai',
  'kolkata', 'hyderabad', 'jaipur', 'ahmedabad', 'lucknow', 'varanasi',
  'agra', 'udaipur', 'jodhpur', ' shimla', 'manali', 'rishikesh', 'haridwar',
  'amritsar', 'chandigarh', 'bhopal', 'indore', 'raipur', 'patna', 'ranchi',
  'bhubaneswar', 'guwahati', 'coimbatore', 'madurai', 'mysore', 'mysuru',
  'ooty', 'ootacamund', 'kodaikanal', 'lonavala', 'khandala', 'shirdi',
  'ajmer', 'pushkar', 'mussoorie', 'nainital', 'darjeeling', 'gangtok',
  'shillong', 'kohima', 'imphal', 'agartala', 'aizawl', 'itanagar',
];

const SOUTHEAST_ASIA = [
  'thailand', 'bangkok', 'phuket', 'chiang mai', 'bali', 'indonesia',
  'vietnam', 'hanoi', 'ho chi minh', 'da nang', 'cambodia', 'siem reap',
  'phnom penh', 'myanmar', 'yangon', 'mandalay', 'laos', 'luang prabang',
  'philippines', 'manila', 'cebu', 'palawan', 'singapore', 'kuala lumpur',
  'malaysia', 'langkawi', 'penang',
];

const MIDDLE_EAST = [
  'dubai', 'abu dhabi', 'uae', 'united arab emirates', 'oman', 'muscat',
  'qatar', 'doha', 'bahrain', 'saudi arabia', 'riyadh', 'jeddah',
  'jordan', 'amman', 'petra', 'israel', 'tel aviv', 'jerusalem',
];

const EUROPE = [
  'london', 'paris', 'rome', 'berlin', 'amsterdam', 'barcelona', 'madrid',
  'vienna', 'prague', 'istanbul', 'athens', 'lisbon', 'zurich', 'geneva',
  'milan', 'florence', 'venice', 'munich', 'dublin', 'edinburgh',
  'stockholm', 'oslo', 'copenhagen', 'helsinki', 'budapest', 'warsaw',
  'krakow', 'split', 'dubrovnik', 'santorini', 'mykonos',
];

const EAST_ASIA = [
  'tokyo', 'osaka', 'kyoto', 'japan', 'seoul', 'south korea', 'taipei',
  'taiwan', 'hong kong', 'beijing', 'shanghai', 'china',
];

const AMERICAS = [
  'new york', 'los angeles', 'san francisco', 'chicago', 'miami',
  'las vegas', 'washington', 'boston', 'seattle', 'canada', 'toronto',
  'vancouver', 'montreal', 'mexico', 'cancun', 'brazil', 'rio',
  'buenos aires', 'lima', 'bogota',
];

const AFRICA = [
  'cape town', 'south africa', 'nairobi', 'kenya', 'marrakech', 'morocco',
  'cairo', 'egypt', 'zanzibar', 'tanzania', 'ethiopia', 'addis ababa',
];

function detectRegion(destination) {
  const d = (destination || '').toLowerCase();
  if (INDIA_STATES.some((s) => d.includes(s))) return 'india';
  if (SOUTHEAST_ASIA.some((s) => d.includes(s))) return 'southeast-asia';
  if (MIDDLE_EAST.some((s) => d.includes(s))) return 'middle-east';
  if (EUROPE.some((s) => d.includes(s))) return 'europe';
  if (EAST_ASIA.some((s) => d.includes(s))) return 'east-asia';
  if (AMERICAS.some((s) => d.includes(s))) return 'americas';
  if (AFRICA.some((s) => d.includes(s))) return 'africa';
  return 'general';
}

// ── Region-specific content ──────────────────────────────────────────

const REGION_TIPS = {
  india: {
    tips: [
      'Bargaining is expected at local markets — start at 50% of the quoted price',
      'Carry small denomination cash (₹10, ₹20, ₹50 notes) for auto-rickshaws and street food',
      'Tap water is not safe to drink — always buy sealed bottled water',
      'Remove shoes before entering temples, gurudwaras and many homes',
      'Try local street food from busy stalls — high turnover means fresh food',
      'Use Ola/Uber for reliable metered transport in cities',
      'UPI payments (Google Pay, PhonePe) are accepted almost everywhere in cities',
    ],
    etiquette: [
      'Use your right hand for giving, receiving and eating',
      'Ask permission before photographing people, especially at religious sites',
      'Dress modestly when visiting temples — cover shoulders and knees',
      'Avoid public displays of affection — it may attract unwanted attention',
      'Accept chai when offered — it is a sign of hospitality',
    ],
    hiddenGems: [
      'Visit popular attractions early morning (before 9 AM) to avoid crowds',
      'Walk through old city areas for authentic local architecture and food',
      'Take a morning walk in any local park — you will see yoga, walking groups, and local life',
      'Check for free walking tours led by local volunteers in major cities',
    ],
    languagePhrases: [
      'Namaste — Hello / Greetings',
      'Dhanyavaad / Shukriya — Thank you',
      'Yeh kitne ka hai? — How much does this cost?',
      'Paani — Water',
      'Khana — Food',
      'Hospital kahan hai? — Where is the hospital?',
    ],
    paymentNotes: 'UPI (Google Pay, PhonePe, Paytm) is widely accepted in cities. Carry cash for small vendors, auto-rickshaws and rural areas. ATMs are available in all cities.',
  },
  'southeast-asia': {
    tips: [
      'Street food is safe and delicious — look for stalls with long queues of locals',
      'Negotiate tuk-tuk and taxi fares before getting in — agree on price upfront',
      'Carry a light rain jacket — tropical showers can happen any time',
      'Get a local SIM card for cheap data — available at airports and convenience stores',
      'Stay hydrated — the tropical heat can be intense',
      'Use Grab app for reliable transport across Southeast Asia',
    ],
    etiquette: [
      'Never touch someone\'s head — it is considered the most sacred part of the body',
      'Point your feet away from religious statues and monks',
      'Remove shoes before entering temples and homes',
      'Do not point at people with your finger — use your whole hand instead',
    ],
    hiddenGems: [
      'Visit temples at sunrise for the most peaceful and photogenic experience',
      'Take a cooking class — it is the best way to understand local food culture',
      'Explore night markets for cheap local food and handmade souvenirs',
      'Take local buses instead of tourist shuttles to see how locals travel',
    ],
    languagePhrases: [
      'Sawasdee / Selamat — Hello',
      'Khob khun / Terima kasih — Thank you',
      'Tao rai? / Berapa? — How much?',
      'Chuai duay — Help',
      'Hospital — Hospital (English is widely spoken in tourist areas)',
    ],
    paymentNotes: 'Cash is king in most Southeast Asian countries. ATMs are widely available. Some tourist areas accept cards but carry cash for street food and markets.',
  },
  europe: {
    tips: [
      'Validate your ticket before boarding trains — fines for unchecked tickets are steep',
      'Carry a universal power adapter — European plug types vary by country',
      'Tipping is not mandatory but rounding up or leaving 5-10% is appreciated',
      'Many museums offer free entry on the first Sunday of the month',
      'Use contactless payment — it is accepted almost everywhere',
      'Buy a city tourist card for free public transport and museum discounts',
    ],
    etiquette: [
      'Greet shopkeepers with "Bonjour" / "Hola" / "Hallo" when entering',
      'Do not split the bill evenly at restaurants — each person pays their share',
      'Keep your voice down on public transport',
      'Do not photograph military buildings or security installations',
    ],
    hiddenGems: [
      'Walk through residential neighborhoods for authentic local life and architecture',
      'Visit local food markets for the cheapest and freshest meals',
      'Check for free walking tours — tip-based and available in most cities',
      'Explore cities early morning before the tourist crowds arrive',
    ],
    languagePhrases: [
      'Hello / Bonjour / Hola / Ciao — Hello',
      'Thank you / Merci / Gracias / Grazie — Thank you',
      'How much? / Combien? / Cuánto? / Quanto? — How much?',
      'Excuse me / Excusez-moi / Perdón — Excuse me',
    ],
    paymentNotes: 'Contactless payment is widely accepted. Carry some cash for small vendors and rural areas. ATMs are everywhere. Notify your bank before traveling.',
  },
  'middle-east': {
    tips: [
      'Dress modestly — cover shoulders and knees, especially at religious sites',
      'Carry a scarf or shawl for women when visiting mosques',
      'Alcohol is restricted in some countries — check local laws before purchasing',
      'Water is expensive in some areas — buy in bulk from supermarkets',
      'Many malls and attractions are air-conditioned — plan midday indoor activities',
      'Use Careem or Uber for reliable transport',
    ],
    etiquette: [
      'Use your right hand for giving and receiving',
      'Do not show the soles of your feet to people',
      'Ask permission before photographing locals, especially women',
      'During Ramadan, avoid eating and drinking in public during daytime',
    ],
    hiddenGems: [
      'Visit souks and traditional markets for authentic shopping experiences',
      'Explore old town areas for traditional architecture and local food',
      'Visit during shoulder season for fewer crowds and better prices',
    ],
    languagePhrases: [
      'Marhaba / Salaam — Hello',
      'Shukran — Thank you',
      'Bikam? / Kam? — How much?',
      'Min fadlak — Please',
    ],
    paymentNotes: 'Cards are widely accepted. Cash is useful for souks and small shops. ATMs are readily available.',
  },
  'east-asia': {
    tips: [
      'Get a rechargeable transport IC card — it works on trains, buses and convenience stores',
      'Carry cash — many small restaurants and shops are cash-only',
      'Learn to use chopsticks — many local places do not provide forks',
      'Convenience stores are your best friend — they have everything from meals to ATMs',
      'Book popular restaurants in advance — walk-in waits can be very long',
    ],
    etiquette: [
      'Bow slightly when greeting in Japan and Korea',
      'Do not tip — it can be considered rude in Japan and Korea',
      'Remove shoes when entering homes and some restaurants',
      'Queue patiently — cutting in line is considered very rude',
    ],
    hiddenGems: [
      'Explore local morning markets for fresh food and local culture',
      'Visit temples and shrines at opening time for a peaceful experience',
      'Walk through alleyways and backstreets for hidden local gems',
    ],
    languagePhrases: [
      'Konnichiwa / Annyeonghaseyo — Hello',
      'Arigatou / Gamsahamnida — Thank you',
      'Ikura desu ka? / Eolmaeyo? — How much?',
      'Sumimasen / Joesonghamnida — Excuse me / Sorry',
    ],
    paymentNotes: 'Japan is still cash-heavy — carry yen. Korea and China use mobile payments widely. Suica/Pasmo cards in Japan work on trains and in convenience stores.',
  },
  americas: {
    tips: [
      'Tipping is expected — 15-20% at restaurants, $1-2 per drink at bars',
      'Sales tax is not included in displayed prices — budget 8-10% extra',
      'Tap water is safe in most cities — carry a reusable bottle',
      'Public transport varies widely by city — research before you go',
      'Keep your belongings close — pickpocketing happens in tourist areas',
    ],
    etiquette: [
      'Stand on the right side of escalators',
      'Tip service workers — many earn below minimum wage without tips',
      'Do not jaywalk in big cities — wait for the walk signal',
    ],
    hiddenGems: [
      'Visit local neighborhoods outside the tourist zone for authentic food',
      'Free walking tours are available in most major cities',
      'Check for free museum days and city events',
    ],
    languagePhrases: [
      'Hello — Hello',
      'Thank you — Thank you',
      'How much? — How much?',
      'Excuse me — Excuse me',
    ],
    paymentNotes: 'Cards are accepted almost everywhere. Carry some cash for tips and small vendors. ATMs are widely available.',
  },
  africa: {
    tips: [
      'Carry a photocopy of your passport — keep the original in a safe place',
      'Use bottled water — do not drink tap water',
      'Carry small denomination cash for tips and local purchases',
      'Use registered tour operators for safaris and excursions',
      'Apply sunscreen and wear a hat — the sun can be intense',
    ],
    etiquette: [
      'Greet people warmly — a handshake and smile go a long way',
      'Ask permission before photographing people',
      'Dress modestly when visiting rural areas and cultural sites',
    ],
    hiddenGems: [
      'Visit local markets for authentic crafts and food',
      'Ask locals for restaurant recommendations — they know the best spots',
      'Explore beyond the main tourist attractions for real cultural experiences',
    ],
    languagePhrases: [
      'Jambo / Sawubona — Hello (Swahili/Zulu)',
      'Asante / Ngiyabonga — Thank you',
      'Bei gani? — How much?',
    ],
    paymentNotes: 'Cash is essential in many areas. Cards are accepted in hotels and major restaurants. ATMs are available in cities.',
  },
  general: {
    tips: [
      'Carry a mix of cash and cards — not all places accept cards',
      'Learn a few local phrases — locals appreciate the effort',
      'Keep digital and physical copies of important documents',
      'Use Google Maps offline — download the area before you travel',
      'Check local customs and dress codes before visiting religious sites',
      'Carry a portable charger — you will need it for navigation and photos',
    ],
    etiquette: [
      'Respect local customs and dress codes at religious sites',
      'Ask permission before photographing people',
      'Learn basic greetings in the local language',
      'Be patient and flexible — things may work differently than at home',
    ],
    hiddenGems: [
      'Visit popular attractions early morning or late afternoon to avoid crowds',
      'Walk through residential areas for authentic local experiences',
      'Check for free walking tours led by local volunteers',
      'Ask hotel staff for their personal recommendations — they know the best spots',
    ],
    languagePhrases: [
      'Hello — Hello',
      'Thank you — Thank you',
      'How much does this cost? — How much?',
      'Where is the nearest hospital? — Emergency',
      'Can you help me? — Help',
    ],
    paymentNotes: 'Carry a mix of cash and cards. ATMs are widely available in cities. Notify your bank before traveling abroad.',
  },
};

class LocalGuideAgent {
  constructor() {
    this.name = 'localGuide';
    this._systemPrompt = '';
  }

  get systemPrompt() { return this._systemPrompt; }
  set systemPrompt(v) { this._systemPrompt = v; }

  async run({ destination, travelStyle }) {
    logger.entry('[AGENT:localGuide]', 'run', { destination, travelStyle });
    const region = detectRegion(destination);
    const content = REGION_TIPS[region] || REGION_TIPS.general;

    let paymentNotes = content.paymentNotes;
    if (travelStyle === 'budget' || travelStyle === 'backpacker') {
      paymentNotes = 'Carry mostly cash for local markets and small vendors. Use cards for hotels and restaurants. Negotiate prices at local markets.';
    }
    if (travelStyle === 'luxury') {
      paymentNotes = 'Cards are accepted at most upscale establishments. Keep some cash for tips and small purchases. Concierge services can handle arrangements.';
    }

    logger.exit('[AGENT:localGuide]', 'run', { status: 'success', region, tipsCount: content.tips.length, etiquetteCount: content.etiquette.length });
    return {
      agent: this.name,
      status: 'success',
      data: {
        localTips: content.tips,
        etiquette: content.etiquette,
        hiddenGems: content.hiddenGems,
        languagePhrases: content.languagePhrases,
        paymentNotes,
        region,
        note: `Tips customized for ${region} region (detected from "${destination}")`,
      },
      message: `Local guide tips for ${region} region (${destination})`,
      latencyMs: 0,
      usedAI: false,
      source: 'deterministic',
    };
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

export default new LocalGuideAgent();
