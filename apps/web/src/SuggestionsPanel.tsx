import { useState } from 'react'

interface Suggestions {
  variantA: string[]
  variantB: string[]
}

function BulletList({ items, color }: { items: string[]; color: 'a' | 'b' }) {
  const dot = color === 'a' ? '#1A5F8A' : '#6BA3BE'
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-sm text-ink leading-relaxed">
          <span
            className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: dot }}
            aria-hidden="true"
          />
          {item}
        </li>
      ))}
    </ul>
  )
}

export default function SuggestionsPanel() {
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setSuggestions(null)
    try {
      const res = await fetch('/api/suggestions', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Unknown error')
      setSuggestions(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-sm text-ink-2 mt-1">
            AI-generated UX improvement suggestions based on the latest simulation run.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className={`px-5 py-2.5 text-xs font-semibold uppercase tracking-label border-2 transition-colors ${
            loading
              ? 'border-ink-4 text-ink-4 cursor-not-allowed'
              : 'border-ink text-ink hover:bg-ink hover:text-paper'
          }`}
        >
          {loading ? 'Analyzing…' : suggestions ? 'Regenerate' : 'Generate Suggestions'}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 py-12 text-ink-3">
          <div className="w-1.5 h-1.5 rounded-full bg-ink-4 animate-pulse" />
          <span className="text-sm">Analyzing simulation results with GPT-4o…</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="border-l-[3px] border-ink pl-5 py-3 mt-4">
          <p className="text-sm text-ink font-semibold">Failed to generate suggestions</p>
          <p className="text-xs text-ink-3 mt-1">{error}</p>
        </div>
      )}

      {/* Results */}
      {suggestions && !loading && (
        <div className="grid grid-cols-2 gap-10">
          {/* Variant A */}
          <div>
            <div className="flex items-center gap-3 mb-5 pb-3 border-b border-rule">
              <span className="text-xs font-semibold uppercase tracking-label text-a">Variant A</span>
              <span className="text-[10px] text-ink-4 font-mono">{suggestions.variantA.length} suggestions</span>
            </div>
            <BulletList items={suggestions.variantA} color="a" />
          </div>

          {/* Variant B */}
          <div>
            <div className="flex items-center gap-3 mb-5 pb-3 border-b border-rule">
              <span className="text-xs font-semibold uppercase tracking-label text-b">Variant B</span>
              <span className="text-[10px] text-ink-4 font-mono">{suggestions.variantB.length} suggestions</span>
            </div>
            <BulletList items={suggestions.variantB} color="b" />
          </div>
        </div>
      )}

      {/* Empty state */}
      {!suggestions && !loading && !error && (
        <div className="py-16 text-center border border-dashed border-rule">
          <p className="text-sm text-ink-3">
            Click <span className="font-semibold text-ink">Generate Suggestions</span> to run the AI analysis.
          </p>
          <p className="text-xs text-ink-4 mt-2">Requires simulation data and a valid OPENAI_API_KEY.</p>
        </div>
      )}
    </div>
  )
}
