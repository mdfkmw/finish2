import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CAN_CHAT_ROLES = new Set(['admin', 'operator_admin', 'agent']);
const POLL_INTERVAL_MS = 5000;
const MAX_MESSAGES = 500;



function formatTimestamp(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat('ro-RO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  } catch {
    return value;
  }
}

function sanitizeMessages(existing, incoming) {
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;
  const map = new Map(existing.map((msg) => [msg.id, msg]));
  for (const msg of incoming) {
    if (!map.has(msg.id)) {
      map.set(msg.id, msg);
    }
  }
  const merged = Array.from(map.values());
  merged.sort((a, b) => a.id - b.id);
  if (merged.length > MAX_MESSAGES) {
    return merged.slice(merged.length - MAX_MESSAGES);
  }
  return merged;
}

export default function AgentChatPopup({ user }) {
  const [viewerUrl, setViewerUrl] = useState(null);
  const openViewer = (url) => setViewerUrl(url);
  const closeViewer = () => setViewerUrl(null);
  // ESC pentru închiderea viewer-ului (trebuie să fie în interiorul componentei)
  useEffect(() => {
    if (!viewerUrl) return;
    const onKey = (e) => { if (e.key === 'Escape') closeViewer(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerUrl]);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [lastReadId, setLastReadId] = useState(0);
  const pollingRef = useRef(null);
  const lastMessageIdRef = useRef(0);
  const chatBodyRef = useRef(null);
  const isMountedRef = useRef(true);
  const fileInputRef = useRef(null);

  const storageKey = useMemo(() => {
    if (!user?.id) return null;
    return `agent-chat:last-read:${user.id}`;
  }, [user?.id]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = Number(window.localStorage.getItem(storageKey) || '0');
      if (Number.isFinite(saved) && saved > 0) setLastReadId(saved);
    } catch { }
  }, [storageKey]);

  const markAsRead = useCallback((latestId) => {
    if (!storageKey) return;
    const finalId = Number(latestId) || 0;
    setLastReadId(finalId);
    setHasUnread(false);
    try { window.localStorage.setItem(storageKey, String(finalId)); } catch { }
  }, [storageKey]);

  const fetchMessages = useCallback(async () => {
    if (!CAN_CHAT_ROLES.has(user?.role)) return;
    const lastId = lastMessageIdRef.current;
    const url = lastId > 0 ? `/api/chat/messages?afterId=${lastId}` : '/api/chat/messages?limit=100';
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('chat fetch error');
      const data = await res.json();
      const incoming = Array.isArray(data?.messages) ? data.messages : [];
      if (incoming.length === 0) return;
      setMessages((prev) => {
        const merged = sanitizeMessages(prev, incoming);
        const newest = merged[merged.length - 1];
        if (newest?.id) {
          lastMessageIdRef.current = newest.id;
          if (!isOpen && newest.id > lastReadId) setHasUnread(true);
        }
        return merged;
      });
    } catch (err) {
      if (import.meta.env.DEV) console.error('[chat] nu am putut prelua mesaje', err);
    }
  }, [isOpen, lastReadId, user?.role]);

  useEffect(() => {
    if (!CAN_CHAT_ROLES.has(user?.role)) return;
    fetchMessages();
    pollingRef.current = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => { clearInterval(pollingRef.current); pollingRef.current = null; };
  }, [fetchMessages, user?.role]);

  useEffect(() => {
    if (!isOpen || messages.length === 0) return;
    const newest = messages[messages.length - 1];
    if (newest?.id) markAsRead(newest.id);
    if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }, [isOpen, messages, markAsRead]);

  const handleToggle = () => {
    setIsOpen((prev) => {
      const next = !prev;
      if (!next) return next;
      const newest = messages[messages.length - 1];
      if (newest?.id) markAsRead(newest.id);
      setTimeout(() => {
        if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
      }, 0);
      return next;
    });
  };

  const sendMessage = async ({ content, attachmentUrl, attachmentType }) => {
    const body = {
      content: content?.trim() || '',
      attachmentType: attachmentUrl ? (attachmentType || 'image') : null,
      attachmentUrl: attachmentUrl || null
    };
    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || 'Nu am putut trimite mesajul.');
    }
    const data = await res.json();
    const newMessage = data?.message;
    if (newMessage) {
      setMessages((prev) => sanitizeMessages(prev, [newMessage]));
      lastMessageIdRef.current = newMessage.id;
      markAsRead(newMessage.id);
      setTimeout(() => {
        if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
      }, 0);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    const content = input.trim();
    if (!content) { setError('Scrie un mesaj.'); return; }
    setIsSending(true);
    try {
      await sendMessage({ content });
      setInput('');
    } catch (err) {
      setError(err.message || 'Nu am putut trimite mesajul.');
    } finally {
      if (isMountedRef.current) setIsSending(false);
    }
  };

  const handlePickImage = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset input pentru a permite același fișier din nou
    if (!file) return;
    setError(null);
    setIsSending(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        credentials: 'include',
        body: fd
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Upload eșuat.');
      }
      const data = await res.json();
      const url = data?.url;
      if (!url) throw new Error('Răspuns invalid de la upload.');
      // trimitem mesaj cu atașament imagine
      await sendMessage({ content: '', attachmentUrl: url, attachmentType: 'image' });
    } catch (err) {
      setError(err.message || 'Nu am putut încărca imaginea.');
    } finally {
      if (isMountedRef.current) setIsSending(false);
    }
  };

  if (!user || !CAN_CHAT_ROLES.has(user.role)) return null;

  const newestId = messages.length ? messages[messages.length - 1].id : lastReadId;

  return (
    <div className="fixed bottom-4 right-9 z-50">
      <button
        type="button"
        onClick={handleToggle}
        className="relative rounded-full bg-transparent text-blue-600 px-5 py-3 shadow-lg border border-blue-600 hover:bg-blue-50 transition"
      >
        Chat agenți
        {(hasUnread || (newestId > lastReadId && !isOpen)) && (
          <span className="absolute -top-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-semibold">
            !
          </span>
        )}
      </button>

{isOpen && (
   <div className="mt-3 w-96 max-w-[90vw] max-h-[40vh] rounded-lg bg-white shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Chatul agenților</p>
              <p className="text-xs text-gray-500">Mesaje text sau imagine.</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Închide chatul"
            >
              ×
            </button>
          </div>

          <div ref={chatBodyRef} className="flex-1 overflow-y-auto px-4 py-3 bg-gray-50 space-y-3">
            {messages.length === 0 ? (
              <p className="text-center text-sm text-gray-500">Încă nu există mesaje. Spune primul salut!</p>
            ) : (
              messages.map((message) => {
                const isMine = message.userId === user.id;
                return (
                  <div key={message.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="font-medium text-gray-700">{message.authorName || 'Agent'}</span>
                      <span>{formatTimestamp(message.createdAt)}</span>
                    </div>
                    <div
                      className={`mt-1 max-w-full rounded-lg px-3 py-2 text-sm shadow ${isMine ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none'
                        }`}
                    >
                      {message.content && (
                        <div className="whitespace-pre-wrap break-words">{message.content}</div>
                      )}
                      {message.attachmentUrl && message.attachmentType === 'image' && (
                        (() => {
                          const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
                          const imgSrc = message.attachmentUrl?.startsWith('/uploads/')
                            ? `${API_BASE}${message.attachmentUrl}`
                            : message.attachmentUrl;
                          return (
                            <img
                              src={imgSrc}
                              alt="Imagine trimisă"
                              className="mt-2 max-h-48 w-auto rounded cursor-zoom-in"
                              loading="lazy"
                              onClick={() => openViewer(imgSrc)}
                            />
                          );
                        })()
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-gray-200 px-4 py-3 space-y-2">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={2}
              placeholder="Scrie mesajul aici..."
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={handlePickImage}
                  className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                  disabled={isSending}
                >
                  📷 Imagine
                </button>
              </div>
              <button
                type="submit"
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={isSending}
              >
                {isSending ? 'Se trimite...' : 'Trimite'}
              </button>
            </div>
          </form>
          {viewerUrl && (
            <div
              className="fixed inset-0 z-[999] bg-black/70 flex items-center justify-center p-4"
              onClick={closeViewer}
              role="dialog"
              aria-modal="true"
            >
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={closeViewer}
                  className="absolute -top-3 -right-3 bg-white rounded-full w-8 h-8 grid place-items-center shadow"
                  aria-label="Închide"
                  title="Închide"
                >
                  ×
                </button>
                <img
                  src={viewerUrl}
                  alt="Imagine"
                  className="max-h-[90vh] max-w-[90vw] rounded shadow-lg"
                />
                <div className="mt-2 text-center">
                  <a
                    href={viewerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-white underline text-sm"
                    title="Deschide într-un tab nou"
                  >
                    Deschide în tab nou
                  </a>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
