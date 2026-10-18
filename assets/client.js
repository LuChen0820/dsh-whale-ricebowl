/**
 * 白饭预言家 · DSH 小鲸鱼记账挂件附加层
 *
 * 装饭 → 对话 → 每轮吃掉一些 token（= 米饭）→ 吃完自动讨饭。
 * 每个对话一口锅：1 碗 = 100 万 token，最多显示 5 碗，超出继续记账但 UI 不变。
 *
 * 这个文件是注入到 DSH 页面里的普通脚本：不依赖任何构建工具，
 * 只通过 window.__dshWhaleRoot / .dshwv-root 找宿主挂件，
 * 再把叠加层塞进挂件根节点，随挂件一起缩放、拖动、镜像。
 *
 * v0.5.0：
 *   - 玩法换成「装饭 → 每轮吃 → 吃完讨饭」，不再提前猜本轮用量
 *   - 吃饭动作改成串行咀嚼队列：同一时刻只有一口，米面按口数离散下降
 *   - 每轮结束先补演漏掉的「吃」，再气泡报账（这轮吃了多少 / 还剩多少）
 *   - 讨饭：立绘上浮 / 歪头 + 张嘴「啊——」+ 气泡定时出现消失、文案不连续重复
 *   - 多碗：主碗 + 最多 4 个碗位，最长显示 5 碗
 *   - 嘴位仍按宿主默认立绘 DSniang1.png 标定（config.mouth）
 */
