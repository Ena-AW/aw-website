// Open jobs: loads data/jobs.json, builds the filter menus from the data, filters as you type
// or pick, and keeps the filters in the address so a filtered list can be shared or bookmarked.
// Every menu takes several values (e.g. German + Dutch). In step 2 the data comes from Supabase.
(function () {
  'use strict';

  var SITE_ROOT = document.documentElement.getAttribute('data-root') || './';
  var form = document.getElementById('aw-filters');
  var list = document.getElementById('aw-jrows');
  var count = document.getElementById('aw-jcount');
  var clear = document.getElementById('aw-jclear');
  if (!form || !list) return;

  var NAMES = ['location', 'position', 'language', 'model'];
  function valueOf(job, name) {
    return name === 'location' ? job.country : name === 'model' ? job.workModel : job[name];
  }

  var jobs = [];
  var picked = { location: [], position: [], language: [], model: [] };   // what each menu has selected
  var menus = {};

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

  // ==========================================================================
  // Filter menus
  // A button that reads "All languages", "German" or "German +1", and a panel
  // that grows out of it. Each option has a round check and how many jobs it has.
  // Keyboard: Enter/Space/↓ opens, ↑↓ Home End move, Space/Enter toggles,
  // Esc closes and returns to the button. Clicking outside closes it.
  // ==========================================================================
  var CHEVRON = '<svg class="aw-dd__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 12.5 4 4 8-9"/></svg>';
  var openMenu = null;

  function buildMenu(host) {
    var name = host.getAttribute('data-name');
    var all = host.getAttribute('data-all');
    var noun = host.getAttribute('data-noun');
    var id = 'aw-dd-' + name;

    var btn = el('button', 'aw-dd__btn');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    var label = el('span', 'aw-dd__label', all);
    var badge = el('span', 'aw-dd__badge');
    badge.hidden = true;
    btn.appendChild(label);
    btn.appendChild(badge);
    btn.insertAdjacentHTML('beforeend', CHEVRON);

    var panel = el('div', 'aw-dd__panel');
    panel.id = id;
    var listbox = el('ul', 'aw-dd__list');
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-multiselectable', 'true');
    listbox.setAttribute('aria-label', noun);
    listbox.tabIndex = -1;

    var counts = {};
    jobs.forEach(function (job) {
      var v = valueOf(job, name);
      if (v) counts[v] = (counts[v] || 0) + 1;
    });
    Object.keys(counts).sort().forEach(function (v) {
      var opt = el('li', 'aw-dd__opt');
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', 'false');
      opt.tabIndex = -1;
      opt.dataset.value = v;
      var check = el('span', 'aw-dd__check');
      check.insertAdjacentHTML('afterbegin', CHECK);
      opt.appendChild(check);
      opt.appendChild(el('span', 'aw-dd__text', v));
      opt.appendChild(el('span', 'aw-dd__n', String(counts[v])));
      listbox.appendChild(opt);
    });
    panel.appendChild(listbox);

    var foot = el('div', 'aw-dd__foot');
    var reset = el('button', 'aw-dd__reset', 'Clear');
    reset.type = 'button';
    var done = el('button', 'aw-dd__done', 'Done');
    done.type = 'button';
    foot.appendChild(reset);
    foot.appendChild(done);
    panel.appendChild(foot);

    host.appendChild(btn);
    host.appendChild(panel);

    var options = Array.prototype.slice.call(listbox.querySelectorAll('.aw-dd__opt'));

    function sync() {
      var chosen = picked[name];
      options.forEach(function (opt) {
        opt.setAttribute('aria-selected', chosen.indexOf(opt.dataset.value) > -1 ? 'true' : 'false');
      });
      label.textContent = chosen.length ? chosen[0] : all;
      badge.hidden = chosen.length < 2;
      badge.textContent = '+' + (chosen.length - 1);
      host.classList.toggle('is-set', chosen.length > 0);
      btn.setAttribute('aria-label', chosen.length ? noun + ': ' + chosen.join(', ') : all);
      reset.disabled = !chosen.length;
    }
    function toggle(opt) {
      var v = opt.dataset.value;
      var chosen = picked[name];
      var i = chosen.indexOf(v);
      if (i > -1) chosen.splice(i, 1); else chosen.push(v);
      sync();
      render();
    }
    function focusOpt(i) {
      if (!options.length) return;
      options[(i + options.length) % options.length].focus();
    }
    function place() {
      // keep the panel on screen: open to the left of the button if it would run off the right edge
      host.classList.remove('is-flipped');
      var r = panel.getBoundingClientRect();
      if (r.right > document.documentElement.clientWidth - 8) host.classList.add('is-flipped');
    }
    function open(focusFirst) {
      if (openMenu && openMenu !== api) openMenu.close(false);
      openMenu = api;
      host.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      place();
      if (focusFirst) {
        var first = options.filter(function (o) { return o.getAttribute('aria-selected') === 'true'; })[0] || options[0];
        if (first) first.focus();
      }
    }
    function close(returnFocus) {
      host.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      if (openMenu === api) openMenu = null;
      if (returnFocus) btn.focus();
    }

    // respond on press, so the menu answers as soon as the finger lands
    btn.addEventListener('click', function () {
      host.classList.contains('is-open') ? close(false) : open(false);
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(true); }
    });
    listbox.addEventListener('click', function (e) {
      var opt = e.target.closest('.aw-dd__opt');
      if (opt) toggle(opt);
    });
    panel.addEventListener('keydown', function (e) {
      var i = options.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); focusOpt(i + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusOpt(i - 1); }
      else if (e.key === 'Home') { e.preventDefault(); focusOpt(0); }
      else if (e.key === 'End') { e.preventDefault(); focusOpt(options.length - 1); }
      else if ((e.key === ' ' || e.key === 'Enter') && i > -1) { e.preventDefault(); toggle(options[i]); }
    });
    reset.addEventListener('click', function () {
      picked[name] = [];
      sync();
      render();
    });
    done.addEventListener('click', function () { close(true); });
    host.addEventListener('focusout', function (e) {
      if (host.classList.contains('is-open') && e.relatedTarget && !host.contains(e.relatedTarget)) close(false);
    });

    var api = { sync: sync, close: close, host: host };
    return api;
  }

  document.addEventListener('pointerdown', function (e) {
    if (openMenu && !openMenu.host.contains(e.target)) openMenu.close(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openMenu) openMenu.close(true);
  });

  // ==========================================================================
  // Filtering
  // ==========================================================================
  function matches(job, q) {
    for (var i = 0; i < NAMES.length; i++) {
      var chosen = picked[NAMES[i]];
      if (chosen.length && chosen.indexOf(valueOf(job, NAMES[i])) < 0) return false;
    }
    if (q) {
      var hay = norm([job.title, job.location, job.position, job.language, job.workModel].join(' '));
      return q.split(/\s+/).every(function (word) { return hay.indexOf(word) > -1; });
    }
    return true;
  }

  // ---- drawing: title, one quiet line of facts, a chevron. No icons, no boxes. ----
  var ROW_CHEVRON = '<svg class="aw-jrow__chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  function row(job) {
    var li = el('li', 'aw-jrow');
    var a = el('a');
    a.href = jobUrl(job);
    a.appendChild(el('h2', 'aw-jrow__title', job.title));
    var meta = el('p', 'aw-jrow__meta');
    if (job.language) meta.appendChild(el('span', 'aw-jrow__lang', job.language));
    [job.location, job.employmentType, job.workModel].forEach(function (v) {
      if (v) meta.appendChild(el('span', '', v));
    });
    a.appendChild(meta);
    a.insertAdjacentHTML('beforeend', ROW_CHEVRON);   // fixed icon, never data
    li.appendChild(a);
    return li;
  }
  function empty() {
    var box = el('div', 'aw-jempty');
    box.appendChild(el('p', '', 'No jobs match these filters right now.'));
    box.appendChild(el('p', '', 'Try fewer filters, or check back soon. New roles open every week.'));
    return box;
  }

  function render() {
    var q = norm(form.elements.q.value.trim());
    var shown = jobs.filter(function (job) { return matches(job, q); });
    var active = !!q || NAMES.some(function (n) { return picked[n].length; });

    list.replaceChildren.apply(list, shown.map(row));
    var old = list.parentNode.querySelector('.aw-jempty');
    if (old) old.remove();
    if (!shown.length) list.parentNode.appendChild(empty());

    count.textContent = shown.length === 1 ? '1 open job' : shown.length + ' open jobs';
    clear.hidden = !active;
    writeUrl();
  }

  // ---- the address keeps the filters: ?q=…&language=German,Dutch ----
  function writeUrl() {
    var params = new URLSearchParams();
    var q = form.elements.q.value.trim();
    if (q) params.set('q', q);
    NAMES.forEach(function (n) { if (picked[n].length) params.set(n, picked[n].join(',')); });
    var qs = params.toString().replace(/%2C/g, ',');
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  function readUrl() {
    var params = new URLSearchParams(location.search);
    if (params.get('q')) form.elements.q.value = params.get('q');
    NAMES.forEach(function (n) {
      var known = {};
      jobs.forEach(function (job) { known[valueOf(job, n)] = true; });
      picked[n] = (params.get(n) || '').split(',').filter(function (v) { return v && known[v]; });
    });
    // Old WordPress links (home page destinations): ?job__location_spec=lisbon-portugal,porto-portugal
    var spec = params.get('job__location_spec');
    if (spec && !params.get('location')) {
      var slugs = spec.split(',');
      jobs.forEach(function (job) {
        if (slugs.indexOf(job.locationSlug) > -1 && picked.location.indexOf(job.country) < 0) picked.location.push(job.country);
      });
    }
  }

  // ---- events: results follow every keystroke and every pick, no "apply" button ----
  form.addEventListener('input', render);
  form.addEventListener('submit', function (e) { e.preventDefault(); render(); });
  clear.addEventListener('click', function () {
    form.elements.q.value = '';
    NAMES.forEach(function (n) { picked[n] = []; if (menus[n]) menus[n].sync(); });
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
      readUrl();
      Array.prototype.forEach.call(form.querySelectorAll('.aw-dd'), function (host) {
        var menu = buildMenu(host);
        menus[host.getAttribute('data-name')] = menu;
        menu.sync();
      });
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
