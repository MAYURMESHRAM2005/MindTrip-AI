# TravelMind AI ✈️

**AI-Powered Smart Travel Assistant & Planner using Multi-Agent LLM Architecture and Budget Optimizer**

A production-grade full-stack MERN application where **17 specialized AI agents** (Gemini) plan day-by-day itineraries from **real provider data** — and honestly say **"Live data unavailable"** when a provider is not configured. Nothing is ever fabricated.

```
root/
├── frontend/   → React + Vite + Tailwind (JavaScript only)
├── backend/    → Node + Express + MongoDB + Multi-Agent Gemini (JavaScript only)
├── README.md
└── .gitignore
```

---

## ⚡ Highlights

- **Real authentication** — JWT access tokens (memory) + rotating refresh tokens (httpOnly cookies), bcrypt password hashing, email verification, forgot/reset password, Google OAuth, RBAC (`user` / `admin`).
- **Multi-Agent LLM architecture** — Orchestrator, User Preference, Destination, Budget, Flight, Train, Bus, Hotel, Restaurant, Attraction, Weather, Traffic, Local Guide, Safety, Expense, Translation, Final Validator. External-data agents fetch **real data first** (Amadeus, Google Places/Maps, OpenWeatherMap) and Gemini only *reasons* over it.
- **Deterministic Budget Optimizer** — allocation and optimization are plain arithmetic (tested), not LLM guesswork. Drops low-priority items and reduces flexible costs when over budget, showing original vs optimized vs saved.
- **Final Validator Agent** — verifies budget ≤ limit, date consistency, time overlaps, hotel/transport/restaurant fit, and that estimates/live data are correctly labelled.
- **Everything else** — interactive Leaflet maps with traffic-aware routes, hotels, flights, trains, buses, restaurants, weather, contextual chatbot that really edits your trip, voice assistant, image search, expense tracker with charts, PWA offline itinerary, emergency center, QR ticket wallet, PDF itinerary, multi-language (en/hi/mr), and a full admin dashboard.

---

## 🧠 Multi-Agent Architecture

```
User Request
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│ Orchestrator Agent ── coordinates the whole pipeline     │
├─────────────────────────────────────────────────────────┤
│ User Preference Agent ── normalizes profile + request    │
│ Destination Agent ── chooses / validates destination     │
├─────────────────────────────────────────────────────────┤
│  EXTERNAL-DATA AGENTS (real providers FIRST)             │
│  Flight → Amadeus        Hotel → Amadeus                 │
│  Train/Bus → configured API   Weather → OpenWeatherMap   │
│  Restaurant/Attraction → Google Places   Traffic → Maps  │
├─────────────────────────────────────────────────────────┤
│ Budget Agent (deterministic math + AI reasoning)         │
│ Itinerary Builder (deterministic day-by-day schedule)    │
│ Local Guide · Safety · Expense · Translation Agents      │
├─────────────────────────────────────────────────────────┤
│ Final Validator Agent ── checklist verification          │
└─────────────────────────────────────────────────────────┘
   │
   ▼
Validated Trip + Itinerary (persisted in MongoDB)
```

**Golden rules enforced in code and prompts:**
1. Real data first, AI second.
2. Gemini never invents prices, schedules, ratings or availability.
3. Missing data → `dataStatus: "unavailable"` → UI shows **"Live data unavailable"**.
4. Estimated costs are always flagged `isEstimate: true`.

---

## 🛠 Technology Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 18, Vite 5, Tailwind CSS 3, React Router 6, TanStack React Query, Zustand, Axios, Framer Motion, Recharts, Lucide, React Hook Form + Zod, Leaflet, qrcode.react, Vitest |
| Backend | Node 18+, Express, Mongoose, JWT, bcryptjs, cookie-parser, helmet, cors, express-rate-limit, compression, morgan, Joi, multer, nodemailer, pdfkit, @google/generative-ai, node:test + supertest |
| Database | MongoDB (local or Atlas) |
| AI | Google Gemini **3.5 Flash** (`gemini-3.5-flash` default, configurable via `GEMINI_MODEL`) |
| APIs | Amadeus (flights/hotels), Google Places & Maps, OpenWeatherMap, open.er-api.com (FX), configurable train/bus endpoints |

---

## 📋 Prerequisites

- Node.js **≥ 18** and npm
- MongoDB (local `mongod` or Atlas cluster) — *or* let the integration tests spin up `mongodb-memory-server`
- Optional API keys (the app degrades gracefully without them):
  - **Google AI Studio** → `GEMINI_API_KEY` (required for AI features)
  - **Google Cloud Console** → `GOOGLE_MAPS_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`
  - **OpenWeatherMap** → `OPENWEATHER_API_KEY`
  - **Amadeus for Developers** → `AMADEUS_CLIENT_ID/SECRET`

---

## 🚀 Installation

> Dependencies install **separately** — `node_modules` lives only inside `backend/` and `frontend/`, never in the root folder.

```bash
# 1. Install everything (backend + frontend separately)
npm run install:all

# 2. Configure environment
cp backend/.env.example backend/.env      # then edit with your keys
cp frontend/.env.example frontend/.env    # (optional - Vite proxies /api by default)

# 3. Run both servers in two terminals
npm run dev:backend    # API on http://localhost:5000
npm run dev:frontend   # UI on http://localhost:5173
```

Or manually:

```bash
cd backend  && npm install && npm run dev    # API on http://localhost:5000
cd frontend && npm install && npm run dev    # UI on http://localhost:5173
```

Production build:

```bash
npm run build            # builds frontend to frontend/dist
npm start                # runs the backend (serve frontend/dist with any static host)
```

---

## 🔐 Environment Variables

