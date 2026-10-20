import { useState, useEffect } from 'react';
import {
  Sparkles, RefreshCw, Check, ArrowRight, Eye, Download,
  Layers, Palette, Heart, Flame, Shield, Wand2
} from 'lucide-react';

export type WardrobePreset = {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
};

export const WARDROBE_PRESETS: WardrobePreset[] = [
  {
    id: 'evening_glamour',
    name: 'Evening Glamour',
    description: 'Emerald-green silk backless gown, diamond pendant necklace, gala banquet lighting',
    icon: 'Sparkles',
    tags: ['Silk', 'Cocktail Gown', 'Diamonds', 'Gala']
  },
  {
    id: 'casual_chic',
    name: 'Casual Chic',
    description: 'Oversized cream off-shoulder cashmere knit sweater, fitted dark denim, cozy aesthetic',
    icon: 'Heart',
    tags: ['Cashmere', 'Denim', 'Cozy', 'Lounge']
  },
  {
    id: 'cyberpunk_street',
    name: 'Cyberpunk Streetwear',
    description: 'Sleek cropped black tactical leather jacket, neon bioluminescent trim, techwear accents',
    icon: 'Flame',
    tags: ['Leather', 'Techwear', 'Neon', 'Futuristic']
  },
  {
    id: 'summer_resort',
    name: 'Summer Resort',
    description: 'Breezy pastel floral linen sundress, wide-brim sun hat, Mediterranean coastal villa',
    icon: 'Palette',
    tags: ['Linen', 'Sundress', 'Coastal', 'Golden Hour']
  },
  {
    id: 'haute_couture',
    name: 'Haute Couture',
    description: 'Sharp tailored Parisian runway blazer dress, high-fashion editorial styling',
    icon: 'Layers',
    tags: ['Runway', 'High Fashion', 'Tailored', 'Parisian']
  },
  {
    id: 'athletic_lounge',
    name: 'Athletic Lounge',
    description: 'Sleek minimalist rib-knit athletic lounge set, soft morning sunbeam lighting',
    icon: 'Shield',
    tags: ['Minimalist', 'Rib-Knit', 'Soft Glow', 'Activewear']
  },
  {
    id: 'vintage_elegance',
    name: 'Vintage Elegance',
    description: 'Timeless 1950s Audrey Hepburn black cocktail dress, pearls, classic Parisian café',
    icon: 'Wand2',
    tags: ['Vintage 1950s', 'Pearls', 'Classy', 'Audrey']
  }
];

type Persona = {
  id: number;
  name: string;
  description: string;
  image_url: string;
  voice_url: string;
  prompt?: string;
  voice_id?: string;
  voice_style?: string;
  persona_type?: string;
  wardrobe?: string;
};

