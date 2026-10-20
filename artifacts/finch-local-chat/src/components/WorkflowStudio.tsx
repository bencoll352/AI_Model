import React from 'react';
import { SlidersHorizontal, Sparkles, Play, CheckCircle2, ArrowRight, Download, Image as ImageIcon, Volume2, Mic, Bot, Layers, Check } from 'lucide-react';

export interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  data?: Record<string, any>;
}

export interface WorkflowConnection {
  from: string;
  to: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

interface WorkflowStudioProps {
  workflows: WorkflowTemplate[];
  selectedId: string;
  onSelectWorkflow: (id: string) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onRunWorkflow: () => Promise<void>;
  running: boolean;
  result: { imageUrl?: string; provider?: string; enhancedPrompt?: string } | null;
  statusMsg: string | null;
  onSelectPersonaImage?: (url: string) => void;
}

export const WorkflowStudio: React.FC<WorkflowStudioProps> = ({
  workflows,
  selectedId,
  onSelectWorkflow,
  prompt,
  onPromptChange,
  onRunWorkflow,
  running,
  result,
  statusMsg,
  onSelectPersonaImage,
}) => {
  const activeWf = workflows.find((w) => w.id === selectedId) || workflows[0];
  const [copiedUrl, setCopiedUrl] = React.useState(false);

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(window.location.origin + url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  const getNodeColor = (type: string) => {
    switch (type) {
      case 'characterPrompt':
      case 'audioInput':
        return { border: '#e6a756', bg: '#fdf8f0', badge: '#d9822b', text: '#5c3a10' };
      case 'photorealConditioner':
      case 'senseVoiceClassifier':
        return { border: '#7b68ee', bg: '#f6f4fe', badge: '#6a5acd', text: '#3c3175' };
      case 'negativeFilter':
      case 'emotionInjector':
        return { border: '#e0607e', bg: '#fdf2f4', badge: '#c73e60', text: '#69182d' };
      case 'generativeModel':
      case 'llmEngine':
        return { border: '#38a169', bg: '#f0fdf4', badge: '#2f855a', text: '#1b4a32' };
      case 'outputMedia':
      case 'neuralTts':
        return { border: '#319795', bg: '#f0fdfa', badge: '#285e61', text: '#133537' };
      default:
        return { border: '#8b9bb4', bg: '#f8fafc', badge: '#64748b', text: '#334155' };
    }
  };

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div className="settings-heading" style={{ marginBottom: 0 }}>
        <div className="eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <SlidersHorizontal size={13} />
          Node-Banana Generative Workflows · shrimbly/node-banana
        </div>
        <h1>Visual Node Pipeline &amp; Lifelike Studio</h1>
        <p>
          Execute free, open node-based generative media pipelines. Connects parametric prompt conditioning (85mm f/1.4 lens, natural skin tones, Kodak Portra 400), anti-artificial negative filters, and FLUX.1 / ComfyUI latent samplers for genuine photographic realism.
        </p>
      </div>

      {statusMsg && (
        <div style={{ background: '#e3efe5', border: '1px solid #b8d8be', color: '#2b593f', padding: '11px 15px', borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={15} />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Workflow Tabs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {workflows.map((wf) => (
          <button
            key={wf.id}
            type="button"
            onClick={() => onSelectWorkflow(wf.id)}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: selectedId === wf.id ? '2px solid #527d67' : '1px solid #ddd9ce',
              background: selectedId === wf.id ? '#e7f0ea' : '#f5f2e9',
              color: '#28383f',
              fontWeight: selectedId === wf.id ? 800 : 600,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.15s ease',
            }}
          >
            <Layers size={14} color={selectedId === wf.id ? '#527d67' : '#72817e'} />
            {wf.name}
          </button>
        ))}
      </div>

      {/* Node Canvas Visualization */}
      <div
        style={{
          background: '#1a2428',
          borderRadius: 14,
          padding: '24px 20px',
          border: '1px solid #28373d',
          boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.3)',
          overflowX: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ color: '#c7d5cd', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
            Pipeline Graph: {activeWf?.name}
          </div>
          <span style={{ fontSize: 11, color: '#7a8f89', fontFamily: '"DM Mono", monospace' }}>
            ENGINE: FLUX.1-DEV / SENSEVOICE / EDGE-TTS
          </span>
        </div>

        {/* Node Sequence Horizontal Layout */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 14, minWidth: 840, paddingBottom: 8 }}>
          {activeWf?.nodes.map((node, idx) => {
            const colors = getNodeColor(node.type);
            return (
              <React.Fragment key={node.id}>
                <div
                  style={{
                    flex: '1 1 200px',
                    minWidth: 175,
                    maxWidth: 240,
                    background: '#233036',
                    border: `1.5px solid ${colors.border}`,
                    borderRadius: 10,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: '"DM Mono", monospace',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: colors.badge,
                        color: '#ffffff',
                      }}
                    >
                      {node.type}
                    </span>
                    <span style={{ fontSize: 10, color: '#8ca699', fontFamily: '"DM Mono", monospace' }}>
                      #{idx + 1}
                    </span>
                  </div>

                  <div style={{ color: '#f0ede3', fontSize: 12, fontWeight: 700 }}>
                    {node.label}
                  </div>

                  {node.data && (
                    <div style={{ fontSize: 10, color: '#a2b8ad', background: '#1c262b', padding: '6px 8px', borderRadius: 6, lineHeight: 1.4 }}>
                      {Object.entries(node.data).map(([k, v]) => (
                        <div key={k} style={{ marginBottom: 2 }}>
                          <strong style={{ color: '#d0dfd7' }}>{k}:</strong> {String(v).slice(0, 50)}
                          {String(v).length > 50 ? '…' : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 9, color: '#7a8f89' }}>
                    <span>INPUT &bull; READY</span>
                    <span style={{ color: '#4ade80' }}>ACTIVE</span>
                  </div>
                </div>

                {idx < activeWf.nodes.length - 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#527d67' }}>
                    <ArrowRight size={18} strokeWidth={2.5} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Execution Controls & Results */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        {/* Run Form */}
        <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="card-title">
            <span className="card-icon"><Sparkles size={15} /></span>
            Execute Node-Banana Pipeline
          </h2>
          <p className="card-desc">
            Conditioned with 85mm f/1.4 lens optics, Kodak Portra 400 skin tones, natural subsurface scattering, and FLUX.1 latent sampling.
          </p>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#33444a', marginBottom: 5 }}>
              Parametric Scene &amp; Subject Prompt
            </label>
            <textarea
              className="model-select"
              rows={3}
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="e.g. Lifelike photorealistic portrait of an AI companion with warm smile, golden hour lighting, cozy loft..."
              style={{ width: '100%', resize: 'vertical', fontSize: 12, lineHeight: 1.5, padding: '10px 12px' }}
            />
          </div>

          <button
            type="button"
            onClick={onRunWorkflow}
            disabled={running || !prompt.trim()}
            style={{
              padding: '12px 20px',
              borderRadius: 9,
              border: 0,
              background: running ? '#8da597' : '#336049',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: running ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s ease',
            }}
          >
            {running ? (
              <>
                <span className="animate-spin" style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%' }} />
                <span>Running Node-Banana Graph (FLUX.1)...</span>
              </>
            ) : (
              <>
                <Play size={15} fill="currentColor" />
                <span>Generate Lifelike Media</span>
              </>
            )}
          </button>
        </div>

        {/* Output Viewer */}
        <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="card-title">
            <span className="card-icon"><ImageIcon size={15} /></span>
            Pipeline Output
          </h2>
          <p className="card-desc">
            {result?.provider ? `Generated via ${result.provider} (8K UHD Photorealism)` : 'Run the workflow to generate lifelike media.'}
          </p>

          <div
            style={{
              flex: 1,
              minHeight: 220,
              background: '#f2eee3',
              borderRadius: 10,
              border: '1px dashed #c8cfca',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {result?.imageUrl ? (
              <img
                src={result.imageUrl}
                alt="Generated Lifelike Persona"
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 9 }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: '#8ca198', padding: 20 }}>
                <ImageIcon size={32} strokeWidth={1.5} style={{ margin: '0 auto 8px', display: 'block' }} />
                <div style={{ fontSize: 12, fontWeight: 600 }}>Ready for generation</div>
                <div style={{ fontSize: 10, marginTop: 4 }}>Click "Generate Lifelike Media" to run the pipeline.</div>
              </div>
            )}
          </div>

          {result?.imageUrl && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleCopyUrl(result.imageUrl!)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 7,
                  border: '1px solid #ccd6cf',
                  background: '#ffffff',
                  color: '#2d4047',
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  cursor: 'pointer',
                }}
              >
                {copiedUrl ? <Check size={13} color="#2b8252" /> : <Download size={13} />}
                {copiedUrl ? 'Copied URL!' : 'Copy Asset Link'}
              </button>

              {onSelectPersonaImage && (
                <button
                  type="button"
                  onClick={() => onSelectPersonaImage(result.imageUrl!)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 7,
                    border: 0,
                    background: '#527d67',
                    color: '#ffffff',
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    cursor: 'pointer',
                  }}
                >
                  <CheckCircle2 size={13} />
                  <span>Use as Studio Avatar</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
