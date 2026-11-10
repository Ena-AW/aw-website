// Open jobs: loads data/jobs.json, fills the filters from the data, filters as you type or pick,
// and keeps the filters in the address so a filtered list can be shared or bookmarked.
// In step 2 the data comes from Supabase instead; the rest stays the same.
(function () {
  'use strict';

  var SITE_ROOT = document.documentElement.getAttribute('data-root') || './';
  var form = document.getElementById('aw-filters');
  var list = document.getElementById('aw-jrows');
  var count = document.getElementById('aw-jcount');
  var clear = document.getElementById('aw-jclear');
  if (!form || !list) return;

  var FIELDS = { location: 'location', position: 'position', language: 'language', model: 'workModel' };
  var ICONS = {
    location: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.7 2.3a1 1 0 0 0-1.05-.23l-18 7a1 1 0 0 0 .08 1.9l7.4 2.1 2.1 7.4a1 1 0 0 0 1.9.08l7-18a1 1 0 0 0-.23-1.05z"/></svg>',
    type: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3a2 2 0 0 0-2 2v1H4a2 2 0 0 0-2 2v3h20V8a2 2 0 0 0-2-2h-3V5a2 2 0 0 0-2-2H9zm0 2h6v1H9V5zM2 13v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6h-8v1a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1H2z"/></svg>',
    language: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 2a1 1 0 0 0-1 1v19a1 1 0 1 0 2 0v-7h5.4l.6 1.3a1 1 0 0 0 .9.7H20a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-6.4l-.7-1.4A1 1 0 0 0 12 3H6V3a1 1 0 0 0-1-1z"/></svg>',
    model: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2L13.5 2z"/></svg>',
    arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  };

  var jobs = [];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function jobUrl(job) {
    if (/^https?:\/\//i.test(job.url || '')) return job.url;
    return SITE_ROOT + 'jobs/' + encodeURIComponent(job.slug) + '/';
  }

  // ---- filters: options come from the jobs themselves, so a new country or language just appears ----
  function fillSelect(name) {
    var select = form.elements[name];
    var values = {};
    jobs.forEach(function (job) {
      var v = name === 'location' ? job.country : job[FIELDS[name]];
      if (v) values[v] = true;
    });
    Object.keys(values).sort().forEach(function (v) {
      var option = document.createElement('option');
      option.value = v; option.textContent = v;
      select.appendChild(option);
    });
  }

  function current() {
    return {
      q: norm(form.elements.q.value.trim()),
      location: form.elements.location.value,
      position: form.elements.position.value,
      language: form.elements.language.value,
      model: form.elements.model.value
    };
  }
  function matches(job, f) {
    if (f.location && job.country !== f.location) return false;
    if (f.position && job.position !== f.position) return false;
    if (f.language && job.language !== f.language) return false;
    if (f.model && job.workModel !== f.model) return false;
    if (f.q) {
      var hay = norm([job.title, job.location, job.position, job.language, job.workModel].join(' '));
      return f.q.split(/\s+/).every(function (word) { return hay.indexOf(word) > -1; });
    }
    return true;
  }

  // ---- drawing ----
  function metaItem(icon, text) {
    var li = el('li');
    li.insertAdjacentHTML('afterbegin', ICONS[icon]);   // fixed icons, never data
    li.appendChild(document.createTextNode(text));
    return li;
  }
  function row(job) {
    var li = el('li', 'aw-jrow');
    var a = el('a');
    a.href = jobUrl(job);
    a.appendChild(el('h2', 'aw-jrow__title', job.title));
    var meta = el('ul', 'aw-jrow__meta');
    if (job.location) meta.appendChild(metaItem('location', job.location));
    if (job.employmentType) meta.appendChild(metaItem('type', job.employmentType));
    if (job.language) meta.appendChild(metaItem('language', job.language));
    if (job.workModel) meta.appendChild(metaItem('model', job.workModel));
    var more = el('li', 'aw-jrow__more', 'More Details');
    more.insertAdjacentHTML('beforeend', ICONS.arrow);
    meta.appendChild(more);
    a.appendChild(meta);
    li.appendChild(a);
    return li;
  }
  function empty() {
    var box = el('div', 'aw-jempty');
    box.appendChild(el('p', '', 'No jobs match these filters right now.'));
    box.appendChild(el('p', '', 'Try fewer filters, or check back soon: new roles open every week.'));
    return box;
  }

  function render() {
    var f = current();
    var shown = jobs.filter(function (job) { return matches(job, f); });
    var active = !!(f.q || f.location || f.position || f.language || f.model);

    list.replaceChildren.apply(list, shown.map(row));
    var old = list.parentNode.querySelector('.aw-jempty');
    if (old) old.remove();
    if (!shown.length) list.parentNode.appendChild(empty());

    count.textContent = shown.length === 1 ? '1 open job' : shown.length + ' open jobs';
    clear.hidden = !active;
    ['location', 'position', 'language', 'model'].forEach(function (name) {
      form.elements[name].classList.toggle('is-set', !!form.elements[name].value);
    });
    writeUrl();
  }

  // ---- the address keeps the filters (?q=&location=…) ----
  function writeUrl() {
    var params = new URLSearchParams();
    ['q', 'location', 'position', 'language', 'model'].forEach(function (name) {
      var v = form.elements[name].value.trim();
      if (v) params.set(name, v);
    });
    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  function readUrl() {
    var params = new URLSearchParams(location.search);
    ['q', 'location', 'position', 'language', 'model'].forEach(function (name) {
      var v = params.get(name);
      if (v != null && form.elements[name]) form.elements[name].value = v;
    });
    // Old WordPress links (home page destinations): ?job__location_spec=lisbon-portugal,porto-portugal
    var spec = params.get('job__location_spec');
    if (spec && !params.get('location')) {
      var slugs = spec.split(',');
      var hit = jobs.filter(function (job) { return slugs.indexOf(job.locationSlug) > -1; })[0];
      if (hit) form.elements.location.value = hit.country;
    }
  }

  // ---- events: results follow every keystroke and every pick, no "apply" button ----
  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', function (e) { e.preventDefault(); render(); });
  clear.addEventListener('click', function () {
    form.reset();
    render();
    form.elements.q.focus();
  });

  fetch(SITE_ROOT + 'data/jobs.json', { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      jobs = Array.isArray(data) ? data : [];
      ['location', 'position', 'language', 'model'].forEach(fillSelect);
      readUrl();
      list.removeAttribute('aria-busy');
      render();
    })
    .catch(function (error) {
      console.warn('Open jobs: could not load.', error);
      list.removeAttribute('aria-busy');
      list.replaceChildren();
      var box = empty();
      box.firstChild.textContent = 'We couldn’t load the open jobs right now.';
      box.lastChild.textContent = 'Please try again in a moment, or write to careers@atleanworld.com.';
      list.parentNode.appendChild(box);
    });
})();
