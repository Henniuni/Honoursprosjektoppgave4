'use strict';
// SVG board renderer for Catan

const SCALE = 72; // pixels per unit
const SVG_W = 660;
const SVG_H = 700;
const CX = SVG_W / 2;  // board center x
const CY = SVG_H / 2 + 10;  // board center y (slight downward offset)

const RESOURCE_COLORS = {
  wood: '#4a7c2f', brick: '#b5451b', sheep: '#7cbb4a',
  wheat: '#d4a017', ore: '#607080', desert: '#c8b560'
};

const RESOURCE_LABELS = {
  wood: 'Forest', brick: 'Hills', sheep: 'Pasture',
  wheat: 'Fields', ore: 'Mountains', desert: 'Desert'
};

const PORT_COLORS = {
  '3:1': '#e8d59a', wood: '#4a7c2f', brick: '#b5451b',
  sheep: '#7cbb4a', wheat: '#d4a017', ore: '#607080'
};

const DOT_COUNTS = { 2:1,3:2,4:2,5:3,6:4,8:4,9:3,10:2,11:2,12:1 };

class CatanBoard {
  constructor(svgEl) {
    this.svg = svgEl;
    this.svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);
    this.svg.setAttribute('width', SVG_W);
    this.svg.setAttribute('height', SVG_H);

    this.interactiveVertices = new Set();
    this.interactiveEdges = new Set();
    this.interactiveTiles = new Set();

    this.onVertexClick = null;
    this.onEdgeClick = null;
    this.onTileClick = null;

