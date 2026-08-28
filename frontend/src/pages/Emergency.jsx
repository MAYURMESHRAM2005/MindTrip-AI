import React, { useEffect, useState } from 'react';
import { Siren, Hospital, Shield, Pill, Globe, MapPin, Plus, Phone, Trash2, Navigation, RefreshCw } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import ProviderNotice from '../components/ProviderNotice';
import { emergencyApi } from '../services/apiClient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import Button from '../components/ui/Button';
import toast from 'react-hot-toast';
import { errorMessage } from '../services/api';
import { PageLoader } from '../components/ui/Spinner';
import { mapsApi } from '../services/apiClient';
import { useI18n } from '../utils/i18n';

const CATEGORY_META = {
  hospitals: { icon: Hospital, labelKey: 'Hospitals', color: 'text-rose-500 bg-rose-50 dark:bg-rose-950' },
  police: { icon: Shield, labelKey: 'Police', color: 'text-blue-500 bg-blue-50 dark:bg-blue-950' },
  pharmacies: { icon: Pill, labelKey: 'Pharmacies', color: 'text-violet-500 bg-violet-50 dark:bg-violet-950' },
  embassies: { icon: Globe, labelKey: 'Embassies & consulates', color: 'text-teal-500 bg-teal-50 dark:bg-teal-950' },
};

