/* 회화 영어 단어장 · 6,412 SRS — v4.4.0
 * - 한 문제마다 즉시 저장(중간에 나가도 푼 만큼 반영) + 이어서 풀기
 * - 모든 학습 세트 10문제
 * - 예문 듣기(TTS, 0.75x/1.0x) · 문제별 맞춤 해설 + 보기(A~D) 뜻
 * - 🗣️ 말하기·발음 교정 (Web Speech API) · 해설에서 바로 「따라 말하기」
 * - 💬 AI 회화방 (주제별 시나리오 + 내장 교정기 + 선택 LLM)
 * - 안드로이드 뒤로가기 2단계
 * - v4.0: 오늘 목표 게이지 · 복습 예보 · 세션 콤보/진행 도트 · 틀린 카드만 다시
 * - v4.2: 청크(의미 단위) 끊어읽기 + 1.0x/0.75x 청크 듣기 · 패턴 치환 연습 ·
 *         회화방 교정 누적 통계 → 관련 카드 10문제 · 회수 라운드 도트/콤보
 * - v4.3: 틀 사전 88개 · 청크가 핵심 표현(b)을 자르지 않음 · 내 발음 녹음/원어민 비교 · 교정 7일 추이·규칙 필터
 * - v4.4: 조동사+주어 틀까지 2차 틀 사전 102개(칩 239문장) · 비교 듣기 원어민 1.0x/0.75x 선택 ·
 *         교정 기간 7일/30일/전체 전환 + 규칙별 미니 추이
 * - v4.5: 교정 '이번 주(월~일)' 보기 + 전체 월 묶음 · 자주 고친 규칙으로 내 문장 다시 말하기 ·
 *         2차 틀 사전 36개 보강(요청·약속·여행·진료) · 청크 리듬(한 청크 듣고 따라 말하기) ·
 *         패턴 치환에 현재 문장 표시
 * - v4.6: 교정 규칙 다중 선택(두 규칙을 함께 골라 한 세트로) · '이번 주' 막대 칸 터치로 그날만 보기 ·
 *         기록 한 줄에서 그 문장만 다시 말하기 · 2차 틀 사전 80개 보강(칩 283 → 363/412)
 */
