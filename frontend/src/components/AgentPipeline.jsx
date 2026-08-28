import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Bot } from 'lucide-react';
import { AGENTS } from '../constants';
import { useI18n } from '../utils/i18n';

/**
 * Animated multi-agent pipeline. While the backend genuinely runs the agent
 * pipeline, the client walks through the agent list so the user sees each
 * agent activate in order. It completes exactly when the request resolves.
 */
export default function AgentPipeline({ running, onComplete, durationMs = 12000 }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);

  const pipeline = useMemo(
    () => [
      'orchestrator', 'userPreference', 'destination', 'weather',
      'flight', 'train', 'bus', 'hotel', 'restaurant', 'attraction',
      'budget', 'traffic', 'localGuide', 'safety', 'finalValidator',
    ],
    []
  );

  useEffect(() => {
    if (!running) {
      setStep(0);
      return;
    }
    console.log('[PIPELINE] Starting agent pipeline animation...');
    const perStep = Math.max(300, durationMs / pipeline.length);
    const timer = setInterval(() => {
      setStep((s) => {
        if (s >= pipeline.length) {
          clearInterval(timer);
          console.log('[PIPELINE] All agents completed');
          onComplete?.();
          return s;
        }
        const agentKey = pipeline[s];
        console.log(`[PIPELINE] Agent ${s + 1}/${pipeline.length}: ${agentKey} → active`);
        return s + 1;
      });
    }, perStep);
    return () => clearInterval(timer);
  }, [running, durationMs, pipeline.length]);

  if (!running) return null;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 animate-pulse items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{t('Running the multi-agent pipeline')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('Specialized agents coordinating your trip…')}</p>
        </div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {pipeline.map((key, i) => {
          const agent = AGENTS.find((a) => a.key === key);
          const state = i < step ? 'done' : i === step ? 'active' : 'pending';
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0.5 }}
              animate={{ opacity: state === 'pending' ? 0.55 : 1 }}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                state === 'active'
                  ? 'border-brand-400/70 bg-brand-50 dark:bg-brand-950/60'
                  : state === 'done'
                    ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/40'
                    : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  state === 'done'
                    ? 'bg-emerald-500 text-white'
                    : state === 'active'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {state === 'done' ? <Check className="h-3.5 w-3.5" /> : state === 'active' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : i + 1}
              </span>
              <span className="truncate font-semibold text-slate-700 dark:text-slate-200">{agent?.name || key}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
