/* ============================================================
   FAYROW — main script
   ============================================================ */
(() => {
  'use strict';

  const C = window.SITE_CONFIG;
  const T = window.I18N;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('fy_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('fy_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const root = document.documentElement;
  const body = document.body;

  /* ---------- state ---------- */
  const detectLang = () => {
    const n = (navigator.language || 'en').toLowerCase();
    return n.startsWith('ru') ? 'ru' : n.startsWith('uz') ? 'uz' : 'en';
  };
  let lang = store.get('lang', detectLang());
  if (!T[lang]) lang = 'en';
  let theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  let bgMode = store.get('bg', 'aurora');
  let blur = store.get('blur', 0);
  let volume = store.get('vol', C.music && C.music.volume != null ? C.music.volume : 0.35);
  let musicWanted = store.get('music', true);
  let discordStatus = '';

  const t = (path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), T[lang]);

  /* ============================================================
     i18n
     ============================================================ */
  function applyLang() {
    $$('[data-i18n]').forEach((el) => {
      const v = t(el.dataset.i18n);
      if (v != null) el.textContent = v;
    });
    $$('[data-i18n-title]').forEach((el) => {
      const v = t(el.dataset.i18nTitle);
      if (v != null) { el.title = v; el.setAttribute('aria-label', v); }
    });
    root.lang = T[lang].meta.lang;
    document.title = T[lang].meta.title;
    $$('.lang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
    updateStatusText();
    placeLangPill();
    placeNavPill();
  }

  async function setLang(l) {
    if (l === lang) return;
    lang = l;
    store.set('lang', l);
    if (reduced) { applyLang(); typeCode(true); return; }
    body.classList.add('swap');
    $$('.lang button').forEach((b) => b.classList.toggle('active', b.dataset.lang === l));
    placeLangPill();
    await sleep(230);
    applyLang();
    body.classList.remove('swap');
    typeCode(true);
  }

  function placeLangPill() {
    const wrap = $('.lang');
    const act = $('.lang button.active');
    if (!wrap || !act) return;
    wrap.style.setProperty('--x', act.offsetLeft + 'px');
    wrap.style.setProperty('--w', act.offsetWidth + 'px');
  }

  /* ============================================================
     Theme (circular reveal)
     ============================================================ */
  function applyTheme(next) {
    theme = next;
    root.dataset.theme = next;
    store.set('theme', next);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = next === 'dark' ? '#07070d' : '#f3f1fb';
    readColors();
  }

  function toggleTheme(x, y) {
    const next = theme === 'dark' ? 'light' : 'dark';
    if (reduced) { applyTheme(next); return; }

    if (document.startViewTransition) {
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      const vt = document.startViewTransition(() => applyTheme(next));
      vt.ready.then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 750, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' }
        );
      }).catch(() => {});
    } else {
      root.classList.add('theme-fade');
      applyTheme(next);
      setTimeout(() => root.classList.remove('theme-fade'), 700);
    }
  }

  /* ============================================================
     Background: canvas (particles / stars) + blur
     ============================================================ */
  const canvas = $('#bgCanvas');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, items = [], shooting = [], raf = 0;
  const mouse = { x: -9999, y: -9999 };
  let col = { a: '143,123,255', b: '56,225,255', c: '255,106,213' };

  function readColors() {
    const cs = getComputedStyle(root);
    col = {
      a: cs.getPropertyValue('--accent-rgb').trim() || col.a,
      b: cs.getPropertyValue('--accent2-rgb').trim() || col.b,
      c: cs.getPropertyValue('--accent3-rgb').trim() || col.c,
    };
  }

  function resizeCanvas() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
  }

  function seed() {
    items = [];
    if (bgMode === 'particles') {
      const n = clamp(Math.round((W * H) / 15000), 28, 110);
      for (let i = 0; i < n; i++) {
        items.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .45, vy: (Math.random() - .5) * .45, r: Math.random() * 1.6 + .8 });
      }
    } else if (bgMode === 'stars') {
      const n = clamp(Math.round((W * H) / 7000), 60, 260);
      for (let i = 0; i < n; i++) {
        items.push({ x: Math.random() * W, y: Math.random() * H, z: Math.random() * .9 + .1, tw: Math.random() * Math.PI * 2, ts: Math.random() * .02 + .005 });
      }
    }
  }

  function drawParticles() {
    ctx.clearRect(0, 0, W, H);
    const link = 130;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10; else if (p.y > H + 10) p.y = -10;

      const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 22000) { const f = (1 - d2 / 22000) * .6; p.x += (dx / Math.sqrt(d2 + 1)) * f; p.y += (dy / Math.sqrt(d2 + 1)) * f; }

      ctx.beginPath();
      ctx.fillStyle = `rgba(${col.a},.85)`;
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();

      for (let j = i + 1; j < items.length; j++) {
        const q = items[j], ax = p.x - q.x, ay = p.y - q.y, d = ax * ax + ay * ay;
        if (d < link * link) {
          ctx.strokeStyle = `rgba(${col.b},${(1 - Math.sqrt(d) / link) * .32})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }
  }

  function drawStars() {
    ctx.clearRect(0, 0, W, H);
    const px = (mouse.x > -999 ? (mouse.x / W - .5) : 0) * 18;
    const py = (mouse.y > -999 ? (mouse.y / H - .5) : 0) * 18;
    for (const s of items) {
      s.tw += s.ts;
      s.y += s.z * .12;
      if (s.y > H + 4) { s.y = -4; s.x = Math.random() * W; }
      const a = (Math.sin(s.tw) * .5 + .5) * .8 + .15;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${s.z > .65 ? col.b : col.a},${a * s.z})`;
      ctx.arc(s.x + px * s.z, s.y + py * s.z, s.z * 1.7, 0, 6.2832);
      ctx.fill();
    }
    if (Math.random() < .006 && shooting.length < 2) {
      shooting.push({ x: Math.random() * W * .8 + W * .2, y: Math.random() * H * .4, l: 0, v: Math.random() * 7 + 9 });
    }
    for (let i = shooting.length - 1; i >= 0; i--) {
      const s = shooting[i];
      s.x -= s.v; s.y += s.v * .55; s.l += 1;
      const g = ctx.createLinearGradient(s.x, s.y, s.x + 90, s.y - 50);
      g.addColorStop(0, `rgba(${col.c},.95)`); g.addColorStop(1, `rgba(${col.c},0)`);
      ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + 90, s.y - 50); ctx.stroke();
      if (s.l > 60 || s.x < -100 || s.y > H + 100) shooting.splice(i, 1);
    }
  }

  function loop() {
    if (bgMode === 'particles') drawParticles();
    else if (bgMode === 'stars') drawStars();
    raf = requestAnimationFrame(loop);
  }

  function setBg(mode, save = true) {
    bgMode = mode;
    body.dataset.bg = mode;
    if (save) store.set('bg', mode);
    $$('#bgSeg button').forEach((b) => b.classList.toggle('active', b.dataset.bg === mode));
    cancelAnimationFrame(raf);
    seed();
    shooting = [];
    if (mode === 'particles' || mode === 'stars') {
      loop();
    } else {
      setTimeout(() => { if (bgMode === mode) ctx.clearRect(0, 0, W, H); }, 1000);
    }
  }

  function setBlur(v, save = true) {
    blur = v;
    root.style.setProperty('--bgblur', v + 'px');
    $('#blurVal').textContent = v + 'px';
    $('#blurRange').value = v;
    if (save) store.set('blur', v);
  }

  /* ============================================================
     Music (built-in ambient generator OR an audio file)
     ============================================================ */
  const music = (() => {
    const hasFile = !!(C.music && C.music.src);
    let audio = null, ac = null, master = null, bus = null, pluckBus = null;
    let timers = [], playing = false, chordIdx = 0;

    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const CHORDS = [
      [45, 52, 55, 59, 64],   // Am9
      [41, 48, 52, 57, 60],   // Fmaj7
      [48, 55, 59, 64, 67],   // Cmaj7
      [43, 50, 55, 59, 62],   // G6
    ];
    const PLUCKS = [69, 72, 74, 76, 79, 81, 84];

    function impulse(sec, decay) {
      const len = ac.sampleRate * sec, buf = ac.createBuffer(2, len, ac.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return buf;
    }

    function initAmbient() {
      if (ac) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain(); master.gain.value = 0;
      const comp = ac.createDynamicsCompressor();
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = .4;
      bus = ac.createGain();
      const conv = ac.createConvolver(); conv.buffer = impulse(5, 2.4);
      const wet = ac.createGain(); wet.gain.value = .6;
      const dry = ac.createGain(); dry.gain.value = .55;
      bus.connect(dry); bus.connect(conv); conv.connect(wet);
      dry.connect(lp); wet.connect(lp); lp.connect(comp); comp.connect(master); master.connect(ac.destination);

      // echo for plucks
      pluckBus = ac.createGain();
      const dly = ac.createDelay(2); dly.delayTime.value = .46;
      const fb = ac.createGain(); fb.gain.value = .4;
      pluckBus.connect(bus); pluckBus.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(bus);
    }

    function pad(freq, start, dur) {
      const g = ac.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(.05, start + 3);
      g.gain.setValueAtTime(.05, start + dur - 1);
      g.gain.linearRampToValueAtTime(0, start + dur + 4);
      g.connect(bus);
      [[freq, 'sine', -5], [freq, 'triangle', 6]].forEach(([f, type, cents]) => {
        const o = ac.createOscillator();
        o.type = type; o.frequency.value = f; o.detune.value = cents;
        o.connect(g); o.start(start); o.stop(start + dur + 4.2);
      });
    }

    function pluck(freq, start) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(.07, start + .02);
      g.gain.exponentialRampToValueAtTime(.0008, start + 2.6);
      o.connect(g); g.connect(pluckBus);
      o.start(start); o.stop(start + 2.8);
    }

    function schedule() {
      if (!playing || !ac) return;
      const now = ac.currentTime + .05, dur = 9;
      CHORDS[chordIdx % CHORDS.length].forEach((m) => pad(mtof(m), now, dur));
      // soft pentatonic melody over the chord
      let at = 1 + Math.random();
      while (at < dur - 1) {
        if (Math.random() < .8) pluck(mtof(PLUCKS[(Math.random() * PLUCKS.length) | 0]), now + at);
        at += 1.1 + Math.random() * 1.8;
      }
      chordIdx++;
      timers.push(setTimeout(schedule, dur * 1000 - 600));
    }

    const api = {
      get playing() { return playing; },
      get ready() { return hasFile ? true : (ac ? ac.state === 'running' : false); },

      prepare() { if (!hasFile) initAmbient(); },

      async start() {
        if (playing) return true;
        if (hasFile) {
          if (!audio) { audio = new Audio(C.music.src); audio.loop = true; }
          audio.volume = 0;
          try { await audio.play(); } catch { return false; }
          playing = true; fade(audio, volume, 2500);
          return true;
        }
        initAmbient();
        if (!ac) return false;
        // without a user gesture resume() may stay pending forever — don't wait for it
        try { await Promise.race([ac.resume(), sleep(450)]); } catch { return false; }
        if (ac.state !== 'running') return false;
        playing = true;
        master.gain.cancelScheduledValues(ac.currentTime);
        master.gain.setValueAtTime(master.gain.value, ac.currentTime);
        master.gain.linearRampToValueAtTime(volume, ac.currentTime + 3);
        schedule();
        return true;
      },

      stop() {
        if (!playing) return;
        playing = false;
        timers.forEach(clearTimeout); timers = [];
        if (hasFile && audio) { fade(audio, 0, 900, () => audio.pause()); return; }
        if (ac) {
          master.gain.cancelScheduledValues(ac.currentTime);
          master.gain.setValueAtTime(master.gain.value, ac.currentTime);
          master.gain.linearRampToValueAtTime(0, ac.currentTime + 1);
          setTimeout(() => { if (!playing && ac) ac.suspend().catch(() => {}); }, 1200);
        }
      },

      setVolume(v) {
        if (hasFile && audio && playing) audio.volume = v;
        else if (ac && playing) master.gain.setTargetAtTime(v, ac.currentTime, .15);
      },
    };

    function fade(a, to, ms, done) {
      const from = a.volume, t0 = performance.now();
      (function step(now) {
        const k = clamp((now - t0) / ms, 0, 1);
        a.volume = clamp(from + (to - from) * k, 0, 1);
        if (k < 1) requestAnimationFrame(step); else if (done) done();
      })(t0);
    }
    return api;
  })();

  function syncMusicBtn() {
    const b = $('#musicBtn');
    b.classList.toggle('playing', music.playing);
    b.setAttribute('aria-pressed', String(music.playing));
  }

  let gestureBound = false;
  function armFirstGesture() {
    if (gestureBound) return;
    gestureBound = true;
    const evs = ['pointerdown', 'keydown', 'touchend', 'click'];
    const handler = async (e) => {
      if (e.target && e.target.closest && e.target.closest('#musicBtn')) { off(); return; } // button handles itself
      if (!musicWanted) { off(); return; }
      const ok = await music.start();
      if (ok) { off(); syncMusicBtn(); hideHint(); }
    };
    const off = () => { evs.forEach((ev) => removeEventListener(ev, handler, true)); gestureBound = false; };
    evs.forEach((ev) => addEventListener(ev, handler, true));
  }

  async function tryAutoMusic() {
    if (!musicWanted) return;
    music.prepare();
    const ok = await music.start();
    syncMusicBtn();
    if (!ok) { armFirstGesture(); showHint(); }
  }

  let hintTimer;
  function showHint() { toast(t('ui.musicHint'), 6000, true); }
  function hideHint() { clearTimeout(hintTimer); $('#toast').classList.remove('show'); }

  /* ============================================================
     Toast
     ============================================================ */
  function toast(msg, ms = 2000, sticky = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ============================================================
     Typing code block
     ============================================================ */
  let typeRun = 0;

  function codeLines() {
    const c = T[lang].code;
    const list = [];
    C.stack.forEach((s, i) => {
      list.push(['str', `"${s}"`]);
      if (i < C.stack.length - 1) list.push(['p', ', ']);
    });
    return [
      [['kw', 'const '], ['var', 'me'], ['p', ' = {']],
      [['p', '  '], ['key', 'name'], ['p', ': '], ['str', `"${C.name}"`], ['p', ',']],
      [['p', '  '], ['key', 'age'], ['p', ': '], ['num', String(C.age)], ['p', ',']],
      [['p', '  '], ['key', 'role'], ['p', ': '], ['str', `"${c.role}"`], ['p', ',']],
      [['p', '  '], ['key', 'stack'], ['p', ': ['], ...list, ['p', '],']],
      [['p', '  '], ['key', 'location'], ['p', ': '], ['str', `"${c.location}"`], ['p', ',']],
      [['p', '  '], ['key', 'status'], ['p', ': '], ['str', `"${c.status}"`], ['p', ',']],
      [['p', '};']],
    ];
  }

  async function typeCode(fast = false) {
    const run = ++typeRun;
    const pre = $('#code');
    pre.textContent = '';
    const caret = document.createElement('span');
    caret.className = 'caret';
    pre.append(caret);
    const lines = codeLines();

    if (reduced) {
      lines.forEach((ln, i) => {
        ln.forEach(([cls, txt]) => { const s = document.createElement('span'); s.className = 't-' + cls; s.textContent = txt; pre.insertBefore(s, caret); });
        if (i < lines.length - 1) pre.insertBefore(document.createTextNode('\n'), caret);
      });
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      for (const [cls, txt] of lines[i]) {
        const span = document.createElement('span');
        span.className = 't-' + cls;
        pre.insertBefore(span, caret);
        for (const ch of txt) {
          if (run !== typeRun) return;
          span.textContent += ch;
          await sleep(fast ? 9 : 24 + Math.random() * 40);
        }
      }
      if (i < lines.length - 1) {
        pre.insertBefore(document.createTextNode('\n'), caret);
        await sleep(fast ? 25 : 170 + Math.random() * 120);
      }
    }
  }

  /* ============================================================
     Discord profile (live)
     ============================================================ */
  const cardEl = $('#pcard');

  function crossfade(container, url, onlyIfNew = true) {
    if (!url) return;
    if (onlyIfNew && container.dataset.src === url) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      container.dataset.src = url;
      img.className = 'layer';
      img.alt = '';
      container.appendChild(img);
      requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('show')));
      setTimeout(() => $$('.layer', container).forEach((l) => { if (l !== img) l.remove(); }), 1200);
    };
    img.onerror = () => {};
    img.src = url;
  }

  function applyProfile(p) {
    if (p.displayName) $('#dName').textContent = p.displayName;
    if (p.username) $('#dUser').textContent = '@' + p.username;
    if (p.avatar) {
      crossfade($('#avatar'), p.avatar);
      const fb = $('#avatarFallback'); if (fb) setTimeout(() => (fb.style.display = 'none'), 1200);
    }
    const banner = $('#banner');
    if (p.banner) {
      crossfade(banner, p.banner);
    } else {
      // no banner on the account — remove old image, use the profile colour
      if (banner.dataset.src) { delete banner.dataset.src; $$('.layer', banner).forEach((l) => l.remove()); }
      if (p.bannerColor) { banner.style.setProperty('--b1', p.bannerColor); banner.style.setProperty('--b2', 'var(--accent3)'); }
    }
  }

  function updateStatusText() {
    const el = $('#dStatus');
    const s = T[lang].status[discordStatus];
    el.textContent = s || '';
    cardEl.dataset.status = discordStatus || '';
  }

  const validId = (id) => /^\d{15,25}$/.test(String(id || ''));

  async function refreshDiscord() {
    let srv = null, lan = null;
    try {
      const r = await fetch('/api/discord', { cache: 'no-store' });
      if (r.ok) srv = await r.json();
    } catch { /* offline / no backend */ }

    if (C.useLanyard && validId(C.discordId)) {
      try {
        const r = await fetch(`https://api.lanyard.rest/v1/users/${C.discordId}`);
        const j = await r.json();
        if (j && j.success) lan = j.data;
      } catch { /* ignore */ }
    }

    if (srv && srv.avatar) {
      applyProfile(srv);
    } else if (lan && lan.discord_user) {
      const u = lan.discord_user;
      applyProfile({
        displayName: u.global_name || u.username,
        username: u.username,
        avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=512` : null,
      });
    }

    if (lan) { discordStatus = lan.discord_status || 'offline'; updateStatusText(); }
  }

  /* ============================================================
     Loader
     ============================================================ */
  function runLoader() {
    const loader = $('#loader'), bar = $('.loader-bar i'), pct = $('.loader-pct');
    const MIN = reduced ? 600 : 2600;
    const start = performance.now();
    let loaded = false, p = 0, finished = false;

    Promise.all([
      document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
      document.readyState === 'complete' ? Promise.resolve() : new Promise((r) => addEventListener('load', r, { once: true })),
    ]).then(() => { loaded = true; }).catch(() => { loaded = true; });
    setTimeout(() => { loaded = true; }, 6000);

    function frame(now) {
      const k = clamp((now - start) / MIN, 0, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      const target = loaded ? eased : Math.min(eased, .9);
      p += (target - p) * .14;
      const shown = clamp(p, 0, 1);
      bar.style.setProperty('--p', shown.toFixed(4));
      pct.textContent = Math.round(shown * 100) + '%';
      if (k >= 1 && loaded && shown > .995) return finish();
      requestAnimationFrame(frame);
    }

    async function finish() {
      if (finished) return; finished = true;
      bar.style.setProperty('--p', 1);
      pct.textContent = '100%';
      await sleep(350);
      loader.classList.add('done');
      await sleep(reduced ? 50 : 500);
      body.classList.remove('loading');
      body.classList.add('ready');
      startReveal();
      setTimeout(() => loader.remove(), 1400);
      typeCodeAfterDelay();
      tryAutoMusic();
    }
    requestAnimationFrame(frame);
  }

  async function typeCodeAfterDelay() { await sleep(reduced ? 0 : 900); typeCode(false); }

  /* ============================================================
     Reveal on scroll + counters
     ============================================================ */
  function startReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        io.unobserve(el);
        el.classList.add('in');
        el.addEventListener('animationend', (e) => {
          if (e.target !== el || e.animationName !== 'rise') return;
          el.classList.remove('rv', 'in');
        });
        $$('.count', el).forEach(countUp);
      });
    }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    $$('.rv').forEach((el) => io.observe(el));
    $('.cursor-glow').classList.add('on');
  }

  function countUp(el) {
    const to = Number(el.dataset.to) || 0;
    if (reduced) { el.textContent = to; return; }
    const dur = 1600, t0 = performance.now();
    (function step(now) {
      const k = clamp((now - t0) / dur, 0, 1);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4)));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ============================================================
     Nav pill, progress bar, cursor glow, tilt, spotlight
     ============================================================ */
  let activeSec = 'home';
  function placeNavPill() {
    const nav = $('.nav'), a = $(`.nav a[data-sec="${activeSec}"]`);
    if (!nav || !a) return;
    $$('.nav a').forEach((x) => x.classList.toggle('active', x === a));
    nav.style.setProperty('--x', a.offsetLeft + 'px');
    nav.style.setProperty('--w', a.offsetWidth + 'px');
  }

  function bindNav() {
    const secs = ['home', 'about', 'skills', 'contact'].map((id) => document.getElementById(id));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { activeSec = en.target.id; placeNavPill(); }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    secs.forEach((s) => s && io.observe(s));
  }

  function bindScroll() {
    const bar = $('.progress i');
    let ticking = false;
    addEventListener('scroll', () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        bar.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max, 0, 1) : 0})`;
        ticking = false;
      });
    }, { passive: true });
  }

  function bindPointer() {
    const glow = $('.cursor-glow');
    let gx = innerWidth / 2, gy = innerHeight / 2, tx = gx, ty = gy;

    addEventListener('pointermove', (e) => {
      mouse.x = e.clientX; mouse.y = e.clientY; tx = e.clientX; ty = e.clientY;
    }, { passive: true });
    addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });

    if (!coarse && !reduced) {
      (function follow() {
        gx += (tx - gx) * .12; gy += (ty - gy) * .12;
        glow.style.transform = `translate(${gx - 260}px, ${gy - 260}px)`;
        requestAnimationFrame(follow);
      })();

      // 3D tilt on profile card
      const card = $('#pcard');
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        card.style.transform = `perspective(900px) rotateY(${x * 9}deg) rotateX(${-y * 9}deg) translateZ(0)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    }

    // spotlight
    $$('.spot').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', e.clientX - r.left + 'px');
        el.style.setProperty('--my', e.clientY - r.top + 'px');
      });
    });
  }

  /* ============================================================
     Misc: contacts, marquee, clock, settings
     ============================================================ */
  function fillContacts() {
    const k = C.contacts || {};
    const set = (aId, hId, o) => {
      if (!o) return;
      $(aId).href = o.url || '#';
      $(hId).textContent = o.handle || '';
    };
    set('#cDiscord', '#hDiscord', k.discord);
    set('#cInsta', '#hInsta', k.instagram);
    set('#cTg', '#hTg', k.telegram);

    $('#copyDiscord').addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const text = (k.discord && k.discord.handle) || '';
      try { await navigator.clipboard.writeText(text); }
      catch {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
      }
      toast(t('contact.copied'), 1800);
    });
  }

  function fillMarquee() {
    const track = $('#marquee .track');
    const words = C.tags && C.tags.length ? C.tags : C.stack;
    const make = () => words.map((w) => { const s = document.createElement('span'); s.textContent = w; return s; });
    // two identical halves (each long enough to fill the screen) → seamless loop
    [...make(), ...make(), ...make(), ...make()].forEach((n) => track.appendChild(n));
  }

  function startClock() {
    let fmt;
    try { fmt = new Intl.DateTimeFormat('en-GB', { timeZone: C.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
    catch { fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
    const el = $('#clock');
    const tick = () => { el.textContent = fmt.format(new Date()); };
    tick(); setInterval(tick, 1000);
  }

  function bindControls() {
    $$('.lang button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

    $('#themeBtn').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      toggleTheme(r.left + r.width / 2, r.top + r.height / 2);
    });

    $('#musicBtn').addEventListener('click', async () => {
      if (music.playing) {
        music.stop(); musicWanted = false;
      } else {
        musicWanted = true;
        music.prepare();
        const ok = await music.start();
        if (!ok) toast(t('ui.musicHint'), 3000);
      }
      store.set('music', musicWanted);
      syncMusicBtn();
      hideHint();
    });

    const panel = $('#settingsPanel'), sBtn = $('#settingsBtn');
    const setOpen = (o) => { panel.classList.toggle('open', o); sBtn.setAttribute('aria-expanded', String(o)); };
    sBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!panel.classList.contains('open')); });
    document.addEventListener('click', (e) => { if (!panel.contains(e.target) && !sBtn.contains(e.target)) setOpen(false); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

    $$('#bgSeg button').forEach((b) => b.addEventListener('click', () => setBg(b.dataset.bg)));
    $('#blurRange').addEventListener('input', (e) => setBlur(Number(e.target.value)));

    const volEl = $('#volRange');
    volEl.value = Math.round(volume * 100);
    $('#volVal').textContent = Math.round(volume * 100);
    volEl.addEventListener('input', (e) => {
      volume = Number(e.target.value) / 100;
      $('#volVal').textContent = e.target.value;
      store.set('vol', volume);
      music.setVolume(volume);
    });

    addEventListener('resize', () => { resizeCanvas(); placeLangPill(); placeNavPill(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDiscord(); });
  }

  /* ============================================================
     Init
     ============================================================ */
  function init() {
    $('#heroName').textContent = C.name;
    $('#dName').textContent = C.name;
    $('#avatarFallback').textContent = (C.name || 'M').charAt(0).toUpperCase();
    $('#year').textContent = new Date().getFullYear();
    $('#statYears').dataset.to = (C.stats && C.stats.years) || 2;
    $('#statProjects').dataset.to = (C.stats && C.stats.projects) || 10;

    readColors();
    resizeCanvas();
    setBg(bgMode, false);
    setBlur(blur, false);
    fillContacts();
    fillMarquee();
    applyLang();
    bindControls();
    bindNav();
    bindScroll();
    bindPointer();
    startClock();
    syncMusicBtn();

    refreshDiscord();
    setInterval(refreshDiscord, Math.max(15, C.refreshSeconds || 60) * 1000);

    // wait for fonts so the pills are measured correctly
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeLangPill(); placeNavPill(); });

    runLoader();
  }

  init();
})();
