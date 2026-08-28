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
import { useI18n } from '../utils/i18n';

const STEPS = [
  { key: 'where', titleKey: 'Where & when', icon: MapPin },
  { key: 'travelersBudget', titleKey: 'Travelers & Budget', icon: Users },
  { key: 'style', titleKey: 'Travel style', icon: Compass },
  { key: 'preferences', titleKey: 'Preferences', icon: UtensilsCrossed },
  { key: 'generate', titleKey: 'Generate', icon: Sparkles },
];

const initialForm = {
  origin: '',
  destination: '',
  suggestDestination: false,
  startDate: '',
  endDate: '',
  numTravelers: 1,
  travelerType: 'solo',
  totalBudget: 50000,
  currency: 'INR',
  accommodationType: 'budget',
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
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(formFromQuery);
  const [generating, setGenerating] = useState(false);
  const [pipelineDone, setPipelineDone] = useState(false);
  const navigate = useNavigate();

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const validateStep = () => {
    if (step === 0) {
      if (!form.destination && !form.suggestDestination) return t('Enter a destination or choose "Suggest destination"');
      if (!form.startDate || !form.endDate) return t('Pick departure and return dates');
      if (new Date(form.endDate) < new Date(form.startDate)) return t('Return date must be after departure date');
    }
    if (step === 1 && (!form.totalBudget || form.totalBudget <= 0)) return t('Enter a total budget');
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
    const startTime = Date.now();
    console.log('[TRIP_PLANNER] Generating trip:', { destination: form.destination, origin: form.origin, startDate: form.startDate, endDate: form.endDate, totalBudget: form.totalBudget, travelStyle: form.travelStyle });
    try {
      const { data } = await tripApi.generate({
        ...form,
        adults: form.numTravelers,
        children: 0,
        title: form.title || undefined,
        // ISO dates for the backend validator
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
      });
      console.log(`[TRIP_PLANNER] Trip generated successfully in ${Date.now() - startTime}ms, tripId: ${data.data.trip._id}`);
      toast.success(t('Trip planned by the agents! 🎉'));
      navigate(`/itinerary/${data.data.trip._id}`);
    } catch (e) {
      console.error(`[TRIP_PLANNER] Trip generation failed after ${Date.now() - startTime}ms:`, e.message);
      toast.error(errorMessage(e, t('Trip generation failed')));
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
      <PageHeader icon={Compass} title={t('Trip Planner')} subtitle={t('A multi-step form that feeds the multi-agent pipeline.')} />

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
              <span className="hidden sm:inline">{t(s.titleKey)}</span>
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
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">{t('Where are you going?')}</h2>
                <PlaceAutocomplete label={t('Starting city')} placeholder="Mumbai" value={form.origin} onChange={(v) => set({ origin: v })} />
                <Field label={t('Destination')} hint={form.suggestDestination ? t('The Destination Agent will suggest one') : ''}>
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
                      <Wand2 className="h-4 w-4" /> {t('Suggest destination')}
                    </button>
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label={t('Departure date')} type="date" min={todayISO()} value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
                  <Input label={t('Return date')} type="date" min={form.startDate || todayISO()} value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
                </div>
                <Input label={t('Trip title (optional)')} placeholder="Goa Summer Getaway" value={form.title} onChange={(e) => set({ title: e.target.value })} />
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">{t('Travelers & Budget')}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label={t('Number of travelers')} type="number" min={1} max={50} value={form.numTravelers} onChange={(e) => set({ numTravelers: Number(e.target.value) || 1 })} />
                  <Select
                    label={t('Traveler type')}
                    value={form.travelerType}
                    onChange={(e) => set({ travelerType: e.target.value })}
                    options={['solo', 'couple', 'family', 'friends', 'business']}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label={t('Total budget (INR)')} type="number" min={0} value={form.totalBudget} onChange={(e) => set({ totalBudget: Number(e.target.value) })} />
                  <Select
                    label={t('Accommodation type')}
                    value={form.accommodationType}
                    onChange={(e) => set({ accommodationType: e.target.value })}
                    options={['budget', 'standard', 'luxury', 'hostel', 'boutique', 'resort', 'homestay']}
                  />
                </div>
                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                  💡 {t('The Budget Agent allocates this across transport, hotels, food, activities and an emergency reserve — and finds cheaper alternatives if your plan goes over.')}
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">{t('Choose your travel style')}</h2>
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
                <Field label={t('Interests (pick any)')}>
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

            {step === 3 && (
              <div className="space-y-5">
                <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">{t('Preferences')}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label={t('Food preference')}
                    value={form.foodPreference}
                    onChange={(e) => set({ foodPreference: e.target.value })}
                    options={['', 'vegetarian', 'non-vegetarian', 'any']}
                  />
                  <Select
                    label={t('Hotel preference')}
                    value={form.hotelPreference}
                    onChange={(e) => set({ hotelPreference: e.target.value })}
                    options={['', 'budget', 'boutique', 'luxury', 'hostel', 'resort', 'business']}
                  />
                  <Select
                    label={t('Transport preference')}
                    value={form.transportPreference}
                    onChange={(e) => set({ transportPreference: e.target.value })}
                    options={['', 'flight', 'train', 'bus', 'car', 'public', 'drive']}
                  />
                  <Field label={t('Accessibility requirements')}>
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

            {step === 4 && (
              <div className="space-y-6">
                <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-900 p-6 text-white">
                  <h2 className="text-lg font-extrabold">{t('Ready to generate')} 🚀</h2>
                  <p className="mt-1 text-sm text-brand-100">
                    {form.destination || t('A suggested destination')} · {form.startDate} → {form.endDate} · {form.numTravelers} {t('traveler(s)')}
                    · {form.travelerType} · ₹{Number(form.totalBudget).toLocaleString()} · {form.accommodationType}
                  </p>
                </div>
                <Button onClick={generate} loading={generating} className="w-full py-3.5 text-base">
                  <Sparkles className="h-5 w-5" /> {t('Run the agent pipeline')}
                </Button>
              </div>
            )}

            {step < 4 && (
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                  <ArrowLeft className="h-4 w-4" /> {t('Back')}
                </Button>
                <Button onClick={next}>
                  {t('Continue')} <ArrowRight className="h-4 w-4" />
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
