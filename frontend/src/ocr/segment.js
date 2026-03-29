// segmentStrokes expects strokes that already have a flat .points array
// (decoded upstream via getPointsFromShape in App.jsx).
// It groups overlapping strokes into clusters for recognition.

export function segmentStrokes(strokes) {
  const clusters = []

  for (const s of strokes) {
    const bbox = getBBox(s.points)
    if (!bbox) continue

    let added = false
    for (const c of clusters) {
      if (overlaps(c.bbox, bbox)) {
        c.strokes.push(s)
        c.bbox = mergeBBox(c.bbox, bbox)
        added = true
        break
      }
    }

    if (!added) {
      clusters.push({ strokes: [s], bbox })
    }
  }

  return clusters
}

// Expects a flat [{x, y, z}] array
function getBBox(points) {
  if (!points || points.length === 0) return null

  let minX = Infinity, minY = Infinity
  let maxX = -Infinity, maxY = -Infinity

  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  return { minX, minY, maxX, maxY }
}

function overlaps(a, b) {
  const margin = 10
  return !(
    a.maxX + margin < b.minX ||
    b.maxX + margin < a.minX ||
    a.maxY + margin < b.minY ||
    b.maxY + margin < a.minY
  )
}

function mergeBBox(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}