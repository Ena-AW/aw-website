(function () {
  'use strict';

  var root = document.querySelector('.aw-about');
  if (!root) return;

  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ==========================================================================
  // 1. Contagem dos números do impacto
  //    Conta uma única vez, quando a lista chega a 90% da altura do ecrã
  //    (1,6 s, a desacelerar). Os valores finais já estão no HTML: sem JS, com
  //    "reduzir movimento" ou se a pessoa saltar para depois da secção,
  //    aparecem de imediato.
  // ==========================================================================
  (function initCounts() {
    var list = document.getElementById('aw-facts');
    var counts = Array.prototype.slice.call(root.querySelectorAll('.aw-count'));
    if (!list || !counts.length) return;

    var DURATION = 1600;
    var TRIGGER = 0.9;
    var finished = false;
    var queued = false;

    function setAll(progress) {
      var eased = 1 - Math.pow(1 - progress, 3);
      counts.forEach(function (el) {
        var target = parseInt(el.getAttribute('data-to'), 10);
        el.textContent = progress >= 1 ? target : Math.floor(eased * target);
      });
    }
    function stop() {
      finished = true;
      list.removeAttribute('data-count');
      window.removeEventListener('scroll', queueCheck);
      window.removeEventListener('resize', queueCheck);
    }
    function run() {
      var start = performance.now();
      (function tick(now) {
        var progress = Math.min((now - start) / DURATION, 1);
        setAll(progress);
        if (progress < 1) requestAnimationFrame(tick);
      })(start);
    }
    function check() {
      queued = false;
      if (finished) return;
      var rect = list.getBoundingClientRect();
      if (rect.top > window.innerHeight * TRIGGER) return;
      stop();
      if (rect.bottom < 0 || motionQuery.matches) { setAll(1); return; }
      run();
    }
    function queueCheck() {
      if (!queued) { queued = true; requestAnimationFrame(check); }
    }

    var rect = list.getBoundingClientRect();
    if (rect.top > window.innerHeight * TRIGGER && !motionQuery.matches) {
      setAll(0);
      list.setAttribute('data-count', 'idle');
      window.addEventListener('scroll', queueCheck, { passive: true });
      window.addEventListener('resize', queueCheck);
    } else {
      stop();
    }
  })();

  // ==========================================================================
  // 2. Ficheiros em falta
  //    Foto da equipa que não carregue → iniciais no disco.
  //    Logótipo que não carregue → o nome da marca em texto.
  // ==========================================================================
  function whenBroken(img, fn) {
    if (img.complete && img.naturalWidth === 0) fn();
    else img.addEventListener('error', fn);
  }
  Array.prototype.forEach.call(root.querySelectorAll('.aw-person__photo'), function (img) {
    whenBroken(img, function () {
      var name = img.closest('.aw-person').querySelector('.aw-person__name').textContent;
      var frame = img.parentNode;
      frame.textContent = name.split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
      frame.setAttribute('aria-hidden', 'true');
    });
  });
  Array.prototype.forEach.call(root.querySelectorAll('.aw-brand__img'), function (img) {
    whenBroken(img, function () {
      var span = document.createElement('span');
      span.className = 'aw-brand__name';
      span.textContent = img.getAttribute('alt');
      img.replaceWith(span);
    });
  });

})();