(function () {
  'use strict';

  var KEY = 'vocab5k.v1';
  var SET_SIZE = 10;          /* 모든 학습·퀴즈 세트는 10문제 */
  var NEW_OPTIONS = [5, 10, 15];  /* 하루 새 카드 선택지 — 20 이상은 두지 않는다 */
  var QA = /[?&]qa=1/.test(location.search);
  /* QA 모드에서는 서비스워커·캐시가 개입하지 않게 정리한다 — 예전 배포 캐시가
     iframe 내비게이션을 가로채 엉뚱한 화면(앱 껍데기)을 돌려주는 것을 막는다 */
  if (QA && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      rs.forEach(function (r) { r.unregister(); });
    }).catch(function () {});
    if (window.caches) {
      caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); }).catch(function () {});
    }
  }
  var DAY = 86400000;
  var MIN10 = 600000;
  /* SRS 사다리 (Anki/SM-2 검증 방식): 오답 10분 → 1 → 3 → 7 → 14 → 30일 → 마스터(60일+) */
  var STAGE_LABEL = ['10분 뒤', '1일 뒤', '3일 뒤', '7일 뒤', '14일 뒤', '30일 뒤', '마스터'];
  var STAGE_GAP = [MIN10, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 0];
  var MASTER_ST = 6;
  /* 오늘 목표 — 새 카드 몫의 2배(최소 10문제). 하루 두 세트면 채워진다 */
  function dailyGoal() { return Math.max(10, (+store.settings.newPerDay || 10) * 2); }

  /* 난이도 프리셋 — 기본은 중상급(Lv.4·5) */
  var PRESETS = {
    mid: {
      label: '중급', sub: 'Lv.3·4', desc: 'Lv.3·4 — B1·B2 회화 핵심',
      mix: [{ lv: 3, w: 55 }, { lv: 4, w: 45 }]
    },
    upper: {
      label: '중상급', sub: 'Lv.4·5', desc: 'Lv.4·5 집중 · B2·C1 + 구동사·구문',
      mix: [{ lv: 4, w: 60 }, { lv: 5, w: 25 }, { lv: 3, w: 15, hard: true }]
    },
    pattern: {
      label: '구문·패턴', sub: 'Lv.5', desc: 'Lv.5만 · 구동사·회화 구문·연결어 1,000',
      mix: [{ lv: 5, w: 100 }]
    }
  };
  var MIX_BASIC = [{ lv: 1, w: 10 }, { lv: 2, w: 15 }, { lv: 3, w: 30 }, { lv: 4, w: 35 }, { lv: 5, w: 10 }];

  var MODE_LABEL = { quiz: '4지선다', blank: '빈칸 채우기', order: '문장 순서', card: '플래시카드' };
  var MODE_ICON = { quiz: '🔤', blank: '✍️', order: '🧩', card: '🃏' };
  var MODE_KEYS = ['quiz', 'blank', 'order', 'card'];

  /* 태그별 한 줄 조언 — 피드백의 "왜 이 표현"에 붙는다 */
  var TAG_TIP = {
    '구동사': '동사+입자 조합은 입자 하나로 뜻이 갈립니다. 목적어가 대명사면 사이에 넣어요 (pick it up).',
    '회화 구문': '패턴은 통째로 외우고 [ ] 자리만 바꿔 끼우면 문장이 늘어납니다.',
    '연결·논리': '앞 문장과의 관계(반대·추가·정리)를 표시하는 말입니다. 문장 첫머리에 둡니다.',
    '의견·감정': '내 태도를 먼저 말하고 이유를 붙이면 훨씬 자연스럽습니다.',
    '부탁·제안': '상대의 부담을 낮춰 주는 표현일수록 공손하게 들립니다.',
    '사과·문제': '사과는 짧게, 책임은 분명하게 말합니다.',
    '화법·완곡': '단정 대신 여지를 남기는 표현입니다. 회의·협상에서 자주 씁니다.',
    '비즈니스': '업무 상황에서 그대로 쓰는 덩어리입니다. 동사+목적어로 통째로 외우세요.',
    '시간·약속': '시간 약속은 짧게, 변동은 먼저 알립니다.',
    '일상 청크': '그 상황에서 통째로 쓰는 말입니다.',
    '설득·의견': '근거를 한 줄 붙이면 설득력이 생깁니다.'
  };

  /* ---------------- 저장소 ---------------- */
  var store = load();

  function todayKey(d) {
    d = d || new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + dd;
  }

  function load() {
    var base = {
      v: 1, cards: {}, stats: {}, modes: {}, speak: [], chat: {}, session: null,
      settings: {
        newPerDay: 10, dir: 'w2m', level: 0, theme: null, includeBasic: false,
        preset: 'upper', mode: 'quiz', speed: 1, order: 'imp', autoSay: false,
        aiProvider: 'gemini', aiKey: '', aiModel: ''
      },
      newDay: null, newCount: 0
    };
    if (QA) return base;
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return base;
      var s = JSON.parse(raw);
      s.cards = s.cards || {};
      s.stats = s.stats || {};
      s.modes = s.modes || {};
      s.speak = s.speak || [];
      s.chat = s.chat || {};
      s.settings = Object.assign(base.settings, s.settings || {});
      if (!PRESETS[s.settings.preset]) s.settings.preset = 'upper';
      if (!MODE_LABEL[s.settings.mode]) s.settings.mode = 'quiz';
      if (s.settings.order !== 'random') s.settings.order = 'imp';
      /* 20·30개 단위를 쓰던 예전 설정은 10으로 내린다 */
      if (NEW_OPTIONS.indexOf(+s.settings.newPerDay) === -1) s.settings.newPerDay = 10;
      return s;
    } catch (e) {
      return base;
    }
  }

  var saveTimer = null;
  function saveNow() {
    if (QA) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { toast('저장 공간이 부족해요'); }
  }
  /* 화면을 떠나는 순간에도 남은 변경을 흘리지 않는다 */
  addEventListener('pagehide', saveNow);
  addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveNow(); });
  function save() {
    if (QA) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 120);
  }

  function todayStats() {
    var k = todayKey();
    if (!store.stats[k]) store.stats[k] = { n: 0, ok: 0 };
    return store.stats[k];
  }

  function bumpNew() {
    var k = todayKey();
    if (store.newDay !== k) { store.newDay = k; store.newCount = 0; }
  }

  function newLeft() {
    bumpNew();
    return Math.max(0, store.settings.newPerDay - store.newCount);
  }

  /* ---------------- 데이터 ---------------- */
  var LEVELS = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  var META = window.VOCAB_META || { levels: {} };
  var LEVEL_META = {
    1: { name: 'A1 회화 코어', sub: '기초 1,000 — A1 전체 + A2 상위' },
    2: { name: 'A2 일상 회화', sub: '누적 2,000 — A2 + B1 시작' },
    3: { name: 'B1·B2 필수', sub: '누적 3,000 — B1 마무리 + B2 핵심' },
    4: { name: 'B2·C1 상급', sub: '누적 5,000 — B2 + C1, 회화 96~97%' },
    5: { name: '구동사·구문·연결어', sub: '구동사 · 회화 구문 · 고급 연결어 · 비즈니스 청크 1,000' },
    6: { name: '실전 회화 문장', sub: '상황별 통문장 — 묻고 답하는 문장을 통째로' }
  };
  var INDEX = {};
  var BLANK_GLOSS = {};
  var LOADED = { 1: true, 2: false, 3: false, 4: false, 5: true, 6: false };

  function ingest(level) {
    var arr = window['VOCAB_LV' + level] || [];
    LEVELS[level] = arr;
    arr.forEach(function (c, i) {
      var k = c.w.toLowerCase();
      if (!INDEX[k]) INDEX[k] = { c: c, lv: level };
      c._lv = level;
      c._i = i;
      if (c.b && !BLANK_GLOSS[c.b.toLowerCase()]) BLANK_GLOSS[c.b.toLowerCase()] = c.bm || '';
    });
    LOADED[level] = true;
    if (META.levels) {
      Object.keys(LEVEL_META).forEach(function (lv) {
        var m = META.levels[lv];
        if (m) {
          LEVEL_META[lv].name = m.label || LEVEL_META[lv].name;
          LEVEL_META[lv].sub = m.sub || LEVEL_META[lv].sub;
          LEVEL_META[lv].count = m.count;
          LEVEL_META[lv].coverage = m.coverage;
        }
      });
    }
  }
  ingest(1); ingest(5);
  if (window.VOCAB_LV2) ingest(2);
  if (window.VOCAB_LV3) ingest(3);
  if (window.VOCAB_LV4) ingest(4);
  if (window.VOCAB_LV6) ingest(6);

  function allCards() {
    return LEVELS[1].concat(LEVELS[2], LEVELS[3], LEVELS[4], LEVELS[5], LEVELS[6]);
  }

  function deckTotal() {
    return (META && META.total) || allCards().length;
  }

  function cardByW(w) {
    var e = INDEX[String(w || '').toLowerCase()];
    return e ? e.c : null;
  }

  function rec(word) {
    var k = word.toLowerCase();
    if (!store.cards[k]) store.cards[k] = { st: 0, due: 0, seen: 0, ok: 0, bad: 0, star: 0, t: 0 };
    return store.cards[k];
  }
  function peek(word) { return store.cards[word.toLowerCase()]; }

  /* ---------------- 유틸 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 2000);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /* 회화 중요도 배지 — 데이터의 ib: 2=필수★, 1=고빈도, 0=표시 안 함 */
  function impBadge(c) {
    if (!c || !c.ib) return '';
    return '<span class="imp-badge' + (c.ib === 2 ? ' hot' : '') + '">' +
      (c.ib === 2 ? '필수★' : '고빈도') + '</span>';
  }

  /* ---------------- 발음 ---------------- */
  var voices = [];
  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    var list = window.speechSynthesis.getVoices() || [];
    voices = list;
    var en = list.filter(function (v) { return /^en(-|_)?(US)?/i.test(v.lang) && /US/i.test(v.lang); });
    return en[0] || list.filter(function (v) { return /^en/i.test(v.lang); })[0] || null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }
  var speakOk = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  function speedRate() { return Number(store.settings.speed) === 0.75 ? 0.75 : 1; }

  function speak(text, rateOverride) {
    if (!speakOk) { toast('이 브라우저는 발음 재생을 지원하지 않아요'); return; }
    var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t) return;
    CH_SPEAK.token++;   /* 진행 중인 청크 이어듣기를 멈춘다 */
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(t);
      u.lang = 'en-US';
      u.rate = rateOverride || speedRate();
      var v = pickVoice();
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch (e) { toast('발음을 재생할 수 없어요'); }
  }

  /* 예문(Example sentence) 전용 — 카드·퀴즈·해설·단어장 어디서든 같은 버튼을 쓴다 */
  /* 청크가 자르면 안 되는 핵심 표현 — 회화 문장 카드의 빈칸 표현(b) */
  function chunkProtect(c, text) {
    if (!c || c._lv !== 6 || !c.b) return '';
    var b = String(c.b).replace(/\s+/g, ' ').trim();
    if (!b) return '';
    if (text && String(text).toLowerCase().indexOf(b.toLowerCase()) < 0) return '';
    return b;
  }

  function exampleOf(c) {
    if (!c) return '';
    return c._lv === 6 ? (c.w || '') : (c.e || c.w || '');
  }
  function speakExample(c, slow) {
    var t = exampleOf(c);
    if (!t) { toast('예문이 없는 카드예요'); return; }
    speak(t, slow ? 0.75 : speedRate());
  }

  function paintSpeed() {
    var b = $('#speedBtn');
    if (!b) return;
    var slow = speedRate() === 0.75;
    b.textContent = slow ? '🐢 0.75x' : '🔊 1.0x';
    b.classList.toggle('slow', slow);
    $$('#speedPick button').forEach(function (x) {
      x.classList.toggle('active', Number(x.dataset.speed) === speedRate());
    });
  }

  /* ---------------- 청크(의미 단위) 끊어읽기 · 패턴 치환 ----------------
     원어민은 단어를 하나씩이 아니라 '생각 단위(thought group)'로 끊어 말한다.
     기능어(접속사·전치사·한정사) 앞에서 끊고 한 청크는 5단어를 넘기지 않는다.
     Speak의 '한 문장 → 따라 말하기 → 조금씩 변형'과 ELSA의 느린 재생·단어 표시를
     우리 TTS 구조에 옮긴 것 (타사 문구·콘텐츠 복사 없음). */
  var CH_CONJ = {}, CH_PREP = {}, CH_DET = {}, CH_TAIL = {};
  ('and but or so because if when while until unless although though since before after then ' +
    'that which who where than').split(' ').forEach(function (w) { CH_CONJ[w] = 1; });
  ('at in on for to from with about by into over under through around during without like')
    .split(' ').forEach(function (w) { CH_PREP[w] = 1; });
  ('a an the some any my your his her our their this that these those one two three another more')
    .split(' ').forEach(function (w) { CH_DET[w] = 1; });
  'yes no sure thanks thank okay ok well oh hey hi right um'.split(' ').forEach(function (w) { CH_TAIL[w] = 1; });

  function chunkCore(t) {
    return String(t == null ? '' : t).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase();
  }

  /* 문장 → 청크 배열. 한 단어만 남은 조각은 앞 청크에 붙이고, 감탄사·대답은 그대로 둔다.
     protect(카드의 핵심 빈칸 표현 b)가 주어지면 그 구간은 절대 중간을 자르지 않는다 —
     카드에서 가린 표현이 두 청크로 갈리면 따라 말하기의 의미 단위가 무너지기 때문.
     대신 b의 첫 단어 앞에서 끊어 그 표현이 청크 선두에 오게 하고, 청크는 5~6단어를 넘기지 않는다
     (6단어짜리 표현 앞에 한 단어가 붙는 드문 경우만 7단어). */
  function chunksOf(text, protect) {
    var toks = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (toks.length < 2) return toks.length ? [toks[0]] : [];
    /* 보호 구간 찾기 — 대소문자·구두점을 벗긴 낱말로 비교 */
    var p0 = -1, p1 = -1;
    if (protect) {
      var pt = String(protect).replace(/\s+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean);
      if (pt.length > 1) {
        for (var i = 0; i + pt.length <= toks.length && p0 < 0; i++) {
          var same = true;
          for (var j = 0; j < pt.length; j++) if (chunkCore(toks[i + j]) !== chunkCore(pt[j])) { same = false; break; }
          if (same) { p0 = i; p1 = i + pt.length; }
        }
      }
    }
    var out = [], cur = [];
    function flush() { if (cur.length) { out.push(cur.join(' ')); cur = []; } }
    toks.forEach(function (t, idx) {
      var w = chunkCore(t), L = cur.length;
      var inB = p0 >= 0 && idx > p0 && idx < p1;      /* 핵심 표현 '안'에서 시작 */
      var atB = p0 >= 0 && idx === p0;                /* 핵심 표현 '첫 단어' */
      if (L) {
        var brk;
        if (inB) brk = false;                         /* 핵심 표현은 어떤 경우에도 가르지 않는다 */
        else if (atB) brk = L >= 2;                   /* 표현 앞에서 끊어 청크 선두로 (한 단어만 남기지 않게) */
        else brk = (CH_CONJ[w] && L >= 2) || (CH_PREP[w] && L >= 2) || (CH_DET[w] && L >= 2) || L >= 5;
        if (brk) flush();
      }
      cur.push(t);
      /* 마침표는 약어(Mr.)와 구분해 실제 문장 끝에서만 끊는다 — 핵심 표현 안의 쉼표도 자르지 않는다 */
      if (/[,;:.!?]$/.test(t) && chunkCore(t).length > 1 && !(p0 >= 0 && idx >= p0 && idx < p1 - 1)) flush();
    });
    flush();
    var merged = [];
    out.forEach(function (c) {
      var last = merged.length - 1;
      if (last >= 0 && c.split(' ').length === 1 && !CH_TAIL[chunkCore(c)] && merged[last].split(' ').length < 6) {
        merged[last] += ' ' + c;
      } else merged.push(c);
    });
    return merged;
  }

  var CH_SPEAK = { token: 0 };

  /* ---------------- 내 발음 녹음 → 원어민과 비교(ELSA·Speak식 쉐도잉) ----------------
     녹음 Blob 은 메모리에만 둔다 — localStorage·IndexedDB·서버 어디에도 쓰지 않고,
     패널이 바뀌면 URL 까지 폐기한다. 권한이 거부되거나 미지원이면 안내만 남기고 깨지지 않는다. */
  var REC = { state: 'idle', mr: null, stream: null, chunks: [], url: '', box: null, timer: 0, started: 0, note: '', gen: 0, trace: [], rate: 0 };
  function recTrace(what, gen) {
    REC.trace.push(what + ':' + gen + '/' + REC.gen);
    if (REC.trace.length > 12) REC.trace.shift();
  }
  /* 늦게 도착한 마이크 응답이 이미 사라진 패널에 글자를 남기지 않게 — 패널이 문서에 있는지도 본다 */
  function recAlive(box, gen) {
    return gen === REC.gen && !!box && document.body.contains(box);
  }

  function recSupport() {
    return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function recStopTracks() {
    if (REC.stream) { try { REC.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    REC.stream = null;
  }

  /* 패널을 다시 그리거나 화면을 떠날 때 — 녹음 중이면 멈추고 Blob URL 을 버린다 */
  function recReset() {
    REC.gen++;                 /* 진행 중이던 녹음의 onstop 결과는 버린다 */
    recTrace('reset');
    clearTimeout(REC.timer);
    REC.timer = 0;
    try { if (REC.mr && REC.mr.state !== 'inactive') REC.mr.stop(); } catch (e) {}
    REC.mr = null;
    recStopTracks();
    REC.chunks = [];
    if (REC.url) { try { URL.revokeObjectURL(REC.url); } catch (e) {} REC.url = ''; }
    REC.state = 'idle';
    REC.box = null;
    REC.note = '';
    REC.started = 0;
  }

  /* 비교 들을 때 원어민 발화 속도 — 0 이면 앱 속도(설정)를 따르고, 1 / 0.75 를 고르면 그 속도로 고정.
     화면을 옴겨도 고른 속도는 유지되지만 저장(localStorage)하지는 않는다 */
  function recRate() { return Number(REC.rate) === 0.75 || Number(REC.rate) === 1 ? Number(REC.rate) : speedRate(); }

  function recPaint(box) {
    box = box || REC.box;
    if (!box) return;
    var rec = box.querySelector('[data-act="rec"]');
    var mine = box.querySelector('[data-act="mine"]');
    var cmp = box.querySelector('[data-act="cmp"]');
    var note = box.querySelector('.rec-note');
    var audio = box.querySelector('.rec-audio');
    var spd = box.querySelector('.cmp-speed');
    var has = !!REC.url;
    if (rec) {
      rec.textContent = REC.state === 'rec' ? '⏹ 멈추기' : (has ? '🎙 다시 녹음' : '🎙 내 발음 녹음');
      rec.classList.toggle('rec-on', REC.state === 'rec');
    }
    if (mine) mine.hidden = !has;
    if (cmp) cmp.hidden = !has;
    if (spd) {
      spd.hidden = !has;
      $$('.cmp-sp', spd).forEach(function (b) {
        b.classList.toggle('active', Number(b.dataset.recp) === recRate());
      });
    }
    if (audio && has && audio.getAttribute('src') !== REC.url) audio.setAttribute('src', REC.url);
    if (note) {
      note.hidden = !REC.note;
      note.textContent = REC.note || '';
    }
  }

  function recStart(box) {
    if (!recSupport()) { toast('이 브라우저는 녹음을 지원하지 않아요'); return; }
    if (REC.state === 'rec') {
      try { REC.mr && REC.mr.stop(); } catch (e) {}
      return;
    }
    /* 새 녹음은 이전 Blob 을 버리고 시작한다 */
    if (REC.url) { try { URL.revokeObjectURL(REC.url); } catch (e) {} REC.url = ''; }
    REC.box = box;
    REC.note = '마이크를 허용해 주세요…';
    recPaint(box);
    var gen = ++REC.gen;
    recTrace('start');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!recAlive(box, gen)) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; }
      REC.stream = stream;
      REC.chunks = [];
      var mr = null;
      try { mr = new MediaRecorder(stream); } catch (e) {
        recStopTracks();
        REC.note = '이 기기에서는 녹음을 만들 수 없어요';
        recPaint(box);
        return;
      }
      REC.mr = mr;
      mr.ondataavailable = function (e) { if (e.data && e.data.size) REC.chunks.push(e.data); };
      mr.onstop = function () {
        if (!recAlive(box, gen)) return;   /* 패널이 바뀌었거나 초기화됐다 — 이 녹음은 버린다 */
        clearTimeout(REC.timer);
        REC.timer = 0;
        recStopTracks();
        var blob = null;
        try { blob = new Blob(REC.chunks, { type: (mr && mr.mimeType) || 'audio/webm' }); } catch (e) { blob = null; }
        REC.chunks = [];
        REC.state = 'idle';
        if (!blob || blob.size < 400) {
          REC.note = '소리가 거의 담기지 않았어요 — 마이크에 조금 더 가까이 대고 다시';
          recPaint(box);
          return;
        }
        try { REC.url = URL.createObjectURL(blob); } catch (e) { REC.url = ''; }
        var secs = Math.max(1, Math.round((Date.now() - REC.started) / 1000));
        REC.note = secs + '초 녹음 · 이 화면에서만 들리고 저장되지 않아요';
        recPaint(box);
        toast('녹음 완료 — ▶ 내 발음으로 들어 보세요');
      };
      REC.started = Date.now();
      REC.state = 'rec';
      try { mr.start(); } catch (e) {
        REC.state = 'idle';
        REC.note = '녹음을 시작하지 못했어요';
        recPaint(box);
        return;
      }
      REC.note = '녹음 중… (최대 8초) 같은 문장을 한 번에 말해 보세요';
      recPaint(box);
      /* 짧은 녹음 — 8초에 자동 종료 */
      REC.timer = setTimeout(function () { try { if (mr.state !== 'inactive') mr.stop(); } catch (e) {} }, 8000);
    }).catch(function (err) {
      recTrace('err');
      if (!recAlive(box, gen)) return;
      REC.state = 'idle';
      recStopTracks();
      var name = err && err.name;
      REC.note = name === 'NotAllowedError' || name === 'SecurityError'
        ? '마이크 권한이 거부됐어요 — 주소창의 자물쇠에서 마이크를 허용한 뒤 다시 눌러 주세요'
        : name === 'NotFoundError' ? '이 기기에서 마이크를 찾지 못했어요' : '마이크를 열 수 없어요 — 원어민 발음만 들어 보세요';
      recPaint(box);
      toast(REC.note);
    });
  }

  function recPlay(box) {
    var audio = box && box.querySelector('.rec-audio');
    if (!audio || !REC.url) return;
    try { audio.currentTime = 0; var p = audio.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  /* 원어민 TTS → 잠깐 쉬고 →내 녹음. 같은 문장을 번갈아 들어 차이를 잡는다.
     속도는 recRate() — 원어민 0.75x 를 고르면 느린 발화와 내 발음을 나란히 들을 수 있다 */
  function recCompare(box, text) {
    if (!REC.url) return;
    if (!speakOk) { recPlay(box); return; }
    try { window.speechSynthesis.cancel(); } catch (e) {}
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = recRate();
    var v = pickVoice();
    if (v) u.voice = v;
    var next = function () { setTimeout(function () { recPlay(box); }, 360); };
    u.onend = next;
    u.onerror = next;
    try { window.speechSynthesis.speak(u); } catch (e) { recPlay(box); }
  }

  /* 청크 패널 — 끊어 보여 주고, 청크를 누르면 그 조각만, ▶는 한 청크씩 이어서.
     protect(카드의 핵심 표현 b)를 넘기면 그 표현은 잘리지 않고 청크 선두에 온다. */
  function chunkPanelHtml(text, protect) {
    var ch = chunksOf(text, protect);
    if (ch.length < 2) return '';
    return '<div class="chk">' +
      '<p class="chk-lbl">끊어 읽기 <span>' + ch.length + '청크</span></p>' +
      '<div class="chk-chips">' + ch.map(function (x, i) {
        return '<button class="chk-chip" data-i="' + i + '">' + escapeHtml(x) + '</button>';
      }).join('') + '</div>' +
      '<div class="chk-acts">' +
      '<button class="ghost-btn small" data-act="seq">▶ 한 청크씩</button>' +
      '<button class="ghost-btn small" data-act="echo">🎵 리듬 따라 말하기</button>' +
      '<button class="ghost-btn small" data-act="all">🔊 전체</button>' +
      '<span class="chk-speed" role="group" aria-label="듣기 속도">' +
      '<button class="chk-sp' + (speedRate() === 1 ? ' active' : '') + '" data-rate="1">🔊 1.0x</button>' +
      '<button class="chk-sp' + (speedRate() === 0.75 ? ' active' : '') + '" data-rate="0.75">🐢 0.75x</button>' +
      '</span></div>' +
      '<div class="chk-rec">' +
      (recSupport()
        ? '<button class="ghost-btn small rec-btn' + (REC.state === 'rec' ? ' rec-on' : '') + '" data-act="rec">' +
          (REC.state === 'rec' ? '⏹ 멈추기' : (REC.url ? '🎙 다시 녹음' : '🎙 내 발음 녹음')) + '</button>' +
          '<button class="ghost-btn small" data-act="mine"' + (REC.url ? '' : ' hidden') + '>▶ 내 발음</button>' +
          '<button class="ghost-btn small" data-act="cmp"' + (REC.url ? '' : ' hidden') + '>↔ 원어민과 비교</button>' +
          '<span class="cmp-speed" role="group" aria-label="원어민 비교 속도"' + (REC.url ? '' : ' hidden') + '>' +
          '<em>원어민</em>' +
          '<button class="cmp-sp' + (recRate() === 1 ? ' active' : '') + '" data-recp="1">1.0x</button>' +
          '<button class="cmp-sp' + (recRate() === 0.75 ? ' active' : '') + '" data-recp="0.75">🐢 0.75x</button>' +
          '</span>' +
          '<audio class="rec-audio" preload="metadata"' + (REC.url ? ' src="' + escapeHtml(REC.url) + '"' : '') + ' hidden></audio>'
        : '<span class="rec-note rec-off">이 브라우저는 녹음을 지원하지 않아요 — 🔊로 원어민 발음을 들어 보세요</span>') +
      '<span class="rec-note"' + (REC.note ? '' : ' hidden') + '>' + escapeHtml(REC.note || '') + '</span>' +
      '</div></div>';
  }

  function speakChunks(list, chips) {
    if (!speakOk) { toast('이 브라우저는 발음 재생을 지원하지 않아요'); return; }
    var token = ++CH_SPEAK.token;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    function mark(k) {
      (chips || []).forEach(function (x, j) { x.classList.toggle('on', j === k); });
    }
    var i = 0;
    (function step() {
      if (token !== CH_SPEAK.token) return;
      if (i >= list.length) { mark(-1); return; }
      mark(i);
      var u = new SpeechSynthesisUtterance(list[i]);
      u.lang = 'en-US';
      u.rate = speedRate();
      var v = pickVoice();
      if (v) u.voice = v;
      var next = function () { if (token !== CH_SPEAK.token) return; i++; setTimeout(step, 260); };
      u.onend = next;
      u.onerror = next;
      try { window.speechSynthesis.speak(u); } catch (e) { mark(-1); }
    })();
  }

  /* 청크 리듬 — 한 청크를 들려주고 그 길이만큼 쉬어 준다. 그 틈에 따라 말한다(ELSA식 리듬 연습).
     버튼을 다시 누르면 멈춘다. */
  function speakEcho(list, chips, btn) {
    if (!speakOk) { toast('이 브라우저는 발음 재생을 지원하지 않아요'); return; }
    var token = ++CH_SPEAK.token;
    try { window.speechSynthesis.cancel(); } catch (e) {}
    function mark(k) { (chips || []).forEach(function (x, j) { x.classList.toggle('on', j === k); }); }
    function label(on) {
      if (!btn) return;
      btn.classList.toggle('on', on);
      btn.textContent = on ? '⏹ 멈추기' : '🎵 리듬 따라 말하기';
    }
    label(true);
    var i = 0;
    (function step() {
      if (token !== CH_SPEAK.token) { label(false); return; }
      if (i >= list.length) { mark(-1); label(false); toast('한 청크씩 다 들었어요 — 같은 리듬으로 말해 보세요'); return; }
      mark(i);
      var u = new SpeechSynthesisUtterance(list[i]);
      u.lang = 'en-US';
      u.rate = speedRate();
      var v = pickVoice();
      if (v) u.voice = v;
      var t = String(list[i] || '');
      var pause = 700 + Math.min(1400, t.length * 55);   /* 그 청크를 따라 말할 틈 */
      var next = function () {
        if (token !== CH_SPEAK.token) { label(false); return; }
        i++;
        setTimeout(step, pause);
      };
      u.onend = next;
      u.onerror = next;
      try { window.speechSynthesis.speak(u); } catch (e) { mark(-1); label(false); }
    })();
  }

  function bindChunkPanel(root, text, protect) {
    var box = root ? root.querySelector('.chk') : null;
    if (!box) return;
    var ch = chunksOf(text, protect);
    var chips = $$('.chk-chip', box);
    chips.forEach(function (b) {
      b.addEventListener('click', function () {
        chips.forEach(function (x) { x.classList.toggle('on', x === b); });
        speak(ch[+b.dataset.i]);
      });
    });
    var seq = box.querySelector('[data-act="seq"]');
    if (seq) seq.addEventListener('click', function () { speakChunks(ch, chips); });
    /* 리듬 따라 말하기 — 듣고 → 쉬고 → 다음 청크. 다시 누르면 멈춤 */
    var echo = box.querySelector('[data-act="echo"]');
    if (echo) echo.addEventListener('click', function () {
      if (echo.classList.contains('on')) {
        CH_SPEAK.token++;
        echo.classList.remove('on');
        echo.textContent = '🎵 리듬 따라 말하기';
        try { window.speechSynthesis.cancel(); } catch (e) {}
        (chips || []).forEach(function (x) { x.classList.remove('on'); });
        return;
      }
      speakEcho(ch, chips, echo);
    });
    var all = box.querySelector('[data-act="all"]');
    if (all) all.addEventListener('click', function () { speak(text); });
    /* 녹음 — 이 패널을 가리키는 대상 문장을 그대로 따라 한다 */
    var rec = box.querySelector('[data-act="rec"]');
    if (rec) rec.addEventListener('click', function () { recStart(box); });
    var mine = box.querySelector('[data-act="mine"]');
    if (mine) mine.addEventListener('click', function () { recPlay(box); });
    var cmp = box.querySelector('[data-act="cmp"]');
    if (cmp) cmp.addEventListener('click', function () { recCompare(box, text); });
    /* 원어민 비교 속도 — 고르는 즉시 그 속도로 비교 재생 */
    $$('.cmp-sp', box).forEach(function (b) {
      b.addEventListener('click', function () {
        REC.rate = Number(b.dataset.recp) === 0.75 ? 0.75 : 1;
        recPaint(box);
        toast(REC.rate === 0.75 ? '🐢 원어민 0.75x → 내 발음 순서로 비교해요' : '🔊 원어민 1.0x → 내 발음 순서로 비교해요');
        recCompare(box, text);
      });
    });
    if (REC.box === box) recPaint(box);
    $$('.chk-sp', box).forEach(function (b) {
      b.addEventListener('click', function () {
        store.settings.speed = Number(b.dataset.rate) === 0.75 ? 0.75 : 1;
        paintSpeed();
        save();
        $$('.chk-sp', box).forEach(function (x) { x.classList.toggle('active', x === b); });
        toast(Number(b.dataset.rate) === 0.75 ? '🐢 0.75x — 청크도 천천히' : '🔊 1.0x — 보통 속도');
      });
    });
  }

  /* 패턴 치환(Lewis의 lexical approach · Speak의 변형 반복): 같은 틀의 [ ] 자리만 바꿔 말한다.
     - 틀은 카드 문장의 빈칸 표현(c.b)에서 뽑고, 앞 단어가 동사·be동사·to일 때만 '쓸 수 있는 틀'로 본다.
     - 자리에 넣을 표현은 ① 검증된 패턴 사전(자주 쓰는 틀) ② 같은 동사·같은 뒤 문맥으로 쓰인
       다른 문장의 표현만 쓴다. 둘 다 없으면 칩 없이 '내 말 넣기'만 — 어색한 영어를 만들지 않는다.
     - v4.3: 틀 사전 38 → 88개(게이트 통과 116문장의 틀 전부, 틀×표현 264문장 검사·육안 검수). */
  /* 검증된 패턴 틀 사전 — 회화 통문장 412개 중 안전 게이트를 통과한 116문장의 틀 88개를 모두 덮는다.
     모든 틀×표현 264문장을 스크립트로 검사(관사 a/an·구두점·중복·길이)하고 육안 검수했다.
     틀에 없는 카드는 아래 patternDrill 이 같은 동사·같은 뒤 문맥으로만 채우거나 칩을 숨긴다. */
  var CH_PATTERN_BANK = {
    "could i get ___?": ["some more water", "a refill", "an extra blanket"],
    "i'd like ___, please.": ["a table for two", "a window seat", "a latte"],
    "actually, i think there's been ___ with my order.": ["a mix-up", "a mistake", "a delay"],
    "can i get ___?": ["a glass of tap water", "a bag", "a tax refund"],
    "did you see ___?": ["the game last night", "my message", "the news"],
    "that's ___, thanks.": ["a great idea", "very kind", "all I need"],
    "do you mind if i ask ___?": ["what you do", "how you heard about us", "where you're from"],
    "i've been trying to ___.": ["eat better", "get more sleep", "save money"],
    "let's ___ soon.": ["catch up", "grab lunch", "get together"],
    "it's ___.": ["nice to finally meet you", "right around the corner", "worth a try"],
    "what do you do ___?": ["for fun", "for a living", "on weekends"],
    "let's ___ sometime.": ["grab a coffee", "do this again", "catch a movie"],
    "i'm ___ for the call.": ["running a bit late", "ready", "a bit early"],
    "let's ___ after lunch.": ["circle back", "talk it through", "pick this up"],
    "let's ___ tomorrow morning.": ["touch base", "run through the numbers", "make a decision"],
    "how was ___?": ["your weekend", "the trip", "your day"],
    "i'm sorry, he's ___ right now.": ["in a meeting", "on another call", "out of the office"],
    "sorry, i think we have ___.": ["a bad connection", "the wrong number", "a small problem"],
    "i'm sorry, i have ___.": ["the wrong number", "a bad connection", "a quick question"],
    "i'm afraid the line is ___.": ["breaking up", "a bit unclear", "cutting out"],
    "i'd like to ___ to friday.": ["change my booking", "move my appointment", "postpone it"],
    "i'm ___, thanks.": ["just looking", "all set", "good for now"],
    "i'm calling to ___.": ["make an appointment", "confirm my booking", "ask about the schedule"],
    "can i get ___, please?": ["a bag", "a receipt", "the check"],
    "i'd like to ___ for tonight.": ["cancel my reservation", "book a table", "add one more person"],
    "could i get ___ on this?": ["a price check", "a discount", "your opinion"],
    "it's ___ around the shoulders.": ["too tight", "a bit loose", "really snug"],
    "i'd like to ___.": ["return these shoes", "add one thing", "book a day tour"],
    "is ___?": ["the tip included", "this seat taken", "tax included"],
    "let's ___ two hours for this.": ["block out", "set aside", "reserve"],
    "can we meet ___?": ["a bit later", "at three", "halfway"],
    "i'll be ___.": ["a few minutes early", "there by six", "a bit late"],
    "let's ___ for next month.": ["set a reminder", "plan something", "find a date"],
    "let's ___ seven instead.": ["make it", "do", "say"],
    "i'd like to ___ by one night.": ["extend my stay", "push it back", "move it"],
    "do i need to ___?": ["take my laptop out", "take it with food", "fill this out"],
    "i'd like to book ___ for tomorrow.": ["a day tour", "a table for four", "a taxi"],
    "we're ___ that evening.": ["fully booked", "out of town", "having dinner with friends"],
    "let's ___ and meet at noon.": ["split the difference", "compromise", "split it down the middle"],
    "let's confirm ___.": ["the day before", "the details", "the time"],
    "is it safe to ___?": ["walk there at night", "drink the tap water", "leave my bag here"],
    "excuse me, i think ___.": ["this is my seat", "you dropped this", "there's a mistake"],
    "sorry, i'm ___ right now.": ["tied up", "in the middle of something", "on my way out"],
    "sorry, that's ___ my thing.": ["not really", "not exactly", "just not"],
    "could i have ___?": ["a moment of your time", "a receipt", "a glass of water"],
    "do you have ___?": ["a map of the city", "a table for two", "any openings tomorrow"],
    "i'm ___, but i'm lost.": ["sorry to bother you", "not from around here", "new here"],
    "i have to ___.": ["cancel our lunch", "get going", "finish this today"],
    "can i take ___?": ["a rain check", "a look at the menu", "a message"],
    "that's ___.": ["one way to see it", "a fair point", "fair enough"],
    "let's hear ___ before deciding.": ["both sides", "the full story", "what they think"],
    "i'd like to ___ for a moment.": ["play devil's advocate", "step back", "take a different angle"],
    "to be honest, i'm ___.": ["not sure that'll work", "not convinced", "worried about the timeline"],
    "how much is ___?": ["a taxi to downtown", "the fare", "a day pass"],
    "how long is ___ in hong kong?": ["the layover", "the stopover", "the flight"],
    "i'd love to, but i'm ___.": ["already booked", "out of town that day", "swamped this week"],
    "i think we're ___.": ["getting off track", "going in circles", "almost out of time"],
    "we're ___.": ["running out of time", "almost done", "ahead of schedule"],
    "i'll send ___ right after this.": ["the summary", "the notes", "the file"],
    "let's ___, shall we?": ["get started", "begin", "get going"],
    "i'm ___ to mina.": ["handing this over", "passing this on", "introducing you"],
    "i just need ___.": ["some time alone", "a minute", "a break"],
    "nothing seems to be ___.": ["going right", "working today", "helping"],
    "i need to ___.": ["get this off my chest", "check my schedule", "refill my prescription"],
    "i'm ___ the second option.": ["leaning towards", "going with", "in favor of"],
    "i've been ___ lately.": ["feeling a bit off", "really busy", "trying to eat better"],
    "i have ___ in an hour.": ["a connecting flight", "a meeting", "a dentist appointment"],
    "what time is ___?": ["the last train", "checkout", "the meeting"],
    "let's ___ in two weeks.": ["schedule a follow-up", "meet again", "touch base"],
    "i feel ___ right here.": ["a sharp pain", "a dull ache", "some pressure"],
    "could i get ___ for this?": ["a refund", "a receipt", "a price check"],
    "to ___, we could reduce the scope.": ["build on that point", "keep it simple", "save time"],
    "i've been ___ since yesterday.": ["feeling dizzy", "running a fever", "feeling nauseous"],
    "i've been ___.": ["under a lot of stress", "really busy", "sleeping badly"],
    "where's ___?": ["the nearest subway station", "the restroom", "gate 14"],
    "how do i get ___?": ["a transit card", "to the airport", "there from here"],
    "i'll have ___.": ["the same thing", "a coffee", "the soup of the day"],
    "work's been ___.": ["keeping me busy", "really hectic", "crazy lately"],
    "let's ___.": ["call it a day", "grab a coffee", "get started"],
    "i'm ___.": ["returning your call", "just checking in", "on my way"],
    "let's ___ for now.": ["table that", "leave it there", "park this"],
    "i'm ___ about it.": ["on the fence", "still thinking", "a bit unsure"],
    "it's okay to ___.": ["not be okay", "ask for help", "take a break"],
    "who's ___?": ["taking notes", "presenting today", "leading this"],
    "we'll have to ___.": ["agree to disagree", "see how it goes", "wait and see"],
    "i think ___.": ["I'm lost", "we took a wrong turn", "this is the wrong stop"],
    "it's been ___.": ["getting worse", "a long week", "like that all day"],
    "you're ___.": ["on mute", "breaking up", "cutting out"]
  };

  /* 2차 사전(v4.4 → v4.5 → v4.6) — 1차의 동사·be·to 규칙으로는 틀을 못 잡는 '조동사+주어' 요청문과
     핵심 빈출 문형 102 → 146 → 226개. 카드 문장의 빈칸 앞이 조동사+주어(Could you ___?)면 자리에는
     서술어가 오므로, 규칙 추론 대신 사람이 슬롯을 하나씩 골라 검수했다(문맥까지 확인).
     생성 문장은 관사 a/an·구두점·인접 중복·프레임 겹침·길이를 스크립트로 전수 검사했고,
     틀은 카드 문장에 실제로 있는 것만 넣었다(죽은 항목 0).
     v4.5 보강 45개는 아직 칩이 없던 회화 문장 중 실제 대화에서 자주 쓰는 요청·약속·여행·진료
     틀을 골랐다(빈칸이 카드의 핵심 표현 b인 관계로 틀 문장이 카드마다 하나씩이다). */
  var CH_PATTERN_BANK2 = {
    "could you ___?": ["open the window", "speak a little slower", "send me the address"],
    "could you ___, please?": ["hold the door", "repeat that", "wait a moment"],
    "could you ___ for me?": ["check the price", "hold the table", "spell your name"],
    "could you speak a little ___?": ["more slowly", "louder", "softer"],
    "could you recommend ___?": ["a good local restaurant", "a quiet cafe", "a nice place to stay"],
    "could you tell me the price ___?": ["per kilo", "for this one", "including tax"],
    "could you write me ___?": ["a prescription", "a receipt", "a quick note"],
    "can i ___?": ["pay by card", "try this on", "have a quick look"],
    "could i get that ___?": ["without onions", "with extra sauce", "to go"],
    "can i get a box for ___?": ["the leftovers", "this cake", "the rest"],
    "can i ___ for a moment?": ["put you on hold", "borrow this", "step outside"],
    "can i ___ on the train?": ["bring my bike", "take my dog", "use my laptop"],
    "could i ___, please?": ["see the menu", "have a glass of water", "get a receipt"],
    "could i ___ here until noon?": ["leave my luggage", "park my car", "wait"],
    "can we ___?": ["split the bill", "start a bit later", "take a short break"],
    "can we ___, please?": ["get the check", "sit by the window", "have a moment"],
    "can we ___ this time?": ["keep it short", "meet halfway", "start early"],
    "can we ___ and come back to it?": ["park that", "set this aside", "move on"],
    "can we schedule ___?": ["a follow-up", "a quick call", "another meeting"],
    "could we ___?": ["sit outside", "talk in private", "start over"],
    "can you ___ on this one?": ["take the lead", "give me a hand", "double-check the numbers"],
    "can you ___ with this?": ["give me a hand", "help me out"],
    "can you ___ at the corner?": ["drop me off", "let me out", "pull over"],
    "can everyone ___?": ["hear me", "see the screen", "open the link"],
    "let me ___.": ["think about it", "confirm the details", "check my schedule"],
    "let me ___ on that.": ["get back to you", "follow up", "check"],
    "please ___.": ["keep me posted", "let me know", "send it over"],
    "do you mind if i ___?": ["join you", "open the window", "take this seat"],
    "do you ___ to talk?": ["have a minute", "have some time", "have a second"],
    "do you have any ___?": ["non-dairy milk", "smaller sizes", "questions"],
    "do you have this ___?": ["in a smaller size", "in black", "in stock"],
    "does this ___?": ["come in another color", "work with cash", "run on weekends"],
    "does this bus ___?": ["go to the old town", "stop at the station", "leave from here"],
    "does this train ___?": ["go downtown", "stop at the next station", "leave on time"],
    "does it ___?": ["hurt here", "come with a warranty", "work without wifi"],
    "is this ___?": ["a good time to talk", "your first visit", "the right platform"],
    "is this ___ for the express?": ["the right platform", "the right line", "the platform"],
    "is it ___?": ["within walking distance", "worth the price", "too late to change"],
    "is there ___?": ["a direct train", "a waiting list", "another option"],
    "is breakfast ___?": ["included in the rate", "served until ten", "extra"],
    "is the station ___?": ["far from here", "near the hotel", "on this line"],
    "is this machine ___?": ["taking cash", "working", "out of order"],
    "how are you ___?": ["holding up", "doing today", "feeling today"],
    "how's everything ___?": ["so far", "going", "today"],
    "how's your day going ___?": ["so far", "today", "for you"],
    "are you ___?": ["from around here", "ready to order", "still working"],
    "are you still ___?": ["serving breakfast", "working here", "coming to dinner"],
    "are you okay? you ___.": ["look pale", "seem tired", "don't look well"],
    "where do i ___?": ["claim my baggage", "pick up my ticket", "pay the fee"],
    "where do i ___ to the beach?": ["catch the bus", "take the subway", "change trains"],
    "where can i find the ___?": ["fitting rooms", "information desk", "ticket machine"],
    "which line ___?": ["goes to the airport", "runs on weekends", "is the fastest"],
    "do i need to come back for ___?": ["a follow-up", "another visit", "the results"],
    "i'll ___.": ["take care of it", "let you know", "sort it out"],
    "i'll ___ on that.": ["get back to you", "follow up", "check back"],
    "i'll ___ at eight.": ["pick you up", "be there", "call you"],
    "i'll ___ in ten minutes.": ["call back", "be ready", "be out"],
    "i'll ___ in cash.": ["pay the rest", "pay for it", "pay"],
    "i'll send you ___ by text.": ["a confirmation", "the address", "the details"],
    "i'd ___.": ["give it a try", "go with that", "say yes"],
    "i think i ___.": ["missed my connection", "left my key inside", "took a wrong turn"],
    "i had ___.": ["a rough day", "a long week", "a late night"],
    "i've had ___ for three days.": ["a sore throat", "a headache", "a bad cough"],
    "i've ___ recently.": ["gained some weight", "started running", "been sleeping badly"],
    "i completely ___.": ["forgot about it", "agree with you", "lost track of time"],
    "i'm afraid i ___.": ["can't make it", "don't have time", "won't be able to"],
    "i'm afraid that ___.": ["won't work for me", "isn't possible", "won't be enough"],
    "i'm running ___.": ["about ten minutes late", "a bit behind", "late today"],
    "i'm not really ___.": ["a morning person", "into spicy food", "a fan of that"],
    "i'm really ___.": ["proud of you", "sorry about that", "looking forward to it"],
    "i'm so ___!": ["happy for you", "proud of you", "glad to hear it"],
    "i'm here for ___.": ["my annual checkup", "a follow-up visit", "a quick check-up"],
    "i'm here ___ for a week.": ["on vacation", "on business", "visiting family"],
    "i'm sorry for ___.": ["keeping you waiting", "the mix-up", "being late"],
    "sorry for calling ___.": ["so late", "at this hour", "out of the blue"],
    "sorry, i didn't ___.": ["catch that", "hear you", "get your name"],
    "i'm feeling ___ now.": ["much better", "a little better", "worse"],
    "i'm glad we ___.": ["ran into each other", "had this talk", "sorted it out"],
    "that's not ___.": ["your fault", "the point", "a big deal"],
    "this isn't ___.": ["the right size", "working properly", "my order"],
    "that's very ___.": ["kind of you", "thoughtful of you", "generous"],
    "that's a bit ___.": ["outside my wheelhouse", "steep", "much"],
    "it's not ___.": ["your fault", "a big deal", "the end of the world"],
    "it's been a ___.": ["crazy week", "long day", "rough month"],
    "this one has ___ on it.": ["a small stain", "a scratch", "a mark"],
    "things will ___.": ["get better", "work out", "be fine"],
    "you might ___ there.": ["have a point", "be right", "be onto something"],
    "the pain ___.": ["comes and goes", "is getting better", "shows up at night"],
    "my suitcase ___.": ["didn't come out", "is missing", "never arrived"],
    "take this ___ for five days.": ["twice a day", "every eight hours", "once a day"],
    "i ___ last year.": ["broke my ankle", "hurt my back", "had surgery"],
    "i ___ after eating.": ["feel nauseous", "get a headache", "feel bloated"],
    "thank you for ___.": ["being there for me", "helping me out", "coming all this way"],
    "thanks for ___, though.": ["thinking of me", "asking", "checking in"],
    "fair enough, i ___.": ["hadn't thought of that", "see your point", "didn't know that"],
    "i take your point, but ___.": ["timing matters", "we're short on time", "the cost is a problem"],
    "any questions before we ___?": ["wrap up", "start", "finish"],
    "let's decide ___.": ["before the meeting", "tomorrow morning", "at the meeting"],
    "let's look at it ___.": ["from another angle", "differently", "one more time"],
    "let's not ___.": ["jump to conclusions", "rush this", "worry yet"],
    "let's agree on ___.": ["the next steps", "a date", "the price"],
    "does saturday ___?": ["work for you", "suit you", "work better"],
    /* v4.5 보강 1 — 아직 칩이 없던 문장 중 요청·약속·길찾기·진료에서 자주 쓰는 틀 25개 */
    "are you ___ friday evening?": ["free on", "available on", "around on"],
    "where can i ___ for the flight to tokyo?": ["check in", "drop my bags", "get a boarding pass"],
    "would you ___ that?": ["mind not doing", "rather not do", "avoid doing"],
    "could you ___ a little?": ["speak up", "slow down", "turn it up"],
    "could you ___ my bag?": ["keep an eye on", "watch", "hold"],
    "can we do it ___ instead?": ["over the phone", "by email", "online"],
    "can we ___ next week?": ["push it to", "move it to", "reschedule for"],
    "sorry i ___.": ["have to run", "need to go", "have to head out"],
    "let me ___ the design team.": ["loop in", "bring in", "brief"],
    "could i ___ mr. kim, please?": ["speak to", "talk to", "be connected to"],
    "could you ___ for a second?": ["give me a hand", "wait", "hold this"],
    "could i ask you ___?": ["a quick question", "a small favor", "something personal"],
    "i see ___.": ["where you're coming from", "your point", "what you mean"],
    "let's ___ six thirty.": ["aim for", "say", "try for"],
    "do you have anything ___?": ["earlier", "later today", "tomorrow morning"],
    "do you have any ___ the holidays?": ["plans for", "plans over", "special plans for"],
    "can you ___ on thursday?": ["cover for me", "take my shift", "join the call"],
    "could you ___ the process?": ["walk me through", "go over", "explain"],
    "could you ___ for her?": ["leave a message", "take a message", "wait"],
    "could you ___ until tomorrow?": ["hold this for me", "keep it", "store this"],
    /* v4.5 보강 2 — 빈칸이 두 단어 이상인 문장 중 대화 빈도가 높은 틀 */
    "can i get a large iced americano ___?": ["to go", "with no ice", "with extra syrup"],
    "i've ___ that place.": ["heard great things about", "heard a lot about", "heard mixed things about"],
    "what ___?": ["are you having", "did you order", "would you like"],
    "i'm ___ taking a short trip.": ["thinking of", "dreaming of", "planning on"],
    "i've got ___ right now.": ["a lot going on", "too much on my plate", "a full week"],
    "i'm still waiting to ___ them.": ["hear back from", "get an answer from", "hear from"],
    "i'll ___ them today.": ["follow up with", "check in with", "catch up with"],
    "what have you ___ lately?": ["been up to", "been doing", "been working on"],
    "i'll need a bit ___.": ["more context", "more time", "more detail"],
    "could you send me that file ___?": ["by tomorrow", "before the meeting", "this afternoon"],
    "sorry, i ___ on that.": ["dropped the ball", "fell behind", "slipped up"],
    "could you ___ for ten minutes?": ["hold the table", "keep the table", "save our seats"],
    "this ___. i'll take two.": ["fits perfectly", "works well", "is just right"],
    "let's leave it for now and ___.": ["confirm tomorrow", "decide next week", "talk it through"],
    "i'd like to ___ a bigger size.": ["exchange this for", "swap this for", "trade this in for"],
    "it was a lovely trip, ___.": ["thanks for everything", "thanks for showing me around", "thanks for having me"],
    "could you ___ it in black?": ["check if you have", "see if you have"],
    "i'm ___ peanuts. does this have any?": ["allergic to", "sensitive to"],
    "do you have ___ a quick coffee?": ["time for", "room for"],
    "i'm still ___, thanks.": ["working on it", "thinking about it", "looking at it"],
    "i'm ___ that show.": ["a big fan of", "not really into", "obsessed with"],
    "are we ___ for tonight?": ["still on", "still good", "still set"],
    "have you seen ___?": ["the news today", "my keys", "this movie"],
    "let's meet ___ the station.": ["in front of", "near", "outside"],
    /* v4.6 보강 — 남은 99문장 중 빈칸이 두 단어 이상이고 요청·진료·여행·전화·회의·위로에서
       실제로 자주 쓰는 틀 80개(칩 문장 283 → 363). 슬롯은 문장 첫머리·중간 어디에 놓여도
       말이 되도록 소문자로만 적고(표시할 때 문장 첫 글자만 대문자), 관사·구두점·인접 중복·
       프레임 겹침·길이를 스크립트로 전수 검사했고 육안으로 문장을 하나씩 읽어 확인했다. */
    "___ sit here?": ["mind if we", "okay if we"],
    "___ opening the window?": ["would you mind", "do you mind"],
    "___ to change the date?": ["would it be possible", "is there any way", "is it possible"],
    "___ you could let me know by friday.": ["it would help if", "it would be great if"],
    "___ how grateful i am.": ["words can't express", "nothing can express"],
    "___, i need to call my mom.": ["that reminds me", "speaking of which"],
    "___, we have no choice.": ["as we see it", "the way things look"],
    "___, we should wait.": ["in my opinion", "if you ask me", "my take is"],
    "___, we should stay flexible.": ["having said that", "that said", "even so"],
    "___, but there's a risk.": ["that's a fair point", "you may be right", "fair enough"],
    "___, that rarely works.": ["from my experience", "in my experience", "in practice"],
    "___, i disagree.": ["with all due respect", "to be honest", "from where we stand"],
    "___, that's three people at seven.": ["just to confirm", "just to double-check", "so to be clear"],
    "___, you're saying the budget is cut.": ["just to confirm", "so to be clear", "if we understand correctly"],
    "___, so let's stop here.": ["time's up", "we're out of time", "that's all for today"],
    "___, please?": ["who's calling", "sorry to keep you waiting"],
    "___. how can i help you?": ["thanks for waiting", "thanks for holding"],
    "___ doing?": ["how's the family", "how's everyone", "how's work"],
    "___ two o'clock at the café?": ["how about", "what about"],
    "___ the train station?": ["is this the way to", "how do we get to", "which bus goes to"],
    "___ the hotel from the airport?": ["how far is", "is it far to"],
    "___ by taxi?": ["how long does it take", "how much is it", "is it faster"],
    "___ is it?": ["how many stops", "how far"],
    "___ now?": ["can you hear me", "are you there", "is this better"],
    "___ sarah?": ["how do you know", "do you know"],
    "___ this cough?": ["how long have you had", "when did you first get"],
    "___ i move my arm.": ["it hurts when", "it stings when", "it aches when"],
    "___, but could i borrow your charger?": ["sorry to bother you", "hate to ask", "this is a bit awkward"],
    "could you ___ tomorrow?": ["remind me", "call me", "text me back"],
    "could you ___ the salt?": ["pass me", "pass", "hand me"],
    "sorry to interrupt. do you ___?": ["have a second", "have a minute", "have a moment"],
    "could you ___ we get there?": ["let me know when", "wake me up when", "tap me when"],
    "could you ___ here, please?": ["pull over", "stop", "let me out"],
    "could you ___ that email?": ["cc me on", "forward me", "send me a copy of"],
    "could you give me ___ that?": ["the reasoning behind", "more detail on", "an example of"],
    "could you speak a little louder? i can't ___.": ["hear you", "hear well", "follow you"],
    "could i have this ___, please?": ["heated up", "wrapped up", "to go"],
    "could we ___ this?": ["compromise on", "talk about", "look at"],
    "don't ___ over it.": ["beat yourself up", "be too hard on yourself"],
    "i'm a little ___ the scan.": ["nervous about", "worried about", "anxious about"],
    "my ___ is in my wallet.": ["insurance card", "health card", "member card"],
    "i'd ___ take antibiotics.": ["rather not", "prefer not to", "try not to"],
    "i'd like to ___ the doctor.": ["make an appointment with", "speak to", "see"],
    "i'm sorry i ___.": ["snapped at you", "kept you waiting", "forgot your birthday"],
    "i'm so sorry ___.": ["for your loss", "for the mix-up", "about the delay"],
    "i'm keeping my ___ for you.": ["fingers crossed", "hopes up"],
    "i'm really ___ this place.": ["going to miss", "gonna miss", "sad to leave"],
    "i'm stuck in traffic, so ___.": ["start without me", "go ahead without me", "don't wait for me"],
    "sorry, my ___.": ["camera isn't working", "mic isn't working", "connection is bad"],
    "sorry, ___.": ["something came up", "something urgent came up", "plans changed"],
    "i bought this last week and ___.": ["it broke", "it stopped working", "the button fell off"],
    "is there ___ this?": ["a warranty on", "a discount on", "a return policy on"],
    "is there ___ the city center?": ["a shuttle to", "a bus to", "a direct train to"],
    "is this gate for ___?": ["the late flight", "the morning flight", "the connecting flight"],
    "let's ___ the next slide.": ["move on to", "go on to", "get to"],
    "let's keep this ___ for now.": ["between us", "off the record", "between you and me"],
    "take your time. ___.": ["there's no rush", "we're not in a hurry"],
    "that ___ to me.": ["doesn't sound right", "doesn't look right", "makes no sense"],
    "we're stuck in ___.": ["a jam", "traffic", "a huge jam"],
    "you did your best, and ___.": ["that counts", "that's enough", "that matters"],
    "cheer up, it's not ___.": ["the end of the world", "the worst thing ever"],
    "excuse me, ___ the museum?": ["how do we get to", "is this the way to", "which way is"],
    "i think the data ___.": ["tells a different story", "points the other way", "says otherwise"],
    "i'll show you some numbers that ___.": ["back this up", "support this", "make the case"],
    "i'll do it ___.": ["as soon as possible", "before the day ends"],
    "i'll ___, thanks.": ["walk from here", "take it from here", "manage from here"],
    "i'll ___ it doesn't happen again.": ["make sure", "make certain"],
    "i'll ___ ten minutes.": ["be there in", "be down in", "be back in"],
    "i'll text you ___.": ["when we land", "when we arrive", "after the meeting"],
    "i'll put you ___.": ["on speaker", "on hold", "through"],
    "can we ___ three?": ["move our meeting to", "move it to", "push it to"],
    "can we ___ to next week?": ["push the deadline", "move the meeting", "postpone it"],
    "can i get ___ tomorrow morning?": ["a ticket for", "a seat for", "two tickets for"],
    "i need to ___ the next stop.": ["get off at", "change at", "get out at"],
    "turn right ___.": ["at the second light", "at the next corner", "after the bridge"],
    "does this bus ___ the market?": ["stop at", "go to", "stop near"],
    "the weather's been awful, ___?": ["hasn't it", "right"],
    "just ___, the client wants changes.": ["a heads-up", "a quick heads-up", "as a heads-up"],
    "i have ___ her.": ["no idea what to get", "no clue what to buy"],
    "anyway, i should ___.": ["get going", "head out", "get back to work"],
  };
  var CH_OBJ_VERB = {};
  ('get have take bring order buy book need want like love try check call send meet start finish open close ' +
    'turn move change miss catch drop fill wrap hold grab split review confirm hear follow mind keep let make ' +
    'do know think feel see go come run sit wait work look find give put help show ask tell say speak pay pick ' +
    'pass write read wear eat drink play stop live stay leave return count')
    .split(' ').forEach(function (w) { CH_OBJ_VERB[w] = 1; });
  var CH_BE_WORD = { 'am': 1, 'is': 1, 'are': 1, 'was': 1, 'were': 1, 'be': 1, 'been': 1, 'being': 1 };
  var CH_PREP_TAIL = { 'for': 1, 'of': 1, 'to': 1, 'with': 1, 'on': 1, 'in': 1, 'at': 1, 'from': 1, 'about': 1, 'by': 1 };
  var CH_PRONOUN_HEAD = { 'her': 1, 'him': 1, 'them': 1, 'me': 1, 'us': 1, 'it': 1 };

  function isBeWord(w) {
    if (!w) return false;
    if (CH_BE_WORD[w]) return true;
    return /(^|')(s|re|m)$/.test(w) || w === "it's" || w === "that's" || w === "there's";
  }

  function patternDrill(c) {
    if (!c || c._lv !== 6 || !c.b) return null;
    var w = String(c.w), b = String(c.b);
    var at = w.toLowerCase().indexOf(b.toLowerCase());
    if (at < 0) return null;
    var before = w.slice(0, at), after = w.slice(at + b.length);
    var frame = before + '___' + after;
    var bToks = b.trim().split(/\s+/).filter(Boolean);
    if (bToks.length < 2) return null;                        /* 자리가 한 단어면 치환 연습이 안 된다 */
    if (frame.trim().split(/\s+/).length < 2) return null;    /* 틀에 맥락이 없으면(문장 전체가 빈칸) 제외 */
    var frameKey = frame.toLowerCase().replace(/\s+/g, ' ').trim();
    /* 0순위: 사람이 검수한 2차 틀 사전. 조동사+주어(Could you ___?)처럼 빈칸이 '서술어'인 틀은
       아래 동사·be·to 규칙으로는 잡히지 않으므로, 이 틀에 한해 슬롯을 사전이 정한다 */
    var bank2 = CH_PATTERN_BANK2[frameKey];
    if (bank2) return { frame: frame, base: b, slots: bank2.slice(0, 3), ko: c.m || '', tier: 2 };
    var headToks = before.trim().split(/\s+/).filter(Boolean);
    var headWord = headToks.length ? chunkCore(headToks[headToks.length - 1]) : '';
    if (!(CH_OBJ_VERB[headWord] || isBeWord(headWord) || headWord === 'to')) return null;
    if (CH_PREP_TAIL[chunkCore(bToks[bToks.length - 1])]) return null;   /* 표현이 전치사로 끝나면 자리로 못 쓴다 */
    var afterToks = after.trim().split(/\s+/).filter(Boolean);
    if (afterToks.length && CH_PRONOUN_HEAD[chunkCore(afterToks[0])]) return null;

    /* ① 검증된 틀 사전 → ② 같은 동사·같은 뒤 문맥으로 쓰인 다른 문장의 표현 → ③ 칩 없음 */
    var bank = CH_PATTERN_BANK[frameKey];
    var slots = bank ? bank.slice(0, 3) : [];
    if (!slots.length) {
      var seen = {};
      seen[b.toLowerCase()] = 1;
      var rows = [];
      (LEVELS[6] || []).forEach(function (x) {
        if (!x || x === c || !x.b || x.t !== c.t) return;
        var bx = String(x.b);
        if (bx.length > 26 || bx.toLowerCase() === b.toLowerCase()) return;
        var ax = String(x.w), xat = ax.toLowerCase().indexOf(bx.toLowerCase());
        if (xat < 0) return;
        var xb = ax.slice(0, xat), xa = ax.slice(xat + bx.length);
        var xh = xb.trim().split(/\s+/).filter(Boolean);
        var xhw = xh.length ? chunkCore(xh[xh.length - 1]) : '';
        if (xhw !== headWord || xa.trim().toLowerCase() !== after.trim().toLowerCase()) return;
        var k = bx.toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        rows.push({ b: bx, r: x.r || 999 });
      });
      rows.sort(function (a, b2) { return a.r - b2.r; });
      slots = rows.slice(0, 3).map(function (x) { return x.b; });
    }
    return { frame: frame, base: b, slots: slots, ko: c.m || '' };
  }

  /* 틀에 고른 표현을 넣은 문장 — 칩을 누를 때마다 바뀐다(입으로 말하기 전에 눈으로 한 번) */
  /* 자리가 문장 첫머리(또는 마침표·물음표 뒤)면 첫 글자를 대문자로 — 틀 사전 슬롯은 소문자로만 적는다 */
  function patSlot(frame, slot) {
    var f = String(frame == null ? '' : frame);
    var s = String(slot == null ? '' : slot);
    var at = f.indexOf('___');
    var head = at < 0 ? '' : f.slice(0, at);
    var atStart = !head.trim() || /[.?!]\s*$/.test(head);
    return (atStart && s) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  function patSentence(frame, slot) {
    var f = String(frame == null ? '' : frame);
    var at = f.indexOf('___');
    var s = patSlot(f, slot);
    return at < 0 ? f + s : f.slice(0, at) + s + f.slice(at + 3);
  }
  function patLiveHtml(frame, slot) {
    var a = String(frame == null ? '' : frame).split('___');
    return escapeHtml(a[0]) + '<u>' + escapeHtml(patSlot(frame, slot)) + '</u>' + escapeHtml(a[1] || '');
  }

  function patternPanelHtml(c) {
    var p = patternDrill(c);
    if (!p) return '';
    return '<div class="pat" data-frame="' + escapeHtml(p.frame) + '">' +
      '<p class="chk-lbl">🔄 패턴 치환 <span>' + escapeHtml(tagOf(c) || '회화') + '</span></p>' +
      '<p class="pat-frame">' + escapeHtml(p.frame).replace('___', '<u>___</u>') + '</p>' +
      (p.slots.length ? '<div class="pat-chips">' + p.slots.map(function (s, i) {
        return '<button class="pat-chip" data-i="' + i + '" data-slot="' + escapeHtml(s) + '">' +
          escapeHtml(s) + '</button>';
      }).join('') + '</div>' : '') +
      '<p class="pat-live"><span>지금 문장</span>' + patLiveHtml(p.frame, p.base) + '</p>' +
      '<div class="pat-acts">' +
      '<button class="ghost-btn small" data-act="say">🔊 방금 문장</button>' +
      (micSupport() ? '<button class="ghost-btn small" data-act="shadow">🎤 따라 말하기</button>' : '') +
      '<button class="ghost-btn small" data-act="own">✏️ 내 말 넣기</button>' +
      '</div>' +
      '<div class="pat-own" hidden><input class="pat-input" type="text" placeholder="내 말 넣기 (예: two coffees)" ' +
      'enterkeyhint="done" autocomplete="off"><button class="ghost-btn small" data-act="ownsay">🔊 듣기</button></div>' +
      '<p class="pat-note" hidden></p>' +
      '<p class="pat-hint">' + (p.slots.length
        ? '칩을 눌러 문장을 듣고, [ ] 자리만 바꿔 입으로 말해 보세요'
        : '이 틀에 내 말을 넣어 문장을 만들어 보세요') + '</p></div>';
  }

  function bindPatternPanel(root, c) {
    var box = root ? root.querySelector('.pat') : null;
    if (!box) return;
    var p = patternDrill(c);
    if (!p) return;
    var frame = box.dataset.frame || p.frame;
    var pick = p.base;
    var chips = $$('.pat-chip', box);
    var live = box.querySelector('.pat-live');
    chips.forEach(function (b) {
      b.addEventListener('click', function () {
        pick = b.dataset.slot;
        chips.forEach(function (x) { x.classList.toggle('on', x === b); });
        if (live) live.innerHTML = '<span>지금 문장</span>' + patLiveHtml(frame, pick);
        speak(patSentence(frame, pick));
      });
    });
    var say = box.querySelector('[data-act="say"]');
    if (say) say.addEventListener('click', function () { speak(patSentence(frame, pick)); });
    var own = box.querySelector('.pat-own');
    var ownBtn = box.querySelector('[data-act="own"]');
    if (ownBtn && own) ownBtn.addEventListener('click', function () {
      own.hidden = !own.hidden;
      if (!own.hidden) {
        ownBtn.textContent = '✏️ 접기';
        var inp = own.querySelector('.pat-input');
        if (inp) inp.focus();
      } else ownBtn.textContent = '✏️ 내 말 넣기';
    });
    var ownSay = box.querySelector('[data-act="ownsay"]');
    if (ownSay && own) ownSay.addEventListener('click', function () {
      var inp = own.querySelector('.pat-input');
      var val = inp ? String(inp.value || '').trim() : '';
      if (!val) { toast('넣고 싶은 말을 먼저 입력해 주세요'); if (inp) inp.focus(); return; }
      speak(patSentence(frame, val));
    });
    var sh = box.querySelector('[data-act="shadow"]');
    var note = box.querySelector('.pat-note');
    if (sh) sh.addEventListener('click', function () {
      shadowTarget(patSentence(frame, pick), sh, note);
    });
  }

  /* ---------------- 테마 ---------------- */
  function applyTheme() {
    var s = store.settings.theme;
    var dark = s ? s === 'dark' : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#10121b' : '#f4f5fa');
  }
  applyTheme();
  $('#themeBtn').addEventListener('click', function () {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    store.settings.theme = dark ? 'light' : 'dark';
    applyTheme(); save();
  });

  /* ---------------- 라우팅 ---------------- */
  var currentTab = 'home';
  function showTab(tab) {
    currentTab = tab;
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + tab; });
    $$('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    var bar = $('#tabbar');
    if (bar) bar.hidden = false;
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (tab === 'home') renderHome();
    if (tab === 'list') renderList(true);
    if (tab === 'stats') renderStats();
    if (tab === 'speak') renderSpeak();
    if (tab === 'chat') renderChatTab();
  }
  function goTab(tab) {
    if (tab === currentTab && $('#view-study').hidden) return;
    showTab(tab);
    pushLayer();
  }
  $$('.tab').forEach(function (b) {
    b.addEventListener('click', function () { goTab(b.dataset.tab); });
  });
  $$('[data-goto]').forEach(function (b) {
    b.addEventListener('click', function () { goTab(b.dataset.goto); });
  });

  /* ---------------- 뒤로가기 2단계 ----------------
   * 퀴즈·말하기·대화방·모달·서브탭 → 1회: 홈으로
   * 홈 루트 → 1회: 토스트, 2초 안에 다시 누르면 종료 */
  var lastBackAt = 0;
  var exiting = false;
  function rearm() {
    try { history.pushState({ app: 1, t: Date.now() }, ''); } catch (e) {}
  }
  function pushLayer() { rearm(); }
  function sheetOpen() { return !$('#sheet').hidden; }
  function inStudy() { return !$('#view-study').hidden; }
  function inSpeakRun() { return !$('#speakRun').hidden; }
  function inChatRoom() { return !$('#chatRoom').hidden; }
  function leaveStudy() {
    recReset();
    S = null;
    showStudy(false);
    showTab('home');
  }
  addEventListener('popstate', function () {
    if (exiting) return;
    if (sheetOpen()) { closeSheet(); rearm(); return; }
    if (inFixRun()) { endFixRun(); rearm(); return; }
    if (inSpeakRun()) { endSpeakRun(); rearm(); return; }
    if (inChatRoom()) { closeChatRoom(); rearm(); return; }
    if (inStudy()) { saveNow(); leaveStudy(); rearm(); return; }
    if (currentTab !== 'home') { showTab('home'); rearm(); return; }
    var now = Date.now();
    if (now - lastBackAt < 2000) {
      exiting = true;
      try { history.back(); } catch (e) {}
      return;
    }
    lastBackAt = now;
    toast('한 번 더 누르면 앱이 종료됩니다');
    rearm();
  });
  rearm();

  /* ---------------- SRS ---------------- */
  function isDue(word) { var r = peek(word); return !!(r && r.st < MASTER_ST && r.due && r.due <= Date.now()); }

  function dueList() {
    var now = Date.now();
    var out = [];
    allCards().forEach(function (c) {
      var r = peek(c.w);
      if (r && r.st < MASTER_ST && r.due && r.due <= now) out.push(c);
    });
    out.sort(function (a, b) { return peek(a.w).due - peek(b.w).due; });
    return out;
  }

  function weakList() {
    var out = [];
    allCards().forEach(function (c) {
      var r = peek(c.w);
      if (r && r.seen > 0 && r.bad > 0 && r.st < MASTER_ST) out.push(c);
    });
    out.sort(function (a, b) { return peek(b.w).bad - peek(a.w).bad; });
    return out;
  }

  function stats() {
    var total = 0, mastered = 0, learning = 0, perLevel = {};
    Object.keys(LEVELS).forEach(function (lv) {
      perLevel[lv] = { total: LEVELS[lv].length, master: 0, learning: 0, studied: 0 };
    });
    allCards().forEach(function (c) {
      var r = peek(c.w);
      total++;
      var pl = perLevel[c._lv];
      if (r && r.st >= MASTER_ST) { mastered++; if (pl) pl.master++; }
      else if (r && r.seen > 0) { learning++; if (pl) pl.learning++; }
    });
    Object.keys(perLevel).forEach(function (lv) {
      perLevel[lv].studied = perLevel[lv].master + perLevel[lv].learning;
    });
    return {
      total: total, mastered: mastered, learning: learning,
      studied: mastered + learning, perLevel: perLevel
    };
  }

  /* ---------------- 학습 모드별 기록 ---------------- */
  /* 오답·정답을 모드(4지선다/빈칸/순서/카드)별로 오늘·누적에 쌓는다 */
  function bumpMode(mode, ok) {
    var m = MODE_LABEL[mode] ? mode : 'quiz';
    var ts = todayStats();
    ts.by = ts.by || {};
    var t = ts.by[m] || (ts.by[m] = { n: 0, ok: 0 });
    t.n++; if (ok) t.ok++;
    store.modes = store.modes || {};
    var c = store.modes[m] || (store.modes[m] = { n: 0, ok: 0 });
    c.n++; if (ok) c.ok++;
  }

  function modeToday(m) {
    var ts = store.stats[todayKey()] || {};
    return ((ts.by || {})[m]) || { n: 0, ok: 0 };
  }

  function modeAll(m) {
    return ((store.modes || {})[m]) || { n: 0, ok: 0 };
  }

  function pctOf(ok, n) { return n ? Math.round(ok / n * 100) : 0; }

  function streak() {
    var n = 0;
    var d = new Date();
    var s0 = store.stats[todayKey(d)];
    if (!s0 || !s0.n) d = new Date(d.getTime() - DAY);
    for (var i = 0; i < 400; i++) {
      var s = store.stats[todayKey(d)];
      if (!s || !s.n) break;
      n++;
      d = new Date(d.getTime() - DAY);
    }
    return n;
  }

  /* ---------------- 홈 ---------------- */
  var drillTag = 'all';

  function drillTags() {
    var comp = (META.levels && META.levels['5'] && META.levels['5'].comp) || {};
    var order = ['구동사', '회화 구문', '구문', '관용구', '연결·논리', '의견·감정', '부탁·제안', '화법·완곡', '사과·문제', '시간·약속', '비즈니스', '일상 청크', '설득·의견'];
    return order.filter(function (k) { return comp[k]; });
  }

  function drillPool() {
    var pool = LEVELS[5] || [];
    if (drillTag === 'all') return pool;
    return pool.filter(function (c) { return (c.t || c.p) === drillTag; });
  }

  function renderDrill() {
    var box = $('#drillTags');
    if (!box) return;
    var tags = drillTags();
    box.innerHTML = '';
    var all = document.createElement('button');
    all.className = 'chip' + (drillTag === 'all' ? ' active' : '');
    all.textContent = '전체 ' + (LEVELS[5].length || 0);
    all.addEventListener('click', function () { drillTag = 'all'; renderDrill(); });
    box.appendChild(all);
    tags.forEach(function (t) {
      var n = (LEVELS[5] || []).filter(function (c) { return (c.t || c.p) === t; }).length;
      if (!n) return;
      var b = document.createElement('button');
      b.className = 'chip' + (drillTag === t ? ' active' : '');
      b.textContent = t + ' ' + n;
      b.addEventListener('click', function () { drillTag = t; renderDrill(); });
      box.appendChild(b);
    });
    var sub = $('#drillSub');
    if (sub) sub.textContent = 'Lv.5 ' + (LEVELS[5].length || 0).toLocaleString() + '개 · ' +
      (drillTag === 'all' ? '구동사·회화 구문·고급 연결어·비즈니스' : drillTag + ' ' + drillPool().length + '개');
  }

  /* ---------------- 실전 회화 통문장 (Lv.6) ---------------- */
  var convTag = 'all';
  var CONV_TAG_ORDER = ['카페·식당', '직장·업무', '회의·발표', '여행·공항', '전화·예약', '쇼핑·결제',
    '감정·위로', '부탁·거절', '의견·반론', '스몰토크·일상', '약속·시간', '병원·몸', '교통·길찾기'];

  function convTags() {
    var comp = (META.levels && META.levels['6'] && META.levels['6'].comp) || {};
    var have = {};
    (LEVELS[6] || []).forEach(function (c) { have[c.t] = 1; });
    var list = CONV_TAG_ORDER.filter(function (t) { return comp[t] || have[t]; });
    Object.keys(comp).forEach(function (t) { if (list.indexOf(t) === -1) list.push(t); });
    return list;
  }

  function convPool() {
    var pool = LEVELS[6] || [];
    if (convTag === 'all') return pool;
    return pool.filter(function (c) { return c.t === convTag; });
  }

  function renderConv() {
    var box = $('#convTags');
    if (!box) return;
    box.innerHTML = '';
    var total = LEVELS[6].length || META.conv || 0;
    var all = document.createElement('button');
    all.className = 'chip' + (convTag === 'all' ? ' active' : '');
    all.textContent = '전체 ' + total;
    all.addEventListener('click', function () { convTag = 'all'; renderConv(); });
    box.appendChild(all);
    var comp = (META.levels && META.levels['6'] && META.levels['6'].comp) || {};
    convTags().forEach(function (t) {
      var n = (LEVELS[6] || []).filter(function (c) { return c.t === t; }).length || comp[t] || 0;
      if (!n) return;
      var b = document.createElement('button');
      b.className = 'chip' + (convTag === t ? ' active' : '');
      b.textContent = t + ' ' + n;
      b.addEventListener('click', function () { convTag = t; renderConv(); });
      box.appendChild(b);
    });
    var sub = $('#convSub');
    if (sub) sub.textContent = 'Lv.6 ' + total.toLocaleString() + '문장 · ' +
      (convTag === 'all' ? '질문–응답 쌍 · 상황 태그 ' + convTags().length + '종' : convTag + ' ' + convPool().length + '문장');
    var m = $('#convMine');
    if (m) {
      var st6 = stats().perLevel[6] || { studied: 0, master: 0 };
      var tot6 = total || 0;
      m.textContent = '학습 ' + st6.studied + '/' + tot6 + ' · 마스터 ' + st6.master +
        (tot6 ? ' (' + Math.round(st6.studied / tot6 * 100) + '%)' : '') +
        (chatFixStats().all ? ' · 교정 ' + chatFixStats().all + '곳' : '');
    }
  }

  function startConv(mode) {
    var pool = convPool();
    if (!pool.length) { toast('회화 문장을 아직 불러오는 중이에요'); return; }
    var use = mode || 'blank';
    var only = pool.filter(function (c) { return eligibleFor(c, use); });
    if (only.length >= 5) pool = only;
    /* 복습 대기 → 아직 안 푼 문장 → 오래 전에 본 문장 → 오늘 푼 문장 순서로 10문제 */
    var queue = makeSet(pool, 'conv');
    S = {
      queue: queue, i: 0, mode: 'conv', answers: [], correct: 0, quizDir: 'm2w',
      lastMode: use,
      label: '회화 문장' + (convTag === 'all' ? '' : ' · ' + convTag) + ' · ' + MODE_LABEL[use]
    };
    uiMode = use;
    store.settings.mode = use;
    save();
    setUiMode(uiMode);
    showStudy(true);
    nextCard();
  }

  function presetObj() { return PRESETS[store.settings.preset] || PRESETS.upper; }
  function orderLabel() { return store.settings.order === 'random' ? '랜덤 출제' : '중요도 순'; }

  function renderHome() {
    var st = stats();
    var due = dueList();
    var weak = weakList();
    var deck = deckTotal();
    $('#dueCount').textContent = due.length;
    var pct = deck ? Math.round(st.studied / deck * 100) : 0;
    $('#ringPct').textContent = pct + '%';
    $('#ring').style.setProperty('--p', pct);
    $('#mTotal').textContent = st.mastered;
    $('#mLearning').textContent = st.learning;
    $('#mStreak').textContent = streak();

    $$('#presetSeg .preset-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.preset === store.settings.preset);
      b.setAttribute('aria-selected', b.dataset.preset === store.settings.preset ? 'true' : 'false');
    });
    $$('#presetPick button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.preset === store.settings.preset);
    });
    $('#presetDesc').textContent = presetObj().desc;
    $$('#modePick .mode-chip').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === store.settings.mode);
    });
    $$('#modePick2 button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === store.settings.mode);
    });

    var left = newLeft();
    var sub;
    if (due.length === 0 && left === 0) sub = '새 카드 몫은 다 봤어요 · 시작하면 복습·안 본 카드로 이어집니다';
    else if (due.length === 0) sub = '새 카드 ' + left + '개 · ' + mixLabel() + ' · ' + orderLabel();
    else sub = '복습 ' + due.length + '개' + (left ? ' · 새 카드 ' + left + '개 · ' + mixLabel() : '') + ' · ' + orderLabel();
    $('#heroSub').textContent = sub;

    var box = $('#levelList');
    box.innerHTML = '';
    [1, 2, 3, 4, 5, 6].forEach(function (lv) {
      var pl = st.perLevel[lv];
      if (!pl) return;
      var p = pl.total ? Math.round(pl.studied / pl.total * 100) : 0;
      var mp = pl.total ? Math.round(pl.master / pl.total * 100) : 0;
      var row = document.createElement('button');
      row.className = 'level-row l' + lv;
      row.innerHTML =
        '<div class="lv-badge l' + lv + '">Lv.' + lv + '</div>' +
        '<div class="lv-mid"><div class="lv-name"><b>' + LEVEL_META[lv].name + '</b>' +
        '<span>' + (LEVEL_META[lv].count || pl.total) + '개' + (LEVEL_META[lv].coverage && lv <= 4 ? ' · 회화 ' + LEVEL_META[lv].coverage : '') + '</span></div>' +
        '<div class="lv-bar"><u style="width:' + p + '%"></u><i style="width:' + mp + '%"></i></div>' +
        '<div class="lv-sub">학습 ' + pl.studied + '/' + pl.total + ' · 마스터 ' + pl.master + '</div></div>' +
        '<span class="lv-pct">' + p + '%<em>진도</em></span>';
      row.addEventListener('click', function () { openLevelSheet(lv); });
      box.appendChild(row);
    });

    $('#weakCount').textContent = weak.length;
    var chips = $('#weakChips');
    chips.innerHTML = '';
    weak.slice(0, 8).forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'weak-chip';
      b.textContent = c.w;
      b.addEventListener('click', function () { openSheet(c); });
      chips.appendChild(b);
    });
    if (!weak.length) chips.innerHTML = '<span class="muted small">아직 오답이 없어요.</span>';
    $('#footNote').textContent = '수록 ' + deckTotal().toLocaleString() + '개 · 단어 5,000 + 구동사·구문 1,000 + 실전 회화 문장 ' +
      ((LEVELS[6] && LEVELS[6].length) || META.conv || 0).toLocaleString();
    renderToday();
    renderDrill();
    renderConv();
    renderResume();
  }

  /* ---------------- 오늘 목표 · 복습 예보 ---------------- */
  /* 벤치마킹(Speak 홈 · Duolingo 스트리크): "지금 어디까지 왔고, 다음은 뭐고, 남은 게 얼마인지"를
     홈 첫 화면에서 바로 보이게 한다. 값은 모두 이미 저장된 학습 기록에서 계산한다. */
  function renderGoal() {
    var box = $('#goalBox');
    if (!box) return;
    var goal = dailyGoal();
    var n = todayStats().n || 0;
    var p = Math.min(100, Math.round(n / goal * 100));
    $('#goalLbl').textContent = '오늘 목표 ' + goal + '문제';
    $('#goalVal').textContent = n + ' / ' + goal;
    $('#goalBar').style.width = p + '%';
    box.classList.toggle('done', n >= goal);
    var left = Math.max(0, goal - n);
    $('#goalNote').textContent = n >= goal
      ? '오늘 목표 달성 · 이어서 해도 좋아요'
      : (left <= SET_SIZE ? '한 세트(10문제)면 오늘 목표 — ' + left + '문제 남았어요' : '10문제면 약 3분 · ' + left + '문제 남았어요');
  }

  function renderForecast() {
    var box = $('#forecast');
    if (!box) return;
    var now = Date.now();
    var d0 = dayStart();
    var endToday = d0 + DAY, endTomorrow = d0 + 2 * DAY, endWeek = d0 + 7 * DAY;
    var b = { now: 0, today: 0, tomorrow: 0, week: 0 };
    Object.keys(store.cards || {}).forEach(function (k) {
      var r = store.cards[k];
      if (!r || r.st >= MASTER_ST || !r.due) return;
      if (r.due <= now) b.now++;
      else if (r.due < endToday) b.today++;
      else if (r.due < endTomorrow) b.tomorrow++;
      else if (r.due < endWeek) b.week++;
    });
    if (!b.now && !b.today && !b.tomorrow && !b.week) {
      box.innerHTML = '<span class="fc-lbl">복습 예보</span><span class="fc-chip">아직 예약된 복습이 없어요 — 한 세트 풀면 생깁니다</span>';
      return;
    }
    box.innerHTML = '<span class="fc-lbl">복습 예보</span>' +
      '<span class="fc-chip' + (b.now ? ' hot' : '') + '">지금 <b>' + b.now + '</b></span>' +
      '<span class="fc-chip">오늘 <b>' + b.today + '</b></span>' +
      '<span class="fc-chip">내일 <b>' + b.tomorrow + '</b></span>' +
      '<span class="fc-chip">이번 주 <b>' + b.week + '</b></span>';
  }

  /* ---------------- 오늘의 학습 · 모드별 기록 ---------------- */
  function renderToday() {
    var ts = todayStats();
    var st = stats();
    var deck = deckTotal();
    var n = ts.n || 0;
    $('#tTodayN').textContent = n;
    $('#tTodayAcc').textContent = n ? '정답률 ' + pctOf(ts.ok || 0, n) + '%' : '아직 기록 없음';
    $('#tTodayNew').textContent = '새 카드 ' + (ts.nw || 0) + '개';
    var box = $('#modeTable');
    if (box) {
      box.innerHTML = MODE_KEYS.map(function (m) {
        var t = modeToday(m), a = modeAll(m);
        var w = n ? Math.round(t.n / n * 100) : 0;
        return '<div class="mode-row">' +
          '<span class="mode-name">' + MODE_ICON[m] + ' <b>' + MODE_LABEL[m] + '</b></span>' +
          '<span class="mode-bar"><i class="' + m + '" style="width:' + w + '%"></i></span>' +
          '<span class="mode-today">오늘 <b>' + t.n + '</b>' + (t.n ? ' · ' + pctOf(t.ok, t.n) + '%' : '') + '</span>' +
          '<span class="mode-all">누적 ' + a.n + '</span></div>';
      }).join('');
    }
    var sp = deck ? Math.round(st.studied / deck * 100) : 0;
    $('#todayBar').style.width = sp + '%';
    $('#todayProg').textContent = '전체 진도 ' + st.studied.toLocaleString() + ' / ' + deck.toLocaleString() +
      ' (' + sp + '%) · 마스터 ' + st.mastered.toLocaleString() + '개';
    renderGoal();
    renderForecast();
  }

  function setPreset(p) {
    if (!PRESETS[p]) return;
    store.settings.preset = p;
    store.settings.level = 0;
    $('#levelPick').value = '0';
    save();
    renderHome();
    toast(presetObj().label + ' 프리셋 · ' + PRESETS[p].sub + ' 출제');
  }
  $$('#presetSeg .preset-btn').forEach(function (b) {
    b.addEventListener('click', function () { setPreset(b.dataset.preset); });
  });
  $$('#presetPick button').forEach(function (b) {
    b.addEventListener('click', function () { setPreset(b.dataset.preset); });
  });

  $$('#modePick .mode-chip').forEach(function (b) {
    b.addEventListener('click', function () {
      store.settings.mode = b.dataset.mode;
      save();
      $$('#modePick .mode-chip').forEach(function (x) { x.classList.toggle('active', x === b); });
      $$('#modePick2 button').forEach(function (x) { x.classList.toggle('active', x.dataset.mode === store.settings.mode); });
      toast(MODE_LABEL[b.dataset.mode] + '로 시작해요');
    });
  });
  $$('#modePick2 button').forEach(function (b) {
    b.addEventListener('click', function () {
      store.settings.mode = b.dataset.mode;
      save();
      $$('#modePick2 button').forEach(function (x) { x.classList.toggle('active', x === b); });
      $$('#modePick .mode-chip').forEach(function (x) { x.classList.toggle('active', x.dataset.mode === store.settings.mode); });
    });
  });

  $('#startBtn').addEventListener('click', function () { startSession('mix'); });
  $('#startWeakBtn').addEventListener('click', function () { startSession('weak'); });
  $('#startNewBtn').addEventListener('click', function () { startSession('new'); });
  $('#weakGo').addEventListener('click', function () { startSession('weak'); });

  $$('.drill-btn').forEach(function (b) {
    b.addEventListener('click', function () { startDrill(b.dataset.drill); });
  });
  $$('.conv-btn').forEach(function (b) {
    b.addEventListener('click', function () { startConv(b.dataset.conv); });
  });

  /* ---------------- 세션 ---------------- */
  var S = null;
  var current = null;
  var answered = false;
  var CUR_OPTS = [];      /* 지금 문제의 보기 [{v, note}] — 해설에 보기별 뜻을 붙인다 */
  var CUR_ANSWER = '';
  var uiMode = 'quiz';
  var curMode = 'quiz';   /* 지금 매기고 있는 학습 모드 — 모드별 기록의 기준 */

  function mixWeights() {
    return store.settings.includeBasic ? MIX_BASIC : presetObj().mix;
  }

  /* ---------- 세트 짜기 — 같은 카드가 다음 세트에 또 나오지 않게 ----------
     우선순위: ① 복습 대기(due <= now, 오래된 순)
               ② 한 번도 안 푼 카드 — 배열 순서 = 회화 빈도·중요도 순
               ③ 오래 전에 본 카드(가장 오래된 순 = 2회차 순환)
               ④ 오늘 이미 푼 카드(먼저 푼 순) — 정말 풀 카드가 없을 때만
     한 세트 안에서 같은 카드는 한 번만 담는다. */
  function dayStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function lastTouched(r) {
    return Math.max((r && r.t) || 0, (r && r.sp) || 0);
  }

  function setRank(pool) {
    var d0 = dayStart();
    var rows = pool.map(function (c, i) {
      var r = peek(c.w);
      return {
        c: c, i: i,
        done: r && lastTouched(r) >= d0 ? 1 : 0,
        seen: r && r.seen ? 1 : 0,
        t: lastTouched(r)
      };
    });
    rows.sort(function (a, b) {
      return (a.done - b.done) || (a.seen - b.seen) || (a.t - b.t) || (a.i - b.i);
    });
    return rows.map(function (x) { return x.c; });
  }

  /* 프리셋(또는 고른 단계)의 카드 전체 — 단계마다 중요도 위치를 정규화해 섞는다 */
  function stagePool() {
    var lvPref = +store.settings.level;
    if (lvPref) return (LEVELS[lvPref] || []).slice();
    var arr = [];
    mixWeights().forEach(function (m) {
      var lv = LEVELS[m.lv] || [];
      lv.forEach(function (c) { arr.push({ c: c, p: (c._i + 0.5) / Math.max(1, lv.length), w: m.w }); });
    });
    arr.sort(function (a, b) { return (a.p - b.p) || (b.w - a.w); });
    return arr.map(function (x) { return x.c; });
  }

  /* 풀 하나로 10문제 세트 짜기 — 복습 대기 먼저, 나머지는 setRank 순서 */
  function makeSet(pool, kind) {
    var queue = [];
    var used = {};
    function push(c, k) {
      if (!c || queue.length >= SET_SIZE) return;
      var key = String(c.w).toLowerCase();
      if (used[key]) return;
      used[key] = 1;
      queue.push({ c: c, kind: k || kind });
    }
    pool.filter(function (c) { return isDue(c.w); })
      .sort(function (a, b) { return peek(a.w).due - peek(b.w).due; })
      .forEach(function (c) { push(c, 'due'); });
    var rest = setRank(pool);
    if (store.settings.order === 'random') rest = shuffle(rest);
    rest.forEach(function (c) { push(c, kind); });
    return queue;
  }

  function pickNew(limit) {
    var lvPref = +store.settings.level;
    var out = [];
    var seen = {};
    function take(lv, n, hard) {
      if (n <= 0) return 0;
      var arr = LEVELS[lv] || [];
      if (!arr.length) return 0;
      /* hard: 그 단계에서 중요한 상위 60% 안에서만 (앞쪽 = 회화 빈도 상위) */
      var top = hard ? Math.ceil(arr.length * 0.6) : arr.length;
      var pool = arr.filter(function (c, i) {
        var r = peek(c.w);
        return (!r || !r.seen) && !seen[c.w.toLowerCase()] && i < top;
      });
      if (store.settings.order === 'random') shuffle(pool);
      var got = pool.slice(0, n);
      got.forEach(function (c) { seen[c.w.toLowerCase()] = 1; });
      out = out.concat(got);
      return got.length;
    }
    if (lvPref) { take(lvPref, limit); return out.slice(0, limit); }

    var mix = mixWeights();
    var totalW = mix.reduce(function (s, m) { return s + m.w; }, 0);
    var quotas = mix.map(function (m) {
      var exact = limit * m.w / totalW;
      var n = Math.floor(exact);
      return { lv: m.lv, w: m.w, hard: m.hard, n: n, frac: exact - n };
    });
    var used = quotas.reduce(function (s, q) { return s + q.n; }, 0);
    var order = quotas.slice().sort(function (a, b) { return b.frac - a.frac || b.w - a.w; });
    for (var i = 0; used < limit; i++) { order[i % order.length].n++; used++; }

    var short = 0;
    quotas.forEach(function (q) { short += q.n - take(q.lv, q.n, q.hard); });
    if (short > 0) {
      quotas.slice().sort(function (a, b) { return b.w - a.w; }).forEach(function (q) {
        if (short > 0) short -= take(q.lv, short, q.hard);
      });
    }
    return out.slice(0, limit);
  }

  function setUiMode(m) {
    uiMode = m;
    $$('#modeSwitch .seg').forEach(function (b) { b.classList.toggle('active', b.dataset.mode === m); });
    if (S && S.i < S.queue.length) renderQuestion(S.queue[S.i].c);
  }

  function eligibleFor(c, mode) {
    if (mode === 'blank') return !!blankOf(c);
    if (mode === 'order') return !!orderOf(c);
    return true;
  }

  function startSession(mode) {
    var due = dueList();
    var weak = weakList();
    var news = pickNew(newLeft());
    var queue = [];
    var used = {};
    function push(c, kind) {
      var k = c.w.toLowerCase();
      if (used[k]) return;
      used[k] = 1;
      queue.push({ c: c, kind: kind });
    }

    if (mode === 'weak') {
      if (!weak.length) { toast('오답 노트가 비어 있어요'); return; }
      /* ① 10분이 지나 다시 물어볼 때가 된 오답(오래된 순) → ② 오답이 많은 순
         — 방금 틀린 카드(due 전)는 뒤로 밀려 즉시 반복되지 않는다 */
      var nowW = Date.now();
      function dueNow(w) {
        var r = peek(w);
        return !!(r && r.st < MASTER_ST && r.due && r.due <= nowW);
      }
      weak.slice().sort(function (a, b) {
        var ra = peek(a.w), rb = peek(b.w);
        return ((dueNow(b.w) ? 1 : 0) - (dueNow(a.w) ? 1 : 0)) ||
          ((rb.bad || 0) - (ra.bad || 0)) || (lastTouched(ra) - lastTouched(rb));
      }).slice(0, SET_SIZE).forEach(function (c) { push(c, 'weak'); });
      /* 오답이 10개보다 적으면 아직 안 푼 카드로 채운다 */
      if (queue.length < SET_SIZE) setRank(stagePool()).forEach(function (c) { push(c, 'weak'); });
    } else if (mode === 'new') {
      news.slice(0, SET_SIZE).forEach(function (c) { push(c, 'new'); });
      /* 오늘 몫이 10개보다 적어도 세트는 10문제 — 아직 안 푼 카드로 채운다 */
      if (queue.length < SET_SIZE) pickNew(SET_SIZE).forEach(function (c) { push(c, 'new'); });
      if (!queue.length) { toast('새 카드가 없어요. 모든 카드를 한 번씩은 봤어요'); return; }
    } else {
      /* ① 오늘 복습 대기 → ② 오늘 몫 새 카드 → ③ 아직 안 푼 카드(중요도 순) → ④ 오래 전에 본 카드 */
      due.slice(0, SET_SIZE).forEach(function (c) { push(c, 'due'); });
      if (queue.length < SET_SIZE) news.slice(0, SET_SIZE).forEach(function (c) { push(c, 'new'); });
      if (queue.length < SET_SIZE) pickNew(SET_SIZE).forEach(function (c) { push(c, 'new'); });
      if (queue.length < SET_SIZE) setRank(stagePool()).forEach(function (c) { push(c, 'review'); });
      if (!queue.length) { toast('학습할 카드가 없어요. 모든 카드를 마스터했어요!'); return; }
      /* 한 세트는 10문제 — 복습이 먼저, 모자라면 새 카드로 채운다 */
      if (queue.length > SET_SIZE) queue = queue.slice(0, SET_SIZE);
    }

    /* 고른 방식으로 낼 수 있는 카드를 앞에 — 뒤에는 4지선다 대체 카드가 남는다 */
    var chosen = store.settings.mode;
    if (chosen === 'blank' || chosen === 'order') {
      var can = queue.filter(function (q) { return eligibleFor(q.c, chosen); });
      var cannot = queue.filter(function (q) { return !eligibleFor(q.c, chosen); });
      queue = can.concat(cannot);
    }
    S = { queue: queue, i: 0, mode: mode, answers: [], correct: 0, quizDir: store.settings.dir, label: MODE_LABEL[store.settings.mode] || '학습' };
    uiMode = store.settings.mode;
    setUiMode(uiMode);
    showStudy(true);
    nextCard();
  }

  /* 구문 집중 드릴 — Lv.5(또는 태그)만 몰아서 */
  function startDrill(mode) {
    var pool = drillPool();
    if (!pool.length) { toast('해당 구문이 없어요'); return; }
    var only = pool.filter(function (c) { return eligibleFor(c, mode); });
    if (only.length >= 5) pool = only;
    /* 복습 대기 → 아직 안 푼 구문 → 오래 전에 본 구문 → 오늘 푼 구문 순서로 10문제 */
    var queue = makeSet(pool, 'drill');
    S = { queue: queue, i: 0, mode: 'drill', answers: [], correct: 0, quizDir: store.settings.dir, lastMode: mode || 'blank', label: (drillTag === 'all' ? '구문 드릴' : drillTag) + ' · ' + MODE_LABEL[mode || 'blank'] };
    uiMode = mode || 'blank';
    store.settings.mode = uiMode;
    save();
    setUiMode(uiMode);
    showStudy(true);
    nextCard();
  }

  function showStudy(on) {
    $$('.view').forEach(function (v) { v.hidden = on ? v.id !== 'view-study' : v.id !== 'view-' + currentTab; });
    var bar = $('#tabbar');
    if (bar) bar.hidden = !!on;
    if (on) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      pushLayer();
    }
  }

  /* 중간에 나가도 '푼 만큼'과 '남은 위치'를 남긴다 */
  function persistSession() {
    if (!S) return;
    store.session = {
      words: S.queue.map(function (q) { return q.c.w; }),
      kinds: S.queue.map(function (q) { return q.kind; }),
      i: (S.answeredAt != null ? S.answeredAt : S.i), mode: S.mode, label: S.label, ui: uiMode,
      dir: S.quizDir, at: Date.now(), n: S.answers.length, ok: S.correct,
      lv: S.stageLv || 0, lm: S.lastMode || ''
    };
    saveNow();
  }

  function resumeSession() {
    var st = store.session;
    if (!st || !st.words || st.i >= st.words.length) { store.session = null; return false; }
    var queue = [];
    st.words.forEach(function (w, i) {
      var c = cardByW(w);
      if (c) queue.push({ c: c, kind: (st.kinds && st.kinds[i]) || 'resume' });
    });
    if (!queue.length) { store.session = null; return false; }
    S = {
      queue: queue, i: Math.min(st.i || 0, queue.length), mode: st.mode || 'mix',
      answers: [], correct: 0, quizDir: st.dir || store.settings.dir, label: st.label || '이어서',
      stageLv: st.lv || 0, lastMode: st.lm || ''
    };
    uiMode = MODE_LABEL[st.ui] ? st.ui : (st.ui === 'conv' ? 'blank' : (store.settings.mode || 'quiz'));
    if (st.ui === 'conv') uiMode = 'blank';
    store.session = null;
    setUiMode(uiMode);
    showStudy(true);
    pushLayer();
    nextCard();
    return true;
  }

  function nextCard() {
    if (!S) return;
    if (S.i >= S.queue.length) { endSession(); return; }
    recReset();   /* 카드가 넘어가면 앞 카드에서 만든 녹음·안내는 즉시 버린다 */
    var item = S.queue[S.i];
    current = item.c;
    if (S.combo == null) S.combo = 0;
    if (S.best == null) S.best = 0;
    $('#studyProgress').style.width = Math.round(S.i / Math.max(1, S.queue.length) * 100) + '%';
    $('#studyCounter').textContent = (S.i + 1) + '/' + S.queue.length;
    renderQuestion(current);
    paintStudyMeta();
    autoSayCard(current);
    var ms = $('#modeSwitch');
    if (ms) ms.hidden = false;
  }

  /* 세션 진행 도트 + 연속 정답 콤보 — 한 문제마다 눈에 보이는 보상(Duolingo식)
     도트는 문제 객체에 직접 표시를 남겨, 오답 재삽입으로 순서가 밀려도 어긋나지 않는다 */
  function paintStudyMeta() {
    var box = $('#studyDots');
    if (box) {
      var html = '';
      var isRcl = !!(S && S.mode === 'recall');
      (S ? S.queue : []).forEach(function (q, i) {
        var cls = 'dot' + (isRcl ? ' rcl' : '');
        if (q.mark === 2) cls += ' ok';
        else if (q.mark === 0) cls += ' no';
        else if (i === S.i) cls += ' cur';
        html += '<i class="' + cls + '"></i>';
      });
      box.innerHTML = html;
    }
    var rp = $('#recallPill');
    if (rp) {
      var on = !!(S && S.mode === 'recall');
      rp.hidden = !on;
      if (on) rp.textContent = '🔁 회수 ' + (S.answers.length || 0) + '/' + S.queue.length;
    }
    var pill = $('#comboPill');
    if (pill) {
      var n = S && S.combo ? S.combo : 0;
      pill.hidden = n < 2;
      pill.textContent = '🔥 ' + n;
      pill.classList.toggle('hot', n >= 4);
    }
  }

  /* 설정에서 켜면 문제가 뜰 때 발음을 바로 들려준다 (Speak식 듣기 우선) */
  function autoSayCard(c) {
    if (!store.settings.autoSay || !speakOk || !c) return;
    clearTimeout(autoSayCard._t);
    autoSayCard._t = setTimeout(function () {
      if (S && current === c && !answered) speak(c.w);
    }, 340);
  }

  /* ---- 현재 카드에 쓸 수 있는 모드 ---- */
  function effMode(c) {
    if (uiMode === 'card') return 'card';
    if (uiMode === 'blank') return blankOf(c) ? 'blank' : 'quiz';
    if (uiMode === 'order') return orderOf(c) ? 'order' : 'quiz';
    return 'quiz';
  }

  function srsInfo(c) {
    var r = peek(c.w);
    if (!r || !r.seen) return '새 카드';
    if (r.st >= MASTER_ST) return '마스터 · 60일+ 유지';
    if (r.st === 0) return '오답 복습 · 10분 뒤 다시';
    return '다음 복습: ' + STAGE_LABEL[r.st] + ' · 연속 ' + r.st + '회';
  }

  function tagOf(c) { return c.t || (c._lv === 5 ? (c.p || '회화 구문') : ''); }

  function renderQuestion(c) {
    var m = effMode(c);
    curMode = m;
    answered = false;
    $('#feedback').hidden = true;
    $('#quizCard').hidden = m !== 'quiz';
    $('#blankCard').hidden = m !== 'blank';
    $('#orderCard').hidden = m !== 'order';
    $('#cardBox').hidden = m !== 'card';
    $('#resultBox').hidden = true;
    $('#quizBox').hidden = m === 'card';
    if (m === 'card') { renderFlash(c); return; }
    if (m === 'blank') { renderBlank(c); return; }
    if (m === 'order') { renderOrder(c); return; }
    renderQuiz(c);
  }

  /* 보기 하나가 무슨 뜻인지 — 오답 선지까지 뜻을 보여주기 위한 계산 */
  function optionNote(v, c, dir) {
    if (dir === 'w2m') {
      if (v === c.m) return '이 표현의 뜻';
      var lv = LEVELS[c._lv] || [];
      for (var i = 0; i < lv.length; i++) {
        if (lv[i].m === v && lv[i].w !== c.w) return '「' + lv[i].w + '」의 뜻';
      }
      return '다른 단어의 뜻';
    }
    var card = cardByW(v);
    if (card) return card.m;
    return '';
  }

  function optListHtml() {
    if (!CUR_OPTS.length) return '';
    var rows = CUR_OPTS.map(function (o) {
      var right = String(o.v) === String(CUR_ANSWER);
      return '<li class="' + (right ? 'right' : '') + '">' +
        '<span class="ol-key">' + o.letter + '</span>' +
        '<span class="ol-v">' + escapeHtml(o.v) + '</span>' +
        (o.note ? '<span class="ol-n">' + escapeHtml(o.note) + '</span>' : '') +
        (right ? '<span class="ol-tag">정답</span>' : '') + '</li>';
    }).join('');
    return '<div class="fb-opts"><p class="fb-lbl">보기별 뜻</p><ul>' + rows + '</ul></div>';
  }

  /* ---------------- 4지선다 ---------------- */
  function renderQuiz(c) {
    var dir = S.quizDir || 'w2m';
    var lv = c._lv;
    var answer;
    var tag = tagOf(c);
    var fallback = uiMode === 'blank' ? '4지선다로 대체 · ' : uiMode === 'order' ? '4지선다로 대체 · ' : '';
    if (dir === 'w2m') {
      answer = c.m;
      $('#quizTag').textContent = fallback + (c._lv === 5 ? (tag + ' · ') : '') + '이 표현의 뜻은?';
      $('#quizWord').textContent = c.w;
      $('#quizPhon').textContent = c.ph || '';
      $('#quizSpeak').hidden = !speakOk;
    } else {
      answer = c.w;
      $('#quizTag').textContent = fallback + '이 뜻에 맞는 표현은?';
      $('#quizWord').textContent = c.m;
      $('#quizPhon').textContent = c.p || '';
      $('#quizSpeak').hidden = true;
    }
    var qw = $('#quizWord');
    var longText = c._lv === 6 || c.w.length > 26 || c.m.length > 26;
    qw.classList.toggle('sentence', longText);
    qw.style.fontSize = longText ? '' : (dir === 'w2m' ? (c.w.length > 14 ? '24px' : '30px') : (c.m.length > 16 ? '22px' : '28px'));
    $('#quizSrs').textContent = srsInfo(c);

    var seenVal = {};
    seenVal[answer] = 1;
    var distract = [];
    var pool = shuffle((LEVELS[lv] || []).filter(function (x) { return x.w !== c.w; }));
    for (var pi = 0; pi < pool.length && distract.length < 3; pi++) {
      var v = dir === 'w2m' ? pool[pi].m : pool[pi].w;
      if (v && !seenVal[v]) { seenVal[v] = 1; distract.push(v); }
    }
    var uniq = shuffle(distract.concat([answer]));
    var box = $('#quizOptions');
    box.innerHTML = '';
    var letters = ['A', 'B', 'C', 'D'];
    CUR_ANSWER = answer;
    CUR_OPTS = [];
    uniq.forEach(function (opt, i) {
      var b = document.createElement('button');
      b.className = 'opt';
      b.dataset.val = opt;
      b.innerHTML = '<span class="key">' + letters[i] + '</span><span>' + escapeHtml(opt) + '</span>';
      b.addEventListener('click', function () { answerQuiz(b, opt, answer, c, dir); });
      box.appendChild(b);
      CUR_OPTS.push({ letter: letters[i], v: opt, note: optionNote(opt, c, dir) });
    });
    $('#quizSpeak').onclick = function (e) { e.stopPropagation(); speak(c.w); };
    var exq = $('#quizExample');
    if (exq) {
      exq.hidden = false;
      $('#quizExBtn').onclick = function (e) { e.stopPropagation(); speakExample(c); };
      $('#quizExBtnSlow').onclick = function (e) { e.stopPropagation(); speakExample(c, true); };
    }
  }

  function answerQuiz(btn, picked, answer, c, dir) {
    if (answered) return;
    answered = true;
    var ok = picked === answer;
    $$('#quizOptions .opt').forEach(function (b) {
      b.disabled = true;
      if (b.dataset.val === answer) b.classList.add('correct');
      else if (b === btn && !ok) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    grade(c, ok ? 2 : 0);
    var rr = peek(c.w);
    var nextDue = rr.st >= MASTER_ST ? '마스터 (60일+)' : STAGE_LABEL[rr.st];
    var body =
      '<div class="fb-ex"><p class="en">' + escapeHtml(c.e || '') + '</p><p class="ko">' + escapeHtml(c.k || '') + '</p></div>';
    if (!ok) {
      var pickC = dir === 'w2m' ? null : cardByW(picked);
      var line = dir === 'w2m'
        ? '고른 보기 「' + picked + '」는 다른 뜻입니다. 이 카드는 「' + answer + '」.'
        : '고른 보기 「' + picked + '」의 뜻은 ' + (pickC ? '「' + pickC.m + '」' : '다른 뜻') + '입니다.';
      body += '<p class="fb-nuance">' + escapeHtml(line) + '</p>';
    }
    if (c._lv === 6) {
      body += '<div class="fb-mean"><span class="pill small">' + escapeHtml(tagOf(c) || '') + '</span>' +
        '<span class="pill small">정답 「' + escapeHtml(c.w) + '」 = ' + escapeHtml(c.m) + '</span></div>';
      if (c.x) body += '<p class="fb-nuance">핵심: ' + escapeHtml(c.x) + '</p>';
    }
    showFeedback(ok, body, c, rr, nextDue);
    if (!ok && speakOk) speak(c.w);
  }

  /* ---------------- 빈칸 채우기 ---------------- */
  var IRREG = {
    get: ['got', 'gotten'], come: ['came'], make: ['made'], give: ['gave', 'given'], tell: ['told'],
    meet: ['met'], begin: ['began', 'begun'], buy: ['bought'], spend: ['spent'], lose: ['lost'],
    sit: ['sat'], stand: ['stood'], grow: ['grew', 'grown'], take: ['took', 'taken'], see: ['saw', 'seen'],
    say: ['said'], go: ['went', 'gone'], do: ['did', 'done'], have: ['had'], know: ['knew', 'known'],
    think: ['thought'], find: ['found'], feel: ['felt'], leave: ['left'], bring: ['brought'],
    hold: ['held'], keep: ['kept'], pay: ['paid'], run: ['ran'], speak: ['spoke', 'spoken'],
    teach: ['taught'], wear: ['wore', 'worn'], write: ['wrote', 'written'], drink: ['drank'],
    drive: ['drove', 'driven'], eat: ['ate', 'eaten'], fall: ['fell', 'fallen'], forget: ['forgot'],
    hear: ['heard'], put: ['put'], read: ['read'], send: ['sent'], sleep: ['slept'], break: ['broke'],
    choose: ['chose', 'chosen'], catch: ['caught'], lead: ['led'], lie: ['lay'], sell: ['sold'],
    sing: ['sang', 'sung'], steal: ['stole'], throw: ['threw'], understand: ['understood'],
    wake: ['woke'], win: ['won'], build: ['built'], fight: ['fought'], hurt: ['hurt'], cut: ['cut'],
    let: ['let'], mean: ['meant'], shake: ['shook'], shoot: ['shot'],
    rise: ['rose'], ride: ['rode'], hide: ['hid'], bite: ['bit'], feed: ['fed'], dig: ['dug'],
    hang: ['hung'], strike: ['struck'], seek: ['sought'], borrow: ['borrowed']
  };

  var formCache = {};
  function wordForms(w) {
    if (formCache[w]) return formCache[w];
    var out = [w];
    if (IRREG[w]) out = out.concat(IRREG[w]);
    var base = w;
    out.push(base + 's', base + 'es', base + 'ed', base + 'd', base + 'ing');
    if (/y$/.test(base)) out.push(base.slice(0, -1) + 'ies', base.slice(0, -1) + 'ied');
    if (/e$/.test(base)) out.push(base.slice(0, -1) + 'ing', base.slice(0, -1) + 'ed');
    if (/([bcdfghjklmnpqrstvwxz])\1$/.test(base)) out.push(base + base.slice(-1) + 'ed', base + base.slice(-1) + 'ing');
    /* 긴 형태부터 찾아야 짧은 조각이 먼저 걸리지 않는다 */
    out = out.filter(function (x, i) { return x && out.indexOf(x) === i && x.length >= 2; });
    out.sort(function (a, b) { return b.length - a.length; });
    formCache[w] = out;
    return out;
  }

  function findIn(text, phrase) {
    var p = String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(^|[^A-Za-z])(' + p + ')(?![A-Za-z])', 'i');
    var m = re.exec(text);
    if (!m) return null;
    var start = m.index + m[1].length;
    return { i: start, s: text.substr(start, m[2].length) };
  }

  function corePhrase(c) {
    var w = String(c.w || '');
    w = w.replace(/\[[^\]]*\]/g, ' ').replace(/[…]/g, ' ').replace(/~/g, ' ').replace(/\.\.\./g, ' ').replace(/\s+/g, ' ').trim();
    return w.replace(/[.?!]+$/, '');
  }

  function blankOf(c) {
    /* Lv.6 회화 문장: 문장 자체에서 핵심 표현(c.b)을 뚫는다 */
    if (c._lv === 6) {
      if (!c.b) return null;
      var hv = findIn(c.w, c.b);
      if (!hv) return null;
      return { pre: c.w.slice(0, hv.i), ans: hv.s, post: c.w.slice(hv.i + hv.s.length), core: c.b, conv: true };
    }
    var e = c.e;
    if (!e) return null;
    var cands = [];
    var core = corePhrase(c);
    if (core) cands.push(core);
    if (core.split(' ').length > 2) {
      cands.push(core.split(' ').slice(0, 3).join(' '));
      cands.push(core.split(' ').slice(0, 2).join(' '));
    }
    if (core && core.indexOf(' ') === -1) {
      cands = cands.concat(wordForms(core.toLowerCase()));
    }
    for (var i = 0; i < cands.length; i++) {
      var hit = findIn(e, cands[i]);
      if (hit) {
        return { pre: e.slice(0, hit.i), ans: hit.s, post: e.slice(hit.i + hit.s.length), core: core };
      }
    }
    return null;
  }

  function blankOptions(c, bt) {
    if (c._lv === 6) {
      var want2 = String(bt.ans).trim().split(/\s+/).length;
      var seenB = {};
      seenB[String(bt.ans).toLowerCase()] = 1;
      var cands6 = (LEVELS[6] || [])
        .filter(function (x) { return x.b && x.w !== c.w && !seenB[x.b.toLowerCase()]; })
        .map(function (x) {
          var sc = (x.t === c.t ? 2 : 0) + (Math.abs(String(x.b).trim().split(/\s+/).length - want2) === 0 ? 1.5 : 0) + Math.random();
          return { x: x, s: sc };
        })
        .sort(function (a, b) { return b.s - a.s; });
      var opts6 = [bt.ans];
      for (var j = 0; j < cands6.length && opts6.length < 4; j++) {
        var vb = cands6[j].x.b;
        var kb = vb.toLowerCase();
        if (seenB[kb]) continue;
        if (Math.abs(String(vb).trim().split(/\s+/).length - want2) > 1) continue;
        seenB[kb] = 1;
        opts6.push(vb);
      }
      return shuffle(opts6);
    }
    var same = c._lv === 5;
    var pool = same ? (LEVELS[5] || []) : (LEVELS[c._lv] || []);
    var strip = function (s) { return String(s).toLowerCase().replace(/[^a-z' ]/g, '').trim(); };
    var seen = {};
    seen[strip(c.w)] = 1;
    var want = String(bt.ans).trim().split(/\s+/).length;
    var t = tagOf(c);
    /* 같은 태그·같은 품사를 우선해 그럴듯한 오답을 만든다 (동점은 무작위) */
    var cands = pool.filter(function (x) { return x.w.toLowerCase() !== c.w.toLowerCase(); })
      .map(function (x) {
        var sc = (tagOf(x) === t ? 2 : 0) + (x.p && x.p === c.p ? 1 : 0) + Math.random();
        return { x: x, s: sc };
      })
      .sort(function (a, b) { return b.s - a.s; })
      .map(function (o) { return o.x; });
    var opts = [c.w];
    for (var i = 0; i < cands.length && opts.length < 4; i++) {
      var v = cands[i].w;
      var k = strip(v);
      if (!k || seen[k]) continue;
      if (same) {
        var n = String(v).trim().split(/\s+/).length;
        if (Math.abs(n - want) > 1) continue;
      }
      seen[k] = 1;
      opts.push(v);
    }
    return shuffle(opts);
  }

  var BT = null;
  function renderBlank(c) {
    var bt = blankOf(c);
    if (!bt) { renderQuiz(c); return; }
    BT = bt;
    var tag = tagOf(c);
    $('#blankTag').textContent = (tag ? tag + ' · ' : '') + '빈칸에 맞는 표현은?';
    $('#blankSrs').textContent = srsInfo(c);
    var blanks = String(bt.ans).trim().split(/\s+/).map(function () { return '____'; }).join(' ');
    $('#blankSentence').innerHTML =
      escapeHtml(bt.pre) + '<span class="gap" id="blankGap">' + blanks + '</span>' + escapeHtml(bt.post);
    $('#blankKo').textContent = c._lv === 6 ? (c.m || '') : (c.k || '');
    $('#blankNote').textContent = c._lv === 6 ? '같은 상황에서 쓰는 표현 4개 중 문맥에 맞는 것' : '보기 4개 중 문맥에 맞는 것';
    $('#blankNote').classList.remove('hinted');
    $('#blankSpeak').onclick = function () { speak(c._lv === 6 ? c.w : (c.e || c.w)); };

    var opts = blankOptions(c, bt);
    var box = $('#blankOptions');
    box.innerHTML = '';
    var letters = ['A', 'B', 'C', 'D'];
    CUR_ANSWER = bt.conv ? bt.ans : c.w;
    CUR_OPTS = [];
    opts.forEach(function (opt, i) {
      var b = document.createElement('button');
      b.className = 'opt';
      b.dataset.val = opt;
      b.innerHTML = '<span class="key">' + letters[i] + '</span><span>' + escapeHtml(opt) + '</span>';
      b.addEventListener('click', function () { answerBlank(b, opt, c, bt); });
      box.appendChild(b);
      CUR_OPTS.push({
        letter: letters[i], v: opt,
        note: c._lv === 6 ? (BLANK_GLOSS[String(opt).toLowerCase()] || '다른 상황의 표현')
          : (cardByW(opt) ? cardByW(opt).m : '')
      });
    });
  }

  function answerBlank(btn, picked, c, bt) {
    if (answered) return;
    answered = true;
    var target = bt.conv ? bt.ans : c.w;
    var isAns = function (v) { return String(v).toLowerCase() === String(target).toLowerCase(); };
    var ok = isAns(picked);
    $$('#blankOptions .opt').forEach(function (b) {
      b.disabled = true;
      if (isAns(b.dataset.val)) b.classList.add('correct');
      else if (b === btn && !ok) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    var gap = $('#blankGap');
    if (gap) {
      gap.textContent = bt.ans;
      gap.classList.toggle('filled', ok);
    }
    grade(c, ok ? 2 : 0);
    var rr = peek(c.w);
    var nextDue = rr.st >= MASTER_ST ? '마스터 (60일+)' : STAGE_LABEL[rr.st];

    var body;
    if (c._lv === 6) {
      body = '<div class="fb-ex"><p class="en">' + escapeHtml(bt.pre) + '<b>' + escapeHtml(bt.ans) + '</b>' + escapeHtml(bt.post) + '</p>' +
        '<p class="ko">' + escapeHtml(c.m || '') + '</p></div>' +
        '<div class="fb-ex fb-pair"><p class="en">↳ ' + escapeHtml(c.e || '') + '</p><p class="ko">' + escapeHtml(c.k || '') + '</p></div>' +
        '<div class="fb-mean"><span class="pill small">정답 「' + escapeHtml(bt.ans) + '」 = ' + escapeHtml(BLANK_GLOSS[String(bt.ans).toLowerCase()] || '') + '</span>' +
        (tagOf(c) ? '<span class="pill small">' + escapeHtml(tagOf(c)) + '</span>' : '') + '</div>' +
        '<p class="fb-nuance">' + escapeHtml(nuance(c, bt.ans, ok ? null : picked)) + '</p>';
      if (!ok && speakOk) speak(c.w);
      showFeedback(ok, body, c, rr, nextDue);
      return;
    }
    var bodyHtml = '<div class="fb-ex"><p class="en">' + escapeHtml(c.e || '') + '</p><p class="ko">' + escapeHtml(c.k || '') + '</p></div>';
    var ansC = c;
    bodyHtml += '<div class="fb-mean"><span class="pill small">정답 「' + escapeHtml(c.w) + '」 = ' + escapeHtml(ansC.m) + '</span>' +
      (tagOf(c) ? '<span class="pill small">' + escapeHtml(tagOf(c)) + '</span>' : '') + '</div>';
    bodyHtml += '<p class="fb-nuance">' + escapeHtml(nuance(c, c.w, ok ? null : picked)) + '</p>';
    if (!ok && speakOk) speak(c.e || c.w);
    showFeedback(ok, bodyHtml, c, rr, nextDue);
  }

  function nuance(c, ans, picked) {
    if (c._lv === 6) {
      var note = c.x || '';
      var g = function (v) { return BLANK_GLOSS[String(v).toLowerCase()] || '다른 상황의 표현'; };
      if (!picked) return '핵심: ' + note;
      return '「' + picked + '」는 ‘' + g(picked) + '’, 이 문장엔 「' + ans + '」(‘' + g(ans) + '’)가 맞습니다. ' + note;
    }
    var ansC = cardByW(ans) || c;
    var tip = TAG_TIP[tagOf(c)] || '';
    if (!picked) {
      return '왜 「' + ans + '」인가: ' + ansC.m + '. ' + tip;
    }
    var pickC = cardByW(picked);
    if (c._lv === 5) {
      var a1 = String(ans).split(' ')[0].toLowerCase();
      var p1 = String(picked).split(' ')[0].toLowerCase();
      if (ans.indexOf(' ') > -1 && a1 === p1) {
        var head = c.p === '구동사' ? '같은 동사 ' + a1 + '에 붙은 입자가' : '같은 말 「' + a1 + '」 뒤에 붙는 말이';
        return head + ' 뜻을 가릅니다 — 「' + ans + '」는 "' + ansC.m + '", 「' + picked + '」는 "' +
          (pickC ? pickC.m : '다른 뜻') + '".';
      }
      if (pickC && tagOf(pickC) === tagOf(c)) {
        return '둘 다 ' + tagOf(c) + ' 표현이지만, 이 문장이 요구하는 건 "' + ansC.m + '"입니다. 「' + picked + '」는 "' +
          pickC.m + '" 쪽에 씁니다.';
      }
      return '「' + ans + '」는 "' + ansC.m + '", 「' + picked + '」는 "' + (pickC ? pickC.m : '다른 뜻') + '" — 문맥의 대상과 방향을 보세요.';
    }
    return '「' + picked + '」는 "' + (pickC ? pickC.m : '다른 뜻') + '"입니다. 이 문장에는 "' + ansC.m + '"가 맞습니다. ' + tip;
  }

  /* ---------------- 문장 순서 맞추기 ---------------- */
  var O = null;

  function orderOf(c) {
    /* Lv.6 통문장: 문장 자체를 타일로 쪼개고, 한국어 뜻을 문제로 준다 */
    if (c._lv === 6) {
      var st = String(c.w || '').trim().split(/\s+/).filter(Boolean);
      if (st.length < 3 || st.length > 13) return null;
      return { toks: st, ko: c.m || '' };
    }
    var e = c.e;
    if (!e) return null;
    var toks = String(e).trim().split(/\s+/).filter(Boolean);
    /* 구문(Lv.5)은 11타일까지, 단어 카드는 짧은 예문(3~8타일)만 — 긴 문장 조립은 학습 효과보다 피로만 커진다 */
    var max = c._lv === 5 ? 11 : 8;
    if (toks.length < 3 || toks.length > max) return null;
    if (!c.k) return null;
    if (c._lv < 5) {
      /* 카드 단어가 실제로 들어 있는 예문만 */
      if (!blankOf(c)) return null;
    }
    return { toks: toks };
  }

  function renderOrder(c) {
    var od = orderOf(c);
    if (!od) { renderQuiz(c); return; }
    CUR_OPTS = []; CUR_ANSWER = '';
    O = { c: c, toks: od.toks, ko: od.ko || c.k || '', pool: [], placed: [], hints: 0, tries: 0 };
    od.toks.forEach(function (t, i) { O.pool.push({ id: i, t: t }); });
    shuffle(O.pool);
    $('#orderTag').textContent = (tagOf(c) ? tagOf(c) + ' · ' : '') + '타일을 순서대로 눌러 문장을 만드세요';
    $('#orderSrs').textContent = srsInfo(c);
    $('#orderKo').textContent = O.ko;
    var g = $('#orderHint');
    g.disabled = false;
    g.textContent = '💡 힌트';
    var row = $('#answerRow');
    row.dataset.state = '';
    paintOrder();
  }

  function paintOrder() {
    if (!O) return;
    var row = $('#answerRow');
    row.className = 'answer-row' + (row.dataset.state || '');
    row.innerHTML = '';
    if (!O.placed.length) {
      row.innerHTML = '<span class="ph">여기를 눌러 순서대로 놓아요</span>';
    }
    O.placed.forEach(function (tile, idx) {
      var b = document.createElement('button');
      b.className = 'tile';
      b.textContent = tile.t;
      b.addEventListener('click', function () {
        if (answered) return;
        O.placed.splice(idx, 1);
        O.pool.push(tile);
        paintOrder();
      });
      row.appendChild(b);
    });
    var pool = $('#tilePool');
    pool.innerHTML = '';
    O.pool.forEach(function (tile) {
      var b = document.createElement('button');
      b.className = 'tile';
      b.dataset.id = tile.id;
      b.textContent = tile.t;
      b.addEventListener('click', function () {
        if (answered) return;
        var i = O.pool.indexOf(tile);
        if (i > -1) O.pool.splice(i, 1);
        O.placed.push(tile);
        paintOrder();
      });
      pool.appendChild(b);
    });
  }

  function orderHint() {
    if (!O || answered) return;
    var idx = O.placed.length;
    if (idx >= O.toks.length) { toast('이미 다 놓았어요'); return; }
    var want = O.toks[idx];
    var cand = O.pool.filter(function (t) { return t.t === want; })[0] || O.pool[0];
    if (!cand) return;
    O.hints++;
    var btn = $('#tilePool [data-id="' + cand.id + '"]');
    if (btn) {
      btn.classList.add('hint');
      setTimeout(function () { btn.classList.remove('hint'); }, 1100);
    }
    toast('다음 타일: 「' + want + '」');
    if (O.hints >= 3) { $('#orderHint').disabled = true; }
  }

  function checkOrder() {
    if (!O || answered) return;
    if (O.placed.length < O.toks.length) { toast('타일을 모두 놓아주세요 (' + O.placed.length + '/' + O.toks.length + ')'); return; }
    var mine = O.placed.map(function (t) { return t.t; }).join(' ');
    var want = O.toks.join(' ');
    var ok = mine === want;
    if (!ok && O.tries === 0) {
      O.tries++;
      var row = $('#answerRow');
      row.dataset.state = 'no';
      row.className = 'answer-row no';
      toast('순서가 달라요 — 한 번 더');
      return;
    }
    answered = true;
    var row2 = $('#answerRow');
    row2.dataset.state = ok ? 'ok' : 'no';
    row2.className = 'answer-row ' + (ok ? 'ok' : 'no');
    var c = O.c;
    grade(c, ok ? 2 : 0);
    var rr = peek(c.w);
    var nextDue = rr.st >= MASTER_ST ? '마스터 (60일+)' : STAGE_LABEL[rr.st];

    var body = '<div class="fb-ex"><p class="en">' + escapeHtml(want) + '</p><p class="ko">' + escapeHtml(O.ko || '') + '</p></div>';
    body += '<div class="fb-order">' + O.toks.map(function (t) {
      return '<span class="' + (ok ? 'ok-tile' : 'ok-tile') + '">' + escapeHtml(t) + '</span>';
    }).join('') + '</div>';
    if (c._lv === 6 && c.e) {
      body += '<div class="fb-ex fb-pair"><p class="en">↳ ' + escapeHtml(c.e) + '</p><p class="ko">' + escapeHtml(c.k || '') + '</p></div>';
    }
    if (!ok) {
      body += '<p class="fb-nuance">네 순서: ' + O.placed.map(function (t) { return escapeHtml(t.t); }).join(' ') +
        '<br>영어는 <b>' + escapeHtml(shortGrammar(c)) + '</b> 순으로 갑니다. 문장을 통째로 소리 내어 세 번 읽어보세요.</p>';
    } else {
      body += '<p class="fb-nuance">' + escapeHtml(shortGrammar(c)) + '. ' +
        escapeHtml(c._lv === 6 ? (c.x || '') : (TAG_TIP[tagOf(c)] || '')) + '</p>';
    }
    if (speakOk) speak(want);
    showFeedback(ok, body, c, rr, nextDue);
  }

  function shortGrammar(c) {
    if (c._lv === 6) {
      if (/[?]$/.test(String(c.w).trim())) return '의문문이면 조동사·의문사 → 주어 → 동사';
      if (/^(Could|Would|Can|Will|Shall|May|Do|Did|Are|Is|Have|Let's|Let me)/i.test(c.w)) return '부탁·제안이면 조동사가 먼저';
      return '주어 → 동사 → 나머지(장소·시간은 뒤로)';
    }
    if (c._lv === 5 && /^(Would you mind|Could you|Do you mind|Any chance|I was wondering if|Is it okay if|Would it be okay if|Can I|Could I|May I|Do you want|How about|Why don't we|Let's)/i.test(c.w)) {
      return '상대에게 묻는 말이면 조동사·의문사가 먼저';
    }
    if (/^(I'm|I am|I was|I've|I'd|I can't|I don't|I think|I guess|I hope|I bet|I wish)/i.test(c.w)) {
      return '내 상태·생각이면 주어+동사가 먼저';
    }
    return '주어 → 동사 → 목적어(→ 장소·시간)';
  }

  /* ---------------- 문제별 맞춤 해설 ---------------- */
  var POS_NOTE = {
    '동사': '동사라 과거형·3인칭 -s 변화를 함께 익히면 좋습니다.',
    '명사': '명사라 복수형과 관사(a/the)를 붙여 외우면 실제 문장에서 바로 나옵니다.',
    '형용사': '형용사라 명사 앞이나 be동사 뒤에 놓습니다.',
    '부사': '부사라 동사·형용사·문장 전체를 꾸밉니다.',
    '전치사': '전치사라 뒤에 명사(목적어)가 반드시 옵니다.',
    '접속사': '접속사라 두 문장(절)을 이어 줍니다.'
  };

  function explanationOf(c) {
    if (!c) return '';
    if (c._lv === 6) {
      var t = tagOf(c) || '일상';
      var bits = [];
      bits.push('「' + c.w + '」 = ' + (c.m || ''));
      bits.push('쓰는 상황: ' + t + ' — 상대에게 이렇게 말하면 됩니다.');
      if (c.b) bits.push('빈칸 표현 「' + c.b + '」 = ' + (c.bm || '') + '.');
      if (c.e) bits.push('상대는 보통 「' + c.e + '」(' + (c.k || '') + ')라고 받아요.');
      if (c.x) bits.push(c.x);
      return bits.join(' ');
    }
    if (c.x) return c.x;   /* Lv.5 — 카드별로 생성한 의미·문법·상황 해설 */
    var pos = c.p || '';
    var mine = '「' + c.w + '」(' + (pos || '표현') + ') = ' + (c.m || '') + '.';
    if (c.e) mine += ' 예문 「' + c.e + '」는 「' + (c.k || '') + '」 — 이 단어가 그 문장에서 이 뜻으로 쓰였습니다.';
    var note = POS_NOTE[pos] || '';
    return mine + (note ? ' ' + note : '');
  }

  function explanationHtml(c) {
    var x = explanationOf(c);
    if (!x) return '';
    return '<div class="fb-exp"><p class="fb-lbl">해설</p><p class="fb-x">' + escapeHtml(x) + '</p></div>';
  }

  function sayRow(c) {
    if (!speakOk) return '';
    var label = c && c._lv === 6 ? '문장' : '예문';
    return '<div class="fb-say">' +
      '<button class="ghost-btn small" id="fbSay">🔊 ' + label + ' 듣기</button>' +
      '<button class="ghost-btn small" id="fbSaySlow">🐢 0.75x</button>' +
      (micSupport() ? '<button class="ghost-btn small shadow-btn" id="fbShadow">🎤 따라 말하기</button>' : '') +
      '</div>' +
      (micSupport() ? '<p class="fb-shadow-out" id="fbShadowOut" hidden></p>' : '');
  }

  /* 해설에서 바로 쉐도잉 — 듣고 따라 말하면 그 자리에서 점수(Speak의 핵심 루프) */
  function shadowSpeak(c, btn) {
    var target = c && (c._lv === 6 ? c.w : (c.e || c.w));
    if (!target) return;
    shadowTarget(target, btn, $('#fbShadowOut'));
  }

  /* 문장 하나를 듣고 따라 말하게 한다 — 점수는 단어별 색으로. 해설·패턴 치환·교정 카드가 같이 쓴다 */
  function shadowTarget(target, btn, out) {
    if (!target) return;
    if (!micSupport()) { toast(micErrorText('unsupported')); return; }
    if (btn) btn.classList.add('on');
    if (out) { out.hidden = false; out.textContent = '듣고 따라 말해 보세요…'; }
    listenOnce(null, function (txt) {
      if (btn) btn.classList.remove('on');
      if (!out) return;
      out.hidden = false;
      if (!txt) { out.textContent = '아무것도 인식되지 않았어요. 마이크에 조금 더 가까이 대고 다시 말해 보세요.'; return; }
      var r = alignSpeech(target, txt);
      out.innerHTML = '<b class="' + (r.score >= 80 ? 'ok-t' : r.score >= 55 ? 'mid-t' : 'bad-t') + '">' + r.score + '점</b> ' +
        r.items.map(function (x) {
          var cls = x.state === 'ok' ? 'ok-t' : x.state === 'near' ? 'mid-t' : 'bad-t';
          return '<span class="' + cls + '">' + escapeHtml(x.word) + '</span>';
        }).join(' ') +
        (r.heard.length ? '<span class="muted small"> · 들은 문장: ' + escapeHtml(r.heard.join(' ')) + '</span>' : '');
    }, function (err) {
      if (btn) btn.classList.remove('on');
      if (out) { out.hidden = false; out.textContent = micErrorText(err); }
    });
  }

  /* ---------------- 피드백 공통 ---------------- */
  function showFeedback(ok, bodyHtml, c, rr, nextDue) {
    var fb = $('#feedback');
    recReset();   /* 카드가 바뀌면 앞 카드의 녹음은 버린다(메모리에만 있음) */
    fb.innerHTML =
      '<div class="fb-head"><span class="fb-title ' + (ok ? 'ok' : 'no') + '">' + (ok ? '정답!' : '아쉬워요') + '</span>' +
      '<button class="fb-next" id="fbNext">다음</button></div>' +
      bodyHtml +
      explanationHtml(c) +
      optListHtml() +
      chunkPanelHtml(exampleOf(c), chunkProtect(c)) +
      patternPanelHtml(c) +
      sayRow(c) +
      '<div class="fb-srs">' + (ok ? '다음 복습: ' + nextDue + (rr.st >= MASTER_ST ? '' : ' · ' + rr.st + '단계') : '오답 등록 · 10분 뒤 다시 물어봐요') + '</div>';
    fb.hidden = false;
    $('#fbNext').addEventListener('click', advance);
    bindChunkPanel(fb, exampleOf(c), chunkProtect(c));
    bindPatternPanel(fb, c);
    var sb = $('#fbSay');
    if (sb) sb.addEventListener('click', function () { speakExample(c); });
    var sbs = $('#fbSaySlow');
    if (sbs) sbs.addEventListener('click', function () { speakExample(c, true); });
    var sh = $('#fbShadow');
    if (sh) sh.addEventListener('click', function () { shadowSpeak(c, this); });
    if (fb.scrollIntoView && fb.getBoundingClientRect().bottom > window.innerHeight) {
      fb.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---- 플래시카드 ---- */
  function renderFlash(c) {
    CUR_OPTS = []; CUR_ANSWER = '';
    var flip = $('#flipCard');
    flip.classList.remove('flipped');
    var conv = c._lv === 6;
    var w = $('#fcWord');
    w.textContent = conv ? c.m : c.w;
    w.classList.toggle('sentence', !conv && c.w.length > 24);
    $('#fcPhon').textContent = conv ? '' : (c.ph || '');
    $('#fcPos').textContent = tagOf(c) || c.p || '';
    $('#fcPos2').textContent = tagOf(c) || c.p || '';
    $('#fcMeaning').textContent = conv ? c.w : c.m;
    var hint = $('#fcHint');
    if (hint) hint.textContent = conv ? '탭해서 영어 문장 보기' : '탭해서 뜻 보기';
    $('#fcExEn').textContent = conv ? (c.e ? '↳ ' + c.e : '') : (c.e || '');
    $('#fcExKo').textContent = c.k || '';
    var note = $('#fcNote');
    if (note) {
      note.hidden = !conv || !c.x;
      note.textContent = conv ? (c.x || '') : '';
    }
    $('#fcSpeak').hidden = !speakOk;
    /* 카드 앞면의 🔊 는 카드 자체(단어 / 회화 통문장)를 읽는다 — 예문은 뒤집은 뒤 버튼으로 */
    $('#fcSpeak').onclick = function (e) { e.stopPropagation(); speak(c.w); };
    var fslow = $('#fcSpeakSlow');
    if (fslow) {
      fslow.hidden = !speakOk;
      fslow.onclick = function (e) { e.stopPropagation(); speak(c.w, 0.75); };
    }
    var fex = $('#fcExSpeak');
    if (fex) {
      fex.hidden = !speakOk || !c.e;
      fex.onclick = function (e) { e.stopPropagation(); speak(c.e || c.w); };
    }
    var fexs = $('#fcExSpeakSlow');
    if (fexs) {
      fexs.hidden = !speakOk || !c.e;
      fexs.onclick = function (e) { e.stopPropagation(); speak(c.e || c.w, 0.75); };
    }
    $('#fcSrs').textContent = srsInfo(c);
    $$('#gradeRow .grade').forEach(function (b) { b.disabled = false; });
    answered = false;
  }

  $('#flipCard').addEventListener('click', function () {
    if (!S || S.i >= S.queue.length) return;
    this.classList.toggle('flipped');
    if (this.classList.contains('flipped') && speakOk) speak(S.queue[S.i].c.w);
  });

  $$('#gradeRow .grade').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!S || S.i >= S.queue.length || answered) return;
      answered = true;
      var g = +b.dataset.g;
      var c = S.queue[S.i].c;
      grade(c, g);
      var gr = peek(c.w);
      toast(gr.st >= MASTER_ST ? '마스터 · 60일+ 유지' : '다음 복습: ' + STAGE_LABEL[gr.st]);
      advance();
    });
  });

  /* ---- 채점 & SRS ---- */
  function grade(c, quality) {
    var r = rec(c.w);
    var first = r.seen === 0 && r.t === 0;
    var wasMaster = r.st >= MASTER_ST;
    r.seen++;
    r.t = Date.now();
    var ts = todayStats();
    ts.n++;
    var ok = quality === 2;
    if (ok) ts.ok++;
    if (first) {
      bumpNew();
      store.newCount++;
      store.newDay = todayKey();
      ts.nw = (ts.nw || 0) + 1;
    }
    bumpMode(curMode, ok);
    if (ok) {
      r.ok++;
      r.st = Math.min(MASTER_ST, r.st + 1);
    } else if (quality === 1) {
      r.st = Math.max(0, r.st - 1);
    } else {
      r.bad++;
      r.st = 0;
    }
    var gap = STAGE_GAP[r.st];
    r.due = r.st >= MASTER_ST ? 0 : Date.now() + (gap || MIN10);
    S.answeredAt = S.i + 1;
    S.answers.push({ w: c.w, ok: ok });
    if (ok) S.correct++;
    /* 이 문제 자리에 결과 표시 + 세션 콤보 */
    if (S.queue[S.i]) S.queue[S.i].mark = ok ? 2 : 0;
    S.combo = ok ? (S.combo || 0) + 1 : 0;
    if ((S.combo || 0) > (S.best || 0)) S.best = S.combo;
    if (!ok) {
      var agains = S.queue.filter(function (q) { return q.c.w === c.w && q.kind === 'again'; }).length;
      if (agains < 2 && S.queue.length < SET_SIZE) {
        var pos = Math.min(S.queue.length, S.i + 4);
        S.queue.splice(pos, 0, { c: c, kind: 'again' });
      }
    }
    persistSession();
    paintStudyMeta();
    if (ok && !wasMaster && r.st >= MASTER_ST) toast('마스터! 「' + c.w + '」 60일 유지 단계');
  }

  function advance() {
    if (!S) return;
    S.i++;
    S.answeredAt = S.i;
    persistSession();
    nextCard();
  }

  $('#studyBack').addEventListener('click', function () {
    if (S && S.i > 0 && S.i < S.queue.length) {
      persistSession();
      toast('여기까지 저장했어요 · 홈에서 이어서 풀 수 있어요');
    }
    S = null;
    showStudy(false);
    showTab('home');
  });

  function endSession() {
    store.session = null;
    saveNow();
    var total = S.answers.length;
    var correct = S.correct;
    $('#studyProgress').style.width = '100%';
    $('#studyCounter').textContent = total + '/' + total;
    $('#quizBox').hidden = true;
    $('#cardBox').hidden = true;
    $('#modeSwitch').hidden = true;
    $('#resultBox').hidden = false;
    $('#rCorrect').textContent = correct;
    $('#rTotal').textContent = total;
    var pct = total ? Math.round(correct / total * 100) : 0;
    var finished = S;
    var isRecall = finished.mode === 'recall';
    $('#rSub').textContent = isRecall
      ? '오답 회수 1회전 · ' + correct + '/' + total + ' 되찾음' + (correct === total
        ? ' — 방금 틀린 카드를 모두 되찾았어요.'
        : ' — 못 되찾은 ' + (total - correct) + '개는 10분 뒤 다시 나와요.')
      : (S.label ? S.label + ' · ' : '') +
        (pct >= 90 ? '완벽해요. 다음 복습 주기가 잡혔어요.' : pct >= 60 ? '좋아요. 틀린 카드는 10분 뒤 다시 나와요.' : '오늘은 여기까지. 틀린 카드부터 다시 봐요.');
    var goalN = todayStats().n || 0;
    var rc = $('#rCombo');
    if (rc) rc.textContent = (isRecall ? '🔁 되찾음 ' + correct + '/' + total + ' · ' : '') +
      '최고 연속 정답 ' + (S.best || 0) + ' · 정답률 ' + pct + '% · 오늘 ' + goalN + '문제' +
      (goalN >= dailyGoal() ? ' (목표 달성)' : ' / 목표 ' + dailyGoal());
    var list = $('#rList');
    list.innerHTML = '';
    var seen = {};
    S.answers.forEach(function (a) {
      if (seen[a.w]) return;
      seen[a.w] = 1;
      var d = document.createElement('div');
      d.className = 'r-item' + (a.ok ? '' : ' no');
      var r = peek(a.w);
      d.innerHTML = '<b>' + escapeHtml(a.w) + '</b><span>' +
        (isRecall ? (a.ok ? '✓ 되찾음' : '10분 뒤 다시') : (a.ok ? STAGE_LABEL[(r && r.st) || 0] : '10분 뒤')) +
        '</span>';
      list.appendChild(d);
    });
    /* 틀린 카드만 모아 10문제 한 세트 — Duolingo·Speak가 대화 끝에 지적한 것만 다시 물어보는 방식 */
    var wrongs = [];
    var seenW = {};
    S.answers.forEach(function (a) {
      if (!a.ok && !seenW[a.w]) { seenW[a.w] = 1; wrongs.push(a.w); }
    });
    /* 오답 회수 1회전 — 방금 틀린 카드만 바로 한 바퀴. 새 10문제 세트 대신 '마무리 회수'라
       세트 크기는 틀린 개수(최대 10) 그대로 두고, 10문제 단위 원칙은 건드리지 않는다. */
    var rcl = $('#rRecall');
    if (rcl) {
      rcl.hidden = isRecall || !wrongs.length;
      if (!rcl.hidden) {
        rcl.textContent = '🔁 오답 회수 1회전 · ' + wrongs.length + '문제';
        rcl.onclick = function () { S = null; startRecall(wrongs); };
      }
    }
    var rb = $('#rWeak');
    if (rb) {
      rb.hidden = isRecall || !wrongs.length;
      if (!isRecall && wrongs.length) {
        rb.textContent = '틀린 ' + wrongs.length + '개만 다시';
        rb.onclick = function () { S = null; startRetry(wrongs); };
      }
    }
    /* 회수 버튼이 있으면 그것이 주 동작, 「10문제 더」는 보조로 */
    var ag = $('#rAgain');
    if (ag) {
      var recallOn = !!(rcl && !rcl.hidden);
      ag.classList.toggle('ghost-btn', recallOn);
      ag.classList.toggle('wide', recallOn);
      ag.classList.toggle('primary-btn', !recallOn);
    }
    $('#rAgain').onclick = function () {
      S = null;
      /* 「10문제 더」는 방금 끝낸 그 학습을 그대로 이어간다 (단계·구문·회화·새 카드·오답 모두) */
      if (finished.stageLv) startLevel(finished.stageLv);
      else if (finished.mode === 'drill') startDrill(finished.lastMode || 'blank');
      else if (finished.mode === 'conv') startConv(finished.lastMode || 'blank');
      else if (finished.mode === 'fix') startFixDrill();
      else if (finished.mode === 'new' || finished.mode === 'weak') startSession(finished.mode);
      else startSession('mix');
    };
    $('#rHome').onclick = function () { S = null; showStudy(false); showTab('home'); };
    save();
  }

  /* 방금 틀린 카드부터 다시 — 나머지는 오답 노트·안 본 카드로 10문제를 채운다 */
  function startRetry(words) {
    var queue = [];
    var used = {};
    function push(c, kind) {
      if (!c || queue.length >= SET_SIZE) return;
      var k = c.w.toLowerCase();
      if (used[k]) return;
      used[k] = 1;
      queue.push({ c: c, kind: kind });
    }
    (words || []).forEach(function (w) { push(cardByW(w), 'again'); });
    weakList().forEach(function (c) { push(c, 'weak'); });
    setRank(stagePool()).forEach(function (c) { push(c, 'review'); });
    if (!queue.length) { toast('다시 풀 카드가 없어요'); return; }
    S = {
      queue: queue, i: 0, mode: 'retry', answers: [], correct: 0,
      quizDir: store.settings.dir, label: '틀린 카드 ' + (words || []).length + '개부터'
    };
    uiMode = store.settings.mode;
    setUiMode(uiMode);
    showStudy(true);
    nextCard();
  }

  /* 오답 회수 1회전 — 방금 틀린 카드만(최대 10) 바로 한 바퀴.
     새 세트를 짜지 않고 지금 세션의 오답만 되짚으므로 10문제 단위 원칙과 별개다. */
  function startRecall(words) {
    var queue = [];
    var used = {};
    (words || []).forEach(function (w) {
      var c = cardByW(w);
      if (!c) return;
      var k = c.w.toLowerCase();
      if (used[k]) return;
      used[k] = 1;
      queue.push({ c: c, kind: 'recall' });
    });
    if (!queue.length) { toast('회수할 카드가 없어요'); return; }
    S = {
      queue: queue.slice(0, SET_SIZE), i: 0, mode: 'recall', answers: [], correct: 0,
      quizDir: store.settings.dir, label: '오답 회수 1회전', recall: true
    };
    uiMode = store.settings.mode;
    setUiMode(uiMode);
    showStudy(true);
    nextCard();
  }

  /* 속도 · 모드 버튼 */
  $('#speedBtn').addEventListener('click', function () {
    store.settings.speed = speedRate() === 0.75 ? 1 : 0.75;
    paintSpeed();
    save();
    toast(speedRate() === 0.75 ? '🐢 천천히 듣기 (0.75x)' : '🔊 보통 속도 (1.0x)');
  });
  $$('#speedPick button').forEach(function (b) {
    b.addEventListener('click', function () {
      store.settings.speed = Number(b.dataset.speed) === 0.75 ? 0.75 : 1;
      paintSpeed();
      save();
    });
  });
  $$('#modeSwitch .seg').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!S || S.i >= S.queue.length) { toast('학습을 시작하면 전환할 수 있어요'); return; }
      setUiMode(b.dataset.mode);
    });
  });
  $('#orderHint').addEventListener('click', orderHint);
  $('#orderClear').addEventListener('click', function () {
    if (!O || answered) return;
    O.pool = O.pool.concat(O.placed);
    O.placed = [];
    shuffle(O.pool);
    paintOrder();
  });
  $('#orderCheck').addEventListener('click', checkOrder);

  /* ---------------- 단어장 ---------------- */
  var filter = 'all';
  var query = '';
  var shown = 0;
  var PAGE = 60;
  var filtered = [];

  function renderList(reset) {
    if (reset !== false) { shown = 0; }
    var pool = [];
    var lvSel = filter.charAt(0) === 'l' && filter.length === 2 ? +filter.charAt(1) : 0;
    allCards().forEach(function (c) {
      var r = peek(c.w);
      if (lvSel && c._lv !== lvSel) return;
      if (filter === 'star' && !(r && r.star)) return;
      if (filter === 'weak' && !(r && r.bad > 0 && r.st < MASTER_ST)) return;
      if (filter === 'due' && !(r && r.st < MASTER_ST && r.due && r.due <= Date.now())) return;
      if (query) {
        var q = query.toLowerCase();
        /* 단어 · 뜻 · 예문 해석까지 — 「퇴근」처럼 예문에만 있는 말도 찾아진다 */
        if (c.w.toLowerCase().indexOf(q) === -1 && (c.m || '').indexOf(query) === -1 &&
            (c.k || '').indexOf(query) === -1) return;
      }
      pool.push(c);
    });
    if (query && filter !== 'star') {
      pool.sort(function (a, b) {
        var q = query.toLowerCase();
        var aw = a.w.toLowerCase().indexOf(q) === 0 ? 0 : a.w.toLowerCase().indexOf(q) > -1 ? 1 : 2;
        var bw = b.w.toLowerCase().indexOf(q) === 0 ? 0 : b.w.toLowerCase().indexOf(q) > -1 ? 1 : 2;
        return aw - bw || a.w.length - b.w.length;
      });
    }
    filtered = pool;
    $('#listMeta').textContent = pool.length.toLocaleString() + '개' + (query ? ' · "' + query + '"' : '') + ' · ' + orderLabel();
    var list = $('#wordList');
    list.innerHTML = '';
    if (!pool.length) {
      list.innerHTML = '<div class="empty">조건에 맞는 카드가 없어요.<br>검색어나 필터를 바꿔 보세요.</div>';
      $('#moreBtn').hidden = true;
      return;
    }
    appendList();
  }

  function appendList() {
    var list = $('#wordList');
    var slice = filtered.slice(shown, shown + PAGE);
    slice.forEach(function (c) {
      var r = peek(c.w);
      var state = !r || !r.seen ? '' : r.st >= MASTER_ST ? 's2' : 's1';
      var el = document.createElement('div');
      el.className = 'word-item';
      el.innerHTML =
        '<span class="wi-state ' + state + '"></span>' +
        '<div class="wi-main"><div class="wi-top"><span class="wi-word">' + escapeHtml(c.w) + '</span>' +
        impBadge(c) +
        (tagOf(c) || c.p ? '<span class="wi-pos">' + escapeHtml(tagOf(c) || c.p) + '</span>' : '') + '</div>' +
        '<div class="wi-mean">' + escapeHtml(c.m) + '</div></div>' +
        '<button class="star ' + (r && r.star ? 'on' : '') + '" aria-label="북마크">' + (r && r.star ? '★' : '☆') + '</button>';
      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('star')) return;
        openSheet(c);
      });
      el.querySelector('.star').addEventListener('click', function (e) {
        e.stopPropagation();
        var rr = rec(c.w);
        rr.star = rr.star ? 0 : 1;
        save();
        this.classList.toggle('on', !!rr.star);
        this.textContent = rr.star ? '★' : '☆';
        toast(rr.star ? '북마크에 담았어요' : '북마크를 뺐어요');
      });
      list.appendChild(el);
    });
    shown += slice.length;
    $('#moreBtn').hidden = shown >= filtered.length;
  }

  $('#moreBtn').addEventListener('click', appendList);

  $$('#filters .chip').forEach(function (ch) {
    ch.addEventListener('click', function () {
      $$('#filters .chip').forEach(function (x) { x.classList.remove('active'); });
      ch.classList.add('active');
      filter = ch.dataset.f;
      renderList();
    });
  });

  var searchTimer = null;
  $('#searchInput').addEventListener('input', function () {
    query = this.value.trim();
    $('#searchClear').hidden = !query;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { renderList(); }, 90);
  });
  $('#searchClear').addEventListener('click', function () {
    $('#searchInput').value = '';
    query = '';
    this.hidden = true;
    renderList();
  });

  /* ---------------- 상세 시트 ---------------- */
  function openSheet(c) {
    var r = peek(c.w);
    var st = r ? r.st : 0;
    var body = $('#sheetBody');
    body.innerHTML =
      '<div class="sheet-word"><h3>' + escapeHtml(c.w) + '</h3>' +
      (c.p ? '<span class="wi-pos">' + escapeHtml(c.p) + '</span>' : '') +
      '</div>' +
      '<p class="sheet-phon">' + escapeHtml(c.ph || '') + '</p>' +
      '<p class="sheet-mean">' + escapeHtml(c.m) + '</p>' +
      (c._lv === 6 && c.b ? '<p class="sheet-blank">빈칸 「' + escapeHtml(c.b) + '」 = ' + escapeHtml(c.bm || '') + '</p>' : '') +
      (c.e ? '<div class="sheet-ex"><p class="en">' + (c._lv === 6 ? '↳ ' : '') + escapeHtml(c.e) + '</p><p class="ko">' + escapeHtml(c.k || '') + '</p></div>' : '') +
      (c.x ? '<p class="sheet-note">' + escapeHtml(c.x) + '</p>' : '') +
      '<div class="sheet-meta"><span class="pill">Lv.' + c._lv + ' ' + LEVEL_META[c._lv].name + '</span>' +
      (c.ib ? '<span class="pill imp' + (c.ib === 2 ? ' hot' : '') + '">' + (c.ib === 2 ? '필수★ 회화 우선' : '고빈도') + '</span>' : '') +
      (tagOf(c) ? '<span class="pill">' + escapeHtml(tagOf(c)) + '</span>' : '') +
      (st >= MASTER_ST ? '<span class="pill master">마스터</span>' : r && r.seen ? '<span class="pill srs">' + STAGE_LABEL[st] + ' 복습</span>' : '<span class="pill">새 카드</span>') +
      (r && r.bad ? '<span class="pill">오답 ' + r.bad + '회</span>' : '') +
      '</div>' +
      '<div class="sheet-actions">' +
      (speakOk ? '<button class="ghost-btn" id="shSpeak">🔊 ' + (c._lv === 6 ? '문장' : '발음') + '</button>' : '') +
      (speakOk && c.e ? '<button class="ghost-btn" id="shExSpeak">🔊 예문</button>' : '') +
      (speakOk && c.e ? '<button class="ghost-btn" id="shExSpeakSlow">🐢 0.75x</button>' : '') +
      '<button class="ghost-btn" id="shStar">' + (r && r.star ? '★ 북마크됨' : '☆ 북마크') + '</button>' +
      '<button class="ghost-btn" id="shStudy">이 카드 학습</button>' +
      '</div>';
    $('#sheetBackdrop').hidden = false;
    $('#sheet').hidden = false;
    var sp = $('#shSpeak');
    if (sp) sp.onclick = function () { speak(c._lv === 6 ? c.w : c.w); };
    var sx = $('#shExSpeak');
    if (sx) sx.onclick = function () { speak(c.e, speedRate()); };
    var sxs = $('#shExSpeakSlow');
    if (sxs) sxs.onclick = function () { speak(c.e, 0.75); };
    $('#shStar').onclick = function () {
      var rr = rec(c.w);
      rr.star = rr.star ? 0 : 1;
      save();
      this.textContent = rr.star ? '★ 북마크됨' : '☆ 북마크';
      toast(rr.star ? '북마크에 담았어요' : '북마크를 뺐어요');
      if (currentTab === 'list') renderList();
    };
    $('#shStudy').onclick = function () {
      closeSheet();
      /* 이 카드부터 10문제 — 나머지는 같은 단계의 복습·안 본 카드로 채운다 */
      var queue = [{ c: c, kind: 'one' }];
      var used = {};
      used[c.w.toLowerCase()] = 1;
      function fill(list) {
        (list || []).forEach(function (q) {
          if (queue.length >= SET_SIZE) return;
          var k = q.c.w.toLowerCase();
          if (used[k]) return;
          used[k] = 1;
          queue.push(q);
        });
      }
      fill(makeSet(LEVELS[c._lv] || [], 'mix'));
      if (queue.length < SET_SIZE) fill(makeSet(stagePool(), 'mix'));
      S = { queue: queue, i: 0, mode: 'one', answers: [], correct: 0, quizDir: store.settings.dir, label: '「' + c.w + '」부터' };
      uiMode = store.settings.mode === 'card' ? 'card' : store.settings.mode;
      setUiMode(uiMode);
      showStudy(true);
      nextCard();
    };
  }

  function openLevelSheet(lv) {
    var items = LEVELS[lv] || [];
    var r = { total: items.length, master: 0, learning: 0 };
    items.forEach(function (c) {
      var s = peek(c.w);
      if (s && s.st >= MASTER_ST) r.master++;
      else if (s && s.seen) r.learning++;
    });
    r.studied = r.master + r.learning;
    var m = (META.levels || {})[lv] || {};
    var body = $('#sheetBody');
    body.innerHTML =
      '<h3 style="margin:0;font-size:19px;font-weight:800;letter-spacing:-.4px">Lv.' + lv + ' · ' + LEVEL_META[lv].name + '</h3>' +
      '<p class="muted small" style="margin:6px 0 14px">' + LEVEL_META[lv].sub + ' · ' + r.total + '개' +
      (LEVEL_META[lv].coverage && lv <= 4 ? ' · 회화 ' + LEVEL_META[lv].coverage : '') + '</p>' +
      '<div class="stat-row" style="margin-bottom:14px"><div class="mini card"><b>' + r.master + '</b><span>마스터</span></div>' +
      '<div class="mini card"><b>' + r.learning + '</b><span>학습 중</span></div>' +
      '<div class="mini card"><b>' + (r.total - r.master - r.learning) + '</b><span>새 카드</span></div></div>' +
      '<div class="big-progress" style="margin-bottom:6px"><span style="width:' + (r.total ? Math.round(r.studied / r.total * 100) : 0) + '%"></span></div>' +
      '<p class="muted small" style="margin:0 0 12px">학습 진도 ' + r.studied + ' / ' + r.total + ' (' +
      (r.total ? Math.round(r.studied / r.total * 100) : 0) + '%) · 마스터율 ' +
      (r.total ? Math.round(r.master / r.total * 100) : 0) + '%</p>' +
      (m.basis ? '<p class="muted small" style="margin:0 0 12px">' + m.basis + '</p>' : '') +
      '<div class="sheet-actions"><button class="primary-btn" id="lvStart">이 단계 학습</button></div>';
    $('#sheetBackdrop').hidden = false;
    $('#sheet').hidden = false;
    $('#lvStart').onclick = function () {
      closeSheet();
      startLevel(lv);
    };
  }

  /* 단계(시트) 학습 — 「10문제 더 풀기」도 같은 단계에서 이어진다 */
  function startLevel(lv) {
    var items = LEVELS[lv] || [];
    /* 복습 대기 → 아직 안 푼 카드(중요도 순) → 오래 전에 본 카드 → 오늘 푼 카드 */
    var queue = makeSet(items, 'mix');
    if (!queue.length) { toast('이 단계는 학습할 카드가 없어요'); return false; }
    S = {
      queue: queue, i: 0, mode: 'level', stageLv: lv, answers: [], correct: 0,
      quizDir: store.settings.dir, label: 'Lv.' + lv + ' · ' + MODE_LABEL[store.settings.mode]
    };
    uiMode = store.settings.mode;
    setUiMode(uiMode);
    showStudy(true);
    nextCard();
    return true;
  }

  function closeSheet() {
    $('#sheetBackdrop').hidden = true;
    $('#sheet').hidden = true;
  }
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  /* ---------------- 통계 ---------------- */
  function renderStats() {
    var st = stats();
    var deck = deckTotal();
    var pct = deck ? Math.round(st.studied / deck * 100) : 0;
    var mpct = deck ? Math.round(st.mastered / deck * 100) : 0;
    $('#totalBar').style.width = pct + '%';
    $('#totalText').innerHTML = '학습 진도 <b>' + st.studied.toLocaleString() + ' / ' + deck.toLocaleString() +
      '</b> (' + pct + '%) · 마스터 ' + st.mastered.toLocaleString() + '개 (' + mpct + '%)';

    /* 오늘 · 모드별 기록 */
    var ts = todayStats();
    var tn = ts.n || 0;
    var todayEl = $('#statsToday');
    if (todayEl) {
      todayEl.textContent = tn
        ? '오늘 ' + tn + '문제 · 정답률 ' + pctOf(ts.ok || 0, tn) + '% · 새로 본 카드 ' + (ts.nw || 0) + '개'
        : '오늘 기록이 아직 없어요. 한 문제만 풀어도 바로 여기에 쌓입니다.';
    }
    var mt = $('#statsModes');
    if (mt) {
      var rows = MODE_KEYS.map(function (m) {
        var t = modeToday(m), a = modeAll(m);
        return '<tr><td><span class="mode-ico">' + MODE_ICON[m] + '</span> ' + MODE_LABEL[m] + '</td>' +
          '<td>' + t.n + '</td>' +
          '<td>' + (t.n ? pctOf(t.ok, t.n) + '%' : '—') + '</td>' +
          '<td>' + a.n + '</td>' +
          '<td>' + (a.n ? pctOf(a.ok, a.n) + '%' : '—') + '</td></tr>';
      }).join('');
      mt.innerHTML = '<table class="mode-table"><thead><tr><th>학습 모드</th><th>오늘</th><th>오늘 정답률</th><th>누적</th><th>누적 정답률</th></tr></thead><tbody>' +
        rows + '</tbody></table>';
    }

    var chart = $('#weekChart');
    chart.innerHTML = '';
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    var vals = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(Date.now() - i * DAY);
      var s = store.stats[todayKey(d)];
      vals.push({ d: d, n: s ? s.n : 0 });
    }
    var max = Math.max.apply(null, vals.map(function (v) { return v.n; }).concat([10]));
    vals.forEach(function (v, i) {
      var el = document.createElement('div');
      el.className = 'week-day' + (i === 6 ? ' today' : '');
      var h = Math.max(3, Math.round(v.n / max * 58));
      el.innerHTML = '<span class="week-val">' + (v.n || '') + '</span><i style="height:' + h + 'px"></i><b>' + days[v.d.getDay()] + '</b>';
      el.title = v.n + '개';
      chart.appendChild(el);
    });

    var box = $('#statsLevels');
    box.innerHTML = '';
    [1, 2, 3, 4, 5, 6].forEach(function (lv) {
      var pl = st.perLevel[lv];
      if (!pl) return;
      var p = pl.total ? Math.round(pl.studied / pl.total * 100) : 0;
      var mp = pl.total ? Math.round(pl.master / pl.total * 100) : 0;
      var row = document.createElement('div');
      row.className = 'level-row l' + lv;
      row.style.marginBottom = '8px';
      row.innerHTML = '<div class="lv-badge l' + lv + '">Lv.' + lv + '</div>' +
        '<div class="lv-mid"><div class="lv-name"><b>' + LEVEL_META[lv].name + '</b><span>' + pl.studied + '/' + pl.total + '</span></div>' +
        '<div class="lv-bar"><u style="width:' + p + '%"></u><i style="width:' + mp + '%"></i></div>' +
        '<div class="lv-sub">학습 ' + p + '% · 마스터 ' + mp + '%</div></div>' +
        '<span class="lv-pct">' + p + '%<em>진도</em></span>';
      box.appendChild(row);
    });

    $$('#newPick button').forEach(function (b) { b.classList.toggle('active', +b.dataset.n === +store.settings.newPerDay); });
    $$('#orderPick button').forEach(function (b) { b.classList.toggle('active', b.dataset.order === store.settings.order); });
    $$('#dirPick button').forEach(function (b) { b.classList.toggle('active', b.dataset.dir === store.settings.dir); });
    $('#levelPick').value = String(store.settings.level);
    var tg = $('#basicToggle');
    if (tg) { tg.classList.toggle('on', !!store.settings.includeBasic); tg.setAttribute('aria-checked', store.settings.includeBasic ? 'true' : 'false'); }
    var as = $('#autoSayToggle');
    if (as) { as.classList.toggle('on', !!store.settings.autoSay); as.setAttribute('aria-checked', store.settings.autoSay ? 'true' : 'false'); }
    var mnote = $('#mixNote');
    if (mnote) mnote.textContent = mixLabel(true);
    paintSpeed();
    renderBasis();
  }

  function mixLabel(long) {
    var pref = +store.settings.level;
    if (pref) return 'Lv.' + pref + ' ' + LEVEL_META[pref].name + '만 출제';
    var mix = mixWeights();
    var parts = mix.map(function (m) {
      return 'Lv.' + m.lv + ' ' + m.w + '%' + (m.hard ? '(상위)' : '');
    });
    return (long ? presetObj().label + ' · ' : '') + parts.join(' · ');
  }

  /* ---------------- 수록 기준 · 어휘 사다리 ---------------- */
  function renderBasis() {
    var box = $('#aboutList');
    if (!box) return;
    var meta = META || {};
    var lvOrder = [1, 2, 3, 4, 5, 6];
    var rows = lvOrder.map(function (lv) {
      var m = (meta.levels || {})[lv] || {};
      return '<tr><td><span class="bt-lv l' + lv + '">Lv.' + lv + '</span> <b>' + (m.label || LEVEL_META[lv].name) +
        '</b><span class="bt-sub">' + (m.sub || '') + '</span></td><td>' + (m.count || 0).toLocaleString() +
        '</td><td>' + (m.coverage || '—') + '</td></tr>';
    }).join('');

    var ladder = (meta.ladder || []).map(function (r) {
      return '<div class="ladder-row"><span class="ladder-band">' + r.band + '</span><span class="ladder-goal">' + r.goal + '</span></div>';
    }).join('');

    var comp = lvOrder.map(function (lv) {
      var m = (meta.levels || {})[lv] || {};
      var c = m.comp || {};
      var t = Object.keys(c).map(function (k) { return k + ' ' + c[k].toLocaleString(); }).join(' · ');
      return t ? '<li><b>Lv.' + lv + '</b> ' + t + '</li>' : '';
    }).join('');

    var ce = meta.cefr || {};
    var cefrLine = [1, 2, 3, 4].map(function (lv) {
      var d = ce[lv] || {};
      var t = Object.keys(d).filter(function (k) { return k !== '목록밖'; }).map(function (k) { return k.toUpperCase() + ' ' + d[k]; }).join(' · ');
      return t ? 'Lv.' + lv + ': ' + t : '';
    }).filter(Boolean).join(' / ');

    var refs = (meta.refs || []).map(function (r) { return '<li>' + r + '</li>'; }).join('');

    var L = meta.lists || {};
    var listLine = [];
    if (L.ngsl) listLine.push('NGSL 1.2 ' + L.ngsl.have.toLocaleString() + '/' + L.ngsl.total.toLocaleString());
    if (L.ngsls) listLine.push('NGSL-S ' + L.ngsls.have.toLocaleString() + '/' + L.ngsls.total.toLocaleString());
    if (L.oxford3000) listLine.push('Oxford 3000 ' + L.oxford3000.have.toLocaleString() + '/' + L.oxford3000.total.toLocaleString());
    if (L.oxford5000extra) listLine.push('Oxford 5000 추가분 ' + L.oxford5000extra.have.toLocaleString() + '/' + L.oxford5000extra.total.toLocaleString());

    box.innerHTML =
      '<p class="basis-lead">단어를 <b>쉬운 순서(CEFR A1 → C1)</b>로 줄 세우고, 그 위에 <b>구동사·회화 구문 1,000개</b>, 마지막으로 <b>상황별 실전 통문장 412개</b>를 얹었습니다. ' +
      '“몇 개를 외웠나”가 아니라 <b>“그 단계에서 무슨 말을 할 수 있나”</b>가 기준입니다. ' +
      'A1·A2 단어는 Lv.3·4에 들어가지 않습니다(빌드 검사로 확인).</p>' +
      '<table class="basis-table"><thead><tr><th>단계 · 기준</th><th>개수</th><th>회화 커버</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="basis-block"><b>왜 이 순서인가 — 어휘 사다리</b><div class="ladder">' + ladder + '</div>' +
      '<p class="basis-cap">워드마스터(수능 2000·고등 COMPLETE·하이퍼), 능률보카(고교 필수 2000·수능 완성 2200·고난도), ' +
      '해커스 보카 수능 완성 1800+, 어휘끝 블랙의 단계 구분과 Oxford 3000/5000 CEFR 밴드를 대조해 맞췄습니다. ' +
      '유튜브 회화 채널이 “3,000 이후”로 꼽는 것도 결국 B2·C1의 <b>동사·형용사·부사</b>와 <b>덩어리(구동사·패턴)</b>입니다.</p></div>' +
      '<div class="basis-block"><b>단계별 실제 구성</b><ul>' + comp + '</ul></div>' +
      '<div class="basis-block"><b>CEFR 분포</b><div class="basis-lists">' + cefrLine + '</div>' +
      '<p class="basis-cap">Oxford 5000 표제어 기준. 굴절·파생형과 영국식 철자는 기본형으로 묶었습니다.</p></div>' +
      '<div class="basis-block"><b>표준 목록 수록률</b><div class="basis-lists">' + listLine.join(' · ') + '</div></div>' +
      '<div class="basis-block"><b>참고한 단어장·회화 채널·앱</b><ul class="refs">' + refs + '</ul></div>' +
      '<div class="basis-block"><b>학습 방식</b><ul>' +
      '<li><b>4지선다</b> — 단어→뜻 / 뜻→단어. 오답이면 고른 보기의 뜻을 함께 보여줍니다.</li>' +
      '<li><b>빈칸 채우기</b> — 회화 예문의 핵심 표현을 뚫고 4개 중 고르게 합니다. 정답 뒤에 “왜 이 표현인지” 유사 표현과 비교해 설명합니다.</li>' +
      '<li><b>문장 순서</b> — 한국어를 보고 영어 타일을 순서대로 놓습니다. 틀리면 한 번 더, 두 번째 틀리면 정답과 어순 설명을 봅니다.</li>' +
      '<li><b>플래시카드</b> — 탭해서 뒤집고 알아요/애매해요/몰라요.</li>' +
      '<li><b>SRS</b> — 오답 10분 → 1 → 3 → 7 → 14 → 30일 → 마스터(60일+). 학습 기록은 localStorage에 남고 JSON으로 백업합니다.</li>' +
      '<li><b>학습 모드별 기록</b> — 4지선다·빈칸·순서·카드마다 오늘/누적 학습 수와 정답률을 따로 쌓아 홈과 통계에 보여줍니다.</li>' +
      '<li><b>실전 회화 문장(Lv.6)</b> — 상황 태그를 고르면 그 상황의 질문–응답 쌍을 빈칸·순서·뜻·카드로 돌립니다. 통문장은 한국어를 보고 영어로 말하는 방향으로 연습합니다.</li></ul></div>' +
      '<div class="basis-block"><b>출처</b><ul class="basis-src">' +
      '<li><a href="https://www.newgeneralservicelist.com/new-general-service-list" target="_blank" rel="noopener">NGSL 1.2 · NGSL-Spoken</a> — newgeneralservicelist.com (CC BY-SA)</li>' +
      '<li><a href="https://www.oxfordlearnersdictionaries.com/wordlists/oxford3000-5000" target="_blank" rel="noopener">Oxford 3000 / Oxford 5000 (A1~C1)</a> — oxfordlearnersdictionaries.com</li>' +
      '<li>Gardner &amp; Davies (2007), <i>Pointing Out Frequent Phrasal Verbs</i>, TESOL Quarterly · PHaVE List (Garnier &amp; Schmitt 2015)</li>' +
      '<li>뜻·예문: en-ko-core 어휘팩 (CC BY-SA 4.0, Tatoeba 예문) · 발음기호: ipa-dict (MIT)</li>' +
      '<li>커버리지 참고: Nation (2006) · Adolphs &amp; Schmitt (2003)</li></ul></div>';
    var foot = $('#aboutFoot');
    if (foot) foot.textContent = '학습 기록은 이 기기의 브라우저(localStorage)에만 저장되며 외부로 전송되지 않습니다.';
  }

  $('#basicToggle').addEventListener('click', function () {
    store.settings.includeBasic = !store.settings.includeBasic;
    this.classList.toggle('on', store.settings.includeBasic);
    this.setAttribute('aria-checked', store.settings.includeBasic ? 'true' : 'false');
    $('#mixNote').textContent = mixLabel(true);
    save();
    renderHome();
    toast(store.settings.includeBasic ? 'Lv.1·2 왕기초도 함께 출제해요' : '프리셋 범위만 출제해요');
  });

  var asT = $('#autoSayToggle');
  if (asT) {
    asT.addEventListener('click', function () {
      store.settings.autoSay = !store.settings.autoSay;
      this.classList.toggle('on', store.settings.autoSay);
      this.setAttribute('aria-checked', store.settings.autoSay ? 'true' : 'false');
      save();
      toast(store.settings.autoSay ? '문제가 뜨면 발음을 바로 들려줘요' : '자동 발음을 꼈어요');
    });
  }

  $$('#newPick button').forEach(function (b) {
    b.addEventListener('click', function () {
      store.settings.newPerDay = +b.dataset.n;
      $$('#newPick button').forEach(function (x) { x.classList.toggle('active', x === b); });
      save();
      renderHome();
    });
  });
  $$('#orderPick button').forEach(function (b) {
    b.addEventListener('click', function () {
      store.settings.order = b.dataset.order === 'random' ? 'random' : 'imp';
      $$('#orderPick button').forEach(function (x) { x.classList.toggle('active', x === b); });
      save();
      renderHome();
      toast(store.settings.order === 'random' ? '무작위로 섞어서 출제해요' : '회화 빈도·중요도 순으로 출제해요');
    });
  });
  $$('#dirPick button').forEach(function (b) {
    b.addEventListener('click', function () {
      store.settings.dir = b.dataset.dir;
      $$('#dirPick button').forEach(function (x) { x.classList.toggle('active', x === b); });
      save();
      if (S) S.quizDir = store.settings.dir;
    });
  });
  $('#levelPick').addEventListener('change', function () {
    store.settings.level = +this.value; save();
    var mnote = $('#mixNote');
    if (mnote) mnote.textContent = mixLabel(true);
    renderHome();
  });

  /* 백업 */
  $('#exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify({ app: 'vocab5k', v: 1, exportedAt: new Date().toISOString(), cards: store.cards, stats: store.stats, settings: store.settings }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vocab5k-backup-' + todayKey() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    toast('백업 파일을 내려받았어요');
  });
  $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
  $('#importFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.cards) throw new Error('bad');
        var merged = 0;
        Object.keys(data.cards).forEach(function (k) {
          var inc = data.cards[k];
          var cur = store.cards[k];
          if (!cur || (inc.seen || 0) > (cur.seen || 0) || (inc.st || 0) > (cur.st || 0)) {
            store.cards[k] = Object.assign({}, cur || {}, inc);
            merged++;
          }
        });
        if (data.settings) store.settings = Object.assign(store.settings, data.settings);
        save();
        renderStats(); renderHome();
        toast(merged + '개 카드 기록을 불러왔어요');
      } catch (err) {
        toast('백업 파일을 읽을 수 없어요');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  });

  $('#resetBtn').addEventListener('click', function () {
    if (!confirm('학습 기록을 모두 지울까요? 되돌릴 수 없어요.')) return;
    store.cards = {};
    store.stats = {};
    store.modes = {};
    store.newCount = 0;
    save();
    renderStats(); renderHome();
    toast('기록을 지웠어요');
  });

  /* ---------------- 외부 데이터 도착 ---------------- */
  window.__afterData = function () {
    if (window.VOCAB_LV2 && !LOADED[2]) ingest(2);
    if (window.VOCAB_LV3 && !LOADED[3]) ingest(3);
    if (window.VOCAB_LV4 && !LOADED[4]) ingest(4);
    if (window.VOCAB_LV6 && !LOADED[6]) ingest(6);
    if (currentTab === 'home') renderHome();
    if (currentTab === 'stats') renderStats();
    if (currentTab === 'list') renderList();
  };

  /* 키보드: 1~4 보기 선택, Enter 다음 */
  document.addEventListener('keydown', function (e) {
    if (!S || $('#view-study').hidden) return;
    var fbNext = $('#fbNext');
    if (e.key === 'Enter') {
      e.preventDefault();
      if (fbNext) fbNext.click();
      else if (!$('#orderCard').hidden) checkOrder();
      return;
    }
    if (e.key >= '1' && e.key <= '4') {
      var opts = effMode(current) === 'blank' ? $$('#blankOptions .opt') : $$('#quizOptions .opt');
      var o = opts[+e.key - 1];
      if (o && !o.disabled) { e.preventDefault(); o.click(); }
    }
  });

  /* ================= 🗣️ 말하기 · 발음 교정 ================= */
  var SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  var SP = null;                 /* 지금 말하기 세션 */
  var MIC = { rec: null, listening: false, text: '', onDone: null };
  var spType = 'word';
  var spLv = '0';

  function micSupport() { return !!SRClass; }

  function normWords(str) {
    return String(str || '').toLowerCase()
      .replace(/[\u2019']/g, "'")
      .replace(/[^a-z0-9' ]/g, ' ')
      .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  }

  function levDist(a, b) {
    var m = a.length, n = b.length, i, j, prev = [], cur = [];
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function simRatio(a, b) {
    if (!a || !b) return 0;
    return 1 - levDist(a, b) / Math.max(a.length, b.length);
  }

  /* 원문과 받아쓴 문장을 단어 단위로 맞춰 본다 (정확 일치 → 비슷한 발음 → 놓침) */
  function alignSpeech(target, heard) {
    var T = normWords(target), H = normWords(heard);
    var n = T.length, m = H.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) { dp.push([]); for (j = 0; j <= m; j++) dp[i].push(0); }
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        dp[i][j] = T[i - 1] === H[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    var match = {}, usedH = {};
    i = n; j = m;
    while (i > 0 && j > 0) {
      if (T[i - 1] === H[j - 1]) { match[i - 1] = j - 1; usedH[j - 1] = 1; i--; j--; }
      else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
      else j--;
    }
    var near = {};
    T.forEach(function (w, ti) {
      if (match[ti] != null) return;
      var best = -1, bs = 0.55;
      H.forEach(function (h, hj) {
        if (usedH[hj]) return;
        var s = simRatio(w, h);
        if (s > bs) { bs = s; best = hj; }
      });
      if (best > -1) { near[ti] = best; usedH[best] = 1; }
    });
    var items = T.map(function (w, ti) {
      if (match[ti] != null) return { word: w, state: 'ok', heard: H[match[ti]] };
      if (near[ti] != null) return { word: w, state: 'near', heard: H[near[ti]], sim: Math.round(simRatio(w, H[near[ti]]) * 100) };
      return { word: w, state: 'miss', heard: '' };
    });
    var extras = H.filter(function (h, hj) { return !usedH[hj]; });
    var ok = 0, nr = 0;
    items.forEach(function (x) { if (x.state === 'ok') ok++; else if (x.state === 'near') nr++; });
    var score = n ? Math.round(((ok + nr * 0.6) / n) * 100) : 0;
    if (extras.length) score = Math.max(0, score - Math.min(15, extras.length * 3));
    return { items: items, extras: extras, score: score, target: T, heard: H, ok: ok, near: nr, miss: n - ok - nr };
  }

  function pronTips(words) {
    var out = [];
    function add(t) { if (t && out.indexOf(t) === -1) out.push(t); }
    words.forEach(function (w) {
      if (/th/.test(w)) add('th — 혀끝을 윗니 사이에 살짝 물고 바람을 내보냅니다.');
      else if (/r/.test(w) && /l/.test(w)) add('r·l — r은 혀를 띄우고, l은 혀끝을 윗잇몸에 붙입니다.');
      else if (/r/.test(w)) add('r — 혀끝을 입천장에 닿지 않게 두고 입술을 살짝 오므립니다.');
      else if (/l/.test(w)) add('l — 혀끝을 윗잇몸에 붙이고 소리를 냅니다.');
      if (/v/.test(w)) add('v — 윗니를 아랫입술에 대고 소리 냅니다(b가 아님).');
      if (/f/.test(w)) add('f — 윗니와 아랫입술 사이로 바람만 내보냅니다(p가 아님).');
      if (/z/.test(w)) add('z — 혀를 살짝 대고 떨림을 넣습니다(j가 아님).');
      if (/(tion|sion)$/.test(w)) add('-tion — "션"보다 "shən"에 가깝게.');
      if (/ed$/.test(w)) add('-ed — /t/·/d/·/ɪd/ 중 하나로 끝소리를 살립니다.');
      if (/[bcdfgkpst]$/.test(w)) add('끝 자음 — 약하게라도 끊어 줘야 다른 단어로 인식되지 않습니다.');
    });
    return out.slice(0, 3);
  }

  function paintMic() {
    var b = $('#micBtn');
    if (!b) return;
    b.classList.toggle('on', MIC.listening);
    var hint = $('#micHint');
    if (hint) hint.textContent = MIC.listening ? '듣는 중… 다 말하면 자동으로 채점해요' : '마이크를 눌러 따라 말하세요';
    var live = $('#micLive');
    if (live) live.textContent = MIC.listening ? MIC.text : '';
  }

  /* 한 번 듣고 끝나는 음성인식 — 말하기·회화방이 같이 쓴다 */
  function listenOnce(onText, onEnd, onError) {
    if (!SRClass) { if (onError) onError('unsupported'); return false; }
    if (MIC.listening) { try { MIC.rec.stop(); } catch (e) {} return false; }
    var rec;
    try { rec = new SRClass(); } catch (e) { if (onError) onError('unsupported'); return false; }
    MIC.rec = rec;
    MIC.text = '';
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    var started = false;
    rec.onstart = function () { started = true; MIC.listening = true; paintMic(); };
    rec.onresult = function (ev) {
      var txt = '';
      for (var i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript + ' ';
      MIC.text = txt.replace(/\s+/g, ' ').trim();
      var live = $('#micLive');
      if (live) live.textContent = MIC.text;
      if (onText) onText(MIC.text);
    };
    rec.onerror = function (ev) {
      MIC.listening = false;
      paintMic();
      if (onError) onError(ev && ev.error ? ev.error : 'error');
    };
    rec.onend = function () {
      MIC.listening = false;
      paintMic();
      if (onEnd) onEnd(MIC.text);
    };
    try { rec.start(); } catch (e) { if (onError) onError('start-failed'); return false; }
    /* 마이크가 열리지 않은 채 조용히 끝나는 경우(권한 대기·장치 없음)를 안내한다 */
    setTimeout(function () {
      if (started || MIC.rec !== rec) return;
      try { rec.stop(); } catch (e) {}
      MIC.listening = false;
      paintMic();
      if (onError) onError('timeout');
    }, 7000);
    return true;
  }

  function micErrorText(code) {
    if (code === 'unsupported') return '이 브라우저는 음성인식을 지원하지 않아요. Chrome(안드로이드)이나 Safari에서 열어 주세요.';
    if (code === 'not-allowed' || code === 'service-not-allowed') return '마이크 권한이 거부됐어요. 브라우저 설정에서 마이크를 허용해 주세요.';
    if (code === 'no-speech') return '소리가 잡히지 않았어요. 마이크에 조금 더 가까이 대고 다시 말해 주세요.';
    if (code === 'network') return '음성인식 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
    if (code === 'timeout') return '마이크를 열지 못했어요. 브라우저 설정에서 마이크 권한을 허용해 주세요.';
    return '음성인식을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  }

  function speakPool() {
    var pool;
    if (spLv === 'weak') pool = weakList();
    else if (+spLv) pool = (LEVELS[+spLv] || []).slice();
    else {
      var mix = mixWeights();
      pool = [];
      mix.forEach(function (m) { pool = pool.concat(LEVELS[m.lv] || []); });
      if (!pool.length) pool = allCards();
    }
    if (spType === 'sent') {
      var sent = pool.filter(function (c) { return c._lv === 6 || (c.e && String(c.e).split(/\s+/).length >= 4); });
      if (sent.length >= 5) pool = sent;
    } else {
      var words = pool.filter(function (c) { return c._lv !== 6; });
      if (words.length >= 5) pool = words;
    }
    return pool;
  }

  function speakTargetOf(c) {
    if (!c) return { en: '', ko: '' };
    if (spType === 'sent') {
      return c._lv === 6 ? { en: c.w, ko: c.m || '' } : { en: c.e || c.w, ko: c.k || '' };
    }
    return { en: c.w, ko: c.m || '' };
  }

  function renderSpeak() {
    var note = $('#speakNote');
    if (note) {
      note.innerHTML = micSupport()
        ? '마이크를 쓰려면 브라우저가 <b>마이크 권한</b>을 물어봅니다. 허용하면 바로 채점돼요.'
        : '⚠️ 이 브라우저는 음성인식(SpeechRecognition)을 지원하지 않아요. Chrome 안드로이드·Safari에서 마이크를 쓸 수 있습니다. 대신 듣기·따라 읽기로 연습할 수 있어요.';
    }
    $$('#speakLv .chip').forEach(function (b) { b.classList.toggle('active', b.dataset.lv === spLv); });
    $$('#speakType .seg').forEach(function (b) { b.classList.toggle('active', b.dataset.type === spType); });
    var hist = $('#speakHist');
    if (!hist) return;
    var list = (store.speak || []).slice(0, 12);
    if (!list.length) {
      hist.innerHTML = '<h2 class="card-title">최근 말하기 기록</h2><p class="muted small">아직 기록이 없어요. 10문제만 말해 보면 점수가 쌓입니다.</p>';
      return;
    }
    var avg = Math.round(list.reduce(function (s, x) { return s + (x.score || 0); }, 0) / list.length);
    hist.innerHTML = '<h2 class="card-title">최근 말하기 기록 <span class="muted small">평균 ' + avg + '점</span></h2>' +
      '<div class="hist-list">' + list.map(function (x) {
        return '<div class="hist-row"><span class="hist-w">' + escapeHtml(x.w) + '</span>' +
          '<span class="hist-sc ' + (x.score >= 80 ? 'good' : x.score >= 60 ? 'mid' : 'bad') + '">' + x.score + '점</span>' +
          '<span class="hist-t">' + new Date(x.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + '</span></div>';
      }).join('') + '</div>';
  }

  function startSpeak() {
    var pool = speakPool();
    if (!pool.length) { toast('연습할 카드가 없어요'); return; }
    /* 어제·오늘 따라 말한 문장은 뒤로 — 아직 안 해 본 문장을 먼저 10개 */
    var pick = makeSet(pool, 'speak').map(function (q) { return q.c; });
    SP = { queue: pick, i: 0, results: [] };
    $('#speakSetup').hidden = true;
    if ($('#speakChunks')) $('#speakChunks').innerHTML = '';
    $('#speakRun').hidden = false;
    $('#speakHist').hidden = true;
    $('#tabbar').hidden = true;
    pushLayer();
    speakShow();
  }

  function speakShow() {
    if (!SP) return;
    recReset();   /* 앞 문장의 녹음은 버린다 */
    if (!SP.queue.length) { speakFinish(); return; }
    if (SP.i >= SP.queue.length) { speakFinish(); return; }
    var c = SP.queue[SP.i];
    var t = speakTargetOf(c);
    $('#speakTarget').textContent = t.en;
    $('#speakKo').textContent = t.ko;
    var sc = $('#speakChunks');
    if (sc) {
      sc.innerHTML = chunkPanelHtml(t.en, chunkProtect(c, t.en));
      bindChunkPanel(sc, t.en, chunkProtect(c, t.en));
    }
    $('#speakTarget').classList.toggle('sent', String(t.en).split(/\s+/).length > 3);
    $('#speakTag').textContent = (spType === 'sent' ? '문장을 따라 말해 보세요' : '단어를 따라 말해 보세요') +
      (tagOf(c) ? ' · ' + tagOf(c) : '');
    $('#speakCounter').textContent = (SP.i + 1) + '/' + SP.queue.length;
    $('#speakProg').style.width = Math.round(SP.i / SP.queue.length * 100) + '%';
    $('#speakResult').hidden = true;
    $('#srRetry').hidden = false;
    $('#srNext').textContent = '다음';
    $('#micLive').textContent = '';
    $('#micHint').textContent = '마이크를 눌러 따라 말하세요';
    MIC.text = '';
    if (speakOk) {
      $('#speakListen').hidden = false;
      $('#speakListenSlow').hidden = false;
    }
  }

  function speakCheck(heard) {
    if (!SP || !SP.queue[SP.i]) return;   /* 세트를 마친 뒤 늦게 도착한 인식 결과는 버린다 */
    var c = SP.queue[SP.i];
    var t = speakTargetOf(c);
    var r = alignSpeech(t.en, heard);
    SP.results.push({ score: r.score, w: t.en });
    /* 말하기도 '오늘 본 카드'로 기록 — 다음 세트에서 같은 문장이 또 나오지 않게 */
    rec(c.w).sp = Date.now();
    store.speak = store.speak || [];
    store.speak.unshift({ w: t.en, score: r.score, at: Date.now(), type: spType });
    store.speak = store.speak.slice(0, 60);
    saveNow();

    $('#speakResult').hidden = false;
    $('#srScore').textContent = r.score;
    $('#srSub').textContent = r.score >= 90 ? '거의 원어민 발음이에요.'
      : r.score >= 75 ? '좋아요. 놓친 단어만 잡으면 됩니다.'
      : r.score >= 50 ? '절반은 들렸어요. 빨간 단어를 천천히 다시 말해 보세요.'
      : '인식된 단어가 적어요. 🐢 0.75x로 듣고 한 단어씩 따라 해 보세요.';
    $('#srWords').innerHTML = r.items.map(function (x) {
      var cls = x.state === 'ok' ? 'ok' : x.state === 'near' ? 'near' : 'miss';
      return '<span class="sw ' + cls + '">' + escapeHtml(x.word) +
        (x.state === 'near' ? '<em>' + escapeHtml(x.heard) + '</em>' : '') + '</span>';
    }).join('');
    $('#srHeard').textContent = r.heard.length
      ? '들은 문장: ' + r.heard.join(' ') + (r.extras.length ? ' (덧붙임: ' + r.extras.join(' ') + ')' : '')
      : '아무것도 인식되지 않았어요.';
    var tips = pronTips(r.items.filter(function (x) { return x.state !== 'ok'; }).map(function (x) { return x.word; }));
    if (!tips.length && r.score < 90) tips.push('단어를 붙여 한 호흡으로 말해 보세요. 끊어 읽으면 인식률이 떨어집니다.');
    tips.push('점수는 브라우저 음성인식 결과 기준이라 실제 발음과 조금 다를 수 있어요.');
    $('#srTips').innerHTML = tips.map(function (t) { return '<p class="tip"><i>💡</i>' + escapeHtml(t) + '</p>'; }).join('');
    $('#speakResult').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function speakFinish() {
    if (!SP) return;
    var n = SP.results.length;
    if (!n) { endSpeakRun(); return; }
    var avg = Math.round(SP.results.reduce(function (s, x) { return s + x.score; }, 0) / n);
    var bar = $('#speakCounter');
    if (bar) bar.textContent = n + '/' + n;
    $('#speakProg').style.width = '100%';
    $('#speakTarget').textContent = n + '문제 완료 · 평균 ' + avg + '점';
    $('#speakKo').textContent = '수고했어요. 점수가 낮은 단어는 단어장에서 다시 들어 보세요.';
    if ($('#speakChunks')) $('#speakChunks').innerHTML = '';
    /* 결과 카드를 요약으로 다시 씀 — 「10문제 더」로 바로 다음 세트 */
    $('#srScore').textContent = avg;
    $('#srSub').textContent = n + '문제 평균 점수예요.';
    $('#srWords').innerHTML = SP.results.map(function (r) {
      var cls = r.score >= 85 ? 'ok' : r.score >= 60 ? 'near' : 'miss';
      return '<span class="sw ' + cls + '">' + escapeHtml(r.w) + '<em>' + r.score + '</em></span>';
    }).join('');
    $('#srHeard').textContent = '';
    $('#srTips').innerHTML = '<p class="tip"><i>💡</i>다음 세트는 아직 따라 말해 보지 않은 문장부터 나옵니다.</p>';
    $('#srRetry').hidden = true;
    $('#srNext').textContent = '10문제 더';
    $('#speakResult').hidden = false;
    if ($('#micHint')) $('#micHint').textContent = '한 세트를 마쳤어요 — 「10문제 더」로 이어서 하세요';
    toast('말하기 ' + n + '문제 · 평균 ' + avg + '점');
    SP = { queue: [], i: 0, results: SP.results };
  }

  function endSpeakRun() {
    SP = null;
    recReset();
    if ($('#speakChunks')) $('#speakChunks').innerHTML = '';
    $('#speakRun').hidden = true;
    $('#speakSetup').hidden = false;
    $('#speakHist').hidden = false;
    showTab('speak');
    $('#tabbar').hidden = false;
  }

  if ($('#speakStart')) {
    $('#speakStart').addEventListener('click', startSpeak);
    $$('#speakType .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        spType = b.dataset.type;
        $$('#speakType .seg').forEach(function (x) { x.classList.toggle('active', x === b); });
      });
    });
    $$('#speakLv .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        spLv = b.dataset.lv;
        $$('#speakLv .chip').forEach(function (x) { x.classList.toggle('active', x === b); });
      });
    });
    $('#speakExit').addEventListener('click', function () {
      if (SP && SP.i > 0 && SP.i < SP.queue.length) toast('말하기 기록은 저장됐어요');
      endSpeakRun();
    });
    $('#speakListen').addEventListener('click', function () {
      if (SP) speak(speakTargetOf(SP.queue[SP.i]).en);
    });
    $('#speakListenSlow').addEventListener('click', function () {
      if (SP) speak(speakTargetOf(SP.queue[SP.i]).en, 0.75);
    });
    $('#speakSpeedBtn').addEventListener('click', function () {
      store.settings.speed = speedRate() === 0.75 ? 1 : 0.75;
      $('#speakSpeedBtn').textContent = speedRate() === 0.75 ? '🐢 0.75x' : '🔊 1.0x';
      save();
    });
    $('#speakSkip').addEventListener('click', function () {
      if (!SP || !SP.queue.length) return;
      SP.i++;
      speakShow();
    });
    $('#micBtn').addEventListener('click', function () {
      if (!SP) return;
      if (!SP.queue.length) { toast('한 세트를 마쳤어요 — 「10문제 더」로 이어서 하세요'); return; }
      if (!micSupport()) { toast(micErrorText('unsupported')); return; }
      if (MIC.listening) { try { MIC.rec.stop(); } catch (e) {} return; }
      listenOnce(null, function (txt) {
        if (!txt) { toast('아무것도 인식되지 않았어요. 다시 말해 보세요.'); return; }
        speakCheck(txt);
      }, function (err) { toast(micErrorText(err)); });
    });
    $('#srRetry').addEventListener('click', function () {
      $('#speakResult').hidden = true;
      MIC.text = '';
      $('#micLive').textContent = '';
      $('#micHint').textContent = '마이크를 눌러 다시 말하세요';
    });
    $('#srNext').addEventListener('click', function () {
      if (!SP) return;
      if (!SP.queue.length) { startSpeak(); return; }   /* 완료 화면의 「10문제 더」 */
      SP.i++;
      speakShow();
    });
    $('#goSpeak').addEventListener('click', function () { goTab('speak'); });
  }

  /* ================= 💬 AI 회화방 ================= */
  var CHAT_TOPICS = [
    {
      id: 'free', icon: '💬', name: '자유 대화', sub: '아무 주제나',
      open: { en: 'Hi! Nice to talk with you. What would you like to talk about today?', ko: '안녕하세요! 오늘은 무슨 이야기를 해볼까요?' },
      hints: ['I want to talk about my day.', 'Can we talk about travel?', 'I practiced English today.'],
      pattern: { pat: 'I want to talk about ___.', slots: ['my day', 'travel', 'a movie I watched'] },
      script: [
        { en: 'That sounds interesting. Tell me more about it.', ko: '흥미롭네요. 조금 더 말해 주세요.', hint: 'It was really fun because…' },
        { en: 'I see. How did that make you feel?', ko: '그렇군요. 기분은 어땠어요?', hint: 'I felt happy / nervous / tired.' },
        { en: 'Nice. What are you planning to do next?', ko: '좋네요. 다음엔 뭘 할 계획이에요?', hint: "I'm planning to…" }
      ]
    },
    {
      id: 'cafe', icon: '☕', name: '카페 주문', sub: '주문·사이즈·포장',
      open: { en: 'Hi there! Welcome. What can I get for you?', ko: '어서 오세요! 무엇을 드릴까요?' },
      hints: ['Can I get a large iced Americano, please?', "I'd like a latte, please.", 'Could I have a cappuccino?'],
      pattern: { pat: 'Could I get ___, please?', slots: ['a large iced Americano', 'a hot latte', 'two croissants'] },
      script: [
        { en: 'Sure. What size would you like — small, medium, or large?', ko: '네. 사이즈는 어떻게 하시겠어요?', hint: 'Large, please.' },
        { en: 'Got it. For here or to go?', ko: '네. 드시고 가시나요, 포장인가요?', hint: 'To go, please.' },
        { en: 'Anything else? We have fresh croissants today.', ko: '더 필요하세요? 오늘 크루아상이 나왔어요.', hint: 'No, that’s all. / I’ll take one.' },
        { en: "That'll be five dollars fifty. Cash or card?", ko: '5달러 50센트입니다. 현금이세요, 카드세요?', hint: 'Card, please.' },
        { en: 'Here you go. Have a nice day!', ko: '여기 있습니다. 좋은 하루 보내세요!', hint: 'Thank you, you too.' }
      ]
    },
    {
      id: 'airport', icon: '✈️', name: '공항·여행', sub: '체크인·수하물',
      open: { en: 'Good morning. May I see your passport, please?', ko: '안녕하세요. 여권 좀 보여 주시겠어요?' },
      hints: ['Here you are.', "Sure, here's my passport.", 'Yes, of course.'],
      pattern: { pat: "I'm flying to ___.", slots: ['New York', 'Tokyo', 'Busan'] },
      script: [
        { en: 'Thank you. Where are you flying to today?', ko: '감사합니다. 오늘 어디로 가시나요?', hint: "I'm flying to New York." },
        { en: 'Any bags to check?', ko: '부치실 짐이 있나요?', hint: 'Just this one, please.' },
        { en: 'Window or aisle?', ko: '창가석과 통로석 중 어느 쪽으로 드릴까요?', hint: 'An aisle seat, please.' },
        { en: 'Here is your boarding pass. Boarding starts at 10:20 at gate 14.', ko: '탑승권입니다. 10시 20분에 14번 게이트에서 탑승합니다.', hint: 'Thank you. Where is gate 14?' }
      ]
    },
    {
      id: 'biz', icon: '💼', name: '비즈니스 스몰토크', sub: '업무·일정·근황',
      open: { en: 'Morning! How is the project going?', ko: '좋은 아침이에요! 프로젝트는 어떻게 되어 가요?' },
      hints: ["It's going well, thanks.", "We're almost done.", "We hit a small delay."],
      pattern: { pat: "It's going ___.", slots: ['well, thanks', 'a bit slow', 'better than expected'] },
      script: [
        { en: 'Good to hear. Do you need anything from my side?', ko: '다행이네요. 제가 도와드릴 게 있을까요?', hint: 'Could you review the draft by Friday?' },
        { en: 'Sure, I can do that. When is the deadline again?', ko: '그럼요. 마감이 언제였죠?', hint: "It's due on the 24th." },
        { en: "Perfect. Let's sync tomorrow at ten.", ko: '좋아요. 내일 10시에 다시 얘기하죠.', hint: 'Works for me.' },
        { en: 'Great. I will send you the invite.', ko: '좋습니다. 초대장 보내 드릴게요.', hint: 'Thanks, I appreciate it.' }
      ]
    },
    {
      id: 'daily', icon: '🙋', name: '일상 안부', sub: '근황·주말',
      open: { en: 'Hey! Long time no see. How have you been?', ka: '', ko: '오랜만이야! 어떻게 지냈어?' },
      hints: ["I've been busy but good.", "Pretty good, thanks. How about you?", "Not bad. How are you?"],
      pattern: { pat: "I've been ___.", slots: ['busy but good', 'pretty good, thanks', 'a little tired'] },
      script: [
        { en: 'Same here. Did you do anything fun on the weekend?', ko: '나도 그래. 주말에 재미있는 일 있었어?', hint: 'I went hiking with friends.' },
        { en: 'That sounds great. How was the weather?', ko: '좋았겠다. 날씨는 어땠어?', hint: 'It was cold but sunny.' },
        { en: 'Nice. We should do something together soon.', ko: '좋네. 조만간 같이 뭐 하자.', hint: 'Sure, let me know when you are free.' }
      ]
    },
    {
      id: 'restaurant', icon: '🍽️', name: '식당 예약', sub: '인원·시간·이름',
      open: { en: 'Thank you for calling Bella Kitchen. How may I help you?', ko: '벨라 키친입니다. 무엇을 도와드릴까요?' },
      hints: ["I'd like to make a reservation.", 'I want to book a table for two.', 'Can I reserve a table?'],
      pattern: { pat: "I'd like to make a reservation for ___.", slots: ['two people at seven', 'four people tonight', 'a table for six on Friday'] },
      script: [
        { en: 'Of course. For how many people?', ko: '네. 몇 분이세요?', hint: 'For four people, please.' },
        { en: 'And what time would you like?', ko: '몇 시로 예약해 드릴까요?', hint: 'Seven thirty, please.' },
        { en: 'May I have your name and phone number?', ko: '성함과 전화번호를 알려 주시겠어요?', hint: 'It’s Bumsoo, and my number is…' },
        { en: 'You are all set for 7:30. We will see you then.', ko: '7시 30분으로 예약됐습니다. 그때 뵙겠습니다.', hint: 'Thank you. See you then.' }
      ]
    },
    {
      id: 'shopping', icon: '🛍️', name: '쇼핑·환불', sub: '교환·환불·영수증',
      open: { en: 'Hi, how can I help you today?', ko: '안녕하세요, 무엇을 도와드릴까요?' },
      hints: ['I want to return this shirt.', 'This item is too small.', 'Can I get a refund?'],
      pattern: { pat: 'I want to ___.', slots: ['return this shirt', 'get a refund on this', 'exchange this for a bigger size'] },
      script: [
        { en: 'I see. Do you have the receipt with you?', ko: '그렇군요. 영수증 가지고 계세요?', hint: 'Yes, here it is.' },
        { en: 'Thank you. Was it worn or washed?', ko: '감사합니다. 입거나 세탁하셨나요?', hint: 'No, I only tried it on.' },
        { en: 'Would you like a refund or an exchange?', ko: '환불과 교환 중 어느 쪽으로 해 드릴까요?', hint: 'I’d like a refund, please.' },
        { en: 'No problem. It will be back on your card in three days.', ko: '문제없습니다. 3일 안에 카드로 환불됩니다.', hint: 'Thank you for your help.' }
      ]
    }
  ];

  /* --- 내장 교정기: 시제·관사·전치사·콩글리시를 잡고 더 자연스러운 문장을 제안 --- */
  var KONGLISH = [
    [/\bhand[ -]?phone\b/gi, 'cell phone', 'handphone은 콩글리시 — 미국식은 cell phone / 영국식은 mobile phone'],
    [/\beye shopping\b/gi, 'window shopping', 'eye shopping은 콩글리시 — window shopping'],
    [/\bskinship\b/gi, 'physical affection', 'skinship은 콩글리시 — physical affection / hugging'],
    [/\bfighting\b/gi, 'you can do it', 'fighting은 콩글리시 — You can do it! / Go for it!'],
    [/\bself[ -]?camera\b/gi, 'selfie', 'self camera는 콩글리시 — selfie'],
    [/\bservice\b(?=\s+(is|was|free|charge))/gi, 'free of charge', 'service(서비스)는 콩글리시 — free / on the house'],
    [/\bone[ -]?plus[ -]?one\b/gi, 'two for one', 'one plus one은 콩글리시 — two for one / buy one get one'],
    [/\bnotebook\b(?=\s+(computer|pc)\b)/gi, 'laptop', 'notebook computer보다 laptop이 자연스럽습니다'],
    [/\bdrink party\b/gi, 'get-together', 'drink party는 콩글리시 — get-together / drinks']
  ];

  var GRAMMAR_FIX = [
    [/\b(i|we|they|you)\s+very\s+(like|love|enjoy|want)\b/gi, '$1 really $2', 'very는 동사를 꾸미지 못합니다 — really'],
    [/\b(he|she|it)\s+very\s+(like|love|enjoy|want)s?\b/gi, '$1 really $2s', 'very는 동사를 꾸미지 못합니다 — really'],
    [/\bdiscuss\s+about\b/gi, 'discuss', 'discuss는 타동사라 about을 쓰지 않습니다'],
    [/\bexplain\s+me\b/gi, 'explain to me', 'explain 뒤에는 to + 사람이 옵니다'],
    [/\bmarried\s+with\b/gi, 'married to', '결혼 상대는 be married to'],
    [/\bdepend(s|ed)?\s+of\b/gi, 'depend$1 on', 'depend는 on과 씁니다'],
    [/\barrive\s+to\b/gi, 'arrive at', 'arrive는 at(장소)/in(도시·나라)과 씁니다'],
    [/\blisten\s+(music|the music)\b/gi, 'listen to $1', 'listen은 자동사라 to가 필요합니다'],
    [/\bgo\s+to\s+home\b/gi, 'go home', 'home은 부사라 to를 쓰지 않습니다'],
    [/\bcontact\s+to\s+me\b/gi, 'contact me', 'contact는 타동사라 to가 필요 없습니다'],
    [/\breply\s+me\b/gi, 'reply to me', 'reply는 자동사라 to가 필요합니다'],
    [/\bi\s+am\s+agree\b/gi, 'I agree', 'agree는 동사라 be동사를 쓰지 않습니다'],
    [/\bmore\s+better\b/gi, 'better', 'better는 이미 비교급이라 more를 붙이지 않습니다'],
    [/\bmost\s+(best|easiest|worst)\b/gi, '$1', '최상급에는 most를 겹쳐 쓰지 않습니다'],
    [/\bdidn'?t\s+went\b/gi, "didn't go", 'didn’t 뒤에는 동사원형'],
    [/\bhow\s+much\s+(is\s+it\s+cost|does\s+it\s+cost\s+is)\b/gi, 'how much does it cost', '의문문 어순을 확인하세요'],
    [/\bhow\s+do\s+you\s+think\b/gi, 'what do you think', '의견을 물을 때는 What do you think?'],
    [/\bi'?m\s+boring\b/gi, "I'm bored", 'boring은 남을 지루하게 하는 것, 내가 지루하면 bored'],
    [/\bi'?m\s+exciting\b/gi, "I'm excited", 'exciting은 남을 흥분시키는 것, 내가 신나면 excited'],
    [/\bi\s+very\s+like\b/gi, 'I really like', 'very는 동사를 꾸미지 못합니다'],
    [/\bwant\s+that\s+you\b/gi, 'want you to', 'want는 to부정사를 받습니다'],
    [/\bsuggest\s+me\b/gi, 'suggest to me', 'suggest 뒤에는 to + 사람'],
    [/\bcall\s+to\s+me\b/gi, 'call me', 'call은 타동사라 to가 필요 없습니다'],
    [/\blook\s+forward\s+to\s+(meet|see)\b/gi, 'look forward to $1', 'look forward to 뒤에는 동명사(-ing)'],
    [/\bcan\s+you\s+repeat\s+again\b/gi, 'could you say that again', 'repeat에 again을 겹치지 않습니다'],
    [/\b(i|we|they|you)\s+is\b/gi, function (m, p) { return (p.toLowerCase() === 'i' ? 'I am' : p + ' are'); }, '주어와 be동사를 맞춰야 합니다'],
    [/\b(he|she|it)\s+are\b/gi, '$1 is', '주어와 be동사를 맞춰야 합니다']
  ];

  var PAST = { go: 'went', come: 'came', eat: 'ate', see: 'saw', meet: 'met', buy: 'bought', make: 'made', take: 'took', get: 'got', have: 'had', do: 'did', say: 'said', know: 'knew', think: 'thought', feel: 'felt', find: 'found', give: 'gave', tell: 'told', watch: 'watched', play: 'played', study: 'studied', work: 'worked', is: 'was', are: 'were', am: 'was', drink: 'drank', sleep: 'slept', read: 'read', write: 'wrote', drive: 'drove', run: 'ran', stay: 'stayed', visit: 'visited' };
  var THIRD = { go: 'goes', do: 'does', have: 'has', want: 'wants', like: 'likes', need: 'needs', make: 'makes', take: 'takes', come: 'comes', eat: 'eats', see: 'sees', know: 'knows', think: 'thinks', feel: 'feels', get: 'gets', give: 'gives', say: 'says', watch: 'watches', play: 'plays', study: 'studies', work: 'works' };

  function correctEnglish(text) {
    var out = String(text || '').trim();
    var notes = [];
    function apply(re, rep, why) {
      out = out.replace(re, function () {
        var args = arguments;
        var rep2 = typeof rep === 'function' ? rep.apply(null, args) : rep.replace(/\$(\d)/g, function (m2, d) { return args[+d] || ''; });
        var from = args[0];
        if (rep2 && rep2 !== from) notes.push({ from: from, to: rep2, why: why });
        return rep2;
      });
    }
    KONGLISH.forEach(function (r) { apply(r[0], r[1], r[2]); });
    GRAMMAR_FIX.forEach(function (r) { apply(r[0], r[1], r[2]); });
    /* 과거 시점 + 현재형 동사 */
    if (/\b(yesterday|last (night|week|month|year)|ago)\b/i.test(out)) {
      var best = null;
      Object.keys(PAST).forEach(function (v) {
        var re = new RegExp('(?<!to\\s)\\b' + v + '\\b', 'i');
        var mm = re.exec(out);
        if (mm && (!best || mm.index < best.index)) best = { v: v, index: mm.index, len: mm[0].length };
      });
      if (best) {
        out = out.slice(0, best.index) + PAST[best.v] + out.slice(best.index + best.len);
        notes.push({ from: best.v, to: PAST[best.v], why: '과거 시점(yesterday/last~)이 있어 동사를 과거형으로' });
      }
    }
    /* 3인칭 단수 */
    var m3 = out.match(/\b(he|she|it)\s+([a-z]+)\b/i);
    if (m3 && THIRD[m3[2].toLowerCase()]) {
      var rep3 = THIRD[m3[2].toLowerCase()];
      var head3 = m3[0].split(/\s+/)[0];
      out = out.replace(m3[0], head3 + ' ' + rep3);
      notes.push({ from: m3[2], to: rep3, why: '3인칭 단수 주어에는 동사에 -s' });
    }
    out = out.replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    if (out) out = out.charAt(0).toUpperCase() + out.slice(1);

    /* 더 자연스러운 원어민 대안 — 규칙에 걸릴 때만 제안한다 */
    var natural = '';
    var low = out.toLowerCase();
    if (/^i (want|need) (a |an |some )?(.+)$/.test(low)) {
      natural = out.replace(/^I (want|need)/i, 'Could I get');
      if (natural.indexOf('?') === -1) natural += ', please?';
    } else if (/^give me (.+)$/i.test(out)) {
      natural = out.replace(/^Give me (.+?)\.?$/i, 'Could I have $1, please?');
    } else if (/^where is the (toilet|bathroom)\??$/i.test(out)) {
      natural = 'Could you tell me where the restroom is?';
    } else if (/^i don'?t know\.?$/i.test(out)) {
      natural = "I'm not sure, actually.";
    } else if (/^yes\.?$/i.test(out)) {
      natural = 'Yes, please.';
    } else if (/^no\.?$/i.test(out)) {
      natural = 'No, thanks.';
    }
    return { corrected: out, notes: notes, natural: natural === out ? '' : natural };
  }

  var chatTopic = null;
  var chatBusy = false;
  var chatRuleSel = [];      /* 자주 고친 표현 칩 → 고른 규칙들(여러 개를 함께 고를 수 있다) */
  var chatFixDay = '';       /* '이번 주' 막대에서 고른 칸(YYYY-MM-DD) — '' 이면 해제. 화면 상태라 저장하지 않는다 */
  function ruleLabel() { return chatRuleSel.join('·'); }
  function dayText(key) {
    if (!key) return '';
    var d = new Date(key + 'T00:00:00');
    var WD = ['일', '월', '화', '수', '목', '금', '토'];
    return key.slice(5).replace('-', '.') + '(' + WD[d.getDay()] + ')';
  }
  /* 노트가 어느 규칙에 걸렸는지 — 규칙 이름이 없으면 바뀐 구절로 대신한다(집계와 같은 기준) */
  function noteWhy(n) { return (n && n.why) || ((n && n.from || '') + ' → ' + (n && n.to || '')); }

  function chatStore(id) {
    store.chat = store.chat || {};
    var t = store.chat[id];
    if (!t) t = store.chat[id] = { turns: [], step: 0, at: Date.now() };
    t.turns = t.turns || [];
    return t;
  }

  function chatHistoryCount() {
    var n = 0;
    Object.keys(store.chat || {}).forEach(function (k) { n += (store.chat[k].turns || []).filter(function (t) { return t.role === 'me'; }).length; });
    return n;
  }

  /* 회화방 '내 문장 기록' — 내가 고친 곳을 세어 오늘 N곳·누적 M곳과 자주 고친 규칙을 보여 준다.
     저장 구조는 그대로(turns[].notes)라 예전 기록도 그대로 집계된다. */
  /* 기간 보기 — 최근 7일 / 최근 30일 / 전체. 화면 보기 설정이라 저장하지 않는다
     (학습 기록 turns[].notes 구조를 그대로 읽어 그때그때 집계하므로 저장 구조는 무수정).
     같은 길이의 '지난 창'과 비교해 교정이 줄고 있는지 보여 주고, 규칙별 막대는
     필터로 고른 규칙의 미니 추이가 된다. */
  var chatFixPeriod = 7;                       /* -1(이번 주) | 7 | 30 | 0(전체) */
  var FIX_PERIODS = [-1, 7, 30, 0];
  function fixPeriodLabel(p) { return p === 0 ? '전체' : p === -1 ? '이번 주' : '최근 ' + p + '일'; }
  /* 주 시작은 월요일 고정(사용자 기준). 이번 주는 진행 중이라 지난주 '같은 시점까지'와 견준다 */
  function mondayStart(t) {
    var d = new Date(t); d.setHours(0, 0, 0, 0);
    var wd = (d.getDay() + 6) % 7;             /* 월=0 … 일=6 */
    return d.getTime() - wd * 86400000;
  }

  function chatFixStats() {
    var DAY = 86400000;
    var today = todayKey();
    var startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    var t0 = startToday.getTime();
    var wk0 = mondayStart(t0);
    var p = chatFixPeriod === 30 || chatFixPeriod === 0 || chatFixPeriod === -1 ? chatFixPeriod : 7;
    var span = 0, from = -Infinity, prevFrom = -Infinity, prevEnd = -Infinity;
    if (p === 0) {
      /* 전체 — 비교 상대 없음 */
    } else if (p === -1) {
      from = wk0;                                /* 월요일 0시부터 오늘까지 */
      prevFrom = wk0 - 7 * DAY;
      prevEnd = prevFrom + (Date.now() - wk0);   /* 지난주 같은 시점까지 */
    } else {
      span = p * DAY;                            /* 창 길이 */
      from = t0 - (p - 1) * DAY;                 /* 이번 창 시작 */
      prevFrom = from - span;                    /* 지난 창 시작 */
      prevEnd = from;
    }
    var acc = {
      all: 0, today: 0, week: 0, prevWeek: 0, thisWeek: 0, lastWeekSame: 0, wk0: wk0,
      p: p, pn: 0, pprev: 0, pRules: {}, rules: {}, weekRules: {}, top: [], week7: [],
      series: [], unit: p === 0 ? 'week' : 'day', ruleSeries: null, ruleWhy: '',
      firstAt: 0, weeks: 0, todayIdx: p === -1 ? Math.round((t0 - wk0) / DAY) : (p === 0 ? -1 : p - 1)
    };
    var byDay = {};
    for (var d = 0; d < 7; d++) byDay[todayKey(new Date(t0 - d * DAY))] = 0;
    var days = {};                 /* 날짜(YYYY-MM-DD) → 그날 고친 곳 수 */
    var ruleDay = {};              /* 규칙 → { 날짜: 곳 수 } */
    Object.keys(store.chat || {}).forEach(function (id) {
      var t = store.chat[id];
      if (!t || !t.turns) return;
      t.turns.forEach(function (m) {
        if (m.role !== 'me') return;
        var notes = m.notes || [];
        /* 규칙에 걸리지 않고 LLM이 문장만 고친 경우도 1곳으로 센다 */
        if (!notes.length && m.corrected && m.corrected !== m.text) {
          notes = [{ from: m.text, to: m.corrected, why: '더 자연스러운 표현' }];
        }
        if (!notes.length) return;
        var at = m.at || 0;
        var dk = todayKey(new Date(at));
        var n = notes.length;
        acc.all += n;
        if (!acc.firstAt || at < acc.firstAt) acc.firstAt = at;
        if (dk === today) acc.today += n;
        if (at >= t0 - 6 * DAY) acc.week += n;
        else if (at >= t0 - 13 * DAY) acc.prevWeek += n;
        if (at >= wk0) acc.thisWeek += n;
        if (at >= wk0 - 7 * DAY && at < wk0 - 7 * DAY + (Date.now() - wk0)) acc.lastWeekSame += n;
        if (byDay[dk] != null) byDay[dk] += n;
        days[dk] = (days[dk] || 0) + n;
        if (at >= from) acc.pn += n;
        else if (at >= prevFrom && at < prevEnd) acc.pprev += n;
        notes.forEach(function (x) {
          var k = x.why || ((x.from || '') + ' → ' + (x.to || ''));
          acc.rules[k] = (acc.rules[k] || 0) + 1;
          if (at >= t0 - 6 * DAY) acc.weekRules[k] = (acc.weekRules[k] || 0) + 1;
          if (at >= from) acc.pRules[k] = (acc.pRules[k] || 0) + 1;
          ruleDay[k] = ruleDay[k] || {};
          ruleDay[k][dk] = (ruleDay[k][dk] || 0) + 1;
        });
      });
    });
    acc.top = Object.keys(acc.rules).map(function (k) {
      return { why: k, n: acc.rules[k], w: acc.weekRules[k] || 0, p: acc.pRules[k] || 0 };
    }).sort(function (a, b) { return (b.p - a.p) || (b.n - a.n) || (b.w - a.w); }).slice(0, 4);
    /* 오래된 날 → 오늘 순 7칸(최근 7일 띠는 기간과 무관하게 늘 계산) */
    for (var i = 6; i >= 0; i--) {
      var key = todayKey(new Date(t0 - i * DAY));
      acc.week7.push({ d: key, n: byDay[key] || 0 });
    }
    /* 날짜 목록 — offset 0 이 오늘 */
    var dayList = [];
    for (var off = 0; off < 400; off++) {
      var dk2 = todayKey(new Date(t0 - off * DAY));
      dayList.push({ off: off, key: dk2 });
    }
    /* 막대 — 이번 주: 월~일 7칸 · 7일: 7칸 · 30일: 30칸 · 전체: 기록이 있는 만큼 7일 묶음(최대 12주) */
    function seriesOf(get) {
      var out = [], oldest = 0, i2;
      if (p === -1) {
        var WDL = ['월', '화', '수', '목', '금', '토', '일'];
        for (var wj = 0; wj < 7; wj++) {
          var wkey = todayKey(new Date(wk0 + wj * DAY));
          out.push({ n: get({ key: wkey }), key: wkey, label: wkey.slice(5) + '(' + WDL[wj] + ')' });
        }
        return out;
      }
      for (i2 = 0; i2 < dayList.length; i2++) if (get(dayList[i2])) oldest = i2;
      if (p === 0) {
        var nb = Math.min(12, Math.floor(oldest / 7) + 1);
        for (var j = nb - 1; j >= 0; j--) {
          var sum = 0, hi = j * 7, lo = Math.min(j * 7 + 6, dayList.length - 1);
          for (var k2 = hi; k2 <= lo; k2++) sum += get(dayList[k2]);
          out.push({ n: sum, key: dayList[hi].key, label: dayList[lo].key.slice(5) + '~' + dayList[hi].key.slice(5) });
        }
      } else {
        for (var j2 = p - 1; j2 >= 0; j2--) {
          out.push({ n: get(dayList[j2]), key: dayList[j2].key, label: dayList[j2].key.slice(5) });
        }
      }
      return out;
    }
    acc.series = seriesOf(function (x) { return days[x.key] || 0; });
    /* 고른 규칙들(1~4개)의 합 — 칩을 여러 개 골라도 미니 추이는 한 줄로 견준다 */
    if (chatRuleSel.length) {
      var rds = chatRuleSel.map(function (k) { return ruleDay[k] || {}; });
      acc.ruleWhy = ruleLabel();
      acc.ruleRules = chatRuleSel.slice();
      acc.ruleSeries = seriesOf(function (x) {
        var rn = 0;
        rds.forEach(function (rd) { rn += rd[x.key] || 0; });
        return rn;
      });
    }
    /* '이번 주' 막대에서 고른 칸 — 그날 기록만 보는 하위 필터 */
    if (p === -1 && chatFixDay) {
      var prevDayKey = todayKey(new Date(new Date(chatFixDay + 'T00:00:00').getTime() - 7 * DAY));
      acc.dayKey = chatFixDay;
      acc.dayN = days[chatFixDay] || 0;
      acc.dayPrev = days[prevDayKey] || 0;
      acc.dayLabel = dayText(chatFixDay);
      /* 규칙까지 골랐으면 그날 그 규칙들의 합 — 미니 추이 문구가 기간과 어긋나지 않게 */
      acc.dayRuleN = chatRuleSel.length ? chatRuleSel.reduce(function (s, k) {
        return s + ((ruleDay[k] || {})[chatFixDay] || 0);
      }, 0) : null;
    }
    /* 전체 기간의 주 수 — 주 평균을 내기 위해 */
    if (acc.firstAt) {
      var f0 = new Date(acc.firstAt); f0.setHours(0, 0, 0, 0);
      acc.weeks = Math.max(1, Math.ceil((t0 + DAY - f0.getTime()) / (7 * DAY)));
    }
    return acc;
  }

  /* 고른 규칙 하나의 미니 추이 — 같은 기간 안에서 이 표현이 몇 번 걸렸는지 */
  function ruleMiniTrend(fx) {
    var ser = fx.ruleSeries || [];
    var max = 1;
    ser.forEach(function (d) { if (d.n > max) max = d.n; });
    var sum = 0, prevHalf = 0;
    ser.forEach(function (d, i) { sum += d.n; });
    var half = Math.floor(ser.length / 2);
    for (var i = 0; i < half; i++) prevHalf += ser[i].n;
    var nowHalf = sum - prevHalf;
    var word = fx.dayKey ? fx.dayLabel : fixPeriodLabel(fx.p);
    var many = (fx.ruleRules || []).length > 1;
    var onDay = !!fx.dayKey;
    var sumShow = onDay && fx.dayRuleN != null ? fx.dayRuleN : sum;
    return '<div class="fix-rule" aria-label="' + escapeHtml(fx.ruleWhy) + ' 추이">' +
      '<span class="fix-rule-t">' + (many ? '이 표현들' : '이 표현') + ' · ' + word + ' <b>' + sumShow + '</b>곳' +
      (!onDay && ser.length > 1 ? ' · 앞 절반보다 ' + (nowHalf === prevHalf ? '같아요' : (nowHalf < prevHalf ? (prevHalf - nowHalf) + '곳 적어요' : (nowHalf - prevHalf) + '곳 많아요')) : '') +
      '</span>' +
      '<div class="fix-bars' + (ser.length > 10 ? ' dense' : '') + '">' + ser.map(function (d) {
        return '<i class="' + (d.n ? '' : ' zero') + '" style="height:' + (3 + Math.round(d.n / max * 14)) + 'px" title="' + escapeHtml(d.label) + ' · ' + d.n + '곳"></i>';
      }).join('') + '</div></div>';
  }

  /* 내가 고친 문장에 실제로 들어 있던 카드를 찾는다 — 교정 → 학습 모드로 이어지는 다리 */
  function correctionCards(limit) {
    var bag = [];
    Object.keys(store.chat || {}).forEach(function (id) {
      var t = store.chat[id];
      if (!t || !t.turns) return;
      t.turns.forEach(function (m) {
        if (m.role !== 'me') return;
        var s = m.corrected || m.text || '';
        if (s) bag.push(String(s).toLowerCase());
      });
    });
    if (!bag.length) return [];
    var hits = [];
    allCards().forEach(function (c) {
      var w = String(c.w || '').toLowerCase();
      if (w.length < 3) return;
      var n = 0;
      for (var i = 0; i < bag.length; i++) if (bag[i].indexOf(w) >= 0) n++;
      if (n) hits.push({ c: c, n: n, r: c.r || 9999 });
    });
    hits.sort(function (a, b) { return (b.n - a.n) || (a.r - b.r); });
    return hits.slice(0, limit || SET_SIZE).map(function (x) { return x.c; });
  }

  /* 고친 표현으로 10문제 — 관련 카드 먼저, 모자라면 회화 문장 중요도 순으로 채운다 */
  function startFixDrill() {
    var got = correctionCards(SET_SIZE);
    if (!got.length) { toast('아직 교정된 문장이 없어요 — 회화방에서 한마디 해 보세요'); return; }
    var queue = [], used = {};
    got.forEach(function (c) {
      var k = String(c.w).toLowerCase();
      if (used[k]) return;
      used[k] = 1;
      queue.push({ c: c, kind: 'fix' });
    });
    setRank((LEVELS[6] || []).slice()).forEach(function (c) {
      if (queue.length >= SET_SIZE) return;
      var k = String(c.w).toLowerCase();
      if (used[k]) return;
      used[k] = 1;
      queue.push({ c: c, kind: 'fix' });
    });
    if (!queue.length) { toast('연습할 카드가 없어요'); return; }
    S = {
      queue: queue.slice(0, SET_SIZE), i: 0, mode: 'fix', answers: [], correct: 0,
      quizDir: store.settings.dir, label: '내 문장 교정에서 뽑은 10문제'
    };
    uiMode = store.settings.mode;
    setUiMode(uiMode);
    showStudy(true);
    nextCard();
  }

  /* 고친 문장 다시 말하기 — 자주 틀린 규칙(칩)을 골랐을 때 그 문장들만 모아(문장 단위, 최대 10개) 
     고친 그 자리에서 다시 말해 보는 라운드. 새로 저장하는 것은 없다(회화 기록 turns만 읽는다).
     Speak의 '대화 뒤 틀린 곳이 바로 다음 연습이 된다' 구조를 우리 기록에 옮긴 것. */
  function fixSayItems(limit) {
    var fx = chatFixStats();
    var from = fx.p === 0 ? -Infinity : fx.p === -1 ? fx.wk0
      : (function () { var m = new Date(); m.setHours(0, 0, 0, 0); return m.getTime() - (fx.p - 1) * 86400000; })();
    var out = [], seen = {};
    Object.keys(store.chat || {}).forEach(function (id) {
      var t = store.chat[id];
      if (!t || !t.turns) return;
      t.turns.forEach(function (m) {
        if (m.role !== 'me' || (m.at || 0) < from) return;
        if (chatFixDay && fx.p === -1 && todayKey(new Date(m.at || 0)) !== chatFixDay) return;
        var notes = (m.notes || []).slice();
        if (!notes.length && m.corrected && m.corrected !== m.text) {
          notes = [{ from: m.text, to: m.corrected, why: '더 자연스러운 표현' }];
        }
        if (!notes.length) return;
        var en = String(m.corrected || m.text || '').trim();
        if (!en) return;
        notes.forEach(function (n) {
          if (chatRuleSel.length && chatRuleSel.indexOf(noteWhy(n)) < 0) return;
          var k = en.toLowerCase();     /* 같은 문장이 여러 번 나오지 않게 — 문장 단위로 한 번 */
          if (seen[k]) return;
          seen[k] = 1;
          out.push({ en: en, orig: String(m.text || ''), from: String(n.from || ''), to: String(n.to || ''), why: String(n.why || '고친 곳'), at: m.at || 0 });
        });
      });
    });
    out.sort(function (a, b) { return b.at - a.at; });
    return out.slice(0, limit || SET_SIZE);
  }

  /* 원문/고친 문장에서 그 부분만 표시 — <s> 지우기·<u> 밑줄 */
  function markPart(text, part, tag) {
    var t = String(text || ''), p = String(part || '');
    var at = p ? t.toLowerCase().indexOf(p.toLowerCase()) : -1;
    if (at < 0) return escapeHtml(t);
    return escapeHtml(t.slice(0, at)) + '<' + tag + '>' + escapeHtml(t.slice(at, at + p.length)) + '</' + tag + '>' +
      escapeHtml(t.slice(at + p.length));
  }

  var FIXRUN = null;
  function inFixRun() { return !$('#fixRun').hidden; }
  function startFixRunItems(items) {
    if (!items || !items.length) { toast('다시 말할 고친 문장이 없어요 — 회화방에서 한마디 해 보세요'); return; }
    FIXRUN = { items: items.slice(0, SET_SIZE), i: 0 };
    $('#chatTopics').hidden = true;
    $('#chatRoom').hidden = true;
    $('#fixRun').hidden = false;
    $('#tabbar').hidden = true;
    pushLayer();
    fixRunShow();
  }
  function startFixRun() { startFixRunItems(fixSayItems()); }
  function fixRunShow() {
    if (!FIXRUN) return;
    if (FIXRUN.i >= FIXRUN.items.length) { fixRunFinish(); return; }
    var it = FIXRUN.items[FIXRUN.i];
    recReset();
    $('#fixTag').textContent = '고친 곳 · ' + it.why;
    $('#fixCounter').textContent = (FIXRUN.i + 1) + '/' + FIXRUN.items.length;
    $('#fixProg').style.width = Math.round(FIXRUN.i / FIXRUN.items.length * 100) + '%';
    $('#fixOrig').innerHTML = '내가 한 말 · ' + markPart(it.orig, it.from, 's');
    $('#fixNew').innerHTML = markPart(it.en, it.to, 'u');
    var sc = $('#fixChunks');
    if (sc) {
      sc.innerHTML = chunkPanelHtml(it.en, it.to);
      bindChunkPanel(sc, it.en, it.to);
    }
    var nn = $('#fixNote');
    if (nn) { nn.hidden = true; nn.textContent = ''; }
    $('#fixNext').textContent = FIXRUN.i + 1 >= FIXRUN.items.length ? '마치기' : '다음 문장';
  }
  function fixRunFinish() {
    var n = FIXRUN ? FIXRUN.items.length : 0;
    toast('고친 문장 ' + n + '개를 다시 말했어요');
    endFixRun();
  }
  function endFixRun() {
    FIXRUN = null;
    recReset();
    if ($('#fixChunks')) $('#fixChunks').innerHTML = '';
    $('#fixRun').hidden = true;
    $('#chatTopics').hidden = false;
    $('#chatRoom').hidden = true;
    showTab('chat');
    $('#tabbar').hidden = false;
  }
  if ($('#fixExit')) {
    $('#fixExit').addEventListener('click', endFixRun);
    $('#fixListen').addEventListener('click', function () {
      if (FIXRUN && FIXRUN.items[FIXRUN.i]) speak(FIXRUN.items[FIXRUN.i].en);
    });
    $('#fixSlow').addEventListener('click', function () {
      if (FIXRUN && FIXRUN.items[FIXRUN.i]) speak(FIXRUN.items[FIXRUN.i].en, 0.75);
    });
    $('#fixShadow').addEventListener('click', function () {
      if (!FIXRUN || !FIXRUN.items[FIXRUN.i]) return;
      shadowTarget(FIXRUN.items[FIXRUN.i].en, $('#fixShadow'), $('#fixNote'));
    });
    $('#fixNext').addEventListener('click', function () {
      if (!FIXRUN) return;
      FIXRUN.i++;
      fixRunShow();
    });
  }

  function renderChatTab() {
    var grid = $('#topicGrid');
    if (grid) {
      grid.innerHTML = CHAT_TOPICS.map(function (t) {
        var saved = (store.chat && store.chat[t.id] && store.chat[t.id].turns || []).filter(function (x) { return x.role === 'me'; }).length;
        return '<button class="topic" data-t="' + t.id + '">' +
          '<span class="topic-ico">' + t.icon + '</span>' +
          '<span class="topic-name">' + t.name + '</span>' +
          '<span class="topic-sub">' + t.sub + '</span>' +
          (saved ? '<span class="topic-badge">' + saved + '문장</span>' : '') + '</button>';
      }).join('');
      $$('#topicGrid .topic').forEach(function (b) {
        b.addEventListener('click', function () { openChat(b.dataset.t); });
      });
    }
    var st = $('#chatStats');
    var fx = chatFixStats();
    if (st) {
      var n = chatHistoryCount();
      st.textContent = n
        ? '내가 말한 문장 ' + n + '개 · 고친 곳 오늘 ' + fx.today + ' · 이번 주 ' + fx.thisWeek + ' · 최근 7일 ' + fx.week + ' · 누적 ' + fx.all + '곳'
        : '아직 기록이 없어요. 주제를 골라 한마디만 해도 쌓입니다.';
    }
    /* 기간 추이 — 이번 주(월~일)/7일/30일/전체 막대 + 지난 기간 대비 */
    var tr = $('#chatFixTrend');
    if (tr) {
      if (!fx.all) tr.innerHTML = '';
      else {
        var max = 1;
        fx.series.forEach(function (d) { if (d.n > max) max = d.n; });
        var dense = fx.series.length > 10;
        var cmpTxt;
        if (fx.p === 0) {
          cmpTxt = fx.weeks + '주 기록 · 주 평균 ' + (fx.all / Math.max(1, fx.weeks)).toFixed(1) + '곳';
        } else if (fx.p === -1) {
          /* 진행 중인 주 — 지난주 '같은 시점'까지와 견줘야 반토막으로 보이지 않는다 */
          var wdiff = fx.thisWeek - fx.lastWeekSame;
          cmpTxt = fx.lastWeekSame
            ? (wdiff === 0 ? '지난주 같은 때와 같아요' : wdiff > 0 ? '지난주 같은 때보다 ' + wdiff + '곳 많아요' : '지난주 같은 때보다 ' + (-wdiff) + '곳 적어요')
            : '지난주 같은 때 기록은 없어요';
        } else {
          var lab = '지난 ' + fx.p + '일';
          var diff = fx.pn - fx.pprev;
          cmpTxt = fx.pprev ? (diff === 0 ? lab + '과 같아요' : diff > 0 ? lab + '보다 ' + diff + '곳 많아요' : lab + '보다 ' + (-diff) + '곳 적어요')
            : lab + ' 기록은 없어요';
        }
        /* '이번 주'는 칸을 버튼으로 — 누르면 그날 기록만, 다시 누르면 해제(화면 상태) */
        var wkView = fx.p === -1;
        var dayOn = wkView && !!chatFixDay;
        var todayStr = todayKey();
        var barsHtml = fx.series.map(function (d, i) {
          var inner = '<i class="' + (i === fx.todayIdx ? 'today' : '') + (d.n ? '' : ' zero') +
            '" style="height:' + (wkView ? 6 + Math.round(d.n / max * 28) : 4 + Math.round(d.n / max * 18)) +
            'px" title="' + escapeHtml(d.label) + ' · ' + d.n + '곳"></i>';
          if (!wkView) return inner;
          var on = chatFixDay === d.key;
          var fut = d.key > todayStr;
          var tip = d.label + ' · ' + d.n + '곳' + (fut ? ' (아직 오지 않은 날)' : ' · 눌러서 그날만 보기');
          return '<button type="button" class="fix-day' + (on ? ' on' : '') + (fut ? ' fut' : '') + (d.n ? '' : ' zero') +
            '" data-d="' + d.key + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + escapeHtml(tip) +
            '" title="' + escapeHtml(tip) + '">' + inner + '</button>';
        }).join('');
        var trendTxt = dayOn
          ? fx.dayLabel + ' <b>' + fx.dayN + '</b>곳 · 지난주 같은 요일 ' + (fx.dayPrev ? fx.dayPrev + '곳' : '기록 없음')
          : fixPeriodLabel(fx.p) + ' <b>' + (fx.p === 0 ? fx.all : fx.pn) + '</b>곳 · ' + cmpTxt;
        tr.innerHTML = '<div class="fix-period" role="group" aria-label="교정 통계 기간">' +
          FIX_PERIODS.map(function (x) {
            return '<button class="fp-chip' + (x === fx.p ? ' active' : '') + '" data-p="' + x + '">' +
              (x === 0 ? '전체' : x === -1 ? '이번 주' : x + '일') + '</button>';
          }).join('') + '</div>' +
          '<div class="fix-trend' + (dense ? ' dense' : '') + (wkView ? ' wk' : '') + '">' +
          '<div class="fix-bars' + (dense ? ' dense' : '') + (wkView ? ' wk' : '') + '" aria-label="' + fixPeriodLabel(fx.p) + ' 교정 추이">' + barsHtml + '</div>' +
          '<span class="fix-trend-t">' + trendTxt + '</span></div>' +
          (dayOn ? '<p class="fix-filter">🗓 ' + fx.dayLabel + ' 기록만 보는 중' +
            (chatRuleSel.length ? ' · ‘' + escapeHtml(ruleLabel()) + '’' : '') +
            ' <button class="ghost-btn small" id="fixDayClear">이 날 해제</button></p>' : '');
        $$('#chatFixTrend .fp-chip').forEach(function (b) {
          b.addEventListener('click', function () {
            var np = Number(b.dataset.p);
            if (np === chatFixPeriod) return;
            chatFixPeriod = np;
            chatFixDay = '';          /* 기간을 바꾸면 칸 선택은 풀린다 */
            renderChatTab();
          });
        });
        $$('#chatFixTrend .fix-day').forEach(function (b) {
          b.addEventListener('click', function () {
            var d = b.dataset.d;
            if (chatFixDay === d) { chatFixDay = ''; renderChatTab(); return; }
            if (d > todayKey()) { toast('아직 오지 않은 날이에요'); return; }
            chatFixDay = d;
            renderChatTab();
          });
        });
        var dcl = $('#fixDayClear');
        if (dcl) dcl.addEventListener('click', function () { chatFixDay = ''; renderChatTab(); });
      }
    }
    var top = $('#chatFixTop');
    if (top) {
      top.innerHTML = fx.all && fx.top.length
        ? '<p class="fix-top-lbl">자주 고친 곳 · 여러 개를 함께 골라도 돼요</p><div class="fix-top-chips">' + fx.top.map(function (r) {
          var on = chatRuleSel.indexOf(r.why) > -1;
          return '<button class="fix-top-chip' + (on ? ' on' : '') + '" data-why="' + escapeHtml(r.why) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
            escapeHtml(r.why) + ' <b>' + r.p + '</b>' + (r.p !== r.n ? '<em>전체 ' + r.n + '</em>' : '') + '</button>';
        }).join('') + '</div>' +
        (chatRuleSel.length ? '<p class="fix-filter">‘' + escapeHtml(ruleLabel()) + '’' +
          (chatRuleSel.length > 1 ? ' ' + chatRuleSel.length + '개 규칙' : '') + '만 보는 중 ' +
          '<button class="ghost-btn small" id="fixFilterClear">전체 보기</button></p>' +
          ruleMiniTrend(fx) : '')
        : '';
      $$('#chatFixTop .fix-top-chip').forEach(function (b) {
        b.addEventListener('click', function () {
          var why = b.dataset.why, at = chatRuleSel.indexOf(why);
          if (at > -1) chatRuleSel.splice(at, 1);
          else chatRuleSel.push(why);
          renderChatTab();
        });
      });
      var fc = $('#fixFilterClear');
      if (fc) fc.addEventListener('click', function () { chatRuleSel = []; renderChatTab(); });
    }
    var fd = $('#chatFixDrill');
    if (fd) {
      fd.hidden = !fx.all;
      if (fx.all) {
        var rel = correctionCards(SET_SIZE).length;
        fd.textContent = '🔁 고친 표현으로 10문제' + (rel ? ' · 관련 카드 ' + rel + '개' : '');
        fd.onclick = function () { startFixDrill(); };
      }
    }
    var fs = $('#chatFixSay');
    if (fs) {
      var items = fixSayItems();
      fs.hidden = !items.length;
      if (items.length) {
        var scope = [];
        if (chatRuleSel.length) scope.push('‘' + ruleLabel() + '’');
        if (chatFixDay && fx.p === -1) scope.push(dayText(chatFixDay));
        fs.textContent = '🗣 ' + (scope.length ? scope.join(' · ') : '고친') + ' 문장 ' +
          Math.min(SET_SIZE, items.length) + '개 다시 말하기';
        fs.onclick = function () { startFixRun(); };
      }
    }
    var hist = $('#chatHistory');
    if (hist) {
      var rows = [];
      CHAT_TOPICS.forEach(function (t) {
        var s = store.chat && store.chat[t.id];
        if (!s || !s.turns) return;
        s.turns.forEach(function (x) { if (x.role === 'me') rows.push({ t: t, x: x }); });
      });
      rows.sort(function (a, b) { return b.x.at - a.x.at; });
      /* 고른 기간 밖의 문장은 목록에서도 뺀다 — 기간 버튼이 통계·추이·기록에 함께 걸린다 */
      if (fx.p !== 0) {
        var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        var wfrom = fx.p === -1 ? fx.wk0 : midnight.getTime() - (fx.p - 1) * 86400000;
        rows = rows.filter(function (r) { return (r.x.at || 0) >= wfrom; });
      }
      if (chatRuleSel.length) {
        rows = rows.filter(function (r) {
          return (r.x.notes || []).some(function (n) { return chatRuleSel.indexOf(noteWhy(n)) > -1; });
        });
      }
      if (chatFixDay && fx.p === -1) {
        rows = rows.filter(function (r) { return todayKey(new Date(r.x.at || 0)) === chatFixDay; });
      }
      /* 기록 한 줄 → 그 문장 하나만 다시 말하기(Duolingo 복습 타일식). 문장·규칙은 화면 상태로만 */
      var sayRows = [];
      function rowHtml(r) {
        var x = r.x;
        var notes = (x.notes || []).slice();
        if (!notes.length && x.corrected && x.corrected !== x.text) {
          notes = [{ from: x.text, to: x.corrected, why: '더 자연스러운 표현' }];
        }
        var si = -1;
        var n0 = notes[0];
        if (n0 && String(x.corrected || x.text || '').trim()) {
          si = sayRows.length;
          sayRows.push({
            en: String(x.corrected || x.text || '').trim(), orig: String(x.text || ''),
            from: String(n0.from || ''), to: String(n0.to || ''), why: String(n0.why || '고친 곳'), at: x.at || 0
          });
        }
        return '<div class="hrow"><div class="hrow-top"><span class="hrow-topic">' + r.t.icon + ' ' + r.t.name + '</span>' +
          '<span class="hrow-time">' + new Date(x.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + '</span></div>' +
          '<p class="hrow-orig">' + escapeHtml(x.text) + '</p>' +
          (x.corrected && x.corrected !== x.text ? '<p class="hrow-fix">→ ' + escapeHtml(x.corrected) + '</p>' : '') +
          (x.notes && x.notes.length ? '<ul class="hrow-notes">' + x.notes.map(function (n) {
            return '<li><b>' + escapeHtml(n.from) + '</b> → <b>' + escapeHtml(n.to) + '</b> · ' + escapeHtml(n.why) + '</li>';
          }).join('') + '</ul>' : '<p class="hrow-ok">교정할 곳 없음</p>') +
          (si >= 0 ? '<div class="hrow-acts"><button class="ghost-btn small hrow-say" data-i="' + si + '">🗣 이 문장 다시 말하기</button></div>' : '') +
          '</div>';
      }
      var shown = rows.slice(0, 30);
      var histHtml = '';
      if (rows.length) {
        if (fx.p === 0) {
          /* 전체 — 기록을 월 단위로 묶는다(최신 달 위). 달 이름 줄에 그 달 건수를 함께 */
          var mCount = {};
          rows.forEach(function (r) {
            var d = new Date(r.x.at || 0);
            var k = d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
            mCount[k] = (mCount[k] || 0) + 1;
          });
          var curM = '';
          shown.forEach(function (r) {
            var d = new Date(r.x.at || 0);
            var k = d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2);
            if (k !== curM) {
              curM = k;
              histHtml += '<div class="hmonth"><b>' + k + '</b><span>' + mCount[k] + '건</span></div>';
            }
            histHtml += rowHtml(r);
          });
        } else {
          histHtml = shown.map(rowHtml).join('');
        }
      }
      hist.innerHTML = rows.length ? histHtml : '<p class="muted small">' +
        (chatRuleSel.length || (chatFixDay && fx.p === -1)
          ? (chatFixDay && fx.p === -1 ? fx.dayLabel : '이 기간') + '에 ' +
            (chatRuleSel.length ? '‘' + escapeHtml(ruleLabel()) + '’에 걸린 ' : '') + '문장이 없어요. ' +
            '<button class="ghost-btn small" id="fixFilterClear2">필터 해제</button>'
          : (fx.all ? '이 기간에 기록이 없어요 — <b>전체</b>로 바꾸면 지난 기록까지 보여요.' : '기록이 쌓이면 여기에서 한 번에 복습할 수 있어요.')) + '</p>';
      var fc2 = $('#fixFilterClear2');
      if (fc2) fc2.addEventListener('click', function () { chatRuleSel = []; chatFixDay = ''; renderChatTab(); });
      $$('#chatHistory .hrow-say').forEach(function (b) {
        b.addEventListener('click', function () {
          var it = sayRows[Number(b.dataset.i)];
          if (it) startFixRunItems([it]);
        });
      });
    }
    /* AI 키 상태 */
    var aiState = $('#aiState');
    if (aiState) {
      var on = store.settings.aiKey && store.settings.aiProvider !== 'none';
      aiState.textContent = on
        ? '연결됨: ' + (store.settings.aiProvider === 'gemini' ? 'Gemini' : 'OpenAI') + ' · ' + (store.settings.aiModel || '기본 모델') + ' (키는 이 기기에만 저장)'
        : '지금은 내장 교정기로 대화합니다. 키를 넣으면 자유 대화·정밀 교정이 켜집니다.';
    }
    $$('#aiPick button').forEach(function (b) { b.classList.toggle('active', b.dataset.p === (store.settings.aiProvider || 'gemini')); });
    if ($('#aiKey') && document.activeElement !== $('#aiKey')) $('#aiKey').value = store.settings.aiKey || '';
    if ($('#aiModel') && document.activeElement !== $('#aiModel')) $('#aiModel').value = store.settings.aiModel || '';
  }

  function openChat(id) {
    var t = CHAT_TOPICS.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    chatTopic = t;
    $('#chatTopics').hidden = true;
    $('#chatRoom').hidden = false;
    $('#tabbar').hidden = true;
    $('#chatTopicName').textContent = t.icon + ' ' + t.name;
    $('#chatTopicSub').textContent = t.sub;
    var st = chatStore(id);
    if (!st.turns.length) {
      st.turns.push({ role: 'ai', text: t.open.en, ko: t.open.ko, at: Date.now() });
      st.step = 0;
      saveNow();
    }
    chatHintStage = 0;
    paintChat();
    pushLayer();
  }

  function closeChatRoom() {
    chatTopic = null;
    var rm = $('#chatRoom');
    if (rm) rm.classList.remove('hint-on');
    $('#chatRoom').hidden = true;
    $('#chatTopics').hidden = false;
    $('#tabbar').hidden = false;
    renderChatTab();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---- 힌트 사다리 (Speak식) : 1단계 핵심 청크+첫 글자 → 2단계 전체 문장 → 3단계 같은 패턴 치환 ---- */
  var HINT_KEEP = {};
  ('i a an the to of in on at is am are was were be been it its my me you your we our they their he she his her ' +
    'for and or but so do does did can could would will should shall may might must have has had this that these those ' +
    'some any very not no yes if with from by as up out just also than then there here what how when where why who ' +
    'which please one two too much many more most about into over under again').split(' ').forEach(function (w) { HINT_KEEP[w] = 1; });
  var chatHintStage = 0;

  function maskWord(t, force) {
    var m = String(t).match(/^([^A-Za-z]*)([A-Za-z][A-Za-z'’-]*)([^A-Za-z]*)$/);
    if (!m) return t;
    var core = m[2];
    if (!force && (core.length <= 1 || HINT_KEEP[core.toLowerCase()])) return t;
    return m[1] + core.charAt(0) + new Array(Math.max(2, Math.min(core.length, 9))).join('_') + m[3];
  }

  /* 지금 대화에서 이어 말할 문장 — 내장 대화의 다음 힌트, LLM이 준 NEXT, 주제 예시 순서 */
  function chatHintText() {
    if (!chatTopic) return '';
    var st = chatStore(chatTopic.id);
    if (st.lastHint) return st.lastHint;
    if (chatTopic._lastNext) return chatTopic._lastNext;
    var idx = Math.min(Math.max(0, (st.step || 1) - 1), chatTopic.script.length - 1);
    var step = chatTopic.script[idx] || {};
    return step.hint || (chatTopic.hints || [])[0] || '';
  }

  /* 첫 3단어(짧은 문장은 첫 단어)는 그대로 두고 나머지는 기능어만 남기고 첫 글자 스켈레톤 */
  function chatSkeleton(s) {
    var raw = String(s || '').trim();
    var toks = raw.split(/\s+/);
    if (!raw || !toks.length) return raw;
    var head = toks.length >= 5 ? 3 : toks.length >= 4 ? 2 : 0;
    var out = toks.map(function (t, i) { return i < head ? t : maskWord(t); });
    if (out.join(' ') === toks.join(' ')) {
      var mid = Math.max(0, Math.floor(toks.length / 2));
      out[mid] = maskWord(toks[mid], true);
    }
    return out.join(' ');
  }

  /* 틀린 부분·고친 부분에 표시를 입힌다 (겹치지 않게 앞에서부터) */
  function markTokens(text, words, cls) {
    var s = String(text || '');
    var ranges = [];
    (words || []).forEach(function (w) {
      var needle = String(w == null ? '' : w);
      if (!needle) return;
      var from = 0;
      while (from < s.length) {
        var i = s.toLowerCase().indexOf(needle.toLowerCase(), from);
        if (i < 0) break;
        var end = i + needle.length;
        var hit = ranges.some(function (r) { return i < r[1] && end > r[0]; });
        if (!hit) { ranges.push([i, end]); break; }
        from = i + 1;
      }
    });
    if (!ranges.length) return escapeHtml(s);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var out = '', pos = 0;
    ranges.forEach(function (r) {
      out += escapeHtml(s.slice(pos, r[0])) + '<mark class="' + cls + '">' + escapeHtml(s.slice(r[0], r[1])) + '</mark>';
      pos = r[1];
    });
    return out + escapeHtml(s.slice(pos));
  }

  function chatFixHtml(m, idx) {
    var notes = m.notes || [];
    var changed = m.corrected && m.corrected !== m.text;
    var html = '';
    if (changed) {
      html += '<div class="fix">' +
        '<p class="fix-top">✏️ 교정 ' + (notes.length || 1) + '곳</p>' +
        '<p class="fix-line">' + markTokens(m.corrected, notes.map(function (n) { return n.to; }), 'fx-new') + '</p>' +
        (notes.length ? '<ul class="fix-list">' + notes.map(function (n) {
          return '<li><span class="fx-old">' + escapeHtml(n.from) + '</span><span class="fx-arw">→</span>' +
            '<span class="fx-new-t">' + escapeHtml(n.to) + '</span>' +
            (n.why ? '<em class="fx-why">' + escapeHtml(n.why) + '</em>' : '') + '</li>';
        }).join('') + '</ul>' : '') +
        '<div class="fix-acts">' +
        '<button class="mini-say" data-say="' + idx + '">🔊 듣기</button>' +
        (micSupport() ? '<button class="mini-say" data-shadow="' + idx + '">🎤 따라 말해보기</button>' : '') +
        '<button class="mini-say" data-retry="' + idx + '">↩ 다시 입력</button>' +
        '</div>' +
        '<p class="fx-score" hidden></p>' +
        '</div>';
    } else {
      html += '<p class="fix-ok">✅ 교정할 곳 없어요</p>';
    }
    if (m.natural) html += '<div class="nat"><span>더 자연스럽게</span> ' + escapeHtml(m.natural) + '</div>';
    return html;
  }

  /* 교정문을 듣고 따라 말하면 그 자리에서 점수 — Speak의 교정→재시도 루프 */
  function chatShadow(target, out) {
    if (!micSupport()) { toast(micErrorText('unsupported')); return; }
    if (out) { out.hidden = false; out.textContent = '듣고 따라 말해 보세요…'; }
    listenOnce(null, function (txt) {
      if (!out) return;
      out.hidden = false;
      if (!txt) { out.textContent = '아무것도 인식되지 않았어요. 마이크에 조금 더 가까이 대고 다시 말해 보세요.'; return; }
      var r = alignSpeech(target, txt);
      out.innerHTML = '<b class="' + (r.score >= 80 ? 'ok-t' : r.score >= 55 ? 'mid-t' : 'bad-t') + '">' + r.score + '점</b> ' +
        r.items.map(function (x) {
          var cls = x.state === 'ok' ? 'ok-t' : x.state === 'near' ? 'mid-t' : 'bad-t';
          return '<span class="' + cls + '">' + escapeHtml(x.word) + '</span>';
        }).join(' ') + (r.score >= 80 ? ' · 좋아요' : ' · 표시된 단어를 다시 들어보세요');
    }, function (err) {
      if (out) { out.hidden = false; out.textContent = micErrorText(err); }
    });
  }

  function paintChatSuggest() {
    var sug = $('#chatSuggest');
    if (!sug) return;
    if (!chatTopic) { sug.innerHTML = ''; return; }
    var st = chatStore(chatTopic.id);
    var last = st.turns[st.turns.length - 1];
    var hint = last && last.role === 'ai' ? chatHintText() : '';
    var pat = chatTopic.pattern || null;
    var stage = hint ? chatHintStage : 0;
    var html = '<div class="sug-head"><span class="sug-lbl">이렇게 말해보세요</span>';
    if (hint) {
      var lbl = stage === 0 ? '💡 힌트' : stage === 1 ? '💡 전체 문장' : stage === 2 ? '🔄 치환 연습' : '↺ 힌트 접기';
      html += '<button class="hint-btn" id="chatHintBtn" aria-label="힌트 단계">' + lbl + '</button>';
    }
    html += '</div>';
    if (hint && stage >= 1) {
      html += '<div class="chat-hint" id="chatHintBox">' +
        '<p class="ch-top"><b>1단계</b> 첫 글자 힌트</p>' +
        (pat ? '<p class="ch-pat"><em>패턴</em> ' + escapeHtml(pat.pat) + '</p>' : '') +
        '<p class="ch-skel">' + escapeHtml(chatSkeleton(hint)) + '</p>' +
        (stage >= 2 ? '<p class="ch-full"><span>2단계</span> ' + escapeHtml(hint) + '</p>' : '') +
        '</div>';
    }
    var chips = [];
    if (stage >= 2) chips.push({ t: hint, full: true });
    (chatTopic.hints || []).slice(0, stage >= 2 ? 1 : 2).forEach(function (h) {
      if (stage < 3 && h !== hint) chips.push({ t: h });
    });
    if (stage >= 3 && pat) {
      pat.slots.forEach(function (s) { chips.push({ t: pat.pat.replace('___', s), sub: true }); });
    }
    chips.forEach(function (c, i) { c.idx = i; });
    function chipHtml(c) {
      return '<button class="sug' + (c.full ? ' full' : '') + (c.sub ? ' sub' : '') + '" data-i="' + c.idx + '">' + escapeHtml(c.t) + '</button>';
    }
    html += chips.filter(function (c) { return !c.sub; }).map(chipHtml).join('');
    var subs = chips.filter(function (c) { return c.sub; });
    if (subs.length) {
      html += '<span class="sug-lbl sub-lbl">같은 패턴으로 바꿔 말하기</span>' + subs.map(chipHtml).join('');
    }
    if (stage >= 2 && speakOk) html += '<button class="mini-say" id="chatHintSay">🔊 문장 듣기</button>';
    sug.innerHTML = html;
    $$('#chatSuggest .sug').forEach(function (b) {
      var c = chips[+b.dataset.i];
      if (!c) return;
      b.addEventListener('click', function () {
        $('#chatText').value = c.t;
        $('#chatText').focus();
        if (speakOk) speak(c.t);
      });
    });
    /* 힌트를 펼치면 대화 로그를 줄여 입력창이 화면 밖으로 밀리지 않게 한다 */
    var room = $('#chatRoom');
    if (room) room.classList.toggle('hint-on', !!(hint && stage >= 1));
    /* 로그 높이가 줄어든 뒤에는 다시 맨 아래로 — 방금 온 AI 말이 잘려 보이지 않게 */
    var lg = $('#chatLog');
    if (lg) lg.scrollTop = lg.scrollHeight;
    var hb = $('#chatHintBtn');
    if (hb) hb.addEventListener('click', function () {
      chatHintStage = chatHintStage >= 3 ? 0 : chatHintStage + 1;
      paintChatSuggest();
      var box = $('.chat-input') || $('#chatText');
      if (chatHintStage >= 1 && box && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
    });
    var hs = $('#chatHintSay');
    if (hs) hs.addEventListener('click', function () { speak(hint); });
  }

  function paintChat() {
    if (!chatTopic) return;
    var st = chatStore(chatTopic.id);
    var log = $('#chatLog');
    log.innerHTML = st.turns.map(function (m, idx) {
      if (m.role === 'ai') {
        return '<div class="msg ai"><div class="bubble">' + escapeHtml(m.text) +
          (m.ko ? '<span class="bubble-ko">' + escapeHtml(m.ko) + '</span>' : '') + '</div></div>';
      }
      var bad = (m.corrected && m.corrected !== m.text) ? (m.notes || []).map(function (n) { return n.from; }) : [];
      return '<div class="msg me"><div class="bubble">' + markTokens(m.text, bad, 'fx-bad') + '</div>' +
        chatFixHtml(m, idx) + '</div>';
    }).join('');
    $$('#chatLog [data-say]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = st.turns[+b.dataset.say];
        if (m) speak(m.corrected || m.text);
      });
    });
    $$('#chatLog [data-shadow]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = st.turns[+b.dataset.shadow];
        if (!m) return;
        chatShadow(m.corrected || m.text, b.parentNode.parentNode.querySelector('.fx-score'));
      });
    });
    $$('#chatLog [data-retry]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = st.turns[+b.dataset.retry];
        if (!m) return;
        $('#chatText').value = m.corrected || m.text;
        $('#chatText').focus();
        chatHintStage = 0;
        toast('교정문을 입력창에 넣었어요 — 고친 문장으로 다시 말해보세요');
      });
    });
    paintChatSuggest();
    log.scrollTop = log.scrollHeight;
  }

  function chatAiBuiltin(topic, userText) {
    var st = chatStore(topic.id);
    var script = topic.script;
    var idx = Math.min(st.step || 0, script.length - 1);
    var step = script[idx];
    st.step = (st.step || 0) + 1;
    st.lastHint = step.hint || '';
    var reply = { en: step.en, ko: step.ko };
    /* 질문에는 먼저 짧게 답한다 */
    if (/\?\s*$/.test(userText)) {
      if (/where.*(gate|toilet|restroom|station)/i.test(userText)) reply = { en: 'It is just around the corner, on your left.', ko: '바로 모퉁이 왼쪽에 있어요.' };
      else if (/how much|price|cost/i.test(userText)) reply = { en: 'It is about ten dollars.', ko: '10달러 정도예요.' };
      else if (/how long|how far/i.test(userText)) reply = { en: 'It takes about ten minutes from here.', ko: '여기서 10분쯤 걸려요.' };
      else if (/can you|could you|would you/i.test(userText)) reply = { en: 'Of course. Let me help you with that.', ko: '그럼요. 제가 도와드릴게요.' };
    }
    return reply;
  }

  function chatPrompt(userText) {
    var sys = 'You are a friendly English conversation tutor for a Korean learner. ' +
      'Stay in the situation: ' + chatTopic.name + '. ' +
      'Reply naturally in English in 1-2 short sentences. Then write a line starting with "KO:" with a Korean translation. ' +
      'If the learner\'s English has an error, add a line starting with "FIX:" with the corrected sentence, then "|", then a short Korean reason. ' +
      'Then add "NEXT:" with one short English sentence the learner could say next.';
    return sys + '\n\nLearner: ' + userText;
  }

  function chatAiLLM(userText) {
    var prov = store.settings.aiProvider;
    var key = store.settings.aiKey;
    if (!key || prov === 'none') return Promise.reject(new Error('nokey'));
    var model = store.settings.aiModel || (prov === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini');
    if (prov === 'gemini') {
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: chatPrompt(userText).split('\n\nLearner:')[0] }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 300 }
        })
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || 'gemini ' + r.status); return j; }); })
        .then(function (j) {
          var txt = (((j.candidates || [])[0] || {}).content || {}).parts;
          return txt && txt[0] ? txt[0].text : '';
        });
    }
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'system', content: chatPrompt(userText).split('\n\nLearner:')[0] }, { role: 'user', content: userText }],
        temperature: 0.8, max_tokens: 300
      })
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || 'openai ' + r.status); return j; }); })
      .then(function (j) { return (((j.choices || [])[0] || {}).message || {}).content || ''; });
  }

  function parseLLM(raw) {
    var en = [], ko = '', fix = '', next = '';
    String(raw || '').split(/\n+/).forEach(function (line) {
      var l = line.trim();
      if (/^KO\s*:/i.test(l)) ko = l.replace(/^KO\s*:/i, '').trim();
      else if (/^FIX\s*:/i.test(l)) fix = l.replace(/^FIX\s*:/i, '').trim();
      else if (/^NEXT\s*:/i.test(l)) next = l.replace(/^NEXT\s*:/i, '').trim();
      else if (l) en.push(l);
    });
    return { en: en.join(' ').trim(), ko: ko, fix: fix, next: next };
  }

  function chatSend(text) {
    if (!chatTopic) return;
    var msg = String(text || '').trim();
    if (!msg) return;
    if (chatBusy) return;
    $('#chatText').value = '';
    /* 지금 주제를 붙잡는다 — 응답을 기다리는 사이 대화방을 나가도 답이 사라지지 않게 */
    var topic = chatTopic;
    var st = chatStore(topic.id);
    var cor = correctEnglish(msg);
    var me = { role: 'me', text: msg, corrected: cor.corrected, notes: cor.notes, natural: cor.natural, at: Date.now() };
    st.turns.push(me);
    saveNow();
    paintChat();

    chatBusy = true;
    $('#chatNote').textContent = 'AI가 답하는 중…';
    var finish = function (reply, fixLine) {
      if (fixLine && (!me.notes || !me.notes.length)) {
        var parts = fixLine.split('|');
        if (parts[0] && parts[0].trim()) {
          me.corrected = parts[0].trim();
          me.notes = [{ from: me.text, to: me.corrected, why: (parts[1] || '더 자연스러운 표현').trim() }];
        }
      }
      st.turns.push({ role: 'ai', text: reply.en, ko: reply.ko, at: Date.now() });
      st.at = Date.now();
      saveNow();
      chatBusy = false;
      chatHintStage = 0;   /* 새 차례에는 힌트를 다시 1단계부터 */
      $('#chatNote').textContent = 'Enter로 전송 · 마이크로 말하면 자동 입력';
      paintChat();
    };
    if (store.settings.aiKey && store.settings.aiProvider !== 'none') {
      chatAiLLM(msg).then(function (raw) {
        var p = parseLLM(raw);
        if (!p.en) throw new Error('empty');
        if (p.next) topic._lastNext = p.next;
        finish({ en: p.en, ko: p.ko || '' }, p.fix);
      }).catch(function (err) {
        /* 키가 막히면 내장 엔진으로 이어서 대화한다 */
        var r = chatAiBuiltin(topic, msg);
        finish(r, '');
        toast('LLM 호출 실패(' + (err.message || err) + ') — 내장 대화로 이어갑니다');
      });
    } else {
      setTimeout(function () { finish(chatAiBuiltin(topic, msg), ''); }, 260);
    }
  }

  if ($('#chatSend')) {
    $('#chatSend').addEventListener('click', function () { chatSend($('#chatText').value); });
    $('#chatText').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); chatSend(this.value); }
    });
    $('#chatBack').addEventListener('click', closeChatRoom);
    $('#chatReset').addEventListener('click', function () {
      if (!chatTopic) return;
      if (!confirm('이 주제의 대화를 처음부터 다시 시작할까요? 기록도 지워집니다.')) return;
      store.chat[chatTopic.id] = { turns: [], step: 0, at: Date.now() };
      saveNow();
      var t = chatTopic;
      chatTopic = null;
      openChat(t.id);
    });
    $('#chatMic').addEventListener('click', function () {
      if (!micSupport()) { toast(micErrorText('unsupported')); return; }
      var b = this;
      b.classList.add('on');
      listenOnce(function (t) { $('#chatText').value = t; },
        function (t) {
          b.classList.remove('on');
          if (t) { $('#chatText').value = t; chatSend(t); }
          else toast('아무것도 인식되지 않았어요. 다시 말해 보세요.');
        },
        function (err) { b.classList.remove('on'); toast(micErrorText(err)); });
    });
    $('#goChat').addEventListener('click', function () { goTab('chat'); });
    $$('#aiPick button').forEach(function (b) {
      b.addEventListener('click', function () {
        store.settings.aiProvider = b.dataset.p;
        $$('#aiPick button').forEach(function (x) { x.classList.toggle('active', x === b); });
        saveNow();
        renderChatTab();
      });
    });
    $('#aiSave').addEventListener('click', function () {
      store.settings.aiKey = ($('#aiKey').value || '').trim();
      store.settings.aiModel = ($('#aiModel').value || '').trim();
      if (store.settings.aiProvider === 'none' && store.settings.aiKey) store.settings.aiProvider = 'gemini';
      saveNow();
      renderChatTab();
      toast(store.settings.aiKey ? '키를 이 기기에만 저장했어요' : '키를 비웠어요 — 내장 대화로 동작합니다');
    });
    $('#aiClear').addEventListener('click', function () {
      store.settings.aiKey = '';
      store.settings.aiModel = '';
      $('#aiKey').value = '';
      $('#aiModel').value = '';
      saveNow();
      renderChatTab();
      toast('키를 지웠어요');
    });
  }

  /* ---------------- 홈: 이어서 풀기 ---------------- */
  function renderResume() {
    var box = $('#resumeCard');
    if (!box) return;
    var s = store.session;
    var ok = s && s.words && s.i > 0 && s.i < s.words.length && (Date.now() - (s.at || 0) < 86400000);
    box.hidden = !ok;
    if (!ok) return;
    $('#resumeText').textContent = (s.label || '학습') + ' · ' + s.i + '/' + s.words.length +
      '까지 풀었어요 (정답 ' + (s.ok || 0) + '/' + (s.n || 0) + ')';
  }
  if ($('#resumeBtn')) {
    $('#resumeBtn').addEventListener('click', function () { resumeSession(); });
    $('#resumeDrop').addEventListener('click', function () {
      store.session = null;
      saveNow();
      renderResume();
    });
  }

  /* ---------------- 시작 ---------------- */
  if (QA) {
    window.__QA = {
      store: store,
      state: function () {
        return { store: store, S: S, uiMode: uiMode, preset: store.settings.preset, speed: store.settings.speed };
      },
      blankOf: blankOf,
      orderOf: orderOf,
      levelCounts: function () {
        return { 1: LEVELS[1].length, 2: LEVELS[2].length, 3: LEVELS[3].length, 4: LEVELS[4].length, 5: LEVELS[5].length, 6: LEVELS[6].length };
      },
      modeStats: function () {
        var o = {};
        MODE_KEYS.forEach(function (m) {
          o[m] = { today: modeToday(m).n, todayOk: modeToday(m).ok, all: modeAll(m).n };
        });
        return o;
      },
      progress: function () { return stats(); },
      /* v3.9.1 — 세트 반복 출제 점검용 */
      startStudy: startSession,
      startDrillNow: function (tag, mode) { drillTag = tag || 'all'; startDrill(mode || 'blank'); },
      queueIds: function () { return S ? S.queue.map(function (q) { return q.c.w; }) : []; },
      speakIds: function () { return SP ? SP.queue.map(function (c) { return c.w; }) : []; },
      solve: function (ok) {
        if (!S || S.i >= S.queue.length || answered) return false;
        answered = true;
        var c = S.queue[S.i].c;
        grade(c, ok ? 2 : 0);
        advance();
        return true;
      },
      atResult: function () { return !!($('#resultBox') && !$('#resultBox').hidden); },
      solveAll: function (ok) {
        var guard = 0;
        while (S && S.i < S.queue.length && guard < 60) {
          /* 이미 화면에서 답한 문제는 다시 채점하지 않고 '다음'만 누른 것과 같게 */
          if (answered) advance(); else this.solve(ok);
          guard++;
        }
        return guard;
      },
      startConv: startConv,
      setConvTag: function (t) { convTag = t; renderConv(); },
      /* v3.8 */
      setSize: function () { return SET_SIZE; },
      explainAll: function (lv) {
        var out = [];
        allCards().forEach(function (c) {
          if (lv && c._lv !== lv) return;
          out.push({ w: c.w, lv: c._lv, x: explanationOf(c) });
        });
        var seen = {}, dups = [];
        out.forEach(function (o) { if (seen[o.x]) dups.push(o.w); seen[o.x] = 1; });
        return { n: out.length, uniq: Object.keys(seen).length, dups: dups.slice(0, 10), sample: out.slice(0, 3) };
      },
      options: function () { return { opts: CUR_OPTS, answer: CUR_ANSWER }; },
      align: function (t, h) { return alignSpeech(t, h); },
      correct: function (t) { return correctEnglish(t); },
      startSpeak: function (type, lv) { spType = type || 'word'; spLv = String(lv || '0'); startSpeak(); },
      speakState: function () {
        return SP ? { i: SP.i, n: SP.queue.length, target: SP.queue[SP.i] ? speakTargetOf(SP.queue[SP.i]).en : '', results: SP.results.slice() } : null;
      },
      speakCheck: function (t) { speakCheck(t); },
      speakEnd: function () { endSpeakRun(); },
      openChat: function (id) { openChat(id); },
      chatSend: function (t) { chatSend(t); },
      chatState: function () {
        return chatTopic ? { id: chatTopic.id, turns: chatStore(chatTopic.id).turns.slice(), busy: chatBusy } : null;
      },
      chatClose: function () { closeChatRoom(); },
      session: function () { return store.session; },
      resume: function () { return resumeSession(); },
      /* v4.0 */
      goal: function () {
        return {
          goal: dailyGoal(), n: (todayStats().n || 0), val: $('#goalVal').textContent,
          width: $('#goalBar').style.width, done: $('#goalBox').classList.contains('done'),
          note: $('#goalNote').textContent
        };
      },
      forecast: function () { return $('#forecast') ? $('#forecast').textContent : ''; },
      combo: function () {
        return {
          combo: (S && S.combo) || 0, best: (S && S.best) || 0,
          pill: $('#comboPill') ? !$('#comboPill').hidden : false,
          dots: $$('#studyDots i').length,
          marks: S ? S.queue.map(function (q) { return q.mark == null ? -1 : q.mark; }) : []
        };
      },
      startRetry: startRetry,
      startRecall: startRecall,
      hintState: function () {
        if (!chatTopic) return null;
        var st = chatStore(chatTopic.id);
        var hint = chatHintText();
        return {
          stage: chatHintStage, hint: hint, skel: chatSkeleton(hint),
          pattern: (chatTopic.pattern || {}).pat || '',
          slots: (chatTopic.pattern || {}).slots || [],
          btn: $('#chatHintBtn') ? $('#chatHintBtn').textContent : '',
          box: !!$('#chatHintBox'),
          chips: $$('#chatSuggest .sug').map(function (b) { return b.textContent; })
        };
      },
      setAutoSay: function (v) { store.settings.autoSay = !!v; },
      hasShadow: function () { return !!$('#fbShadow'); },
      /* v4.2 */
      chunks: function (t, b) { return chunksOf(t, b); },
      convCards: function () { return (LEVELS[6] || []).map(function (c) { return { w: c.w, b: c.b || '' }; }); },
      patternBank: function () {
        /* 앱이 실제로 쓰는 틀 사전 전체(1차 88 + 2차 102) */
        var all = {};
        Object.keys(CH_PATTERN_BANK).forEach(function (k) { all[k] = CH_PATTERN_BANK[k]; });
        Object.keys(CH_PATTERN_BANK2).forEach(function (k) { all[k] = CH_PATTERN_BANK2[k]; });
        return all;
      },
      patternBank1: function () { return CH_PATTERN_BANK; },
      patternAll: function () {
        var out = [];
        (LEVELS[6] || []).forEach(function (c) {
          var p = patternDrill(c);
          out.push({ w: c.w, b: c.b || '', frame: p ? p.frame : null, slots: p ? p.slots.slice() : [] });
        });
        return out;
      },
      chunkProtect: function (w) { var c = cardByW(w); return c ? chunkProtect(c) : ''; },
      recState: function () {
        var box = $('#feedback .chk-rec');
        function h(sel) { var el = box ? box.querySelector(sel) : null; return el ? el.hidden : null; }
        return {
          supported: recSupport(), state: REC.state, hasUrl: !!REC.url, url: REC.url ? 1 : 0,
          note: REC.note || '', box: !!box, gen: REC.gen, trace: REC.trace.join(' '),
          btn: box && box.querySelector('[data-act="rec"]') ? box.querySelector('[data-act="rec"]').textContent : '',
          mineHidden: h('[data-act="mine"]'), cmpHidden: h('[data-act="cmp"]'),
          noteText: box && box.querySelector('.rec-note') ? box.querySelector('.rec-note').textContent : '',
          noteHidden: h('.rec-note'), chips: $('#feedback .chk-chip') ? $$('#feedback .chk-chip').length : 0
        };
      },
      recReset: recReset,
      pattern: function (w) { var c = cardByW(w); return c ? patternDrill(c) : null; },
      fixStats: function () { return chatFixStats(); },
      fixFilter: function (v) { chatRuleSel = v ? [String(v)] : []; if (v) chatFixDay = ''; renderChatTab(); return ruleLabel(); },
      fixFilters: function (arr) { chatRuleSel = (arr || []).map(String); renderChatTab(); return chatRuleSel.slice(); },
      fixFilterSel: function () { return chatRuleSel.slice(); },
      fixDay: function () { return chatFixDay; },
      fixDaySet: function (d) { chatFixDay = String(d || ''); renderChatTab(); return chatFixDay; },
      fixRowSay: function (i) { var b = $$('#chatHistory .hrow-say')[i]; if (b) b.click(); return !!b; },
      fixRowSayCount: function () { return $$('#chatHistory .hrow-say').length; },
      patSentence: function (f, s) { return patSentence(f, s); },
      /* 기록 목록의 기간 필터와 같은 기준으로 셀 수 있게 내 문장 시각만 돌려준다 */
      chatMeAt: function () {
        var out = [];
        Object.keys(store.chat || {}).forEach(function (id) {
          var t = store.chat[id];
          if (!t || !t.turns) return;
          t.turns.forEach(function (m) { if (m.role === 'me') out.push(m.at || 0); });
        });
        return out;
      },
      fixCards: function () { return correctionCards(SET_SIZE).map(function (c) { return c.w; }); },
      startFixDrill: startFixDrill,
      recallPill: function () {
        var p = $('#recallPill');
        return p && !p.hidden ? p.textContent : '';
      },
      spoken: function () { return (window.__spoken || []).slice(-30); },
      /* v4.4 — 2차 틀 사전 · 비교 속도 · 교정 기간 */
      patternBank2: function () { return CH_PATTERN_BANK2; },
      recRateNow: function () { return recRate(); },
      /* 피드백과 같은 경로로 패턴 패널을 화면에 붙여 본다(QA 전용) */
      patMount: function (w) {
        var c = cardByW(w);
        var old = document.getElementById('qaPatMount');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        if (!c) return null;
        var box = document.createElement('div');
        box.id = 'qaPatMount';
        box.className = 'card';
        box.innerHTML = patternPanelHtml(c);
        document.body.appendChild(box);
        bindPatternPanel(box, c);
        var p = patternDrill(c);
        return {
          frame: p ? p.frame : null, tier: p ? (p.tier || 1) : 0,
          chips: box.querySelectorAll('.pat-chip').length,
          slots: p ? p.slots.slice() : []
        };
      },
      patChipClick: function (i) {
        var box = document.getElementById('qaPatMount');
        var b = box ? box.querySelectorAll('.pat-chip')[i] : null;
        if (b) b.click();
        return !!b;
      },
      patSay: function () {
        var box = document.getElementById('qaPatMount');
        var b = box ? box.querySelector('[data-act="say"]') : null;
        if (b) b.click();
        return !!b;
      },
      patUnmount: function () {
        var old = document.getElementById('qaPatMount');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        return true;
      },
      recFake: function (secs) {
        /* 마이크 없는 점검 환경에서 녹음 이후 UI(▶ 내 발음·비교·속도)를 확인하기 위한 것.
           실제 앱 화면에서는 쓰이지 않는다(QA 모드에만 열린다) */
        if (REC.url) { try { URL.revokeObjectURL(REC.url); } catch (e) {} }
        if (!REC.box) REC.box = $('#feedback .chk-rec');
        try {
          var blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
          REC.url = URL.createObjectURL(blob);
        } catch (e) { REC.url = ''; }
        REC.state = 'idle';
        REC.note = (secs || 2) + '초 녹음 · 이 화면에서만 들리고 저장되지 않아요';
        recPaint(REC.box);
        return { hasUrl: !!REC.url, note: REC.note };
      },
      recClick: function (act) {
        var box = $('#feedback .chk-rec');
        var el = box ? box.querySelector('[data-act="' + act + '"]') : null;
        if (el) el.click();
        return !!el;
      },
      fixPeriod: function (v) {
        if (v != null) {
          var n = Number(v);
          chatFixPeriod = n === 30 ? 30 : n === 0 ? 0 : n === -1 ? -1 : 7;
          renderChatTab();
        }
        return chatFixPeriod;
      },
      /* v4.5 — 고친 문장 다시 말하기 */
      fixSayItems: function (n) { return fixSayItems(n); },      startFixRun: startFixRun,
      fixRunState: function () {
        if (!inFixRun() || !FIXRUN) return null;
        return {
          i: FIXRUN.i, n: FIXRUN.items.length,
          tag: $('#fixTag') ? $('#fixTag').textContent : '',
          orig: $('#fixOrig') ? $('#fixOrig').textContent : '',
          sent: $('#fixNew') ? $('#fixNew').textContent : '',
          counter: $('#fixCounter') ? $('#fixCounter').textContent : '',
          next: $('#fixNext') ? $('#fixNext').textContent : '',
          chunks: $$('#fixChunks .chk-chip').length,
          tabbar: $('#tabbar') ? !$('#tabbar').hidden : null
        };
      },
      fixRunNext: function () { if ($('#fixNext')) $('#fixNext').click(); return !!FIXRUN; },
      fixRunExit: endFixRun,
      weekStart: function () { return mondayStart(Date.now()); },
      /* 교정 원자료 — 하네스가 같은 규칙으로 독립 계산해 대조하려고 쓴다 */
      fixTurns: function () {
        var out = [];
        Object.keys(store.chat || {}).forEach(function (id) {
          var t = store.chat[id];
          if (!t || !t.turns) return;
          t.turns.forEach(function (m) {
            if (m.role !== 'me') return;
            var notes = (m.notes || []).slice();
            if (!notes.length && m.corrected && m.corrected !== m.text) notes = [{ why: '더 자연스러운 표현' }];
            if (!notes.length) return;
            out.push({ at: m.at || 0, n: notes.length, why: notes.map(function (n) { return n.why || ''; }) });
          });
        });
        return out;
      },
      /* 청크 패널을 피드백과 같은 경로로 붙여 본다(QA 전용) */
      chunkMount: function (w) {
        var c = cardByW(w);
        var old = document.getElementById('qaChunkMount');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        if (!c) return null;
        var text = exampleOf(c), prot = chunkProtect(c, text);
        var box = document.createElement('div');
        box.id = 'qaChunkMount';
        box.className = 'card';
        box.innerHTML = chunkPanelHtml(text, prot);
        document.body.appendChild(box);
        bindChunkPanel(box, text, prot);
        return {
          text: text,
          chips: box.querySelectorAll('.chk-chip').length,
          echo: !!box.querySelector('[data-act="echo"]'),
          echoLabel: box.querySelector('[data-act="echo"]') ? box.querySelector('[data-act="echo"]').textContent : ''
        };
      },
      chunkUnmount: function () {
        var old = document.getElementById('qaChunkMount');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        return true;
      },
      seedFixes: function (rows) {
        /* 지난 날짜의 교정 기록을 심어 기간 전환을 점검한다(QA 전용) */
        store.chat = store.chat || {};
        var t = store.chat.cafe || (store.chat.cafe = { turns: [], step: 0, at: Date.now() });
        (rows || []).forEach(function (r) {
          t.turns.push({
            role: 'me', text: r.text || 'test sentence', corrected: r.corrected || '',
            notes: (r.notes || []).map(function (n) { return { from: n.from || 'x', to: n.to || 'y', why: n.why || '규칙' }; }),
            natural: '', at: r.at || (Date.now() - (Number(r.days) || 0) * 86400000)
          });
        });
        renderChatTab();
        return chatFixStats();
      },
      back: function () { history.back(); }
    };
  }
  paintSpeed();
  setUiMode(store.settings.mode);
  showTab('home');
  if (location.hash === '#list') showTab('list');
})();
