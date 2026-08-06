export const APP_NAME = 'TravelMind AI';

export const TRAVEL_STYLES = [
  { value: 'budget', label: 'Budget' },
  { value: 'backpacker', label: 'Backpacker' },
  { value: 'standard', label: 'Standard' },
  { value: 'luxury', label: 'Luxury' },
  { value: 'family', label: 'Family' },
  { value: 'business', label: 'Business' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'romantic', label: 'Romantic' },
];

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD'];

export const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
];

export const EXPENSE_CATEGORIES = [
  { value: 'food', label: 'Food' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'transport', label: 'Transport' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'activities', label: 'Activities' },
  { value: 'other', label: 'Other' },
];

export const TICKET_CATEGORIES = ['flight', 'train', 'bus', 'hotel', 'attraction'];

export const INTERESTS = [
  'Beaches', 'Mountains', 'Heritage', 'Food', 'Adventure', 'Shopping',
  'Nightlife', 'Temples', 'Nature', 'Wildlife', 'Art', 'Spiritual', 'Photography', 'Festivals',
];

export const AGENTS = [
  { key: 'orchestrator', name: 'Orchestrator', role: 'Coordinates all agents', color: 'from-violet-500 to-purple-600' },
  { key: 'userPreference', name: 'User Preference', role: 'Learns your travel style', color: 'from-sky-500 to-blue-600' },
  { key: 'destination', name: 'Destination', role: 'Chooses your destination', color: 'from-emerald-500 to-teal-600' },
  { key: 'budget', name: 'Budget', role: 'Allocates and optimizes money', color: 'from-amber-500 to-orange-600' },
  { key: 'flight', name: 'Flight', role: 'Finds real flight offers', color: 'from-rose-500 to-red-600' },
  { key: 'train', name: 'Train', role: 'Finds real train schedules', color: 'from-cyan-500 to-sky-600' },
  { key: 'bus', name: 'Bus', role: 'Finds real bus schedules', color: 'from-lime-500 to-green-600' },
  { key: 'hotel', name: 'Hotel', role: 'Finds real accommodation', color: 'from-indigo-500 to-blue-700' },
  { key: 'restaurant', name: 'Restaurant', role: 'Matches food preferences', color: 'from-fuchsia-500 to-pink-600' },
  { key: 'attraction', name: 'Attraction', role: 'Builds the sightseeing list', color: 'from-teal-500 to-emerald-600' },
  { key: 'weather', name: 'Weather', role: 'Live forecasts & planning', color: 'from-blue-400 to-indigo-600' },
  { key: 'traffic', name: 'Traffic', role: 'Realistic travel times', color: 'from-yellow-500 to-amber-600' },
  { key: 'localGuide', name: 'Local Guide', role: 'Culture & local tips', color: 'from-orange-500 to-red-500' },
  { key: 'safety', name: 'Safety', role: 'Safety & health guidance', color: 'from-slate-600 to-slate-800' },
  { key: 'expense', name: 'Expense', role: 'Tracks & analyzes spending', color: 'from-green-500 to-emerald-700' },
  { key: 'translation', name: 'Translation', role: 'Multilingual support', color: 'from-pink-500 to-rose-600' },
  { key: 'finalValidator', name: 'Final Validator', role: 'Verifies the whole plan', color: 'from-purple-600 to-violet-800' },
];

export const SIDEBAR_NAV = [
  { section: 'Main', items: [
    { to: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { to: '/agents', label: 'AI Agents', icon: 'Bot' },
    { to: '/planner', label: 'Trip Planner', icon: 'Compass' },
    { to: '/itinerary', label: 'AI Itinerary', icon: 'CalendarDays' },
    { to: '/budget', label: 'Budget Optimizer', icon: 'Wallet' },
  ]},
  { section: 'Explore', items: [
    { to: '/flights', label: 'Flights', icon: 'Plane' },
    { to: '/trains', label: 'Trains', icon: 'TrainFront' },
    { to: '/buses', label: 'Buses', icon: 'Bus' },
    { to: '/hotels', label: 'Hotels', icon: 'Hotel' },
    { to: '/restaurants', label: 'Restaurants', icon: 'UtensilsCrossed' },
    { to: '/maps', label: 'Maps & Traffic', icon: 'Map' },
    { to: '/weather', label: 'Weather', icon: 'CloudSun' },
  ]},
  { section: 'AI Tools', items: [
    { to: '/voice', label: 'Voice Assistant', icon: 'Mic' },
    { to: '/image-search', label: 'Image Search', icon: 'Image' },
    { to: '/chat', label: 'AI Chatbot', icon: 'MessageSquare' },
  ]},
  { section: 'Manage', items: [
    { to: '/expenses', label: 'Expenses', icon: 'Receipt' },
    { to: '/offline', label: 'Offline Itinerary', icon: 'WifiOff' },
    { to: '/emergency', label: 'Emergency', icon: 'Siren' },
    { to: '/qr-wallet', label: 'QR Tickets', icon: 'QrCode' },
    { to: '/saved-trips', label: 'Saved Trips', icon: 'Bookmark' },
    { to: '/notifications', label: 'Notifications', icon: 'Bell' },
  ]},
  { section: 'Account', items: [
    { to: '/profile', label: 'Profile', icon: 'User' },
    { to: '/settings', label: 'Settings', icon: 'Settings' },
    ...(true ? [{ to: '/admin', label: 'Admin', icon: 'Shield' }] : []),
  ]},
];
