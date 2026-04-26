'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

type Step = {
  number: number;
  instruction: string;
  element_id?: string;
  position: { x: number; y: number };
  ui_element: string;
  annotation_type: string;
};

type AnalysisResponse = {
  steps: Step[];
  context: string;
  follow_up: string;
  needs_next_screenshot?: boolean;
  isAutoGuide?: boolean;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
  response?: AnalysisResponse;
};

const DEMO_SCENARIOS = [
  {
    label: 'Mock EPIC',
    sublabel: 'CT ordering · imaging requests · prescribing',
    url: '/mock-epic.html',
    icon: '🔬',
    question: 'How do I request an urgent CT Head for a patient with head injury?',
  },
  {
    label: 'Discharge Summary',
    sublabel: 'NHS discharge template · GP letter',
    url: '/mock-discharge.html',
    icon: '📋',
    question: 'Walk me through completing this discharge summary.',
  },
];

const EXTERNAL_LINKS = [
  { label: 'NICE Guidelines', url: 'https://www.nice.org.uk/guidance', question: "What's the NICE pathway for suspected pulmonary embolism?" },
  { label: 'ClinicalTrials.gov', url: 'https://clinicaltrials.gov', question: 'How do I search for relevant trials for my patient?' },
];

const PRESET_SCENARIOS = [
  { label: 'Request urgent CT Head', question: 'How do I request an urgent CT Head for a patient with head injury?' },
  { label: 'Discharge summary', question: 'Walk me through completing this discharge summary.' },
  { label: 'Find clinical trials', question: 'Are there any clinical trials my patient could join?' },
  { label: 'NICE pathway — PE', question: "What's the NICE pathway for suspected pulmonary embolism?" },
];

// Compress image to JPEG before sending — reduces payload 5–10x
function compressImage(dataUrl: string, maxWidth = 1280): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(dataUrl); // fallback to original
    img.src = dataUrl;
  });
}

function formatForExport(msg: Message): string {
  if (!msg.response) return msg.content;
  const lines: string[] = [];
  if (msg.response.steps?.length) msg.response.steps.forEach(s => lines.push(`${s.number}. ${s.instruction}`));
  if (msg.response.context) lines.push(`\nNote: ${msg.response.context}`);
  return lines.join('\n');
}

