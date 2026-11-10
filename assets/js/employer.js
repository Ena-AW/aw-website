(function () {
  'use strict';

  var root = document.querySelector('.aw-es');
  if (!root) return;

  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ==========================================================================
  // 1. Percurso dos passos
  //    Um passo fica "alcançado" quando o topo passa os 60% da altura do ecrã.
  //    Recalculado a partir da posição real em cada scroll (um fotograma de
  //    cada vez). Sem JS o percurso aparece completo.
  // ==========================================================================
  (function initSteps() {
    var steps = Array.prototype.slice.call(root.querySelectorAll('.aw-step'));
    if (!steps.length) return;

    var READING_LINE = 0.6;
    var queued = false;
    function update() {
      queued = false;
      var line = window.innerHeight * READING_LINE;
      steps.forEach(function (step) {
        step.classList.toggle('is-reached', step.getBoundingClientRect().top <= line);
      });
    }
    function queueUpdate() {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }

    update();
    root.classList.add('is-enhanced');
    window.addEventListener('scroll', queueUpdate, { passive: true });
    window.addEventListener('resize', queueUpdate);
    window.addEventListener('load', queueUpdate);
  })();

  // ==========================================================================
  // 2. Vídeo vertical
  //    Pausa quando a pessoa pede, quando o sistema pede menos movimento ou
  //    poupança de dados, e quando sai do ecrã. Se o vídeo não carregar, a
  //    coluna do vídeo desaparece e os passos ocupam a largura toda.
  // ==========================================================================
  (function initVideo() {
    var layout = document.getElementById('aw-process-layout');
    var video = root.querySelector('.aw-process__video');
    var toggle = root.querySelector('.aw-vtoggle');
    if (!video || !toggle) return;

    var choice = null;      // null = sem escolha, 'play' ou 'pause'
    var inView = !('IntersectionObserver' in window);
    var connection = navigator.connection || {};

    function systemWantsStill() { return !!(motionQuery.matches || connection.saveData); }
    if (systemWantsStill()) video.preload = 'auto';

    function sync() {
      var shouldPlay = choice === 'pause' ? false : inView && (choice === 'play' || !systemWantsStill());
      if (shouldPlay) {
        var started = video.play();
        if (started && started.catch) started.catch(function () {});
      } else {
        video.pause();
      }
      var showsPlaying = choice ? choice === 'play' : !systemWantsStill();
      toggle.setAttribute('data-state', showsPlaying ? 'playing' : 'paused');
      toggle.setAttribute('aria-label', showsPlaying ? 'Pause video' : 'Play video');
    }

    toggle.addEventListener('click', function () {
      choice = toggle.getAttribute('data-state') === 'playing' ? 'pause' : 'play';
      sync();
    });
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', sync);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        sync();
      }, { threshold: 0.25 }).observe(video);
    }
    function failed() { if (layout) layout.classList.add('is-no-video'); }
    video.addEventListener('error', failed);
    var source = video.querySelector('source');
    if (source) source.addEventListener('error', failed);

    sync();
  })();

  // ==========================================================================
  // 3. Fotos da equipa
  //    Se uma foto não carregar, mostra as iniciais da pessoa no mesmo círculo.
  // ==========================================================================
  (function initFaces() {
    Array.prototype.forEach.call(root.querySelectorAll('img.aw-face'), function (img) {
      function swap() {
        var name = img.getAttribute('alt') || '';
        var initials = name.split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2);
        var span = document.createElement('span');
        span.className = 'aw-face aw-face--more';
        span.setAttribute('role', 'img');
        span.setAttribute('aria-label', name);
        span.textContent = initials.toUpperCase();
        img.replaceWith(span);
      }
      if (img.complete && img.naturalWidth === 0) swap();
      else img.addEventListener('error', swap);
    });
  })();

  // ==========================================================================
  // 4. Formulário de contacto
  //    Mesmo endpoint e campos de antes; o envio só avança com o token do
  //    Cloudflare Turnstile.
  // ==========================================================================
  (function initContactForm() {
    // 🔧 EDITAR MANUALMENTE: URL do Web App do Google Apps Script
    var GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzsn7ejoJuRe6M5EpQfV4BzVbTyTi4ICkZ-d83IgpxQpOCykjvAfZ8E3wOn1lYqL_MtGw/exec';

    var form = document.getElementById('esContactForm');
    var submitBtn = document.getElementById('esContactSubmit');
    var statusEl = document.getElementById('esContactStatus');
    if (!form || !submitBtn || !statusEl) return;

    // Telefone: só dígitos (e um "+" inicial para indicativos)
    var phoneField = document.getElementById('esPhoneField');
    function cleanPhone(value) {
      var hasLeadingPlus = value.trim().indexOf('+') === 0;
      return (hasLeadingPlus ? '+' : '') + value.replace(/[^0-9]/g, '');
    }
    function sanitizePhone() {
      var clean = cleanPhone(phoneField.value);
      if (phoneField.value !== clean) phoneField.value = clean;
    }
    if (phoneField) {
      // 1. Bloqueia letras antes de aparecerem (teclado, colar, arrastar)
      phoneField.addEventListener('beforeinput', function (e) {
        if (!e.data || e.inputType.indexOf('insert') !== 0) return;
        var atStart = phoneField.selectionStart === 0 && phoneField.value.indexOf('+') !== 0;
        var allowed = e.data.replace(atStart ? /[^0-9+]/g : /[^0-9]/g, '').replace(/(?!^)\+/g, '');
        if (allowed !== e.data) {
          e.preventDefault();
          if (allowed && e.inputType !== 'insertCompositionText') {
            phoneField.setRangeText(allowed, phoneField.selectionStart, phoneField.selectionEnd, 'end');
            sanitizePhone();
          }
        }
      });
      // 2. Limpa o que escapar (preenchimento automático, teclados móveis)
      phoneField.addEventListener('input', sanitizePhone);
      phoneField.addEventListener('change', sanitizePhone);
      phoneField.addEventListener('blur', sanitizePhone);
    }

    // Contador de caracteres na mensagem
    var messageField = document.getElementById('esMessageField');
    var messageCounter = document.getElementById('esMessageCounter');
    var MESSAGE_MAX = 800;
    function updateMessageCounter() {
      if (!messageField || !messageCounter) return;
      var len = messageField.value.length;
      messageCounter.textContent = len + ' / ' + MESSAGE_MAX;
      messageCounter.classList.toggle('aw-counter--near-limit', len >= MESSAGE_MAX - 40);
    }
    if (messageField) messageField.addEventListener('input', updateMessageCounter);
    updateMessageCounter();

    function setStatus(text, kind) {
      statusEl.textContent = text;
      statusEl.className = 'aw-status' + (kind ? ' aw-status--' + kind : '');
    }
    function resetTurnstile() { if (window.turnstile) window.turnstile.reset(); }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setStatus('', '');
      if (phoneField) sanitizePhone();   // última limpeza antes de enviar

      var data = Object.fromEntries(new FormData(form).entries());

      // O Turnstile injeta o campo "cf-turnstile-response" dentro do form.
      if (!data['cf-turnstile-response']) {
        setStatus('Please complete the verification above.', 'error');
        return;
      }

      data.tipo = 'employer-solutions-lead';
      data.pageUrl = window.location.href;
      data.submittedAt = new Date().toISOString();

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      fetch(GAS_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(data)
      })
        .then(function () {
          setStatus('Thanks! We’ll be in touch shortly.', 'success');
          form.reset();
          updateMessageCounter();
          resetTurnstile();
        })
        .catch(function () {
          setStatus('Something went wrong. Please try again.', 'error');
          resetTurnstile();
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send message';
        });
    });
  })();

})();
