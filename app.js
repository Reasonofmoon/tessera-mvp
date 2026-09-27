/* ============================================================
   TESSERA MVP — app.js
   조각이 모여, 설계가 완성된다
   - 노드 그래프 캔버스 (6 Tiles)
   - 결정론적 목업 파이프라인 (GROUND → FLOOR → MASS → LENS/CUT → FOLIO)
   - VERSION DAG + LEDGER
   ============================================================ */
'use strict';

/* ---------------- utilities ---------------- */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const fmt = (n) => Number(n).toLocaleString('ko-KR');
const now = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const uid = (() => { let i = 1; return (p) => `${p}${String(i++).padStart(2,'0')}#` + Math.random().toString(36).slice(2,5); })();

/* seeded rng: same address → same briefing (결정론적 목업) */
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toast(msg, isErr = false) {
  let t = $('#toast');
  if (!t) { t = el('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.background = isErr ? 'var(--terra-deep)' : 'var(--ink)';
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}
function status(msg) { $('#status-msg').textContent = msg; }

/* ---------------- settings (Phase 2) ---------------- */

const SET_KEY = 'tessera-settings-v1';
let Settings = { vworldKey: '', geminiKey: '', name: '', color: '', siteId: '' };
try {
  const rawS = localStorage.getItem(SET_KEY);
  if (rawS) Settings = Object.assign(Settings, JSON.parse(rawS));
} catch (e) {}
function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify(Settings)); } catch (e) {}
}

/* ---------------- tile registry ---------------- */

const ZONES = [
  { zone: '제3종 일반주거지역', coverage: 0.50, floor: 2.0 },
  { zone: '제2종 일반주거지역', coverage: 0.60, floor: 2.5 },
  { zone: '준주거지역',         coverage: 0.70, floor: 3.0 },
  { zone: '일반상업지역',       coverage: 0.80, floor: 6.0 },
  { zone: '근린상업지역',       coverage: 0.70, floor: 3.0 },
];
const LAW_CITES = [
  '국토계획법 §76', '건축법 §55', '건축법 시행령 §78',
  '서울시 도시계획조례 §23', '주차장법 §19', '건축법 §56-2(일조)',
];

const TILES = {
  GROUND: {
    name: 'GROUND', label: '대지 · 법규 브리핑', glyph: '▦', color: 'g-ground',
    credits: 5, accent: '#5F7A5A',
    defaultParams: () => ({ address: '서울특별시 중구 세종대로 110' }),
    /* Phase 2: VWorld 실연동(키 있을 때) → 실패 시 결정론적 목업 폴백 */
    async run(params) {
      let live = null, liveErr = null;
      if (Settings.vworldKey) {
        try { live = await VW.briefing(params.address, Settings.vworldKey); }
        catch (e) { liveErr = e; }
      }
      const limits = Law.limitsFor(live ? live.zone : '');
      let out;
      if (live) {
        out = Object.assign({ source: 'live' }, live, {
          coverageLimit: limits.coverage,
          floorLimit: limits.floor,
          maxFootprint: Math.round(live.siteArea * limits.coverage),
          maxGFA: Math.round(live.siteArea * limits.floor),
          parkingPer: 70,
          summary: `${live.zone} · ${fmt(live.siteArea)}m² (VWorld LIVE)`,
        });
      } else {
        const rnd = mulberry32(strHash(params.address || 'x'));
        const z = ZONES[Math.floor(rnd() * ZONES.length)];
        const area = Math.round((300 + rnd() * 900) / 10) * 10;
        const road = 4 + Math.floor(rnd() * 3) * 2;
        const cites = [...LAW_CITES].sort(() => rnd() - .5).slice(0, 3);
        out = {
          source: 'mock', zone: z.zone, siteArea: area,
          coverageLimit: z.coverage, floorLimit: z.floor,
          maxFootprint: Math.round(area * z.coverage),
          maxGFA: Math.round(area * z.floor),
          roadWidth: road, parkingPer: 65 + Math.floor(rnd() * 4) * 5,
          cites, parcel: null, apiTime: new Date().toISOString(),
          fallbackReason: liveErr ? String(liveErr.message || liveErr) : 'no-key',
          summary: `${z.zone} · ${fmt(area)}m²`,
        };
      }
      /* 법규 RAG: 상황에 맞는 조문 검색 */
      const q = `${out.zone} 건폐율 용적률 최대한도 대지면적 조례`;
      out.laws = Law.retrieve(q, 3);
      if (!out.cites) {
        out.cites = out.laws.map(l => `${l.law.replace(/의 계획 및 이용에 관한 법률/, '계획법')} ${l.article.replace(/제/, '').replace(/조제/, '§')}`);
      }
      return out;
    },
    body(out) {
      if (!out) return `<div class="empty">주소를 입력하고 브리핑을 생성하세요.</div>`;
      const badge = out.source === 'live'
        ? `<span class="src-badge live">VWORLD LIVE</span>`
        : `<span class="src-badge mock">MOCK${out.fallbackReason && out.fallbackReason !== 'no-key' ? ' · API 실패' : ''}</span>`;
      const road = out.roadWidth ? ` · 도로 ${out.roadWidth}m` : (out.parcel ? ` · PNU …${out.parcel.pnu.slice(-6)}` : '');
      return `<div style="margin-bottom:4px">${badge}</div>
           <div class="out-label">▸ ${out.zone}</div>
           <div class="out-label">대지 ${fmt(out.siteArea)}m²${road}</div>
           <div class="out-label">한도 건폐 ${Math.round(out.coverageLimit * 100)}% / 용적 ${out.floorLimit.toFixed(1)}</div>`;
    },
  },

  FLOOR: {
    name: 'FLOOR', label: '파라메트릭 평면', glyph: '▥', color: 'g-floor',
    credits: 3, accent: '#4A443C', needs: ['GROUND'],
    defaultParams: () => ({ floors: 5, floorHeight: 3.4, footprintRatio: 0.82, use: '혼합 (저층 상가 + 상부 업무)' }),
    run(params, site) {
      if (!site) return null;
      const footprint = Math.round(site.maxFootprint * params.footprintRatio);
      const gfa = footprint * params.floors;
      const coverage = footprint / site.siteArea;
      const far = gfa / site.siteArea;
      return {
        type: 'floorData',
        footprint, gfa,
        coverage, far,
        coverageOk: coverage <= site.coverageLimit + 1e-9,
        farOk: far <= site.floorLimit + 1e-9,
        heightM: params.floors * params.floorHeight,
        summary: `${params.floors}F · 연면적 ${fmt(gfa)}m²`,
      };
    },
    body(out) {
      if (!out) return `<div class="empty">GROUND 연결 후 계획을 확정하세요.</div>`;
      return `<div class="out-label">▸ ${fmt(out.footprint)}m² × 층</div>
        <div class="out-label">연면적 ${fmt(out.gfa)}m² · 용적률 ${out.far.toFixed(2)}</div>
        <div class="out-label" style="color:${(out.coverageOk && out.farOk) ? 'var(--sage)' : 'var(--terra-deep)'};font-weight:700">
          ${out.coverageOk && out.farOk ? '법규 적합' : '한도 초과 검토'}</div>`;
    },
  },

  MASS: {
    name: 'MASS', label: '3D 매스 스터디', glyph: '◨', color: 'g-mass',
    credits: 4, accent: '#B98A2F', needs: ['FLOOR'],
    defaultParams: () => ({ stepback: true, setback: 2 }),
    run(params, ups) {
      const floor = ups.FLOOR;
      if (!floor) return null;
      const f = floor.out;
      return {
        type: 'massData',
        floors: f?._floors || floor.params.floors || 5,
        summary: `${f ? f.summary : floor.params.floors + 'F'} 매스화`,
      };
    },
    body(out) {
      return out
        ? `<div class="out-label">▸ 매스 생성 완료</div><div class="out-label">${out.summary}</div>`
        : `<div class="empty">FLOOR 연결 후 매스를 생성하세요.</div>`;
    },
  },

  LENS: {
    name: 'LENS', label: '카메라 렌더', glyph: '◎', color: 'g-lens',
    credits: 8, accent: '#C8552C', needs: ['MASS', 'FLOOR'],
    defaultParams: () => ({ azimuth: 135, camHeight: 12, lens: 35, hour: 15 }),
    run(params, upstream) {
      const m = upstream.MASS || upstream.FLOOR;
      if (!m) return null;
      return { type: 'renderData', ...params, summary: `AZ${params.azimuth}° · ${params.lens}mm · ${String(params.hour).padStart(2,'0')}:00` };
    },
    body(out) {
      return out
        ? `<div class="out-label">▸ 렌더 완료</div><div class="out-label">${out.summary}</div>`
        : `<div class="empty">MASS 연결 후 카메라를 설정하세요.</div>`;
    },
  },

  CUT: {
    name: 'CUT', label: '입면 · 단면 생성', glyph: '☰', color: 'g-cut',
    credits: 6, accent: '#3E5C76', needs: ['MASS', 'FLOOR'],
    defaultParams: () => ({ kind: '입면도', scale: '1:200' }),
    run(params, upstream) {
      const m = upstream.MASS || upstream.FLOOR;
      if (!m) return null;
      return { type: 'cutData', kind: params.kind, scale: params.scale, summary: `${params.kind} ${params.scale}` };
    },
    body(out) {
      return out
        ? `<div class="out-label">▸ ${out.kind} 생성</div><div class="out-label">${out.scale} · 도면 그리드</div>`
        : `<div class="empty">MASS 연결 후 절단 유형을 선택하세요.</div>`;
    },
  },

  FOLIO: {
    name: 'FOLIO', label: '보드 · 리포트 조판', glyph: '▣', color: 'g-folio',
    credits: 5, accent: '#7A5C5A', needs: ['GROUND', 'FLOOR', 'LENS', 'CUT'],
    defaultParams: () => ({ boardTitle: 'Design Brief', boardStyle: 'Tessera Ivory' }),
    run(params, upstream) {
      const parts = Object.keys(upstream).filter(k => upstream[k]);
      if (!parts.length) return null;
      return { type: 'folioData', parts, title: params.boardTitle, style: params.boardStyle, summary: `${parts.length}개 조각 조판` };
    },
    body(out) {
      return out
        ? `<div class="out-label">▸ 보드 완성</div><div class="out-label">${out.parts.join(' + ')}</div>`
        : `<div class="empty">조판할 결과물을 연결하세요 (2개 이상 권장).</div>`;
    },
  },
};