export default function Home() {
  // Content modes: iframe demo, uploaded screenshot, or empty
  const [activeDemoUrl, setActiveDemoUrl] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null); // for upload/paste screenshots
  const [mediaType, setMediaType] = useState('image/png');

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cursor animation
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorVisible, setCursorVisible] = useState(false);
  const [cursorClicking, setCursorClicking] = useState(false);
  const [cursorStep, setCursorStep] = useState(0);

  // Auto-guide
  const [autoGuide] = useState(false);

  // UI
  const [isDragging, setIsDragging] = useState(false);
  const [activeSteps, setActiveSteps] = useState<Step[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [mobileTab, setMobileTab] = useState<'screen' | 'chat'>('screen');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const autoGuideRef = useRef(false);
  const autoGuideLoadingRef = useRef(false);
  const lastFingerprintRef = useRef('');
  const autoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStepsRef = useRef<Step[]>([]);
  const currentStepIdxRef = useRef(0);

  useEffect(() => { autoGuideRef.current = autoGuide; }, [autoGuide]);

  // Window-level paste — fires even when iframe has focus
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      for (const item of (e.clipboardData?.items ?? [])) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { loadImageFile(file); break; }
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, []);
  useEffect(() => { activeStepsRef.current = activeSteps; }, [activeSteps]);
  useEffect(() => { currentStepIdxRef.current = currentStepIdx; }, [currentStepIdx]);

  // Resolve step position: use exact DOM element if element_id known, else fall back to Claude's estimate
  const resolvePosition = useCallback((step: Step): { x: number; y: number } => {
    if (step.element_id && iframeRef.current?.contentDocument) {
      try {
        const el = iframeRef.current.contentDocument.querySelector(`[data-mg="${step.element_id}"]`);
        if (el) {
          const doc = iframeRef.current.contentDocument;
          const rect = el.getBoundingClientRect();
          const scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop;
          const scrollLeft = doc.documentElement.scrollLeft || doc.body.scrollLeft;
          const cx = rect.left + scrollLeft + rect.width / 2;
          const cy = rect.top + scrollTop + rect.height / 2;
          const x = (cx / iframeRef.current.offsetWidth) * 100;
          const y = (cy / iframeRef.current.offsetHeight) * 100;
          if (x > 0 && x < 100 && y > 0 && y < 100) return { x, y };
        }
      } catch { /* cross-origin fallback */ }
    }
    return step.position;
  }, []);

  // Animate cursor to a specific step, auto-hide after the last one
  const goToStep = useCallback(async (idx: number, steps?: Step[]) => {
    const stepsToUse = steps ?? activeStepsRef.current;
    if (idx >= stepsToUse.length) return;
    setCurrentStepIdx(idx);
    currentStepIdxRef.current = idx;
    const pos = resolvePosition(stepsToUse[idx]);
    setCursorVisible(true);
    setCursorStep(idx + 1);
    setCursorPos(pos);
    await sleep(700);
    setCursorClicking(true);
    await sleep(220);
    setCursorClicking(false);
    // Hide cursor after the last step completes
    if (idx === stepsToUse.length - 1) {
      await sleep(1200);
      setCursorVisible(false);
    }
  }, [resolvePosition]);

  // Iframe click → auto-advance to next step
  useEffect(() => {
    if (!activeDemoUrl) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const onIframeClick = () => {
      const nextIdx = currentStepIdxRef.current + 1;
      if (nextIdx < activeStepsRef.current.length) {
        setTimeout(() => goToStep(nextIdx), 350);
      } else if (activeStepsRef.current.length > 0) {
        // All steps done — hide cursor
        setTimeout(() => setCursorVisible(false), 400);
      }
    };

    const onIframePaste = (e: Event) => {
      const ce = e as ClipboardEvent;
      for (const item of (ce.clipboardData?.items ?? [])) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { loadImageFile(file); break; }
        }
      }
    };

    const attachListener = () => {
      try {
        iframe.contentDocument?.addEventListener('click', onIframeClick);
        iframe.contentDocument?.addEventListener('paste', onIframePaste);
      } catch { /* cross-origin */ }
    };

    iframe.addEventListener('load', attachListener);
    attachListener();
    return () => {
      iframe.removeEventListener('load', attachListener);
      try { iframe.contentDocument?.removeEventListener('click', onIframeClick); } catch { /**/ }
    };
  }, [activeDemoUrl, goToStep]);

  // ── Iframe capture ────────────────────────────────────────────────

  const captureIframe = useCallback((): Promise<string | null> => {
    return new Promise(resolve => {
      const iframe = iframeRef.current;
      if (!iframe?.contentDocument?.documentElement) { resolve(null); return; }
      const w = iframe.offsetWidth;
      const h = iframe.offsetHeight;
      try {
        const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
          <foreignObject width="${w}" height="${h}">
            ${new XMLSerializer().serializeToString(iframe.contentDocument.documentElement)}
          </foreignObject>
        </svg>`;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0); resolve(canvas.toDataURL('image/png')); };
        img.onerror = () => resolve(null);
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
      } catch { resolve(null); }
    });
  }, []);

  // Auto-guide interval — fires when iframe content changes
  useEffect(() => {
    if (!activeDemoUrl) {
      if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
      return;
    }

    autoIntervalRef.current = setInterval(async () => {
      if (!autoGuideRef.current || autoGuideLoadingRef.current || isLoading) return;
      const dataUrl = await captureIframe();
      if (!dataUrl) return;

      // Thumbnail fingerprint to detect real page changes
      const thumbImg = new Image();
      thumbImg.onload = () => {
        const tc = document.createElement('canvas');
        tc.width = 64; tc.height = 36;
        tc.getContext('2d')?.drawImage(thumbImg, 0, 0, 64, 36);
        const fp = tc.toDataURL('image/jpeg', 0.1);
        if (fp !== lastFingerprintRef.current) {
          lastFingerprintRef.current = fp;
          autoGuideLoadingRef.current = true;
          triggerAutoGuide(dataUrl);
        }
      };
      thumbImg.src = dataUrl;
    }, 3000);

    return () => {
      if (autoIntervalRef.current) clearInterval(autoIntervalRef.current);
    };
  }, [activeDemoUrl, captureIframe]);

  const triggerAutoGuide = async (dataUrl: string) => {
    try {
      const compressed = await compressImage(dataUrl, 1024);
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: compressed.split(',')[1],
          mediaType: 'image/jpeg',
          autoGuide: true,
          messages: [{ role: 'user', content: "Screen just changed. What is the single most important next step? One step only, for what's visible right now." }],
        }),
      });
      if (!res.ok) return;
      const data: AnalysisResponse = await res.json();
      if (!data.steps?.length && !data.context) return;
      const steps = data.steps ?? [];
      const response = { ...data, isAutoGuide: true };
      setMessages(prev => [...prev, { role: 'assistant', content: data.context, response }]);
      setActiveSteps(steps);
      setCurrentStepIdx(0);
      activeStepsRef.current = steps;
      currentStepIdxRef.current = 0;
      setCursorVisible(false);
      if (steps.length) setTimeout(() => goToStep(0, steps), 200);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } finally {
      autoGuideLoadingRef.current = false;
    }
  };

  // ── Image upload/paste (for external sites) ───────────────────────

  const loadImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setMediaType(file.type);
    setActiveDemoUrl(null);
    const reader = new FileReader();
    reader.onload = e => { setImage(e.target?.result as string); setActiveSteps([]); setCursorVisible(false); };
    reader.readAsDataURL(file);
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) { loadImageFile(file); break; }
      }
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadImageFile(file);
  };

  // ── Cursor animation ──────────────────────────────────────────────

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  // ── Send message ──────────────────────────────────────────────────

  const sendMessage = async (question: string, imageOverride?: string) => {
    if (!question.trim()) return;

    // Determine image to use
    let imageToUse = imageOverride || image;
    if (!imageToUse && activeDemoUrl) {
      setIsCapturing(true);
      imageToUse = await captureIframe();
      setIsCapturing(false);
      if (!imageToUse) {
        setError('Could not capture the interface — wait for it to fully load and try again.');
        return;
      }
    }
    if (!imageToUse) return;

    setError(null);
    const userMsg: Message = { role: 'user', content: question };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setMobileTab('chat');
    setCursorVisible(false);

    try {
      const compressed = await compressImage(imageToUse, 1280);
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: compressed.split(',')[1],
          mediaType: 'image/jpeg',
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw new Error();
      const data: AnalysisResponse = await res.json();
      const steps = data.steps ?? [];
      setMessages(prev => [...prev, { role: 'assistant', content: data.context, response: data }]);
      setActiveSteps(steps);
      setCurrentStepIdx(0);
      activeStepsRef.current = steps;
      currentStepIdxRef.current = 0;
      setCursorVisible(false);
      if (steps.length) setTimeout(() => goToStep(0, steps), 200);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch {
      setError('Analysis failed. Check your API key and try again.');
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  // ── Export ────────────────────────────────────────────────────────

  const copyMessage = async (msg: Message, idx: number) => {
    await navigator.clipboard.writeText(formatForExport(msg));
    setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 2000);
  };

  const exportAll = (format: 'copy' | 'markdown') => {
    setShowExportMenu(false);
    const lines = ['# ScrubIn Session\n'];
    messages.forEach(m => {
      if (m.role === 'user') lines.push(`**You:** ${m.content}\n`);
      else lines.push(`**ScrubIn:**\n${formatForExport(m)}\n`);
    });
    const text = lines.join('\n');
    if (format === 'copy') navigator.clipboard.writeText(text);
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      a.download = 'medguide-session.md'; a.click();
    }
  };

  const clearAll = () => {
    setActiveDemoUrl(null); setImage(null); setMessages([]);
    setActiveSteps([]); setCurrentStepIdx(0); setError(null); setInput('');
    setCursorVisible(false);
    activeStepsRef.current = []; currentStepIdxRef.current = 0;
    lastFingerprintRef.current = '';
  };

  const hasContent = activeDemoUrl || image;
  const assistantCount = messages.filter(m => m.role === 'assistant').length;

  // ── Cursor overlay component (reused in both modes) ───────────────

  const CursorOverlay = () => (
    <>
      {cursorVisible && (
        <div className="absolute pointer-events-none z-30"
          style={{
            left: `${cursorPos.x}%`, top: `${cursorPos.y}%`,
            transform: 'translate(-3px, -3px)',
            transition: 'left 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94), top 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          }}>
          {/* Click ripple */}
          {cursorClicking && (
            <div className="absolute -inset-4 rounded-full bg-[#1a73e8] opacity-35 animate-ping" />
          )}
          {/* Cursor */}
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none"
            style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))' }}>
            <path d="M4 2L24 13L15 16L11 24L4 2Z" fill="white" stroke="#1a73e8" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          {/* Step pill */}
          {cursorStep > 0 && (
            <div className="absolute left-6 -top-1 bg-[#1a73e8] text-white text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap shadow-lg leading-none">
              Step {cursorStep}
            </div>
          )}
        </div>
      )}
    </>
  );

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#1a73e8] rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#1a1a1a] leading-none">ScrubIn</h1>
            <p className="text-xs text-gray-400 mt-0.5">Navigate any clinical system with AI</p>
          </div>
        </div>
        <span className="text-xs text-gray-400 hidden sm:block">Built with Claude Opus 4.7 · Cerebral Valley x Anthropic Hackathon 2026</span>

      </header>

      {/* Mobile tabs */}
      <div className="md:hidden flex border-b border-gray-200 bg-white flex-shrink-0">
        <button onClick={() => setMobileTab('screen')}
          className={`flex-1 py-2.5 text-xs font-medium ${mobileTab === 'screen' ? 'text-[#1a73e8] border-b-2 border-[#1a73e8]' : 'text-gray-500'}`}>
          {activeDemoUrl ? 'Clinical System' : 'Screenshot'}
        </button>
        <button onClick={() => setMobileTab('chat')}
          className={`flex-1 py-2.5 text-xs font-medium ${mobileTab === 'chat' ? 'text-[#1a73e8] border-b-2 border-[#1a73e8]' : 'text-gray-500'}`}>
          Guidance{assistantCount > 0 ? ` (${assistantCount})` : ''}
        </button>
      </div>

      {/* Main split */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Clinical system panel */}
        <div className={`flex-1 flex-col min-w-0 md:border-r border-gray-200 ${mobileTab === 'screen' ? 'flex' : 'hidden md:flex'}`}>

          {hasContent ? (
            <div className="flex-1 relative overflow-hidden">

              {/* Iframe mode — embedded clinical system */}
              {activeDemoUrl && (
                <iframe
                  ref={iframeRef}
                  src={activeDemoUrl}
                  className="w-full h-full border-none"
                  title="Clinical system"
                />
              )}

              {/* Screenshot mode — uploaded/pasted image */}
              {image && !activeDemoUrl && (
                <div className="w-full h-full overflow-auto bg-[#f3f4f6]">
                  <div className="relative inline-block min-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="Clinical screenshot" className="max-w-full h-auto block" />
                    <CursorOverlay />
                  </div>
                </div>
              )}

              {/* Cursor overlay for iframe mode */}
              {activeDemoUrl && (
                <div className="absolute inset-0 pointer-events-none">
                  <CursorOverlay />
                </div>
              )}

              {/* Floating toolbar — top right */}
              <div className="absolute top-3 right-3 flex items-center gap-2 z-40">
                <button
                  onClick={() => {
                    sendMessage(input || (activeDemoUrl
                      ? DEMO_SCENARIOS.find(d => d.url === activeDemoUrl)?.question || 'What should I do next?'
                      : 'What should I do next?'));
                  }}
                  disabled={isLoading || isCapturing}
                  className="text-xs px-3 py-1.5 bg-[#1a73e8] text-white rounded-lg font-semibold shadow-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  title="Capture current view and ask"
                >
                  {isCapturing ? (
                    <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Analysing…</>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      Ask ScrubIn
                    </>
                  )}
                </button>
                <button
                  onClick={clearAll}
                  className="text-xs px-2.5 py-1.5 bg-white text-gray-500 border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

          ) : (
            /* Getting started screen */
            <div className="flex-1 overflow-y-auto bg-white p-6">
              <div className="max-w-lg mx-auto">
                <h2 className="text-lg font-semibold text-[#1a1a1a] mb-1">Navigate any clinical system with AI</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Open a clinical interface below — ScrubIn watches and guides you step by step, right here on one screen.
                </p>

                {/* How it works */}
                <div className="flex gap-3 mb-7">
                  {[
                    { n: '1', t: 'Open a system', s: 'Choose below or paste a screenshot' },
                    { n: '2', t: 'Ask or Auto-guide', s: 'Type a question or let AI narrate' },
                    { n: '3', t: 'Follow the cursor', s: 'Animated guidance on the real interface' },
                  ].map(s => (
                    <div key={s.n} className="flex-1 bg-[#f3f4f6] rounded-xl p-3 text-center">
                      <div className="w-6 h-6 rounded-full bg-[#1a73e8] text-white text-xs font-bold flex items-center justify-center mx-auto mb-2">{s.n}</div>
                      <p className="text-xs font-semibold text-[#1a1a1a]">{s.t}</p>
                      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{s.s}</p>
                    </div>
                  ))}
                </div>

                {/* Embedded demo scenarios */}
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">Open in ScrubIn</p>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  {DEMO_SCENARIOS.map(s => (
                    <button key={s.url}
                      onClick={() => { setActiveDemoUrl(s.url); setInput(s.question); }}
                      className="flex flex-col items-start p-4 bg-white border-2 border-gray-200 rounded-xl hover:border-[#1a73e8] hover:shadow-md transition-all text-left group">
                      <span className="text-2xl mb-2">{s.icon}</span>
                      <span className="text-sm font-semibold text-[#1a1a1a] group-hover:text-[#1a73e8]">{s.label}</span>
                      <span className="text-xs text-gray-400 mt-0.5 leading-relaxed">{s.sublabel}</span>
                    </button>
                  ))}
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400">or use a screenshot</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Screenshot options */}
                <div className="flex gap-2 mb-5">
                  <button onClick={() => fileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 font-medium">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    Upload
                  </button>
                  <div className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-dashed border-gray-300 rounded-xl text-sm text-gray-400">
                    <kbd className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">⌘V</kbd> Paste
                  </div>
                </div>

                {/* External links */}
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">External sites (paste screenshot)</p>
                <div className="flex gap-2">
                  {EXTERNAL_LINKS.map(l => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
                      className="flex-1 text-center text-xs px-3 py-2 border border-gray-200 rounded-xl text-[#1a73e8] hover:bg-blue-50 transition-colors">
                      {l.label} ↗
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadImageFile(f); e.target.value = ''; }}
          />
        </div>

        {/* Right: Chat panel */}
        <div className={`w-full md:w-96 flex-col bg-white flex-shrink-0 ${mobileTab === 'chat' ? 'flex' : 'hidden md:flex'}`}>
          <div className="px-4 py-2 border-b border-gray-200 flex-shrink-0 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Clinical Guidance</span>
            {messages.length > 0 && (
              <div className="relative">
                <button onClick={() => setShowExportMenu(v => !v)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" title="Export">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-10 w-44" onClick={() => setShowExportMenu(false)}>
                    <button onClick={() => exportAll('copy')} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50">📋 Copy all guidance</button>
                    <button onClick={() => exportAll('markdown')} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50">📄 Download .md file</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#f3f4f6] flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm text-gray-500 font-medium">Ready to guide you</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {hasContent
                      ? 'Press "Ask ScrubIn" or type a question below'
                      : 'Open a clinical system on the left to get started'}
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div key={idx} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <span className="text-xs text-gray-400 px-1 flex items-center gap-1.5">
                  {msg.role === 'user' ? 'You' : 'ScrubIn'}
                  {msg.response?.isAutoGuide && (
                    <span className="text-[10px] bg-[#0d9488] text-white px-1.5 py-0.5 rounded-full font-semibold">AUTO</span>
                  )}
                </span>

                {msg.role === 'user' ? (
                  <div className="bg-[#1a73e8] text-white px-3 py-2 rounded-2xl rounded-tr-sm max-w-[280px] text-sm leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div className="group relative bg-[#f3f4f6] px-3 py-3 rounded-2xl rounded-tl-sm max-w-[280px] text-sm space-y-3">
                    {msg.response?.steps && msg.response.steps.length > 0 && (
                      <div className="space-y-1.5">
                        {msg.response.steps.map((step, sIdx) => {
                          const isLatestMsg = idx === messages.length - 1;
                          const isActive = isLatestMsg && sIdx === currentStepIdx;
                          const isDone = isLatestMsg && sIdx < currentStepIdx;
                          return (
                            <button
                              key={step.number}
                              onClick={() => isLatestMsg && goToStep(sIdx)}
                              className={`w-full flex gap-2.5 items-start text-left p-2 rounded-lg transition-all ${
                                isActive ? 'bg-blue-50 ring-1 ring-[#1a73e8]' :
                                isDone ? 'opacity-50' : 'hover:bg-gray-100'
                              }`}
                            >
                              <span className={`flex-shrink-0 w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center mt-0.5 ${
                                isActive ? 'bg-[#1a73e8]' : isDone ? 'bg-gray-400' : 'bg-[#0d9488]'
                              }`}>
                                {isDone ? '✓' : step.number}
                              </span>
                              <span className={`text-sm leading-relaxed ${isActive ? 'text-[#1a1a1a] font-medium' : 'text-gray-600'}`}>
                                {step.instruction}
                              </span>
                            </button>
                          );
                        })}
                        {/* Next step button — only on latest message */}
                        {idx === messages.length - 1 && currentStepIdx < msg.response.steps.length - 1 && (
                          <button
                            onClick={() => goToStep(currentStepIdx + 1)}
                            className="w-full mt-1 py-2 flex items-center justify-center gap-1.5 bg-[#1a73e8] text-white text-xs font-semibold rounded-xl hover:bg-blue-700 transition-colors"
                          >
                            Done with step {currentStepIdx + 1} — Next →
                          </button>
                        )}
                      </div>
                    )}
                    {msg.response?.context && (
                      <p className={`text-gray-500 text-xs leading-relaxed ${msg.response.steps?.length ? 'border-t border-gray-200 pt-2.5' : ''}`}>
                        {msg.response.context}
                      </p>
                    )}
                    {!msg.response?.steps?.length && !msg.response?.context && (
                      <p className="text-gray-700 leading-relaxed">{msg.content}</p>
                    )}
                    {msg.response?.follow_up && (
                      <p className="text-[#1a73e8] text-xs italic">{msg.response.follow_up}</p>
                    )}
                    {msg.response?.needs_next_screenshot && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 mt-1 py-2 bg-[#1a73e8] text-white text-xs font-semibold rounded-xl hover:bg-blue-700 transition-colors">
                        📸 Upload next screen to continue
                      </button>
                    )}
                    <button onClick={() => copyMessage(msg, idx)}
                      className="absolute -bottom-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50">
                      {copiedIdx === idx
                        ? <svg className="w-3.5 h-3.5 text-[#0d9488]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                        : <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                      }
                    </button>
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex flex-col items-start gap-1">
                <span className="text-xs text-gray-400 px-1">ScrubIn</span>
                <div className="bg-[#f3f4f6] px-4 py-3 rounded-2xl rounded-tl-sm">
                  <div className="flex gap-1">{[0, 150, 300].map(d => <div key={d} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}</div>
                </div>
              </div>
            )}
            {error && <div className="bg-red-50 border border-red-100 text-red-600 text-xs px-3 py-2 rounded-lg">{error}</div>}
            <div ref={chatEndRef} />
          </div>

          <div className="p-3 border-t border-gray-200 flex-shrink-0">
            <div className="flex gap-2 items-end">
              <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder={hasContent ? 'Ask about what you see…' : 'Open a clinical system first…'}
                disabled={!hasContent || isLoading} rows={2}
                className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a73e8] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400 placeholder:text-gray-400 leading-relaxed"
              />
              <button onClick={() => sendMessage(input)} disabled={!input.trim() || !hasContent || isLoading}
                className="flex-shrink-0 w-9 h-9 bg-[#1a73e8] text-white rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5 px-1 hidden sm:block">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      </div>

      {/* Preset scenarios */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-200 bg-white overflow-x-auto flex-shrink-0">
        <span className="text-xs text-gray-400 whitespace-nowrap hidden sm:block">Quick:</span>
        <div className="flex gap-2">
          {PRESET_SCENARIOS.map(s => (
            <button key={s.label}
              onClick={() => { setInput(s.question); if (hasContent) sendMessage(s.question); }}
              className="flex-shrink-0 text-xs px-3 py-1.5 border border-[#1a73e8] text-[#1a73e8] rounded-full hover:bg-blue-50 whitespace-nowrap font-medium">
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 bg-[#f3f4f6] flex-shrink-0">
        <div className="px-4 py-2 border-b border-gray-200">
          <p className="text-xs text-gray-400 text-center">
            Navigation assistance only · Not medical advice · Always follow your trust&apos;s local policies
          </p>
        </div>
        <div className="px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <p className="text-xs text-gray-500 leading-relaxed max-w-2xl">
            <span className="font-semibold text-[#1a1a1a]">Built by Arinze Okemuo</span>, a final-year UCL medical student who ruptured his patellar tendon, spent months unable to navigate research systems from bed, and built the tool he wished existed.
          </p>
          <span className="text-xs text-gray-400 whitespace-nowrap">Cerebral Valley x Anthropic · 2026</span>
        </div>
      </div>
    </div>
  );
}