(function () {
  'use strict';
  if (window.__dshWhaleRice) return;
  window.__dshWhaleRice = true;

  var PREFIX = '/dsh-whale-rice';
  var LS = {
    tank: 'dshwr-tank:v1',
    settings: 'dshwr-settings',
    onboarded: 'dshwr-onboarded',
    legacy: ['dshwr-active', 'dshwr-pending', 'dshwr-last', 'dshwr-mouth']
  };

  // 米面模型：y0 = 米面贴碗壁处的高度（viewBox 里的 y），amp = 中间隆起高度。
  // 碗口内沿椭圆：cx=60 cy=41 rx=45 ry=11（米面用它做「刚好满」的基准）。
  // 这些常量必须在 init() 之前赋值（init 里可能同步 mount / render）。
  var BOWL_CX = 60;
  var BOWL_RX = 45;
  var HEAP_KEYS = [
    { fill: 0, y0: 99, amp: 0 },      // 空
    { fill: 0.5, y0: 70, amp: 8 },    // 半碗
    { fill: 0.95, y0: 41, amp: 11 },  // 齐碗口
    { fill: 1.15, y0: 41, amp: 30 }   // 冒出碗口
  ];
  var GRAIN_FILLS = ['#fffdf6', '#fbf6e9', '#fdf9ef', '#f7f0df', '#fffefb'];

  // 1 碗 = 100 万 token；最多显示 5 碗；装饭菜单：小碗 25 万 / 半碗 50 万 / 一碗 100 万。
  var DEFAULT_CONFIG = {
    tokensPerBowl: 1000000,
    maxBowls: 5,
    feedOptions: [
      { label: '小碗', tokens: 250000 },
      { label: '半碗', tokens: 500000 },
      { label: '一碗', tokens: 1000000 }
    ],
    biteTokens: 1800,
    pollRunningMs: 500,
    pollIdleMs: 1600,
    begDelayMs: 9000,
    begIntervalMs: 7000,
    begShowMs: 3400,
    begTimes: 10,          // 先讨饭 10 次
    starveDelayMs: 600000, // 十次讨饭后，再等 10 分钟 →「饿坏了」
    starveIntervalMs: 30000,
    reportMs: 5200,
    // 鲸鱼嘴在立绘图里的相对位置（0~1），按宿主默认立绘 DSniang1.png 标定：
    // 脸在左下方，嘴落在双眼中间偏下（x 55.5%、y 73.5%），嘴宽 = 立绘宽的 8%。
    mouth: { x: 0.555, y: 0.735, size: 0.08 }
  };

  var DEFAULT_LINES = {
    beg: [
      '饭饭…饭饭没有啦…',
      '呜呜…肚子咕噜咕噜叫…',
      '大肥鱼饿饿，给我装饭饭嘛～',
      '咕噜咕噜…碗底光光的啦…',
      '一口…就一口嘛，好不好呀？',
      '哎呀呀…饭没了哟…',
      '饿饿…给我添点饭饭啦～',
      '呜呜呜…要饭饭…',
      '碗都舔得亮晶晶啦…',
      '好饿好饿…咕咕叫啦…',
      '饭饭香香…给我留一口嘛～',
      '说话都没力气啦…来点饭饭嘛…'
    ],
    starve: [
      '唔…已经饿到不想动啦…',
      '大肥鱼饿坏了…扁扁的啦…',
      '呜呜…眼前冒星星啦…',
      '饿得软趴趴…快给点饭饭嘛…',
      '咕…咕…肚子叫得没力气啦…',
      '再不给饭…要变成鱼干啦…',
      '饿坏啦…饭饭快来…',
      '有气无力…就等一口饭饭…'
    ],
    feed: ['装饭啦～', '好耶，有饭吃了。', '这碗先囤着，慢慢吃。', '闻起来好香。'],
    onboard: '点碗装饭：一碗 = 100 万 token；每轮吃完会报账，没饭了它会自己讨饭。'
  };

  var TEMPLATE = [
    '<div class="dshwr-bowlbox" role="button" tabindex="0" aria-label="装饭：给大肥鱼添一碗白饭">',
    '  <div class="dshwr-bowl-wrap">',
    '    <svg class="dshwr-bowl-svg" viewBox="0 0 120 112" aria-hidden="true">',
    '      <defs>',
    '        <linearGradient id="dshwrGlass" x1="0" y1="0" x2="0" y2="1">',
    '          <stop offset="0" stop-color="rgba(255,255,255,0.42)"/>',
    '          <stop offset="0.35" stop-color="rgba(214,231,255,0.22)"/>',
    '          <stop offset="0.8" stop-color="rgba(150,185,255,0.2)"/>',
    '          <stop offset="1" stop-color="rgba(112,152,242,0.34)"/>',
    '        </linearGradient>',
    '        <clipPath id="dshwrBowlClip"><path d="M15,41 C16,68 33,99 60,99 C87,99 104,68 105,41 A45,11 0 0 0 15,41 Z"/></clipPath>',
    '        <clipPath id="dshwrHeapClip"><path d="M15,41 C16,68 33,99 60,99 C87,99 104,68 105,41 A45,42 0 0 0 15,41 Z"/></clipPath>',
    '        <filter id="dshwrBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter>',
    '        <linearGradient id="dshwrRiceGrad" x1="0" y1="0" x2="0" y2="1">',
    '          <stop offset="0" stop-color="#fffef8"/>',
    '          <stop offset="0.5" stop-color="#fdf8ec"/>',
    '          <stop offset="1" stop-color="#f0e5cd"/>',
    '        </linearGradient>',
    '        <linearGradient id="dshwrMouthIn" x1="0" y1="0" x2="0" y2="1">',
    '          <stop offset="0" stop-color="#d1758e"/>',
    '          <stop offset="0.5" stop-color="#eaa3b3"/>',
    '          <stop offset="1" stop-color="#f9d9e0"/>',
    '        </linearGradient>',
    '      </defs>',
    '      <ellipse class="dshwr-shadow" cx="60" cy="108" rx="37" ry="4.4" fill="rgba(8,22,52,0.32)" filter="url(#dshwrBlur)"/>',
    '      <path class="dshwr-bowl-rim dshwr-bowl-rim-back" d="M10,40 A50,13 0 0 1 110,40"/>',
    '      <g class="dshwr-rice" clip-path="url(#dshwrBowlClip)">',
    '        <path class="dshwr-rice-base" d=""/>',
    '        <g class="dshwr-rice-grains"></g>',
    '      </g>',
    '      <path class="dshwr-bowl-glass" d="M10,40 C11,68 30,100 60,100 C90,100 109,68 110,40 A50,13 0 0 1 10,40 Z"/>',
    '      <path class="dshwr-bowl-rim dshwr-bowl-rim-front" d="M10,40 A50,13 0 0 0 110,40"/>',
    '      <path class="dshwr-bowl-highlight" d="M21,54 C23,72 31,86 42,96"/>',
    '      <ellipse class="dshwr-bowl-spark" cx="96.5" cy="62" rx="2.2" ry="6.2" transform="rotate(16 96.5 62)"/>',
    '      <g class="dshwr-steam">',
    '        <path d="M42,26 C37,18 46,13 42,2"/>',
    '        <path d="M60,22 C55,12 66,7 61,-4"/>',
    '        <path d="M78,26 C73,18 82,13 78,2"/>',
    '      </g>',
    '    </svg>',
    '  </div>',
    '  <div class="dshwr-spoon" aria-hidden="true">',
    '    <svg viewBox="0 0 60 150" aria-hidden="true">',
    '      <defs>',
    '        <linearGradient id="dshwrSpoonWood" x1="0" y1="0" x2="1" y2="1">',
    '          <stop offset="0" stop-color="#e8b573"/>',
    '          <stop offset="0.5" stop-color="#cf9450"/>',
    '          <stop offset="1" stop-color="#a96f34"/>',
    '        </linearGradient>',
    '        <radialGradient id="dshwrSpoonBowlG" cx="0.42" cy="0.3" r="0.9">',
    '          <stop offset="0" stop-color="#f3cd93"/>',
    '          <stop offset="0.6" stop-color="#d9a25d"/>',
    '          <stop offset="1" stop-color="#a96f34"/>',
    '        </radialGradient>',
    '      </defs>',
    '      <path class="dshwr-spoon-handle" d="M24,8 Q30,0 36,8 L34,96 Q30,102 26,96 Z"/>',
    '      <ellipse class="dshwr-spoon-bowl" cx="30" cy="117" rx="18" ry="25"/>',
    '      <ellipse class="dshwr-spoon-in" cx="30" cy="112" rx="12" ry="17"/>',
    '      <ellipse class="dshwr-spoon-gloss" cx="23" cy="104" rx="4" ry="7" transform="rotate(-18 23 104)"/>',
    '    </svg>',
    '  </div>',
    '  <div class="dshwr-label" hidden><span class="dshwr-unflip"></span></div>',
    '  <div class="dshwr-stack" aria-hidden="true"></div>',
    '</div>',
    '<div class="dshwr-mouthwrap" aria-hidden="true">',
    '  <div class="dshwr-mouth">',
    '    <svg viewBox="0 0 44 30" preserveAspectRatio="none" aria-hidden="true">',
    '      <path class="dshwr-mouth-shape" d="M6,7.2 C11,8.6 16.4,9.2 22,9.2 C27.6,9.2 33,8.6 38,7.2 C38,15.6 31,22.6 22,22.6 C13,22.6 6,15.6 6,7.2 Z"/>',
    '      <path class="dshwr-mouth-shadow" d="M8.6,8.4 C13.2,10.6 17.6,11.5 22,11.5 C26.4,11.5 30.8,10.6 35.4,8.4 C34,12.6 28.8,15.4 22,15.4 C15.2,15.4 10,12.6 8.6,8.4 Z"/>',
    '      <path class="dshwr-mouth-fang" d="M27.8,9 L31.8,8.5 L29.8,13.3 Z"/>',
    '    </svg>',
    '  </div>',
    '</div>',
    '<div class="dshwr-bubble" hidden><span class="dshwr-bubble-text dshwr-unflip"></span></div>',
    '<div class="dshwr-menu" hidden></div>',
    '<div class="dshwr-settings" hidden></div>'
  ].join('');

  var rt = {
    mounted: false,
    initialized: false,
    root: null,
    layer: null,
    els: null,
    ro: null,
    mo: null,
    watchTimer: null,
    waiting: false,
    config: null,
    lines: null,
    settings: null,
    tanks: null,
    cur: null,
    turnKey: null,
    lastSessionId: null,
    lastTurn: 0,
    // 当前正在进行的回合：只活在内存里，回合结束才落盘
    live: null,        // { sid, turn, seen, remain, pendingFinal }
    eatQueue: [],      // 待播的「一口」
    eatBusy: false,
    turnStartedAt: 0,
    begging: false,
    begTimer: null,
    begShowTimer: null,
    begImgTimer: null,
    begMouthTimer: null,
    lastBeg: '',
    begCount: 0,
    begDone: false,
    starving: false,
    starveTimer: null,
    starveLoop: null,
    lastStarve: '',
    bubbleTimer: null,
    riceTimer: null,
    pourTimer: null,
    pollTimer: null,
    menuOpen: false,
    settingsOpen: false,
    onboarded: false,
    lastSaid: '',
    riceLevel: null,
    riceAnim: 0,
    ricePattern: '',
    mouth: null,
    mouthTimer: null,
    chewTimer: null
  };

  init();

  function init() {
    rt.config = mergeConfig(null);
    rt.lines = mergeLines(null);
    rt.settings = Object.assign({ begging: true, particles: true, label: true, eat: true, sound: true }, readJson(LS.settings) || {});
    rt.onboarded = readJson(LS.onboarded) === true;
    rt.tanks = loadTanks();
    for (var li = 0; li < LS.legacy.length; li++) removeLS(LS.legacy[li]);

    fetchJson(PREFIX + '/config.json').then(function (cfg) {
      if (!cfg) return;
      rt.config = mergeConfig(cfg);
      if (rt.mounted) {
        renderBowl();
        if (rt.menuOpen) rebuildMenu();
        if (rt.settingsOpen) rebuildSettings();
      }
    });
    fetchJson(PREFIX + '/lines.json').then(function (lines) {
      if (lines) rt.lines = mergeLines(lines);
    });
    waitForRoot(mount);
  }

  function mergeConfig(cfg) {
    var base = {
      tokensPerBowl: DEFAULT_CONFIG.tokensPerBowl,
      maxBowls: DEFAULT_CONFIG.maxBowls,
      feedOptions: DEFAULT_CONFIG.feedOptions.map(function (o) { return { label: o.label, tokens: o.tokens }; }),
      biteTokens: DEFAULT_CONFIG.biteTokens,
      pollRunningMs: DEFAULT_CONFIG.pollRunningMs,
      pollIdleMs: DEFAULT_CONFIG.pollIdleMs,
      begDelayMs: DEFAULT_CONFIG.begDelayMs,
      begIntervalMs: DEFAULT_CONFIG.begIntervalMs,
      begShowMs: DEFAULT_CONFIG.begShowMs,
      begTimes: DEFAULT_CONFIG.begTimes,
      starveDelayMs: DEFAULT_CONFIG.starveDelayMs,
      starveIntervalMs: DEFAULT_CONFIG.starveIntervalMs,
      reportMs: DEFAULT_CONFIG.reportMs,
      mouth: { x: DEFAULT_CONFIG.mouth.x, y: DEFAULT_CONFIG.mouth.y, size: DEFAULT_CONFIG.mouth.size }
    };
    if (!cfg || typeof cfg !== 'object') return base;
    ['tokensPerBowl', 'biteTokens', 'pollRunningMs', 'pollIdleMs', 'begDelayMs', 'begIntervalMs', 'begShowMs', 'begTimes', 'starveDelayMs', 'starveIntervalMs', 'reportMs'].forEach(function (key) {
      var n = Number(cfg[key]);
      if (Number.isFinite(n) && n > 0) base[key] = n;
    });
    var maxBowls = Number(cfg.maxBowls);
    if (Number.isFinite(maxBowls) && maxBowls > 0) base.maxBowls = Math.max(1, Math.min(5, Math.round(maxBowls)));
    if (Array.isArray(cfg.feedOptions) && cfg.feedOptions.length) {
      var feed = [];
      for (var fi = 0; fi < cfg.feedOptions.length; fi++) {
        var opt = cfg.feedOptions[fi];
        var optTokens = Math.round(Number(opt && opt.tokens));
        if (!Number.isFinite(optTokens) || optTokens <= 0) continue;
        feed.push({ label: String((opt && opt.label) || ''), tokens: optTokens });
      }
      if (feed.length) base.feedOptions = feed.slice(0, 4);
    }
    if (cfg.mouth && typeof cfg.mouth === 'object') {
      var mx = Number(cfg.mouth.x);
      var my = Number(cfg.mouth.y);
      var ms = Number(cfg.mouth.size);
      if (Number.isFinite(mx)) base.mouth.x = clamp(mx, 0, 1);
      if (Number.isFinite(my)) base.mouth.y = clamp(my, 0, 1);
      if (Number.isFinite(ms)) base.mouth.size = clamp(ms, 0.04, 0.2);
    }
    return base;
  }

  function mergeLines(lines) {
    var out = {};
    for (var key in DEFAULT_LINES) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_LINES, key)) out[key] = DEFAULT_LINES[key];
    }
    if (!lines || typeof lines !== 'object') return out;
    for (var k in lines) {
      if (!Object.prototype.hasOwnProperty.call(lines, k)) continue;
      var value = lines[k];
      if (Array.isArray(value) && value.length) out[k] = value.map(String);
      else if (typeof value === 'string') out[k] = value;
    }
    return out;
  }

  function findRoot() {
    try {
      if (window.__dshWhaleRoot && window.__dshWhaleRoot.isConnected) return window.__dshWhaleRoot;
      return document.querySelector('.dshwv-root');
    } catch (err) {
      return null;
    }
  }

  function waitForRoot(onFound) {
    var found = findRoot();
    if (found) { onFound(found); return; }
    var done = false;
    var obs = null;
    var timer = null;
    function check() {
      if (done) return;
      var root = findRoot();
      if (!root) return;
      done = true;
      if (obs) { try { obs.disconnect(); } catch (err) {} }
      if (timer) clearInterval(timer);
      onFound(root);
    }
    if (typeof MutationObserver === 'function') {
      obs = new MutationObserver(check);
      try { obs.observe(document.documentElement || document, { childList: true, subtree: true }); } catch (err) {}
    }
    timer = setInterval(check, 800);
    check();
  }

  function mount(root) {
    if (!root) return;
    if (rt.mounted && rt.root === root && rt.layer && rt.layer.parentNode === root) return;
    rt.root = root;
    if (!rt.layer) {
      rt.layer = document.createElement('div');
      rt.layer.className = 'dshwr-layer';
      rt.layer.setAttribute('data-dshwr', 'layer');
      rt.layer.innerHTML = TEMPLATE;
    }
    try { root.appendChild(rt.layer); } catch (err) { return; }
    rt.mounted = true;
    cacheEls();
    bindUI();
    updateScale();
    layoutMouth();
    if (typeof ResizeObserver === 'function' && !rt.ro) {
      try {
        rt.ro = new ResizeObserver(updateScale);
        rt.ro.observe(root);
      } catch (err) {}
    }
    window.addEventListener('resize', onWindowResize);
    watchRoot(root);
    syncMirror();
    renderBowl();
    startPolling();
    maybeOnboard();
    updateBegging();
  }

  function onWindowResize() {
    updateScale();
    layoutMouth();
  }

  function cacheEls() {
    var layer = rt.layer;
    rt.els = {
      bowlbox: layer.querySelector('.dshwr-bowlbox'),
      label: layer.querySelector('.dshwr-label .dshwr-unflip'),
      bubble: layer.querySelector('.dshwr-bubble'),
      bubbleText: layer.querySelector('.dshwr-bubble-text'),
      menu: layer.querySelector('.dshwr-menu'),
      settings: layer.querySelector('.dshwr-settings'),
      stack: layer.querySelector('.dshwr-stack'),
      riceGroup: layer.querySelector('.dshwr-rice'),
      riceBase: layer.querySelector('.dshwr-rice-base'),
      riceGrains: layer.querySelector('.dshwr-rice-grains'),
      mouthwrap: layer.querySelector('.dshwr-mouthwrap'),
      mouth: layer.querySelector('.dshwr-mouth')
    };
  }

  function updateScale() {
    if (!rt.layer || !rt.root) return;
    var width = rt.root.clientWidth || 0;
    if (!width) return;
    var scale = Math.max(0.75, Math.min(2.6, width / 260));
    rt.layer.style.setProperty('--dshwr-s', scale.toFixed(3));
  }

  function syncMirror() {
    if (!rt.layer || !rt.root) return;
    var mirrored = false;
    try { mirrored = rt.root.classList.contains('dshwv-left'); } catch (err) {}
    rt.layer.classList.toggle('dshwr-mirrored', mirrored);
  }

  /**
   * 把「鲸鱼嘴」的叠加层对准宿主立绘里的嘴。
   * 宿主立绘 = .dshwv-img（right/bottom 的 59.45% 方块）；嘴的相对位置见 config.mouth。
   * 用 offsetWidth/offsetTop 读布局坐标（不受镜像 transform 影响）。
   * 这里的嘴位按宿主默认立绘 DSniang1.png 标定，换皮肤时改 config.mouth 即可。
   */
  function layoutMouth() {
    if (!rt.mounted || !rt.root || !rt.els || !rt.els.mouthwrap || !rt.els.mouth) return;
    var W = rt.root.offsetWidth;
    var H = rt.root.offsetHeight;
    if (!W || !H) return;
    var img = null;
    try { img = rt.root.querySelector('.dshwv-img'); } catch (err) { img = null; }
    var left;
    var top;
    var iw;
    var ih;
    if (img && img.offsetWidth && img.offsetHeight) {
      iw = img.offsetWidth;
      ih = img.offsetHeight;
      left = img.offsetLeft;
      top = img.offsetTop;
      var parent = img.offsetParent;
      if (parent && parent !== rt.root) {
        left += parent.offsetLeft || 0;
        top += parent.offsetTop || 0;
      }
    } else {
      iw = W * 0.5945;
      ih = H * 0.5945;
      left = W - iw;
      top = H - ih;
    }
    var m = (rt.config && rt.config.mouth) || DEFAULT_CONFIG.mouth;
    var mx = left + iw * m.x;
    var my = top + ih * m.y;
    // 嘴按立绘尺寸等比缩放；高宽比跟 SVG viewBox(44:30) 一致，避免被拉成扁嘴。
    // 0.08 ≈ 立绘宽度的 8%，比立绘的眼睛小一圈，张嘴时刚好能接住饭团。
    var msize = Number(m.size);
    if (!Number.isFinite(msize) || msize < 0.04) msize = 0.08;
    var mw = Math.max(8, iw * clamp(msize, 0.04, 0.2));
    var mh = mw * (30 / 44);
    rt.mouth = { x: mx, y: my, w: mw, h: mh };
    var wrap = rt.els.mouthwrap;
    // 嘴盒本身做成「嘴的大小」，再由 CSS translate(-50%,-50%) 居中：
    // 这样嘴的中心严格等于 (mx,my)，不会被负 margin 造成的收缩框偏移带偏。
    wrap.style.left = (mx / W * 100).toFixed(3) + '%';
    wrap.style.top = (my / H * 100).toFixed(3) + '%';
    wrap.style.width = mw.toFixed(1) + 'px';
    wrap.style.height = mh.toFixed(1) + 'px';
  }

  function watchRoot(root) {
    if (typeof MutationObserver === 'function') {
      try {
        if (rt.mo) rt.mo.disconnect();
        rt.mo = new MutationObserver(syncMirror);
        rt.mo.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
      } catch (err) {}
    }
    if (rt.watchTimer) clearInterval(rt.watchTimer);
    rt.watchTimer = setInterval(function () {
      checkCoexist();
      layoutMouth();
      if (rt.layer && rt.layer.parentNode !== root && root.isConnected) {
        try { root.appendChild(rt.layer); } catch (err) {}
      }
      if (!root.isConnected) {
        rt.mounted = false;
        var next = findRoot();
        if (next) { mount(next); return; }
        if (!rt.waiting) {
          rt.waiting = true;
          waitForRoot(function (found) { rt.waiting = false; mount(found); });
        }
      }
    }, 2000);
  }

  function checkCoexist() {
    if (rt.coexistWarned) return;
    if (window.__dshWhalePlus) {
      rt.coexistWarned = true;
      if (rt.layer) rt.layer.classList.add('dshwr-coexist');
      try { console.info('[白饭预言家] 检测到 dsh-whale-food-expack：两个插件都会在鲸鱼旁摆碗，建议只留一个。'); } catch (err) {}
    }
  }

  function bindUI() {
    var els = rt.els;
    els.bowlbox.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      audioReady();
      if (rt.menuOpen) closeMenu(); else openMenu();
    });
    els.bowlbox.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      ev.stopPropagation();
      if (rt.menuOpen) closeMenu(); else openMenu();
    });
    els.bowlbox.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openSettings();
    });
    rt.layer.addEventListener('click', function (ev) {
      var target = ev.target;
      if (!(target instanceof Element)) return;
      var tierBtn = target.closest('.dshwr-tier');
      if (tierBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        audioReady();
        feedTokens(Number(tierBtn.getAttribute('data-tokens')) || 0);
        return;
      }
      if (target.closest('.dshwr-reset')) {
        ev.preventDefault();
        ev.stopPropagation();
        resetAll();
      }
    });
    rt.layer.addEventListener('change', function (ev) {
      var target = ev.target;
      if (!(target instanceof HTMLInputElement)) return;
      var key = target.getAttribute('data-set');
      if (!key) return;
      rt.settings[key] = !!target.checked;
      writeJson(LS.settings, serializeSettings());
      renderBowl();
      updateBegging();
    });
    document.addEventListener('pointerdown', function (ev) {
      var target = ev.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.dshwr-menu') || target.closest('.dshwr-settings') || target.closest('.dshwr-bowlbox') || target.closest('.dshwr-mouthwrap')) return;
      closeMenu();
      closeSettings();
    }, true);
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      closeMenu();
      closeSettings();
    });
  }

    function startPolling() {
    if (rt.pollTimer) return;
    poll();
  }

  function poll() {
    rt.pollTimer = null;
    if (document.hidden) { schedulePoll(); return; }
    fetchJson(PREFIX + '/turn.json').then(function (snap) {
      if (snap) applySnapshot(snap);
    }).then(schedulePoll, schedulePoll);
  }

  function schedulePoll() {
    if (rt.pollTimer) clearTimeout(rt.pollTimer);
    var running = !!(rt.cur && rt.cur.running);
    var ms = running ? rt.config.pollRunningMs : rt.config.pollIdleMs;
    rt.pollTimer = setTimeout(poll, Math.max(250, Number(ms) || 800));
  }

  function pickSession(snap) {
    var sessions = snap && Array.isArray(snap.sessions) ? snap.sessions.filter(function (s) { return s && s.sessionId; }) : [];
    if (!sessions.length) return null;
    var running = sessions.filter(function (s) { return s.running; });
    if (running.length) {
      running.sort(function (a, b) { return Number(b.lastEventAt || 0) - Number(a.lastEventAt || 0); });
      return running[0];
    }
    sessions.sort(function (a, b) { return Number(b.lastEventAt || 0) - Number(a.lastEventAt || 0); });
    return sessions[0];
  }

  // ================= 米饭库存：每个对话一口锅 =================
  var TANK_KEEP = 30;

  function emptyTank(sid) {
    return { id: String(sid), allocated: 0, consumed: 0, fedAt: 0, updatedAt: Date.now(), turns: 0 };
  }

  function loadTanks() {
    var out = { v: 1, order: [], sessions: {} };
    var raw = readJson(LS.tank);
    if (raw && typeof raw === 'object' && raw.sessions && typeof raw.sessions === 'object') {
      out.order = Array.isArray(raw.order) ? raw.order.map(String) : [];
      for (var sid in raw.sessions) {
        if (!Object.prototype.hasOwnProperty.call(raw.sessions, sid)) continue;
        var row = raw.sessions[sid];
        if (!row || typeof row !== 'object') continue;
        out.sessions[sid] = {
          id: sid,
          allocated: Math.max(0, Number(row.allocated) || 0),
          consumed: Math.max(0, Number(row.consumed) || 0),
          fedAt: Math.max(0, Number(row.fedAt) || 0),
          updatedAt: Math.max(0, Number(row.updatedAt) || 0),
          turns: Math.max(0, Number(row.turns) || 0)
        };
        if (out.order.indexOf(sid) === -1) out.order.push(sid);
      }
    }
    if (!out.sessions['@pending']) out.sessions['@pending'] = emptyTank('@pending');
    return out;
  }

  function saveTanks() {
    writeJson(LS.tank, rt.tanks);
  }

  function tankOf(sid) {
    var key = String(sid || '@pending');
    if (!rt.tanks.sessions[key]) rt.tanks.sessions[key] = emptyTank(key);
    return rt.tanks.sessions[key];
  }

  function activeSid() {
    if (rt.cur && rt.cur.sessionId) return String(rt.cur.sessionId);
    return '@pending';
  }

  function remainOf(tank) {
    if (!tank) return 0;
    return Math.max(0, Math.round(Number(tank.allocated) || 0) - Math.round(Number(tank.consumed) || 0));
  }

  function liveRemain() {
    if (rt.live && rt.live.sid === activeSid()) return Math.max(0, Math.round(Number(rt.live.remain) || 0));
    return remainOf(tankOf(activeSid()));
  }

  function touchOrder(sid) {
    if (!sid || sid === '@pending') return;
    var at = rt.tanks.order.indexOf(sid);
    if (at !== -1) rt.tanks.order.splice(at, 1);
    rt.tanks.order.push(sid);
    while (rt.tanks.order.length > TANK_KEEP) {
      var drop = rt.tanks.order.shift();
      if (drop !== sid && rt.tanks.sessions[drop]) delete rt.tanks.sessions[drop];
    }
  }

  /** 「对话前先装饭」：还没绑定对话时装的饭，在第一轮对话开始时转进这个对话。 */
  function adoptPending(sid) {
    if (!sid || sid === '@pending') return;
    var pending = rt.tanks.sessions['@pending'];
    if (!pending) return;
    var left = remainOf(pending);
    if (left <= 0) return;
    var tank = tankOf(sid);
    if (tank.allocated > 0 || tank.consumed > 0) return;
    tank.allocated = left;
    tank.updatedAt = Date.now();
    pending.allocated = 0;
    pending.consumed = 0;
    saveTanks();
  }

  function tokensPerBowl() {
    return Math.max(1000, Number(rt.config && rt.config.tokensPerBowl) || 1000000);
  }

  /** 主碗显示当前这一碗的剩余比例；多出来的整碗显示在碗位里。 */
  function bowlFillFor(remain) {
    var per = tokensPerBowl();
    var r = Math.max(0, Number(remain) || 0);
    if (r <= 0) return 0;
    var full = Math.floor(r / per);
    var frac = r - full * per;
    if (frac <= per * 0.0004 && full > 0) return 1;
    return clamp(frac / per, 0.02, 1);
  }

  function fullBowlsFor(remain) {
    var per = tokensPerBowl();
    var r = Math.max(0, Number(remain) || 0);
    if (r <= 0) return 0;
    var full = Math.floor(r / per);
    var frac = r - full * per;
    if (frac <= per * 0.0004 && full > 0) full -= 1;
    return clamp(full, 0, Math.max(0, Number(rt.config.maxBowls) - 1));
  }

  function bowlsOf(remain) {
    return Math.max(0, Math.round(Math.max(0, Number(remain) || 0) / tokensPerBowl() * 100) / 100);
  }

  function fmtTokens(n) {
    var v = Math.max(0, Math.round(Number(n) || 0));
    if (v < 10000) return fmt(v);
    var wan = v / 10000;
    return (wan >= 100 ? String(Math.round(wan)) : String(Math.round(wan * 10) / 10)) + ' 万';
  }

  function bowlText(remain) {
    var r = Math.max(0, Number(remain) || 0);
    if (r <= 0) return '没饭了';
    var b = bowlsOf(r);
    var text;
    if (b >= 10) text = String(Math.round(b));
    else if (b >= 1) text = b.toFixed(1).replace(/\.0$/, '');
    else text = b.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return text + ' 碗';
  }

  // ---------- 回合生命周期 ----------
  function startTurn(cur) {
    var sid = String(cur.sessionId);
    adoptPending(sid);
    rt.live = {
      sid: sid,
      turn: Number(cur.turn) || 0,
      seen: Math.max(0, Math.round(Number(cur.actualTokens) || 0)),
      remain: remainOf(tankOf(sid)),
      pendingFinal: null
    };
    rt.turnStartedAt = Date.now();
    updateBegging();
    renderBowl();
  }

  function eatDelta(actual) {
    if (!rt.live) return;
    var prev = Math.max(0, Math.round(Number(rt.live.seen) || 0));
    var now = Math.max(0, Math.round(Number(actual) || 0));
    if (now <= prev) { rt.live.seen = Math.max(prev, now); return; }
    rt.live.seen = now;
    enqueueEat(now - prev, false);
  }

  function biteCountFor(tokens, fast) {
    var per = Math.max(200, Number(rt.config.biteTokens) || 1800);
    return clamp(Math.ceil(Math.max(0, tokens) / per), 1, fast ? 4 : 6);
  }

  function enqueueEat(tokens, fast) {
    if (!rt.live) return;
    var avail = Math.max(0, Math.round(Number(rt.live.remain) || 0));
    if (avail <= 0) return; // 碗里没饭了：不再触发吃饭动作
    var total = Math.min(avail, Math.max(0, Math.round(Number(tokens) || 0)));
    if (total <= 0) return;
    var n = biteCountFor(total, fast);
    var chunk = total / n;
    for (var i = 1; i <= n; i++) {
      rt.live.remain = Math.max(0, rt.live.remain - chunk);
      rt.eatQueue.push({ remain: Math.round(rt.live.remain), fast: !!fast });
    }
    pumpEat();
  }

  function pumpEat() {
    if (rt.eatBusy) return;
    if (!rt.eatQueue.length) { afterEat(); return; }
    var item = rt.eatQueue.shift();
    rt.eatBusy = true;
    playBite(item, function () {
      rt.eatBusy = false;
      pumpEat();
    });
  }

  function playBite(item, done) {
    var box = rt.els && rt.els.bowlbox;
    if (!box) { applyBiteRice(item); if (done) done(); return; }
    layoutMouth();
    if (rt.settings.eat) {
      box.classList.remove('dshwr-bite');
      void box.offsetWidth;
      box.classList.add('dshwr-bite');
      openMouth();
      playSound('scoop');
      setTimeout(spawnMouthful, item.fast ? 90 : 180);
      setTimeout(function () { playSound('clink'); }, item.fast ? 140 : 300);
      setTimeout(function () {
        chompOnce();
        applyBiteRice(item);
      }, item.fast ? 300 : 640);
      setTimeout(function () {
        closeMouth();
        if (box) box.classList.remove('dshwr-bite');
        if (done) done();
      }, item.fast ? 620 : 1180);
      return;
    }
    if (rt.settings.particles) {
      box.classList.remove('dshwr-bite');
      void box.offsetWidth;
      box.classList.add('dshwr-bite');
      for (var g = 0; g < 5; g++) spawnGrain(g);
      setTimeout(function () { if (box) box.classList.remove('dshwr-bite'); }, 380);
    }
    applyBiteRice(item);
    setTimeout(function () { if (done) done(); }, item.fast ? 90 : 180);
  }

  function applyBiteRice(item) {
    var remain = Math.max(0, Math.round(Number(item && item.remain) || 0));
    setRice(bowlFillFor(remain));
    renderStack(remain);
    setLabel(remain);
  }

  function afterEat() {
    if (rt.eatBusy || rt.eatQueue.length) return;
    if (!rt.live || rt.live.pendingFinal == null) { updateBegging(); return; }
    var live = rt.live;
    var final = live.pendingFinal;
    live.pendingFinal = null;
    rt.live = null;
    applyConsume(live, final);
    renderBowl();
    updateBegging();
  }

  function finishTurn(force, actual) {
    if (!rt.live) return;
    var live = rt.live;
    var final = Math.max(
      Math.round(Number(live.seen) || 0),
      Math.round(Number(actual != null ? actual : live.seen) || 0)
    );
    if (live.pendingFinal != null) {
      if (!force) return;
      final = Math.max(final, live.pendingFinal);
    }
    if (force) {
      rt.live = null;
      rt.eatQueue = [];
      rt.eatBusy = false;
      applyConsume(live, final);
      renderBowl();
      updateBegging();
      return;
    }
    live.pendingFinal = final;
    var residual = final - Math.round(Number(live.seen) || 0);
    if (residual > 0) enqueueEat(residual, true);
    if (!rt.eatBusy && !rt.eatQueue.length) {
      rt.live = null;
      applyConsume(live, final);
      renderBowl();
      updateBegging();
    }
  }

  function applyConsume(live, final) {
    var tank = tankOf(live.sid);
    tank.consumed = Math.max(0, Math.round(Number(tank.consumed) || 0) + Math.max(0, Math.round(Number(final) || 0)));
    tank.turns = Math.max(0, Number(tank.turns) || 0) + 1;
    tank.updatedAt = Date.now();
    touchOrder(live.sid);
    saveTanks();
    if (final > 0) {
      var remain = remainOf(tank);
      say('这轮吃了 ' + fmtTokens(final) + ' · ' + (remain > 0 ? '剩 ' + bowlText(remain) : '吃完啦'), Number(rt.config.reportMs) || 5200);
    }
  }

  // ---------- 讨饭 / 饿坏了 ----------
  function updateBegging() {
    var remain = liveRemain();
    var busy = !!rt.live || rt.eatBusy || rt.eatQueue.length > 0;
    var should = !!rt.settings.begging && !busy && remain <= 0;
    if (!should) { stopBegging(); return; }
    if (rt.starving) { ensureStarveLoop(); return; }
    if (rt.begDone) { ensureStarveTimer(); return; }
    if (rt.begging) return;
    rt.begging = true;
    rt.begCount = 0;
    if (rt.begTimer) { clearTimeout(rt.begTimer); clearInterval(rt.begTimer); rt.begTimer = null; }
    rt.begTimer = setTimeout(function () {
      if (!rt.begging) return;
      if (liveRemain() > 0) { stopBegging(); return; }
      begPulse();
      rt.begTimer = setInterval(function () {
        if (!rt.begging) return;
        if (liveRemain() > 0) { stopBegging(); return; }
        begPulse();
      }, Math.max(2400, Number(rt.config.begIntervalMs) || 7000));
    }, Math.max(800, Number(rt.config.begDelayMs) || 6000));
  }

  function stopBegging() {
    rt.begging = false;
    rt.begCount = 0;
    rt.begDone = false;
    rt.starving = false;
    if (rt.begTimer) { clearTimeout(rt.begTimer); clearInterval(rt.begTimer); rt.begTimer = null; }
    if (rt.starveTimer) { clearTimeout(rt.starveTimer); rt.starveTimer = null; }
    if (rt.starveLoop) { clearInterval(rt.starveLoop); rt.starveLoop = null; }
    if (rt.begShowTimer) { clearTimeout(rt.begShowTimer); rt.begShowTimer = null; }
    if (rt.begImgTimer) { clearTimeout(rt.begImgTimer); rt.begImgTimer = null; }
    if (rt.begMouthTimer) { clearTimeout(rt.begMouthTimer); rt.begMouthTimer = null; }
    if (rt.layer) rt.layer.classList.remove('dshwr-beg', 'dshwr-starving');
    var img = hungerImg();
    if (img) img.classList.remove('dshwr-beg-img', 'dshwr-starve-img');
    if (rt.mounted && !rt.eatBusy && !rt.eatQueue.length) setLabel(liveRemain());
  }

  function hungerImg() {
    try { return rt.root ? rt.root.querySelector('.dshwv-img') : null; } catch (err) { return null; }
  }

  function pickHungerLine(pool, lastKey) {
    var arr = (rt.lines && Array.isArray(pool) && pool.length) ? pool : ['…'];
    if (arr.length === 1) return arr[0];
    var line = arr[Math.floor(Math.random() * arr.length)];
    if (line === rt[lastKey]) line = arr[(arr.indexOf(line) + 1) % arr.length];
    rt[lastKey] = line;
    return line;
  }

  function begPulse() {
    if (!rt.mounted) return;
    if (liveRemain() > 0) { stopBegging(); return; }
    say(pickHungerLine(rt.lines.beg, 'lastBeg'), Number(rt.config.begShowMs) || 3400);
    var img = hungerImg();
    if (img) {
      img.classList.remove('dshwr-beg-img');
      void img.offsetWidth;
      img.classList.add('dshwr-beg-img');
      if (rt.begImgTimer) clearTimeout(rt.begImgTimer);
      rt.begImgTimer = setTimeout(function () { if (img) img.classList.remove('dshwr-beg-img'); }, 2000);
    }
    if (rt.layer) {
      rt.layer.classList.add('dshwr-beg');
      if (rt.begShowTimer) clearTimeout(rt.begShowTimer);
      rt.begShowTimer = setTimeout(function () { if (rt.layer) rt.layer.classList.remove('dshwr-beg'); }, 1500);
    }
    playSound('beg');
    if (rt.settings.eat) {
      layoutMouth();
      var mouth = rt.els && rt.els.mouth;
      if (mouth) {
        mouth.classList.remove('dshwr-mouth-chomp');
        mouth.classList.add('dshwr-mouth-open');
      }
      if (rt.begMouthTimer) clearTimeout(rt.begMouthTimer);
      rt.begMouthTimer = setTimeout(closeMouth, 900);
    }
    rt.begCount += 1;
    if (rt.begCount >= Math.max(1, Number(rt.config.begTimes) || 10)) {
      rt.begging = false;
      if (rt.begTimer) { clearInterval(rt.begTimer); rt.begTimer = null; }
      rt.begDone = true;
      ensureStarveTimer();
    }
  }

  function ensureStarveTimer() {
    if (rt.starveTimer || rt.starving) return;
    rt.starveTimer = setTimeout(enterStarving, Math.max(5000, Number(rt.config.starveDelayMs) || 600000));
  }

  function enterStarving() {
    rt.starveTimer = null;
    if (!rt.settings.begging) return;
    if (liveRemain() > 0) { stopBegging(); return; }
    if (rt.starving) return;
    rt.starving = true;
    rt.begDone = true;
    if (rt.layer) rt.layer.classList.add('dshwr-starving');
    var img = hungerImg();
    if (img) {
      img.classList.remove('dshwr-beg-img');
      img.classList.add('dshwr-starve-img');
    }
    setLabel(0);
    starvePulse();
    if (rt.starveLoop) clearInterval(rt.starveLoop);
    rt.starveLoop = setInterval(starvePulse, Math.max(8000, Number(rt.config.starveIntervalMs) || 30000));
  }

  function ensureStarveLoop() {
    if (rt.starveLoop) return;
    starvePulse();
    rt.starveLoop = setInterval(starvePulse, Math.max(8000, Number(rt.config.starveIntervalMs) || 30000));
  }

  function starvePulse() {
    if (!rt.starving) return;
    if (liveRemain() > 0) { stopBegging(); return; }
    say(pickHungerLine(rt.lines.starve, 'lastStarve'), Math.max(3000, Number(rt.config.begShowMs) || 3400) + 1200);
    var img = hungerImg();
    if (img) img.classList.add('dshwr-starve-img');
    if (rt.settings.eat) {
      layoutMouth();
      var mouth = rt.els && rt.els.mouth;
      if (mouth) {
        mouth.classList.remove('dshwr-mouth-open');
        mouth.classList.remove('dshwr-mouth-chomp');
        mouth.classList.add('dshwr-mouth-soft');
      }
      if (rt.begMouthTimer) clearTimeout(rt.begMouthTimer);
      rt.begMouthTimer = setTimeout(closeMouth, 1200);
    }
  }

  // ---------- 快照 ----------
  function applySnapshot(snap) {
    var cur = pickSession(snap);
    if (!cur) { rt.cur = null; renderBowl(); updateBegging(); return; }
    var actual = Math.max(0, Math.round(Number(cur.actualTokens) || 0));
    var running = !!cur.running;
    var sid = String(cur.sessionId);
    var turn = Number(cur.turn) || 0;

    if (!rt.initialized) {
      rt.initialized = true;
      rt.cur = cur;
      rt.lastSessionId = sid;
      rt.lastTurn = turn;
      rt.turnKey = sid + ':' + turn;
      if (running) startTurn(cur); else renderBowl();
      updateBegging();
      return;
    }

    if (sid !== rt.lastSessionId || turn !== rt.lastTurn) {
      if (rt.live) finishTurn(true, rt.live.seen);
      rt.cur = cur;
      rt.lastSessionId = sid;
      rt.lastTurn = turn;
      rt.turnKey = sid + ':' + turn;
      if (running) startTurn(cur);
      renderBowl();
      updateBegging();
      return;
    }

    rt.cur = cur;
    if (running) {
      if (!rt.live) startTurn(cur);
      eatDelta(actual);
    } else if (rt.live) {
      finishTurn(false, actual);
    }
    if (!rt.live && !rt.eatBusy && rt.eatQueue.length === 0) renderBowl();
    updateBegging();
  }

  // 米堆几何常量见文件顶部（必须在 init() 之前完成赋值）

  /** 饭量 -> 米面参数：三档锚点之间线性插值（半碗 / 齐碗口 / 冒尖）。 */
  function moundGeom(fill) {
    var f = clamp(Number(fill) || 0, 0, 1.6);
    var lo = HEAP_KEYS[0];
    var hi = HEAP_KEYS[HEAP_KEYS.length - 1];
    for (var i = 1; i < HEAP_KEYS.length; i++) {
      if (f <= HEAP_KEYS[i].fill) { lo = HEAP_KEYS[i - 1]; hi = HEAP_KEYS[i]; break; }
    }
    var span = hi.fill - lo.fill;
    var t = span > 0 ? clamp((f - lo.fill) / span, 0, 1) : 0;
    return {
      fill: f,
      y0: lo.y0 + (hi.y0 - lo.y0) * t,
      amp: lo.amp + (hi.amp - lo.amp) * t
    };
  }

  /** 米面曲线：中间高、两边低（碗口椭圆的弧线），米粒从这条线往下长。 */
  function pileTop(x, geom) {
    var u = clamp((x - BOWL_CX) / BOWL_RX, -1, 1);
    return geom.y0 - geom.amp * Math.sqrt(Math.max(0, 1 - u * u));
  }

  /** 米饭「实体」：从碗底一直填到米面曲线的一块整饭，米粒只是它表面的纹理。 */
  function riceBasePath(geom) {
    var d = 'M4,101';
    for (var x = 4; x <= 116; x += 4) {
      d += ' L' + x + ',' + pileTop(x, geom).toFixed(2);
    }
    d += ' L116,101 Z';
    return d;
  }

  function riceGrainsHtml(geom) {
    var f = geom.fill;
    var heaped = f > 0.98;
    // 米粒只是「熟饭」表面的纹理：小、密、和底色接近，只留很淡的粒痕。
    // 碗比之前小 20%，米粒在 viewBox 里同比放大，屏幕上的颗粒大小保持不变。
    var gs = 1.12;
    var sx = (heaped ? 4.9 : (f < 0.55 ? 5.6 : 5.2)) * gs;
    var sy = (heaped ? 4.4 : (f < 0.55 ? 5.0 : 4.7)) * gs;
    var seed = 20261018;
    function rand() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }
    function grain(px, py, jitter) {
      var rx = (3.0 + rand() * 1.3) * gs;
      var ry = (1.45 + rand() * 0.65) * gs;
      var rot = -40 + rand() * 80;
      var fill = GRAIN_FILLS[Math.floor(rand() * GRAIN_FILLS.length)];
      if (jitter) {
        px += (rand() - 0.5) * sx * 0.5;
        py += (rand() - 0.5) * sy * 0.5;
      }
      return '<ellipse cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" rx="' + rx.toFixed(2) + '" ry="' + ry.toFixed(2) + '" fill="' + fill + '" stroke="#ded2b5" stroke-width="0.54" transform="rotate(' + rot.toFixed(0) + ' ' + px.toFixed(1) + ' ' + py.toFixed(1) + ')"/>';
    }
    var html = [];
    var row = 0;
    for (var y = geom.y0 - geom.amp - gs; y < 100; y += sy) {
      var offset = (row % 2) * sx * 0.5;
      for (var x = 5 + offset; x < 115; x += sx) {
        if (y < pileTop(x, geom) - 0.4) continue;
        html.push(grain(x, y, true));
      }
      row++;
    }
    // 表面/堆边补一圈米粒，让轮廓是一粒粒米而不是一条线
    var n = Math.round(14 + Math.min(1.2, f) * 10);
    for (var i = 0; i < n; i++) {
      if (rand() < 0.16) continue;
      var t = (i + 0.5) / n;
      var ex = 5 + 110 * t + (rand() - 0.5) * 5 * gs;
      var ey = pileTop(ex, geom) + (rand() - 0.5) * 1.8 * gs - 0.8;
      html.push(grain(ex, ey, false));
    }
    return html.join('');
  }

  function applyRice(fill) {
    rt.riceLevel = fill;
    if (!rt.els || !rt.els.riceGrains) return;
    var geom = moundGeom(fill);
    var empty = fill <= 0.015;
    var heaped = fill > 0.98;
    // 齐口/半碗裁在碗口内沿（米粒不会溢出碗沿）；只有冒尖的大碗才允许堆到碗口以上。
    if (rt.els.riceGroup) rt.els.riceGroup.setAttribute('clip-path', heaped ? 'url(#dshwrHeapClip)' : 'url(#dshwrBowlClip)');
    if (rt.els.riceBase) rt.els.riceBase.setAttribute('d', empty ? '' : riceBasePath(geom));
    rt.els.riceGrains.innerHTML = empty ? '' : riceGrainsHtml(geom);
  }

  /** 把米堆动画到目标体积；空碗淡出。 */
  function setRice(fill) {
    if (!rt.mounted || !rt.els || !rt.els.riceGrains) return;
    var f = clamp(Number(fill) || 0, 0, 1.5);
    rt.layer.classList.toggle('dshwr-rice-gone', f <= 0.012);
    if (rt.riceAnim) { cancelAnimationFrame(rt.riceAnim); rt.riceAnim = 0; }
    var from = rt.riceLevel == null ? 0 : rt.riceLevel;
    if (Math.abs(f - from) < 0.004) {
      applyRice(f);
      return;
    }
    var start = 0;
    var dur = 480;
    function step(now) {
      if (!start) start = now;
      var t = Math.min(1, (now - start) / dur);
      var ease = 1 - Math.pow(1 - t, 3);
      applyRice(from + (f - from) * ease);
      if (t < 1) {
        rt.riceAnim = requestAnimationFrame(step);
      } else {
        rt.riceAnim = 0;
        applyRice(f);
      }
    }
    rt.riceAnim = requestAnimationFrame(step);
  }

  function renderBowl() {
    if (!rt.mounted || !rt.els) return;
    var remain = liveRemain();
    var eating = rt.eatBusy || rt.eatQueue.length > 0;
    if (!eating) {
      setRice(bowlFillFor(remain));
      renderStack(remain);
      setLabel(remain);
    }
    layoutMouth();
    var running = !!(rt.cur && rt.cur.running);
    var fill = bowlFillFor(remain);
    rt.layer.classList.toggle('dshwr-hungry', remain <= 0);
    rt.layer.classList.toggle('dshwr-empty', remain <= 0);
    rt.layer.classList.toggle('dshwr-running', running);
    rt.layer.classList.toggle('dshwr-rice-low', remain > 0 && fill < 0.18);
    rt.layer.classList.toggle('dshwr-steam-on', fill > 0.15);
  }

  function setLabel(remain) {
    if (!rt.els || !rt.els.label) return;
    var text = '';
    if (rt.settings.label !== false) text = remain > 0 ? bowlText(remain) : (rt.starving ? '饿坏了…' : '没饭了');
    rt.els.label.textContent = text;
    var box = rt.els.label.parentNode;
    if (box) box.hidden = !text;
  }

  function renderStack(remain) {
    if (!rt.els || !rt.els.stack) return;
    var full = fullBowlsFor(remain);
    var html = '';
    for (var i = 0; i < full; i++) html += '<span class="dshwr-pip"></span>';
    if (rt.els.stack.innerHTML !== html) rt.els.stack.innerHTML = html;
    rt.els.stack.hidden = full <= 0;
  }

  function feedTokens(tokens) {
    var amount = Math.max(0, Math.round(Number(tokens) || 0));
    if (amount <= 0) return;
    var sid = activeSid();
    var tank = tankOf(sid);
    tank.allocated = Math.max(0, Math.round(Number(tank.allocated) + amount));
    tank.fedAt = Date.now();
    tank.updatedAt = Date.now();
    touchOrder(sid);
    saveTanks();
    if (rt.live && rt.live.sid === sid) rt.live.remain = Math.max(0, Math.round(Number(rt.live.remain) || 0) + amount);
    say(pickLine(rt.lines.feed), 2400);
    fx.addRice();
    fx.pour();
    feedReaction();
    closeMenu();
    renderBowl();
    updateBegging();
  }

  function openMenu() {
    if (!rt.els) return;
    closeSettings();
    rebuildMenu();
    rt.els.menu.hidden = false;
    rt.menuOpen = true;
    if (rt.layer) rt.layer.classList.add('dshwr-menu-open');
  }

  function closeMenu() {
    if (!rt.els) return;
    rt.els.menu.hidden = true;
    rt.menuOpen = false;
    if (rt.layer) rt.layer.classList.remove('dshwr-menu-open');
  }

  function rebuildMenu() {
    if (!rt.els) return;
    var remain = liveRemain();
    var per = tokensPerBowl();
    var html = '<div class="dshwr-menu-note"><span class="dshwr-unflip">' + esc(remain > 0 ? '剩 ' + bowlText(remain) : '碗是空的') + '</span></div>';
    html += '<div class="dshwr-menu-grid">';
    var options = Array.isArray(rt.config.feedOptions) && rt.config.feedOptions.length ? rt.config.feedOptions : DEFAULT_CONFIG.feedOptions;
    for (var i = 0; i < options.length; i++) {
      var opt = options[i] || {};
      var amount = Math.max(0, Math.round(Number(opt.tokens) || 0));
      if (amount <= 0) continue;
      html += '<button type="button" class="dshwr-tier" data-tokens="' + amount + '">'
        + '<b class="dshwr-unflip">装' + esc(opt.label || '一碗') + '</b>'
        + '<span class="dshwr-tier-k dshwr-unflip">（' + esc(fmtTokens(amount)) + '）</span>'
        + '</button>';
    }
    html += '</div>';
    rt.els.menu.innerHTML = html;
  }

  function openSettings() {
    if (!rt.els) return;
    closeMenu();
    rebuildSettings();
    rt.els.settings.hidden = false;
    rt.settingsOpen = true;
  }

  function closeSettings() {
    if (!rt.els) return;
    rt.els.settings.hidden = true;
    rt.settingsOpen = false;
  }

  function rebuildSettings() {
    if (!rt.els) return;
    var remaining = liveRemain();
    var tank = tankOf(activeSid());
    var html = '<div class="dshwr-set-title"><span class="dshwr-unflip">白饭预言家</span><small>v0.5.5</small></div>';
    html += setRow('begging', '没饭时讨饭', rt.settings.begging);
    html += setRow('eat', '吃饭动作（嘴 / 嚼）', rt.settings.eat);
    html += setRow('sound', '吃饭音效', rt.settings.sound);
    html += setRow('particles', '米粒特效', rt.settings.particles);
    html += setRow('label', '数字标签', rt.settings.label);
    html += '<div class="dshwr-acct">';
    html += '<div class="dshwr-acct-title dshwr-unflip">本对话饭账</div>';
    html += '<div class="dshwr-acct-row"><span class="dshwr-unflip">已装</span><b class="dshwr-unflip">' + esc(fmtTokens(tank.allocated)) + '</b></div>';
    html += '<div class="dshwr-acct-row"><span class="dshwr-unflip">已吃</span><b class="dshwr-unflip">' + esc(fmtTokens(tank.consumed)) + '</b></div>';
    html += '<div class="dshwr-acct-row"><span class="dshwr-unflip">剩</span><b class="dshwr-unflip">' + esc(fmtTokens(remaining)) + '（' + esc(bowlText(remaining)) + '）</b></div>';
    html += '</div>';
    html += '<button type="button" class="dshwr-btn dshwr-reset"><span class="dshwr-unflip">清空饭账</span></button>';
    rt.els.settings.innerHTML = html;
  }

  function serializeSettings() {
    return {
      begging: !!rt.settings.begging,
      particles: !!rt.settings.particles,
      label: !!rt.settings.label,
      eat: !!rt.settings.eat,
      sound: !!rt.settings.sound
    };
  }

  function setRow(key, label, on) {
    return '<label class="dshwr-set-row"><input type="checkbox" data-set="' + key + '"' + (on ? ' checked' : '') + '><span class="dshwr-unflip">' + label + '</span></label>';
  }

  function resetAll() {
    rt.tanks = { v: 1, order: [], sessions: {} };
    rt.tanks.sessions['@pending'] = emptyTank('@pending');
    rt.live = null;
    rt.eatQueue = [];
    rt.eatBusy = false;
    stopBegging();
    saveTanks();
    closeSettings();
    renderBowl();
    updateBegging();
    say('饭账清空啦，从头再来。', 2600);
  }

  function maybeOnboard() {
    if (rt.onboarded) return;
    setTimeout(function () {
      if (rt.onboarded) return;
      if (rt.cur && rt.cur.running) return;
      if (liveRemain() > 0) return;
      rt.onboarded = true;
      writeJson(LS.onboarded, true);
      say(rt.lines.onboard, 6000);
    }, 2600);
  }

  function say(text, ms) {
    if (!rt.els) return;
    var bubble = rt.els.bubble;
    rt.lastSaid = String(text);
    rt.els.bubbleText.textContent = String(text);
    bubble.hidden = false;
    bubble.classList.remove('dshwr-bubble-hide');
    void bubble.offsetWidth;
    bubble.classList.add('dshwr-bubble-show');
    if (rt.bubbleTimer) clearTimeout(rt.bubbleTimer);
    rt.bubbleTimer = setTimeout(function () {
      bubble.classList.remove('dshwr-bubble-show');
      bubble.classList.add('dshwr-bubble-hide');
      setTimeout(function () {
        if (bubble.classList.contains('dshwr-bubble-hide')) bubble.hidden = true;
      }, 300);
    }, Math.max(1200, Number(ms) || 3200));
  }

  // ---------- 声音：WebAudio 现场合成，不打包任何音频文件 ----------

  var snd = { ctx: null };

  /** 用户手势里调用一次：创建 / 恢复 AudioContext（浏览器自动播放策略）。 */
  function audioReady() {
    try {
      if (!snd.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        snd.ctx = new AC();
      }
      if (snd.ctx.state === 'suspended' && snd.ctx.resume) snd.ctx.resume();
      return snd.ctx;
    } catch (err) {
      snd.ctx = null;
      return null;
    }
  }

  function noiseBuffer(ctx, dur) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function playNoise(ctx, opts) {
    var t = ctx.currentTime + (opts.at || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, opts.dur || 0.2);
    var filter = ctx.createBiquadFilter();
    filter.type = opts.type || 'bandpass';
    filter.frequency.setValueAtTime(opts.freq || 1000, t);
    if (opts.freqEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(80, opts.freqEnd), t + (opts.dur || 0.2));
    filter.Q.value = opts.q || 1;
    var gain = ctx.createGain();
    var peak = Math.max(0.0002, opts.gain || 0.05);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + (opts.attack || 0.012));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur || 0.2));
    src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    src.start(t); src.stop(t + (opts.dur || 0.2) + 0.02);
  }

  function playTone(ctx, opts) {
    var t = ctx.currentTime + (opts.at || 0);
    var osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq || 800, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.freqEnd), t + (opts.dur || 0.1));
    var gain = ctx.createGain();
    var peak = Math.max(0.0002, opts.gain || 0.03);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + (opts.attack || 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur || 0.1));
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + (opts.dur || 0.1) + 0.02);
  }

  /** kind: pour（倒饭）/ scoop（舀饭）/ clink（碰碗）/ chew（咀嚼）/ beg（讨饭） */
  function playSound(kind) {
    if (rt.settings && rt.settings.sound === false) return;
    if (document.hidden) return;
    var ctx = snd.ctx;
    if (!ctx) return;
    try {
      if (kind === 'pour') {
        // 倒饭：轻轻的沙沙声 + 一点亮晶晶的碎响
        playNoise(ctx, { type: 'bandpass', freq: 1800, freqEnd: 3000, q: 0.6, dur: 0.28, gain: 0.03, attack: 0.04 });
        playTone(ctx, { type: 'sine', freq: 1200, freqEnd: 1650, dur: 0.16, gain: 0.012, at: 0.05 });
        playTone(ctx, { type: 'sine', freq: 1500, freqEnd: 1200, dur: 0.12, gain: 0.01, at: 0.16 });
      } else if (kind === 'scoop') {
        // 木勺舀饭：软软的「沙」+ 上扬的小「啵」
        playNoise(ctx, { type: 'bandpass', freq: 900, freqEnd: 1500, q: 0.8, dur: 0.16, gain: 0.026, attack: 0.02 });
        playTone(ctx, { type: 'sine', freq: 620, freqEnd: 980, dur: 0.1, gain: 0.02, at: 0.01 });
        playTone(ctx, { type: 'triangle', freq: 1560, freqEnd: 1860, dur: 0.07, gain: 0.008, at: 0.05 });
      } else if (kind === 'clink') {
        // 勺碰碗：小铃铛「叮」，两颗高音叠一起，余音软软的
        playTone(ctx, { type: 'sine', freq: 2093, dur: 0.26, gain: 0.016 });
        playTone(ctx, { type: 'sine', freq: 2637, dur: 0.2, gain: 0.011, at: 0.01 });
        playTone(ctx, { type: 'triangle', freq: 3520, dur: 0.12, gain: 0.005, at: 0.02 });
      } else if (kind === 'chew') {
        // 咀嚼：软软的两下「嗯嘛」，圆润、偏高，不用低频轰隆声
        playTone(ctx, { type: 'sine', freq: 640, freqEnd: 430, dur: 0.1, gain: 0.026, attack: 0.012 });
        playTone(ctx, { type: 'triangle', freq: 1280, freqEnd: 900, dur: 0.07, gain: 0.007, at: 0.004 });
        playNoise(ctx, { type: 'bandpass', freq: 1400, q: 1.4, dur: 0.05, gain: 0.008, at: 0.01 });
        playTone(ctx, { type: 'sine', freq: 560, freqEnd: 380, dur: 0.1, gain: 0.02, at: 0.14, attack: 0.012 });
        playTone(ctx, { type: 'triangle', freq: 1120, freqEnd: 780, dur: 0.06, gain: 0.006, at: 0.145 });
        playTone(ctx, { type: 'sine', freq: 860, freqEnd: 720, dur: 0.06, gain: 0.006, at: 0.23 });
      } else if (kind === 'beg') {
        // 讨饭：软软的一声「呜…」，尾音往下掉
        playTone(ctx, { type: 'sine', freq: 880, freqEnd: 560, dur: 0.38, gain: 0.015, attack: 0.02 });
        playTone(ctx, { type: 'triangle', freq: 440, freqEnd: 320, dur: 0.34, gain: 0.006, at: 0.02 });
        playTone(ctx, { type: 'sine', freq: 980, freqEnd: 640, dur: 0.3, gain: 0.007, at: 0.1 });
      }
    } catch (err) {}
  }

  // 给本地 demo / 调试音效用（只是转发，不参与业务逻辑）
  try {
    window.__dshwhaleRiceSound = function (kind) {
      audioReady();
      playSound(kind);
    };
  } catch (err) {}

  // ---------- 吃饭动作 ----------

  function openMouth() {
    var mouth = rt.els && rt.els.mouth;
    if (!mouth) return;
    mouth.classList.remove('dshwr-mouth-soft');
    mouth.classList.remove('dshwr-mouth-chomp');
    mouth.classList.add('dshwr-mouth-open');
  }

  function closeMouth() {
    var mouth = rt.els && rt.els.mouth;
    if (!mouth) return;
    mouth.classList.remove('dshwr-mouth-open');
    mouth.classList.remove('dshwr-mouth-soft');
    mouth.classList.remove('dshwr-mouth-chomp');
  }

  /** 接饭时先「啊」一下，等真吃的时候再咬 —— 让装饭这个动作更有反应。 */
  function feedReaction() {
    if (!rt.settings.eat) return;
    var mouth = rt.els && rt.els.mouth;
    if (!mouth) return;
    layoutMouth();
    mouth.classList.remove('dshwr-mouth-open');
    mouth.classList.remove('dshwr-mouth-chomp');
    mouth.classList.add('dshwr-mouth-soft');
    if (rt.mouthTimer) clearTimeout(rt.mouthTimer);
    rt.mouthTimer = setTimeout(closeMouth, 760);
  }

  function chewWhale() {
    if (!rt.root) return;
    var img = null;
    try { img = rt.root.querySelector('.dshwv-img'); } catch (err) { img = null; }
    if (!img) return;
    img.classList.remove('dshwr-chewing');
    void img.offsetWidth;
    img.classList.add('dshwr-chewing');
    // 立绘在嚼的时候，嘴也跟着轻轻上下动 —— 不然嘴和人物会各动各的。
    var wrap = rt.els && rt.els.mouthwrap;
    if (wrap) {
      wrap.classList.remove('dshwr-mouth-bob');
      void wrap.offsetWidth;
      wrap.classList.add('dshwr-mouth-bob');
    }
    if (rt.chewTimer) clearTimeout(rt.chewTimer);
    rt.chewTimer = setTimeout(function () {
      try { img.classList.remove('dshwr-chewing'); } catch (err) {}
      if (wrap) wrap.classList.remove('dshwr-mouth-bob');
    }, 940);
  }

  function chompOnce() {
    var mouth = rt.els && rt.els.mouth;
    if (!mouth) return;
    mouth.classList.remove('dshwr-mouth-soft');
    mouth.classList.add('dshwr-mouth-open');
    mouth.classList.remove('dshwr-mouth-chomp');
    void mouth.offsetWidth;
    mouth.classList.add('dshwr-mouth-chomp');
    chewWhale();
    playSound('chew');
    spawnMunch();
    if (rt.settings.particles) spawnCrumbs();
    setTimeout(function () {
      if (rt.els && rt.els.mouth) rt.els.mouth.classList.remove('dshwr-mouth-chomp');
    }, 760);
  }

  function spawnMouthful() {
    if (!rt.mounted || !rt.layer || !rt.els || !rt.mouth) return;
    var box = rt.els.bowlbox;
    if (!box) return;
    var sx = box.offsetLeft + box.offsetWidth * 0.5;
    var sy = box.offsetTop + box.offsetHeight * 0.46;
    var dx = rt.mouth.x - sx;
    var dy = rt.mouth.y - sy;
    var el = document.createElement('span');
    el.className = 'dshwr-mouthful dshwr-mouthful-fly';
    el.style.left = sx.toFixed(1) + 'px';
    el.style.top = sy.toFixed(1) + 'px';
    el.style.setProperty('--dx', dx.toFixed(1) + 'px');
    el.style.setProperty('--dy', dy.toFixed(1) + 'px');
    rt.layer.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 700);
  }

  function spawnCrumbs() {
    if (!rt.mouth || !rt.layer) return;
    for (var i = 0; i < 4; i++) {
      var el = document.createElement('span');
      el.className = 'dshwr-crumb';
      el.style.left = rt.mouth.x.toFixed(1) + 'px';
      el.style.top = rt.mouth.y.toFixed(1) + 'px';
      el.style.setProperty('--cx', (-10 + Math.random() * 20).toFixed(0) + 'px');
      el.style.setProperty('--cy', (-6 + Math.random() * 16).toFixed(0) + 'px');
      el.style.animationDelay = (i * 30) + 'ms';
      rt.layer.appendChild(el);
      (function (node) {
        setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, 700);
      })(el);
    }
  }

  function spawnMunch() {
    if (!rt.mouth || !rt.layer) return;
    var words = ['啊呜', '嚼嚼', '吧唧'];
    var el = document.createElement('span');
    el.className = 'dshwr-munch';
    var inner = document.createElement('i');
    inner.className = 'dshwr-unflip';
    inner.textContent = words[Math.floor(Math.random() * words.length)];
    el.appendChild(inner);
    el.style.left = (rt.mouth.x - rt.mouth.w * 1.15).toFixed(1) + 'px';
    el.style.top = (rt.mouth.y + rt.mouth.h * 0.95).toFixed(1) + 'px';
    rt.layer.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 780);
  }

  var fx = {
    addRice: function () {
      if (!rt.mounted || !rt.els) return;
      var box = rt.els.bowlbox;
      if (!box) return;
      box.classList.remove('dshwr-rice-in');
      void box.offsetWidth;
      box.classList.add('dshwr-rice-in');
      if (rt.riceTimer) clearTimeout(rt.riceTimer);
      rt.riceTimer = setTimeout(function () { box.classList.remove('dshwr-rice-in'); }, 650);
    },
    float: function (tokens) {
      if (!rt.mounted || !rt.layer) return;
      var el = document.createElement('span');
      el.className = 'dshwr-float';
      el.textContent = '+' + fmt(tokens);
      el.style.left = (30 + Math.random() * 14).toFixed(2) + '%';
      el.style.top = (64 + Math.random() * 4).toFixed(2) + '%';
      el.style.setProperty('--fx', (-6 + Math.random() * 12).toFixed(0) + 'px');
      rt.layer.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1200);
    },
    pour: function () {
      if (!rt.mounted || !rt.els) return;
      var box = rt.els.bowlbox;
      if (!box) return;
      box.classList.remove('dshwr-pour');
      void box.offsetWidth;
      box.classList.add('dshwr-pour');
      if (rt.pourTimer) clearTimeout(rt.pourTimer);
      rt.pourTimer = setTimeout(function () { box.classList.remove('dshwr-pour'); }, 900);
      playSound('pour');
      if (!rt.settings.particles) return;
      for (var i = 0; i < 12; i++) spawnPourGrain(i);
    }
  };

  function spawnGrain(index) {
    if (!rt.layer) return;
    var grain = document.createElement('span');
    grain.className = 'dshwr-grain';
    grain.style.left = (26 + Math.random() * 24).toFixed(2) + '%';
    grain.style.top = (71 + Math.random() * 9).toFixed(2) + '%';
    grain.style.setProperty('--dx', (14 + Math.random() * 44).toFixed(0) + 'px');
    grain.style.setProperty('--dy', (-18 - Math.random() * 40).toFixed(0) + 'px');
    grain.style.setProperty('--rot', (-140 + Math.random() * 280).toFixed(0) + 'deg');
    grain.style.animationDelay = (index * 42) + 'ms';
    rt.layer.appendChild(grain);
    setTimeout(function () {
      if (grain.parentNode) grain.parentNode.removeChild(grain);
    }, 1100);
  }

  function spawnPourGrain(index) {
    if (!rt.layer) return;
    var grain = document.createElement('span');
    grain.className = 'dshwr-pour-grain';
    grain.style.left = (27 + Math.random() * 23).toFixed(2) + '%';
    grain.style.top = (50 + Math.random() * 6).toFixed(2) + '%';
    grain.style.setProperty('--px', (-12 + Math.random() * 24).toFixed(0) + 'px');
    grain.style.setProperty('--rot', (-60 + Math.random() * 140).toFixed(0) + 'deg');
    grain.style.animationDelay = (index * 45) + 'ms';
    rt.layer.appendChild(grain);
    setTimeout(function () {
      if (grain.parentNode) grain.parentNode.removeChild(grain);
    }, 1400);
  }

  function pickLine(pool) {
    var arr = Array.isArray(pool) && pool.length ? pool : ['…'];
    if (arr.length === 1) return arr[0];
    var line = arr[Math.floor(Math.random() * arr.length)];
    if (line === rt.lastSaid) line = arr[(arr.indexOf(line) + 1) % arr.length];
    return line;
  }

  function sum(list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += Number(list[i]) || 0;
    return total;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function fmt(value) {
    var n = Math.max(0, Math.round(Number(value) || 0));
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      return res && res.ok ? res.json() : null;
    }).catch(function () { return null; });
  }

  function readJson(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) { return null; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {}
  }

  function removeLS(key) {
    try { localStorage.removeItem(key); } catch (err) {}
  }

})();