/* ---------------- state ---------------- */

const LS_KEY = 'tessera-mvp-v2'; // v2: 민감 이력 없는 깨끗한 상태로 재시작
let S = null;

function freshState() {
  return {
    projectName: '새 설계 스터디',
    credits: 300,
    nodes: [],      // {id, tile, x, y, params, out, rev}
    edges: [],      // {id, from, to}
    versions: [],   // {hash, parent, tile, msg, params, nodeId, ts, _l}
    ledger: [],     // {ts, tile, action, cost, balance} — 사이트 로컬
    comments: [],   // {id, nodeId, author, color, text, ts:{s,l}, tomb}
    tombs: { nodes: {}, edges: {} },
    view: { x: 0, y: 0, scale: 1 },
    seq: 0,
  };
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* quota */ }
}
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.nodes) {
        // v0.1 → v0.2 마이그레이션
        if (!s.comments) s.comments = [];
        if (!s.tombs) s.tombs = { nodes: {}, edges: {} };
        return s;
      }
    }
  } catch (e) {}
  return null;
}

/* seed demo: GROUND → FLOOR → MASS → LENS ready to explore
   (결정론적 ID — 새 피어 탭과 동일 시드로 수렴) */
function seedDemo() {
  const s = freshState();
  const mk = (tile, id, x, y) => {
    s.nodes.push({ id, tile, x, y, params: TILES[tile].defaultParams(), out: null, rev: 0 });
    return id;
  };
  const g = mk('GROUND', 'G01', 60, 80);
  const f = mk('FLOOR', 'F02', 330, 80);
  const m = mk('MASS', 'M03', 600, 80);
  const l = mk('LENS', 'L04', 600, 290);
  s.edges.push({ id: 'e01', from: g, to: f }, { id: 'e02', from: f, to: m }, { id: 'e03', from: m, to: l });
  return s;
}

/* ---------------- graph helpers ---------------- */

function nodeById(id) { return S.nodes.find(n => n.id === id); }
function edgesInto(id) { return S.edges.filter(e => e.to === id); }
function edgesFrom(id) { return S.edges.filter(e => e.from === id); }
function upstreamOf(node) {
  const ups = {};
  for (const e of edgesInto(node.id)) {
    const src = nodeById(e.from);
    if (src && src.out) ups[src.tile] = src;
  }
  return ups;
}
function isStale(node) {
  for (const e of edgesInto(node.id)) {
    const src = nodeById(e.from);
    if (src && src.out && src.rev > (node._inRev || 0)) return true;
  }
  return false;
}

/* ---------------- canvas render ---------------- */

const nodesLayer = $('#nodes-layer');
const edgesLayer = $('#edges-layer');
let selectedId = null;

function applyView() {
  const t = `translate(${S.view.x}px, ${S.view.y}px) scale(${S.view.scale})`;
  nodesLayer.style.transform = t;
  $('#edges-g')?.setAttribute('transform', `translate(${S.view.x},${S.view.y}) scale(${S.view.scale})`);
  $('#zoom-level').textContent = Math.round(S.view.scale * 100) + '%';
}

function renderAll() {
  renderNodes();
  renderEdges();
  renderDock();
  renderCreditChip();
  applyView();
  save();
}

function renderNodes() {
  $$('.node', nodesLayer).forEach(n => n.remove());
  const peerSel = {};
  for (const p of Collab.peerList()) if (p.sel) peerSel[p.sel] = p;
  for (const node of S.nodes) {
    const T = TILES[node.tile];
    const cmtCount = (S.comments || []).filter(c => c.nodeId === node.id && !c.tomb).length;
    const peer = peerSel[node.id];
    const card = el('div', 'node' + (node.id === selectedId ? ' selected' : '') + (isStale(node) ? ' stale' : '') + (peer ? ' remote-sel' : ''));
    card.dataset.id = node.id;
    if (peer) { card.dataset.peer = peer.name; card.style.setProperty('--rc', peer.color); }
    card.style.left = node.x + 'px';
    card.style.top = node.y + 'px';
    card.innerHTML = `
      <div class="node-head">
        <span class="tile-glyph ${T.color}">${T.glyph}</span>
        <span class="node-title">${T.name}</span>
        <span class="node-id">${node.id.split('#')[0]}</span>
      </div>
      <div class="node-body">${T.body(node.out)}</div>
      ${cmtCount ? `<span class="c-badge" title="댓글 ${cmtCount}">💬${cmtCount}</span>` : ''}
      <div class="port in" data-port="in" title="입력"></div>
      <div class="port out" data-port="out" title="출력"></div>`;
    nodesLayer.appendChild(card);
  }
  $('#canvas-hint').classList.toggle('hidden', S.nodes.length > 0);
}

function portPos(nodeId, kind) {
  const node = nodeById(nodeId);
  const w = 190;
  return kind === 'out' ? { x: node.x + w, y: node.y + 44 } : { x: node.x, y: node.y + 44 };
}

