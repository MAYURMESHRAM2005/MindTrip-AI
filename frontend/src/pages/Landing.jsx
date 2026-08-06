import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plane, Bot, Wallet, Map, CloudSun, MessageSquare, Mic, Image as ImageIcon,
  Shield, Sparkles, ArrowRight, QrCode, WifiOff, Hotel, UtensilsCrossed,
} from 'lucide-react';
import { useThemeStore } from '../store/themeStore';
import { Moon, Sun } from 'lucide-react';
import { APP_NAME } from '../constants';

const FEATURES = [
  { icon: Bot, title: 'Multi-Agent AI Planning', desc: '17 specialized agents coordinate to plan your trip — destination, budget, hotels, transport, food, weather and safety.' },
  { icon: Wallet, title: 'Budget Optimizer', desc: 'Deterministic budget allocation that finds cheaper hotels, public transport and free attractions when you are over budget.' },
  { icon: Map, title: 'Maps & Live Traffic', desc: 'Interactive maps with routes, distance, travel time and traffic-aware directions when the API supports it.' },
  { icon: CloudSun, title: 'Live Weather', desc: 'Real forecasts from OpenWeatherMap woven into your daily itinerary, with rain-day backups.' },
  { icon: MessageSquare, title: 'Contextual Chatbot', desc: '“Make my trip ₹5,000 cheaper” — the bot really updates your itinerary and budget.' },
  { icon: Mic, title: 'Voice Assistant', desc: '“Plan a 5-day Goa trip under ₹25,000” — speak your trip into existence.' },
  { icon: ImageIcon, title: 'Image Search', desc: 'Upload a photo of a landmark; Gemini identifies it and Geoapify Places finds real information.' },
  { icon: QrCode, title: 'QR Ticket Wallet', desc: 'Store your own bookings with QR codes generated from your references — never fabricated.' },
  { icon: WifiOff, title: 'Offline Itinerary', desc: 'PWA + service worker keep your itinerary, hotel and emergency info available offline.' },
  { icon: Hotel, title: 'Real Hotels & Flights', desc: 'Amadeus offers and Geoapify Places data when configured — and honest “Live data unavailable” otherwise.' },
  { icon: UtensilsCrossed, title: 'Restaurant Matching', desc: 'Vegetarian, vegan or non-veg — restaurants matched to your food preference from real data.' },
  { icon: Shield, title: 'Secure by Design', desc: 'JWT + rotating refresh tokens, httpOnly cookies, rate limiting, input validation and RBAC.' },
];

export default function Landing() {
  const { theme, toggle } = useThemeStore();

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/70 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
              <Plane className="h-5 w-5" />
            </div>
            <span className="text-base font-extrabold text-slate-900 dark:text-white">{APP_NAME}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggle} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <Link to="/login" className="btn-ghost">
              Login
            </Link>
            <Link to="/register" className="btn-primary">
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="gradient-hero relative overflow-hidden">
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-300/30 blur-3xl dark:bg-brand-600/20" />
        <div className="pointer-events-none absolute -left-32 bottom-0 h-96 w-96 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-800/20" />
        <div className="mx-auto max-w-7xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/70 px-4 py-1.5 text-xs font-bold text-brand-700 dark:border-brand-800 dark:bg-slate-900/70 dark:text-brand-300">
              <Sparkles className="h-3.5 w-3.5" /> Multi-Agent LLM Architecture · Real Data · Real Auth
            </span>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-6xl">
              Plan smarter trips with <span className="text-gradient">17 AI agents</span> working for you
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-slate-600 dark:text-slate-300 sm:text-lg">
              {APP_NAME} plans day-by-day itineraries, optimizes your budget with deterministic math,
              pulls live flights, hotels, weather, maps and restaurants — and never invents data it cannot get.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link to="/register" className="btn-primary px-6 py-3 text-base">
                Start planning free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/login" className="btn-secondary px-6 py-3 text-base">
                I already have an account
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-400">No credit card · JWT + refresh-token auth · MongoDB persistence</p>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white sm:text-3xl">Everything a traveler needs</h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400">One assistant. Real integrations. Honest data.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04 }}
              whileHover={{ y: -4 }}
              className="card p-6"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-900 p-10 text-center text-white shadow-card">
          <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <h2 className="text-2xl font-extrabold sm:text-3xl">Your next trip, planned by AI</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-brand-100">
            Create an account, set a budget, and watch the agent pipeline build your day-by-day plan.
          </p>
          <Link to="/register" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand-700 hover:bg-brand-50">
            Create free account <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400 dark:border-slate-800">
        © {new Date().getFullYear()} {APP_NAME} — MERN + Multi-Agent Gemini. Data from configured providers only.
      </footer>
    </div>
  );
}
