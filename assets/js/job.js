// Job page: the apply form. It sends the application (CV included) to the
// website-apply Edge Function, which forwards it to the job's pipeline in
// Atleable. Errors come back per field and are shown next to that field.
(function () {
  'use strict';
  // ==========================================================================
  // Section bar: shows which chapter you are reading (aria-current on its link)
  // ==========================================================================
  var root = document.querySelector('.aw-jd');
  var bar = root && root.querySelector('.aw-bar');
  var links = bar ? [].slice.call(bar.querySelectorAll('.aw-bar__link')) : [];
  var sections = links.map(function (a) { return root.querySelector(a.getAttribute('href')); });
  var tails = root ? [root.querySelector('#apply'), root.querySelector('#close')].filter(Boolean) : [];
  var spyQueued = false, current = -1;
  function spy() {
    spyQueued = false;
    var stuck = (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight + 32;
    var idx = -1;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i] && sections[i].getBoundingClientRect().top <= stuck) idx = i;
    }
    for (var t = 0; t < tails.length; t++) {
      if (tails[t].getBoundingClientRect().top <= stuck) idx = -1;
    }
    if (idx === current) return;
    if (current > -1) links[current].removeAttribute('aria-current');
    if (idx > -1) links[idx].setAttribute('aria-current', 'true');
    current = idx;
  }
  function queueSpy() { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }
  if (bar && links.length) {
    window.addEventListener('scroll', queueSpy, { passive: true });
    window.addEventListener('resize', queueSpy);
    spy();
  }
  // In-page links (#apply, chapter links): land just below the sticky section
  // bar, so it never covers the top of the section. Runs before the site's
  // smooth scroll, which would otherwise put the section under the bar.
  function barBottom() {
    if (!bar) return 0;
    return (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight;
  }
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || !root || !root.contains(a)) return;
    var id = a.getAttribute('href').slice(1);
    var target = id && document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var y = target.getBoundingClientRect().top + window.pageYOffset - barBottom() - 16;
    if (window.awLenis) window.awLenis.scrollTo(Math.max(0, y));
    else window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    if (history.pushState) history.pushState(null, '', '#' + id);
  }, true);

  // a photo that can't be loaded: its frame disappears (no broken-image icon)
  [].forEach.call(document.querySelectorAll('.aw-photo__img'), function (img) {
    function missing() { var f = img.closest('.aw-photo'); if (f) f.classList.add('is-missing'); }
    if (img.complete && img.naturalWidth === 0 && img.currentSrc) missing();
    img.addEventListener('error', missing);
  });

  // ==========================================================================
  // The apply form
  // ==========================================================================
  var form = document.getElementById('aw-apply-form');
  if (!form) return;

  var MAX_CV = 10 * 1024 * 1024;
  var status = form.querySelector('.aw-astatus');
  var submit = form.querySelector('.aw-asubmit');
  var cvInput = form.querySelector('input[name="cv"]');
  var cvName = form.querySelector('.aw-afile__name');
  var consentAt = '';

  function errEl(field) { return form.querySelector('.aw-aerr[data-for="' + field + '"]'); }
  function inputFor(field) {
    if (field === 'phone') return form.querySelector('[name="phone_number"]');
    return form.querySelector('[name="' + field + '"]');
  }
  function setError(field, text) {
    var el = errEl(field), input = inputFor(field);
    if (el) el.textContent = text || '';
    if (input) {
      if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    }
  }
  function clearErrors() {
    [].forEach.call(form.querySelectorAll('.aw-aerr'), function (el) { el.textContent = ''; });
    [].forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    status.textContent = '';
    status.className = 'aw-astatus';
  }

  cvInput.addEventListener('change', function () {
    var f = cvInput.files && cvInput.files[0];
    cvName.textContent = f ? f.name : cvName.getAttribute('data-empty');
    setError('cv', '');
  });
  form.querySelector('[name="consent"]').addEventListener('change', function (e) {
    consentAt = e.target.checked ? new Date().toISOString() : '';
    setError('consent', '');
  });
  // the phone number takes digits only (spaces allowed to group them)
  var phoneInput = form.elements.phone_number;
  phoneInput.addEventListener('input', function () {
    var clean = phoneInput.value.replace(/[^\d ]/g, '');
    if (clean !== phoneInput.value) phoneInput.value = clean;
  });
  form.addEventListener('input', function (e) {
    var name = e.target.name === 'phone_number' ? 'phone' : e.target.name;
    if (name) setError(name, '');
  });

  function phoneValue() {
    var code = form.elements.phone_code.value;
    var digits = form.elements.phone_number.value.replace(/[^\d]/g, '');
    if (code !== '+39') digits = digits.replace(/^0+/, '');   // drop the national 0 (Italy keeps it)
    var typed = form.elements.phone_number.value.trim();
    // someone typing "0044 ..." in the number field means it
    if (/^00/.test(typed)) return '+' + typed.replace(/^00/, '').replace(/[^\d]/g, '');
    return code + digits;
  }

  function check() {
    var first = null;
    function bad(field, text) { setError(field, text); if (!first) first = field; }
    var name = form.elements.name.value.trim();
    if (name.length < 2) bad('name', 'Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.elements.email.value.trim())) bad('email', 'Please enter a valid email address.');
    if (!/^\+\d{6,16}$/.test(phoneValue())) bad('phone', 'Please enter your phone number.');
    var li = form.elements.linkedin_url.value.trim();
    if (li && !/linkedin\.com\/in\/\S+/i.test(li)) bad('linkedin_url', 'Use your LinkedIn profile link (linkedin.com/in/…) or leave it empty.');
    var f = cvInput.files && cvInput.files[0];
    if (!f) bad('cv', 'Please attach your CV.');
    else if (!/\.(pdf|docx?)$/i.test(f.name)) bad('cv', 'Your CV must be a PDF or Word file (.pdf, .doc, .docx).');
    else if (f.size > MAX_CV) bad('cv', 'Your CV is larger than 10 MB. Please send a smaller file.');
    if (!form.elements.consent.checked) bad('consent', 'Please tick the box to send your application.');
    if (first) {
      var input = inputFor(first);
      if (input) input.focus();
    }
    return !first;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    if (!check()) return;
    var endpoint = form.getAttribute('data-endpoint');
    if (!endpoint) {
      status.textContent = 'Applications are not connected on this preview yet.';
      status.className = 'aw-astatus aw-astatus--error';
      return;
    }

    var li = form.elements.linkedin_url.value.trim();
    if (li && !/^https?:\/\//i.test(li)) li = 'https://' + li;
    var data = new FormData();
    data.set('job_id', form.elements.job_id.value);
    data.set('name', form.elements.name.value.trim());
    data.set('email', form.elements.email.value.trim());
    data.set('phone', phoneValue());
    if (li) data.set('linkedin_url', li);
    data.set('cv', cvInput.files[0], cvInput.files[0].name);
    data.set('consent', 'true');
    data.set('consent_text', form.elements.consent_text.value);
    data.set('consent_at', consentAt || new Date().toISOString());
    data.set('website', form.elements.website.value);
    var token = form.querySelector('[name="cf-turnstile-response"]');
    if (token) data.set('cf-turnstile-response', token.value);

    submit.disabled = true;
    submit.textContent = 'Sending…';
    fetch(endpoint, { method: 'POST', body: data })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        if (r.ok) {
          form.hidden = true;
          var thanks = document.getElementById('aw-apply-thanks');
          thanks.hidden = false;
          (thanks.querySelector('.aw-done__title') || thanks).focus();
          return;
        }
        var msg = (r.body && r.body.error) || 'Something went wrong. Please try again.';
        if (r.body && r.body.field && errEl(r.body.field) && r.body.field !== 'job_id') {
          setError(r.body.field, msg);
          var input = inputFor(r.body.field);
          if (input) input.focus();
        } else {
          status.textContent = msg;
          status.className = 'aw-astatus aw-astatus--error';
        }
        if (window.turnstile) window.turnstile.reset();
      })
      .catch(function () {
        status.textContent = 'We couldn’t reach our server. Check your connection and try again.';
        status.className = 'aw-astatus aw-astatus--error';
        if (window.turnstile) window.turnstile.reset();
      })
      .then(function () {
        submit.disabled = false;
        submit.textContent = 'Send application';
      });
  });
})();
