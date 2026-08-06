import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

/**
 * Voice Assistant hook.
 * - speechToText: browser Web Speech API (en/hi/mr supported)
 * - speak: speechSynthesis TTS with graceful fallback
 * Returns a supported flag so the UI can show a graceful fallback path.
 */
export default function useSpeech() {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [supported, setSupported] = useState(Boolean(SpeechRecognitionImpl));
  const recognitionRef = useRef(null);

  const startListening = useCallback(
    (lang = 'en-IN') => {
      if (!SpeechRecognitionImpl) return;
      const recognition = new SpeechRecognitionImpl();
      recognition.lang = lang;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        setTranscript(text);
        setListening(false);
      };
      recognition.onerror = () => setListening(false);
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      setTranscript('');
      setListening(true);
      recognition.start();
    },
    []
  );

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const speak = useCallback((text, lang = 'en-IN') => {
    if (!('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    return true;
  }, []);

  const cancelSpeech = useCallback(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => () => stopListening(), [stopListening]);

  return { supported, listening, transcript, startListening, stopListening, speak, cancelSpeech };
}
