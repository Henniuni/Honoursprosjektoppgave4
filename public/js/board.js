'use strict';
// SVG board renderer for Catan

const SCALE = 72;
const SVG_W = 660;
const SVG_H = 700;
const CX = SVG_W / 2;
const CY = SVG_H / 2 + 10;

const RESOURCE_GRAD = {
  wood:   ['#72b84a', '#2d5c18'],
  brick:  ['#d4622a', '#7a2808'],
  sheep:  ['#96de5e', '#4a8820'],
  wheat:  ['#f5cc40', '#907010'],
  ore:    ['#8898ac', '#424f5c'],
  desert: ['#e8d470', '#9a8438']
};

const RESOURCE_LABELS = {
  wood: 'Forest', brick: 'Hills', sheep: 'Pasture',
  wheat: 'Fields', ore: 'Mountains', desert: 'Desert'
};

const RESOURCE_ICONS = {
  wood: '🌲', brick: '🧱', sheep: '🐑',
  wheat: '🌾', ore: '⛰', desert: '🏜'
};

const PORT_COLORS = {
  '3:1': '#d4b84a', wood: '#4a7c2f', brick: '#b5451b',
  sheep: '#7cbb4a', wheat: '#d4a017', ore: '#607080'
};

const PORT_ICONS = {
  wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰'
};

