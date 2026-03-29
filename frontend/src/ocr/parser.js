export function parseMath(symbols) {
  if (!symbols.length) return ''

  // 1. Extraer fracciones (AST nodes)
  const { fractions, remaining } = extractFractions(symbols)
  console.log('Extracted fractions:', fractions, 'Remaining symbols:', remaining)

  // 2. Agrupar en líneas
  const lines = groupIntoLines(remaining)
  if (lines.length === 0) lines.push([]) // Asegurar al menos una línea para insertar fracciones sin símbolos restantes
  console.log(lines)
  // 3. Insertar fracciones en líneas correctas
  for (const frac of fractions) {
    const line = findClosestLine(lines, frac.bar)
    insertNodeInLine(line, frac)
  }

  // 4. Parsear cada línea → AST → string
  const results = lines.map(parseLineToAST).map(renderAST)

  return results.join('\n')
}

//////////////////////////
// FRACTIONS
//////////////////////////

function isPotentialBar(s) {
  const w = s.bbox.maxX - s.bbox.minX
  const h = s.bbox.maxY - s.bbox.minY

  return w > 3*h && w > 8
}

function clusterHorizontally(symbols, bar) {
  if (!symbols.length) return []

  // Solo símbolos cercanos al centro de la barra
  const cx = centerX(bar)

  return symbols.filter(s => {
    const dist = Math.abs(centerX(s) - cx)
    const width = bar.bbox.maxX - bar.bbox.minX
    return dist < width * 0.6
  })
}

function getFractionParts(symbols, bar) {
  const padX = 4
  const padY = 6

  const minX = bar.bbox.minX - padX
  const maxX = bar.bbox.maxX + padX

  const candidates = symbols.filter(s =>
    s !== bar &&
    s.bbox.maxX >= minX &&
    s.bbox.minX <= maxX
  )

  const above = []
  const below = []

  for (const s of candidates) {
    const dyTop = bar.bbox.minY - s.bbox.maxY
    const dyBottom = s.bbox.minY - bar.bbox.maxY

    if (dyTop >= 0 && dyTop < 50) {
      above.push(s)
    } else if (dyBottom >= 0 && dyBottom < 50) {
      below.push(s)
    }
  }

  return { above, below }
}

function isValidFraction(bar, above, below) {
  if (above.length === 0 || below.length === 0) return false

  // Debe haber alineación horizontal real
  const overlapAbove = above.some(s => overlapX(s, bar) > 0.3)
  const overlapBelow = below.some(s => overlapX(s, bar) > 0.3)

  return overlapAbove && overlapBelow
}

function extractFractions(symbols) {
  const used = new Set()
  const fractions = []

  for (const bar of symbols) {
    if (!isPotentialBar(bar)) continue

    const { above, below } = getFractionParts(symbols, bar)

    if (!isValidFraction(bar, above, below)) continue

    // Ordenar correctamente
    above.sort((a,b)=>centerX(a)-centerX(b))
    below.sort((a,b)=>centerX(a)-centerX(b))

    // ⚠️ MUY IMPORTANTE: limitar a componentes conectados
    const numGroup = clusterHorizontally(above, bar)
    const denGroup = clusterHorizontally(below, bar)

    const numAST = parseLineToAST(numGroup)
    const denAST = parseLineToAST(denGroup)

    fractions.push({
      type: 'fraction',
      num: numAST,
      den: denAST,
      bar
    })

    used.add(bar)
    numGroup.forEach(s => used.add(s))
    denGroup.forEach(s => used.add(s))
  }

  return {
    fractions,
    remaining: symbols.filter(s => !used.has(s))
  }
}

//////////////////////////
// LINES
//////////////////////////

function groupIntoLines(symbols) {
  if (!symbols.length) return []

  const sorted = [...symbols].sort((a,b)=>centerY(a)-centerY(b))
  const lines = []
  console.log(sorted)

  for (const sym of sorted) {
    let placed = false

    for (const line of lines) {
      if (verticallyOverlaps(sym, line)) {
        line.symbols.push(sym)
        line.minY = Math.min(line.minY, sym.bbox.minY)
        line.maxY = Math.max(line.maxY, sym.bbox.maxY)
        placed = true
        break
      }
    }

    if (!placed) {
      lines.push({
        symbols: [sym],
        minY: sym.bbox.minY,
        maxY: sym.bbox.maxY
      })
    }
  }

  for (const line of lines) {
    line.symbols.sort((a,b)=>centerX(a)-centerX(b))
  }

  return lines.map(l => l.symbols)
}