function renderEdges() {
  let g = $('#edges-g');
  if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.id = 'edges-g'; edgesLayer.appendChild(g); }
  g.innerHTML = '';
  for (const e of S.edges) {
    const a = portPos(e.from, 'out'), b = portPos(e.to, 'in');
    const d = `M ${a.x} ${a.y} C ${a.x + 46} ${a.y}, ${b.x - 46} ${b.y}, ${b.x} ${b.y}`;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', 'edge');
    p.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue('--ink-soft').trim() || '#4A443C');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('fill', 'none');
    p.setAttribute('marker-end', 'url(#arrow)');
    p.dataset.edge = e.id;
    g.appendChild(p);
  }
  // arrow marker
  if (!$('#arrow')) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#4A443C"></path></marker>`;
    edgesLayer.appendChild(defs);
  }
}

/* ---------------- inspector ---------------- */

function field(label, inputHtml) {
  return `<div class="field"><label>${label}</label>${inputHtml}</div>`;
}
function rangeRow(id, val, min, max, step, unit) {
  return `<div class="range-row">
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    <span class="range-val" id="${id}-val">${val}${unit}</span></div>`;
}
function kvRows(pairs) {
  return `<dl class="rc-body">${pairs.map(([k, v, cls]) =>
    `<div class="kv ${cls || ''}"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}
function resultCard(title, inner) {
  return `<div class="result-card"><div class="rc-head">${title}</div>${inner}</div>`;
}

function renderInspector() {
  const empty = $('#inspector-empty'), body = $('#inspector-body');
  const node = selectedId ? nodeById(selectedId) : null;
  if (!node) { empty.hidden = false; body.hidden = true; return; }
  empty.hidden = true; body.hidden = false;

  const T = TILES[node.tile];
  const ups = upstreamOf(node);
  body.innerHTML = '';

  const head = el('div', 'insp-head',
    `<span class="tile-glyph ${T.color}">${T.glyph}</span>
     <span class="insp-title">${T.name}</span>`);
  body.appendChild(head);

  const form = el('div', 'form');
  const P = node.params;
  let runLabel = '생성';

  if (node.tile === 'GROUND') {
    runLabel = '브리핑 생성';
    const apiState = Settings.vworldKey
      ? `<p class="set-help">VWORLD 키 설정됨 — 실제 공간정보로 조사합니다.</p>`
      : `<p class="set-help">VWORLD 키 없음 — 결정론적 목업으로 동작 (⚙ 설정에서 키 등록 가능)</p>`;
    form.innerHTML = field('대지 주소', `<input type="text" id="inp-address" value="${P.address}" placeholder="지번 또는 도로명 주소">`) + apiState;
    $('#inp-address')?.addEventListener('input', e => {
      P.address = e.target.value; save();
      Collab.nodeFields(node.id, { params: JSON.parse(JSON.stringify(P)) });
    });
  }

  if (node.tile === 'FLOOR') {
    runLabel = '계획 확정';
    const site = ups.GROUND?.out;
    if (site) {
      form.innerHTML +=
        resultCard('SITE CONSTRAINTS (GROUND 주입)', kvRows([
          ['용도지역', site.zone],
          ['대지면적', `${fmt(site.siteArea)} m²`],
          ['법정 건폐율', Math.round(site.coverageLimit * 100) + '%'],
          ['법정 용적률', site.floorLimit.toFixed(1)],
          ['최대 건축면적', `${fmt(site.maxFootprint)} m²`],
        ]));
    } else {
      form.innerHTML += `<div class="dock-hint">GROUND 타일을 연결하면 한도가 자동 주입됩니다.</div>`;
    }
    form.innerHTML +=
      field('층수', rangeRow('inp-floors', P.floors, 1, 15, 1, 'F')) +
      field('층고', rangeRow('inp-fh', P.floorHeight, 2.8, 6, 0.1, 'm')) +
      field('건축면적 활용률 (한도 대비)', rangeRow('inp-ratio', Math.round(P.footprintRatio * 100), 40, 100, 1, '%')) +
      field('용도', `<input type="text" id="inp-use" value="${P.use}">`);
    bindRange('inp-floors', 'F');
    bindRange('inp-fh', 'm');
    bindRange('inp-ratio', '%');
    $('#inp-use')?.addEventListener('input', e => {
      P.use = e.target.value; save();
      Collab.nodeFields(node.id, { params: JSON.parse(JSON.stringify(P)) });
    });
    // live compliance preview
    if (site) renderLiveCompliance(form, P, site);
  }

  if (node.tile === 'MASS') {
    runLabel = '매스 생성';
    form.innerHTML +=
      `<div class="field"><label>STEPBACK</label>
        <label style="display:flex;gap:8px;align-items:center;font-family:var(--sans);font-size:12px;color:var(--ink)">
        <input type="checkbox" id="inp-stepback" ${P.stepback ? 'checked' : ''}> 상부층 후退 처리</label></div>` +
      field('후退 깊이', rangeRow('inp-setback', P.setback, 0, 6, 0.5, 'm'));
    bindRange('inp-setback', 'm');
    $('#inp-stepback')?.addEventListener('change', e => {
      P.stepback = e.target.checked; save();
      Collab.nodeFields(node.id, { params: JSON.parse(JSON.stringify(P)) });
    });
  }

  if (node.tile === 'LENS') {
    runLabel = '렌더';
    form.innerHTML +=
      field('방위각 Azimuth', rangeRow('inp-az', P.azimuth, 0, 350, 10, '°')) +
      field('카메라 높이', rangeRow('inp-ch', P.camHeight, 2, 40, 1, 'm')) +
      field('렌즈', `<select id="inp-lens">
        ${[16, 24, 35, 50, 85].map(f => `<option value="${f}" ${f === P.lens ? 'selected' : ''}>${f}mm ${f <= 24 ? 'Wide' : f <= 50 ? 'Normal' : 'Tele'}</option>`).join('')}
      </select>`) +
      field('시각', rangeRow('inp-hour', P.hour, 6, 20, 1, '시'));
    bindRange('inp-az', '°');
    bindRange('inp-ch', 'm');
    bindRange('inp-hour', '시');
    $('#inp-lens')?.addEventListener('change', e => {
      P.lens = +e.target.value; save();
      Collab.nodeFields(node.id, { params: JSON.parse(JSON.stringify(P)) });
    });
  }

  if (node.tile === 'CUT') {
    runLabel = '도면 생성';
    form.innerHTML +=
      field('절단 유형', `<select id="inp-kind">
        ${['입면도', '단면도', '평단면도'].map(k => `<option ${k === P.kind ? 'selected' : ''}>${k}</option>`).join('')}
      </select>`) +
      field('축척', `<select id="inp-scale">
        ${['1:100', '1:200', '1:300', '1:500'].map(k => `<option ${k === P.scale ? 'selected' : ''}>${k}</option>`).join('')}
      </select>`);
    $('#inp-kind')?.addEventListener('change', e => {
      P.kind = e.target.value; save();
      Collab.nodeFields(node.id, { params: JSON.parse(JSON.stringify(P)) });
    });
    $('#inp-scale')?.addEventListener('change', e => {
      P.scale = e.target.value; save();
      Collab.nodeFields(node.id, { params: JSON.parse(JSON.stringify(P)) });
    });
  }

  if (node.tile === 'FOLIO') {
    runLabel = '조판';
    form.innerHTML +=
      field('보드 제목', `<input type="text" id="inp-title" value="${P.boardTitle}">`) +
      field('스타일', `<select id="inp-style">
        ${['Tessera Ivory', 'Ink Monochrome', 'Terracotta Accent'].map(k => `<option ${k === P.boardStyle ? 'selected' : ''}>${k}</option>`).join('')}
      </select>`);
    $('#inp-title')?.addEventListener('input', e => {
      P.boardTitle = e.target.value; save();
      Collab.nodeFields(node.id, { params: JSON.parse(JSON.stringify(P)) });
    });
    $('#inp-style')?.addEventListener('change', e => {
      P.boardStyle = e.target.value; save();
      Collab.nodeFields(node.id, { params: JSON.parse(JSON.stringify(P)) });
    });
  }

  body.appendChild(form);

  // run button with credit estimate
  const runRow = el('div', 'run-row');
  const btn = el('button', 'btn primary', `${runLabel} · ${T.credits}c`);
  btn.disabled = !canRun(node, ups);
  btn.addEventListener('click', () => runNode(node.id));
  runRow.appendChild(btn);
  body.appendChild(runRow);
  body.appendChild(el('div', 'run-estimate', `예상 ${T.credits} 크레딧 · 보유 ${S.credits}c`));

  // result visual
  if (node.out) body.appendChild(resultVisual(node, ups));

  // comments (CRDT 동기화)
  body.appendChild(commentsSectionHTML(node));
}

