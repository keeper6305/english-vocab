/* 회화 영어 단어장 · 6,412 SRS — v3.8
 * - 한 문제마다 즉시 저장(중간에 나가도 푼 만큼 반영) + 이어서 풀기
 * - 모든 학습 세트 10문제
 * - 예문 듣기(TTS, 0.75x/1.0x)
 * - 문제별 맞춤 해설 + 보기(A~D) 뜻
 * - 🗣️ 말하기·발음 교정 (Web Speech API)
 * - 💬 AI 회화방 (주제별 시나리오 + 내장 교정기 + 선택 LLM)
 * - 안드로이드 뒤로가기 2단계
 */
(function () {
  'use strict';

  var KEY = 'vocab5k.v1';
  var SET_SIZE = 10;          /* 모든 학습·퀴즈 세트는 10문제 */
  var NEW_OPTIONS = [5, 10, 15];  /* 하루 새 카드 선택지 — 20 이상은 두지 않는다 */
  var QA = /[?&]qa=1/.test(location.search);
  var DAY = 86400000;
  var MIN10 = 600000;
  /* SRS 사다리 (Anki/SM-2 검증 방식): 오답 10분 → 1 → 3 → 7 → 14 → 30일 → 마스터(60일+) */
  var STAGE_LABEL = ['10분 뒤', '1일 뒤', '3일 뒤', '7일 뒤', '14일 뒤', '30일 뒤', '마스터'];
  var STAGE_GAP = [MIN10, DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 0];
  var MASTER_ST = 6;

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
        preset: 'upper', mode: 'quiz', speed: 1,
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
    S = null;
    showStudy(false);
    showTab('home');
  }
  addEventListener('popstate', function () {
    if (exiting) return;
    if (sheetOpen()) { closeSheet(); rearm(); return; }
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
  function isMaster(word) { var r = peek(word); return !!(r && r.st >= MASTER_ST); }
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
        (tot6 ? ' (' + Math.round(st6.studied / tot6 * 100) + '%)' : '');
    }
  }

  function startConv(mode) {
    var pool = convPool();
    if (!pool.length) { toast('회화 문장을 아직 불러오는 중이에요'); return; }
    var use = mode || 'blank';
    var only = pool.filter(function (c) { return eligibleFor(c, use); });
    if (only.length >= 5) pool = only;
    var queue = [];
    var used = {};
    function push(c, kind) {
      var k = c.w.toLowerCase();
      if (used[k] || queue.length >= SET_SIZE) return;
      used[k] = 1;
      queue.push({ c: c, kind: kind });
    }
    pool.filter(function (c) { return isDue(c.w); }).forEach(function (c) { push(c, 'due'); });
    pool.filter(function (c) { var r = peek(c.w); return r && r.bad > 0 && r.st < MASTER_ST; }).forEach(function (c) { push(c, 'weak'); });
    shuffle(pool.slice()).forEach(function (c) { push(c, 'conv'); });
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
    if (due.length === 0 && left === 0) sub = '오늘 할 일을 다 끝냈어요. 내일 다시 만나요.';
    else if (due.length === 0) sub = '새 카드 ' + left + '개 · ' + mixLabel();
    else sub = '복습 ' + due.length + '개' + (left ? ' · 새 카드 ' + left + '개 · ' + mixLabel() : '');
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

  /* 새 카드는 프리셋 가중치대로. hard:true는 그 레벨의 상위 60%만 (Lv.3 중상위 핵심) */
  function pickNew(limit) {
    var lvPref = +store.settings.level;
    var out = [];
    var seen = {};
    function take(lv, n, hard) {
      if (n <= 0) return 0;
      var arr = LEVELS[lv] || [];
      if (!arr.length) return 0;
      var cut = hard ? Math.floor(arr.length * 0.4) : 0;
      var pool = arr.filter(function (c) {
        var r = peek(c.w);
        return (!r || !r.seen) && !seen[c.w.toLowerCase()] && c._i >= cut;
      });
      shuffle(pool);
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
      weak.slice(0, SET_SIZE).forEach(function (c) { push(c, 'weak'); });
    } else if (mode === 'new') {
      if (!news.length) { toast('오늘 새 카드를 다 채웠어요'); return; }
      news.slice(0, SET_SIZE).forEach(function (c) { push(c, 'new'); });
    } else {
      due.slice(0, SET_SIZE).forEach(function (c) { push(c, 'due'); });
      news.slice(0, SET_SIZE).forEach(function (c) { push(c, 'new'); });
      if (!queue.length) {
        weak.slice(0, SET_SIZE).forEach(function (c) { push(c, 'weak'); });
        if (!queue.length) pickNew(SET_SIZE).forEach(function (c) { push(c, 'new'); });
        if (!queue.length) { toast('학습할 카드가 없어요. 모든 카드를 마스터했어요!'); return; }
      }
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
    var queue = [];
    var used = {};
    function push(c, kind) {
      var k = c.w.toLowerCase();
      if (used[k] || queue.length >= SET_SIZE) return;
      used[k] = 1;
      queue.push({ c: c, kind: kind });
    }
    pool.filter(function (c) { return isDue(c.w); }).forEach(function (c) { push(c, 'due'); });
    pool.filter(function (c) { var r = peek(c.w); return r && r.bad > 0 && r.st < MASTER_ST; }).forEach(function (c) { push(c, 'weak'); });
    shuffle(pool.slice()).forEach(function (c) { push(c, 'drill'); });
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
      dir: S.quizDir, at: Date.now(), n: S.answers.length, ok: S.correct
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
      answers: [], correct: 0, quizDir: st.dir || store.settings.dir, label: st.label || '이어서'
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
    var item = S.queue[S.i];
    current = item.c;
    $('#studyProgress').style.width = Math.round(S.i / Math.max(1, S.queue.length) * 100) + '%';
    $('#studyCounter').textContent = (S.i + 1) + '/' + S.queue.length;
    renderQuestion(current);
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
    var fallback = uiMode === 'blank' ? '4지선다로 대쳴 · ' : uiMode === 'order' ? '4지선다로 대쳴 · ' : '';
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
      '</div>';
  }

  /* ---------------- 피드백 공통 ---------------- */
  function showFeedback(ok, bodyHtml, c, rr, nextDue) {
    var fb = $('#feedback');
    fb.innerHTML =
      '<div class="fb-head"><span class="fb-title ' + (ok ? 'ok' : 'no') + '">' + (ok ? '정답!' : '아쉬워요') + '</span>' +
      '<button class="fb-next" id="fbNext">다음</button></div>' +
      bodyHtml +
      explanationHtml(c) +
      optListHtml() +
      sayRow(c) +
      '<div class="fb-srs">' + (ok ? '다음 복습: ' + nextDue + (rr.st >= MASTER_ST ? '' : ' · ' + rr.st + '단계') : '오답 등록 · 10분 뒤 다시 물어봐요') + '</div>';
    fb.hidden = false;
    $('#fbNext').addEventListener('click', advance);
    var sb = $('#fbSay');
    if (sb) sb.addEventListener('click', function () { speakExample(c); });
    var sbs = $('#fbSaySlow');
    if (sbs) sbs.addEventListener('click', function () { speakExample(c, true); });
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
    $('#fcSpeak').onclick = function (e) { e.stopPropagation(); speak(conv ? c.w : (c.e || c.w)); };
    var fslow = $('#fcSpeakSlow');
    if (fslow) {
      fslow.hidden = !speakOk;
      fslow.onclick = function (e) { e.stopPropagation(); speak(conv ? c.w : (c.e || c.w), 0.75); };
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
    if (!ok) {
      var agains = S.queue.filter(function (q) { return q.c.w === c.w && q.kind === 'again'; }).length;
      if (agains < 2 && S.queue.length < SET_SIZE) {
        var pos = Math.min(S.queue.length, S.i + 4);
        S.queue.splice(pos, 0, { c: c, kind: 'again' });
      }
    }
    persistSession();
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
    $('#resultBox').hidden = false;
    $('#rCorrect').textContent = correct;
    $('#rTotal').textContent = total;
    var pct = total ? Math.round(correct / total * 100) : 0;
    $('#rSub').textContent = (S.label ? S.label + ' · ' : '') +
      (pct >= 90 ? '완벽해요. 다음 복습 주기가 잡혔어요.' : pct >= 60 ? '좋아요. 틀린 카드는 10분 뒤 다시 나와요.' : '오늘은 여기까지. 틀린 카드부터 다시 봐요.');
    var list = $('#rList');
    list.innerHTML = '';
    var seen = {};
    S.answers.forEach(function (a) {
      if (seen[a.w]) return;
      seen[a.w] = 1;
      var d = document.createElement('div');
      d.className = 'r-item' + (a.ok ? '' : ' no');
      var r = peek(a.w);
      d.innerHTML = '<b>' + escapeHtml(a.w) + '</b><span>' + (a.ok ? STAGE_LABEL[(r && r.st) || 0] : '10분 뒤') + '</span>';
      list.appendChild(d);
    });
    var finished = S;
    $('#rAgain').onclick = function () {
      S = null;
      if (finished.mode === 'drill') startDrill(finished.lastMode || 'blank');
      else if (finished.mode === 'conv') startConv(finished.lastMode || 'blank');
      else startSession(finished.mode === 'weak' ? 'weak' : 'mix');
    };
    $('#rHome').onclick = function () { S = null; showStudy(false); showTab('home'); };
    save();
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
        if (c.w.toLowerCase().indexOf(q) === -1 && (c.m || '').indexOf(query) === -1) return;
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
    $('#listMeta').textContent = pool.length.toLocaleString() + '개' + (query ? ' · "' + query + '"' : '');
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
      S = { queue: [{ c: c, kind: 'one' }], i: 0, mode: 'one', answers: [], correct: 0, quizDir: store.settings.dir, label: MODE_LABEL[store.settings.mode] };
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
      var pool = items.filter(function (c) { var s = peek(c.w); return !s || (!s.seen && !s.star); }).slice(0, SET_SIZE);
      var due = items.filter(function (c) { var s = peek(c.w); return s && s.st < MASTER_ST && s.due && s.due <= Date.now(); });
      var queue = [];
      var seen = {};
      due.slice(0, SET_SIZE).forEach(function (c) { if (!seen[c.w]) { seen[c.w] = 1; queue.push({ c: c, kind: 'due' }); } });
      pool.forEach(function (c) { if (!seen[c.w] && queue.length < SET_SIZE) { seen[c.w] = 1; queue.push({ c: c, kind: 'new' }); } });
      if (!queue.length) { toast('이 단계는 학습할 카드가 없어요'); return; }
      S = { queue: queue, i: 0, mode: 'mix', answers: [], correct: 0, quizDir: store.settings.dir, label: 'Lv.' + lv + ' · ' + MODE_LABEL[store.settings.mode] };
      uiMode = store.settings.mode;
      setUiMode(uiMode);
      showStudy(true);
      nextCard();
    };
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
    $$('#dirPick button').forEach(function (b) { b.classList.toggle('active', b.dataset.dir === store.settings.dir); });
    $('#levelPick').value = String(store.settings.level);
    var tg = $('#basicToggle');
    if (tg) { tg.classList.toggle('on', !!store.settings.includeBasic); tg.setAttribute('aria-checked', store.settings.includeBasic ? 'true' : 'false'); }
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

  $$('#newPick button').forEach(function (b) {
    b.addEventListener('click', function () {
      store.settings.newPerDay = +b.dataset.n;
      $$('#newPick button').forEach(function (x) { x.classList.toggle('active', x === b); });
      save();
      renderHome();
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
    var pick = shuffle(pool.slice()).slice(0, SET_SIZE);
    SP = { queue: pick, i: 0, results: [] };
    $('#speakSetup').hidden = true;
    $('#speakRun').hidden = false;
    $('#speakHist').hidden = true;
    $('#tabbar').hidden = true;
    pushLayer();
    speakShow();
  }

  function speakShow() {
    if (!SP) return;
    if (SP.i >= SP.queue.length) { speakFinish(); return; }
    var c = SP.queue[SP.i];
    var t = speakTargetOf(c);
    $('#speakTarget').textContent = t.en;
    $('#speakKo').textContent = t.ko;
    $('#speakTarget').classList.toggle('sent', String(t.en).split(/\s+/).length > 3);
    $('#speakTag').textContent = (spType === 'sent' ? '문장을 따라 말해 보세요' : '단어를 따라 말해 보세요') +
      (tagOf(c) ? ' · ' + tagOf(c) : '');
    $('#speakCounter').textContent = (SP.i + 1) + '/' + SP.queue.length;
    $('#speakProg').style.width = Math.round(SP.i / SP.queue.length * 100) + '%';
    $('#speakResult').hidden = true;
    $('#micLive').textContent = '';
    $('#micHint').textContent = '마이크를 눌러 따라 말하세요';
    MIC.text = '';
    if (speakOk) {
      $('#speakListen').hidden = false;
      $('#speakListenSlow').hidden = false;
    }
  }

  function speakCheck(heard) {
    if (!SP) return;
    var c = SP.queue[SP.i];
    var t = speakTargetOf(c);
    var r = alignSpeech(t.en, heard);
    SP.results.push({ score: r.score, w: t.en });
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
    var n = SP ? SP.results.length : 0;
    var avg = n ? Math.round(SP.results.reduce(function (s, x) { return s + x.score; }, 0) / n) : 0;
    var bar = $('#speakCounter');
    if (bar) bar.textContent = n + '/' + n;
    $('#speakProg').style.width = '100%';
    $('#speakTarget').textContent = '10문제 완료 · 평균 ' + avg + '점';
    $('#speakKo').textContent = '수고했어요. 점수가 낮은 단어는 단어장에서 다시 들어 보세요.';
    $('#speakResult').hidden = true;
    toast('말하기 ' + n + '문제 · 평균 ' + avg + '점');
    SP = { queue: [], i: 0, results: [] };
  }

  function endSpeakRun() {
    SP = null;
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
      if (!SP) return;
      SP.i++;
      speakShow();
    });
    $('#micBtn').addEventListener('click', function () {
      if (!SP) return;
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
    if (st) {
      var n = chatHistoryCount();
      st.textContent = n ? '내가 말한 문장 ' + n + '개가 교정과 함께 저장돼 있어요.' : '아직 기록이 없어요. 주제를 골라 한마디만 해도 쌓입니다.';
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
      hist.innerHTML = rows.length ? rows.slice(0, 30).map(function (r) {
        var x = r.x;
        return '<div class="hrow"><div class="hrow-top"><span class="hrow-topic">' + r.t.icon + ' ' + r.t.name + '</span>' +
          '<span class="hrow-time">' + new Date(x.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + '</span></div>' +
          '<p class="hrow-orig">' + escapeHtml(x.text) + '</p>' +
          (x.corrected && x.corrected !== x.text ? '<p class="hrow-fix">→ ' + escapeHtml(x.corrected) + '</p>' : '') +
          (x.notes && x.notes.length ? '<ul class="hrow-notes">' + x.notes.map(function (n) {
            return '<li><b>' + escapeHtml(n.from) + '</b> → <b>' + escapeHtml(n.to) + '</b> · ' + escapeHtml(n.why) + '</li>';
          }).join('') + '</ul>' : '<p class="hrow-ok">교정할 곳 없음</p>') +
          '</div>';
      }).join('') : '<p class="muted small">기록이 쌓이면 여기에서 한 번에 복습할 수 있어요.</p>';
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
    paintChat();
    pushLayer();
  }

  function closeChatRoom() {
    chatTopic = null;
    $('#chatRoom').hidden = true;
    $('#chatTopics').hidden = false;
    $('#tabbar').hidden = false;
    renderChatTab();
    window.scrollTo({ top: 0, behavior: 'auto' });
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
      var fix = '';
      if (m.corrected && m.corrected !== m.text) {
        fix += '<div class="fix"><p class="fix-line">✏️ ' + escapeHtml(m.corrected) + '</p>' +
          (m.notes && m.notes.length ? '<ul>' + m.notes.map(function (n) {
            return '<li><b>' + escapeHtml(n.from) + '</b> → <b>' + escapeHtml(n.to) + '</b> · ' + escapeHtml(n.why) + '</li>';
          }).join('') + '</ul>' : '') + '</div>';
      }
      if (m.natural) fix += '<div class="nat"><span>더 자연스럽게</span> ' + escapeHtml(m.natural) + '</div>';
      if (fix) fix += '<button class="mini-say" data-say="' + idx + '">🔊 교정문 듣기</button>';
      return '<div class="msg me"><div class="bubble">' + escapeHtml(m.text) + '</div>' + fix + '</div>';
    }).join('');
    $$('#chatLog [data-say]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = st.turns[+b.dataset.say];
        if (m) speak(m.corrected || m.text);
      });
    });
    var last = st.turns[st.turns.length - 1];
    var sug = $('#chatSuggest');
    if (sug) {
      var hint = '';
      if (last && last.role === 'ai') {
        hint = st.lastHint || (chatTopic.script[Math.min(st.step, chatTopic.script.length - 1)] || {}).hint || '';
      }
      var chips = (hint ? [hint] : []).concat(chatTopic.hints || []).slice(0, 3);
      sug.innerHTML = '<span class="sug-lbl">이렇게 말해보세요</span>' + chips.map(function (h) {
        return '<button class="sug">' + escapeHtml(h) + '</button>';
      }).join('');
      $$('#chatSuggest .sug').forEach(function (b) {
        b.addEventListener('click', function () { $('#chatText').value = b.textContent; $('#chatText').focus(); });
      });
    }
    log.scrollTop = log.scrollHeight;
  }

  function chatAiBuiltin(userText) {
    var st = chatStore(chatTopic.id);
    var script = chatTopic.script;
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
    var st = chatStore(chatTopic.id);
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
      $('#chatNote').textContent = 'Enter로 전송 · 마이크로 말하면 자동 입력';
      paintChat();
    };
    if (store.settings.aiKey && store.settings.aiProvider !== 'none') {
      chatAiLLM(msg).then(function (raw) {
        var p = parseLLM(raw);
        if (!p.en) throw new Error('empty');
        if (p.next) chatTopic._lastNext = p.next;
        finish({ en: p.en, ko: p.ko || '' }, p.fix);
      }).catch(function (err) {
        /* 키가 막히면 내장 엔진으로 이어서 대화한다 */
        var r = chatAiBuiltin(msg);
        finish(r, '');
        toast('LLM 호출 실패(' + (err.message || err) + ') — 내장 대화로 이어갑니다');
      });
    } else {
      setTimeout(function () { finish(chatAiBuiltin(msg), ''); }, 260);
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
      back: function () { history.back(); }
    };
  }
  paintSpeed();
  setUiMode(store.settings.mode);
  showTab('home');
  if (location.hash === '#list') showTab('list');
})();
