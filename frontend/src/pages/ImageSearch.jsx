import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Upload, Sparkles, MapPin, Star, X } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import ProviderNotice from '../components/ProviderNotice';
import { placesApi } from '../services/apiClient';
import { errorMessage } from '../services/api';
import { Spinner } from '../components/ui/Spinner';
import toast from 'react-hot-toast';
import Badge from '../components/ui/Badge';
import { useI18n } from '../utils/i18n';

export default function ImageSearch() {
  const { t } = useI18n();
  const [preview, setPreview] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error(t('Please choose an image file'));
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!preview) return;
    setProcessing(true);
    setResult(null);
    try {
      const blob = await (await fetch(preview)).blob();
      const formData = new FormData();
      formData.append('image', blob, 'photo.jpg');
      const { data } = await placesApi.imageSearch(formData);
      setResult(data.data);
      if (!data.data.analysis) toast(data.data.aiMessage, { icon: '🤖' });
    } catch (e) {
      toast.error(errorMessage(e, t('Image analysis failed')));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon={ImageIcon} title={t('Image Search')} subtitle={t('Upload a photo — Gemini identifies the place, Geoapify finds real info.')} />

      <div
        className="card flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition-colors hover:border-brand-400"
        onClick={() => fileRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt="Upload preview" className="max-h-64 rounded-2xl object-cover shadow-card" />
        ) : (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-950">
              <Upload className="h-8 w-8" />
            </div>
            <p className="font-bold text-slate-700 dark:text-slate-200">{t('Drop a travel photo here or click to upload')}</p>
            <p className="text-xs text-slate-400">JPEG, PNG, WEBP · {t('max 8MB')}</p>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {preview && (
        <div className="mt-4 flex gap-2">
          <button onClick={analyze} disabled={processing} className="btn-primary flex-1">
            {processing ? <Spinner size="sm" /> : <Sparkles className="h-4 w-4" />}
            {processing ? t('Analyzing with Gemini…') : t('Identify this place')}
          </button>
          <button onClick={() => { setPreview(null); setResult(null); }} className="btn-secondary">
            <X className="h-4 w-4" /> {t('Clear')}
          </button>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          {!result.aiConfigured && <ProviderNotice title={t('AI not configured')} message={result.aiMessage} />}

          {result.analysis && (
            <div className="card p-5">
              <p className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
                <Sparkles className="h-4 w-4 text-brand-500" /> {t('Gemini analysis')}
              </p>
              <div className="flex flex-wrap gap-2">
                {result.analysis.landmark && <Badge tone="violet">🏛 {result.analysis.landmark}</Badge>}
                {result.analysis.city && <Badge tone="blue">📍 {result.analysis.city}</Badge>}
                {result.analysis.country && <Badge tone="green">🌍 {result.analysis.country}</Badge>}
                {result.analysis.confidence && <Badge tone={result.analysis.confidence === 'high' ? 'green' : 'amber'}>confidence: {result.analysis.confidence}</Badge>}
              </div>
              {result.analysis.description && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{result.analysis.description}</p>}
            </div>
          )}

          <div>
            <p className="mb-3 text-sm font-extrabold text-slate-900 dark:text-white">
              {t('Possible matches')} {result.placesLive ? <span className="badge bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">{t('live')}</span> : ''}
            </p>
            {result.places.length === 0 && !result.placesLive && <ProviderNotice title={t('Live place data unavailable')} message={result.placesMessage} />}
            <div className="grid gap-3 sm:grid-cols-2">
              {result.places.map((p, i) => (
                <div key={p.placeId || i} className="card p-4">
                  <p className="font-bold text-slate-900 dark:text-white">{p.name}</p>
                  {p.rating != null && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-amber-500">
                      <Star className="h-3.5 w-3.5 fill-current" /> {p.rating}
                    </p>
                  )}
                  {p.address && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {p.address}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
