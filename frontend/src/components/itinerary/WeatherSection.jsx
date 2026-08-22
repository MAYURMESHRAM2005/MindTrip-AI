import React from 'react';
import { CloudSun, Droplets, Wind, Umbrella, Sunrise, Sunset, Thermometer } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import { formatDateShort } from '../../utils/format';
import { useI18n } from '../../utils/i18n';

function weatherEmoji(icon) {
  const map = {
    '01': '☀️', '02': '🌤️', '03': '⛅', '04': '☁️', '09': '🌧️',
    '10': '🌦️', '11': '⛈️', '13': '❄️', '50': '🌫️',
  };
  return map[String(icon || '').slice(0, 2)] || '🌡️';
}

function epochTime(ts) {
  if (!ts || typeof ts !== 'number') return '—';
  const d = new Date(ts * 1000);
  if (isNaN(d)) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function WeatherSection({ weatherDaily = [], isLive, note }) {
  const { t } = useI18n();
  if (!weatherDaily.length) return null;
  return (
    <Card className="mb-6">
      <CardHeader
        icon={CloudSun}
        title={t('Daily weather')}
        subtitle={t('Day-by-day forecast for your trip')}
        action={<Badge tone={isLive ? 'green' : 'amber'}>{isLive ? `● ${t('Live forecast')}` : t('Estimate')}</Badge>}
      />
      {note && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">{note}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {weatherDaily.map((d, i) => (
          <div key={i} className="rounded-2xl border border-slate-100 bg-gradient-to-br from-sky-50/70 to-white p-4 dark:border-slate-800 dark:from-slate-900/60 dark:to-slate-900/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{d.date ? formatDateShort(d.date) : `${t('Day')} ${d.day}`}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{d.condition || '—'}</p>
              </div>
              <span className="text-3xl">{weatherEmoji(d.icon)}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-lg font-extrabold text-slate-900 dark:text-white">
              <Thermometer className="h-4 w-4 text-slate-400" />
              {d.tempMax != null ? `${Math.round(d.tempMax)}°` : '—'}
              {d.tempMin != null && <span className="text-sm font-semibold text-slate-400">/ {Math.round(d.tempMin)}°</span>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              {d.humidity != null && <span className="inline-flex items-center gap-1"><Droplets className="h-3 w-3 text-sky-500" /> {d.humidity}%</span>}
              {d.rainProbability != null && <span className="inline-flex items-center gap-1"><Umbrella className="h-3 w-3 text-blue-500" /> {d.rainProbability}% {t('rain')}</span>}
              {d.windSpeed != null && <span className="inline-flex items-center gap-1"><Wind className="h-3 w-3 text-slate-500" /> {d.windSpeed} m/s</span>}
              {d.sunrise != null && <span className="inline-flex items-center gap-1"><Sunrise className="h-3 w-3 text-amber-500" /> {epochTime(d.sunrise)}</span>}
              {d.sunset != null && <span className="inline-flex items-center gap-1"><Sunset className="h-3 w-3 text-orange-500" /> {epochTime(d.sunset)}</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