function commentsSectionHTML(node) {
  const wrap = el('div', 'comments-sec');
  const list = (S.comments || []).filter(c => c.nodeId === node.id && !c.tomb)
    .sort((a, b) => ((a.ts && a.ts.l) || 0) - ((b.ts && b.ts.l) || 0));
  wrap.innerHTML = `<h4>COMMENTS · ${list.length}</h4>` +
    list.map(c => `
      <div class="comment-item" data-cid="${c.id}">
        <i class="c-dot" style="background:${c.color || '#8A8272'}"></i>
        <div><div class="c-meta">${esc(c.author || '익명')} · ${c.tsStr || ''}</div><div>${esc(c.text)}</div></div>
        <button class="c-del" title="삭제">✕</button>
      </div>`).join('') +
    `<div class="comment-form">
      <input type="text" id="cmt-input" placeholder="이 타일에 댓글 달기…" maxlength="200">
      <button class="btn primary" id="cmt-add">등록</button>
    </div>`;
  $('#cmt-add', wrap)?.addEventListener('click', () => {
    const inp = $('#cmt-input', wrap);
    const text = inp.value.trim();
    if (!text) return;
    const me = Collab.mySite();
    const c = { id: 'c' + Math.random().toString(36).slice(2, 9), nodeId: node.id, author: me.name, color: me.color, text, tsStr: now() };
    S.comments.push(c);
    Collab.commentAdd(c);
    inp.value = '';
    renderNodes(); renderInspector(); save();
    toast('댓글 등록 — 피어 탭에 동기화됩니다');
  });
  $('#cmt-input', wrap)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cmt-add', wrap).click(); });
  $$('.c-del', wrap).forEach(b => b.addEventListener('click', () => {
    const cid = b.closest('.comment-item').dataset.cid;
    Collab.commentRemove(cid);
    S.comments = S.comments.map(c => c.id === cid ? { ...c, tomb: true } : c);
    renderNodes(); renderInspector(); save();
  }));
  return wrap;
}

