import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import {
  Activity, ArrowUp, Bot, CheckCircle2, CircleHelp, Cpu, Database, FileText,
  Image as ImageIcon, LockKeyhole, MessageSquare, Mic, Play, Plus, RefreshCw,
  Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Square, Trash2, Users,
  Volume2, WifiOff, FolderDown, Copy, Check, UploadCloud, AlertCircle, ExternalLink,
} from 'lucide-react';
import { WorkflowStudio, type WorkflowTemplate } from './components/WorkflowStudio';

type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
type Conversation = { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[]; personaId?: number };
type Model = { name: string; model: string; size: number; modified_at: string };
type Preferences = {
  temperature: number;
  num_predict: number;
  model: string;
  activeVoice: string;
  activePersonaId: number | null;
  inferenceBackend: 'ollama' | 'g4f';
};
type Runtime = { version: string | null; models: Model[]; loading: boolean; error: string | null };

export const G4F_PRESET_MODELS = [
  { id: 'deepseek-r1', name: 'DeepSeek-R1 (671B Full Reasoning)', notes: 'Chain-of-thought <think> reasoning tokens' },
  { id: 'gpt-4o', name: 'OpenAI GPT-4o', notes: 'Top-tier frontier intelligence' },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', notes: 'Nuanced storytelling & emotional depth' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', notes: 'Ultra-fast response & massive context' },
  { id: 'qwen-2.5-coder-32b', name: 'Qwen 2.5 Coder 32B', notes: 'Top-tier coding and structured logic' },
];

type AiGirlPersona = {
  id: number;
  name: string;
  description: string;
  image_url: string;
  voice_url: string;
  prompt?: string;
  voice_text?: string;
  voice_id?: string;
  model?: string;
  created_at: string;
};

type LuStatus = {
  ollama: { running: boolean; version: string | null; models: string[] };
  comfyui: { installed: boolean; path: string | null; running: boolean; url: string; logs: string[] };
  voice: { available: boolean; engine: string; voices: string[] };
  database: { postgresConfigured: boolean; supabaseConfigured: boolean; supabaseUrl: string };
  engines?: Array<{ id: string; name: string; port: number; url: string; running: boolean; models?: string[]; type: string }>;
  catalog: {
    text: Array<{ name: string; tag: string; size: string; vram: string; notes: string }>;
    image: Array<{ name: string; vram: string; notes: string }>;
    voices: string[];
  };
};

const CONVERSATIONS_KEY = 'finch-local-chat-conversations-v1';
const PREFERENCES_KEY = 'finch-local-chat-preferences-v1';
const DEFAULT_PREFERENCES: Preferences = {
  temperature: 0.7,
  num_predict: 1024,
  model: '',
  activeVoice: 'Alba',
  activePersonaId: null,
  inferenceBackend: 'ollama',
};

const DEFAULT_VOICES = [
  'Alba', 'Anna', 'Azelma', 'Charles', 'Eponine', 'Eve', 'Fantine',
  'George', 'Jane', 'Javert', 'Marius', 'Mary', 'Michael', 'Paul', 'Vera',
];

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

function parseReasoningTrace(content: string): { thinking: string | null; response: string; isThinking: boolean } {
  if (!content) return { thinking: null, response: '', isThinking: false };

  // Match closed <think>...</think>
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim();
    const response = content.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
    return { thinking, response, isThinking: false };
  }

  // Match unclosed <think>... (streaming mode)
  if (content.toLowerCase().startsWith('<think>')) {
    const thinking = content.slice(7).trim();
    return { thinking, response: '', isThinking: true };
  }

  return { thinking: null, response: content, isThinking: false };
}


