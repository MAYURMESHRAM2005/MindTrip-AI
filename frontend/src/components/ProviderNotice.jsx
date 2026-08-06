import React from 'react';
import { WifiOff, ExternalLink, RotateCw } from 'lucide-react';

/**
 * Banner shown whenever live data from an external provider is unavailable.
 * Every visible feature either shows live data or this honest notice.
 * Pass `action={{ label, onClick }}` to render a retry button.
 */
export default function ProviderNotice({ message, externalSources = [], title = 'Live data unavailable', action }) {
  return (
    <div className="rounded-2xl border border-amber-200/80 bg-amber-50 p-4 text-sm dark:border-amber-900/60 dark:bg-amber-950/40">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400">
          <WifiOff className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-amber-800 dark:text-amber-300">{title}</p>
          <p className="mt-0.5 text-amber-700/90 dark:text-amber-200/80">{message}</p>
          {externalSources?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {externalSources.map((s) => (
                <a
                  key={s.name + s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300/70 bg-white px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300"
                >
                  <ExternalLink className="h-3 w-3" />
                  {s.name}
                </a>
              ))}
            </div>
          )}
          {action && (
            <button
              onClick={action.onClick}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300/70 bg-white px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300"
            >
              <RotateCw className="h-3 w-3" />
              {action.label || 'Retry'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
