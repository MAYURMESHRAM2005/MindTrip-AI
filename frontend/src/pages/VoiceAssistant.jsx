import React, { useState } from 'react';
import { Mic, Square, Volume2, AlertTriangle, Sparkles } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import useSpeech from '../hooks/useSpeech';
import { voiceApi } from '../services/apiClient';
import { errorMessage } from '../services/api';
import { Spinner } from '../components/ui/Spinner';
import toast from 'react-hot-toast';
import useTripId from '../hooks/useTripId';
import { useI18n } from '../utils/i18n';

const EXAMPLES = [
  'Plan a 5-day Goa trip under ₹25,000',
  'Find cheaper hotels',
  'Show nearby restaurants',
  'What should I pack for rain?',
];

export default function VoiceAssistant() {
  const { supported, listening, transcript, startListening, stopListening, speak } = useSpeech();
  const [processing, setProcessing] = useState(false);
  const [response, setResponse] = useState('');
  const [manual, setManual] = useState('');
  const tripId = useTripId();
  const { lang, t } = useI18n();

  const handleTranscript = async (text) => {
    if (!text) return;
    setProcessing(true);
    setResponse('');
    try {
      const { data } = await voiceApi.command({ transcript: text, conversationId: null, tripId, lang });
      const reply = data.data.reply;
      setResponse(reply);
      speak(reply, lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN');
    } catch (e) {
      toast.error(errorMessage(e));
      speak('Sorry, I could not process that right now.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon={Mic} title={t('Voice Assistant')} subtitle={t('Speech-to-text and text-to-speech with graceful fallback.')} />

      {!supported && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-amber-800 dark:text-amber-300">
            {t("Your browser doesn't support the Web Speech API. You can still type commands below — everything else works.")}
          </p>
        </div>
      )}

      <div className="card flex flex-col items-center p-10 text-center">
        <div
          className={`relative flex h-28 w-28 items-center justify-center rounded-full transition-all ${
            listening ? 'bg-brand-600 shadow-glow' : 'bg-gradient-to-br from-brand-500 to-brand-700 shadow-card'
          }`}
        >
          {listening ? (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/40" />
              <Square className="h-9 w-9 text-white" onClick={stopListening} />
            </>
          ) : (
            <Mic className="h-10 w-10 text-white" onClick={() => startListening(lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN')} />
          )}
        </div>
        <p className="mt-4 text-sm font-bold text-slate-700 dark:text-slate-200">
          {listening ? t('Listening… speak now') : t('Tap to speak')}
        </p>
        {listening && transcript && <p className="mt-2 text-sm italic text-brand-600 dark:text-brand-400">“{transcript}”</p>}
        {processing && <div className="mt-4"><Spinner /></div>}
      </div>

      {/* Transcript trigger */}
      {transcript && !processing && (
        <button onClick={() => handleTranscript(transcript)} className="btn-primary mt-4 w-full">
          <Sparkles className="h-4 w-4" /> {t('Process')} “{transcript}”
        </button>
      )}

      <div className="mt-6 card p-5">
        <p className="mb-2 text-sm font-extrabold text-slate-900 dark:text-white">{t('Try saying')}</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => handleTranscript(e)} className="rounded-full border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300">
              “{e}”
            </button>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <input className="input" placeholder={t('Type a command instead…')} value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleTranscript(manual)} />
          <button onClick={() => handleTranscript(manual)} className="btn-primary whitespace-nowrap">
            <Mic className="h-4 w-4" /> {t('Send')}
          </button>
        </div>
      </div>

      {response && (
        <div className="card mt-6 p-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-extrabold text-slate-900 dark:text-white">{t('Assistant response')}</p>
            <button onClick={() => speak(response, lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN')} className="btn-secondary px-3 py-1.5 text-xs">
              <Volume2 className="h-3.5 w-3.5" /> {t('Read aloud')}
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{response}</p>
        </div>
      )}
    </div>
  );
}