export default function Emergency() {
  const { t } = useI18n();
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(false);
  const [contactModal, setContactModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [form, setForm] = useState({ name: '', relationship: '', phone: '', email: '', isPrimary: false });
  const [manualSearch, setManualSearch] = useState('');
  const queryClient = useQueryClient();

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocError(true);
      return;
    }
    setLocating(true);
    setLocError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocError(true);
      },
      { timeout: 8000 }
    );
  };

  useEffect(() => { requestLocation(); }, []);

  const { data: nearbyData, isLoading: nearbyLoading, refetch: refetchNearby, isRefetching } = useQuery({
    queryKey: ['emergency-nearby', location],
    queryFn: () => emergencyApi.nearby({ lat: location.lat, lng: location.lng }).then((r) => ({ ...r.data.data, _apiMessage: r.data.message })),
    enabled: Boolean(location),
    retry: 1,
    staleTime: 30000,
  });

  const { data: contactsData, isLoading: contactsLoading } = useQuery({
    queryKey: ['emergency-contacts'],
    queryFn: () => emergencyApi.contacts().then((r) => r.data.data),
  });

  const addContact = useMutation({
    mutationFn: (payload) => emergencyApi.addContact(payload),
    onSuccess: () => {
      toast.success(t('Contact saved'));
      setContactModal(false);
      setForm({ name: '', relationship: '', phone: '', email: '', isPrimary: false });
      queryClient.invalidateQueries({ queryKey: ['emergency-contacts'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const deleteContact = useMutation({
    mutationFn: (id) => emergencyApi.deleteContact(id),
    onSuccess: () => {
      setDeleteConfirm(null);
      toast.success(t('Contact deleted'));
      queryClient.invalidateQueries({ queryKey: ['emergency-contacts'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const handleManualSearch = async () => {
    if (!manualSearch.trim()) return;
    try {
      const { data } = await mapsApi.geocode(manualSearch);
      const geo = data?.data?.geocode;
      if (geo?.lat && geo?.lng) {
        setLocation({ lat: geo.lat, lng: geo.lng });
        setLocError(false);
        toast.success(t('Location found'));
      } else {
        toast.error(t('Location not found'));
      }
    } catch {
      toast.error(t('Geocoding failed'));
    }
  };

  const directionsTo = async (name, coords) => {
    if (!coords || !location) return;
    try {
      const { data } = await mapsApi.directions({ origin: `${location.lat},${location.lng}`, destination: `${coords.lat},${coords.lng}`, mode: 'driving' });
      const route = data.data.directions?.routes?.[0];
      toast(
        route
          ? `${name}: ${route.distanceKm} km, ~${route.durationMin} min ${data.data.isLive ? `(${t('live')})` : `(${t('estimate')})`}`
          : `${t('No route available to')} ${name}`,
        { icon: '🧭' }
      );
    } catch {
      toast.error(t('Directions unavailable'));
    }
  };

  if (locating && !location) return <PageLoader label={t('Finding your location…')} />;

  return (
    <div>
      <PageHeader icon={Siren} title={t('Emergency Center')} subtitle={t('Nearby hospitals, police, pharmacies and embassies from live data.')} />

      {/* Universal emergency number - factual global reference, clearly not fabricated per-country numbers */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-800 to-slate-900 p-5 text-white dark:border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold">{t('In an emergency, call your local emergency number')}</p>
            <p className="mt-0.5 text-xs text-slate-300">
              {t("112 works in many countries (EU, India, UK and others). Check the local country's official emergency numbers — we never fabricate them.")}
            </p>
          </div>
          <a href="tel:112" className="btn bg-white text-slate-900 hover:bg-slate-100">📞 {t('Call 112')}</a>
        </div>
      </div>

      {/* Location unavailable notice with manual search */}
      {!location && locError && (
        <div className="mb-6">
          <ProviderNotice
            title={t('Location unavailable')}
            message={t('Allow location access to see nearby emergency services. You can also search below.')}
          />
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder={t('Search city or address…')}
              value={manualSearch}
              onChange={(e) => setManualSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
              className="input flex-1"
            />
            <Button size="sm" icon={Navigation} onClick={handleManualSearch}>{t('Search')}</Button>
          </div>
        </div>
      )}

      {/* Retry location button when no location but no error yet */}
      {!location && !locError && !locating && (
        <div className="mb-6">
          <ProviderNotice
            title={t('Location unavailable')}
            message={t('Allow location access to see nearby emergency services. You can also search below.')}
            action={{ label: t('Try again'), onClick: requestLocation }}
          />
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder={t('Search city or address…')}
              value={manualSearch}
              onChange={(e) => setManualSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
              className="input flex-1"
            />
            <Button size="sm" icon={Navigation} onClick={handleManualSearch}>{t('Search')}</Button>
          </div>
        </div>
      )}

      {location && !nearbyLoading && nearbyData && !nearbyData.isLive && (
        <ProviderNotice
          title={t('Live data unavailable for emergency services')}
          message={nearbyData._apiMessage || t('Live emergency services are temporarily unavailable. Your contacts below still work.')}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Nearby services */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{t('Nearby services')}</h3>
            {location && (
              <button
                onClick={() => refetchNearby()}
                disabled={isRefetching}
                className="btn-ghost flex items-center gap-1.5 text-xs"
              >
                <RefreshCw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
                {t('Refresh')}
              </button>
            )}
          </div>
          <div className="space-y-4">
            {nearbyLoading ? (
              <PageLoader label={t('Loading nearby services…')} />
            ) : (
              Object.entries(CATEGORY_META).map(([key, meta]) => {
                const places = nearbyData?.results?.[key] || [];
                return (
                  <div key={key} className="card p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${meta.color}`}>
                        <meta.icon className="h-4 w-4" />
                      </span>
                      <p className="text-sm font-extrabold text-slate-900 dark:text-white">{t(meta.labelKey)}</p>
                      <span className="ml-auto text-xs text-slate-400">{places.length} {t('found')}</span>
                    </div>
                    {places.length === 0 ? (
                      <p className="text-xs text-slate-400">{t('Live data unavailable for this category.')}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {places.map((p, i) => (
                          <div key={p.placeId || i} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{p.name}</p>
                              {p.address && <p className="truncate text-xs text-slate-400">{p.address}</p>}
                              {p.phone && (
                                <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline">
                                  <Phone className="h-3 w-3" /> {p.phone}
                                </a>
                              )}
                              {p.rating != null && <p className="text-xs text-amber-500">★ {p.rating}</p>}
                            </div>
                            <div className="flex shrink-0 gap-1">
                              {p.phone && (
                                <a href={`tel:${p.phone}`} className="btn-secondary px-2 py-1 text-xs">
                                  <Phone className="h-3 w-3" />
                                </a>
                              )}
                              <button
                                onClick={() => directionsTo(p.name, p.coordinates)}
                                className="btn-secondary px-2.5 py-1 text-xs"
                              >
                                <MapPin className="h-3 w-3" /> {t('Route')}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Personal contacts */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{t('My emergency contacts')}</h3>
            <Button size="sm" icon={Plus} onClick={() => setContactModal(true)}>{t('Add')}</Button>
          </div>
          {contactsLoading ? (
            <PageLoader label={t('Loading contacts…')} />
          ) : (
            <div className="space-y-2">
              {(contactsData?.contacts || []).length === 0 && (
                <div className="card p-6 text-center text-sm text-slate-400">{t('Save family or friends as emergency contacts.')}</div>
              )}
              {(contactsData?.contacts || []).map((c) => (
                <div key={c._id} className="card flex items-center gap-3 p-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-lg font-extrabold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                    {c.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900 dark:text-white">
                      {c.name} {c.isPrimary && <span className="badge bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">{t('primary')}</span>}
                    </p>
                    <p className="text-xs text-slate-400">{c.relationship}{c.email ? ` · ${c.email}` : ''}</p>
                  </div>
                  <a href={`tel:${c.phone}`} className="btn-secondary px-3 py-1.5 text-xs">
                    <Phone className="h-3.5 w-3.5" /> {c.phone}
                  </a>
                  <button
                    onClick={() => setDeleteConfirm(c)}
                    className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:text-slate-600 dark:hover:bg-rose-950"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="card mt-4 p-4">
            <p className="text-sm font-extrabold text-slate-900 dark:text-white">{t('Emergency essentials')}</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-500 dark:text-slate-400">
              <li>{t('Keep your hotel address and passport copies saved')}</li>
              <li>{t('Share your live location with someone you trust')}</li>
              <li>{t('Travel insurance with medical cover is strongly advised')}</li>
              <li>{t('Save local embassy/consulate contact from official sources')}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Add Contact Modal */}
      <Modal open={contactModal} onClose={() => setContactModal(false)} title={t('Add emergency contact')}>
        <div className="space-y-4">
          <Input label={t('Name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label={t('Relationship')} placeholder="Family / Friend" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
          <Input label={t('Phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label={t('Email (optional)')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} className="h-4 w-4 accent-brand-600" />
            {t('Set as primary contact')}
          </label>
          <Button className="w-full" loading={addContact.isPending} disabled={!form.name || !form.phone} onClick={() => addContact.mutate(form)}>
            {t('Save contact')}
          </Button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={Boolean(deleteConfirm)} onClose={() => setDeleteConfirm(null)} title={t('Delete contact')}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('Are you sure you want to delete')} <strong>{deleteConfirm?.name}</strong>?
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>
              {t('Cancel')}
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={deleteContact.isPending}
              onClick={() => deleteContact.mutate(deleteConfirm?._id)}
            >
              {t('Delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