    this._state = null;
  }

  px(x) { return CX + x * SCALE; }
  py(y) { return CY + y * SCALE; }

  setInteractiveVertices(ids) { this.interactiveVertices = new Set(ids); }
  setInteractiveEdges(ids)    { this.interactiveEdges = new Set(ids); }
  setInteractiveTiles(ids)    { this.interactiveTiles = new Set(ids); }

  clearInteractive() {
    this.interactiveVertices.clear();
    this.interactiveEdges.clear();
    this.interactiveTiles.clear();
  }

  _el(tag, attrs = {}, cls) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (cls) el.setAttribute('class', cls);
    return el;
  }

  render(state, playerColors) {
    this._state = state;
    this.svg.innerHTML = '';

    const { tiles, vertices, edges, ports } = state.board;

    // ── Water background ──
    this.svg.appendChild(this._el('rect', {
      x: 0, y: 0, width: SVG_W, height: SVG_H, fill: '#1e6fa3'
    }));

    // ── Layer groups (order matters for z-index) ──
    const tileLyr   = this._el('g');
    const portLyr   = this._el('g');
    const edgeLyr   = this._el('g');
    const vertexLyr = this._el('g');
    const robberLyr = this._el('g');

    this.svg.append(tileLyr, portLyr, edgeLyr, vertexLyr, robberLyr);

    // ── Tiles ──
    for (let ti = 0; ti < tiles.length; ti++) {
      const t = tiles[ti];
      const pts = t.vertices.map(vId => {
        const v = vertices[vId];
        return `${this.px(v.x)},${this.py(v.y)}`;
      }).join(' ');

      const hex = this._el('polygon', { points: pts }, 'hex-tile');
      hex.style.fill = RESOURCE_COLORS[t.type] || '#888';
      if (t.hasRobber) hex.classList.add('robber-tile');

      if (this.interactiveTiles.has(ti)) {
        hex.style.cursor = 'pointer';
        hex.style.opacity = '0.85';
        hex.addEventListener('click', () => this.onTileClick && this.onTileClick(ti));
      }

      tileLyr.appendChild(hex);

      // Resource label
      const lx = this.px(t.cx), ly = this.py(t.cy);
      if (t.type !== 'desert') {
        tileLyr.appendChild(this._el('text', { x: lx, y: ly - 22 }, 'hex-label'))
          .textContent = RESOURCE_LABELS[t.type] || t.type;
      } else {
        tileLyr.appendChild(this._el('text', { x: lx, y: ly }, 'hex-label'))
          .textContent = 'Desert';
      }

      // Number token
      if (t.number) {
        const g = this._el('g');
        const dots = DOT_COUNTS[t.number] || 0;
        g.appendChild(this._el('circle', { cx: lx, cy: ly, r: 18 }, 'number-circle'));
        const numTxt = this._el('text', { x: lx, y: ly + 1 }, 'hex-number');
        if (t.number === 6 || t.number === 8) numTxt.classList.add('hot');
        numTxt.textContent = t.number;
        g.appendChild(numTxt);

        // Probability dots
        const dotSpacing = 5;
        const startX = lx - ((dots - 1) * dotSpacing) / 2;
        for (let d = 0; d < dots; d++) {
          const dotEl = this._el('circle', {
            cx: startX + d * dotSpacing, cy: ly + 13, r: 2
          });
          dotEl.style.fill = (t.number === 6 || t.number === 8) ? '#e74c3c' : '#555';
          g.appendChild(dotEl);
        }
        tileLyr.appendChild(g);
      }
    }

    // ── Ports ──
    for (const port of ports) {
      const [v1id, v2id] = port.vertices;
      const v1 = vertices[v1id], v2 = vertices[v2id];
      const x1 = this.px(v1.x), y1 = this.py(v1.y);
      const x2 = this.px(v2.x), y2 = this.py(v2.y);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

      const pline = this._el('line', { x1, y1, x2, y2 }, 'port-line');
      pline.style.stroke = PORT_COLORS[port.type] || '#fff';
      portLyr.appendChild(pline);

      const bg = this._el('circle', { cx: mx, cy: my, r: 11, fill: PORT_COLORS[port.type] || '#fff', stroke: '#fff', 'stroke-width': 1 });
      portLyr.appendChild(bg);

      const label = this._el('text', { x: mx, y: my + 1 }, 'port-label');
      label.textContent = port.type === '3:1' ? '3:1' : `2:1`;
      label.style.fill = port.type === 'wheat' ? '#333' : '#fff';
      label.style.fontSize = '8px';
      portLyr.appendChild(label);
    }

    // ── Edges (roads) ──
    for (const e of edges) {
      const v1 = vertices[e.vertices[0]], v2 = vertices[e.vertices[1]];
      const x1 = this.px(v1.x), y1 = this.py(v1.y);
      const x2 = this.px(v2.x), y2 = this.py(v2.y);

      const line = this._el('line', { x1, y1, x2, y2 }, 'edge-line');

      if (e.road !== null) {
        line.classList.add('road');
        line.style.stroke = playerColors[e.road] || '#fff';
      } else if (this.interactiveEdges.has(e.id)) {
        line.classList.add('interactive');
        line.addEventListener('click', () => this.onEdgeClick && this.onEdgeClick(e.id));
      } else {
        line.style.stroke = 'rgba(255,255,255,0.07)';
      }

      edgeLyr.appendChild(line);
    }

    // ── Vertices (settlements / cities) ──
    for (const v of vertices) {
      const vx = this.px(v.x), vy = this.py(v.y);

      if (v.building === 'settlement') {
        const s = this._drawSettlement(vx, vy, playerColors[v.player]);
        vertexLyr.appendChild(s);
      } else if (v.building === 'city') {
        const c = this._drawCity(vx, vy, playerColors[v.player]);
        vertexLyr.appendChild(c);
      } else {
        // Interactive dot or invisible
        const dot = this._el('circle', { cx: vx, cy: vy, r: 6 }, 'vertex-dot');
        if (this.interactiveVertices.has(v.id)) {
          dot.classList.add('interactive');
          dot.addEventListener('click', () => this.onVertexClick && this.onVertexClick(v.id));
        } else {
          dot.style.opacity = '0';
          dot.style.pointerEvents = 'none';
        }
        vertexLyr.appendChild(dot);
      }
    }

    // ── Robber ──
    if (state.robberTile !== undefined) {
      const t = tiles[state.robberTile];
      const rx = this.px(t.cx), ry = this.py(t.cy);
      const robber = this._drawRobber(rx, ry);
      robberLyr.appendChild(robber);
    }
  }

  _drawSettlement(cx, cy, color) {
    const g = this._el('g');
    // House shape: square base + triangle roof
    const s = 10;
    g.appendChild(this._el('rect', {
      x: cx - s, y: cy - s/2, width: s*2, height: s*1.2,
      fill: color, stroke: '#fff', 'stroke-width': 1.5,
      rx: 1
    }));
    const pts = `${cx-s},${cy-s/2} ${cx},${cy-s*1.6} ${cx+s},${cy-s/2}`;
    g.appendChild(this._el('polygon', {
      points: pts, fill: color, stroke: '#fff', 'stroke-width': 1.5
    }));
    return g;
  }

  _drawCity(cx, cy, color) {
    const g = this._el('g');
    // Two-section city
    const w1 = 8, w2 = 12, h1 = 10, h2 = 16;
    g.appendChild(this._el('rect', {
      x: cx - w2, y: cy - h2/2, width: w2*2, height: h2,
      fill: color, stroke: '#fff', 'stroke-width': 1.5, rx: 1
    }));
    g.appendChild(this._el('rect', {
      x: cx + w2 - w1*2, y: cy - h1/2 - h2/2, width: w1*2, height: h1,
      fill: color, stroke: '#fff', 'stroke-width': 1, rx: 1
    }));
    // Battlements
    for (let i = 0; i < 3; i++) {
      g.appendChild(this._el('rect', {
        x: cx - w2 + i*8, y: cy - h2/2 - 4, width: 5, height: 5,
        fill: color, stroke: '#fff', 'stroke-width': 1
      }));
    }
    return g;
  }

  _drawRobber(cx, cy) {
    const g = this._el('g');
    // Skull-ish shape
    g.appendChild(this._el('circle', {
      cx, cy: cy - 6, r: 10, fill: '#1a1a1a', stroke: '#fff', 'stroke-width': 1.5
    }));
    g.appendChild(this._el('rect', {
      x: cx - 7, y: cy + 1, width: 14, height: 8,
      fill: '#1a1a1a', stroke: '#fff', 'stroke-width': 1.5, rx: 2
    }));
    // Eyes
    g.appendChild(this._el('circle', { cx: cx-3.5, cy: cy-7, r: 2.5, fill: '#fff' }));
    g.appendChild(this._el('circle', { cx: cx+3.5, cy: cy-7, r: 2.5, fill: '#fff' }));
    return g;
  }
}

window.CatanBoard = CatanBoard;
