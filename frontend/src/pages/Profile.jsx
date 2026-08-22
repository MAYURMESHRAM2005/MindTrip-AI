import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Save, CheckCircle2 } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Input, Select } from '../components/ui/Input';
import Button from '../components/ui/Button';
import { userApi } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';
import { useI18n } from '../utils/i18n';
import { TRAVEL_STYLES, CURRENCIES, LANGUAGES, INTERESTS } from '../constants';
import toast from 'react-hot-toast';
import { errorMessage } from '../services/api';
import { cn } from '../utils/format';

export default function Profile() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { t, setLang } = useI18n();
  const queryClient = useQueryClient();

  const { data: prefsData } = useQuery({
    queryKey: ['preferences'],
    queryFn: () => userApi.preferences().then((r) => r.data.data),
  });
  const prefs = prefsData?.preferences;

  const [form, setForm] = useState({
    name: user?.name || '',
    homeLocation: user?.homeLocation || '',
    preferredCurrency: user?.preferredCurrency || prefs?.currency || 'INR',
    language: user?.language || prefs?.language || 'en',
    travelStyle: user?.travelStyle || prefs?.travelStyle || 'standard',
    foodPreference: user?.foodPreference || prefs?.foodPreference || '',
    hotelPreference: user?.hotelPreference || prefs?.hotelPreference || '',
    transportPreference: user?.transportPreference || prefs?.transportPreference || '',
    interests: user?.interests?.length ? user.interests : prefs?.interests || [],
  });

  const save = useMutation({
    mutationFn: (payload) => userApi.update(payload),
    onSuccess: ({ data }) => {
      setUser(data.data.user);
      setLang(data.data.user.language || 'en');
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
      toast.success(t('Profile updated'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggleInterest = (i) => {
    setForm((f) => ({
      ...f,
      interests: f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i],
    }));
  };

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader icon={User} title={t('Profile & Travel Preferences')} subtitle={t('These preferences shape every AI trip recommendation.')} />

      <div className="card mb-5 flex items-center gap-4 p-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-2xl font-extrabold text-white">
          {user?.profileImage ? <img src={user.profileImage} alt="" className="h-16 w-16 rounded-2xl object-cover" /> : user?.name?.[0]?.toUpperCase()}
        </div>
        <div>
          <p className="text-lg font-extrabold text-slate-900 dark:text-white">{user?.name}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" /> {user?.emailVerified ? t('Email verified') : t('Email not verified')}
          </p>
        </div>
      </div>

      <div className="card space-y-5 p-6">
        <div>
          <h3 className="mb-3 text-sm font-extrabold text-slate-900 dark:text-white">{t('Basics')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('Full name')} {...field('name')} />
            <Input label={t('Home location')} placeholder="Mumbai, India" {...field('homeLocation')} />
            <Select label={t('Preferred currency')} options={CURRENCIES} {...field('preferredCurrency')} />
            <Select
              label={t('Language')}
              options={LANGUAGES.map((l) => ({ value: l.code, label: l.native }))}
              {...field('language')}
            />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
          <h3 className="mb-3 text-sm font-extrabold text-slate-900 dark:text-white">{t('Travel preferences')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label={t('Travel style')} options={TRAVEL_STYLES.map((s) => ({ value: s.value, label: s.label }))} {...field('travelStyle')} />
            <Select label={t('Food preference')} options={['', 'vegetarian', 'vegan', 'non-vegetarian', 'jain', 'halal']} {...field('foodPreference')} />
            <Select label={t('Hotel preference')} options={['', 'budget', 'boutique', 'luxury', 'hostel', 'resort', 'business']} {...field('hotelPreference')} />
            <Select label={t('Transport preference')} options={['', 'flight', 'train', 'bus', 'public', 'drive']} {...field('transportPreference')} />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
          <h3 className="mb-3 text-sm font-extrabold text-slate-900 dark:text-white">{t('Interests')}</h3>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((i) => (
              <button
                key={i}
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
        </div>

        <Button loading={save.isPending} icon={Save} onClick={() => save.mutate(form)} className="w-full">
          {t('Save profile')}
        </Button>
      </div>
    </div>
  );
}
