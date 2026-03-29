import { Tldraw } from 'tldraw'
import { b64Vecs } from '@tldraw/editor'
import 'tldraw/tldraw.css'
import { useState, useRef, useEffect } from 'react'

function getPointsFromShape(shape) {
  return (shape.props.segments ?? []).map((seg) => {
    const pts = b64Vecs.decodePoints(seg.path)
    return pts.map((p) => ({
      x: shape.x + p.x,
      y: shape.y + p.y,
    }))
  })
}

const CLASSES = '0123456789+-=/xy()'

export default function DataCapture() {
  const [label, setLabel] = useState('')
  const [samples, setSamples] = useState([])
  const [status, setStatus] = useState('Loading…')
  const [saving, setSaving] = useState(false)
  const editorRef = useRef(null)

  // Load existing dataset from public/dataset.json on mount
  useEffect(() => {
    fetch('/dataset.json')
      .then((r) => {
        if (!r.ok) throw new Error('No existing dataset found')
        return r.json()
      })
      .then((data) => {
        setSamples(data)
        setStatus(`Loaded ${data.length} existing samples`)
      })
      .catch(() => {
        setStatus('No existing dataset — starting fresh')
      })
  }, [])

  const capture = (editor) => {
    if (!label) return alert('Enter a label first')
    if (!CLASSES.includes(label)) return alert(`Label must be one of: ${CLASSES}`)

    const shapeIds = editor.getCurrentPageShapeIds()
    const shapes = [...shapeIds]
      .map((id) => editor.getShape(id))
      .filter((s) => s?.type === 'draw' && s.props.isComplete === true)

    if (shapes.length === 0) return

    const strokes = shapes.map((s) => getPointsFromShape(s))
    const sample = { label, strokes }

    setSamples((prev) => {
      const next = [...prev, sample]
      setStatus(`${next.length} samples total`)
      return next
    })

    editor.deleteShapes([...shapeIds])
    setLabel('')
  }

  // Save back to public/dataset.json via PUT to the Vite dev server
  // In production replace this with your own API endpoint
  const save = async () => {
    setSaving(true)
    setStatus('Saving…')
    try {
      const res = await fetch('/dataset.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(samples, null, 2),
      })
      if (!res.ok) throw new Error(res.statusText)
      setStatus(`Saved ${samples.length} samples ✓`)
    } catch {
      // Vite dev server doesn't support PUT — fall back to download
      setStatus('PUT not supported, downloading instead…')
      const blob = new Blob([JSON.stringify(samples, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'dataset.json'
      a.click()
      setStatus(`Downloaded ${samples.length} samples — replace public/dataset.json`)
    } finally {
      setSaving(false)
    }
  }

  const undo = () => {
    setSamples((prev) => {
      const next = prev.slice(0, -1)
      setStatus(`${next.length} samples total`)
      return next
    })
  }

  const counts = samples.reduce((acc, s) => {
    acc[s.label] = (acc[s.label] ?? 0) + 1
    return acc
  }, {})

  const minCount = Math.min(...CLASSES.split('').map((c) => counts[c] ?? 0))
  const maxCount = Math.max(...CLASSES.split('').map((c) => counts[c] ?? 0))

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      <Tldraw
        onMount={(editor) => {
          editorRef.current = editor
          window.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') capture(editor)
          })
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          background: 'white',
          border: '1px solid #ccc',
          borderRadius: 8,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 220,
          fontFamily: 'monospace',
          fontSize: 13,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ fontWeight: 'bold', fontSize: 14 }}>Data Capture</div>

        <div style={{ fontSize: 11, color: '#888' }}>{status}</div>

        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={`Label (${CLASSES})`}
          maxLength={1}
          style={{
            padding: '4px 8px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 16,
            textAlign: 'center',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => capture(editorRef.current)}
            style={{ flex: 1, padding: '4px 0', cursor: 'pointer' }}
          >
            Capture ↵
          </button>
          <button
            onClick={undo}
            disabled={samples.length === 0}
            style={{ padding: '4px 8px', cursor: 'pointer' }}
          >
            Undo
          </button>
        </div>

        <button
          onClick={save}
          disabled={samples.length === 0 || saving}
          style={{ padding: '4px 0', cursor: 'pointer', fontWeight: 'bold' }}
        >
          {saving ? 'Saving…' : 'Save dataset.json'}
        </button>

        <div style={{ borderTop: '1px solid #eee', paddingTop: 8 }}>
          <div style={{ marginBottom: 4 }}>
            Total: {samples.length} &nbsp;|&nbsp; min: {minCount} max: {maxCount}
          </div>
          {/* Per-class count with a small bar showing relative balance */}
          {CLASSES.split('').map((c) => {
            const count = counts[c] ?? 0
            const pct = maxCount > 0 ? count / maxCount : 0
            const isLow = count === minCount && maxCount > minCount
            return (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <span style={{ width: 14, color: isLow ? '#e55' : '#333', fontWeight: isLow ? 'bold' : 'normal' }}>
                  {c}
                </span>
                <div style={{ flex: 1, background: '#eee', borderRadius: 2, height: 6 }}>
                  <div style={{ width: `${pct * 100}%`, background: isLow ? '#e55' : '#4a9', height: 6, borderRadius: 2 }} />
                </div>
                <span style={{ width: 24, textAlign: 'right', color: isLow ? '#e55' : '#666' }}>{count}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}