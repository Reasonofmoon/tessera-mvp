/* ============================================================
   TESSERA MVP — api.js
   VWorld(국가공간정보포털) 실연동 클라이언트
   - JSONP 전송(CORS 우회, 공식 샘플과 동일 방식)
   - 주소 → 좌표(req/search) → 연속지적도(LP_PA_CBND_BUBUN)
     → 용도지역(LT_C_UQ111/112/113, uname)
   - 실패 시 호출부가 결정론적 목업으로 폴백
   ============================================================ */
'use strict';

const VW = (() => {
  const BASE = 'https://api.vworld.kr';

  /* ---------- JSONP ---------- */
  let cbSeq = 0;
  function jsonp(url, timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      const cb = '__tessera_cb_' + (++cbSeq) + '_' + Date.now();
      const s = document.createElement('script');
      const cleanup = () => { try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); };
      const tm = setTimeout(() => { cleanup(); reject(new Error('VWorld 타임아웃')); }, timeoutMs);
      window[cb] = (data) => { clearTimeout(tm); cleanup(); resolve(data); };
      s.onerror = () => { clearTimeout(tm); cleanup(); reject(new Error('VWorld 네트워크 오류')); };
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(s);
    });
  }

  const q = (obj) => Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  /* ---------- 1) 주소 → 좌표 ---------- */
  async function searchAddress(address, key) {
    const url = BASE + '/req/search?' + q({
      service: 'search', version: '2.0', request: 'search',
      format: 'json', errorformat: 'json', crs: 'EPSG:4326',
      size: '5', page: '1', query: address, type: 'ADDRESS', category: 'parcel', key,
    });
    const res = await jsonp(url);
    const body = res && res.response;
    if (!body || body.status !== 'OK') throw new Error('VWorld search: ' + (body && body.status || '응답 없음'));
    const fc = body.result && body.result.featureCollection;
    const feats = (fc && fc.features) || [];
    if (!feats.length) throw new Error('주소를 찾지 못했습니다');
    const f = feats[0];
    const coord = f.geometry && f.geometry.coordinates; // [x, y]
    if (!coord) throw new Error('좌표 없음');
    return { x: coord[0], y: coord[1], formatted: (f.properties && (f.properties.address || f.properties.roadname)) || address };
  }

  /* ---------- 2) 지적도(필지 폴리곤 + pnu/jibun) ---------- */
  async function parcelAt(x, y, jibunHint, key) {
    const d = 0.00012; // 약 13m 반경 박스
    const url = BASE + '/req/data?' + q({
      service: 'data', version: '2.0', request: 'GetFeature',
      format: 'json', errorformat: 'json',
      size: '10', page: '1', data: 'LP_PA_CBND_BUBUN',
      crs: 'EPSG:4326', geometry: 'true', attribute: 'true',
      geomFilter: `BOX(${x - d},${y - d},${x + d},${y + d})`,
      key,
    });
    const res = await jsonp(url);
    const body = res && res.response;
    if (!body || body.status !== 'OK') throw new Error('VWorld data: ' + (body && body.status || '응답 없음'));
    const feats = (body.result && body.result.featureCollection && body.result.featureCollection.features) || [];
    if (!feats.length) throw new Error('필지를 찾지 못했습니다');
    // 힌트 지번이 있으면 우선, 없으면 중심에 가장 가까운 필지
    let pick = feats[0], best = Infinity;
    for (const f of feats) {
      const p = f.properties || {};
      const g = centroidOf(f.geometry);
      if (!g) continue;
      const dist = (g.x - x) ** 2 + (g.y - y) ** 2;
      if (jibunHint && p.jibun && normalizeJibun(p.jibun).includes(normalizeJibun(jibunHint))) { pick = f; break; }
      if (dist < best) { best = dist; pick = f; }
    }
    const ring = outerRing(pick.geometry);
    return { pnu: pick.properties.pnu, jibun: pick.properties.jibun, ring, centroid: centroidOf(pick.geometry) };
  }

  function normalizeJibun(s) { return String(s || '').replace(/[^0-9가-힣]/g, ''); }
  function outerRing(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return geom.coordinates[0] || [];
    if (geom.type === 'MultiPolygon') return (geom.coordinates[0] || [[]])[0] || [];
    return [];
  }
  function centroidOf(geom) {
    const ring = outerRing(geom);
    if (!ring.length) return null;
    let sx = 0, sy = 0;
    for (const c of ring) { sx += c[0]; sy += c[1]; }
    return { x: sx / ring.length, y: sy / ring.length };
  }

  /* 지리 면적(㎡): 로컬 ENU 근사 — 소규모 필지 오차 < 0.1% */
  function ringAreaM2(ring) {
    if (ring.length < 3) return 0;
    const lat0 = ring.reduce((a, c) => a + c[1], 0) / ring.length;
    const mx = 111320 * Math.cos(lat0 * Math.PI / 180); // m per deg lon
    const my = 110540;                                  // m per deg lat
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      area += (a[0] * mx) * (b[1] * my) - (b[0] * mx) * (a[1] * my);
    }
    return Math.abs(area / 2);
  }

  /* ---------- 3) 용도지역 uname ---------- */
  async function zoningAt(x, y, key) {
    const pt = `POINT(${x} ${y})`;
    for (const layer of ['LT_C_UQ111', 'LT_C_UQ112', 'LT_C_UQ113']) {
      const url = BASE + '/req/data?' + q({
        service: 'data', version: '2.0', request: 'GetFeature',
        format: 'json', errorformat: 'json',
        size: '10', page: '1', data: layer,
        geometry: 'false', attribute: 'true', crs: 'EPSG:4326',
        geomFilter: pt, key,
      });
      try {
        const res = await jsonp(url, 7000);
        const body = res && res.response;
        if (body && body.status === 'OK') {
          const feats = (body.result && body.result.featureCollection && body.result.featureCollection.features) || [];
          const named = feats.map(f => f.properties && f.properties.uname).filter(Boolean);
          if (named.length) return { zone: named[0], layer };
        }
      } catch (e) { /* 다음 레이어 시도 */ }
    }
    return null;
  }

  /* ---------- 4) 통합 브리핑 ---------- */
  /* 반환: siteData (source='live') — 실패 시 null (호출부가 목업 폴백) */
  async function briefing(address, key) {
    if (!key) return null;
    const geo = await searchAddress(address, key);
    const jibunHint = (address.match(/([가-힣]+\s*)\d+-?\d*/) || [])[0];
    const parcel = await parcelAt(geo.x, geo.y, jibunHint, key);
    const z = await zoningAt(parcel.centroid.x, parcel.centroid.y, key);
    if (!z) throw new Error('용도지역을 확인하지 못했습니다(경계 인접 필지일 수 있음)');
    const area = Math.round(ringAreaM2(parcel.ring));
    return {
      source: 'live',
      zone: z.zone,
      siteArea: area,
      parcel: {
        pnu: parcel.pnu, jibun: parcel.jibun,
        ring: parcel.ring.map(c => [+c[0].toFixed(7), +c[1].toFixed(7)]),
        center: parcel.centroid,
      },
      apiTime: new Date().toISOString(),
    };
  }

  return { briefing, searchAddress, parcelAt, zoningAt, ringAreaM2 };
})();
