import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  MapPin, CalendarDays, Users, Wallet, Compass, UtensilsCrossed, Hotel, Bus,
  Activity, ArrowLeft, ArrowRight, Sparkles, Wand2,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input, Select, Field } from '../components/ui/Input';
import PlaceAutocomplete from '../components/PlaceAutocomplete';
import Button from '../components/ui/Button';
import AgentPipeline from '../components/AgentPipeline';
import { tripApi } from '../services/apiClient';
import { errorMessage } from '../services/api';
import { TRAVEL_STYLES, CURRENCIES, INTERESTS } from '../constants';
import { cn, todayISO } from '../utils/format';

const STEPS = [
  { key: 'where', title: 'Where & when', icon: MapPin },
  { key: 'travelers', title: 'Travelers', icon: Users },
  { key: 'budget', title: 'Budget', icon: Wallet },
  { key: 'style', title: 'Travel style', icon: Compass },
  { key: 'preferences', title: 'Preferences', icon: UtensilsCrossed },
  { key: 'generate', title: 'Generate', icon: Sparkles },
];

const initialForm = {
  origin: '',
  destination: '',
  suggestDestination: false,
  startDate: '',
  endDate: '',
  adults: 1,
  children: 0,
  totalBudget: 50000,
  currency: 'INR',
  travelStyle: 'standard',
  interests: [],
  foodPreference: '',
  hotelPreference: '',
  transportPreference: '',
  activityLevel: 'moderate',
  accessibility: [],
  title: '',
};

/** Prefill from the topbar global search (?destination=…&from=…). */
function formFromQuery() {
  const sp = new URLSearchParams(window.location.search);
  const destination = sp.get('destination') || '';
  return {
    ...initialForm,
    destination,
    origin: sp.get('from') || initialForm.origin,
    ...(destination ? { suggestDestination: false } : {}),
  };
}