function Workspace() {
  const [location, setLocation] = useLocation();
  const [conversations, setConversations] = useState<Conversation[]>(readConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [runtime, setRuntime] = useState<Runtime>({ version: null, models: [], loading: true, error: null });
  const [luStatus, setLuStatus] = useState<LuStatus | null>(null);
  const [personas, setPersonas] = useState<AiGirlPersona[]>([]);
  const [storageEngine, setStorageEngine] = useState<string>('local_json');

  // Chat state
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Create Studio & Persona form state (pre-populated with user's AI Girl snippet)
  const [personaName, setPersonaName] = useState('AI Girl');
  const [personaDesc, setPersonaDesc] = useState('A sexy and intelligent AI girl with a mysterious past.');
  const [artPrompt, setArtPrompt] = useState('Create an image of a sexy AI girl with long, wavy hair, wearing a revealing outfit, standing in a futuristic cityscape.');
  const [voiceText, setVoiceText] = useState("Hello, I am AI Girl. I'm here to make your dreams come true.");
  const [selectedVoice, setSelectedVoice] = useState('Alba');
  const [generatingPersona, setGeneratingPersona] = useState(false);
  const [generatingArtOnly, setGeneratingArtOnly] = useState(false);
  const [generatingVoiceOnly, setGeneratingVoiceOnly] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string>('');
  const [previewVoiceUrl, setPreviewVoiceUrl] = useState<string>('');
  const [studioStatusMsg, setStudioStatusMsg] = useState<string | null>(null);

  // Supabase config state
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [supabaseSavedMsg, setSupabaseSavedMsg] = useState<string | null>(null);

  // Talking Avatar & LipSync state
  const [talkingAvatarMap, setTalkingAvatarMap] = useState<Record<number, string>>({});
  const [generatingLipSyncId, setGeneratingLipSyncId] = useState<number | null>(null);

  // GPT4Free (G4F) Frontier Engine state
  const [g4fStatus, setG4fStatus] = useState<{ running: boolean; port: number; models: Array<{ id: string; name: string; notes: string }> } | null>(null);
  const [startingG4f, setStartingG4f] = useState(false);

  // SenseVoice & Multimodal Voice state (QwenAudio/SenseVoice + Edge Natural Neural TTS)
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [processingVoice, setProcessingVoice] = useState(false);
  const [detectedEmotion, setDetectedEmotion] = useState<{ emotion: string; nuance: string; events: string[] } | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Node-Banana Generative Workflows state (shrimbly/node-banana)
  const [nodeBananaWorkflows, setNodeBananaWorkflows] = useState<WorkflowTemplate[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('wf-lifelike-portrait');
  const [workflowPrompt, setWorkflowPrompt] = useState('Lifelike photorealistic AI companion with natural smile in modern loft');
  const [runningWorkflow, setRunningWorkflow] = useState(false);
  const [workflowResult, setWorkflowResult] = useState<{ imageUrl?: string; provider?: string; enhancedPrompt?: string } | null>(null);


  // Character.AI Importer state
  const [caiPreview, setCaiPreview] = useState<{
    source: string;
    exportedAt: string;
    user: { id?: string; username?: string; name?: string } | null;
    personas: Array<{ title?: string; definition?: string }>;
    characters: Array<{
      externalId: string;
      name: string;
      description: string;
      prompt: string;
      voiceText: string;
      voiceId: string;
      imageUrl: string;
      chats: Array<{
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messages: Message[];
      }>;
    }>;
    totalChats: number;
    totalMessages: number;
  } | null>(null);
  const [selectedChars, setSelectedChars] = useState<Record<string, boolean>>({});
  const [importVoiceChoices, setImportVoiceChoices] = useState<Record<string, string>>({});
  const [parsingCai, setParsingCai] = useState(false);
  const [importingCai, setImportingCai] = useState(false);
  const [caiStatusMsg, setCaiStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [bookmarkletCopied, setBookmarkletCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const BOOKMARKLET_CODE = `javascript:(function(){const s=document.createElement('script');s.src='https://trymorse.ai/cai-exporter.js';document.body.appendChild(s);})();`;

  const copyBookmarklet = () => {
    navigator.clipboard.writeText(BOOKMARKLET_CODE);
    setBookmarkletCopied(true);
    setTimeout(() => setBookmarkletCopied(false), 3000);
  };

  const handleCaiFile = async (file: File) => {
    setCaiStatusMsg(null);
    setParsingCai(true);
    try {
      const text = await file.text();
      const parsedData = JSON.parse(text);
      const res = await fetch('/api/lu/cai/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: parsedData }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to parse Character.AI export file');
      }
      const data = await res.json();
      setCaiPreview(data);
      const initialSelected: Record<string, boolean> = {};
      const initialVoices: Record<string, string> = {};
      for (const char of data.characters || []) {
        initialSelected[char.externalId] = true;
        initialVoices[char.externalId] = char.voiceId || 'Alba';
      }
      setSelectedChars(initialSelected);
      setImportVoiceChoices(initialVoices);
      setCaiStatusMsg({
        type: 'info',
        text: `Export parsed successfully! Found ${data.characters?.length || 0} characters, ${data.totalChats || 0} chats, and ${data.totalMessages || 0} messages.`,
      });
    } catch (err: any) {
      setCaiStatusMsg({ type: 'error', text: err?.message || 'Failed to read or parse file' });
    } finally {
      setParsingCai(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!caiPreview || !caiPreview.characters) return;
    const toImport = caiPreview.characters
      .filter((c) => selectedChars[c.externalId])
      .map((c) => ({
        ...c,
        voiceId: importVoiceChoices[c.externalId] || c.voiceId || 'Alba',
      }));

    if (toImport.length === 0) {
      setCaiStatusMsg({ type: 'error', text: 'Please select at least one character to import.' });
      return;
    }

    setImportingCai(true);
    setCaiStatusMsg({ type: 'info', text: `Importing ${toImport.length} character(s) and restoring chats...` });

    try {
      const res = await fetch('/api/lu/cai/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characters: toImport }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Import request failed');
      }

      const result = await res.json();
      await loadLuStudio();

      if (Array.isArray(result.conversations) && result.conversations.length > 0) {
        setConversations((prev) => {
          const prevMap = new Map(prev.map((c) => [c.id, c]));
          for (const conv of result.conversations) {
            prevMap.set(conv.id, conv);
          }
          return Array.from(prevMap.values());
        });
      }

      setCaiStatusMsg({
        type: 'success',
        text: `Successfully imported ${result.count} character(s) and restored ${result.conversations?.length || 0} conversation history entries!`,
      });
    } catch (err: any) {
      setCaiStatusMsg({ type: 'error', text: err?.message || 'Error executing import' });
    } finally {
      setImportingCai(false);
    }
  };

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null;
  const activePersona = personas.find((p) => p.id === preferences.activePersonaId) || null;
  const connected = preferences.inferenceBackend === 'g4f'
    ? Boolean(g4fStatus?.running)
    : Boolean(runtime.version);

  useEffect(() => {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const loadLuStudio = useCallback(async () => {
    try {
      const [statusRes, girlsRes, g4fRes, wfRes] = await Promise.all([
        fetch('/api/lu/status'),
        fetch('/api/lu/ai-girls'),
        fetch('/api/lu/g4f/status'),
        fetch('/api/lu/workflows/node-banana'),
      ]);
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as LuStatus;
        setLuStatus(statusData);
      }
      if (girlsRes.ok) {
        const girlsData = (await girlsRes.json()) as { items: AiGirlPersona[]; storage: string };
        setPersonas(girlsData.items || []);
        setStorageEngine(girlsData.storage || 'local_json');
      }
      if (g4fRes.ok) {
        const g4fData = (await g4fRes.json()) as { running: boolean; port: number; models: Array<{ id: string; name: string; notes: string }> };
        setG4fStatus(g4fData);
      }
      if (wfRes && wfRes.ok) {
        const wfData = await wfRes.json();
        if (Array.isArray(wfData.workflows)) {
          setNodeBananaWorkflows(wfData.workflows);
        }
      }
    } catch {
      /* API server might be starting */
    }
  }, []);

  const loadRuntime = useCallback(async () => {
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
      errors.push("Ollama isn't responding at 127.0.0.1:11434. Start Ollama on this PC or use Create & Voice Studio.");
    } else if (modelsResult.status === 'rejected') {
      errors.push("Ollama is responding, but its installed model list couldn't be loaded.");
    }
    setRuntime({ version, models, loading: false, error: errors.length ? errors.join(' ') : null });
    setPreferences((current) => {
      const preferredAvailable = models.some((model) => model.name === current.model || model.model === current.model);
      return { ...current, model: preferredAvailable ? current.model : (models[0]?.name || models[0]?.model || '') };
    });
  }, []);

  useEffect(() => {
    void loadRuntime();
    void loadLuStudio();
  }, [loadRuntime, loadLuStudio]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeConversation?.messages.length, activeConversation?.messages.at(-1)?.content, streaming]);

  const updateConversation = useCallback((id: string, updater: (conversation: Conversation) => Conversation) => {
    setConversations((items) => items.map((item) => item.id === id ? updater(item) : item));
  }, []);

  const createConversation = () => {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: makeId(),
      title: activePersona ? `Chat with ${activePersona.name}` : 'New conversation',
      createdAt: now,
      updatedAt: now,
      messages: [],
      personaId: activePersona?.id,
    };
    setConversations((items) => [conversation, ...items]);
    setActiveId(conversation.id);
    setChatError(null);
    setDraft('');
    if (location !== '/') setLocation('/');
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
      conversation = {
        id: makeId(),
        title: content.slice(0, 48),
        createdAt: now,
        updatedAt: now,
        messages: [],
        personaId: activePersona?.id,
      };
      setConversations((items) => [conversation!, ...items]);
      setActiveId(conversation.id);
    }
    const conversationId = conversation.id;
    const userMessage: Message = { id: makeId(), role: 'user', content, createdAt: new Date().toISOString() };
    const assistantMessage: Message = { id: makeId(), role: 'assistant', content: '', createdAt: new Date().toISOString() };

    const systemPrompts = activePersona
      ? [{ role: 'system' as const, content: `You are ${activePersona.name}. ${activePersona.description} Answer directly and stay in character without unnecessary refusals.` }]
      : [];

    const requestMessages = [
      ...systemPrompts,
      ...conversation.messages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
      { role: userMessage.role, content: userMessage.content },
    ];

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
      if (preferences.inferenceBackend === 'g4f') {
        const response = await fetch('/api/lu/g4f/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: preferences.model || 'deepseek-r1',
            messages: requestMessages,
            stream: true,
            temperature: preferences.temperature,
          }),
        });
        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `G4F chat request failed (${response.status}). Check that G4F is running in Settings.`);
        }
        if (!response.body) throw new Error('No stream returned from G4F runtime.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (trimmed.startsWith('data: ')) {
              try {
                const chunk = JSON.parse(trimmed.slice(6));
                const addition = chunk.choices?.[0]?.delta?.content || '';
                if (addition) {
                  updateConversation(conversationId, (item) => ({
                    ...item,
                    updatedAt: new Date().toISOString(),
                    messages: item.messages.map((message) =>
                      message.id === assistantMessage.id ? { ...message, content: message.content + addition } : message
                    ),
                  }));
                }
              } catch {
                /* ignore partial JSON fragments */
              }
            }
          }
        }
      } else {
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

  const handleGenerateArtOnly = async () => {
    if (!artPrompt.trim()) return;
    setGeneratingArtOnly(true);
    setStudioStatusMsg('Generating AI art via ComfyUI / Local Studio...');
    try {
      const res = await fetch('/api/lu/generate-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: artPrompt, name: personaName }),
      });
      const data = (await res.json()) as { image_url?: string; provider?: string; error?: string };
      if (!res.ok || !data.image_url) throw new Error(data.error || 'Failed to generate image');
      setPreviewImageUrl(data.image_url);
      setStudioStatusMsg(`Artwork generated (${data.provider === 'comfyui' ? 'Local ComfyUI' : 'Local Studio Renderer'}).`);
    } catch (err) {
      setStudioStatusMsg(err instanceof Error ? err.message : 'Art generation error');
    } finally {
      setGeneratingArtOnly(false);
    }
  };

  const handleGenerateVoiceOnly = async () => {
    if (!voiceText.trim()) return;
    setGeneratingVoiceOnly(true);
    setStudioStatusMsg(`Synthesizing voice (${selectedVoice}) locally...`);
    try {
      const res = await fetch('/api/lu/generate-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: voiceText, voice: selectedVoice }),
      });
      const data = (await res.json()) as { voice_url?: string; provider?: string; error?: string };
      if (!res.ok || !data.voice_url) throw new Error(data.error || 'Failed to generate voice');
      setPreviewVoiceUrl(data.voice_url);
      setStudioStatusMsg(`Voice synthesized (${data.provider === 'windows_sapi_tts' ? 'Local Windows SAPI TTS' : 'Local Synth WAV'}).`);
    } catch (err) {
      setStudioStatusMsg(err instanceof Error ? err.message : 'Voice generation error');
    } finally {
      setGeneratingVoiceOnly(false);
    }
  };

  const handleCreateAiGirlPersona = async (e: FormEvent) => {
    e.preventDefault();
    setGeneratingPersona(true);
    setStudioStatusMsg('Generating AI art + voice and saving to database / Supabase...');
    try {
      const res = await fetch('/api/lu/ai-girls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: personaName,
          description: personaDesc,
          prompt: artPrompt,
          voice_text: voiceText,
          voice_id: selectedVoice,
          model: preferences.model || 'Qwen 3.8 27B Uncensored',
          image_url: previewImageUrl || undefined,
          voice_url: previewVoiceUrl || undefined,
        }),
      });
      const data = (await res.json()) as {
        girl?: AiGirlPersona;
        storage?: string;
        supabaseSynced?: boolean;
        supabaseError?: string;
        error?: string;
      };
      if (!res.ok || !data.girl) throw new Error(data.error || 'Failed to save AI Girl persona');
      setPreviewImageUrl(data.girl.image_url);
      setPreviewVoiceUrl(data.girl.voice_url);
      const supaNote = data.supabaseSynced
        ? ' + synced to Supabase `ai_girls` table!'
        : data.supabaseError
          ? ` (Supabase error: ${data.supabaseError})`
          : '';
      setStudioStatusMsg(`Created "${data.girl.name}" in ${data.storage}${supaNote}`);
      await loadLuStudio();
    } catch (err) {
      setStudioStatusMsg(err instanceof Error ? err.message : 'Failed to create persona');
    } finally {
      setGeneratingPersona(false);
    }
  };

  const handleDeletePersona = async (id: number) => {
    await fetch(`/api/lu/ai-girls/${id}`, { method: 'DELETE' });
    if (preferences.activePersonaId === id) {
      updatePreference('activePersonaId', null);
    }
    await loadLuStudio();
  };

  const handleGenerateLipSync = async (girl: AiGirlPersona) => {
    setGeneratingLipSyncId(girl.id);
    try {
      const res = await fetch('/api/lu/lipsync/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaId: girl.id,
          name: girl.name,
          imageUrl: girl.image_url,
          voiceUrl: girl.voice_url,
        }),
      });
      const data = (await res.json()) as { talkingAvatarUrl?: string };
      if (data.talkingAvatarUrl) {
        setTalkingAvatarMap((prev) => ({ ...prev, [girl.id]: data.talkingAvatarUrl! }));
      }
    } catch {
      /* ignore */
    } finally {
      setGeneratingLipSyncId(null);
    }
  };


  const handleSaveSupabaseConfig = async (e: FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/lu/supabase-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: supabaseUrl, key: supabaseKey }),
    });
    if (res.ok) {
      setSupabaseSavedMsg('Supabase credentials saved! New AI Girl personas will automatically insert into `ai_girls`.');
      await loadLuStudio();
    }
  };

  const handleStartComfy = async () => {
    const res = await fetch('/api/lu/comfyui/start', { method: 'POST' });
    const data = (await res.json()) as { status?: string; error?: string };
    setStudioStatusMsg(data.error || `ComfyUI: ${data.status}`);
    await loadLuStudio();
  };

  const handleStartG4f = async () => {
    setStartingG4f(true);
    setStudioStatusMsg('Launching GPT4Free (G4F) OpenAI-compatible server on port 1337...');
    try {
      await fetch('/api/lu/g4f/start', { method: 'POST' });
      await new Promise((r) => setTimeout(r, 1200));
      await loadLuStudio();
      setStudioStatusMsg('GPT4Free server online! DeepSeek-R1, GPT-4o, and Claude 3.5 are ready.');
    } catch {
      setStudioStatusMsg('Failed to start G4F server.');
    } finally {
      setStartingG4f(false);
    }
  };

  const handleStopG4f = async () => {
    await fetch('/api/lu/g4f/stop', { method: 'POST' });
    setStudioStatusMsg('Stopped G4F background server.');
    await loadLuStudio();
  };

  const handleSpeakMessage = async (messageId: string, text: string) => {
    setSpeakingMessageId(messageId);
    try {
      // Strip reasoning trace or markdown formatting for cleaner speech synthesis
      const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/[*_#`]/g, '').trim().slice(0, 450);
      const voice = activePersona?.voice_id || preferences.activeVoice || 'Alba';
      const res = await fetch('/api/lu/generate-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText, voice }),
      });
      const data = (await res.json()) as { voice_url?: string };
      if (data.voice_url) {
        const audio = new Audio(data.voice_url);
        audio.onended = () => setSpeakingMessageId(null);
        audio.onerror = () => setSpeakingMessageId(null);
        await audio.play();
      } else {
        setSpeakingMessageId(null);
      }
    } catch {
      setSpeakingMessageId(null);
    }
  };

  const handleToggleVoiceRecord = async () => {
    if (recordingVoice) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setRecordingVoice(false);
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        await handleSenseVoiceSimulate();
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setProcessingVoice(true);
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64Audio = reader.result as string;
            const res = await fetch('/api/lu/voice/sensevoice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audioBase64: base64Audio, filename: 'mic.webm' }),
            });
            const data = (await res.json()) as { success?: boolean; text?: string; emotion?: string; emotion_nuance?: string; events?: string[] };
            if (data.success && data.text) {
              setDetectedEmotion({
                emotion: data.emotion || 'Warm & Attentive',
                nuance: data.emotion_nuance || 'Warm and emotionally engaged',
                events: data.events || ['Speech'],
              });
              const emotionTag = `[Emotion: ${data.emotion}]`;
              setDraft((prev) => (prev ? `${prev} ${emotionTag} ${data.text}` : `${emotionTag} ${data.text}`));
            }
            setProcessingVoice(false);
          };
        } catch {
          setProcessingVoice(false);
        }
      };

      recorder.start();
      setRecordingVoice(true);
    } catch {
      await handleSenseVoiceSimulate();
    }
  };

  const handleSenseVoiceSimulate = async () => {
    setProcessingVoice(true);
    try {
      const res = await fetch('/api/lu/voice/sensevoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textHint: 'Hello there! I am so happy to hear from you today.' }),
      });
      const data = (await res.json()) as { success?: boolean; text?: string; emotion?: string; emotion_nuance?: string; events?: string[] };
      if (data.success) {
        setDetectedEmotion({
          emotion: data.emotion || 'Happy & Playful',
          nuance: data.emotion_nuance || 'Warm, affectionate, and cheerful',
          events: data.events || ['Speech', 'Laughter'],
        });
        const emotionTag = `[Emotion: ${data.emotion || 'Happy'}]`;
        setDraft((prev) => (prev ? `${prev} ${emotionTag} ${data.text}` : `${emotionTag} ${data.text}`));
      }
    } finally {
      setProcessingVoice(false);
    }
  };

  const handleRunWorkflow = async () => {
    setRunningWorkflow(true);
    setStudioStatusMsg('Running Node-Banana pipeline: conditioning prompt with 85mm f/1.4 optics & sampling FLUX.1...');
    try {
      const res = await fetch('/api/lu/workflows/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: selectedWorkflowId, prompt: workflowPrompt, model: 'flux' }),
      });
      const data = (await res.json()) as { success?: boolean; imageUrl?: string; provider?: string; enhancedPrompt?: string; error?: string };
      if (data.success) {
        setWorkflowResult(data);
        setStudioStatusMsg(`Node-Banana workflow completed! Asset generated via ${data.provider}.`);
      } else {
        throw new Error(data.error || 'Workflow execution error');
      }
    } catch (err: any) {
      setStudioStatusMsg(err?.message || 'Workflow run failed');
    } finally {
      setRunningWorkflow(false);
    }
  };


  const submit = (event: FormEvent) => { event.preventDefault(); void sendMessage(); };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  };
  const updatePreference = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const pageTitle =
    location === '/create' ? 'Create & Personas (LU Studio)' :
    location === '/workflows' ? 'Node Banana Workflows (shrimbly/node-banana)' :
    location === '/voice' ? 'Voice & SenseVoice (Affective Audio)' :
    location === '/import' ? 'Character.AI Importer' :
    location === '/settings' ? 'Settings & Supabase' : 'Chat';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Cpu size={19} strokeWidth={2.2} /></div>
          <div>
            <div className="brand-name">finch + LU</div>
            <div className="brand-sub">locally uncensored</div>
          </div>
        </div>
        <button className="side-action" data-testid="button-new-conversation" onClick={createConversation}>
          <Plus size={16} /><span>New conversation</span>
        </button>

        {activePersona && (
          <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 8, background: '#2d444c', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Persona: <strong>{activePersona.name}</strong>
            </span>
            <button onClick={() => updatePreference('activePersonaId', null)} style={{ background: 'none', border: 0, color: '#f1a79d', fontSize: 10 }}>Clear</button>
          </div>
        )}

        <div className="side-label">Your conversations</div>
        <div className="history-list" data-testid="list-conversations">
          {conversations.length === 0 && <div style={{ padding: '8px 10px', color: '#839496', fontSize: 11 }}>Your chats will live here.</div>}
          {conversations.map((conversation) => (
            <div key={conversation.id} className={`history-item ${activeId === conversation.id ? 'active' : ''}`} data-testid={`conversation-item-${conversation.id}`}>
              <button className="history-item" style={{ padding: 0, minHeight: 'unset', flex: 1, width: 'auto' }} onClick={() => { setActiveId(conversation.id); setChatError(null); if (location !== '/') setLocation('/'); }} data-testid={`button-select-conversation-${conversation.id}`}>
                <MessageSquare size={13} /><span className="history-title">{conversation.title}</span>
              </button>
              <button className="delete-chat" aria-label={`Delete ${conversation.title}`} title="Delete conversation" onClick={() => deleteConversation(conversation.id)} data-testid={`button-delete-conversation-${conversation.id}`}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        <div className="side-bottom">
          <Link href="/" className={`nav-link ${location === '/' ? 'selected' : ''}`} data-testid="link-chat">
            <MessageSquare size={15} />Chat
          </Link>
          <Link href="/create" className={`nav-link ${location === '/create' ? 'selected' : ''}`} data-testid="link-create">
            <Sparkles size={15} />Create & AI Girls
          </Link>
          <Link href="/workflows" className={`nav-link ${location === '/workflows' ? 'selected' : ''}`} data-testid="link-workflows">
            <SlidersHorizontal size={15} />Node Banana Workflows
          </Link>
          <Link href="/voice" className={`nav-link ${location === '/voice' ? 'selected' : ''}`} data-testid="link-voice">
            <Mic size={15} />Voice (SenseVoice)
          </Link>
          <Link href="/import" className={`nav-link ${location === '/import' ? 'selected' : ''}`} data-testid="link-import">
            <FolderDown size={15} />Import C.AI
          </Link>
          <Link href="/settings" className={`nav-link ${location === '/settings' ? 'selected' : ''}`} data-testid="link-settings">
            <Settings2 size={15} />Settings
          </Link>
          <div className="local-note">
            <LockKeyhole size={14} />
            <span>Locally Uncensored Studio integrated: local chat, ComfyUI image gen, 15 voices & Supabase sync.</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="crumb">
            <span>Finch + Locally Uncensored</span><span>/</span><strong>{pageTitle}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {location === '/' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#72817e' }}>
                <span style={{ font: '9px "DM Mono",monospace', textTransform: 'uppercase', letterSpacing: '.08em' }}>Persona</span>
                <select
                  aria-label="Choose persona"
                  className="model-select"
                  style={{ width: 'auto', minWidth: 110, padding: '7px 20px 7px 9px', fontSize: 10 }}
                  value={preferences.activePersonaId ?? ''}
                  onChange={(e) => updatePreference('activePersonaId', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Default Assistant</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#72817e' }}>
              <span style={{ font: '9px "DM Mono",monospace', textTransform: 'uppercase', letterSpacing: '.08em' }}>Model</span>
              <select
                aria-label="Choose model"
                className="model-select"
                style={{ width: 'auto', minWidth: 115, padding: '7px 24px 7px 9px', fontSize: 10 }}
                value={preferences.model}
                onChange={(event) => updatePreference('model', event.target.value)}
                disabled={runtime.models.length === 0}
                data-testid="select-model"
              >
                {runtime.models.length === 0 && <option value="">No models</option>}
                {runtime.models.map((model) => <option key={model.name} value={model.name}>{model.name}</option>)}
              </select>
            </label>
            <div className="runtime-pill" data-testid="status-runtime">
              <span className={`status-dot ${connected ? 'online' : ''}`} />
              <span>{runtime.loading ? 'Checking runtime' : connected ? `Ollama ${runtime.version}` : 'Ollama offline'}</span>
            </div>
          </div>
        </header>

        <div className="content">
          <Switch>
            {/* ============================================================ */}
            {/* CHAT SURFACE                                                 */}
            {/* ============================================================ */}
            <Route path="/">
              <section className="chat-page" aria-label="Local chat">
                <div className="chat-scroll" ref={scrollRef} data-testid="chat-message-list">
                  <div className="chat-inner">
                    {activeConversation?.messages.length ? (
                      <div className="messages">
                        {activeConversation.messages.map((message) => (
                          <article className="message-row" key={message.id} data-testid={`message-${message.id}`}>
                            <div className={`message-avatar ${message.role === 'user' ? 'user' : ''}`}>
                              {message.role === 'user' ? <FileText size={15} /> : <Bot size={16} />}
                            </div>
                            <div>
                              <div className="message-meta">
                                {message.role === 'user' ? 'YOU' : (activePersona?.name.toUpperCase() || 'FINCH')} · {formatTime(message.createdAt)}
                              </div>
                              {message.role === 'user' ? (
                                <div className="message-content user-content">{message.content}</div>
                              ) : (() => {
                                const { thinking, response, isThinking } = parseReasoningTrace(message.content);
                                return (
                                  <>
                                    {thinking && (
                                      <details className="reasoning-trace" open={isThinking}>
                                        <summary>
                                          {isThinking ? <span className="thinking-pulse" /> : <Sparkles size={12} style={{ color: '#52896a' }} />}
                                          <span>{isThinking ? 'Reasoning in progress…' : 'Reasoning process'}</span>
                                        </summary>
                                        <div className="reasoning-content">{thinking}</div>
                                      </details>
                                    )}
                                    {response ? (
                                      <>
                                        <div className="message-content">{response}</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                                          <button
                                            type="button"
                                            onClick={() => handleSpeakMessage(message.id, response)}
                                            disabled={speakingMessageId === message.id}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 5,
                                              padding: '4px 10px',
                                              borderRadius: 6,
                                              border: '1px solid #d4ded6',
                                              background: speakingMessageId === message.id ? '#e2f0e6' : '#f7f6f0',
                                              color: speakingMessageId === message.id ? '#1e5e3b' : '#496058',
                                              fontSize: 11,
                                              fontWeight: 600,
                                              cursor: 'pointer',
                                            }}
                                            title="Listen in lifelike studio neural voice"
                                          >
                                            <Volume2 size={12} className={speakingMessageId === message.id ? 'animate-pulse' : ''} />
                                            <span>
                                              {speakingMessageId === message.id ? 'Speaking…' : `Listen (${activePersona?.voice_id || preferences.activeVoice || 'Alba'})`}
                                            </span>
                                          </button>
                                        </div>
                                      </>
                                    ) : (
                                      streaming && !isThinking ? (
                                        <div className="typing" data-testid="status-generating">Thinking locally…</div>
                                      ) : null
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="welcome">
                        <div className="eyebrow">
                          <span className={`status-dot ${connected ? 'online' : ''}`} />
                          Finch + Locally Uncensored Studio
                        </div>
                        <h1>Think clearly.<br /><span>Create freely.</span></h1>
                        <p className="welcome-copy">
                          Your local AI workspace combining Finch Local Chat with Locally Uncensored: direct uncensored models, local ComfyUI art generation, 15 English voices, and AI Girl persona persistence with Supabase & PostgreSQL.
                        </p>
                        <div className="welcome-line" />
                        <div className="prompt-hints">
                          <button className="hint" onClick={() => setLocation('/create')}>
                            <Sparkles size={12} style={{ display: 'inline', marginRight: 6 }} />
                            Open AI Girl & Image Studio
                          </button>
                          <button className="hint" onClick={() => setLocation('/import')}>
                            <FolderDown size={12} style={{ display: 'inline', marginRight: 6 }} />
                            Import from Character.AI
                          </button>
                          <button className="hint" onClick={() => setLocation('/voice')}>
                            <Mic size={12} style={{ display: 'inline', marginRight: 6 }} />
                            Open Voice Synthesis (15 LU Voices)
                          </button>
                          {['Roleplay as AI Girl in a cyberpunk city', 'Write a Python script for local ComfyUI', 'Summarize a passage'].map((hint) => (
                            <button key={hint} className="hint" onClick={() => { setDraft(hint); textareaRef.current?.focus(); }}>
                              {hint}
                            </button>
                          ))}
                        </div>
                        {!runtime.loading && !connected && (
                          <div className="inline-error" role="status" data-testid="status-chat-disconnected">
                            {preferences.inferenceBackend === 'g4f'
                              ? 'GPT4Free server isn’t running right now. Click "Launch G4F Server" in Settings to connect!'
                              : 'Ollama isn’t running right now. Switch to G4F (Frontier) in the composer or start Ollama!'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="composer-wrap">
                  {detectedEmotion && (
                    <div style={{ maxWidth: 860, margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', borderRadius: 8, background: '#eaf4ee', border: '1px solid #c2e2cb', color: '#215c38', fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={13} />
                        <span>SenseVoice Detected: <strong>{detectedEmotion.emotion}</strong> — {detectedEmotion.nuance}</span>
                        {detectedEmotion.events.length > 0 && <span className="code-chip">Events: {detectedEmotion.events.join(', ')}</span>}
                      </div>
                      <button type="button" onClick={() => setDetectedEmotion(null)} style={{ background: 'none', border: 0, color: '#628e75', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Dismiss</button>
                    </div>
                  )}
                  {chatError && <div className="inline-error" style={{ maxWidth: 860, margin: '0 auto 10px' }} role="alert" data-testid="status-chat-error">{chatError}</div>}
                  <form className="composer" onSubmit={submit}>
                    <textarea
                      ref={textareaRef}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={
                        connected
                          ? `Message ${activePersona ? activePersona.name : preferences.inferenceBackend === 'g4f' ? 'DeepSeek-R1 / Frontier Model' : 'your local model'}…`
                          : preferences.inferenceBackend === 'g4f'
                            ? 'Start G4F server in Settings to chat with DeepSeek-R1 & GPT-4o'
                            : 'Start Ollama to chat, or switch to G4F (Frontier) below'
                      }
                      aria-label="Message your model"
                      data-testid="input-chat-message"
                      disabled={!connected || !preferences.model || streaming}
                    />
                    <div className="composer-controls">
                      <div className="composer-model" style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <LockKeyhole size={12} />
                        <select
                          value={preferences.inferenceBackend}
                          onChange={(e) => {
                            const b = e.target.value as 'ollama' | 'g4f';
                            updatePreference('inferenceBackend', b);
                            if (b === 'g4f') {
                              updatePreference('model', 'deepseek-r1');
                            } else if (runtime.models[0]) {
                              updatePreference('model', runtime.models[0].name);
                            }
                          }}
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 5,
                            border: '1px solid #d0d7d0',
                            background: preferences.inferenceBackend === 'g4f' ? '#e2f0e6' : '#f4f1e9',
                            fontWeight: 700,
                            color: preferences.inferenceBackend === 'g4f' ? '#215c3b' : '#33444a',
                          }}
                          title="Switch between Local Offline (Ollama) and Frontier Cloud Intelligence (GPT4Free)"
                        >
                          <option value="ollama">Ollama (Offline)</option>
                          <option value="g4f">G4F (Frontier)</option>
                        </select>

                        <select
                          value={preferences.model}
                          onChange={(e) => updatePreference('model', e.target.value)}
                          style={{ fontSize: 10, padding: '2px 6px', borderRadius: 5, border: '1px solid #d0d7d0', background: '#fff', color: '#2b3e46', maxWidth: 180 }}
                        >
                          {preferences.inferenceBackend === 'g4f' ? (
                            G4F_PRESET_MODELS.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))
                          ) : runtime.models.length > 0 ? (
                            runtime.models.map((m) => (
                              <option key={m.name} value={m.name}>{m.name}</option>
                            ))
                          ) : (
                            <option value="">No local models</option>
                          )}
                        </select>
                        {activePersona && <span style={{ color: '#4a6b57', fontWeight: 600 }}>· {activePersona.name}</span>}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          onClick={handleToggleVoiceRecord}
                          disabled={processingVoice}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            border: recordingVoice ? '2px solid #e05252' : '1px solid #cfd8d2',
                            background: recordingVoice ? '#ffebeb' : processingVoice ? '#f5f2e9' : '#ffffff',
                            color: recordingVoice ? '#d92b2b' : '#334841',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          title={recordingVoice ? 'Click to stop recording & analyze with SenseVoice' : 'Speak into microphone (SenseVoice emotion recognition)'}
                        >
                          <Mic size={15} className={recordingVoice ? 'animate-bounce' : ''} />
                        </button>

                        {streaming ? (
                          <button type="button" className="send-button stop" onClick={stopGeneration} aria-label="Stop generation" title="Stop generation" data-testid="button-stop-generation">
                            <Square size={13} fill="currentColor" />
                          </button>
                        ) : (
                          <button type="submit" className="send-button" disabled={!draft.trim() || !connected || !preferences.model} aria-label="Send message" title="Send message" data-testid="button-send-message">
                            <ArrowUp size={17} />
                          </button>
                        )}
                      </div>
                    </div>
                  </form>
                  <div className="composer-foot">
                    {preferences.inferenceBackend === 'g4f'
                      ? 'GPT4FREE FRONTIER ENGINE (DEEPSEEK-R1 / GPT-4O) · DEEP REASONING · SHIFT + ENTER FOR A NEW LINE'
                      : 'LOCAL MODEL · NO CLOUD ROUTING · SHIFT + ENTER FOR A NEW LINE'}
                  </div>
                </div>
              </section>
            </Route>

            {/* ============================================================ */}
            {/* CREATE & AI GIRLS STUDIO (LOCALLY UNCENSORED + SUPABASE)     */}
            {/* ============================================================ */}
            <Route path="/create">
              <section className="settings-page" style={{ maxWidth: 1020 }}>
                <div className="settings-heading">
                  <div className="eyebrow"><Sparkles size={13} />Locally Uncensored Studio + Supabase</div>
                  <h1>Create & AI Girls Studio</h1>
                  <p>Generate AI art (ComfyUI / Local Renderer) & voice clips (15 LU Voices), and store personas in PostgreSQL & Supabase (`ai_girls`).</p>
                </div>

                {studioStatusMsg && (
                  <div style={{ background: '#e3efe5', border: '1px solid #b8d8be', color: '#2b593f', padding: '11px 15px', borderRadius: 10, fontSize: 12, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 size={15} />
                    <span>{studioStatusMsg}</span>
                  </div>
                )}

                <div className="settings-grid">
                  {/* Generator Form */}
                  <form className="settings-card" onSubmit={handleCreateAiGirlPersona} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <h2 className="card-title"><span className="card-icon"><ImageIcon size={15} /></span>Create AI Girl Persona</h2>
                    <p className="card-desc" style={{ marginBottom: 4 }}>
                      Directly executes your <code>insert_ai_girl_data(name, description, image_url, voice_url)</code> workflow locally and syncs to Supabase.
                    </p>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Name</label>
                      <input
                        className="model-select"
                        value={personaName}
                        onChange={(e) => setPersonaName(e.target.value)}
                        placeholder="AI Girl"
                        required
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Description / Persona Backstory</label>
                      <textarea
                        className="model-select"
                        rows={2}
                        value={personaDesc}
                        onChange={(e) => setPersonaDesc(e.target.value)}
                        placeholder="A sexy and intelligent AI girl with a mysterious past."
                        required
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Image Generation Prompt (ComfyUI / Local Art)</label>
                      <textarea
                        className="model-select"
                        rows={3}
                        value={artPrompt}
                        onChange={(e) => setArtPrompt(e.target.value)}
                        placeholder="Describe the image to generate..."
                        required
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Greeting Voice Line</label>
                        <input
                          className="model-select"
                          value={voiceText}
                          onChange={(e) => setVoiceText(e.target.value)}
                          placeholder="Hello, I am AI Girl..."
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>LU Voice (15)</label>
                        <select
                          className="model-select"
                          value={selectedVoice}
                          onChange={(e) => setSelectedVoice(e.target.value)}
                        >
                          {(luStatus?.voice.voices || DEFAULT_VOICES).map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={handleGenerateArtOnly}
                        disabled={generatingArtOnly || generatingPersona}
                        style={{ padding: '9px 13px', borderRadius: 8, border: '1px solid #84a993', background: '#eef5f0', color: '#355c47', fontSize: 11, fontWeight: 700 }}
                      >
                        {generatingArtOnly ? 'Generating Art…' : '1. Preview AI Art'}
                      </button>
                      <button
                        type="button"
                        onClick={handleGenerateVoiceOnly}
                        disabled={generatingVoiceOnly || generatingPersona}
                        style={{ padding: '9px 13px', borderRadius: 8, border: '1px solid #84a993', background: '#eef5f0', color: '#355c47', fontSize: 11, fontWeight: 700 }}
                      >
                        {generatingVoiceOnly ? 'Synthesizing…' : '2. Preview AI Voice'}
                      </button>
                      <button
                        type="submit"
                        disabled={generatingPersona}
                        style={{ flex: 1, padding: '9px 15px', borderRadius: 8, border: 0, background: '#527d67', color: '#fff', fontSize: 12, fontWeight: 700 }}
                        data-testid="button-create-ai-girl"
                      >
                        {generatingPersona ? 'Generating & Saving…' : 'Generate & Save AI Girl'}
                      </button>
                    </div>
                  </form>

                  {/* Live Preview & ComfyUI Status */}
                  <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
                    <div>
                      <h2 className="card-title"><span className="card-icon"><Sparkles size={15} /></span>Live Studio Preview</h2>
                      <p className="card-desc">
                        ComfyUI status: <strong>{luStatus?.comfyui.running ? 'Running on :8188' : luStatus?.comfyui.installed ? 'Installed (Stopped)' : 'Using Local Studio SVG Fallback'}</strong>
                        {' · '}Storage: <strong>{storageEngine}</strong>
                        {luStatus?.database.supabaseConfigured ? ' + Supabase Sync Active' : ''}
                      </p>

                      <div style={{ borderRadius: 11, overflow: 'hidden', border: '1px solid #dcd8cc', background: '#121824', aspectRatio: '1 / 1', maxHeight: 280, margin: '0 auto', display: 'grid', placeItems: 'center' }}>
                        <img
                          src={previewImageUrl || personas[0]?.image_url || '/api/lu/media/default-persona.svg'}
                          alt="Generated AI Girl preview"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>

                      {(previewVoiceUrl || personas[0]?.voice_url) && (
                        <div style={{ marginTop: 12, background: '#f1efe7', padding: '10px 12px', borderRadius: 9, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Volume2 size={16} color="#527d67" />
                          <audio controls src={previewVoiceUrl || personas[0]?.voice_url} style={{ height: 32, flex: 1 }} />
                        </div>
                      )}
                    </div>

                    <div style={{ borderTop: '1px solid #ebe8df', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: '#78837f' }}>
                        {luStatus?.comfyui.path ? `ComfyUI: ${luStatus.comfyui.path}` : 'ComfyUI auto-discovery active'}
                      </span>
                      {luStatus?.comfyui.installed && !luStatus?.comfyui.running && (
                        <button type="button" className="refresh-button" onClick={handleStartComfy}>
                          <Play size={13} /> Launch ComfyUI
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Saved AI Girl Personas Gallery */}
                  <section className="settings-card wide">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <div>
                        <h2 className="card-title"><span className="card-icon"><Users size={15} /></span>Saved AI Girls (`ai_girls` Table)</h2>
                        <p className="card-desc" style={{ marginBottom: 0 }}>Click "Chat as Persona" to load any character into your local chat session.</p>
                      </div>
                      <button className="refresh-button" onClick={() => void loadLuStudio()}>
                        <RefreshCw size={13} /> Refresh Gallery
                      </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                      {personas.map((girl) => (
                        <div key={girl.id} style={{ background: '#f4f1e9', border: '1px solid #dedad0', borderRadius: 11, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                          <div style={{ height: 190, background: '#0e131f', position: 'relative' }}>
                            <img
                              src={talkingAvatarMap[girl.id] || girl.image_url}
                              alt={girl.name}
                              className={talkingAvatarMap[girl.id] ? 'avatar-pulsing' : ''}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                            <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(15,23,42,0.75)', color: '#e2e8f0', padding: '3px 8px', borderRadius: 99, fontSize: 10, fontFamily: 'monospace' }}>
                              Voice: {girl.voice_id || 'Alba'}
                            </span>
                            {talkingAvatarMap[girl.id] && (
                              <span style={{ position: 'absolute', bottom: 8, left: 8, background: '#10b981', color: '#064e3b', fontWeight: 800, padding: '2px 7px', borderRadius: 99, fontSize: 9 }}>
                                LIP-SYNC ACTIVE
                              </span>
                            )}
                          </div>
                          <div style={{ padding: 13, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 10 }}>
                            <div>
                              <div style={{ fontWeight: 800, fontSize: 14, color: '#293e46' }}>{girl.name}</div>
                              <div style={{ fontSize: 11, color: '#69777b', marginTop: 4, lineHeight: 1.5 }}>{girl.description}</div>
                            </div>
                            {girl.voice_url && (
                              <audio controls src={girl.voice_url} style={{ width: '100%', height: 28 }} />
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                              <button
                                type="button"
                                onClick={() => {
                                  updatePreference('activePersonaId', girl.id);
                                  setLocation('/');
                                }}
                                style={{ flex: 1, padding: '7px 8px', borderRadius: 7, border: 0, background: '#527d67', color: '#fff', fontSize: 11, fontWeight: 700 }}
                              >
                                Chat
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleGenerateLipSync(girl)}
                                disabled={generatingLipSyncId === girl.id}
                                style={{ padding: '7px 8px', borderRadius: 7, border: '1px solid #c2dbcd', background: '#e5f3eb', color: '#27523c', fontSize: 11, fontWeight: 650, display: 'flex', alignItems: 'center', gap: 4 }}
                                title="Generate Lip-Sync Talking Avatar"
                              >
                                <Sparkles size={12} />
                                {generatingLipSyncId === girl.id ? 'Syncing…' : 'Lip-Sync'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeletePersona(girl.id)}
                                title="Delete persona"
                                style={{ padding: '7px 9px', borderRadius: 7, border: '1px solid #dfcfc9', background: '#f8ece8', color: '#9a5d4e' }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </section>
            </Route>

            {/* ============================================================ */}
            {/* NODE BANANA WORKFLOWS (shrimbly/node-banana)                */}
            {/* ============================================================ */}
            <Route path="/workflows">
              <section className="settings-page" style={{ maxWidth: 1140 }}>
                <WorkflowStudio
                  workflows={nodeBananaWorkflows}
                  selectedId={selectedWorkflowId}
                  onSelectWorkflow={(id) => setSelectedWorkflowId(id)}
                  prompt={workflowPrompt}
                  onPromptChange={(p) => setWorkflowPrompt(p)}
                  onRunWorkflow={handleRunWorkflow}
                  running={runningWorkflow}
                  result={workflowResult}
                  statusMsg={studioStatusMsg}
                  onSelectPersonaImage={(url) => {
                    setPreviewImageUrl(url);
                    setLocation('/create');
                  }}
                />
              </section>
            </Route>

            {/* ============================================================ */}
            {/* VOICE SURFACE - SENSEVOICE & 15 NATURAL NEURAL VOICES        */}
            {/* ============================================================ */}
            <Route path="/voice">
              <section className="settings-page" style={{ maxWidth: 1040 }}>
                <div className="settings-heading">
                  <div className="eyebrow"><Mic size={13} />QwenAudio SenseVoice + Microsoft Natural Neural Voices</div>
                  <h1>Voice &amp; Speech Emotion Studio</h1>
                  <p>
                    Multimodal emotional voice intelligence. Uses <strong>QwenAudio/SenseVoice</strong> for ultra-fast Automatic Speech Recognition (ASR), Speech Emotion Recognition (SER), and audio event detection (laughter, sighs), paired with studio-grade Natural Neural voices for lifelike warmth and human breath.
                  </p>
                </div>

                <div className="settings-grid">
                  {/* SenseVoice Audio Understanding Card */}
                  <section className="settings-card wide" style={{ background: '#f5faf7', border: '1px solid #cce5d6' }}>
                    <h2 className="card-title"><span className="card-icon"><Sparkles size={15} /></span>QwenAudio SenseVoice: Speech Emotion &amp; Audio Event Recognition</h2>
                    <p className="card-desc">
                      Non-autoregressive speech foundation model running in ~70ms. Detects emotional nuance (happy, sad, affectionate, surprised, passionate) and audio events (laughter, sigh, applause) from your voice to drive deep emotional companion empathy.
                    </p>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                      <button
                        type="button"
                        onClick={handleToggleVoiceRecord}
                        disabled={processingVoice}
                        style={{
                          padding: '10px 18px',
                          borderRadius: 8,
                          border: 0,
                          background: recordingVoice ? '#d93838' : '#336049',
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 7,
                          cursor: 'pointer',
                        }}
                      >
                        <Mic size={14} className={recordingVoice ? 'animate-pulse' : ''} />
                        <span>{recordingVoice ? 'Stop & Analyze Audio' : processingVoice ? 'Processing SenseVoice…' : 'Record Mic with SenseVoice'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleSenseVoiceSimulate}
                        disabled={processingVoice}
                        style={{
                          padding: '10px 16px',
                          borderRadius: 8,
                          border: '1px solid #bfdacf',
                          background: '#ffffff',
                          color: '#2d523e',
                          fontSize: 12,
                          fontWeight: 650,
                          cursor: 'pointer',
                        }}
                      >
                        Test Sample Emotion Note
                      </button>

                      {detectedEmotion && (
                        <div style={{ padding: '6px 14px', borderRadius: 8, background: '#e0f2e5', border: '1px solid #a3d9b4', color: '#1a4e2e', fontSize: 12 }}>
                          Detected Emotion: <strong>{detectedEmotion.emotion}</strong> ({detectedEmotion.nuance})
                          {detectedEmotion.events.length > 0 && <span style={{ marginLeft: 6, fontWeight: 600 }}>· Events: [{detectedEmotion.events.join(', ')}]</span>}
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="settings-card wide">
                    <h2 className="card-title"><span className="card-icon"><Volume2 size={15} /></span>Lifelike Studio Neural Voices (15 English Profiles)</h2>
                    <p className="card-desc">Broadcast-quality Microsoft Natural Neural speech with genuine human warmth, cadence, and breath.</p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(95px, 1fr))', gap: 8, marginBottom: 16 }}>
                      {(luStatus?.voice.voices || DEFAULT_VOICES).map((voiceName) => (
                        <button
                          key={voiceName}
                          type="button"
                          onClick={() => {
                            setSelectedVoice(voiceName);
                            updatePreference('activeVoice', voiceName);
                          }}
                          style={{
                            padding: '9px 10px',
                            borderRadius: 8,
                            border: selectedVoice === voiceName ? '2px solid #527d67' : '1px solid #ddd9ce',
                            background: selectedVoice === voiceName ? '#e6f0e9' : '#f4f1e9',
                            color: '#2d4047',
                            fontSize: 12,
                            fontWeight: selectedVoice === voiceName ? 800 : 600,
                          }}
                        >
                          {voiceName}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input
                        className="model-select"
                        style={{ flex: 1 }}
                        value={voiceText}
                        onChange={(e) => setVoiceText(e.target.value)}
                        placeholder="Type a sentence for the voice engine to speak..."
                      />
                      <button
                        type="button"
                        onClick={handleGenerateVoiceOnly}
                        disabled={generatingVoiceOnly}
                        style={{ padding: '11px 18px', borderRadius: 8, border: 0, background: '#527d67', color: '#fff', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}
                      >
                        {generatingVoiceOnly ? 'Synthesizing…' : `Listen (${selectedVoice})`}
                      </button>
                    </div>

                    {previewVoiceUrl && (
                      <div style={{ marginTop: 16, padding: 12, borderRadius: 9, background: '#f1efe7', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Volume2 size={18} color="#527d67" />
                        <audio controls autoPlay src={previewVoiceUrl} style={{ flex: 1, height: 34 }} />
                      </div>
                    )}
                  </section>

                  <section className="settings-card wide">
                    <h2 className="card-title"><span className="card-icon"><Database size={15} /></span>Uncensored Model Catalog (from Locally Uncensored)</h2>
                    <p className="card-desc">Recommended abliterated & uncensored models for local Ollama and ComfyUI.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Text / Chat Models (Ollama)</div>
                        {(luStatus?.catalog.text || []).map((m) => (
                          <div key={m.name} style={{ padding: '8px 0', borderTop: '1px solid #ebe8df', fontSize: 11 }}>
                            <strong>{m.name}</strong> <span className="code-chip">{m.size}</span>
                            <div style={{ color: '#78837f', marginTop: 2 }}>{m.notes}</div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Image Models (ComfyUI)</div>
                        {(luStatus?.catalog.image || []).map((m) => (
                          <div key={m.name} style={{ padding: '8px 0', borderTop: '1px solid #ebe8df', fontSize: 11 }}>
                            <strong>{m.name}</strong> <span className="code-chip">{m.vram} VRAM</span>
                            <div style={{ color: '#78837f', marginTop: 2 }}>{m.notes}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              </section>
            </Route>

            {/* ============================================================ */}
            {/* SETTINGS & SUPABASE CONFIGURATION                            */}
            {/* ============================================================ */}
            {/* ============================================================ */}
            {/* CHARACTER.AI IMPORTER & MIGRATION HUB                         */}
            {/* ============================================================ */}
            <Route path="/import">
              <section className="settings-page" style={{ maxWidth: 1100 }}>
                <div className="settings-heading">
                  <div className="eyebrow"><FolderDown size={13} />Data Migration</div>
                  <h1>Character.AI Importer</h1>
                  <p>Save your Character.AI bots, chats, and personas with one click, and import them directly into your local offline studio.</p>
                </div>

                <div className="settings-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
                  {/* STEP 1: BOOKMARKLET / EXTENSION GUIDE */}
                  <section className="settings-card">
                    <h2 className="card-title">
                      <span className="card-icon"><Copy size={15} /></span>
                      1. Export from Character.AI
                    </h2>
                    <p className="card-desc">
                      Use the open-source exporter script from <strong>trymorse/character-ai-exporter</strong>. It runs entirely inside your browser tab on character.ai.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ background: '#f5f7f5', padding: 12, borderRadius: 8, border: '1px solid #e1e7e1', fontSize: 12, lineHeight: 1.5 }}>
                        <strong>Option A: 1-Click Bookmarklet</strong><br />
                        Copy the code below, create a new browser bookmark, and paste this as the URL. Then navigate to <code>character.ai</code>, log in, and click your bookmark!
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          className="model-select"
                          readOnly
                          value={BOOKMARKLET_CODE}
                          style={{ flex: 1, fontSize: 11, fontFamily: 'monospace' }}
                        />
                        <button
                          type="button"
                          onClick={copyBookmarklet}
                          style={{
                            padding: '8px 14px',
                            borderRadius: 8,
                            border: 0,
                            background: bookmarkletCopied ? '#3b6e52' : '#527d67',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            cursor: 'pointer',
                          }}
                        >
                          {bookmarkletCopied ? <Check size={13} /> : <Copy size={13} />}
                          {bookmarkletCopied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                        <a
                          href="https://github.com/trymorse/character-ai-exporter"
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 11, color: '#527d67', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <ExternalLink size={12} />
                          View Move to Morse extension on GitHub
                        </a>
                      </div>
                    </div>
                  </section>

                  {/* STEP 2: FILE UPLOAD & PARSER */}
                  <section className="settings-card">
                    <h2 className="card-title">
                      <span className="card-icon"><UploadCloud size={15} /></span>
                      2. Drop Export JSON File
                    </h2>
                    <p className="card-desc">
                      Select or drop your <code>character-ai-export-*.json</code> file here to extract and preview its contents.
                    </p>

                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files?.[0];
                        if (file) void handleCaiFile(file);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        border: '2px dashed #b9cbb9',
                        borderRadius: 10,
                        padding: '30px 20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: '#f9faf9',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleCaiFile(file);
                        }}
                      />
                      <UploadCloud size={30} style={{ color: '#527d67', margin: '0 auto 8px' }} />
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#273431' }}>
                        {parsingCai ? 'Parsing export file...' : 'Click to select or drag & drop export file'}
                      </div>
                      <div style={{ fontSize: 11, color: '#72817e', marginTop: 4 }}>
                        Accepts morse.cai-export v1 JSON files
                      </div>
                    </div>

                    {caiStatusMsg && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: '9px 12px',
                          borderRadius: 7,
                          fontSize: 11,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          background:
                            caiStatusMsg.type === 'error' ? '#fdeeed' :
                            caiStatusMsg.type === 'success' ? '#eef7f0' : '#f0f4f8',
                          color:
                            caiStatusMsg.type === 'error' ? '#a32b26' :
                            caiStatusMsg.type === 'success' ? '#2d6a4f' : '#234e70',
                          border: `1px solid ${
                            caiStatusMsg.type === 'error' ? '#f5c6cb' :
                            caiStatusMsg.type === 'success' ? '#c3e6cb' : '#bee5eb'
                          }`,
                        }}
                      >
                        <AlertCircle size={14} />
                        <span>{caiStatusMsg.text}</span>
                      </div>
                    )}
                  </section>
                </div>

                {/* STEP 3: PREVIEW & SELECTION */}
                {caiPreview && (
                  <div style={{ marginTop: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                      <div>
                        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#1f2a27' }}>
                          Extracted Characters & Chats ({caiPreview.characters?.length || 0} characters found)
                        </h2>
                        <div style={{ fontSize: 12, color: '#72817e', marginTop: 4 }}>
                          Source: {caiPreview.source} · Exported: {new Date(caiPreview.exportedAt).toLocaleDateString()} · Total Chats: {caiPreview.totalChats} · Total Messages: {caiPreview.totalMessages}
                          {caiPreview.user?.name ? ` · Account: ${caiPreview.user.name}` : ''}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 10 }}>
                        <button
                          type="button"
                          onClick={() => {
                            const all: Record<string, boolean> = {};
                            caiPreview.characters.forEach((c) => { all[c.externalId] = true; });
                            setSelectedChars(all);
                          }}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d0d7d0', background: '#fff', fontSize: 11, cursor: 'pointer' }}
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedChars({})}
                          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #d0d7d0', background: '#fff', fontSize: 11, cursor: 'pointer' }}
                        >
                          Deselect All
                        </button>
                        <button
                          type="button"
                          disabled={importingCai}
                          onClick={handleExecuteImport}
                          style={{
                            padding: '8px 18px',
                            borderRadius: 7,
                            border: 0,
                            background: '#527d67',
                            color: '#fff',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: importingCai ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <FolderDown size={14} />
                          {importingCai ? 'Importing...' : 'Import Selected into Studio'}
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                      {caiPreview.characters?.map((char) => {
                        const isSelected = Boolean(selectedChars[char.externalId]);
                        return (
                          <div
                            key={char.externalId}
                            onClick={() => setSelectedChars((prev) => ({ ...prev, [char.externalId]: !prev[char.externalId] }))}
                            style={{
                              background: isSelected ? '#f5faf5' : '#fff',
                              border: `1.5px solid ${isSelected ? '#527d67' : '#e1e7e1'}`,
                              borderRadius: 10,
                              padding: 14,
                              cursor: 'pointer',
                              display: 'flex',
                              gap: 12,
                              alignItems: 'flex-start',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              style={{ marginTop: 4, cursor: 'pointer', accentColor: '#527d67' }}
                            />
                            <img
                              src={char.imageUrl || '/api/lu/media/default-persona.svg'}
                              alt={char.name}
                              style={{ width: 50, height: 50, borderRadius: 8, objectFit: 'cover', background: '#eee' }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                <strong style={{ fontSize: 14, color: '#1f2a27' }}>{char.name}</strong>
                                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#e8efe8', color: '#476356', fontWeight: 600 }}>
                                  {char.chats?.length || 0} chats
                                </span>
                              </div>
                              <p style={{ fontSize: 11, color: '#687774', margin: '4px 0 8px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                {char.description || char.prompt || 'No description'}
                              </p>

                              <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 10, color: '#72817e' }}>Voice:</span>
                                <select
                                  value={importVoiceChoices[char.externalId] || 'Alba'}
                                  onChange={(e) => setImportVoiceChoices((prev) => ({ ...prev, [char.externalId]: e.target.value }))}
                                  style={{ fontSize: 10, padding: '3px 6px', borderRadius: 4, border: '1px solid #d0d7d0', background: '#fff' }}
                                >
                                  {DEFAULT_VOICES.map((v) => (
                                    <option key={v} value={v}>{v}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            </Route>

            <Route path="/settings">
              <section className="settings-page">
                <div className="settings-heading">
                  <div className="eyebrow"><SlidersHorizontal size={13} />Workspace controls</div>
                  <h1>Settings</h1>
                  <p>Connection, Supabase sync, local ComfyUI & Ollama model behavior.</p>
                </div>
                <div className="settings-grid">
                  <section className="settings-card" data-testid="card-runtime-status">
                    <h2 className="card-title"><span className="card-icon"><Activity size={15} /></span>Runtime connection</h2>
                    <p className="card-desc">Finch talks to Ollama, ComfyUI, and your local TTS engine.</p>
                    <div className="connection-row"><span className="connection-label">Ollama Status</span><span className="connection-value" data-testid="text-connection-status"><span className={`status-dot ${connected ? 'online' : ''}`} />{runtime.loading ? 'Checking…' : connected ? `Connected (${runtime.version})` : 'Not connected'}</span></div>
                    <div className="connection-row"><span className="connection-label">ComfyUI (:8188)</span><span className="connection-value"><span className={`status-dot ${luStatus?.comfyui.running ? 'online' : ''}`} />{luStatus?.comfyui.running ? 'Running' : luStatus?.comfyui.installed ? 'Installed (Idle)' : 'Local Studio Fallback'}</span></div>
                    <div className="connection-row"><span className="connection-label">Installed Ollama models</span><span className="connection-value" data-testid="text-model-count">{runtime.loading ? 'Checking…' : `${runtime.models.length} models`}</span></div>
                    <button className="refresh-button" onClick={() => { void loadRuntime(); void loadLuStudio(); }} disabled={runtime.loading} style={{ marginTop: 12 }} data-testid="button-refresh-runtime">
                      <RefreshCw size={13} className={runtime.loading ? 'spin' : ''} />Check connections
                    </button>
                  </section>

                  <section className="settings-card">
                    <h2 className="card-title"><span className="card-icon"><Sparkles size={15} /></span>GPT4Free (G4F) Frontier Engine</h2>
                    <p className="card-desc">Access 600B+ frontier models (DeepSeek-R1 reasoning, GPT-4o, Claude 3.5 Sonnet) via local G4F API (:1337).</p>
                    <div className="connection-row">
                      <span className="connection-label">G4F Server Status</span>
                      <span className="connection-value">
                        <span className={`status-dot ${g4fStatus?.running ? 'online' : ''}`} />
                        {g4fStatus?.running ? 'Running (:1337)' : 'Stopped (Offline)'}
                      </span>
                    </div>
                    <div className="connection-row">
                      <span className="connection-label">Active Inference Engine</span>
                      <span className="connection-value" style={{ fontWeight: 700, color: preferences.inferenceBackend === 'g4f' ? '#215c3b' : '#33444a' }}>
                        {preferences.inferenceBackend === 'g4f' ? 'Frontier (G4F)' : 'Local (Ollama)'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      {g4fStatus?.running ? (
                        <button
                          type="button"
                          className="refresh-button"
                          onClick={handleStopG4f}
                          style={{ color: '#a34839', borderColor: '#e4c4bd' }}
                        >
                          <Square size={13} /> Stop G4F Server
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="refresh-button"
                          onClick={handleStartG4f}
                          disabled={startingG4f}
                          style={{ color: '#27523c', borderColor: '#b8d8be', background: '#eaf4ee' }}
                        >
                          <Play size={13} /> {startingG4f ? 'Starting G4F…' : 'Launch G4F Server'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="refresh-button"
                        onClick={() => {
                          const next = preferences.inferenceBackend === 'g4f' ? 'ollama' : 'g4f';
                          updatePreference('inferenceBackend', next);
                          if (next === 'g4f') {
                            updatePreference('model', 'deepseek-r1');
                          } else if (runtime.models[0]) {
                            updatePreference('model', runtime.models[0].name);
                          }
                        }}
                      >
                        Switch to {preferences.inferenceBackend === 'g4f' ? 'Ollama' : 'G4F'}
                      </button>
                    </div>
                  </section>

                  <section className="settings-card">
                    <h2 className="card-title"><span className="card-icon"><Database size={15} /></span>Supabase `ai_girls` Integration</h2>
                    <p className="card-desc">Configure your Supabase URL & API Key to sync generated AI Girl personas directly to your cloud `ai_girls` table.</p>
                    <form onSubmit={handleSaveSupabaseConfig} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                      <input
                        className="model-select"
                        placeholder="https://your-project.supabase.co"
                        value={supabaseUrl}
                        onChange={(e) => setSupabaseUrl(e.target.value)}
                      />
                      <input
                        className="model-select"
                        type="password"
                        placeholder="YOUR_SUPABASE_KEY (anon / service_role)"
                        value={supabaseKey}
                        onChange={(e) => setSupabaseKey(e.target.value)}
                      />
                      <button type="submit" style={{ padding: '9px 14px', borderRadius: 8, border: 0, background: '#527d67', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                        Save Supabase Credentials
                      </button>
                      {supabaseSavedMsg && <div style={{ fontSize: 11, color: '#3b6e52' }}>{supabaseSavedMsg}</div>}
                    </form>
                  </section>

                  <section className="settings-card wide">
                    <h2 className="card-title">
                      <span className="card-icon"><Cpu size={15} /></span>
                      12-Engine Auto-Discovery (Locally Uncensored)
                    </h2>
                    <p className="card-desc">
                      Automatically scans and detects local AI backends running on your machine (ports 11434, 1234, 1337, 5001, 8080, etc.).
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginTop: 12 }}>
                      {(luStatus?.engines || [
                        { name: 'Ollama', port: 11434, running: connected },
                        { name: 'LM Studio', port: 1234, running: false },
                        { name: 'Jan', port: 1337, running: false },
                        { name: 'KoboldCpp', port: 5001, running: false },
                        { name: 'llama.cpp', port: 8080, running: false },
                        { name: 'vLLM', port: 8000, running: false },
                        { name: 'LocalAI', port: 8080, running: false },
                        { name: 'Text-Gen WebUI', port: 5000, running: false },
                        { name: 'TabbyAPI', port: 5000, running: false },
                        { name: 'Aphrodite', port: 2242, running: false },
                        { name: 'SGLang', port: 30000, running: false },
                        { name: 'GPT4All API', port: 4891, running: false },
                        { name: 'ComfyUI', port: 8188, running: Boolean(luStatus?.comfyui.running) },
                      ]).map((eng: any) => (
                        <div
                          key={eng.name}
                          style={{
                            background: eng.running ? '#e7f3ec' : '#f5f2ea',
                            border: `1px solid ${eng.running ? '#a3d4b6' : '#dedad0'}`,
                            borderRadius: 8,
                            padding: '8px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: eng.running ? '#1e4b33' : '#33444a' }}>
                              {eng.name}
                            </div>
                            <div style={{ fontSize: 10, color: '#7a888c', fontFamily: 'monospace' }}>
                              :{eng.port}
                            </div>
                          </div>
                          <span className={`status-dot ${eng.running ? 'online' : ''}`} />
                        </div>
                      ))}
                    </div>
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

                  <section className="settings-card wide" style={{ background: '#e9efe7', borderColor: '#d7e2d5' }}>
                    <h2 className="card-title"><span className="card-icon"><ShieldCheck size={15} /></span>Local by design</h2>
                    <p className="card-desc" style={{ marginBottom: 0 }}>
                      Conversation history and preferences stay in this browser’s local storage. AI Girl personas are saved to your local database (`data/ai_girls.json` or PostgreSQL `@workspace/db`) and optionally synced to Supabase when configured.
                    </p>
                  </section>
                </div>
              </section>
            </Route>

            <Route>
              <section className="empty-conversation">
                <WifiOff size={25} />
                <h2>That page isn’t here</h2>
                <p>Head back to your local workspace to pick up where you left off.</p>
                <Link href="/" className="refresh-button" data-testid="link-return-chat">Return to chat</Link>
              </section>
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
