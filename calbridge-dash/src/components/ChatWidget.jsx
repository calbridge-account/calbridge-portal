/**
 * ChatWidget.jsx
 *
 * Floating AI chat assistant — appears as a button in the bottom-right corner.
 * Connects to POST /chat (requireAuth + requirePlan('aiChat')).
 * Only rendered for Growth+ plans.
 */

import { useState, useRef, useEffect } from 'react';

// ─── Message bubble ───────────────────────────────────────────────────────────

function Message({ role, content }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
          <span className="text-white text-xs font-bold">AI</span>
        </div>
      )}
      <div
        className={`
          max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
          ${isUser
            ? 'bg-green-700 text-white rounded-br-sm'
            : 'bg-gray-100 text-gray-800 rounded-bl-sm'
          }
        `}
      >
        {content}
      </div>
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="w-6 h-6 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
        <span className="text-white text-xs font-bold">AI</span>
      </div>
      <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// ─── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'What are my top performing campaigns?',
  'Which ASINs are above break-even ACOS?',
  'Where am I wasting ad spend?',
  'What should I optimize first?',
];

// ─── Main widget ─────────────────────────────────────────────────────────────

export default function ChatWidget() {
  const [open, setOpen]       = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const bottomRef             = useRef(null);
  const inputRef              = useRef(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, open]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function sendMessage(text) {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });

      if (res.status === 403) {
        setError('AI chat requires Growth plan or above.');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong');
      }

      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setError(e.message || 'Failed to get a response. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearChat() {
    setMessages([]);
    setError(null);
    // Also clear server-side session history
    fetch('/chat/clear', { method: 'POST', credentials: 'include' }).catch(() => {});
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* ── Floating button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? 'Close AI assistant' : 'Ask AI assistant'}
        className={`
          fixed bottom-6 right-6 z-50
          w-13 h-13 rounded-full shadow-lg
          flex items-center justify-center
          transition-all duration-200
          ${open
            ? 'bg-gray-700 hover:bg-gray-800'
            : 'bg-green-700 hover:bg-green-800'
          }
        `}
        style={{ width: 52, height: 52 }}
      >
        {open ? (
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div
          className="fixed bottom-20 right-6 z-50 w-96 max-h-[70vh] flex flex-col
                     bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
          style={{ maxHeight: '70vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-green-700 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                <span className="text-white text-xs font-bold">AI</span>
              </div>
              <div>
                <div className="text-white font-semibold text-sm">Calbridge AI</div>
                <div className="text-green-200 text-xs">Powered by your data</div>
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                title="Clear conversation"
                className="text-green-200 hover:text-white text-xs transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
            {isEmpty ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="text-3xl mb-3">📊</div>
                <div className="text-sm font-medium text-gray-700 mb-1">Ask about your data</div>
                <div className="text-xs text-gray-400 mb-5">
                  I have live access to your ads, ACOS, margins, and more.
                </div>
                <div className="flex flex-col gap-2 w-full">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="text-xs text-left px-3 py-2 rounded-xl border border-gray-200
                                 text-gray-600 hover:bg-green-50 hover:border-green-300
                                 hover:text-green-800 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <Message key={i} role={m.role} content={m.content} />
                ))}
                {loading && <TypingIndicator />}
                {error && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
                    {error}
                  </div>
                )}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="flex-shrink-0 border-t border-gray-100 px-3 py-3">
            <div className="flex items-end gap-2 bg-gray-50 rounded-xl border border-gray-200 px-3 py-2
                            focus-within:border-green-400 focus-within:ring-1 focus-within:ring-green-400 transition-all">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your campaigns, ACOS, margins…"
                disabled={loading}
                className="flex-1 text-sm bg-transparent outline-none resize-none text-gray-800
                           placeholder-gray-400 disabled:opacity-50 leading-relaxed"
                style={{ maxHeight: 100 }}
                onInput={e => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
                }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || loading}
                className="flex-shrink-0 w-7 h-7 rounded-lg bg-green-700 hover:bg-green-800
                           disabled:opacity-40 disabled:cursor-not-allowed
                           flex items-center justify-center transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-7-7l7 7-7 7" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5 text-center">
              Analysis only — cannot change campaigns or bids
            </p>
          </div>
        </div>
      )}
    </>
  );
}