function esc(s) { return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function bindRange(id, unit) {
  const r = $('#' + id);
  if (!r) return;
  r.addEventListener('input', e => {
    $('#' + id + '-val').textContent = e.target.value + unit;
    const node = nodeById(selectedId);
    if (!node) return;
    const map = {
      'inp-floors': 'floors', 'inp-fh': 'floorHeight', 'inp-ratio': 'footprintRatio',
      'inp-setback': 'setback', 'inp-az': 'azimuth', 'inp-ch': 'camHeight', 'inp-hour': 'hour',
    };
    const key = map[id];
    if (key) {
      node.params[key] = id === 'inp-ratio' ? +e.target.value / 100 : +e.target.value;
      if (id === 'inp-ratio' || id === 'inp-floors' || id === 'inp-fh') {
        const site = upstreamOf(node).GROUND?.out;
        if (site) renderLiveCompliance($('#inspector-body'), node.params, site);
      }
      save();
      Collab.nodeFields(node.id, { params: JSON.parse(JSON.stringify(node.params)) });
    }
  });
}

function renderLiveCompliance(container, P, site) {
  let live = $('#live-compliance');
  if (!live) {
    live = el('div'); live.id = 'live-compliance';
    container.appendChild(live);
  }
  const footprint = Math.round(site.maxFootprint * P.footprintRatio);
  const gfa = footprint * P.floors;
  const cov = footprint / site.siteArea, far = gfa / site.siteArea;
  const covOk = cov <= site.coverageLimit + 1e-9, farOk = far <= site.floorLimit + 1e-9;
  live.innerHTML = resultCard('LIVE COMPLIANCE (확정 전 미리보기)', kvRows([
    ['건축면적', `${fmt(footprint)} m²`, covOk ? 'ok' : 'bad'],
    ['연면적', `${fmt(gfa)} m²`],
    ['건폐율', `${(cov * 100).toFixed(1)}% / ${(site.coverageLimit * 100).toFixed(0)}%`, covOk ? 'ok' : 'bad'],
    ['용적률', `${far.toFixed(2)} / ${site.floorLimit.toFixed(1)}`, farOk ? 'ok' : 'bad'],
    ['건물높이', `${(P.floors * P.floorHeight).toFixed(1)} m`],
  ]));
}

function resultVisual(node, ups) {
  const wrap = el('div');
  const o = node.out;

  if (node.tile === 'GROUND') {
    const badge = o.source === 'live'
      ? `<span class="src-badge live">VWORLD LIVE · ${new Date(o.apiTime).toLocaleTimeString('ko-KR')}</span>`
      : `<span class="src-badge mock">MOCK${o.fallbackReason && o.fallbackReason !== 'no-key' ? ' — ' + esc(String(o.fallbackReason)) : ''}</span>`;
    wrap.innerHTML = resultCard('SITE BRIEFING ' + badge, kvRows([
        ['대지면적', `${fmt(o.siteArea)} m²${o.parcel ? ' (지적 도형 산출)' : ''}`],
        ['용도지역', esc(o.zone), o.source === 'live' ? 'ok' : ''],
        ['법정 건폐율', Math.round(o.coverageLimit * 100) + '%'],
        ['법정 용적률', o.floorLimit.toFixed(1)],
        ['최대 건축면적', `${fmt(o.maxFootprint)} m²`, 'ok'],
        ['최대 연면적', `${fmt(o.maxGFA)} m²`, 'ok'],
        ['접면 도로', o.roadWidth ? `${o.roadWidth} m` : '(지적 도형에 없음)'],
        ['주차기준', `${o.parkingPer} m²/대`],
      ])) +
      (o.parcel ? parcelMapHTML(o) : '');
    const lawEl = lawHitsHTML(o, node);
    if (lawEl) wrap.appendChild(lawEl);
  }

  if (node.tile === 'FLOOR') {
    wrap.innerHTML = resultCard('FLOOR RESULT', kvRows([
        ['건축면적', `${fmt(o.footprint)} m²`],
        ['연면적', `${fmt(o.gfa)} m²`],
        ['건폐율', `${(o.coverage * 100).toFixed(1)}%`, o.coverageOk ? 'ok' : 'bad'],
        ['용적률', `${o.far.toFixed(2)}`, o.farOk ? 'ok' : 'bad'],
        ['판정', o.coverageOk && o.farOk ? '법규 적합' : '한도 초과 — 계획 조정 필요', o.coverageOk && o.farOk ? 'ok' : 'bad'],
      ])) + miniMassHTML(node);
  }

  if (node.tile === 'MASS') {
    const f = ups.FLOOR;
    wrap.innerHTML = `<div class="result-card"><div class="rc-head">MASS PREVIEW</div>
      ${massSvgHTML(node, f)}<div class="render-caption"><span>${node.params.stepback ? `STEPBACK ${node.params.setback}m` : 'NO STEPBACK'}</span><span>${o.summary}</span></div></div>`;
  }

  if (node.tile === 'LENS') {
    wrap.innerHTML = `<div class="render-frame">${renderSvgHTML(node, ups)}
      <div class="render-caption"><span>${o.summary}</span><span>FOV ${Math.round(2 * Math.atan(18 / o.lens) * 180 / Math.PI)}°</span></div></div>`;
  }

  if (node.tile === 'CUT') {
    wrap.innerHTML = `<div class="render-frame">${cutSvgHTML(node, ups)}
      <div class="render-caption"><span>${o.kind} · ${o.scale}</span><span>DRAWING GRID 1m</span></div></div>`;
  }

  if (node.tile === 'FOLIO') {
    wrap.innerHTML = folioHTML(node, ups);
  }
  return wrap;
}

/* deterministic visuals */

/* Phase 2: 지적 미니맵 (VWorld 폴리곤) */
function parcelMapHTML(out) {
  const ring = (out.parcel && out.parcel.ring) || [];
  if (ring.length < 3) return '';
  const xs = ring.map(c => c[0]), ys = ring.map(c => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 240, H = 150, pad = 16;
  const sx = (W - pad * 2) / (maxX - minX || 1e-9);
  const sy = (H - pad * 2) / (maxY - minY || 1e-9);
  const sc = Math.min(sx, sy);
  const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
  // 위도 클수록 화면 위 → y 반전
  const pts = ring.map(c => `${(ox + (c[0] - minX) * sc).toFixed(1)},${(oy + (maxY - c[1]) * sc).toFixed(1)}`).join(' ');
  const cx = ox + (out.parcel.center.x - minX) * sc, cy = oy + (maxY - out.parcel.center.y) * sc;
  return `<div class="parcel-map">
    <svg viewBox="0 0 ${W} ${H}">
      <defs><pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#D8D0BE" stroke-width="1"/></pattern></defs>
      <rect width="${W}" height="${H}" fill="#FBF8F1"/>
      <rect width="${W}" height="${H}" fill="url(#hatch)" opacity=".5"/>
      <polygon points="${pts}" fill="rgba(200,85,44,.18)" stroke="#1A1815" stroke-width="1.6"/>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.4" fill="#C8552C"/>
      <text x="${Math.min(W - 60, cx + 6).toFixed(0)}" y="${Math.max(10, cy - 5).toFixed(0)}" font-size="8" font-family="monospace" fill="#4A443C">${esc(out.parcel.jibun || '')}</text>
    </svg>
    <div class="pm-cap"><span>PNU ${esc(out.parcel.pnu || '')}</span><span>연속지적도 LP_PA_CBND_BUBUN</span></div>
    <span class="north">N ↑</span>
  </div>`;
}

/* Phase 2: 법령 RAG 결과 + (선택) Gemini 요약 */
function lawHitsHTML(out, node) {
  const hits = out.laws || [];
  if (!hits.length) return '';
  const hasGemini = !!Settings.geminiKey;
  let html = `<div class="result-card"><div class="rc-head">법규 RAG · 관련 조문 TOP ${hits.length}</div><div style="padding:10px">` +
    hits.map(h => `<div class="law-hit">
      <div class="lh-head"><b>${esc(h.law)}</b><span>${esc(h.article)}</span>
        ${h.verbatim ? '<span class="lh-verbatim-tag">원문</span>' : '<span class="lh-verbatim-tag" style="color:var(--ink-faint);border-color:var(--line)">요약</span>'}
        <span class="lh-score">${h.score.toFixed(2)}</span></div>
      <div class="lh-text${h.verbatim ? ' verbatim' : ''}">${esc(h.text)}</div>
    </div>`).join('') +
    `<div class="run-row" style="margin-top:10px">
      <button class="btn ${hasGemini ? 'primary' : ''}" id="law-ai" ${hasGemini ? '' : 'disabled title="⚙ 설정에서 Gemini API 키를 등록하세요"'}>${hasGemini ? 'AI 요약 생성 (Gemini)' : 'AI 요약 — Gemini 키 필요'}</button>
    </div>
    <div id="law-ai-out"></div>
    <p style="font-size:9.5px;color:var(--ink-faint);margin-top:6px">BM25 로컬 검색 · 세부 한도는 시행령·조례 확인 필요</p>
  </div></div>`;
  const wrap = el('div');
  wrap.innerHTML = html;
  $('#law-ai', wrap)?.addEventListener('click', async () => {
    const btn2 = $('#law-ai', wrap);
    btn2.classList.add('busy'); btn2.textContent = '요약 생성 중…';
    try {
      const q = `${out.zone} 지역 대지 ${fmt(out.siteArea)}m², 건폐율·용적률 한도와 최대 허용 규모는?`;
      const summary = await Law.synthesize(q, out.laws, Settings.geminiKey);
      $('#law-ai-out', wrap).innerHTML = `<div class="ai-summary">
        <div class="as-head"><span>AI SUMMARY · gemini-2.0-flash</span></div>
        <div class="as-body">${esc(summary).replace(/\n/g, '<br>')}</div>
        <p style="font-size:9px;color:var(--terra-deep);margin-top:6px">근거 조문만 사용 · 최종 판단은 전문가 검토 필수</p>
      </div>`;
      node._ai = summary;
    } catch (e) {
      toast('Gemini 오류: ' + e.message, true);
    } finally {
      btn2.classList.remove('busy'); btn2.textContent = 'AI 요약 생성 (Gemini)';
    }
  });
  return wrap;
}

function miniMassHTML(node) {
  const P = node.params;
  let blocks = '';
  for (let i = 1; i <= Math.min(P.floors, 8); i++) {
    blocks += `<div class="floor-block" style="height:${Math.min(P.floorHeight * 10, 42)}px"><span>${i}F</span></div>`;
  }
  return `<div class="mini-mass">${blocks}</div>`;
}

function massSvgHTML(node, fNode) {
  const f = fNode?.out;
  const floors = Math.min((f?._floors) || fNode?.params.floors || 5, 12);
  const fh = fNode?.params.floorHeight || 3.4;
  const step = node.params.stepback;
  const sb = node.params.setback;
  const W = 240, H = 150, base = H - 18;
  const fhPx = Math.max(Math.min(fh * 6, 16), 7);
  const bw = 120;
  let rects = '';
  for (let i = 0; i < floors; i++) {
    const inset = step ? Math.min(sb * i * 3, 34) : 0;
    const y = base - (i + 1) * fhPx;
    rects += `<rect x="${(W - bw) / 2 + inset / 2 + 18}" y="${y}" width="${bw - inset}" height="${fhPx}" fill="${i % 2 ? '#E2D7BC' : '#D8CBA8'}" stroke="#4A443C" stroke-width="1"/>
      <text x="${(W - bw) / 2 + inset / 2 + 22}" y="${y + fhPx - 3}" font-size="7" fill="#8A8272" font-family="monospace">${i + 1}F</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}">
    <line x1="8" y1="${base}" x2="${W - 8}" y2="${base}" stroke="#1A1815" stroke-width="2"/>
    <line x1="8" y1="${base + 6}" x2="${W - 8}" y2="${base + 6}" stroke="#8A8272" stroke-width="0.6" stroke-dasharray="4 3"/>
    ${rects}
    <text x="10" y="${H - 5}" font-size="8" fill="#8A8272" font-family="monospace">GROUND LV. ±0.00</text>
    <text x="${W - 70}" y="${H - 5}" font-size="8" fill="#8A8272" font-family="monospace">H= ${(floors * fh).toFixed(1)}m</text>
  </svg>`;
}

function renderSvgHTML(node, ups) {
  const o = node.out;
  const W = 240, H = 150;
  const rnd = mulberry32(strHash(node.id + o.azimuth + o.hour + o.lens));
  const hour = o.hour;
  // sky color by hour
  const skies = { 6: ['#E8B98A', '#D8E2E8'], 10: ['#CFE3EC', '#F3EEE0'], 12: ['#C9E0EB', '#F5F1E4'], 15: ['#D9C9A8', '#EFE3C8'], 18: ['#D89A6A', '#E8D0B0'], 20: ['#5A5470', '#8A7A80'] };
  const skyKey = hour <= 6 ? 6 : hour >= 20 ? 20 : [10, 12, 15, 18].reduce((a, b) => Math.abs(b - hour) < Math.abs(a - hour) ? b : a);
  const [c1, c2] = skies[skyKey];
  // sun/moon position from azimuth
  const sunX = 20 + (o.azimuth / 360) * 200;
  const sunY = 30 + Math.abs(Math.sin((o.hour - 6) / 14 * Math.PI)) * 40;
  const m = ups.MASS, f = ups.FLOOR;
  const fl = m?.out?.floors || f?.out?._floors || 6;
  const floors = Math.min(fl, 12);
  const fhPx = 10;
  const base = H - 20;
  const scale = o.lens / 85;  // wide lens → bigger
  const bw = Math.min(150 * scale + 40, 170);
  let b = '';
  for (let i = 0; i < floors; i++) {
    b += `<rect x="${(W - bw) / 2}" y="${base - (i + 1) * fhPx}" width="${bw}" height="${fhPx}" fill="#8A8272" opacity="${0.35 + i * 0.05}" stroke="#1A1815" stroke-width="0.8"/>`;
  }
  // windows
  let win = '';
  for (let i = 0; i < floors; i++) {
    for (let j = 0; j < 5; j++) {
      if (rnd() > 0.35) win += `<rect x="${(W - bw) / 2 + 8 + j * (bw - 16) / 5}" y="${base - (i + 1) * fhPx + 3}" width="${(bw - 16) / 5 - 4}" height="3" fill="#F5F1E8" opacity="${0.5 + rnd() * 0.5}"/>`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="sky-${node.id.replaceAll('#','')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#sky-${node.id.replaceAll('#','')})"/>
    <circle cx="${sunX}" cy="${sunY}" r="7" fill="${hour >= 7 && hour <= 18 ? '#E8B54A' : '#EDE7D9'}" opacity="0.9"/>
    ${b}${win}
    <rect x="0" y="${base}" width="${W}" height="${H - base}" fill="#3E5C76" opacity="0.25"/>
    <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#1A1815" stroke-width="1.4"/>
    <text x="8" y="${H - 6}" font-size="8" fill="#1A1815" font-family="monospace">TESSERA LENS · MOCK RENDER</text>
  </svg>`;
}

function cutSvgHTML(node, ups) {
  const o = node.out;
  const W = 240, H = 170;
  const f = ups.FLOOR?.out;
  const floors = Math.min(f?._floors || ups.MASS?.out?.floors || 5, 12);
  const fhPx = 14, base = H - 30, left = 30, right = W - 30;
  let floorsSvg = '';
  for (let i = 0; i < floors; i++) {
    const y = base - (i + 1) * fhPx;
    floorsSvg += `<rect x="${left}" y="${y}" width="${right - left}" height="${fhPx}" fill="#FBF8F1" stroke="#1A1815" stroke-width="1"/>
      <line x1="${left}" y1="${y + fhPx / 2}" x2="${right}" y2="${y + fhPx / 2}" stroke="#D8D0BE" stroke-width="0.5" stroke-dasharray="3 3"/>`;
  }
  // dimension line
  const dimY = base - floors * fhPx - 10;
  const isSection = o.kind !== '입면도';
  return `<svg viewBox="0 0 ${W} ${H}" style="background:#FBF8F1">
    ${floorsSvg}
    ${isSection ? `<rect x="${left + 30}" y="${base - floors * fhPx}" width="${(right - left) / 3}" height="${floors * fhPx}" fill="#C8552C" opacity="0.08"/>` : ''}
    <line x1="${left}" y1="${base}" x2="${right}" y2="${base}" stroke="#1A1815" stroke-width="1.8"/>
    <line x1="${left - 8}" y1="${base}" x2="${left - 8}" y2="${base - floors * fhPx}" stroke="#8A8272" stroke-width="0.7"/>
    <text x="${left - 6}" y="${dimY}" font-size="8" fill="#4A443C" font-family="monospace" text-anchor="end">${floors}F</text>
    <text x="${W / 2}" y="${H - 12}" font-size="9" fill="#1A1815" font-family="monospace" text-anchor="middle">${o.kind} · ${o.scale}</text>
    <text x="${W / 2}" y="${H - 4}" font-size="7" fill="#8A8272" font-family="monospace" text-anchor="middle">TESSERA CUT · DETERMINISTIC DRAFT</text>
  </svg>`;
}

function folioHTML(node, ups) {
  const g = ups.GROUND?.out, f = ups.FLOOR?.out, l = ups.LENS, c = ups.CUT;
  const o = node.out;
  const accent = o.style === 'Terracotta Accent' ? '#C8552C' : o.style === 'Ink Monochrome' ? '#1A1815' : '#B98A2F';
  return `<div class="board-preview">
    <div class="bp-head" style="border-color:${accent}">
      <h3>${o.title}</h3>
      <p>${S.projectName} · TESSERA FOLIO · ${now()}</p>
    </div>
    <div class="bp-grid">
      <div class="bp-cell"><h4>SITE</h4>${g ? `${g.zone}<br>대지 ${fmt(g.siteArea)}m² · 도로 ${g.roadWidth}m<br>${g.cites[0]}` : 'GROUND 미연결'}</div>
      <div class="bp-cell"><h4>PROGRAM</h4>${f ? `건축면적 ${fmt(f.footprint)}m²<br>연면적 ${fmt(f.gfa)}m²<br>건폐율 ${(f.coverage * 100).toFixed(1)}% · 용적률 ${f.far.toFixed(2)}` : 'FLOOR 미연결'}</div>
      <div class="bp-cell"><h4>VIEW</h4>${l ? `${l.out.summary}<br>카메라 ${l.out.camHeight}m · 시각 ${String(l.out.hour).padStart(2, '0')}:00` : 'LENS 미연결'}</div>
      <div class="bp-cell"><h4>DRAWING</h4>${c ? `${c.out.kind} · ${c.out.scale}<br>치수 정합 자동 검증` : 'CUT 미연결'}</div>
    </div>
    <div class="bp-foot"><span>EVERY PIECE FINDS ITS PLACE.</span><span>${o.parts.length} TILES ASSEMBLED</span></div>
  </div>`;
}

/* ---------------- run pipeline ---------------- */

function canRun(node, ups) {
  const T = TILES[node.tile];
  if (!T.needs) return true;
  return T.needs.some(t => ups[t]);
}

async function runNode(nodeId) {
  const node = nodeById(nodeId);
  if (!node) return;
  const T = TILES[node.tile];
  const ups = upstreamOf(node);

  if (!canRun(node, ups)) { toast(`${T.needs.join(' 또는 ')} 타일을 먼저 연결·실행하세요.`, true); return; }
  if (S.credits < T.credits) { toast('크레딧이 부족합니다. 새 프로젝트를 시작하세요.', true); return; }

  // 실행 중 UI 잠금(GROUND 라이브 조사는 수 초 소요)
  const runBtn = $('#inspector-body .btn.primary');
  if (runBtn) { runBtn.classList.add('busy'); runBtn.textContent = '실행 중…'; }
  status(`${T.name} 실행 중…`);

  let out;
  try {
    if (node.tile === 'FLOOR') {
      out = T.run(node.params, ups.GROUND?.out);
      if (out) { out.floorsRef = node.params.floors; out._floors = node.params.floors; }
    } else {
      out = await T.run(node.params, ups);
    }
  } finally {
    if (runBtn) { runBtn.classList.remove('busy'); runBtn.textContent = '재실행 · ' + T.credits + 'c'; }
  }

  // cost (성공 시에만)
  if (out) {
    S.credits -= T.credits;
    S.ledger.push({ ts: now(), tile: T.name, action: `${T.name} 실행`, cost: T.credits, balance: S.credits });
  }

  node.out = out;
  node.rev = (node.rev || 0) + 1;
  node._inRev = Math.max(0, ...edgesInto(node.id).map(e => nodeById(e.from)?.rev || 0));

  // version commit
  const parent = S.versions.length ? S.versions[S.versions.length - 1].hash : null;
  const hash = Math.random().toString(16).slice(2, 8);
  const msg = {
    GROUND: out ? `대지 브리핑 생성 — ${out.zone}${out.source === 'live' ? ' (LIVE)' : ''}` : '브리핑 실패',
    FLOOR: out ? `평면 확정 — ${out.summary}${out.coverageOk && out.farOk ? ' (법규 적합)' : ' (한도 초과)'}` : '평면 실행 실패',
    MASS: out ? `매스 생성 — ${out.summary}` : '매스 실패',
    LENS: out ? `렌더 생성 — ${out.summary}` : '렌더 실패',
    CUT: out ? `도면 생성 — ${out.kind} ${out.scale}` : '도면 실패',
    FOLIO: out ? `보드 조판 — ${(out.parts || []).join('+')}` : '조판 실패',
  }[node.tile];
  const ver = { hash, parent, tile: T.name, msg, params: JSON.parse(JSON.stringify(node.params)), nodeId: node.id, ts: now() };
  ver._l = Date.now();
  S.versions.push(ver);

  // CRDT 동기화: 결과 + 버전
  Collab.nodeFields(node.id, { out: node.out, rev: node.rev });
  Collab.versionAdd(JSON.parse(JSON.stringify(ver)));

  status(out ? `${T.name} 완료 · ${T.credits}c 차감` : `${T.name} 실패`);
  toast(out ? `${T.name} 완료 · ${T.credits}c` : `${T.name} 실패 — 조건을 확인하세요`, !out);
  if (out && node.tile === 'GROUND' && out.source === 'mock' && out.fallbackReason && out.fallbackReason !== 'no-key') {
    toast('VWorld 실패: ' + out.fallbackReason + ' → 목업 폴백', true);
  }
  renderAll();
  renderInspector();
}

/* ---------------- dock ---------------- */

function renderDock() {
  $('#ver-count').textContent = S.versions.length;
  $('#ledger-count').textContent = S.ledger.length;
  const vl = $('#version-list');
  vl.innerHTML = S.versions.map(v => {
    const T = Object.values(TILES).find(t => t.name === v.tile);
    return `<li>
      <span class="v-hash">${v.hash}</span>
      <span class="v-tile" style="background:${T.accent}">${v.tile}</span>
      <span class="v-msg">${v.msg}</span>
      <span class="v-time">${v.ts}</span>
      <button class="v-restore" data-ver="${v.hash}">되돌리기</button>
    </li>`;
  }).join('');
  $$('.v-restore', vl).forEach(b => b.addEventListener('click', () => restoreVersion(b.dataset.ver)));

  const ll = $('#ledger-list');
  ll.innerHTML = S.ledger.map(l => `<li>
      <span class="v-time">${l.ts}</span>
      <span class="l-tile">${l.tile}</span>
      <span class="v-msg">${l.action}</span>
      <span class="l-bal spend">−${l.cost}c</span>
      <span class="l-bal">↳ ${l.balance}c</span>
    </li>`).join('') || `<li class="v-msg">아직 소비 내역이 없습니다.</li>`;
}

function restoreVersion(hash) {
  const v = S.versions.find(x => x.hash === hash);
  if (!v) return;
  const node = nodeById(v.nodeId);
  if (!node) { toast('해당 타일이 삭제되어 복원할 수 없습니다.', true); return; }
  node.params = JSON.parse(JSON.stringify(v.params));
  selectedId = node.id;
  renderAll(); renderInspector();
  toast(`${v.hash} 파라미터로 되돌렸습니다. 다시 실행해 확정하세요.`);
}

function renderCreditChip() {
  $('#credit-balance').textContent = S.credits;
  const chip = $('#credit-chip');
  chip.style.opacity = S.credits < 20 ? '1' : '';
}

/* ---------------- interactions ---------------- */

let drag = null; // {type:'node'|'pan'|'connect', ...}

nodesLayer.addEventListener('mousedown', (e) => {
  const port = e.target.closest('.port');
  const card = e.target.closest('.node');
  if (port && card) {
    drag = { type: 'connect', from: card.dataset.id, kind: port.dataset.port, x: e.clientX, y: e.clientY };
    port.classList.add('active');
    e.preventDefault();
    return;
  }
  if (card) {
    selectedId = card.dataset.id;
    Collab.selBroadcast(selectedId);
    drag = { type: 'node', id: card.dataset.id, dx: e.clientX / S.view.scale - nodeById(card.dataset.id).x, dy: e.clientY / S.view.scale - nodeById(card.dataset.id).y };
    renderNodes(); renderEdges(); renderInspector();
    e.preventDefault();
  }
});

const canvasWrap = $('#canvas-wrap');
canvasWrap.addEventListener('mousedown', (e) => {
  if (e.target.closest('.node') || e.target.closest('.port')) return;
  drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: S.view.x, oy: S.view.y };
  canvasWrap.style.cursor = 'grabbing';
  // deselect
  if (selectedId) { selectedId = null; Collab.selBroadcast(null); renderNodes(); renderEdges(); renderInspector(); }
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if (drag.type === 'node') {
    const node = nodeById(drag.id);
    node.x = Math.round((e.clientX / S.view.scale - drag.dx) / 5) * 5;
    node.y = Math.round((e.clientY / S.view.scale - drag.dy) / 5) * 5;
    renderNodes(); renderEdges();
  } else if (drag.type === 'pan') {
    S.view.x = drag.ox + (e.clientX - drag.sx);
    S.view.y = drag.oy + (e.clientY - drag.sy);
    applyView();
  } else if (drag.type === 'connect') {
    // temp line could be drawn; MVP: skip visual, cursor follows
  }
});

window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  if (drag.type === 'node') {
    // CRDT: 노드 위치 동기화
    const moved = nodeById(drag.id);
    if (moved) Collab.nodeFields(drag.id, { x: moved.x, y: moved.y });
  }
  if (drag.type === 'connect') {
    $$('.port').forEach(p => p.classList.remove('active'));
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port');
    if (target && target.dataset.port === 'in') {
      const toId = target.closest('.node').dataset.id;
      const fromNode = nodeById(drag.from), toNode = nodeById(toId);
      const T = TILES[toNode.tile];
      if (drag.from === toId) toast('자기 자신에게는 연결할 수 없습니다.', true);
      else if (!T.needs || !T.needs.includes(fromNode.tile)) toast(`${toNode.tile}은(는) ${T.needs ? T.needs.join('/') : '직전'} 타일을 입력으로 받습니다.`, true);
      else if (S.edges.some(x => x.from === drag.from && x.to === toId)) toast('이미 연결되어 있습니다.', true);
      else {
        const edge = { id: uid('e'), from: drag.from, to: toId };
        S.edges.push(edge);
        Collab.edgeAdd(edge);
        toast(`${fromNode.tile} → ${toNode.tile} 연결`);
        status('연결 추가');
      }
      renderAll(); renderInspector();
    }
  }
  if (drag.type === 'pan') canvasWrap.style.cursor = 'default';
  drag = null;
  save();
});

canvasWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  const old = S.view.scale;
  const next = Math.min(2, Math.max(0.4, old * (e.deltaY < 0 ? 1.1 : 0.9)));
  S.view.scale = next;
  applyView();
}, { passive: false });

edgesLayer.addEventListener('click', (e) => {
  const p = e.target.closest('path.edge');
  if (!p) return;
  const id = p.dataset.edge;
  Collab.edgeRemove(id);
  S.edges = S.edges.filter(x => x.id !== id);
  toast('연결 해제');
  renderAll(); renderInspector();
});

// edge deletion by clicking path (pointer-events: stroke) — handled above via click

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
    Collab.nodeRemove(selectedId);
    S.edges = S.edges.filter(x => x.from !== selectedId && x.to !== selectedId);
    S.nodes = S.nodes.filter(x => x.id !== selectedId);
    selectedId = null;
    Collab.selBroadcast(null);
    toast('타일 삭제');
    renderAll(); renderInspector();
  }
});

// palette
$$('#palette .tile-btn').forEach(b => b.addEventListener('click', () => {
  const tile = b.dataset.tile;
  const id = uid(tile[0]);
  const cx = (-S.view.x + canvasWrap.clientWidth / 2) / S.view.scale - 95 + (Math.random() * 60 - 30);
  const cy = (-S.view.y + canvasWrap.clientHeight / 2) / S.view.scale - 40 + (Math.random() * 60 - 30);
  const node = { id, tile, x: Math.round(cx), y: Math.round(cy), params: TILES[tile].defaultParams(), out: null, rev: 0 };
  S.nodes.push(node);
  Collab.nodeAdd(node);
  selectedId = id;
  Collab.selBroadcast(id);
  renderAll(); renderInspector();
  toast(`${tile} 타일 추가됨`);
}));

// dock tabs
$$('.dock-tab').forEach(t => t.addEventListener('click', () => {
  $$('.dock-tab').forEach(x => x.classList.remove('active'));
  $$('.dock-pane').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $(`#dock-${t.dataset.tab}`).classList.add('active');
}));

// zoom buttons
$('#zoom-in').addEventListener('click', () => { S.view.scale = Math.min(2, S.view.scale * 1.2); applyView(); save(); });
$('#zoom-out').addEventListener('click', () => { S.view.scale = Math.max(0.4, S.view.scale * 0.83); applyView(); save(); });
$('#zoom-fit').addEventListener('click', () => {
  if (!S.nodes.length) { S.view = { x: 0, y: 0, scale: 1 }; applyView(); return; }
  const xs = S.nodes.map(n => n.x), ys = S.nodes.map(n => n.y);
  const minX = Math.min(...xs) - 40, minY = Math.min(...ys) - 40;
  const maxX = Math.max(...xs.map((x, i) => x + 190)) + 40, maxY = Math.max(...ys.map(y => y + 120)) + 40;
  const scale = Math.min(1.5, Math.min(canvasWrap.clientWidth / (maxX - minX), canvasWrap.clientHeight / (maxY - minY)));
  S.view.scale = scale;
  S.view.x = -minX * scale + (canvasWrap.clientWidth - (maxX - minX) * scale) / 2;
  S.view.y = -minY * scale + (canvasWrap.clientHeight - (maxY - minY) * scale) / 2;
  applyView(); save();
});

// topbar
$('#project-name').addEventListener('input', (e) => { S.projectName = e.target.value; save(); });
$('#btn-new').addEventListener('click', () => {
  if (!confirm('새 프로젝트를 시작할까요? 현재 작업은 브라우저에서 사라집니다 (내보내기 권장).')) return;
  S = freshState();
  selectedId = null;
  $('#project-name').value = S.projectName;
  renderAll(); renderInspector();
  toast('새 프로젝트 · 크레딧 300c');
});
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tessera-${S.projectName.replace(/\s+/g, '-').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('프로젝트 JSON 내보냄');
});
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!s.nodes) throw 0;
      S = s;
      selectedId = null;
      $('#project-name').value = S.projectName || 'Imported';
      renderAll(); renderInspector();
      toast('프로젝트 가져옴');
    } catch { toast('올바른 TESSERA JSON이 아닙니다.', true); }
  };
  r.readAsText(file);
  e.target.value = '';
});

