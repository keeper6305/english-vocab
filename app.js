/* 회화 영어 단어장 · 6,000 SRS — v2 (빈칸 · 문장 순서 · 구문 드릴 · 난이도 프리셋) */
(function () {
  'use strict';

  var KEY = 'vocab5k.v1';
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
      v: 1, cards: {}, stats: {},
      settings: { newPerDay: 20, dir: 'w2m', level: 0, theme: null, includeBasic: false, preset: 'upper', mode: 'quiz', speed: 1 },
      newDay: null, newCount: 0
    };
    if (QA) return base;
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return base;
      var s = JSON.parse(raw);
      s.cards = s.cards || {};
      s.stats = s.stats || {};
      s.settings = Object.assign(base.settings, s.settings || {});
      if (!PRESETS[s.settings.preset]) s.settings.preset = 'upper';
      if (!MODE_LABEL[s.settings.mode]) s.settings.mode = 'quiz';
      return s;
    } catch (e) {
      return base;
    }
  }

  var saveTimer = null;
  function save() {
    if (QA) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { toast('저장 공간이 부족해요'); }
    }, 120);
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
  var LEVELS = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  var META = window.VOCAB_META || { levels: {} };
  var LEVEL_META = {
    1: { name: 'A1 회화 코어', sub: '기초 1,000 — A1 전체 + A2 상위' },
    2: { name: 'A2 일상 회화', sub: '누적 2,000 — A2 + B1 시작' },
    3: { name: 'B1·B2 필수', sub: '누적 3,000 — B1 마무리 + B2 핵심' },
    4: { name: 'B2·C1 상급', sub: '누적 5,000 — B2 + C1, 회화 96~97%' },
    5: { name: '구동사·구문·연결어', sub: '구동사 · 회화 구문 · 고급 연결어 · 비즈니스 청크 1,000' }
  };
  var INDEX = {};
  var LOADED = { 1: true, 2: false, 3: false, 4: false, 5: true };

  function ingest(level) {
    var arr = window['VOCAB_LV' + level] || [];
    LEVELS[level] = arr;
    arr.forEach(function (c, i) {
      var k = c.w.toLowerCase();
      if (!INDEX[k]) INDEX[k] = { c: c, lv: level };
      c._lv = level;
      c._i = i;
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

  function allCards() {
    return LEVELS[1].concat(LEVELS[2], LEVELS[3], LEVELS[4], LEVELS[5]);
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

  function speak(text) {
    if (!speakOk) { toast('이 브라우저는 발음 재생을 지원하지 않아요'); return; }
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = speedRate();
      var v = pickVoice();
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch (e) { toast('발음을 재생할 수 없어요'); }
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
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (tab === 'home') renderHome();
    if (tab === 'list') renderList(true);
    if (tab === 'stats') renderStats();
  }
  $$('.tab').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });
  $$('[data-goto]').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.goto); });
  });

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
      perLevel[lv] = { total: LEVELS[lv].length, master: 0, learning: 0 };
    });
    allCards().forEach(function (c) {
      var r = peek(c.w);
      total++;
      var pl = perLevel[c._lv];
      if (r && r.st >= MASTER_ST) { mastered++; if (pl) pl.master++; }
      else if (r && r.seen > 0) { learning++; if (pl) pl.learning++; }
    });
    return { total: total, mastered: mastered, learning: learning, perLevel: perLevel };
  }

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

  function presetObj() { return PRESETS[store.settings.preset] || PRESETS.upper; }

  function renderHome() {
    var st = stats();
    var due = dueList();
    var weak = weakList();
    $('#dueCount').textContent = due.length;
    var pct = Math.round(st.mastered / deckTotal() * 100);
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
    [1, 2, 3, 4, 5].forEach(function (lv) {
      var pl = st.perLevel[lv];
      var p = pl.total ? Math.round(pl.master / pl.total * 100) : 0;
      var row = document.createElement('button');
      row.className = 'level-row l' + lv;
      row.innerHTML =
        '<div class="lv-badge l' + lv + '">Lv.' + lv + '</div>' +
        '<div class="lv-mid"><div class="lv-name"><b>' + LEVEL_META[lv].name + '</b>' +
        '<span>' + (LEVEL_META[lv].count || pl.total) + '개' + (LEVEL_META[lv].coverage && lv <= 4 ? ' · 회화 ' + LEVEL_META[lv].coverage : '') + '</span></div>' +
        '<div class="lv-bar"><i style="width:' + p + '%"></i></div></div>' +
        '<span class="lv-pct">' + p + '%</span>';
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
    $('#footNote').textContent = '수록 ' + deckTotal().toLocaleString() + '개 · 단어 5,000(B2·C1 상급 포함) + 구동사·구문 1,000';
    renderDrill();
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

  /* ---------------- 세션 ---------------- */
  var S = null;
  var current = null;
  var answered = false;
  var uiMode = 'quiz';

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
      weak.slice(0, 30).forEach(function (c) { push(c, 'weak'); });
    } else if (mode === 'new') {
      if (!news.length) { toast('오늘 새 카드를 다 채웠어요'); return; }
      news.forEach(function (c) { push(c, 'new'); });
    } else {
      due.forEach(function (c) { push(c, 'due'); });
      news.slice(0, 30).forEach(function (c) { push(c, 'new'); });
      if (!queue.length) {
        weak.slice(0, 20).forEach(function (c) { push(c, 'weak'); });
        if (!queue.length) pickNew(20).forEach(function (c) { push(c, 'new'); });
        if (!queue.length) { toast('학습할 카드가 없어요. 모든 카드를 마스터했어요!'); return; }
      }
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
      if (used[k] || queue.length >= 25) return;
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
    if (on) window.scrollTo({ top: 0, behavior: 'auto' });
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
    $('#quizWord').style.fontSize = (dir === 'w2m' ? (c.w.length > 14 ? '24px' : '30px') : (c.m.length > 16 ? '22px' : '28px'));
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
    uniq.forEach(function (opt, i) {
      var b = document.createElement('button');
      b.className = 'opt';
      b.dataset.val = opt;
      b.innerHTML = '<span class="key">' + letters[i] + '</span><span>' + escapeHtml(opt) + '</span>';
      b.addEventListener('click', function () { answerQuiz(b, opt, answer, c, dir); });
      box.appendChild(b);
    });
    $('#quizSpeak').onclick = function (e) { e.stopPropagation(); speak(c.w); };
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
    $('#blankKo').textContent = c.k || '';
    $('#blankNote').textContent = '보기 4개 중 문맥에 맞는 것';
    $('#blankNote').classList.remove('hinted');
    $('#blankSpeak').onclick = function () { speak(c.e || c.w); };

    var opts = blankOptions(c, bt);
    var box = $('#blankOptions');
    box.innerHTML = '';
    var letters = ['A', 'B', 'C', 'D'];
    opts.forEach(function (opt, i) {
      var b = document.createElement('button');
      b.className = 'opt';
      b.dataset.val = opt;
      b.innerHTML = '<span class="key">' + letters[i] + '</span><span>' + escapeHtml(opt) + '</span>';
      b.addEventListener('click', function () { answerBlank(b, opt, c, bt); });
      box.appendChild(b);
    });
  }

  function answerBlank(btn, picked, c, bt) {
    if (answered) return;
    answered = true;
    var isAns = function (v) { return String(v).toLowerCase() === String(c.w).toLowerCase(); };
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

    var body = '<div class="fb-ex"><p class="en">' + escapeHtml(c.e || '') + '</p><p class="ko">' + escapeHtml(c.k || '') + '</p></div>';
    var ansC = c;
    body += '<div class="fb-mean"><span class="pill small">정답 「' + escapeHtml(c.w) + '」 = ' + escapeHtml(ansC.m) + '</span>' +
      (tagOf(c) ? '<span class="pill small">' + escapeHtml(tagOf(c)) + '</span>' : '') + '</div>';
    body += '<p class="fb-nuance">' + escapeHtml(nuance(c, c.w, ok ? null : picked)) + '</p>';
    if (!ok && speakOk) speak(c.e || c.w);
    showFeedback(ok, body, c, rr, nextDue);
  }

  function nuance(c, ans, picked) {
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
    O = { c: c, toks: od.toks, pool: [], placed: [], hints: 0, tries: 0 };
    od.toks.forEach(function (t, i) { O.pool.push({ id: i, t: t }); });
    shuffle(O.pool);
    $('#orderTag').textContent = (tagOf(c) ? tagOf(c) + ' · ' : '') + '타일을 순서대로 눌러 문장을 만드세요';
    $('#orderSrs').textContent = srsInfo(c);
    $('#orderKo').textContent = c.k || '';
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

    var body = '<div class="fb-ex"><p class="en">' + escapeHtml(want) + '</p><p class="ko">' + escapeHtml(c.k || '') + '</p></div>';
    body += '<div class="fb-order">' + O.toks.map(function (t) {
      return '<span class="' + (ok ? 'ok-tile' : 'ok-tile') + '">' + escapeHtml(t) + '</span>';
    }).join('') + '</div>';
    if (!ok) {
      body += '<p class="fb-nuance">네 순서: ' + O.placed.map(function (t) { return escapeHtml(t.t); }).join(' ') +
        '<br>영어는 <b>' + escapeHtml(shortGrammar(c)) + '</b> 순으로 갑니다. 문장을 통째로 소리 내어 세 번 읽어보세요.</p>';
    } else {
      body += '<p class="fb-nuance">' + escapeHtml(shortGrammar(c)) + '. ' + escapeHtml(TAG_TIP[tagOf(c)] || '') + '</p>';
    }
    if (speakOk) speak(want);
    showFeedback(ok, body, c, rr, nextDue);
  }

  function shortGrammar(c) {
    if (c._lv === 5 && /^(Would you mind|Could you|Do you mind|Any chance|I was wondering if|Is it okay if|Would it be okay if|Can I|Could I|May I|Do you want|How about|Why don't we|Let's)/i.test(c.w)) {
      return '상대에게 묻는 말이면 조동사·의문사가 먼저';
    }
    if (/^(I'm|I am|I was|I've|I'd|I can't|I don't|I think|I guess|I hope|I bet|I wish)/i.test(c.w)) {
      return '내 상태·생각이면 주어+동사가 먼저';
    }
    return '주어 → 동사 → 목적어(→ 장소·시간)';
  }

  /* ---------------- 피드백 공통 ---------------- */
  function showFeedback(ok, bodyHtml, c, rr, nextDue) {
    var fb = $('#feedback');
    fb.innerHTML =
      '<div class="fb-head"><span class="fb-title ' + (ok ? 'ok' : 'no') + '">' + (ok ? '정답!' : '아쉬워요') + '</span>' +
      '<button class="fb-next" id="fbNext">다음</button></div>' +
      bodyHtml +
      '<div class="fb-srs">' + (ok ? '다음 복습: ' + nextDue + (rr.st >= MASTER_ST ? '' : ' · ' + rr.st + '단계') : '오답 등록 · 10분 뒤 다시 물어봐요') + '</div>';
    fb.hidden = false;
    $('#fbNext').addEventListener('click', advance);
    if (fb.scrollIntoView && fb.getBoundingClientRect().bottom > window.innerHeight) {
      fb.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---- 플래시카드 ---- */
  function renderFlash(c) {
    var flip = $('#flipCard');
    flip.classList.remove('flipped');
    $('#fcWord').textContent = c.w;
    $('#fcPhon').textContent = c.ph || '';
    $('#fcPos').textContent = tagOf(c) || c.p || '';
    $('#fcPos2').textContent = tagOf(c) || c.p || '';
    $('#fcMeaning').textContent = c.m;
    $('#fcExEn').textContent = c.e || '';
    $('#fcExKo').textContent = c.k || '';
    $('#fcSpeak').hidden = !speakOk;
    $('#fcSpeak').onclick = function (e) { e.stopPropagation(); speak(c.e || c.w); };
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
    if (first) {
      bumpNew();
      store.newCount++;
      store.newDay = todayKey();
    }
    var ok = quality === 2;
    if (ok) {
      r.ok++; ts.ok++;
      r.st = Math.min(MASTER_ST, r.st + 1);
    } else if (quality === 1) {
      r.st = Math.max(0, r.st - 1);
    } else {
      r.bad++;
      r.st = 0;
    }
    var gap = STAGE_GAP[r.st];
    r.due = r.st >= MASTER_ST ? 0 : Date.now() + (gap || MIN10);
    S.answers.push({ w: c.w, ok: ok });
    if (ok) S.correct++;
    if (!ok) {
      var agains = S.queue.filter(function (q) { return q.c.w === c.w && q.kind === 'again'; }).length;
      if (agains < 2) {
        var pos = Math.min(S.queue.length, S.i + 4);
        S.queue.splice(pos, 0, { c: c, kind: 'again' });
      }
    }
    save();
  }

  function advance() {
    if (!S) return;
    S.i++;
    nextCard();
  }

  $('#studyBack').addEventListener('click', function () {
    if (S && S.i > 0 && S.i < S.queue.length) {
      if (!confirm('학습을 그만두고 나갈까요? 지금까지의 기록은 저장돼요.')) return;
    }
    S = null;
    showStudy(false);
    renderHome();
  });

  function endSession() {
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
      (c.e ? '<div class="sheet-ex"><p class="en">' + escapeHtml(c.e) + '</p><p class="ko">' + escapeHtml(c.k || '') + '</p></div>' : '') +
      '<div class="sheet-meta"><span class="pill">Lv.' + c._lv + ' ' + LEVEL_META[c._lv].name + '</span>' +
      (tagOf(c) ? '<span class="pill">' + escapeHtml(tagOf(c)) + '</span>' : '') +
      (st >= MASTER_ST ? '<span class="pill master">마스터</span>' : r && r.seen ? '<span class="pill srs">' + STAGE_LABEL[st] + ' 복습</span>' : '<span class="pill">새 카드</span>') +
      (r && r.bad ? '<span class="pill">오답 ' + r.bad + '회</span>' : '') +
      '</div>' +
      '<div class="sheet-actions">' +
      (speakOk ? '<button class="ghost-btn" id="shSpeak">🔊 발음</button>' : '') +
      '<button class="ghost-btn" id="shStar">' + (r && r.star ? '★ 북마크됨' : '☆ 북마크') + '</button>' +
      '<button class="ghost-btn" id="shStudy">이 카드 학습</button>' +
      '</div>';
    $('#sheetBackdrop').hidden = false;
    $('#sheet').hidden = false;
    var sp = $('#shSpeak');
    if (sp) sp.onclick = function () { speak(c.e || c.w); };
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
    var m = (META.levels || {})[lv] || {};
    var body = $('#sheetBody');
    body.innerHTML =
      '<h3 style="margin:0;font-size:19px;font-weight:800;letter-spacing:-.4px">Lv.' + lv + ' · ' + LEVEL_META[lv].name + '</h3>' +
      '<p class="muted small" style="margin:6px 0 14px">' + LEVEL_META[lv].sub + ' · ' + r.total + '개' +
      (LEVEL_META[lv].coverage && lv <= 4 ? ' · 회화 ' + LEVEL_META[lv].coverage : '') + '</p>' +
      '<div class="stat-row" style="margin-bottom:14px"><div class="mini card"><b>' + r.master + '</b><span>마스터</span></div>' +
      '<div class="mini card"><b>' + r.learning + '</b><span>학습 중</span></div>' +
      '<div class="mini card"><b>' + (r.total - r.master - r.learning) + '</b><span>새 카드</span></div></div>' +
      (m.basis ? '<p class="muted small" style="margin:0 0 12px">' + m.basis + '</p>' : '') +
      '<div class="sheet-actions"><button class="primary-btn" id="lvStart">이 단계 학습</button></div>';
    $('#sheetBackdrop').hidden = false;
    $('#sheet').hidden = false;
    $('#lvStart').onclick = function () {
      closeSheet();
      var pool = items.filter(function (c) { var s = peek(c.w); return !s || (!s.seen && !s.star); }).slice(0, newLeft() || 20);
      var due = items.filter(function (c) { var s = peek(c.w); return s && s.st < MASTER_ST && s.due && s.due <= Date.now(); });
      var queue = [];
      var seen = {};
      due.forEach(function (c) { if (!seen[c.w]) { seen[c.w] = 1; queue.push({ c: c, kind: 'due' }); } });
      pool.forEach(function (c) { if (!seen[c.w]) { seen[c.w] = 1; queue.push({ c: c, kind: 'new' }); } });
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
    var pct = Math.round(st.mastered / deckTotal() * 100);
    $('#totalBar').style.width = pct + '%';
    $('#totalText').textContent = st.mastered.toLocaleString() + ' / ' + deckTotal().toLocaleString() + '개 마스터 · ' + pct + '%';

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
    [1, 2, 3, 4, 5].forEach(function (lv) {
      var pl = st.perLevel[lv];
      var p = pl.total ? Math.round(pl.master / pl.total * 100) : 0;
      var row = document.createElement('div');
      row.className = 'level-row l' + lv;
      row.style.marginBottom = '8px';
      row.innerHTML = '<div class="lv-badge l' + lv + '">Lv.' + lv + '</div>' +
        '<div class="lv-mid"><div class="lv-name"><b>' + LEVEL_META[lv].name + '</b><span>' + pl.master + '/' + pl.total + '</span></div>' +
        '<div class="lv-bar"><i style="width:' + p + '%"></i></div></div><span class="lv-pct">' + p + '%</span>';
      box.appendChild(row);
    });

    $('#newVal').textContent = store.settings.newPerDay;
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
    var lvOrder = [1, 2, 3, 4, 5];
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
      '<p class="basis-lead">단어를 <b>쉬운 순서(CEFR A1 → C1)</b>로 줄 세우고, 그 위에 <b>구동사·회화 구문 1,000개</b>를 얹었습니다. ' +
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
      '<li><b>SRS</b> — 오답 10분 → 1 → 3 → 7 → 14 → 30일 → 마스터(60일+). 학습 기록은 localStorage에 남고 JSON으로 백업합니다.</li></ul></div>' +
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

  $('#newMinus').addEventListener('click', function () {
    store.settings.newPerDay = Math.max(5, store.settings.newPerDay - 5);
    $('#newVal').textContent = store.settings.newPerDay; save();
  });
  $('#newPlus').addEventListener('click', function () {
    store.settings.newPerDay = Math.min(100, store.settings.newPerDay + 5);
    $('#newVal').textContent = store.settings.newPerDay; save();
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
        return { 1: LEVELS[1].length, 2: LEVELS[2].length, 3: LEVELS[3].length, 4: LEVELS[4].length, 5: LEVELS[5].length };
      }
    };
  }
  paintSpeed();
  setUiMode(store.settings.mode);
  showTab('home');
  if (location.hash === '#list') showTab('list');
})();
