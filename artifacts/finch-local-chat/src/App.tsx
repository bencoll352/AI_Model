import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import {
  Activity, ArrowUp, Bot, CircleHelp, Cpu, Database, FileText, LockKeyhole,
  MessageSquare, Plus, RefreshCw, Settings2, ShieldCheck, SlidersHorizontal,
  Square, Trash2, WifiOff,
} from 'lucide-react';

type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
type Conversation = { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[] };
type Model = { name: string; model: string; size: number; modified_at: string };
type Preferences = { temperature: number; num_predict: number; model: string };
type Runtime = { version: string | null; models: Model[]; loading: boolean; error: string | null };

const CONVERSATIONS_KEY = 'finch-local-chat-conversations-v1';
const PREFERENCES_KEY = 'finch-local-chat-preferences-v1';
const DEFAULT_PREFERENCES: Preferences = { temperature: 0.7, num_predict: 1024, model: '' };

function readConversations(): Conversation[] {
  try {
    const value = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function readPreferences(): Preferences {
  try { return { ...DEFAULT_PREFERENCES, ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') }; }
  catch { return DEFAULT_PREFERENCES; }
}

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'size unavailable';
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
}

function Workspace() {
  const [location] = useLocation();
  const [conversations, setConversations] = useState<Conversation[]>(readConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [runtime, setRuntime] = useState<Runtime>({ version: null, models: [], loading: true, error: null });
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null;
  const onSettings = location === '/settings';
  const connected = Boolean(runtime.version);
  const localRuntimeEnabled = import.meta.env.VITE_FINCH_LOCAL_RUNTIME === 'true';

  useEffect(() => {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const loadRuntime = useCallback(async () => {
    if (!localRuntimeEnabled) {
      setRuntime({
        version: null,
        models: [],
        loading: false,
        error: "The Replit preview can't reach Ollama on your PC. Run Finch Local Chat locally on Windows to use your models.",
      });
      return;
    }
    setRuntime((current) => ({ ...current, loading: true, error: null }));
    const [versionResult, modelsResult] = await Promise.allSettled([
      fetch('/ollama/api/version').then(async (response) => {
        if (!response.ok) throw new Error(`Runtime returned ${response.status}`);
        return response.json() as Promise<{ version: string }>;
      }),
      fetch('/ollama/api/tags').then(async (response) => {
        if (!response.ok) throw new Error(`Model list returned ${response.status}`);
        return response.json() as Promise<{ models: Model[] }>;
      }),
    ]);
    const version = versionResult.status === 'fulfilled' ? versionResult.value.version : null;
    const models = modelsResult.status === 'fulfilled' && Array.isArray(modelsResult.value.models)
      ? modelsResult.value.models : [];
    const errors: string[] = [];
    if (versionResult.status === 'rejected') {
      errors.push("Ollama isn't responding at its configured address. Start Ollama on this PC and try again.");
    } else if (modelsResult.status === 'rejected') {
      errors.push("Ollama is responding, but its installed model list couldn't be loaded.");
    }
    setRuntime({ version, models, loading: false, error: errors.length ? errors.join(' ') : null });
    setPreferences((current) => {
      const preferredAvailable = models.some((model) => model.name === current.model || model.model === current.model);
      return { ...current, model: preferredAvailable ? current.model : (models[0]?.name || models[0]?.model || '') };
    });
  }, [localRuntimeEnabled]);

  useEffect(() => { void loadRuntime(); }, [loadRuntime]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeConversation?.messages.length, activeConversation?.messages.at(-1)?.content, streaming]);

  const updateConversation = useCallback((id: string, updater: (conversation: Conversation) => Conversation) => {
    setConversations((items) => items.map((item) => item.id === id ? updater(item) : item));
  }, []);

  const createConversation = () => {
    const now = new Date().toISOString();
    const conversation: Conversation = { id: makeId(), title: 'New conversation', createdAt: now, updatedAt: now, messages: [] };
    setConversations((items) => [conversation, ...items]);
    setActiveId(conversation.id);
    setChatError(null);
    setDraft('');
  };

  const deleteConversation = (id: string) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation || !window.confirm(`Delete “${conversation.title}”? This cannot be undone.`)) return;
    setConversations((items) => items.filter((item) => item.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const stopGeneration = () => abortRef.current?.abort();

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || streaming || !preferences.model || !connected) return;
    let conversation = activeConversation;
    if (!conversation) {
      const now = new Date().toISOString();
      conversation = { id: makeId(), title: content.slice(0, 48), createdAt: now, updatedAt: now, messages: [] };
      setConversations((items) => [conversation!, ...items]);
      setActiveId(conversation.id);
    }
    const conversationId = conversation.id;
    const userMessage: Message = { id: makeId(), role: 'user', content, createdAt: new Date().toISOString() };
    const assistantMessage: Message = { id: makeId(), role: 'assistant', content: '', createdAt: new Date().toISOString() };
    const requestMessages = [...conversation.messages, userMessage].map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    setDraft('');
    setChatError(null);
    setStreaming(true);
    updateConversation(conversationId, (item) => ({
      ...item,
      title: item.messages.length === 0 ? content.slice(0, 48) : item.title,
      updatedAt: userMessage.createdAt,
      messages: [...item.messages, userMessage, assistantMessage],
    }));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/ollama/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: preferences.model,
          messages: requestMessages,
          stream: true,
          options: { temperature: preferences.temperature, num_predict: preferences.num_predict },
        }),
      });
      if (!response.ok) throw new Error(`Chat request failed (${response.status}). Check that Ollama is running and try again.`);
      if (!response.body) throw new Error('The local runtime did not return a readable response.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.message?.content) {
            const addition = chunk.message.content;
            updateConversation(conversationId, (item) => ({
              ...item,
              updatedAt: new Date().toISOString(),
              messages: item.messages.map((message) => message.id === assistantMessage.id
                ? { ...message, content: message.content + addition } : message),
            }));
          }
          if (chunk.done) finished = true;
        }
        if (done) finished = true;
      }
      if (buffer.trim()) {
        const chunk = JSON.parse(buffer) as { message?: { content?: string }; done?: boolean; error?: string };
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.message?.content) {
          const addition = chunk.message.content;
          updateConversation(conversationId, (item) => ({
            ...item,
            messages: item.messages.map((message) => message.id === assistantMessage.id ? { ...message, content: message.content + addition } : message),
          }));
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        updateConversation(conversationId, (item) => ({
          ...item,
          messages: item.messages.filter((entry) => entry.id !== assistantMessage.id || entry.content.length > 0),
        }));
      } else {
        const message = error instanceof Error ? error.message : 'The local model could not complete this response.';
        setChatError(message);
        updateConversation(conversationId, (item) => ({
          ...item,
          messages: item.messages.filter((entry) => entry.id !== assistantMessage.id || entry.content.length > 0),
        }));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void sendMessage(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  };
  const updatePreference = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  return (
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark"><Cpu size={19} strokeWidth={2.2} /></div>
            <div><div className="brand-name">finch</div><div className="brand-sub">local workspace</div></div>
          </div>
          <button className="side-action" data-testid="button-new-conversation" onClick={createConversation}>
            <Plus size={16} /><span>New conversation</span>
          </button>
          <div className="side-label">Your conversations</div>
          <div className="history-list" data-testid="list-conversations">
            {conversations.length === 0 && <div style={{ padding: '8px 10px', color: '#839496', fontSize: 11 }}>Your chats will live here.</div>}
            {conversations.map((conversation) => (
              <div key={conversation.id} className={`history-item ${activeId === conversation.id ? 'active' : ''}`} data-testid={`conversation-item-${conversation.id}`}>
                <button className="history-item" style={{ padding: 0, minHeight: 'unset', flex: 1, width: 'auto' }} onClick={() => { setActiveId(conversation.id); setChatError(null); }} data-testid={`button-select-conversation-${conversation.id}`}>
                  <MessageSquare size={13} /><span className="history-title">{conversation.title}</span>
                </button>
                <button className="delete-chat" aria-label={`Delete ${conversation.title}`} title="Delete conversation" onClick={() => deleteConversation(conversation.id)} data-testid={`button-delete-conversation-${conversation.id}`}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <div className="side-bottom">
            <Link href="/" className={`nav-link ${!onSettings ? 'selected' : ''}`} data-testid="link-chat"><MessageSquare size={15} />Chat</Link>
            <Link href="/settings" className={`nav-link ${onSettings ? 'selected' : ''}`} data-testid="link-settings"><Settings2 size={15} />Settings</Link>
            <div className="local-note"><LockKeyhole size={14} /><span>Your messages stay on this device and go directly to your local model.</span></div>
          </div>
        </aside>

        <main className="main-area">
          <header className="topbar">
            <div className="crumb"><span>Finch</span><span>/</span><strong>{onSettings ? 'Settings' : 'Chat'}</strong></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {!onSettings && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#72817e' }}>
                  <span style={{ font: '9px "DM Mono",monospace', textTransform: 'uppercase', letterSpacing: '.08em' }}>Model</span>
                  <select aria-label="Choose model" className="model-select" style={{ width: 'auto', minWidth: 105, padding: '7px 27px 7px 9px', fontSize: 10 }} value={preferences.model} onChange={(event) => updatePreference('model', event.target.value)} disabled={runtime.models.length === 0} data-testid="select-model">
                    {runtime.models.length === 0 && <option value="">No models</option>}
                    {runtime.models.map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}
                  </select>
                </label>
              )}
              <div className="runtime-pill" data-testid="status-runtime">
                <span className={`status-dot ${connected ? 'online' : ''}`} />
                <span>{runtime.loading ? 'Checking runtime' : connected ? `Ollama ${runtime.version}` : 'Runtime offline'}</span>
              </div>
            </div>
          </header>
          <div className="content">
            <Switch>
              <Route path="/">
                <section className="chat-page" aria-label="Local chat">
                  <div className="chat-scroll" ref={scrollRef} data-testid="chat-message-list">
                    <div className="chat-inner">
                      {activeConversation?.messages.length ? (
                        <div className="messages">
                          {activeConversation.messages.map((message) => (
                            <article className="message-row" key={message.id} data-testid={`message-${message.id}`}>
                              <div className={`message-avatar ${message.role === 'user' ? 'user' : ''}`}>{message.role === 'user' ? <FileText size={15} /> : <Bot size={16} />}</div>
                              <div>
                                <div className="message-meta">{message.role === 'user' ? 'YOU' : 'FINCH'} · {formatTime(message.createdAt)}</div>
                                {message.content ? <div className={`message-content ${message.role === 'user' ? 'user-content' : ''}`}>{message.content}</div> : streaming && <div className="typing" data-testid="status-generating">Thinking locally…</div>}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="welcome">
                          <div className="eyebrow"><span className={`status-dot ${connected ? 'online' : ''}`} />A quieter kind of AI</div>
                          <h1>Think clearly.<br /><span>Stay local.</span></h1>
                          <p className="welcome-copy">A private space to work with the models running on your own PC. Your words stay on your machine, from first prompt to final thought.</p>
                          <div className="welcome-line" />
                          {runtime.models.length > 0 && (
                            <div className="prompt-hints">
                              {['Help me untangle an idea', 'Summarize a passage', 'Draft a quick outline'].map((hint) => (
                                <button key={hint} className="hint" onClick={() => { setDraft(hint); textareaRef.current?.focus(); }} data-testid={`button-prompt-${hint.toLowerCase().replaceAll(' ', '-')}`}>{hint}</button>
                              ))}
                            </div>
                          )}
                          {!runtime.loading && !connected && <div className="inline-error" role="status" data-testid="status-chat-disconnected">Finch can’t reach Ollama yet. Start Ollama on this PC, then check the connection in Settings.</div>}
                          {!runtime.loading && connected && runtime.models.length === 0 && <div className="no-models" data-testid="status-no-models">Ollama is responding, but no models are installed. Follow the Windows setup steps in Settings to pull your first model.</div>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="composer-wrap">
                    {chatError && <div className="inline-error" style={{ maxWidth: 860, margin: '0 auto 10px' }} role="alert" data-testid="status-chat-error">{chatError}</div>}
                    <form className="composer" onSubmit={submit}>
                      <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder={connected ? 'Message your local model…' : 'Start Ollama to begin a local conversation'} aria-label="Message your local model" data-testid="input-chat-message" disabled={!connected || !preferences.model || streaming} />
                      <div className="composer-controls">
                        <div className="composer-model"><LockKeyhole size={12} /><span>{preferences.model || 'No model selected'}</span></div>
                        {streaming ? (
                          <button type="button" className="send-button stop" onClick={stopGeneration} aria-label="Stop generation" title="Stop generation" data-testid="button-stop-generation"><Square size={13} fill="currentColor" /></button>
                        ) : (
                          <button type="submit" className="send-button" disabled={!draft.trim() || !connected || !preferences.model} aria-label="Send message" title="Send message" data-testid="button-send-message"><ArrowUp size={17} /></button>
                        )}
                      </div>
                    </form>
                    <div className="composer-foot">LOCAL MODEL · NO CLOUD ROUTING · SHIFT + ENTER FOR A NEW LINE</div>
                  </div>
                </section>
              </Route>
              <Route path="/settings">
                <section className="settings-page">
                  <div className="settings-heading">
                    <div className="eyebrow"><SlidersHorizontal size={13} />Workspace controls</div>
                    <h1>Settings</h1>
                    <p>Connection, model and response behavior — all kept on this device.</p>
                  </div>
                  <div className="settings-grid">
                    <section className="settings-card" data-testid="card-runtime-status">
                      <h2 className="card-title"><span className="card-icon"><Activity size={15} /></span>Runtime connection</h2>
                      <p className="card-desc">Finch talks to the Ollama service running on this PC.</p>
                      <div className="connection-row"><span className="connection-label">Status</span><span className="connection-value" data-testid="text-connection-status"><span className={`status-dot ${connected ? 'online' : ''}`} />{runtime.loading ? 'Checking…' : connected ? 'Connected' : 'Not connected'}</span></div>
                      <div className="connection-row"><span className="connection-label">Ollama version</span><span className="connection-value" data-testid="text-runtime-version">{runtime.version || (runtime.loading ? 'Checking…' : 'Unavailable')}</span></div>
                      <div className="connection-row"><span className="connection-label">Installed models</span><span className="connection-value" data-testid="text-model-count">{runtime.loading ? 'Checking…' : `${runtime.models.length} ${runtime.models.length === 1 ? 'model' : 'models'}`}</span></div>
                      {runtime.error && <div className="inline-error" data-testid="status-runtime-error">{runtime.error}</div>}
                      <button className="refresh-button" onClick={() => void loadRuntime()} disabled={runtime.loading} style={{ marginTop: 12 }} data-testid="button-refresh-runtime"><RefreshCw size={13} className={runtime.loading ? 'spin' : ''} />{runtime.loading ? 'Checking connection' : 'Check connection'}</button>
                    </section>
                    <section className="settings-card">
                      <h2 className="card-title"><span className="card-icon"><Database size={15} /></span>Available models</h2>
                      <p className="card-desc">Choose a model that is installed in your local Ollama library.</p>
                      {runtime.loading ? <div className="loading-shimmer" data-testid="loading-models" /> : runtime.models.length ? (
                        <>
                          <select className="model-select" value={preferences.model} onChange={(event) => updatePreference('model', event.target.value)} aria-label="Select active model" data-testid="select-settings-model">
                            {runtime.models.map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}
                          </select>
                          {runtime.models.filter((model) => model.name === preferences.model || model.model === preferences.model).map((model) => <div className="model-info" key={model.name}>{formatBytes(model.size)} · updated {formatTime(model.modified_at)}</div>)}
                        </>
                      ) : <div className="no-models" data-testid="empty-model-list">{connected ? 'No models found. Install one using the Windows instructions below.' : 'Model inventory is unavailable until Finch can connect to Ollama.'}</div>}
                    </section>
                    <section className="settings-card wide">
                      <h2 className="card-title"><span className="card-icon"><SlidersHorizontal size={15} /></span>Generation preferences</h2>
                      <p className="card-desc">These values are sent with each local chat request and stored only in this browser.</p>
                      <div className="settings-grid" style={{ gap: '0 24px' }}>
                        <div className="setting-control">
                          <div className="setting-control-head"><label htmlFor="temperature">Temperature</label><output data-testid="value-temperature">{preferences.temperature.toFixed(1)}</output></div>
                          <input id="temperature" type="range" min="0" max="2" step="0.1" value={preferences.temperature} onChange={(event) => updatePreference('temperature', Number(event.target.value))} data-testid="input-temperature" />
                          <div className="control-help">Lower is more focused; higher is more exploratory.</div>
                        </div>
                        <div className="setting-control">
                          <div className="setting-control-head"><label htmlFor="max-tokens">Maximum response length</label><output data-testid="value-max-tokens">{preferences.num_predict.toLocaleString()}</output></div>
                          <input id="max-tokens" type="range" min="128" max="4096" step="128" value={preferences.num_predict} onChange={(event) => updatePreference('num_predict', Number(event.target.value))} data-testid="input-max-tokens" />
                          <div className="control-help">Upper limit for generated tokens per response.</div>
                        </div>
                      </div>
                    </section>
                    <section className="settings-card wide">
                      <h2 className="card-title"><span className="card-icon"><CircleHelp size={15} /></span>Get Ollama running on Windows</h2>
                      <p className="card-desc">A short path from a fresh install to your first private conversation.</p>
                      <ol className="setup-steps" data-testid="list-windows-setup">
                        <li><span><strong>Install Ollama for Windows.</strong> Download the installer from <span className="code-chip">ollama.com/download/windows</span> and run it. Ollama will run in the background after setup.</span></li>
                        <li><span><strong>Open PowerShell</strong> from the Start menu and download a model, for example <span className="code-chip">ollama pull llama3.2</span>. The model is stored on your PC.</span></li>
                        <li><span><strong>Wait for the download to finish</strong>, then choose Check connection above. Your installed model will appear in Available models.</span></li>
                        <li><span><strong>Keep Ollama running.</strong> Finch sends prompts to your local Ollama service; it does not send chat content to a hosted AI provider.</span></li>
                      </ol>
                      {!connected && !runtime.loading && <div className="inline-error" role="status" data-testid="status-setup-needed">Connection isn’t available yet. Check that the Ollama app is running, then try again.</div>}
                    </section>
                    <section className="settings-card wide" style={{ background: '#e9efe7', borderColor: '#d7e2d5' }}>
                      <h2 className="card-title"><span className="card-icon"><ShieldCheck size={15} /></span>Local by design</h2>
                      <p className="card-desc" style={{ marginBottom: 0 }}>Conversation history and preferences stay in this browser’s local storage. Prompts are sent only to the Ollama endpoint configured for this workspace. Finch does not relay them to a cloud model provider.</p>
                    </section>
                  </div>
                </section>
              </Route>
              <Route>
                <section className="empty-conversation"><WifiOff size={25} /><h2>That page isn’t here</h2><p>Head back to your local workspace to pick up where you left off.</p><Link href="/" className="refresh-button" data-testid="link-return-chat">Return to chat</Link></section>
              </Route>
            </Switch>
          </div>
        </main>
      </div>
  );
}

function App() {
  return <Router><Workspace /></Router>;
}

export default App;
