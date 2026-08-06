import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Lightweight i18n: a dictionary of UI strings for English, Hindi and Marathi.
 * Architecturally simple to extend with more languages (add a key to DICT).
 */
export const DICT = {
  // Nav / chrome
  dashboard: { en: 'Dashboard', hi: 'डैशबोर्ड', mr: 'डॅशबोर्ड' },
  planTrip: { en: 'Plan a Trip', hi: 'यात्रा की योजना', mr: 'सहलीचे नियोजन' },
  budget: { en: 'Budget', hi: 'बजट', mr: 'बजेट' },
  hotels: { en: 'Hotels', hi: 'होटल', mr: 'हॉटेल्स' },
  flights: { en: 'Flights', hi: 'उड़ानें', mr: 'विमाने' },
  trains: { en: 'Trains', hi: 'ट्रेनें', mr: 'गाड्या' },
  buses: { en: 'Buses', hi: 'बसें', mr: 'बसेस' },
  restaurants: { en: 'Restaurants', hi: 'रेस्तरां', mr: 'रेस्टॉरंट्स' },
  weather: { en: 'Weather', hi: 'मौसम', mr: 'हवामान' },
  maps: { en: 'Maps & Traffic', hi: 'मानचित्र और यातायात', mr: 'नकाशे आणि वाहतूक' },
  voice: { en: 'Voice Assistant', hi: 'वॉइस असिस्टेंट', mr: 'व्हॉइस सहाय्यक' },
  chat: { en: 'AI Chatbot', hi: 'एआई चैटबॉट', mr: 'एआई चॅटबॉट' },
  expenses: { en: 'Expenses', hi: 'खर्च', mr: 'खर्च' },
  emergency: { en: 'Emergency', hi: 'आपातकालीन', mr: 'आणीबाणी' },
  profile: { en: 'Profile', hi: 'प्रोफ़ाइल', mr: 'प्रोफाइल' },
  settings: { en: 'Settings', hi: 'सेटिंग्स', mr: 'सेटिंग्ज' },
  logout: { en: 'Logout', hi: 'लॉग आउट', mr: 'लॉगआउट' },
  login: { en: 'Login', hi: 'लॉगिन', mr: 'लॉगिन' },
  register: { en: 'Register', hi: 'पंजीकरण', mr: 'नोंदणी' },
  search: { en: 'Search', hi: 'खोजें', mr: 'शोधा' },
  save: { en: 'Save', hi: 'सहेजें', mr: 'जतन करा' },
  cancel: { en: 'Cancel', hi: 'रद्द करें', mr: 'रद्द करा' },
  delete: { en: 'Delete', hi: 'हटाएं', mr: 'हटवा' },
  loading: { en: 'Loading…', hi: 'लोड हो रहा है…', mr: 'लोड होत आहे…' },
  liveDataUnavailable: { en: 'Live data unavailable', hi: 'लाइव डेटा अनुपलब्ध', mr: 'लाइव्ह डेटा अनुपलब्ध' },
  estimate: { en: 'Estimate', hi: 'अनुमान', mr: 'अंदाज' },
  live: { en: 'Live', hi: 'लाइव', mr: 'लाइव्ह' },
  currency: { en: 'Currency', hi: 'मुद्रा', mr: 'चलन' },
  language: { en: 'Language', hi: 'भाषा', mr: 'भाषा' },
  darkMode: { en: 'Dark mode', hi: 'डार्क मोड', mr: 'डार्क मोड' },
  welcome: { en: 'Welcome back', hi: 'वापसी पर स्वागत है', mr: 'पुन्हा स्वागत आहे' },
  createTrip: { en: 'Create a trip', hi: 'यात्रा बनाएं', mr: 'सहल तयार करा' },
  viewItinerary: { en: 'View itinerary', hi: 'कार्यक्रम देखें', mr: 'कार्यक्रम पहा' },
  optimize: { en: 'Optimize', hi: 'अनुकूलित करें', mr: 'ऑप्टिमाइझ करा' },
  downloadPdf: { en: 'Download PDF', hi: 'पीडीएफ डाउनलोड करें', mr: 'पीडीएफ डाउनलोड करा' },
  offline: { en: 'Offline', hi: 'ऑफ़लाइन', mr: 'ऑफलाइन' },
  online: { en: 'Online', hi: 'ऑनलाइन', mr: 'ऑनलाइन' },
  tryAgain: { en: 'Try again', hi: 'पुनः प्रयास करें', mr: 'पुन्हा प्रयत्न करा' },
  noResults: { en: 'No results found', hi: 'कोई परिणाम नहीं मिला', mr: 'निकाल सापडले नाहीत' },
};

const I18nContext = createContext({ lang: 'en', t: (k) => k, setLang: () => {} });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('travelmind-lang') || 'en');

  const setLang = useCallback((l) => {
    localStorage.setItem('travelmind-lang', l);
    setLangState(l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key) => {
      const entry = DICT[key];
      if (!entry) return key;
      return entry[lang] || entry.en;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export default DICT;