/* ---------------- boot ---------------- */

window.__TESSERA_STATE = () => S;  // collab.js apply용

function renderPeers() {
  const peers = Collab.peerList();
  const me = Collab.mySite();
  const chip = $('#peer-chip');
  const total = peers.length + 1;
  chip.hidden = false;
  $('#peer-count').textContent = total;
  $('#peer-dots').innerHTML =
    `<i style="background:${me ? me.color : '#C8552C'}"></i>` +
    peers.map(p => `<i style="background:${p.color}"></i>`).join('');
  $('#peer-tab-count').textContent = total;
  const selName = (id) => {
    const n = id && nodeById(id);
    return n ? `${n.id.split('#')[0]} 선택 중` : '대기';
  };
  $('#peer-list').innerHTML =
    (me ? `<li class="me"><i class="dot" style="background:${me.color}"></i><span class="p-name">${esc(me.name)} (나)</span><span class="p-sel">${selName(selectedId)} · ${me.id}</span></li>` : '') +
    peers.map(p => `<li><i class="dot" style="background:${p.color}"></i><span class="p-name">${esc(p.name)}</span><span class="p-sel">${selName(p.sel)} · ${p.id}</span></li>`).join('');
}

function onRemoteCollab(kind) {
  if (kind === 'presence') { renderNodes(); renderPeers(); return; }
  renderAll();
  renderPeers();
  if (selectedId) renderInspector();
  status('원격 변경 수신 — CRDT 병합');
}

