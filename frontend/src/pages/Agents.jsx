import React, { Fragment, useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, Workflow, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { AGENTS } from '../constants';
import { useQuery } from '@tanstack/react-query';
import { tripApi } from '../services/apiClient';
import Badge from '../components/ui/Badge';
import { useI18n } from '../utils/i18n';

export default function Agents() {
  const { t } = useI18n();
  const [selected, setSelected] = useState(AGENTS[0]);
  const { data: tripsData } = useQuery({
    queryKey: ['trips'],
    queryFn: () => tripApi.list().then((r) => r.data.data),
  });
  const lastTrip = tripsData?.trips?.[0];

  return (
    <div>
      <PageHeader
        icon={Bot}
        title={t('AI Agents')}
        subtitle={t('The multi-agent LLM architecture behind every trip you plan.')}
      />

      {/* Pipeline flow */}
      <div className="mb-8 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 whitespace-nowrap">
          {[t('Request'), ...AGENTS.filter((a) => a.key !== 'finalValidator').map((a) => a.key), t('Validated Plan')].map((step, i, arr) => (
            <Fragment key={step}>
              <motion.div
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${
                  i === 0
                    ? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                    : i === arr.length - 1
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                      : 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300'
                }`}
              >
                <Workflow className="h-3.5 w-3.5" />
                {step}
              </motion.div>
              {i < arr.length - 1 && <Zap className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Agent grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent, i) => (
          <motion.button
            key={agent.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            onClick={() => setSelected(agent)}
            className={`card p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-card ${
              selected.key === agent.key ? 'ring-2 ring-brand-500' : ''
            }`}
          >
            <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${agent.color} text-white shadow-card`}>
              <Bot className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{agent.name}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{agent.role}</p>
          </motion.button>
        ))}
      </div>

      {/* Details panel */}
      <div className="card mt-8 p-6">
        <div className="mb-3 flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${selected.color} text-white`}>
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">{selected.name} Agent</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{selected.role}</p>
          </div>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t('Data flow')}</p>
            <p className="text-slate-600 dark:text-slate-300">
              {selected.key === 'orchestrator' || selected.key === 'userPreference' || selected.key === 'destination' || selected.key === 'budget' || selected.key === 'localGuide' || selected.key === 'safety' || selected.key === 'finalValidator' || selected.key === 'translation' || selected.key === 'expense'
                ? t('Reasoning agent: reads structured context (real provider data where applicable) and produces structured JSON. Falls back to deterministic logic when Gemini is unavailable.')
                : t('External-data agent: calls the real provider API FIRST, then hands the live data to Gemini for reasoning. Gemini never invents prices, schedules or availability.')}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">{t('Golden rules')}</p>
            <ul className="space-y-1.5 text-slate-600 dark:text-slate-300">
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> {t('Real data first, AI second')}</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> {t('Estimates always flagged')}</li>
              <li className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> {t('Missing data → “Live data unavailable”')}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Last run report */}
      {lastTrip && (
        <div className="card mt-6 p-6">
          <h3 className="mb-4 text-base font-extrabold text-slate-900 dark:text-white">{t('Last pipeline run')} — “{lastTrip.title}”</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(lastTrip.agentReport || []).map((r, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
                <Badge tone={r.status === 'success' ? 'green' : r.status === 'degraded' ? 'amber' : 'rose'}>
                  {r.status}
                </Badge>
                <span className="font-bold capitalize text-slate-700 dark:text-slate-200">{r.agent}</span>
                <span className="ml-auto text-slate-400">{r.latencyMs ? `${r.latencyMs}ms` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