### backend/.env (key ones)
| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Signing secrets (min 32 chars) |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GOOGLE_MAPS_API_KEY` | Places, Geocoding, Directions, Distance Matrix |
| `OPENWEATHER_API_KEY` | Weather |
| `AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET` | Flights & hotels |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `TRAIN_API_URL` / `TRAIN_API_KEY` | Optional configured train provider |
| `BUS_API_URL` / `BUS_API_KEY` | Optional configured bus provider |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Verification/reset emails |
| `FRONTEND_URL` | CORS whitelist + email links |

**Never commit `.env`.** Frontend secrets are never used — all secret calls go through the backend.

---

## 🗄 MongoDB Setup

```bash
# Local
mongod --dbpath ./data/db
# or Atlas: create a cluster, copy the SRV string into MONGODB_URI
```

Models: `User`, `RefreshToken`, `UserPreference`, `Trip`, `Itinerary`, `ItineraryDay` (embedded), `Expense`, `SavedPlace`, `Notification`, `Ticket`, `AIConversation`, `EmergencyContact`, `AiUsageLog` — all with validation, timestamps and indexes.

---

## 🔌 Provider Setup Guides

| Provider | Where | Docs |
| --- | --- | --- |
| Gemini | [Google AI Studio](https://aistudio.google.com/app/apikey) | [Generative AI docs](https://ai.google.dev/gemini-api/docs) |
| Google Maps/Places | [Google Cloud Console](https://console.cloud.google.com) → enable *Maps JavaScript, Geocoding, Directions, Places* APIs | [Maps Platform](https://developers.google.com/maps/documentation) |
| OpenWeatherMap | [openweathermap.org](https://home.openweathermap.org/api_keys) | [Weather API](https://openweathermap.org/api) |
| Amadeus | [Amadeus for Developers](https://developers.amadeus.com) — free test credentials | [Flight Offers](https://developers.amadeus.com/self-service/category/flights) |
| Google OAuth | [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) | [OAuth 2.0](https://developers.google.com/identity/protocols/oauth2) |
| Trains/Buses | Any compliant provider — the app calls `${URL}/search` with `{from,to,date,passengers}` | see `backend/src/providers/train.provider.js` |

> Without keys the app still works: every feature shows real live data when available and an honest **"Live data unavailable"** notice (with external booking links) otherwise. Admin → Providers shows exactly what is configured.

---

## 🧪 Testing

```bash
# Backend unit + integration tests (node:test)
cd backend && npm test

# Frontend unit + component tests (Vitest)
cd frontend && npm test
```

Covered: deterministic budget calculations (allocation sums, style splits, drop/reduce optimization), itinerary builder (day structure, live vs estimate labelling), Final Validator (overlaps, budget overflow, clean passes), health/404/validation routes, and a full register→trip-generate→optimize→logout flow (auto-skips when `mongodb-memory-server` isn't installed).

---

## 🏗 Project Structure

```
backend/src/
├── config/        env, db
├── controllers/   HTTP handlers (no business logic)
├── routes/        Express routers + Joi validation
├── services/      auth, gemini, budget (deterministic), itinerary, chat, pdf, email, translate…
├── agents/        17 agent modules (provider-first, AI-second)
├── orchestrator/  tripOrchestrator.js — the pipeline
├── providers/     flight, train, bus, hotel, places, weather, maps, currency (abstraction layer)
├── models/        Mongoose models
├── middleware/    auth, RBAC, rate limit, validation, error handling, upload
├── validators/    Joi schemas
├── prompts/       agent system prompts
├── jobs/          periodic cleanup
└── app.js, server.js

frontend/src/
├── components/    ui kit + layout (Sidebar, Topbar) + feature components
├── pages/         29 pages (auth, dashboard, planner, itinerary, budget, transport…)
├── services/      axios instance + typed API client
├── store/         zustand (auth, theme)
├── hooks/         useSpeech, useOnline, useTripId…
├── utils/         format, i18n (en/hi/mr), geo
├── constants/     nav, agents, options
└── router/        protected routes
```

---

## 🔒 Security Notes

- Helmet secure headers, CORS whitelist from `FRONTEND_URL`
- Rate limiting (general, auth brute-force, AI endpoints)
- Access token in memory only; refresh tokens hashed at rest + rotated on every use
- httpOnly cookies (`secure` in production), input validation (Joi) + sanitization, MongoDB operator stripping
- Central error handler — no stack traces leaked in production
- Password hashing with bcrypt (12 rounds); admin APIs behind `requireRole('admin')`

---

## 🧭 Troubleshooting

| Problem | Fix |
| --- | --- |
| `MongoDB connection failed` | Start `mongod` or fix `MONGODB_URI` |
| `Gemini AI is not configured` | Add `GEMINI_API_KEY` and restart backend |
| CORS errors | Set `FRONTEND_URL` to the exact origin (`http://localhost:5173`) |
| 401 on protected pages | Clear cookies / re-login; check clock skew |
| Login says invalid credentials | Emails are lowercased; ensure you registered first |
| “Live data unavailable” everywhere | Configure the matching provider key (see Admin → Providers) |
| Verification email not arriving | Configure SMTP; dev mode logs the link to the console |

---

## 📦 Deployment

1. Set `NODE_ENV=production`, `COOKIE_SECURE=true`, real secrets, Atlas URI.
2. `npm run build` → serve `frontend/dist` (Vercel/Netlify/Nginx) with `/api` proxied to the backend.
3. Backend: `npm start` (any Node host; add `logs/` to your deployment).
4. Register a user — the first user is `user`; promote to `admin` via Mongo (`db.users.updateOne({email:"you"},{$set:{role:"admin"}})`) or an admin seed script.

Happy travels! ✈️
