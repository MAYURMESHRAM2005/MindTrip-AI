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

- **Real authentication** — JWT access tokens (memory) + rotating refresh tokens (httpOnly cookies), bcrypt password hashing, email verification, forgot/reset password, Google sign-in via Firebase Authentication, RBAC (`user` / `admin`).
- **Multi-Agent LLM architecture** — Orchestrator, User Preference, Destination, Budget, Flight, Train, Bus, Hotel, Restaurant, Attraction, Weather, Traffic, Local Guide, Safety, Expense, Translation, Final Validator. External-data agents fetch **real data first** (AviationStack, Amadeus, Geoapify Places, OpenWeatherMap) and Gemini only *reasons* over it.
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
│  Flight → AviationStack Hotel → Amadeus                 │
│  Train/Bus → configured API   Weather → OpenWeatherMap   │
│  Restaurant/Attraction → Geoapify Places   Traffic → Geoapify │
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
| APIs | AviationStack (flights), Amadeus (hotels), Geoapify (geocoding, routing, places), OpenWeatherMap, open.er-api.com (FX), configurable train/bus endpoints |

---

## 📋 Prerequisites

- Node.js **≥ 18** and npm
- MongoDB (local `mongod` or Atlas cluster) — *or* let the integration tests spin up `mongodb-memory-server`
- Optional API keys (the app degrades gracefully without them):
  - **Google AI Studio** → `GEMINI_API_KEY` (required for AI features)
  - **Geoapify** → `GEOAPIFY_API_KEY` (backend only — the frontend never holds keys)
  - **OpenWeatherMap** → `OPENWEATHER_API_KEY`
  - **AviationStack** → `AVIATIONSTACK_API_KEY` (flights)  •  **Amadeus for Developers** → `AMADEUS_CLIENT_ID/SECRET` (hotels)

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
| `GEOAPIFY_API_KEY` | Geocoding, Routing, Places (server-side agents & endpoints) |
| `OPENWEATHER_API_KEY` | Weather (server-side proxy) |
| `AVIATIONSTACK_API_KEY` | Flights (free tier at aviationstack.com) |
| `AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET` | Hotels |
| `FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT` | Firebase Authentication (Google sign-in) — backend |
| `TRAIN_API_URL` / `TRAIN_API_KEY` / `TRAIN_API_ENDPOINT` | Optional configured train provider — `https://` is auto-added; RapidAPI hosts use `x-rapidapi-key`; `TRAIN_API_ENDPOINT` (default `/search`) is the search path |
| `BUS_API_URL` / `BUS_API_KEY` / `BUS_API_ENDPOINT` | Optional configured bus provider (same rules as trains) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Verification/reset emails |
| `FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT` | Google sign-in (Firebase Auth) — see Provider Setup below |
| `FRONTEND_URL` | CORS whitelist + email links |

**Never commit `.env`.** All API keys live **only in `backend/.env`** (`GEOAPIFY_API_KEY`, `OPENWEATHER_API_KEY`, `AVIATIONSTACK_API_KEY`, `AMADEUS_*`, etc.). The frontend never holds keys and never calls external APIs directly — every request goes through the backend, which proxies Geoapify, OpenWeatherMap and future providers via `/api/geocode`, `/api/routes`, `/api/maps`, `/api/weather`, `/api/restaurants`, `/api/hotels`.

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
| Geoapify | [myprojects.geoapify.com](https://myprojects.geoapify.com) → create a key; use a referrer-restricted browser key for the frontend | [Geoapify docs](https://apidocs.geoapify.com) |
| OpenWeatherMap | [openweathermap.org](https://home.openweathermap.org/api_keys) | [Weather API](https://openweathermap.org/api) |
| AviationStack | [aviationstack.com](https://aviationstack.com) — free tier (real-time + airport lookup; schedules on paid plan) | [Flight API docs](https://aviationstack.com/documentation) |
| Amadeus | [Amadeus for Developers](https://developers.amadeus.com) — free test credentials (hotels) | [Hotel Offers](https://developers.amadeus.com/self-service/category/hotels) |
| Firebase Auth | [Firebase Console → Authentication](https://console.firebase.google.com/) — enable Google provider, register a web app, create a service account | [Firebase Auth docs](https://firebase.google.com/docs/auth) |
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