S = load() || seedDemo();
$('#project-name').value = S.projectName;

Collab.init(Settings, onRemoteCollab);
saveSettings(); // siteId 확정 저장

renderAll();
renderInspector();
renderPeers();

/* 설정 모달 */
function openSettings() {
  $('#set-vworld').value = Settings.vworldKey || '';
  $('#set-gemini').value = Settings.geminiKey || '';
  $('#set-name').value = Settings.name || '';
  const me = Collab.mySite();
  $('#set-siteinfo').textContent = me ? `사이트 ID: ${me.id} · 이름: ${me.name} · 색상: ${me.color}` : '';
  $('#set-colors').innerHTML = Collab.COLORS.map(c =>
    `<button type="button" data-c="${c}" class="${me && me.color === c ? 'sel' : ''}" style="background:${c}" title="${c}"></button>`).join('');
  $$('#set-colors button').forEach(b => b.addEventListener('click', () => {
    $$('#set-colors button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
  }));
  $('#settings-backdrop').hidden = false;
  $('#settings-modal').hidden = false;
}
function closeSettings() {
  $('#settings-backdrop').hidden = true;
  $('#settings-modal').hidden = true;
}
$('#btn-settings').addEventListener('click', openSettings);
$('#set-close').addEventListener('click', closeSettings);
$('#settings-backdrop').addEventListener('click', closeSettings);
$('#set-save').addEventListener('click', () => {
  Settings.vworldKey = $('#set-vworld').value.trim();
  Settings.geminiKey = $('#set-gemini').value.trim();
  Settings.name = $('#set-name').value.trim() || '설계자';
  const selC = $('#set-colors button.sel');
  if (selC) Settings.color = selC.dataset.c;
  saveSettings();
  closeSettings();
  toast('설정 저장 — 일부는 재실행 후 반영됩니다(이름/색상)');
  location.reload();
});

status('TESSERA v0.2 준비 완료 · VWorld · 법규 RAG · CRDT 협업');
