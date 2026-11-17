// Admin panel · Story designer.
// A phone-sized canvas like the Instagram and Facebook story editors: a photo
// (or colour) background you can move and zoom, text in five styles, emoji,
// @mention, #hashtag, location and link stickers. Everything can be dragged,
// pinched, rotated and dropped on the bin. "Done" renders a 1080 × 1920 JPEG
// into the media library; the design is kept so the story can be edited again.
//
//   AWStory.open({ media: { url, kind }, design }) → Promise<{ url, design } | null>
//
// Every layer is drawn by one function (drawLayer) into its own canvas, both
// on screen and in the final image, so what you see is exactly what goes out.
(function () {
  'use strict';

  var W = 1080, H = 1920;                       // story size in pixels
  var SAFE_TOP = 220, SAFE_BOTTOM = 300;        // where the apps put the profile row and reply bar

  var FONTS = {
    classic:    { name: 'Classic',    font: function (s) { return '600 ' + s + 'px -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'; }, line: 1.18 },
    modern:     { name: 'Modern',     font: function (s) { return '700 ' + s + 'px "Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", sans-serif'; }, line: 1.12, upper: true, track: 0.04 },
    neon:       { name: 'Neon',       font: function (s) { return 'italic 600 ' + s + 'px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive'; }, line: 1.25, glow: true },
    typewriter: { name: 'Typewriter', font: function (s) { return '700 ' + s + 'px "American Typewriter", "Courier New", Courier, monospace'; }, line: 1.2 },
    strong:     { name: 'Strong',     font: function (s) { return 'italic 900 ' + s + 'px "Arial Black", "Helvetica Neue", Impact, sans-serif'; }, line: 1.08, upper: true }
  };
  var STYLE_ORDER = ['classic', 'modern', 'neon', 'typewriter', 'strong'];
  var COLORS = ['#ffffff', '#000000', '#193360', '#3897f0', '#70c050', '#fdcb5c', '#fd8d32', '#ed4956', '#d10869', '#a307ba', '#b9cfea', '#8e8e8e'];
  var GRADIENTS = [['#193360', '#6e87b2'], ['#f09433', '#bc1888'], ['#0f2027', '#2c5364'], ['#ff9a9e', '#fecfef'], ['#43e97b', '#38f9d7'], ['#fdcb5c', '#ed4956'], ['#000000', '#434343'], ['#ffffff', '#d7dff2']];
  var EMOJI = '😀 😂 🥰 😍 🤩 😎 🥳 🤔 😮 🙌 👏 👍 👉 💪 🙏 ❤️ 🧡 💛 💚 💙 💜 🔥 ✨ ⭐ 🎉 🎯 🚀 💼 📍 🌍 ✈️ 🏖️ ☀️ 🌊 🏙️ 🍕 ☕ 📣 📌 ✅ ❗ ❓ 💡 📅 ⏰ 💬 👋 🤝 🎓 🏆'.split(' ');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid() { return 'l' + Math.random().toString(36).slice(2, 9); }
  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  }
  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ------------------------------------------------------------------ drawing one layer
  // Returns a canvas at the layer's on-story size (scale applied, rotation not).
  var measureCtx = document.createElement('canvas').getContext('2d');

  function wrap(ctx, text, maxW, track) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      var words = para.split(/(\s+)/), line = '';
      words.forEach(function (w) {
        var test = line + w;
        if (line && width(ctx, test.trimEnd(), track) > maxW && w.trim()) { out.push(line.trimEnd()); line = w.trimStart(); }
        else line = test;
      });
      out.push(line.trimEnd());
    });
    return out;
  }
  function width(ctx, s, track) { return ctx.measureText(s).width + (track ? track * ctx.measureText('M').width * Math.max(0, [...s].length - 1) : 0); }
  function fillTracked(ctx, s, x, y, track, stroke) {
    if (!track) { if (stroke) ctx.strokeText(s, x, y); ctx.fillText(s, x, y); return; }
    var gap = track * ctx.measureText('M').width, chars = [...s];
    var total = width(ctx, s, track);
    var cx = ctx.textAlign === 'center' ? x - total / 2 : ctx.textAlign === 'right' ? x - total : x;
    var align = ctx.textAlign; ctx.textAlign = 'left';
    chars.forEach(function (ch) { if (stroke) ctx.strokeText(ch, cx, y); ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + gap; });
    ctx.textAlign = align;
  }

  function linkIcon(c, x, y, s, color) {
    c.save(); c.translate(x, y); c.scale(s / 24, s / 24);
    c.strokeStyle = color; c.lineWidth = 2.6; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(10, 13); c.bezierCurveTo(11.5, 15, 14.5, 15.3, 16.3, 13.5); c.lineTo(19.3, 10.5);
    c.bezierCurveTo(21, 8.7, 21, 5.9, 19.3, 4.2); c.bezierCurveTo(17.6, 2.5, 14.8, 2.5, 13.1, 4.2); c.lineTo(11.7, 5.6);
    c.moveTo(14, 11); c.bezierCurveTo(12.5, 9, 9.5, 8.7, 7.7, 10.5); c.lineTo(4.7, 13.5);
    c.bezierCurveTo(3, 15.3, 3, 18.1, 4.7, 19.8); c.bezierCurveTo(6.4, 21.5, 9.2, 21.5, 10.9, 19.8); c.lineTo(12.3, 18.4);
    c.stroke(); c.restore();
  }
  function pinIcon(c, x, y, s, color) {
    c.save(); c.translate(x, y); c.scale(s / 24, s / 24); c.fillStyle = color;
    c.beginPath(); c.moveTo(12, 22); c.bezierCurveTo(12, 22, 4, 14.5, 4, 9.5); c.bezierCurveTo(4, 5, 7.6, 2, 12, 2);
    c.bezierCurveTo(16.4, 2, 20, 5, 20, 9.5); c.bezierCurveTo(20, 14.5, 12, 22, 12, 22); c.closePath(); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(12, 9.5, 3, 0, Math.PI * 2); c.fill(); c.restore();
  }

  function drawLayer(L) {
    var s = L.scale || 1;
    var cv = document.createElement('canvas');
    var c = cv.getContext('2d');

    if (L.type === 'text') {
      var F = FONTS[L.style] || FONTS.classic, size = 72 * s, track = F.track || 0;
      var text = F.upper ? String(L.text).toUpperCase() : String(L.text);
      measureCtx.font = F.font(size);
      var lines = wrap(measureCtx, text || ' ', 880 * s, track);
      var lh = size * F.line, padX = size * 0.32, padY = size * 0.14;
      var widths = lines.map(function (l) { return width(measureCtx, l, track); });
      var maxW = Math.max.apply(null, widths.concat([size * 0.6]));
      var glow = F.glow ? size * 0.5 : 0;
      cv.width = Math.ceil(maxW + padX * 2 + glow * 2); cv.height = Math.ceil(lines.length * lh + padY * 2 + glow * 2);
      c.font = F.font(size); c.textBaseline = 'middle'; c.textAlign = L.align || 'center';
      var ax = L.align === 'left' ? padX + glow : L.align === 'right' ? cv.width - padX - glow : cv.width / 2;
      var color = L.color || '#ffffff';
      lines.forEach(function (line, i) {
        var y = glow + padY + lh * i + lh / 2;
        if (L.bg && L.bg !== 'none' && line) {
          var w = widths[i] + padX * 2;
          var x = L.align === 'left' ? glow : L.align === 'right' ? cv.width - glow - w : (cv.width - w) / 2;
          c.fillStyle = L.bg === 'soft' ? 'rgba(0,0,0,0.45)' : color;
          roundRect(c, x, y - lh / 2 - padY * 0.2, w, lh + padY * 0.4, size * 0.22); c.fill();
        }
        var ink = L.bg === 'solid' ? (luminance(color) > 0.6 ? '#000000' : '#ffffff') : color;
        if (F.glow) { c.shadowColor = color; c.shadowBlur = size * 0.45; c.fillStyle = L.bg === 'solid' ? ink : '#ffffff'; fillTracked(c, line, ax, y, track); c.fillStyle = L.bg === 'solid' ? ink : color; c.shadowBlur = size * 0.15; fillTracked(c, line, ax, y, track); c.shadowBlur = 0; return; }
        if (!L.bg || L.bg === 'none') { c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = size * 0.12; c.shadowOffsetY = size * 0.02; }
        c.fillStyle = ink; fillTracked(c, line, ax, y, track); c.shadowBlur = 0; c.shadowOffsetY = 0;
      });
      return cv;
    }

    if (L.type === 'emoji') {
      var es = 170 * s;
      cv.width = Math.ceil(es * 1.3); cv.height = Math.ceil(es * 1.3);
      c.font = es + 'px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(L.text, cv.width / 2, cv.height / 2 + es * 0.06);
      return cv;
    }

    // pill stickers: link, mention, hashtag, location
    var fs = 46 * s, theme = L.theme || 'white';
    var label = L.type === 'mention' ? '@' + String(L.text).replace(/^@/, '').toUpperCase()
      : L.type === 'hashtag' ? '#' + String(L.text).replace(/^#/, '').toUpperCase()
      : String(L.text).toUpperCase();
    var icon = L.type === 'link' || L.type === 'location';
    measureCtx.font = '700 ' + fs + 'px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    var tw = measureCtx.measureText(label).width, ih = fs * 1.05, gap = icon ? fs * 0.35 : 0;
    var pw = tw + (icon ? ih + gap : 0) + fs * 1.1, ph = fs * 2;
    var shadow = fs * 0.4;
    cv.width = Math.ceil(pw + shadow * 2); cv.height = Math.ceil(ph + shadow * 2);
    var bg = theme === 'white' ? '#ffffff' : theme === 'dark' ? 'rgba(0,0,0,0.6)' : '#3897f0';
    var fg = theme === 'white' ? (L.type === 'link' ? '#3897f0' : L.type === 'mention' ? '#d10869' : L.type === 'hashtag' ? '#fd8d32' : '#a307ba') : '#ffffff';
    c.shadowColor = 'rgba(0,0,0,0.22)'; c.shadowBlur = shadow * 0.8; c.shadowOffsetY = shadow * 0.15;
    c.fillStyle = bg; roundRect(c, shadow, shadow, pw, ph, ph * 0.28); c.fill();
    c.shadowBlur = 0; c.shadowOffsetY = 0;
    var x0 = shadow + fs * 0.55;
    if (icon) {
      if (L.type === 'link') linkIcon(c, x0, shadow + (ph - ih) / 2, ih, fg);
      else pinIcon(c, x0, shadow + (ph - ih) / 2, ih, fg);
      x0 += ih + gap;
    }
    c.font = measureCtx.font; c.fillStyle = fg; c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillText(label, x0, shadow + ph / 2 + fs * 0.04);
    return cv;
  }

  // ------------------------------------------------------------------ background
  function loadImage(url) {
    return new Promise(function (ok, fail) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { ok(img); };
      img.onerror = function () { fail(new Error('The photo could not be loaded.')); };
      img.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'story=1';   // a fresh CORS request, never a cached non-CORS copy
    });
  }
  function drawBackground(c, bg, img) {
    var g = c.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, bg.colors[0]); g.addColorStop(1, bg.colors[1] || bg.colors[0]);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    if (!img) return;
    var base = Math.max(W / img.naturalWidth, H / img.naturalHeight) * (bg.fit === 'contain' ? Math.min(W / img.naturalWidth, H / img.naturalHeight) / Math.max(W / img.naturalWidth, H / img.naturalHeight) : 1);
    var k = base * (bg.zoom || 1), w = img.naturalWidth * k, h = img.naturalHeight * k;
    c.save(); c.translate(W / 2 + (bg.dx || 0), H / 2 + (bg.dy || 0)); c.rotate((bg.rot || 0) * Math.PI / 180);
    c.drawImage(img, -w / 2, -h / 2, w, h); c.restore();
  }

  function render(design, img) {
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    drawBackground(c, design.bg, img);
    design.layers.forEach(function (L) {
      var lc = drawLayer(L);
      c.save(); c.translate(L.x, L.y); c.rotate((L.rot || 0) * Math.PI / 180);
      c.drawImage(lc, -lc.width / 2, -lc.height / 2); c.restore();
    });
    return cv;
  }

  // ------------------------------------------------------------------ the editor
  function open(opts) {
    var A = window.AWAdmin;
    var media = opts.media && opts.media.kind === 'image' ? opts.media : null;
    var d = opts.design ? clone(opts.design) : null;
    if (!d || (media && d.source !== media.url && d.output !== media.url)) {
      d = { v: 1, source: media ? media.url : '', bg: { colors: ['#193360', '#6e87b2'], fit: 'cover', zoom: 1, dx: 0, dy: 0 }, layers: [] };
    }
    var img = null, sel = null, history = [], future = [];

    return new Promise(function (resolve) {
      var root = document.createElement('div');
      root.className = 'sty';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Design story');
      root.innerHTML =
        '<div class="sty__phone">' +
          '<div class="sty__stage" data-stage>' +
            '<canvas class="sty__bg" width="' + W + '" height="' + H + '" data-bg></canvas>' +
            '<div class="sty__layers" data-layers></div>' +
            '<div class="sty__guide sty__guide--v" data-gv hidden></div><div class="sty__guide sty__guide--h" data-gh hidden></div>' +
            '<div class="sty__safe sty__safe--top" data-safe hidden></div><div class="sty__safe sty__safe--bottom" data-safe hidden></div>' +
            '<div class="sty__bin" data-bin hidden><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></div>' +
          '</div>' +
          '<div class="sty__top">' +
            '<button type="button" class="sty__btn" data-close aria-label="Close without saving">✕</button>' +
            '<div class="sty__tools">' +
              '<button type="button" class="sty__btn" data-undo aria-label="Undo" disabled>↶</button>' +
              '<button type="button" class="sty__btn" data-bgpanel aria-label="Background">◐</button>' +
              '<button type="button" class="sty__btn" data-stickers aria-label="Stickers">☺</button>' +
              '<button type="button" class="sty__btn sty__btn--aa" data-addtext aria-label="Add text">Aa</button>' +
            '</div>' +
          '</div>' +
          '<div class="sty__sel" data-selbar hidden>' +
            '<button type="button" class="sty__chip" data-edit>Edit</button>' +
            '<button type="button" class="sty__chip" data-front>Bring to front</button>' +
            '<button type="button" class="sty__chip" data-dup>Duplicate</button>' +
            '<button type="button" class="sty__chip sty__chip--bad" data-del>Delete</button>' +
          '</div>' +
          '<div class="sty__bottom">' +
            '<label class="sty__switch"><input type="checkbox" data-safetoggle> Show app overlays</label>' +
            '<button type="button" class="sty__done" data-done>Done</button>' +
          '</div>' +
          '<div class="sty__sheet" data-sheet hidden></div>' +
        '</div>' +
        '<p class="sty__help">Drag to move · pinch, scroll or use the corner handle to resize and rotate · drop on the bin to delete · double-click text to edit</p>';
      document.body.appendChild(root);
      document.documentElement.classList.add('sty-open');

      var stage = root.querySelector('[data-stage]'), layersEl = root.querySelector('[data-layers]');
      var bgCanvas = root.querySelector('[data-bg]'), bgCtx = bgCanvas.getContext('2d');
      var sheet = root.querySelector('[data-sheet]'), selbar = root.querySelector('[data-selbar]');
      var bin = root.querySelector('[data-bin]'), gv = root.querySelector('[data-gv]'), gh = root.querySelector('[data-gh]');

      function k() { return stage.getBoundingClientRect().width / W; }          // screen px per story px
      function toStory(e) { var r = stage.getBoundingClientRect(), q = k(); return { x: (e.clientX - r.left) / q, y: (e.clientY - r.top) / q }; }

      // ---------- history ----------
      function snapshot() { history.push(JSON.stringify(d)); if (history.length > 60) history.shift(); future = []; root.querySelector('[data-undo]').disabled = false; }
      function undo() {
        if (!history.length) return;
        future.push(JSON.stringify(d)); d = JSON.parse(history.pop());
        root.querySelector('[data-undo]').disabled = !history.length;
        if (sel && !find(sel)) sel = null;
        drawBg(); drawLayers();
      }
      function find(id) { return d.layers.filter(function (l) { return l.id === id; })[0]; }

      // ---------- drawing ----------
      function drawBg() { drawBackground(bgCtx, d.bg, img); }
      function drawLayers() {
        var q = k();
        layersEl.innerHTML = '';
        d.layers.forEach(function (L) {
          var lc = drawLayer(L);
          var el = document.createElement('div');
          el.className = 'sty__layer' + (L.id === sel ? ' is-sel' : '');
          el.dataset.id = L.id;
          el.style.width = lc.width * q + 'px'; el.style.height = lc.height * q + 'px';
          el.style.transform = 'translate(' + (L.x * q - lc.width * q / 2) + 'px,' + (L.y * q - lc.height * q / 2) + 'px) rotate(' + (L.rot || 0) + 'deg)';
          lc.className = 'sty__layer-img';
          el.appendChild(lc);
          if (L.id === sel) el.insertAdjacentHTML('beforeend', '<span class="sty__handle" data-handle title="Drag to resize and rotate"></span>');
          if (L.type === 'link') el.title = L.url;
          layersEl.appendChild(el);
        });
        selbar.hidden = !sel;
        var L = sel && find(sel);
        root.querySelector('[data-edit]').hidden = !L || L.type === 'emoji';
      }
      function redrawOne(L) {
        var el = layersEl.querySelector('[data-id="' + L.id + '"]');
        if (!el) return drawLayers();
        var q = k(), lc = el.querySelector('canvas');
        el.style.transform = 'translate(' + (L.x * q - lc.width * q / 2) + 'px,' + (L.y * q - lc.height * q / 2) + 'px) rotate(' + (L.rot || 0) + 'deg)';
      }

      // ---------- pointer: move, pinch, rotate ----------
      var pointers = {}, gesture = null;
      function centerOf(L) { return { x: L.x, y: L.y }; }
      stage.addEventListener('pointerdown', function (e) {
        if (sheet.hidden === false) return;
        stage.setPointerCapture(e.pointerId);
        pointers[e.pointerId] = toStory(e);
        var layerEl = e.target.closest('.sty__layer');
        var ids = Object.keys(pointers);
        if (ids.length === 1) {
          if (e.target.hasAttribute('data-handle')) {
            var L0 = find(sel), c0 = centerOf(L0), p0 = pointers[e.pointerId];
            gesture = { kind: 'handle', id: sel, start: clone(L0), a0: Math.atan2(p0.y - c0.y, p0.x - c0.x), r0: Math.hypot(p0.x - c0.x, p0.y - c0.y) };
          } else if (layerEl) {
            sel = layerEl.dataset.id; var L1 = find(sel);
            d.layers.push(d.layers.splice(d.layers.indexOf(L1), 1)[0]);     // tapped layer comes to the front, like the apps
            gesture = { kind: 'move', id: sel, start: clone(L1), p0: pointers[e.pointerId], moved: false };
            drawLayers();
          } else {
            sel = null; drawLayers();
            gesture = img ? { kind: 'bgmove', start: clone(d.bg), p0: pointers[e.pointerId], moved: false } : null;
          }
          if (gesture) snapshot();
        } else if (ids.length === 2) {
          var a = pointers[ids[0]], b = pointers[ids[1]];
          var target = sel ? find(sel) : null;
          gesture = { kind: target ? 'pinch' : 'bgpinch', id: sel, start: clone(target || d.bg), d0: Math.hypot(b.x - a.x, b.y - a.y), a0: Math.atan2(b.y - a.y, b.x - a.x) };
        }
      });
      stage.addEventListener('pointermove', function (e) {
        if (!pointers[e.pointerId] || !gesture) return;
        pointers[e.pointerId] = toStory(e);
        var p = pointers[e.pointerId], ids = Object.keys(pointers);
        if (gesture.kind === 'move') {
          var L = find(gesture.id);
          var nx = gesture.start.x + p.x - gesture.p0.x, ny = gesture.start.y + p.y - gesture.p0.y;
          gesture.moved = gesture.moved || Math.hypot(p.x - gesture.p0.x, p.y - gesture.p0.y) > 6;
          var snapX = Math.abs(nx - W / 2) < 18, snapY = Math.abs(ny - H / 2) < 18;
          L.x = snapX ? W / 2 : nx; L.y = snapY ? H / 2 : ny;
          gv.hidden = !snapX; gh.hidden = !snapY;
          bin.hidden = !gesture.moved;
          var r = bin.getBoundingClientRect(), over = e.clientX > r.left - 20 && e.clientX < r.right + 20 && e.clientY > r.top - 20 && e.clientY < r.bottom + 20;
          bin.classList.toggle('is-hot', over); gesture.overBin = over;
          redrawOne(L);
        } else if (gesture.kind === 'bgmove') {
          d.bg.dx = gesture.start.dx + p.x - gesture.p0.x; d.bg.dy = gesture.start.dy + p.y - gesture.p0.y;
          gesture.moved = true; drawBg();
        } else if (gesture.kind === 'handle') {
          var H0 = find(gesture.id), c = centerOf(H0);
          var ang = Math.atan2(p.y - c.y, p.x - c.x), rad = Math.hypot(p.x - c.x, p.y - c.y);
          H0.scale = Math.max(0.2, Math.min(6, gesture.start.scale * rad / gesture.r0));
          var rot = gesture.start.rot + (ang - gesture.a0) * 180 / Math.PI;
          H0.rot = snapAngle(rot); drawLayers();
        } else if ((gesture.kind === 'pinch' || gesture.kind === 'bgpinch') && ids.length >= 2) {
          var a = pointers[ids[0]], b = pointers[ids[1]];
          var f = Math.hypot(b.x - a.x, b.y - a.y) / gesture.d0, turn = (Math.atan2(b.y - a.y, b.x - a.x) - gesture.a0) * 180 / Math.PI;
          if (gesture.kind === 'pinch') { var P = find(gesture.id); P.scale = Math.max(0.2, Math.min(6, gesture.start.scale * f)); P.rot = snapAngle((gesture.start.rot || 0) + turn); drawLayers(); }
          else { d.bg.zoom = Math.max(0.3, Math.min(5, (gesture.start.zoom || 1) * f)); d.bg.rot = snapAngle((gesture.start.rot || 0) + turn); drawBg(); }
        }
      });
      function snapAngle(a) { a = ((a % 360) + 360) % 360; if (a > 180) a -= 360; [0, 90, -90, 180, -180].forEach(function (s) { if (Math.abs(a - s) < 4) a = s; }); return a; }
      function endPointer(e) {
        delete pointers[e.pointerId];
        if (!gesture) return;
        if (gesture.kind === 'move') {
          gv.hidden = gh.hidden = true; bin.hidden = true; bin.classList.remove('is-hot');
          if (gesture.overBin) { d.layers = d.layers.filter(function (l) { return l.id !== gesture.id; }); sel = null; }
          else if (!gesture.moved && history.length) history.pop();         // a tap isn't a change
          drawLayers();
        } else if (gesture.kind === 'bgmove' && !gesture.moved && history.length) history.pop();
        if (!Object.keys(pointers).length) gesture = null;
        root.querySelector('[data-undo]').disabled = !history.length;
      }
      stage.addEventListener('pointerup', endPointer);
      stage.addEventListener('pointercancel', endPointer);
      stage.addEventListener('dblclick', function (e) {
        var el = e.target.closest('.sty__layer'); if (!el) return;
        var L = find(el.dataset.id); if (L && L.type !== 'emoji') editLayer(L);
      });
      stage.addEventListener('wheel', function (e) {
        e.preventDefault();
        var f = Math.exp(-e.deltaY * 0.0015);
        if (sel) { var L = find(sel); if (e.shiftKey) L.rot = snapAngle((L.rot || 0) + e.deltaY * 0.2); else L.scale = Math.max(0.2, Math.min(6, L.scale * f)); drawLayers(); }
        else if (img) { d.bg.zoom = Math.max(0.3, Math.min(5, (d.bg.zoom || 1) * f)); drawBg(); }
      }, { passive: false });

      // ---------- keyboard ----------
      function onKey(e) {
        if (!sheet.hidden) { if (e.key === 'Escape') closeSheet(); return; }
        if (e.target.matches('input, textarea')) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
        if (e.key === 'Escape') { if (sel) { sel = null; drawLayers(); } else close(null); return; }
        var L = sel && find(sel); if (!L) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { snapshot(); d.layers = d.layers.filter(function (l) { return l !== L; }); sel = null; drawLayers(); e.preventDefault(); }
        var step = e.shiftKey ? 40 : 8, moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (moves) { e.preventDefault(); L.x += moves[0]; L.y += moves[1]; redrawOne(L); }
        if (e.key === 'Enter' && L.type !== 'emoji') { e.preventDefault(); editLayer(L); }
      }
      document.addEventListener('keydown', onKey);

      // ---------- sheets (text, stickers, background) ----------
      function openSheet(html, onReady) {
        sheet.innerHTML = '<div class="sty__sheet-in">' + html + '</div>';
        sheet.hidden = false;
        if (onReady) onReady(sheet.firstChild);      // a fresh element each time, so listeners never pile up
        var f = sheet.querySelector('textarea, input'); if (f) setTimeout(function () { f.focus(); }, 30);
      }
      function closeSheet() { sheet.hidden = true; sheet.innerHTML = ''; }

      function swatches(current, attr) {
        return '<div class="sty__swatches">' + COLORS.map(function (c) {
          return '<button type="button" class="sty__sw" style="--c:' + c + '" ' + attr + '="' + c + '" aria-label="Colour ' + c + '" aria-pressed="' + (c === current) + '"></button>';
        }).join('') + '</div>';
      }

      function editLayer(L, isNew) {
        var before = JSON.stringify(d);
        if (L.type === 'text') {
          openSheet(
            '<div class="sty__styles">' + STYLE_ORDER.map(function (s) { return '<button type="button" class="sty__style sty__style--' + s + '" data-style="' + s + '" aria-pressed="' + (s === L.style) + '">' + FONTS[s].name + '</button>'; }).join('') + '</div>' +
            '<textarea class="sty__input" rows="3" placeholder="Type something…" data-text>' + esc(L.text) + '</textarea>' +
            '<div class="sty__row">' +
              '<button type="button" class="sty__chip" data-align title="Alignment">' + ({ left: '⟸ Left', center: '≡ Centre', right: 'Right ⟹' })[L.align || 'center'] + '</button>' +
              '<button type="button" class="sty__chip" data-bgmode title="Background behind the text">' + ({ none: 'A  No background', solid: 'A  Solid background', soft: 'A  See-through background' })[L.bg || 'none'] + '</button>' +
            '</div>' +
            swatches(L.color, 'data-color') +
            '<div class="sty__sheet-foot">' + (isNew ? '' : '<button type="button" class="sty__chip sty__chip--bad" data-remove>Delete</button>') + '<button type="button" class="sty__done" data-ok>Done</button></div>',
            function (sh) {
              function live() { drawLayers(); }
              sh.querySelector('[data-text]').addEventListener('input', function (e) { L.text = e.target.value; live(); });
              sh.addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) return;
                if (b.dataset.style) { L.style = b.dataset.style; sh.querySelectorAll('[data-style]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); }
                else if (b.hasAttribute('data-align')) { L.align = { center: 'left', left: 'right', right: 'center' }[L.align || 'center']; b.textContent = ({ left: '⟸ Left', center: '≡ Centre', right: 'Right ⟹' })[L.align]; }
                else if (b.hasAttribute('data-bgmode')) { L.bg = { none: 'solid', solid: 'soft', soft: 'none' }[L.bg || 'none']; b.textContent = ({ none: 'A  No background', solid: 'A  Solid background', soft: 'A  See-through background' })[L.bg]; }
                else if (b.dataset.color) { L.color = b.dataset.color; sh.querySelectorAll('[data-color]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); }
                else if (b.hasAttribute('data-remove')) { d.layers = d.layers.filter(function (l) { return l !== L; }); sel = null; finish(); return; }
                else if (b.hasAttribute('data-ok')) { finish(); return; }
                live();
              });
            });
        } else {
          var kind = { link: 'Link', mention: 'Mention', hashtag: 'Hashtag', location: 'Location' }[L.type];
          var ph = { link: 'https://atleanworld.com/open-jobs/', mention: 'atleanworld', hashtag: 'nowhiring', location: 'Lisbon, Portugal' }[L.type];
          openSheet(
            '<h2 class="sty__h">' + kind + ' sticker</h2>' +
            (L.type === 'link'
              ? '<label class="sty__field"><span>Link</span><input type="url" data-url value="' + esc(L.url || '') + '" placeholder="' + ph + '"></label>' +
                '<label class="sty__field"><span>Sticker text <small>(optional, like the apps’ “Customise sticker text”)</small></span><input data-text value="' + esc(L.custom ? L.text : '') + '" placeholder="e.g. APPLY NOW"></label>' +
                '<p class="sty__note">Meta doesn’t let apps make a story link tappable. How link stories go out is set by the team.</p>'
              : '<label class="sty__field"><span>' + kind + '</span><input data-text value="' + esc(L.text) + '" placeholder="' + ph + '"></label>') +
            '<div class="sty__row">' + ['white', 'color', 'dark'].map(function (t) {
              return '<button type="button" class="sty__chip" data-theme="' + t + '" aria-pressed="' + ((L.theme || 'white') === t) + '">' + ({ white: 'White', color: 'Colour', dark: 'Dark' })[t] + '</button>';
            }).join('') + '</div>' +
            '<div class="sty__sheet-foot">' + (isNew ? '<button type="button" class="sty__chip" data-cancel>Cancel</button>' : '<button type="button" class="sty__chip sty__chip--bad" data-remove>Delete</button>') + '<button type="button" class="sty__done" data-ok>Done</button></div>',
            function (sh) {
              function sync() {
                if (L.type === 'link') {
                  var url = sh.querySelector('[data-url]').value.trim(), custom = sh.querySelector('[data-text]').value.trim();
                  L.url = url; L.custom = !!custom;
                  try { L.text = custom || (url ? new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, '') : 'link'); } catch (e2) { L.text = custom || url || 'link'; }
                } else L.text = sh.querySelector('[data-text]').value.trim() || ph;
                drawLayers();
              }
              sh.addEventListener('input', sync);
              sh.addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) return;
                if (b.dataset.theme) { L.theme = b.dataset.theme; sh.querySelectorAll('[data-theme]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); drawLayers(); }
                else if (b.hasAttribute('data-cancel')) { d.layers = d.layers.filter(function (l) { return l !== L; }); sel = null; closeSheet(); drawLayers(); }
                else if (b.hasAttribute('data-remove')) { d.layers = d.layers.filter(function (l) { return l !== L; }); sel = null; finish(); }
                else if (b.hasAttribute('data-ok')) {
                  if (L.type === 'link' && !/^https?:\/\/\S+\.\S+/i.test(L.url || '')) { sh.querySelector('[data-url]').focus(); sh.querySelector('[data-url]').classList.add('is-bad'); return; }
                  finish();
                }
              });
            });
        }
        function finish() {
          if (L.type === 'text' && !String(L.text).trim()) d.layers = d.layers.filter(function (l) { return l !== L; });
          if (JSON.stringify(d) !== before) { history.push(before); future = []; root.querySelector('[data-undo]').disabled = false; }
          closeSheet(); drawLayers();
        }
      }

      function addLayer(L) {
        L.id = uid(); L.x = L.x || W / 2; L.y = L.y || H / 2; L.scale = L.scale || 1; L.rot = L.rot || 0;
        d.layers.push(L); sel = L.id; drawLayers(); return L;
      }

      function stickers() {
        var hasLink = d.layers.some(function (l) { return l.type === 'link'; });
        openSheet(
          '<div class="sty__stickers">' +
            '<button type="button" class="sty__pick sty__pick--link" data-add="link"' + (hasLink ? ' disabled title="A story can have one link"' : '') + '>🔗 LINK</button>' +
            '<button type="button" class="sty__pick sty__pick--mention" data-add="mention">@MENTION</button>' +
            '<button type="button" class="sty__pick sty__pick--hashtag" data-add="hashtag">#HASHTAG</button>' +
            '<button type="button" class="sty__pick sty__pick--location" data-add="location">📍 LOCATION</button>' +
          '</div>' +
          '<div class="sty__emoji">' + EMOJI.map(function (e) { return '<button type="button" data-emoji="' + e + '">' + e + '</button>'; }).join('') + '</div>' +
          '<div class="sty__sheet-foot"><button type="button" class="sty__done" data-ok>Close</button></div>',
          function (sh) {
            sh.addEventListener('click', function (e) {
              var b = e.target.closest('button'); if (!b) return;
              if (b.dataset.emoji) { snapshot(); addLayer({ type: 'emoji', text: b.dataset.emoji, y: H * 0.4 }); closeSheet(); }
              else if (b.dataset.add) {
                var t = b.dataset.add;
                var L = addLayer({ type: t, theme: 'white', text: { link: 'link', mention: 'atleanworld', hashtag: 'nowhiring', location: 'Lisbon, Portugal' }[t], url: t === 'link' ? '' : undefined, y: H * (t === 'link' ? 0.72 : 0.6) });
                editLayer(L, true);
              } else if (b.hasAttribute('data-ok')) closeSheet();
            });
          });
      }

      function background() {
        openSheet(
          '<h2 class="sty__h">Background</h2>' +
          '<div class="sty__row">' +
            '<button type="button" class="sty__chip" data-photo>' + (img ? 'Change photo' : 'Add a photo') + '</button>' +
            (img ? '<button type="button" class="sty__chip" data-fit>' + (d.bg.fit === 'contain' ? 'Fill the screen' : 'Show whole photo') + '</button><button type="button" class="sty__chip" data-reset>Reset position</button><button type="button" class="sty__chip sty__chip--bad" data-nophoto>Remove photo</button>' : '') +
          '</div>' +
          '<p class="sty__note">' + (img ? 'Drag the photo to move it, pinch or scroll to zoom. ' : '') + 'The colour shows around the photo and behind text-only stories.</p>' +
          '<div class="sty__swatches">' + GRADIENTS.map(function (g, i) {
            return '<button type="button" class="sty__sw" style="--c:linear-gradient(160deg,' + g[0] + ',' + g[1] + ')" data-grad="' + i + '" aria-label="Gradient ' + (i + 1) + '"></button>';
          }).join('') + '</div>' +
          swatches(d.bg.colors[0], 'data-solid') +
          '<div class="sty__sheet-foot"><button type="button" class="sty__done" data-ok>Done</button></div>',
          function (sh) {
            sh.addEventListener('click', function (e) {
              var b = e.target.closest('button'); if (!b) return;
              if (b.dataset.grad != null) { snapshot(); d.bg.colors = GRADIENTS[+b.dataset.grad].slice(); drawBg(); }
              else if (b.dataset.solid) { snapshot(); d.bg.colors = [b.dataset.solid, b.dataset.solid]; drawBg(); }
              else if (b.hasAttribute('data-fit')) { snapshot(); d.bg.fit = d.bg.fit === 'contain' ? 'cover' : 'contain'; d.bg.zoom = 1; d.bg.dx = d.bg.dy = 0; drawBg(); background(); }
              else if (b.hasAttribute('data-reset')) { snapshot(); d.bg.zoom = 1; d.bg.dx = d.bg.dy = 0; d.bg.rot = 0; drawBg(); }
              else if (b.hasAttribute('data-nophoto')) { snapshot(); img = null; d.source = ''; drawBg(); background(); }
              else if (b.hasAttribute('data-photo')) {
                A.pickMedia({ title: 'Story photo', folder: 'social', kinds: ['image'], multiple: false }).then(function (files) {
                  var f = files && files[0]; if (!f) return;
                  snapshot(); d.source = f.url; d.bg.zoom = 1; d.bg.dx = d.bg.dy = 0; d.bg.rot = 0;
                  loadImage(f.url).then(function (i) { img = i; drawBg(); background(); }, function (err) { A.toast(err.message, 'error'); });
                });
              } else if (b.hasAttribute('data-ok')) closeSheet();
            });
          });
      }

      // ---------- buttons ----------
      root.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b || sheet.contains(b)) return;
        if (b.hasAttribute('data-close')) {
          if (history.length) A.confirmDialog('Close the story designer?', 'Your changes to the design will be lost.').then(function (ok) { if (ok) close(null); });
          else close(null);
        }
        else if (b.hasAttribute('data-undo')) undo();
        else if (b.hasAttribute('data-addtext')) { snapshot(); editLayer(addLayer({ type: 'text', text: '', style: 'classic', color: '#ffffff', bg: 'none', align: 'center', y: H * 0.42 }), true); }
        else if (b.hasAttribute('data-stickers')) stickers();
        else if (b.hasAttribute('data-bgpanel')) background();
        else if (b.hasAttribute('data-edit')) { var L = find(sel); if (L) editLayer(L); }
        else if (b.hasAttribute('data-front')) { var F = find(sel); snapshot(); d.layers.push(d.layers.splice(d.layers.indexOf(F), 1)[0]); drawLayers(); }
        else if (b.hasAttribute('data-dup')) { var S = find(sel); if (S.type === 'link') return A.toast('A story can have one link.'); snapshot(); var c2 = clone(S); c2.x += 40; c2.y += 40; addLayer(c2); }
        else if (b.hasAttribute('data-del')) { snapshot(); d.layers = d.layers.filter(function (l) { return l.id !== sel; }); sel = null; drawLayers(); }
        else if (b.hasAttribute('data-done')) done(b);
      });
      root.querySelector('[data-safetoggle]').addEventListener('change', function (e) {
        root.querySelectorAll('[data-safe]').forEach(function (x) { x.hidden = !e.target.checked; });
      });

      function done(btn) {
        if (!img && !d.layers.length) return A.toast('Add a photo, text or a sticker first.', 'error');
        A.busy(btn, true);
        var cv;
        try { cv = render(d, img); cv.toDataURL('image/jpeg', 0.1); }
        catch (err) { A.busy(btn, false); return A.toast('This photo can’t be used in the designer (the server it comes from doesn’t allow it). Upload it to the media library first.', 'error'); }
        cv.toBlob(function (blob) {
          var path = 'social/stories/story-' + new Date().toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
          A.sb.storage.from('media').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }).then(function (res) {
            A.busy(btn, false);
            if (res.error) return A.toast(res.error.message, 'error');
            var url = A.sb.storage.from('media').getPublicUrl(res.data.path).data.publicUrl;
            var link = d.layers.filter(function (l) { return l.type === 'link'; })[0];
            d.output = url;
            close({ url: url, design: d, link: link ? { url: link.url, text: link.text } : null });
          });
        }, 'image/jpeg', 0.92);
      }

      function close(result) {
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', onResize);
        document.documentElement.classList.remove('sty-open');
        root.remove();
        resolve(result);
      }
      function onResize() { drawLayers(); }
      window.addEventListener('resize', onResize);

      // ---------- start ----------
      drawBg(); drawLayers();
      var src = d.source || (media && media.url);
      if (src) {
        d.source = src;
        loadImage(src).then(function (i) { img = i; drawBg(); }, function () {
          A.toast('The photo couldn’t be opened in the designer. Pick it again from the media library.', 'error');
        });
      }
    });
  }

  window.AWStory = { open: open, render: render, drawLayer: drawLayer, SIZE: { W: W, H: H } };
})();