const DOT_COUNTS = { 2:1, 3:2, 4:2, 5:3, 6:4, 8:4, 9:3, 10:2, 11:2, 12:1 };

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

  _buildDefs() {
    const defs = this._el('defs');

    // Radial gradient per resource
    for (const [res, [light, dark]] of Object.entries(RESOURCE_GRAD)) {
      const g = this._el('radialGradient', { id: `grad-${res}`, cx: '38%', cy: '32%', r: '68%' });
      const s1 = this._el('stop'); s1.setAttribute('offset', '0%');   s1.setAttribute('stop-color', light);
      const s2 = this._el('stop'); s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', dark);
      g.append(s1, s2);
      defs.appendChild(g);
    }

    // Ocean gradient — userSpaceOnUse so corners stay consistent
    const diag = Math.sqrt(SVG_W * SVG_W + SVG_H * SVG_H);
    const ocean = this._el('radialGradient', {
      id: 'grad-ocean', gradientUnits: 'userSpaceOnUse',
      cx: CX, cy: CY, r: diag * 0.52
    });
    const o1 = this._el('stop'); o1.setAttribute('offset', '0%');   o1.setAttribute('stop-color', '#2e8fbd');
    const o2 = this._el('stop'); o2.setAttribute('offset', '100%'); o2.setAttribute('stop-color', '#1460a0');
    ocean.append(o1, o2);
    defs.appendChild(ocean);

    // Clip path to keep waves inside SVG border
    const wc = this._el('clipPath', { id: 'wave-clip' });
    wc.appendChild(this._el('rect', { x: 8, y: 8, width: SVG_W - 16, height: SVG_H - 16 }));
    defs.appendChild(wc);

    // Drop shadow for number tokens
    const shadow = this._el('filter', { id: 'token-shadow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
    const fds = this._el('feDropShadow', { dx: '0', dy: '2', stdDeviation: '2.5', 'flood-color': '#000', 'flood-opacity': '0.45' });
    shadow.appendChild(fds);
    defs.appendChild(shadow);

    // Inset hex shadow (darkens edges of tiles slightly)
    const hexShad = this._el('filter', { id: 'hex-inner' });
    const fGauss = this._el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '4', result: 'blur' });
    const fComp  = this._el('feComposite',    { in: 'SourceGraphic', in2: 'blur', operator: 'over' });
    hexShad.append(fGauss, fComp);
    defs.appendChild(hexShad);

    return defs;
  }

  render(state, playerColors) {
    this._state = state;
    this.svg.innerHTML = '';

    const { tiles, vertices, edges, ports } = state.board;

    this.svg.appendChild(this._buildDefs());

    // Ocean background
    this.svg.appendChild(this._el('rect', {
      x: 0, y: 0, width: SVG_W, height: SVG_H, fill: 'url(#grad-ocean)'
    }));

    // Wave lines on water (decorative, clipped to SVG interior)
    const waveLyr = this._el('g', { opacity: '0.12', 'clip-path': 'url(#wave-clip)' });
    for (let wy = 30; wy < SVG_H; wy += 28) {
      const wave = this._el('path', { stroke: '#fff', 'stroke-width': '1.5', fill: 'none' });
      let d = `M 0 ${wy}`;
      for (let wx = 0; wx < SVG_W; wx += 40) {
        d += ` q 10,-6 20,0 q 10,6 20,0`;
      }
      wave.setAttribute('d', d);
      waveLyr.appendChild(wave);
    }
    this.svg.appendChild(waveLyr);

    // Layer groups
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
      hex.style.fill = `url(#grad-${t.type})`;
      if (t.hasRobber) hex.classList.add('robber-tile');

      if (this.interactiveTiles.has(ti)) {
        hex.style.cursor = 'pointer';
        hex.style.opacity = '0.8';
        hex.addEventListener('click', () => this.onTileClick && this.onTileClick(ti));
      }
      tileLyr.appendChild(hex);

      const lx = this.px(t.cx), ly = this.py(t.cy);

      if (t.type !== 'desert') {
        // Resource icon (emoji)
        const icon = this._el('text', { x: lx, y: ly - 26 }, 'hex-icon');
        icon.textContent = RESOURCE_ICONS[t.type] || '';
        tileLyr.appendChild(icon);

        // Resource label
        tileLyr.appendChild(this._el('text', { x: lx, y: ly - 10 }, 'hex-label'))
          .textContent = RESOURCE_LABELS[t.type];

        // Number token
        if (t.number) {
          const g = this._el('g', { filter: 'url(#token-shadow)' });
          const dots = DOT_COUNTS[t.number] || 0;
          const hot = t.number === 6 || t.number === 8;

          g.appendChild(this._el('circle', { cx: lx, cy: ly + 12, r: 20 }, 'number-circle'));

          if (hot) {
            // Subtle red rim on 6/8
            g.appendChild(this._el('circle', {
              cx: lx, cy: ly + 12, r: 20, fill: 'none',
              stroke: '#e74c3c', 'stroke-width': '2.5'
            }));
          }

          const numTxt = this._el('text', { x: lx, y: ly + 13 }, 'hex-number');
          if (hot) numTxt.classList.add('hot');
          numTxt.textContent = t.number;
          g.appendChild(numTxt);

          // Probability dots
          const dotSpacing = 5.5;
          const startX = lx - ((dots - 1) * dotSpacing) / 2;
          for (let d = 0; d < dots; d++) {
            const dot = this._el('circle', {
              cx: startX + d * dotSpacing, cy: ly + 27, r: 2.2
            });
            dot.style.fill = hot ? '#e74c3c' : '#667';
            g.appendChild(dot);
          }
          tileLyr.appendChild(g);
        }
      } else {
        // Desert: icon + label only, centered
        const icon = this._el('text', { x: lx, y: ly - 6 }, 'hex-icon');
        icon.textContent = RESOURCE_ICONS.desert;
        tileLyr.appendChild(icon);
        tileLyr.appendChild(this._el('text', { x: lx, y: ly + 12 }, 'hex-label'))
          .textContent = 'Desert';
      }
    }

    // ── Ports ──
    for (const port of ports) {
      const [v1id, v2id] = port.vertices;
      const v1 = vertices[v1id], v2 = vertices[v2id];
      const x1 = this.px(v1.x), y1 = this.py(v1.y);
      const x2 = this.px(v2.x), y2 = this.py(v2.y);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const col = PORT_COLORS[port.type] || '#ccc';

      // Dock line + pier end dots
      const pline = this._el('line', { x1, y1, x2, y2 }, 'port-line');
      pline.style.stroke = col;
      portLyr.appendChild(pline);
      for (const [px, py] of [[x1,y1],[x2,y2]]) {
        portLyr.appendChild(this._el('circle', { cx: px, cy: py, r: 4, fill: col }));
      }

      // Badge background
      portLyr.appendChild(this._el('circle', {
        cx: mx, cy: my, r: 18,
        fill: '#0e2a40', stroke: col, 'stroke-width': '2.5'
      }));

      if (port.type !== '3:1') {
        // Resource emoji — large, centered above ratio
        const icon = this._el('text', { x: mx, y: my - 3 });
        icon.style.cssText = 'font-size:15px;text-anchor:middle;dominant-baseline:middle;pointer-events:none';
        icon.textContent = PORT_ICONS[port.type];
        portLyr.appendChild(icon);

        // "2:1" ratio below
        const ratio = this._el('text', { x: mx, y: my + 12 }, 'port-label');
        ratio.textContent = '2:1';
        ratio.style.fontSize = '9px';
        ratio.style.fontWeight = '800';
        ratio.style.fill = '#eee';
        portLyr.appendChild(ratio);
      } else {
        // 3:1 — big ratio text + "any"
        const ratio = this._el('text', { x: mx, y: my - 1 }, 'port-label');
        ratio.textContent = '3:1';
        ratio.style.fontSize = '11px';
        ratio.style.fontWeight = '800';
        ratio.style.fill = '#f5d060';
        portLyr.appendChild(ratio);

        const any = this._el('text', { x: mx, y: my + 11 }, 'port-label');
        any.textContent = 'any';
        any.style.fontSize = '8px';
        any.style.fill = '#d4b84a';
        portLyr.appendChild(any);
      }
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
        line.style.stroke = 'rgba(0,0,0,0.18)';
      }

      edgeLyr.appendChild(line);
    }

    // ── Vertices (settlements / cities) ──
    for (const v of vertices) {
      const vx = this.px(v.x), vy = this.py(v.y);
      const interactive = this.interactiveVertices.has(v.id);

      if (v.building === 'settlement') {
        // Pulse glow when this settlement can be upgraded
        if (interactive) {
          vertexLyr.appendChild(this._el('circle', { cx: vx, cy: vy, r: 22 }, 'upgrade-glow'));
        }
        const s = this._drawSettlement(vx, vy, playerColors[v.player]);
        vertexLyr.appendChild(s);
        if (interactive) {
          // Large transparent hit-circle on top for easy clicking
          const hit = this._el('circle', { cx: vx, cy: vy, r: 22, fill: 'transparent' });
          hit.style.cursor = 'pointer';
          hit.addEventListener('click', () => this.onVertexClick && this.onVertexClick(v.id));
          vertexLyr.appendChild(hit);
        }
      } else if (v.building === 'city') {
        vertexLyr.appendChild(this._drawCity(vx, vy, playerColors[v.player]));
      } else {
        const dot = this._el('circle', { cx: vx, cy: vy, r: interactive ? 9 : 6 }, 'vertex-dot');
        if (interactive) {
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
      robberLyr.appendChild(this._drawRobber(this.px(t.cx), this.py(t.cy)));
    }
  }

  _drawSettlement(cx, cy, color) {
    const g = this._el('g');
    const s = 10;
    // Drop shadow
    g.appendChild(this._el('rect', {
      x: cx - s + 1, y: cy - s/2 + 2, width: s*2, height: s*1.2,
      fill: 'rgba(0,0,0,0.3)', rx: 2
    }));
    g.appendChild(this._el('rect', {
      x: cx - s, y: cy - s/2, width: s*2, height: s*1.2,
      fill: color, stroke: '#fff', 'stroke-width': 1.5, rx: 1
    }));
    const pts = `${cx-s},${cy-s/2} ${cx},${cy-s*1.6} ${cx+s},${cy-s/2}`;
    g.appendChild(this._el('polygon', {
      points: pts, fill: color, stroke: '#fff', 'stroke-width': 1.5
    }));
    // Roof highlight
    g.appendChild(this._el('polygon', {
      points: `${cx-s+1},${cy-s/2-1} ${cx},${cy-s*1.6+2} ${cx+s-1},${cy-s/2-1}`,
      fill: 'rgba(255,255,255,0.15)'
    }));
    return g;
  }

  _drawCity(cx, cy, color) {
    const g = this._el('g');
    const w1 = 8, w2 = 12, h1 = 10, h2 = 16;
    // Shadow
    g.appendChild(this._el('rect', {
      x: cx - w2 + 1, y: cy - h2/2 + 2, width: w2*2, height: h2,
      fill: 'rgba(0,0,0,0.3)', rx: 2
    }));
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
    g.appendChild(this._el('circle', {
      cx, cy: cy - 6, r: 11, fill: '#1a1a1a', stroke: '#eee', 'stroke-width': 1.5
    }));
    g.appendChild(this._el('rect', {
      x: cx - 7, y: cy + 2, width: 14, height: 8,
      fill: '#1a1a1a', stroke: '#eee', 'stroke-width': 1.5, rx: 2
    }));
    g.appendChild(this._el('circle', { cx: cx-3.5, cy: cy-7, r: 2.5, fill: '#eee' }));
    g.appendChild(this._el('circle', { cx: cx+3.5, cy: cy-7, r: 2.5, fill: '#eee' }));
    return g;
  }
}

window.CatanBoard = CatanBoard;
