// Job page: the apply form. It sends the application (CV included) to the
// website-apply Edge Function, which forwards it to the job's pipeline in
// Atleable. Errors come back per field and are shown next to that field.
(function () {
  'use strict';
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
  form.addEventListener('input', function (e) {
    var name = e.target.name === 'phone_number' ? 'phone' : e.target.name;
    if (name) setError(name, '');
  });

  function phoneValue() {
    var code = form.elements.phone_code.value;
    var digits = form.elements.phone_number.value.replace(/[^\d]/g, '');
    if (code !== '+39') digits = digits.replace(/^0+/, '');   // drop the national 0 (Italy keeps it)
    var typed = form.elements.phone_number.value.trim();
    // someone typing "+44 ..." in the number field means it
    if (/^(\+|00)/.test(typed)) return '+' + typed.replace(/^00/, '').replace(/[^\d]/g, '');
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
          thanks.focus();
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
