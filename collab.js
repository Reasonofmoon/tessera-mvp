/* ============================================================
   TESSERA MVP — collab.js
   제로 의존성 CRDT 협업 레이어
   - LWW(Last-Writer-Wins) 레지스터 + 램포트 클록 + 사이트 ID
   - 원소 추가/제거 세트(노드·엣지·댓글, 묘비 톰스톤)
   - 전송: BroadcastChannel(같은 브라우저 탭 간 실시간)
   - presence: 접속 피어, 선택 타일 하이라이트
   ============================================================ */
'use strict';

const Collab = (() => {

  const COLORS = ['#C8552C', '#5F7A5A', '#B98A2F', '#3E5C76', '#7A5C61', '#8A3B5C'];
  const CH = { app: null, presence: null };
  let site = null;           // {id, name, color}
  let clock = 0;
  let peers = {};            // id → {name,color,sel,last}
  let applying = false;      // 수신 적용 중 로컬 재발송 방지
  let onRemote = null;       // 콜백(app.js가 등록): 상태 재렌더링

  /* ---------- 설정 ---------- */
  function mySite() { return site; }

  function init(settings, remoteCallback) {
    onRemote = remoteCallback;
    site = {
      // 사이트 ID는 탭(세션) 단위 — 같은 localStorage를 공유하는 탭들이 서로 다른 피어로 인식
      id: 'S' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      name: settings.name || '설계자',
      color: settings.color || COLORS[Math.floor(Math.random() * COLORS.length)],
    };
    const chan = 'tessera-collab-v2'; // MVP는 단일 프로젝트 채널
    try {
      CH.app = new BroadcastChannel(chan);
      CH.app.onmessage = (e) => receive(e.data);
      CH.presence = new BroadcastChannel(chan + '-p');
      CH.presence.onmessage = (e) => {
        const m = e.data;
        if (!m || !m.site || m.site.id === site.id) return;
        const isNew = !peers[m.site.id];
        if (m.leave) { delete peers[m.site.id]; broadcastPresence(); onRemote && onRemote('presence'); return; }
        peers[m.site.id] = { ...m.site, sel: m.sel, last: Date.now() };
        if (isNew) { // 신규 피어에게 상태 스냅숏 전송(초기 동기화)
          setTimeout(sendState, 400);
        }
        onRemote && onRemote('presence');
      };
      broadcastPresence();
      setInterval(() => {
        broadcastPresence();
        const now = Date.now();
        let dropped = false;
        for (const id in peers) if (now - peers[id].last > 5000) { delete peers[id]; dropped = true; }
        if (dropped && onRemote) onRemote('presence');
      }, 1500);
      window.addEventListener('beforeunload', () => {
        try { CH.presence.postMessage({ leave: true, site }); } catch (e) {}
      });
    } catch (e) {
      // BroadcastChannel 미지원 환경 — 협업 비활성, 앱은 동작
      CH.app = null;
    }
  }

  function broadcastPresence(selId) {
    if (!CH.presence) return;
    try {
      CH.presence.postMessage({ site: { id: site.id, name: site.name, color: site.color }, sel: selId || null });
    } catch (e) {}
  }

  /* ---------- 타임스탬프/병합 규칙 ---------- */
  function stamp() { return { s: site.id, l: ++clock }; }
  function newer(a, b) { // a가 b보다 최신인가
    if (!b) return true;
    if (a.l !== b.l) return a.l > b.l;
    return String(a.s) > String(b.s);
  }
  function syncClock(remote) { clock = Math.max(clock, remote || 0); }

  function send(op) {
    if (!CH.app || applying) return;
    try { CH.app.postMessage(op); } catch (e) {}
  }

  /* 초기 상태 스냅숏 (신규 피어 핸드셰이크) */
  function sendState() {
    const S = window.__TESSERA_STATE && window.__TESSERA_STATE();
    if (!S || !CH.app || applying) return;
    send({
      t: 'state', ts: stamp(),
      state: {
        nodes: S.nodes, edges: S.edges,
        comments: S.comments || [], versions: S.versions,
        tombs: S.tombs || { nodes: {}, edges: {} },
      },
    });
  }

  /* ---------- 로컬 변경 발송 API ---------- */
  function nodeAdd(node) {
    const ts = stamp();
    node._ts = ts;
    send({ t: 'na', node: JSON.parse(JSON.stringify(node)), ts });
  }
  function nodeRemove(id) {
    const ts = stamp();
    send({ t: 'nr', id, ts });
    return ts; // 호출부가 톰스톤 기록
  }
  function nodeFields(id, fields) {
    const ts = stamp();
    send({ t: 'nf', id, fields: JSON.parse(JSON.stringify(fields)), ts });
    return ts;
  }
  function edgeAdd(edge) {
    const ts = stamp();
    edge._ts = ts;
    send({ t: 'ea', edge: JSON.parse(JSON.stringify(edge)), ts });
  }
  function edgeRemove(id) {
    const ts = stamp();
    send({ t: 'er', id, ts });
    return ts;
  }
  function versionAdd(v) {
    const ts = stamp();
    send({ t: 'va', v: JSON.parse(JSON.stringify(v)), ts });
  }
  function commentAdd(c) {
    const ts = stamp();
    c.ts = ts;
    send({ t: 'ca', c: JSON.parse(JSON.stringify(c)), ts });
  }
  function commentRemove(id) {
    const ts = stamp();
    send({ t: 'cr', id, ts });
    return ts;
  }

  /* ---------- 원격 오퍼레이션 수신/적용 ---------- */
  function receive(op) {
    if (!op || !op.ts) return;
    if (op.ts.s === site.id) return; // 자기 메시지
    applying = true;
    syncClock(op.ts.l);
    try {
      if (op.t === 'state') mergeState(op);
      else apply(op);
      onRemote && onRemote(op.t);
    } finally { applying = false; }
  }

  function apply(op) {
    const S = window.__TESSERA_STATE && window.__TESSERA_STATE();
    if (!S) return;

    switch (op.t) {
      case 'na': {
        // 이미 존재하면 _ts 비교 후 대체
        const idx = S.nodes.findIndex(n => n.id === op.node.id);
        if (idx >= 0) {
          if (newer(op.ts, S.nodes[idx]._ts)) S.nodes[idx] = op.node;
        } else if (!isTomb(S.tombs && S.tombs.nodes, op.node.id, op.ts)) {
          S.nodes.push(op.node);
        }
        break;
      }
      case 'nr': {
        (S.tombs = S.tombs || { nodes: {}, edges: {} }).nodes[op.id] = op.ts;
        S.nodes = S.nodes.filter(n => n.id !== op.id);
        S.edges = S.edges.filter(e => e.from !== op.id && e.to !== op.id);
        break;
      }
      case 'nf': {
        const n = S.nodes.find(x => x.id === op.id);
        if (!n) break;
        if (!n._ts || newer(op.ts, n._ts) || op.ts.l >= (n._ts.l || 0)) {
          Object.assign(n, op.fields);
          n._ts = op.ts;
        }
        break;
      }
      case 'ea': {
        if (!S.edges.some(e => e.id === op.edge.id) && !isTomb(S.tombs && S.tombs.edges, op.edge.id, op.ts)) {
          S.edges.push(op.edge);
        }
        break;
      }
      case 'er': {
        (S.tombs = S.tombs || { nodes: {}, edges: {} }).edges[op.id] = op.ts;
        S.edges = S.edges.filter(e => e.id !== op.id);
        break;
      }
      case 'va': {
        S.versions = S.versions.filter(v => v.hash !== op.v.hash);
        S.versions.push(op.v);
        S.versions.sort((a, b) => (a._l || 0) - (b._l || 0));
        break;
      }
      case 'ca': {
        S.comments = S.comments || [];
        S.comments = S.comments.filter(c => c.id !== op.c.id);
        S.comments.push(op.c);
        break;
      }
      case 'cr': {
        S.comments = (S.comments || []).map(c => c.id === op.id ? { ...c, tomb: true, tombTs: op.ts } : c);
        break;
      }
    }
  }

  function isTomb(tombs, id, addTs) {
    const t = tombs && tombs[id];
    return t && newer(t, addTs);
  }

  /* 상태 스냅숏 LWW 병합 */
  function mergeState(op) {
    const S = window.__TESSERA_STATE && window.__TESSERA_STATE();
    if (!S) return;
    syncClock(op.ts.l);
    const inc = op.state || {};
    S.tombs = S.tombs || { nodes: {}, edges: {} };
    const incTombs = inc.tombs || { nodes: {}, edges: {} };
    for (const kind of ['nodes', 'edges']) {
      for (const id in incTombs[kind]) {
        if (!S.tombs[kind][id] || newer(incTombs[kind][id], S.tombs[kind][id])) S.tombs[kind][id] = incTombs[kind][id];
      }
    }
    const byId = new Map(S.nodes.map(n => [n.id, n]));
    for (const n of (inc.nodes || [])) {
      if (S.tombs.nodes[n.id] && newer(S.tombs.nodes[n.id], n._ts)) continue;
      const cur = byId.get(n.id);
      if (!cur) S.nodes.push(JSON.parse(JSON.stringify(n)));
      else if (newer(n._ts || { s: '', l: 0 }, cur._ts || { s: '', l: 0 })) Object.assign(cur, n);
    }
    const eById = new Set(S.edges.map(e => e.id));
    for (const e of (inc.edges || [])) {
      if (S.tombs.edges[e.id] && newer(S.tombs.edges[e.id], e._ts)) continue;
      if (!eById.has(e.id)) S.edges.push(JSON.parse(JSON.stringify(e)));
    }
    S.comments = S.comments || [];
    const cById = new Map(S.comments.map(c => [c.id, c]));
    for (const c of (inc.comments || [])) {
      const cur = cById.get(c.id);
      if (!cur) S.comments.push(JSON.parse(JSON.stringify(c)));
      else if (c.tomb && !cur.tomb) cur.tomb = true;
      else if (!cur.tomb && c.tomb === undefined) Object.assign(cur, c);
    }
    const vHash = new Set(S.versions.map(v => v.hash));
    for (const v of (inc.versions || [])) if (!vHash.has(v.hash)) S.versions.push(JSON.parse(JSON.stringify(v)));
    S.versions.sort((a, b) => (a._l || 0) - (b._l || 0));
  }

  /* ---------- 피어 정보 ---------- */
  function peerList() { return Object.values(peers); }
  function peerCount() { return Object.keys(peers).length; }
  function selBroadcast(selId) { broadcastPresence(selId); }

  return { COLORS, init, mySite, peerList, peerCount, selBroadcast, nodeAdd, nodeRemove, nodeFields, edgeAdd, edgeRemove, versionAdd, commentAdd, commentRemove };
})();
