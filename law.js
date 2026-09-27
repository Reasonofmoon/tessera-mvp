/* ============================================================
   TESSERA MVP — law.js
   법규 RAG: 로컬 코퍼스 + BM25 검색 + 인용 + (선택) Gemini 요약
   - 코퍼스 출처: 국가법령정보센터(law.go.kr) 공개 법령
     국토계획법 §77/§78: [시행 2026.7.1] [법률 제21447호] 본문
   - 세부 용도지역별 상한은 시행령+조례 사항 — 샘플값으로 표기
   ============================================================ */
'use strict';

const Law = (() => {

  /* ---------- 코퍼스 ---------- */
  const CORPUS = [
    {
      id: 'kplan-77-1',
      law: '국토의 계획 및 이용에 관한 법률',
      article: '제77조제1항',
      topic: '건폐율 최대한도',
      verbatim: true,
      text: `① 제36조에 따라 지정된 용도지역에서 건폐율의 최대한도는 관할 구역의 면적과 인구 규모, 용도지역의 특성 등을 고려하여 다음 각 호의 범위에서 대통령령으로 정하는 기준에 따라 특별시ㆍ광역시ㆍ특별자치시ㆍ특별자치도ㆍ시 또는 군의 조례로 정한다.
1. 도시지역
가. 주거지역: 70퍼센트 이하
나. 상업지역: 90퍼센트 이하
다. 공업지역: 70퍼센트 이하
라. 녹지지역: 20퍼센트 이하
2. 관리지역
가. 보전관리지역: 20퍼센트 이하
나. 생산관리지역: 20퍼센트 이하
다. 계획관리지역: 40퍼센트 이하
3. 농림지역: 20퍼센트 이하
4. 자연환경보전지역: 20퍼센트 이하`,
    },
    {
      id: 'kplan-78-1',
      law: '국토의 계획 및 이용에 관한 법률',
      article: '제78조제1항',
      topic: '용적률 최대한도',
      verbatim: true,
      text: `① 제36조에 따라 지정된 용도지역에서 용적률의 최대한도는 다음 각 호의 범위에서 대통령령으로 정하는 기준에 따라 특별시ㆍ광역시ㆍ특별자치시ㆍ특별자치도ㆍ시 또는 군의 조례로 정한다.
1. 도시지역
가. 주거지역: 500퍼센트 이하
나. 상업지역: 1천500퍼센트 이하
다. 공업지역: 400퍼센트 이하
라. 녹지지역: 100퍼센트 이하
2. 관리지역
가. 보전관리지역: 80퍼센트 이하
나. 생산관리지역: 80퍼센트 이하
다. 계획관리지역: 100퍼센트 이하
3. 농림지역: 80퍼센트 이하
4. 자연환경보전지역: 80퍼센트 이하`,
    },
    {
      id: 'kplan-78-2',
      law: '국토의 계획 및 이용에 관한 법률',
      article: '제78조제2항·제7항',
      topic: '세분 용도지역 용적률 / 완화 중첩',
      verbatim: true,
      text: `② 제36조제2항에 따라 세분된 용도지역에서의 용적률에 관한 기준은 제1항 각 호의 범위에서 대통령령으로 따로 정한다.
⑦ … 용적률 완화 규정을 중첩하여 적용할 수 있다. 다만 완화되는 용적률이 제1항 및 제2항에 따른 해당 용도지역별 용적률 최대한도를 초과하는 경우에는 건축위원회와 도시계획위원회의 공동 심의를 거쳐 … 인정하는 경우에 한정한다.
2. 지구단위계획구역 외의 지역: … 해당 용도지역별 용적률 최대한도의 120퍼센트 이하`,
    },
    {
      id: 'bldg-55',
      law: '건축법',
      article: '제55조',
      topic: '건폐율의 기준',
      verbatim: true,
      text: `대지면적에 대한 건축면적(대지에 건축물이 둘 이상 있는 경우에는 이들 건축면적의 합계로 한다)의 비율(이하 "건폐율"이라 한다)의 최대한도는 「국토의 계획 및 이용에 관한 법률」 제77조에 따른 건폐율의 기준에 따른다. 다만, 이 법에서 기준을 완화하거나 강화하여 적용하도록 규정한 경우에는 그에 따른다.
[시행 2026. 2. 27.] [법률 제21035호, 2025. 8. 26., 일부개정]`,
    },
    {
      id: 'kplan-77-2',
      law: '국토의 계획 및 이용에 관한 법률',
      article: '제77조제2항',
      topic: '세분 용도지역 건폐율 / 조례',
      verbatim: true,
      text: `② 제36조제2항에 따라 세분된 용도지역에서의 건폐율에 관한 기준은 제1항 각 호의 범위에서 대통령령으로 따로 정한다.
④ 다음 각 호의 어느 하나에 해당하는 경우로서 대통령령으로 정하는 경우에는 제1항에도 불구하고 … 조례로 건폐율을 따로 정할 수 있다.
1. 토지이용의 과밀화를 방지하기 위하여 건폐율을 강화할 필요가 있는 경우
2. 주변 여건을 고려하여 토지의 이용도를 높이기 위하여 건폐율을 완화할 필요가 있는 경우`,
    },
    {
      id: 'bldg-56-2',
      law: '건축법',
      article: '제56조의2',
      topic: '일조권한도',
      verbatim: false,
      text: `[요약] 일반주거지역·준주거지역 등 대통령령으로 정하는 지역에서는 정남방향의 인접 대지 경계선으로부터 일정 거력 이상을 확보하거나, 건축물 각 부분의 높이를 그 부분으로부터 전용주거지역 또는 녹지지역의 인접 대지 경계선까지의 수평거리에 대통령령으로 정하는 비율 이하로 제한(일조권한도). 세부 산식은 건축법 시행령 제86조.`,
    },
    {
      id: 'bldg-57',
      law: '건축법',
      article: '제57조',
      topic: '높이제한',
      verbatim: false,
      text: `[요약] 도시군계획시설(도로 등)에 접한 대지에서는 건축물의 높이가 그 도로 폭이 기준에 따라 산정한 제한을 초과할 수 없음(높이제한). 전면도로 폭 × 1.5 등의 기본 배율은 건축법 시행령 [별표 8]에서 규정하며, 가로구역별 특례가 있음.`,
    },
    {
      id: 'park-19',
      law: '주차장법',
      article: '제19조',
      topic: '부설주차장 설치기준',
      verbatim: false,
      text: `[요약] 주거지역 외의 지역에서는 건축물의 용도 및 규모에 따라 대통령령으로 정하는 기준에 따라 부설주차장을 설치하여야 함. 세부 면적당 주차대수(예: 판매시설 매 65~120㎡당 1대 등)는 주차장법 시행령 [별표 1] 및 지자체 조례가 정함.`,
    },
    {
      id: 'seoul-ord',
      law: '서울특별시 도시계획조례',
      article: '(세부기준)',
      topic: '세분 용도지역별 건폐율·용적률',
      verbatim: false,
      text: `[샘플 요약] 국토계획법 §77·§78 및 시행령이 위임한 범위에서 서울시 조례가 세부 용도지역별 건폐율·용적률을 정함. 예: 제2종 일반주거지역 용적률 250% 이하, 근린상업지역 900% 이하 등 — 실제 값은 필지별로 지구단위계획·조례 개정에 따라 달라지므로 반드시 최신 조례 원문으로 확인할 것. 본 MVP의 수치는 샘플값.`,
    },
  ];

  /* ---------- 용도지역명 → 한도 매핑(법률 상한 기준) ---------- */
  const ZONE_LIMITS = [
    { match: /제1종전용주거/, coverage: 0.50, floor: 2.5 },
    { match: /제2종전용주거/, coverage: 0.50, floor: 3.0 },
    { match: /제3종전용주거/, coverage: 0.50, floor: 3.5 },
    { match: /제1종일반주거/, coverage: 0.60, floor: 2.0 },
    { match: /제2종일반주거/, coverage: 0.60, floor: 2.5 },
    { match: /제3종일반주거/, coverage: 0.50, floor: 3.0 },
    { match: /준주거/,       coverage: 0.70, floor: 7.0 },
    { match: /중심상업/,     coverage: 0.90, floor: 15.0 },
    { match: /일반상업/,     coverage: 0.80, floor: 13.0 },
    { match: /근린상업/,     coverage: 0.70, floor: 9.0 },
    { match: /유통상업/,     coverage: 0.80, floor: 11.0 },
    { match: /전용공업/,     coverage: 0.70, floor: 3.0 },
    { match: /일반공업/,     coverage: 0.70, floor: 3.0 },
    { match: /준공업/,       coverage: 0.70, floor: 4.0 },
    { match: /보전녹지/,     coverage: 0.20, floor: 0.8 },
    { match: /생산녹지/,     coverage: 0.20, floor: 1.0 },
    { match: /계획녹지/,     coverage: 0.20, floor: 1.2 },
    { match: /계획관리/,     coverage: 0.40, floor: 1.0 },
    { match: /보전관리/,     coverage: 0.20, floor: 0.8 },
    { match: /생산관리/,     coverage: 0.20, floor: 0.8 },
    { match: /농림/,         coverage: 0.20, floor: 0.8 },
    { match: /자연환경보전/, coverage: 0.20, floor: 0.8 },
  ];
  function limitsFor(zoneName) {
    for (const z of ZONE_LIMITS) if (z.match.test(zoneName || '')) return { coverage: z.coverage, floor: z.floor };
    return { coverage: 0.5, floor: 2.0 }; // 도시지역 기본값(주거)
  }

  /* ---------- BM25 스타일 검색 ---------- */
  const _tok = (s) => (s || '').toLowerCase().replace(/[^가-힣a-z0-9%ㆍ]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  const DOCS = CORPUS.map(d => ({ ...d, toks: _tok(d.law + ' ' + d.article + ' ' + d.topic + ' ' + d.text) }));
  const DF = {};
  DOCS.forEach(d => new Set(d.toks).forEach(t => DF[t] = (DF[t] || 0) + 1));
  const N = DOCS.length;
  const k1 = 1.4, b = 0.6;
  const AVG = DOCS.reduce((a, d) => a + d.toks.length, 0) / N;

  function retrieve(query, topK = 3) {
    const qt = _tok(query);
    const scored = DOCS.map(d => {
      let sc = 0;
      const tf = {};
      d.toks.forEach(t => tf[t] = (tf[t] || 0) + 1);
      for (const t of new Set(qt)) {
        if (!tf[t]) continue;
        const idf = Math.log(1 + (N - (DF[t] || 0) + 0.5) / ((DF[t] || 0) + 0.5));
        sc += idf * (tf[t] * (k1 + 1)) / (tf[t] + k1 * (1 - b + b * d.toks.length / AVG));
      }
      return { id: d.id, law: d.law, article: d.article, topic: d.topic, verbatim: d.verbatim, text: d.text, score: Math.round(sc * 100) / 100 };
    }).filter(d => d.score > 0).sort((a, b2) => b2.score - a.score);
    return scored.slice(0, topK);
  }

  /* ---------- (선택) Gemini 요약: 근거 접지 요약 ---------- */
  async function synthesize(question, hits, apiKey) {
    const context = hits.map(h => `[${h.law} ${h.article}] (${h.topic})\n${h.text}`).join('\n\n');
    const prompt = `당신은 건축 설계 보조 플랫폼의 법규 브리핑 어시스턴트입니다. 아래 근거 조문만 사용해 한국어로 5문장 이내로 요약하세요. 근거에 없는 수치를 만들지 말 것. 각 문장 뒤에 (법령 제N조) 형태로 출처를 붙이세요. 추정이 필요하면 "확인 필요"라고 명시하세요.

질문: ${question}

근거 조문:
${context}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error('Gemini API ' + res.status);
    const data = await res.json();
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts.map(p => p.text).join('');
    if (!text) throw new Error('Gemini 응답 없음');
    return text.trim();
  }

  return { CORPUS, retrieve, synthesize, limitsFor };
})();
