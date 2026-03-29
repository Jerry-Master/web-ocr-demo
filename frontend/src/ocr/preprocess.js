// strokesToImage receives a cluster object: { strokes, bbox }
// Each stroke already has a flat .points array [{x, y, z}]
// decoded upstream by getPointsFromShape() in App.jsx.

export function strokesToImage(cluster) {
  const { strokes, bbox } = cluster

  const canvas = document.createElement('canvas')
  canvas.width = 28
  canvas.height = 28
  const ctx = canvas.getContext('2d')

  // Black background
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, 28, 28)
  ctx.strokeStyle = 'white'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const bboxW = bbox.maxX - bbox.minX || 1
  const bboxH = bbox.maxY - bbox.minY || 1

  // Fit into 28x28 with 2px padding, preserving aspect ratio
  const pad = 2
  const scale = Math.min(
    (28 - pad * 2) / bboxW,
    (28 - pad * 2) / bboxH
  )

  // Center the drawing
  const offsetX = pad + (28 - pad * 2 - bboxW * scale) / 2
  const offsetY = pad + (28 - pad * 2 - bboxH * scale) / 2

  const toCanvas = (p) => ({
    x: (p.x - bbox.minX) * scale + offsetX,
    y: (p.y - bbox.minY) * scale + offsetY,
  })

  for (const stroke of strokes) {
    const pts = stroke.points
    if (!pts || pts.length === 0) continue

    ctx.beginPath()
    const first = toCanvas(pts[0])
    ctx.moveTo(first.x, first.y)

    for (let i = 1; i < pts.length; i++) {
      const cp = toCanvas(pts[i])
      ctx.lineTo(cp.x, cp.y)
    }

    ctx.stroke()
  }

  // Extract grayscale pixel data as Float32Array normalized to [0, 1]
  const img = ctx.getImageData(0, 0, 28, 28).data
  const out = new Float32Array(28 * 28)
  for (let i = 0; i < 28 * 28; i++) {
    out[i] = img[i * 4] / 255.0
  }
  return out
}