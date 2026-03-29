import { Tldraw } from 'tldraw'
import { b64Vecs } from '@tldraw/editor'
import 'tldraw/tldraw.css'
import { useEffect, useRef, useState } from 'react'
import { loadModel, runModel } from './ocr/model'
import { strokesToImage } from './ocr/preprocess'
import { segmentStrokes } from './ocr/segment'
import { parseMath } from './ocr/parser'
import { Profiler } from './ocr/profiler'

const profiler = new Profiler()

// Decode all points from a tldraw v4 draw shape.
// In v4, points are NOT in segment.points — they are base64-delta-encoded
// in segment.path and must be decoded with b64Vecs.decodePoints().
// The shape's x/y offset must be added to get canvas-space coordinates.
export function getPointsFromShape(shape) {
  const allPoints = []
  for (const seg of shape.props.segments ?? []) {
    const pts = b64Vecs.decodePoints(seg.path)
    for (const p of pts) {
      allPoints.push({
        x: shape.x + p.x,
        y: shape.y + p.y,
        z: p.z ?? 0.5,
      })
    }
  }
  return allPoints
}

// After strokesToImage, visualize the 28x28 input
const debugCanvas = (imgArray, label) => {
  const canvas = document.createElement('canvas')
  canvas.width = 28
  canvas.height = 28
  canvas.style = 'position:fixed;bottom:10px;left:10px;width:112px;height:112px;image-rendering:pixelated;border:1px solid red'
  canvas.id = 'debug-canvas'
  document.getElementById('debug-canvas')?.remove()
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  const id = ctx.createImageData(28, 28)
  for (let i = 0; i < 28 * 28; i++) {
    const v = Math.round(imgArray[i] * 255)
    id.data[i * 4 + 0] = v
    id.data[i * 4 + 1] = v
    id.data[i * 4 + 2] = v
    id.data[i * 4 + 3] = 255
  }
  ctx.putImageData(id, 0, 0)
  ctx.font = '15px monospace'
  ctx.fillStyle = 'red'
  ctx.textBaseline = 'top'
  ctx.fillText(label, 1, 1)
}

export default function App() {
  const editorRef = useRef(null)
  const modelRef = useRef(null)
  const debounceRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [output, setOutput] = useState('')
  const [metrics, setMetrics] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    loadModel()
      .then((m) => {
        modelRef.current = m
        setReady(true)
      })
      .catch((e) => setError(e.message))
  }, [])

  const handleChange = async (editor) => {
    if (!modelRef.current) return

    profiler.start('total')

    profiler.start('segment')
    const shapeIds = editor.getCurrentPageShapeIds()
    const shapes = [...shapeIds]
      .map((id) => editor.getShape(id))
      .filter((s) => s?.type === 'draw' && s.props.isComplete === true)

    if (shapes.length === 0) {
      setOutput('')
      profiler.end('segment')
      profiler.end('total')
      return
    }

    // Decode points from base64 format and attach as flat .points array
    const strokes = shapes.map((s) => ({
      ...s,
      points: getPointsFromShape(s),
    }))

    const segments = segmentStrokes(strokes)
    profiler.end('segment')

    let results = []
    for (const seg of segments) {
      profiler.start('preprocess')
      const img = strokesToImage(seg)
      profiler.end('preprocess')
      
      profiler.start('inference')
      const pred = await runModel(modelRef.current, img)
      results.push({ ...seg, label: pred })
      profiler.end('inference')
      profiler.start('debug')
      debugCanvas(img, pred)
      profiler.end('debug')
    }

    profiler.start('parse')
    const parsed = parseMath(results)
    setOutput(parsed)
    profiler.end('parse')

    profiler.end('total')
    setMetrics(profiler.report())
    profiler.reset()
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'monospace' }}>
      <div style={{ flex: 1 }}>
        <Tldraw
          onMount={(editor) => {
            editorRef.current = editor
            editor.store.listen(
              (entry) => {
                const allChanged = [
                  ...Object.values(entry.changes.added ?? {}),
                  ...Object.values(entry.changes.updated ?? {}).map(([, next]) => next),
                  ...Object.values(entry.changes.removed ?? {}),
                ]
                if (!allChanged.some((r) => r?.type === 'draw')) return
                if (debounceRef.current) clearTimeout(debounceRef.current)
                debounceRef.current = setTimeout(() => handleChange(editor), 150)
              },
              { source: 'user', scope: 'document' }
            )
          }}
        />
      </div>

      <div
        style={{
          width: 300,
          padding: 20,
          borderLeft: '1px solid #ccc',
          fontSize: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>
          {!ready ? 'Loading model…' : error ? `Error: ${error}` : 'Recognized'}
        </div>
        <div style={{ wordBreak: 'break-word', whiteSpace: 'pre'}}>
          {output || <span style={{ color: '#ccc' }}>Draw something…</span>}
        </div>
      </div>

      {Object.keys(metrics).length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            background: 'black',
            color: 'lime',
            padding: 10,
            fontSize: 12,
            borderRadius: 4,
            lineHeight: 1.6,
          }}
        >
          {Object.entries(metrics).map(([k, v]) => (
            <div key={k}>{k}: {v.toFixed(2)} ms</div>
          ))}
        </div>
      )}
    </div>
  )
}