function verticallyOverlaps(sym, line) {
  const h = line.maxY - line.minY || 1
  var margin = h * 0.4
  if (margin < 10) margin = 20  // Fix para el signo -
  const cy = centerY(sym)
  return cy >= line.minY - margin && cy <= line.maxY + margin
}

function findClosestLine(lines, bar) {
  const barY = centerY(bar)

  let best = lines[0]
  let bestDist = Infinity

  for (const line of lines) {
    const cy = line.reduce((s,x)=>s+centerY(x),0)/line.length
    const d = Math.abs(cy - barY)

    if (d < bestDist) {
      bestDist = d
      best = line
    }
  }

  return best
}

function insertNodeInLine(line, node) {
  const x = centerX(node.bar)

  let idx = line.findIndex(s => centerX(s) > x)
  if (idx === -1) idx = line.length

  line.splice(idx, 0, {
    type: 'ast',
    node
  })
}

//////////////////////////
// AST BUILDING
//////////////////////////

function parseLineToAST(symbols) {
  const enriched = attachScripts(symbols)

  return {
    type: 'group',
    children: enriched.map(buildNode)
  }
}

function attachScripts(symbols) {
  const out = []

  for (let i=0;i<symbols.length;i++) {
    const base = symbols[i]

    if (base.type === 'ast') {
      out.push(base)
      continue
    }

    const group = { base, supers: [], subs: [] }

    for (let j=i+1;j<symbols.length;j++) {
      const next = symbols[j]

      if (!overlapX(base, next)) break

      const dy = centerY(next) - centerY(base)
      const h = base.bbox.maxY - base.bbox.minY

      if (dy < -h*0.3) {
        group.supers.push(next)
        i = j
      } else if (dy > h*0.3) {
        group.subs.push(next)
        i = j
      } else break
    }

    out.push(group)
  }

  return out
}

function buildNode(g) {
  if (g.type === 'ast') return g.node

  const baseLabel = normalizeSymbol(g.base.label)

  let node = { type: 'symbol', value: baseLabel }

  if (g.base.label === 'v') {
    return {
      type: 'sqrt',
      value: node
    }
  }

  if (g.supers.length || g.subs.length) {
    node = {
      type: 'script',
      base: node,
      sup: g.supers.length ? parseLineToAST(g.supers) : null,
      sub: g.subs.length ? parseLineToAST(g.subs) : null
    }
  }

  return node
}

//////////////////////////
// RENDER
//////////////////////////

function renderAST(node) {
  let out = renderNode(node)

  // post-process normalization
  out = out.replace("-^(-)", '=')
  out = out.replace("-_(-)", '=')

  return out
}

function renderNode(node) {
  switch (node.type) {
    case 'group':
      return node.children.map(renderNode).join('')

    case 'symbol':
      return node.value

    case 'fraction':
      return `(${renderNode(node.num)})/(${renderNode(node.den)})`

    case 'script': {
      const base = renderNode(node.base)
      const sup = node.sup ? renderNode(node.sup) : ''
      const sub = node.sub ? renderNode(node.sub) : ''

      return (
        base +
        (sup ? `^(${sup})` : '') +
        (sub ? `_(${sub})` : '')
      )
    }

    case 'sqrt':
      return `sqrt(${renderNode(node.value)})`

    default:
      return ''
  }
}

//////////////////////////
// UTILS
//////////////////////////

function normalizeSymbol(label) {
  if (label === '−') return '-'
  return label
}

function centerX(s) {
  return (s.bbox.minX + s.bbox.maxX)/2
}

function centerY(s) {
  return (s.bbox.minY + s.bbox.maxY)/2
}

function overlapX(a,b) {
  const left = Math.max(a.bbox.minX, b.bbox.minX)
  const right = Math.min(a.bbox.maxX, b.bbox.maxX)
  return Math.max(0, right-left)/(b.bbox.maxX-b.bbox.minX)
}