export function WardrobeStudio({ onPersonaUpdated }: { onPersonaUpdated?: () => void }) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(null);
  const [selectedWardrobe, setSelectedWardrobe] = useState<string>('evening_glamour');
  const [customDetail, setCustomDetail] = useState<string>('');
  const [transforming, setTransforming] = useState<boolean>(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchPersonas = async () => {
    try {
      const res = await fetch('/api/lu/ai-girls');
      if (res.ok) {
        const raw = await res.json();
        const list: Persona[] = Array.isArray(raw) ? raw : (raw.items || []);
        setPersonas(list);
        if (list.length > 0 && selectedPersonaId === null) {
          setSelectedPersonaId(list[0].id);
        }
      }

    } catch (e) {
      console.error('Failed to load personas for wardrobe studio', e);
    }
  };

  useEffect(() => {
    fetchPersonas();
  }, []);

  const activePersona = personas.find((p) => p.id === selectedPersonaId) || personas[0];

  const handleTransform = async () => {
    if (!activePersona) return;
    setTransforming(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      let prompt = activePersona.prompt || `Photorealistic portrait of ${activePersona.name}`;
      if (customDetail.trim()) {
        prompt += `, ${customDetail.trim()}`;
      }

      const res = await fetch('/api/lu/wardrobe/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: activePersona.id,
          prompt,
          wardrobe: selectedWardrobe,
          name: activePersona.name,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }

      const data = await res.json();
      if (data.image_url) {
        setResultImage(data.image_url);
        setProvider(data.provider || 'node_banana_flux');
        setSuccessMsg(`Outfit successfully transformed to ${WARDROBE_PRESETS.find(w => w.id === selectedWardrobe)?.name}!`);
        await fetchPersonas();
        if (onPersonaUpdated) onPersonaUpdated();
      } else {
        throw new Error(data.error || 'No image returned');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to transform outfit');
    } finally {
      setTransforming(false);
    }
  };

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4d7c67', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          <Palette size={16} />
          <span>Node-Banana FLUX Fashion Engine</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#1a2926', margin: '4px 0 8px' }}>
          AI Virtual Wardrobe &amp; Outfit Stylist
        </h1>
        <p style={{ color: '#576762', fontSize: 14, maxWidth: 780, lineHeight: 1.5 }}>
          Transform the styling, outfits, and fashion aesthetic of your AI companions using photorealistic latent conditioning. Select a persona, pick an outfit archetype, and re-render their appearance seamlessly.
        </p>
      </div>

      {/* Grid: Left Column (Character & Presets) / Right Column (Preview & Live Action) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(360px, 440px)', gap: 24, alignItems: 'start' }}>
        
        {/* Left: Persona selection and style cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Persona Picker */}
          <div style={{ background: '#fff', padding: 18, borderRadius: 12, border: '1px solid #e1ded5', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#687773', marginBottom: 10 }}>
              1. Select Companion to Style
            </label>
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
              {personas.map((p) => {
                const isSelected = p.id === activePersona?.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPersonaId(p.id);
                      setResultImage(null);
                    }}
                    style={{
                      flex: '0 0 auto',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      padding: 8,
                      borderRadius: 10,
                      border: isSelected ? '2px solid #336049' : '1px solid #e0ddd4',
                      background: isSelected ? '#edf5f0' : '#fcfbf8',
                      cursor: 'pointer',
                      width: 86,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <img
                      src={p.image_url || '/api/lu/media/persona-sienna.webp'}
                      alt={p.name}
                      style={{ width: 54, height: 54, borderRadius: 8, objectFit: 'cover' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/api/lu/media/persona-sienna.webp';
                      }}
                    />
                    <span style={{ fontSize: 12, fontWeight: isSelected ? 800 : 600, color: '#273632', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>
                      {p.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Outfit Presets */}
          <div style={{ background: '#fff', padding: 18, borderRadius: 12, border: '1px solid #e1ded5', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#687773', marginBottom: 12 }}>
              2. Choose Outfit &amp; Wardrobe Collection
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {WARDROBE_PRESETS.map((preset) => {
                const isSelected = selectedWardrobe === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => setSelectedWardrobe(preset.id)}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      border: isSelected ? '2px solid #336049' : '1px solid #e3e0d7',
                      background: isSelected ? '#f2f8f4' : '#faf9f5',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#1b4d36' : '#23312e' }}>
                        {preset.name}
                      </span>
                      {isSelected && <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#336049', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={12} /></span>}
                    </div>
                    <p style={{ fontSize: 11, color: '#62706c', margin: 0, lineHeight: 1.4 }}>
                      {preset.description}
                    </p>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {preset.tags.map((t) => (
                        <span key={t} style={{ fontSize: 9, padding: '2px 6px', background: isSelected ? '#dbece1' : '#eeebe2', color: '#43534f', borderRadius: 4, fontWeight: 600 }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Custom Fabric/Color Accent input */}
          <div style={{ background: '#fff', padding: 18, borderRadius: 12, border: '1px solid #e1ded5' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#687773', marginBottom: 6 }}>
              3. Custom Style Accents (Optional)
            </label>
            <input
              type="text"
              value={customDetail}
              onChange={(e) => setCustomDetail(e.target.value)}
              placeholder="e.g. crimson red silk, gold jewelry, soft studio rim lighting..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #d4d0c5',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Right: Live Wardrobe Preview & Transform Trigger */}
        <div style={{ background: '#fff', padding: 20, borderRadius: 14, border: '1px solid #ddd9ce', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', position: 'sticky', top: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#1c2926' }}>
              Styling Studio: {activePersona?.name || 'Companion'}
            </h3>
            {activePersona?.persona_type && (
              <span style={{ fontSize: 11, padding: '3px 8px', background: '#eef5f1', color: '#2b5742', borderRadius: 6, fontWeight: 700 }}>
                {activePersona.persona_type}
              </span>
            )}
          </div>

          {/* Images: Current vs Result */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            {/* Current Image */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7a8984', marginBottom: 6 }}>Current Look</span>
              <img
                src={activePersona?.image_url || '/api/lu/media/persona-sienna.webp'}
                alt="Current"
                style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 10, border: '1px solid #e1ddd2' }}
              />
            </div>

            {/* Transformed Result */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#336049', marginBottom: 6 }}>
                {resultImage ? 'Styled Look' : 'Target Outfit'}
              </span>
              <div
                style={{
                  width: '100%',
                  aspectRatio: '1/1',
                  borderRadius: 10,
                  border: resultImage ? '2px solid #336049' : '1px dashed #cfcbc0',
                  background: resultImage ? 'transparent' : '#f7f6f1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {transforming ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 12, textAlign: 'center' }}>
                    <RefreshCw size={26} className="animate-spin" color="#336049" />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#336049' }}>Sampling FLUX Latents…</span>
                    <span style={{ fontSize: 9, color: '#7a8984' }}>Synthesizing photoreal outfit</span>
                  </div>
                ) : resultImage ? (
                  <img
                    src={resultImage}
                    alt="Styled Look"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#97a39e', padding: 12, textAlign: 'center' }}>
                    <Layers size={28} strokeWidth={1.5} />
                    <span style={{ fontSize: 11, fontWeight: 600 }}>Ready to Transform</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Transform CTA Button */}
          <button
            type="button"
            onClick={handleTransform}
            disabled={transforming}
            style={{
              width: '100%',
              padding: '13px 18px',
              borderRadius: 10,
              border: 0,
              background: transforming ? '#8fae9e' : '#336049',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: transforming ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 8px rgba(51,96,73,0.25)',
              transition: 'background 0.15s ease',
            }}
          >
            {transforming ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>Generating Outfit with Node-Banana…</span>
              </>
            ) : (
              <>
                <Sparkles size={15} />
                <span>Transform Outfit ({WARDROBE_PRESETS.find(w => w.id === selectedWardrobe)?.name})</span>
              </>
            )}
          </button>

          {/* Feedback banners */}
          {successMsg && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#eaf6ee', border: '1px solid #b7dfc3', color: '#1b5a34', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={14} />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#fdf0f0', border: '1px solid #f2c2c2', color: '#8d2323', fontSize: 11, fontWeight: 600 }}>
              {errorMsg}
            </div>
          )}

          {provider && (
            <div style={{ marginTop: 14, fontSize: 10, color: '#7a8984', display: 'flex', justifyContent: 'space-between' }}>
              <span>Generator Engine:</span>
              <span className="code-chip">{provider}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
