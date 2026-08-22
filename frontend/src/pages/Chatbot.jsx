import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Bot, User, Wand2 } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { chatApi } from '../services/apiClient';
import { errorMessage } from '../services/api';
import { Spinner } from '../components/ui/Spinner';
import toast from 'react-hot-toast';
import useTripId from '../hooks/useTripId';
import { useI18n } from '../utils/i18n';
import { translateApi } from '../services/apiClient';

const SUGGESTIONS = [
  'Make my trip ₹5,000 cheaper',
  'Replace my hotel',
  'Find vegetarian restaurants near my hotel',
  'Move this attraction to tomorrow',
  'What should I do if it rains?',
  'How much have I spent so far?',
];

export default function Chatbot() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I'm your travel assistant 🤖 Ask me anything about your trip — I can actually change your itinerary and budget." },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const tripId = useTripId();
  const { lang, t } = useI18n();
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text) => {
    const message = (text || input).trim();
    if (!message || sending) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setSending(true);
    try {
      const { data } = await chatApi.send({ message, conversationId, tripId });
      setConversationId(data.data.conversationId);
      let reply = data.data.reply;
      // Translate AI responses to the user's language when not English
      if (lang !== 'en') {
        try {
          const t = await translateApi.translate(reply, lang);
          if (t.data.data.translated) reply = t.data.data.translated;
        } catch {
          /* keep original */
        }
      }
      setMessages((m) => [...m, { role: 'assistant', content: reply, meta: data.data.actionExecuted ? { intent: data.data.intent } : null }]);
      if (data.data.actionExecuted) toast.success(t('Action applied to your trip!'));
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${errorMessage(e)}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon={MessageSquare} title={t('AI Chatbot')} subtitle={t('Contextual assistant that really updates your trip and budget.')} />

      <div className="card flex h-[62vh] flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
              {m.role === 'assistant' && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                  <Bot className="h-5 w-5" />
                </div>
              )}
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm ${
                  m.role === 'user'
                    ? 'rounded-br-md bg-brand-600 text-white'
                    : 'rounded-bl-md bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                {m.content}
                {m.meta?.intent && (
                  <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-500">✓ {m.meta.intent} {t('executed')}</p>
                )}
              </div>
              {m.role === 'user' && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                  <User className="h-5 w-5" />
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="flex gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                <Bot className="h-5 w-5" />
              </div>
              <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 dark:bg-slate-800">
                <Spinner size="sm" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-100 p-3 dark:border-slate-800">
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="shrink-0 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300">
                <Wand2 className="mr-1 inline h-3 w-3" />
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input"
              placeholder={tripId ? t('Ask about your trip…') : t('Type a message (or plan a trip first for context)…')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
            />
            <button onClick={() => send()} disabled={sending} className="btn-primary !px-3.5">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