export default function TripPlanner() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(formFromQuery);
  const [generating, setGenerating] = useState(false);
  const [pipelineDone, setPipelineDone] = useState(false);
  const navigate = useNavigate();

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const validateStep = () => {
    if (step === 0) {
      if (!form.destination && !form.suggestDestination) return 'Enter a destination or choose "Suggest destination"';
      if (!form.startDate || !form.endDate) return 'Pick departure and return dates';
      if (new Date(form.endDate) < new Date(form.startDate)) return 'Return date must be after departure date';
    }
    if (step === 2 && (!form.totalBudget || form.totalBudget <= 0)) return 'Enter a total budget';
    return null;
  };

  const next = () => {
    const err = validateStep();
    if (err) return toast.error(err);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const generate = async () => {
    const err = validateStep();
    if (err) return toast.error(err);
    setGenerating(true);
    setPipelineDone(false);
    try {
      const { data } = await tripApi.generate({
        ...form,
        title: form.title || undefined,
        // ISO dates for the backend validator
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
      });
      toast.success('Trip planned by the agents! 🎉');
      navigate(`/itinerary/${data.data.trip._id}`);
    } catch (e) {
      toast.error(errorMessage(e, 'Trip generation failed'));
    } finally {
      setGenerating(false);
      setPipelineDone(true);
    }
  };

  const toggleInterest = (i) => {
    set({
      interests: form.interests.includes(i) ? form.interests.filter((x) => x !== i) : [...form.interests, i],
    });
  };

  return (
    <div>
      <PageHeader icon={Compass} title="Trip Planner" subtitle="A multi-step form that feeds the multi-agent pipeline." />

      {/* Stepper */}
      <div className="mb-8 flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <button
              onClick={() => i < step && setStep(i)}
              className={cn(
                'flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-bold transition-all',
                i === step
                  ? 'bg-brand-600 text-white shadow-card'
                  : i < step
                    ? 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950 dark:text-brand-300'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
              )}
            >
              <s.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{s.title}</span>
              <span className="sm:hidden">{i + 1}</span>
            </button>
            {i < STEPS.length - 1 && <div className="h-px w-4 bg-slate-200 dark:bg-slate-700" />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.25 }}
        >
          <div className="card max-w-3xl p-6 sm:p-8">
            {step === 0 && (
              <div className="space-y-5">
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Where are you going?</h2>
                <PlaceAutocomplete label="Starting city" placeholder="Mumbai" value={form.origin} onChange={(v) => set({ origin: v })} />
                <Field label="Destination" hint={form.suggestDestination ? 'The Destination Agent will suggest one' : ''}>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <PlaceAutocomplete
                      placeholder="Goa / Paris / Tokyo…"
                      value={form.destination}
                      disabled={form.suggestDestination}
                      wrapperClassName="flex-1 min-w-0"
                      onChange={(v) => set({ destination: v })}
                    />
                    <button
                      type="button"
                      onClick={() => set({ suggestDestination: !form.suggestDestination, destination: '' })}
                      className={cn('btn whitespace-nowrap', form.suggestDestination ? 'btn-primary' : 'btn-secondary')}
                    >
                      <Wand2 className="h-4 w-4" /> Suggest destination
                    </button>
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Departure date" type="date" min={todayISO()} value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
                  <Input label="Return date" type="date" min={form.startDate || todayISO()} value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
                </div>
                <Input label="Trip title (optional)" placeholder="Goa Summer Getaway" value={form.title} onChange={(e) => set({ title: e.target.value })} />
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Who's traveling?</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Adults" type="number" min={1} max={20} value={form.adults} onChange={(e) => set({ adults: Number(e.target.value) || 1 })} />
                  <Input label="Children" type="number" min={0} max={20} value={form.children} onChange={(e) => set({ children: Number(e.target.value) || 0 })} />
                </div>
                <Field label="Activity level">
                  <div className="flex gap-2">
                    {['relaxed', 'moderate', 'active'].map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => set({ activityLevel: l })}
                        className={cn('btn capitalize', form.activityLevel === l ? 'btn-primary' : 'btn-secondary')}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">What's your budget?</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Total budget" type="number" min={0} value={form.totalBudget} onChange={(e) => set({ totalBudget: Number(e.target.value) })} />
                  <Select label="Currency" value={form.currency} onChange={(e) => set({ currency: e.target.value })} options={CURRENCIES} />
                </div>
                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                  💡 The Budget Agent allocates this across transport, hotels, food, activities and an emergency reserve —
                  and finds cheaper alternatives if your plan goes over.
                </p>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Choose your travel style</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {TRAVEL_STYLES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => set({ travelStyle: s.value })}
                      className={cn(
                        'rounded-2xl border-2 p-4 text-center transition-all',
                        form.travelStyle === s.value
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/60'
                          : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                      )}
                    >
                      <p className="text-sm font-bold capitalize text-slate-800 dark:text-slate-100">{s.label}</p>
                    </button>
                  ))}
                </div>
                <Field label="Interests (pick any)">
                  <div className="flex flex-wrap gap-2">
                    {INTERESTS.map((i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleInterest(i)}
                        className={cn(
                          'rounded-full border px-3.5 py-1.5 text-xs font-bold transition-all',
                          form.interests.includes(i)
                            ? 'border-brand-500 bg-brand-600 text-white'
                            : 'border-slate-300 text-slate-600 hover:border-brand-400 dark:border-slate-600 dark:text-slate-300'
                        )}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-5">
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Preferences</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Food preference"
                    value={form.foodPreference}
                    onChange={(e) => set({ foodPreference: e.target.value })}
                    options={['', 'vegetarian', 'vegan', 'non-vegetarian', 'jain', 'halal']}
                  />
                  <Select
                    label="Hotel preference"
                    value={form.hotelPreference}
                    onChange={(e) => set({ hotelPreference: e.target.value })}
                    options={['', 'budget', 'boutique', 'luxury', 'hostel', 'resort', 'business']}
                  />
                  <Select
                    label="Transport preference"
                    value={form.transportPreference}
                    onChange={(e) => set({ transportPreference: e.target.value })}
                    options={['', 'flight', 'train', 'bus', 'public', 'drive']}
                  />
                  <Field label="Accessibility requirements">
                    <input
                      className="input"
                      placeholder="e.g. wheelchair access, reduced walking"
                      value={form.accessibility[0] || ''}
                      onChange={(e) => set({ accessibility: e.target.value ? [e.target.value] : [] })}
                    />
                  </Field>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-6">
                <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-900 p-6 text-white">
                  <h2 className="text-lg font-extrabold">Ready to generate 🚀</h2>
                  <p className="mt-1 text-sm text-brand-100">
                    {form.destination || 'A suggested destination'} · {form.startDate} → {form.endDate} · {form.adults} adult(s)
                    · {form.currency} {Number(form.totalBudget).toLocaleString()} · {form.travelStyle}
                  </p>
                </div>
                <Button onClick={generate} loading={generating} className="w-full py-3.5 text-base">
                  <Sparkles className="h-5 w-5" /> Run the agent pipeline
                </Button>
              </div>
            )}

            {step < 5 && (
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button onClick={next}>
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {generating && (
        <div className="mt-6">
          <AgentPipeline running onComplete={() => setPipelineDone(true)} />
        </div>
      )}
    </div>
  );
}
