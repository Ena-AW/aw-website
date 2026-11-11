// Atlean World admin panel: jobs, Atlean Talks, media library and team.
// Plain JavaScript on top of supabase-js (assets/vendor/supabase) and the
// Quill editor (assets/vendor/quill). Data lives in Supabase; saving anything
// asks GitHub to rebuild the public site (the website-rebuild Edge Function).
(function () {
  'use strict';

  var CFG = window.AW_ADMIN || {};
  var ROOT = document.documentElement.getAttribute('data-root') || './';
  var SITE = new URL(ROOT, location.href).href;          // public site root, for "View on site"
  var BUCKET = 'media';
  var FOLDERS = ['logos', 'images', 'videos', 'documents', 'blog'];
  var COUNTRIES = ['Portugal', 'Greece', 'Poland', 'Bulgaria', 'Cyprus'];
  var EMPLOYMENT = ['Full-time', 'Part-time', 'Contract', 'Internship'];
  var MODELS = ['On-site', 'Hybrid', 'Remote'];

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseAnonKey) {
    document.body.innerHTML = '<p style="font:16px system-ui;padding:2rem">The admin panel is not connected to Supabase yet. Fill in assets/js/admin-config.js.</p>';
    return;
  }
  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { db: { schema: CFG.schema || 'public' } });
  var me = null;          // { id, email, full_name, role }
  var dirty = false;      // unsaved changes in an editor

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/['’‘"“”]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function options(list, value) {
    return list.map(function (v) { return '<option' + (v === value ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }
  function datalist(id, values) {
    var uniq = values.filter(function (v, i) { return v && values.indexOf(v) === i; }).sort();
    return '<datalist id="' + id + '">' + uniq.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>';
  }
  function friendly(error) {
    if (!error) return 'Something went wrong.';
    if (error.code === '23505') return 'That URL (slug) is already used. Change the slug and save again.';
    if (error.code === '23514') return 'The slug may only use lowercase letters, numbers and hyphens.';
    return error.message || String(error);
  }

  var toastTimer;
  function toast(text, kind) {
    var t = $('#adm-toast');
    t.textContent = text;
    t.className = 'adm-toast' + (kind ? ' adm-toast--' + kind : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, kind === 'error' ? 7000 : 4000);
  }

  function confirmDialog(title, text, okLabel) {
    var d = $('#adm-dialog');
    $('#adm-dialog-title').textContent = title;
    $('#adm-dialog-text').textContent = text;
    $('#adm-dialog-ok').textContent = okLabel || 'Delete';
    d.returnValue = '';
    d.showModal();
    return new Promise(function (resolve) {
      d.addEventListener('close', function once() {
        d.removeEventListener('close', once);
        resolve(d.returnValue === 'ok');
      });
    });
  }

  // Ask GitHub to rebuild the public site. Saving never fails because of this.
  function rebuild() {
    return sb.functions.invoke('website-rebuild', { body: {} }).then(function (res) {
      if (res.error) throw res.error;
      toast('Saved. The website updates in about a minute.', 'ok');
    }).catch(function (e) {
      console.warn('website-rebuild', e);
      toast('Saved. The website could not start updating automatically. Ask an admin to check the rebuild setup.', 'error');
    });
  }

  function editor(el, placeholder) {
    var q = new window.Quill(el, {
      theme: 'snow',
      placeholder: placeholder || '',
      modules: {
        toolbar: {
          container: [
            [{ header: [2, 3, false] }],
            ['bold', 'italic', 'underline', 'link'],
            [{ list: 'ordered' }, { list: 'bullet' }, 'blockquote'],
            ['image', 'video'],
            ['clean']
          ],
          handlers: {
            image: function () {
              pickImage('blog').then(function (url) {
                if (!url) return;
                var range = q.getSelection(true);
                q.insertEmbed(range.index, 'image', url, 'user');
                q.setSelection(range.index + 1);
              });
            }
          }
        }
      }
    });
    q.on('text-change', function () { dirty = true; });
    return q;
  }
  function editorHtml(q) {
    var html = q.getSemanticHTML ? q.getSemanticHTML() : q.root.innerHTML;
    html = html.replace(/&nbsp;/g, ' ');
    return /^(<p>(<br>)?<\/p>\s*)*$/.test(html) ? '' : html;
  }

  // ------------------------------------------------------------------ auth
  // Sign-in is Google, with the same Atlean accounts as Atleable.
  function showAuth(message) {
    $('#adm-app').hidden = true;
    $('#adm-auth').hidden = false;
    var m = $('#adm-auth-msg');
    m.textContent = message || '';
    m.hidden = !message;
  }
  $('#adm-google').addEventListener('click', function () {
    sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }).then(function (res) {
      if (res.error) showAuth(res.error.message);
    });
  });
  $('#adm-signout').addEventListener('click', function () {
    sb.auth.signOut().then(function () { me = null; showAuth(); });
  });
  // Google sends people back with ?error_description=… when sign-in is refused
  var back = new URLSearchParams(location.search + '&' + location.hash.replace(/^#/, ''));
  var authError = back.get('error_description');

  var starting = null;
  function start() {
    if (starting) return starting;
    starting = sb.auth.getSession().then(function (res) {
      var session = res.data.session;
      if (!session) {
        showAuth(authError ? 'Google sign-in was refused: ' + authError.replace(/\+/g, ' ') : '');
        authError = null;
        return;
      }
      return sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(function (p) {
        if (!p.data) {
          sb.auth.signOut();
          return showAuth('Your Atlean account does not have access to the website admin yet. Ask an admin to add you under Users.');
        }
        me = p.data;
        $('#adm-me').textContent = me.full_name || me.email;
        $$('[data-admin-only]').forEach(function (el) { el.hidden = me.role !== 'admin'; });
        $('#adm-auth').hidden = true;
        $('#adm-app').hidden = false;
        if (!/^#(jobs|talks|media|users)/.test(location.hash)) history.replaceState(null, '', location.pathname + '#jobs');
        lastHash = location.hash;
        route();
      });
    }).finally(function () { starting = null; });
    return starting;
  }
  sb.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_IN' && !me) setTimeout(start, 0);
  });

  // ------------------------------------------------------------------ router
  window.addEventListener('hashchange', function () { if (me) route(); });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  var lastHash = location.hash;
  function route() {
    var hash = location.hash.replace(/^#/, '');
    if (/access_token|type=/.test(hash)) return;
    if (dirty && location.hash !== lastHash && !window.confirm('You have unsaved changes. Leave without saving?')) {
      history.replaceState(null, '', lastHash);
      return;
    }
    dirty = false;
    lastHash = location.hash;
    var parts = hash.split('/');
    var tab = parts[0] || 'jobs';
    if (tab === 'users' && me.role !== 'admin') tab = 'jobs';
    $$('.adm-tabs a').forEach(function (a) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var view = $('#adm-view');
    view.innerHTML = '<p class="adm-loading">Loading…</p>';
    var id = parts[1] ? decodeURIComponent(parts[1]) : null;
    ({ jobs: id ? jobEditor : jobsList, talks: id ? postEditor : postsList, media: mediaView, users: usersView }[tab] || jobsList)(view, id);
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ list view (shared by jobs and posts)
  function listView(view, opts) {
    var state = { q: '', status: '' };
    view.innerHTML =
      '<div class="adm-head"><h1>' + opts.title + '</h1><a class="adm-btn" href="#' + opts.tab + '/new">' + opts.newLabel + '</a></div>' +
      '<div class="adm-tools">' +
        '<input class="adm-search" type="search" placeholder="Search" aria-label="Search">' +
        '<div class="adm-seg" role="group" aria-label="Status">' +
          opts.statuses.map(function (s, i) { return '<button type="button" data-status="' + s[0] + '" aria-pressed="' + (i === 0) + '">' + s[1] + '</button>'; }).join('') +
        '</div>' +
      '</div>' +
      '<p class="adm-count" aria-live="polite"></p>' +
      '<ul class="adm-list"></ul>';
    var list = $('.adm-list', view), count = $('.adm-count', view);
    var rows = [];

    function draw() {
      var words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      var shown = rows.filter(function (r) {
        if (state.status && r.status !== state.status) return false;
        var text = opts.text(r).toLowerCase();
        return words.every(function (w) { return text.indexOf(w) !== -1; });
      });
      count.textContent = shown.length + ' of ' + rows.length;
      list.innerHTML = shown.length ? shown.map(opts.row).join('') : '<li class="adm-empty">' + (rows.length ? 'Nothing matches.' : opts.empty) + '</li>';
    }
    $('.adm-search', view).addEventListener('input', function (e) { state.q = e.target.value; draw(); });
    $$('.adm-seg button', view).forEach(function (b) {
      b.addEventListener('click', function () {
        state.status = b.dataset.status;
        $$('.adm-seg button', view).forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        draw();
      });
    });
    opts.load().then(function (res) {
      if (res.error) { list.innerHTML = '<li class="adm-empty">' + esc(friendly(res.error)) + '</li>'; return; }
      rows = res.data || [];
      draw();
    });
  }

  function pill(status) {
    var label = { published: 'Published', draft: 'Draft', closed: 'Closed' }[status] || status;
    return '<span class="adm-pill adm-pill--' + esc(status) + '">' + esc(label) + '</span>';
  }

  // ------------------------------------------------------------------ jobs
  function jobsList(view) {
    listView(view, {
      tab: 'jobs', title: 'Jobs', newLabel: 'New job', empty: 'No jobs yet. Click “New job” to add the first one.',
      statuses: [['', 'All'], ['published', 'Published'], ['draft', 'Drafts'], ['closed', 'Closed']],
      load: function () { return sb.from('jobs').select('id,title,location,language,position,status,spotlight,source,updated_at').order('updated_at', { ascending: false }); },
      text: function (j) { return [j.title, j.location, j.language, j.position].join(' '); },
      row: function (j) {
        return '<li><a class="adm-row" href="#jobs/' + j.id + '">' +
          '<span class="adm-row__main"><strong>' + esc(j.title) + (j.spotlight ? ' <span class="adm-star" title="Spotlight on the home page">★</span>' : '') + '</strong>' +
          '<span class="adm-row__meta">' + [j.location, j.language, j.position].filter(Boolean).map(esc).join(' · ') + (j.source === 'atleable' ? ' · <em>from Atleable</em>' : '') + '</span></span>' +
          pill(j.status) + '<span class="adm-row__date">' + fmtDate(j.updated_at) + '</span></a></li>';
      }
    });
  }

  function jobEditor(view, id) {
    var isNew = id === 'new';
    Promise.all([
      isNew ? Promise.resolve({ data: { status: 'draft', employment_type: 'Full-time', work_model: 'On-site', country: 'Portugal' } }) : sb.from('jobs').select('*').eq('id', id).single(),
      sb.from('jobs').select('position,language,location')
    ]).then(function (r) {
      if (r[0].error) { view.innerHTML = '<p class="adm-empty">' + esc(friendly(r[0].error)) + '</p>'; return; }
      var j = r[0].data, all = r[1].data || [];
      var slugTouched = !isNew;
      view.innerHTML =
        '<form class="adm-edit" novalidate>' +
        '<div class="adm-head"><a class="adm-back" href="#jobs">‹ Jobs</a><h1>' + (isNew ? 'New job' : esc(j.title)) + '</h1></div>' +
        (j.source === 'atleable' ? '<p class="adm-note">This job came from Atleable. Changes you make here are sent back to Atleable once the sync is switched on.</p>' : '') +
        '<div class="adm-grid">' +
          '<label class="adm-field adm-span2"><span>Job title *</span><input name="title" required value="' + esc(j.title) + '"></label>' +
          '<label class="adm-field adm-span2"><span>Web address</span><span class="adm-slug"><span>' + esc(SITE) + 'jobs/</span><input name="slug" value="' + esc(j.slug) + '" pattern="[a-z0-9]+(-[a-z0-9]+)*"></span></label>' +
          '<label class="adm-field"><span>Country</span><select name="country">' + options(COUNTRIES.indexOf(j.country) < 0 && j.country ? COUNTRIES.concat(j.country) : COUNTRIES, j.country) + '</select></label>' +
          '<label class="adm-field"><span>Location</span><input name="location" list="dl-loc" placeholder="Lisbon, Portugal" value="' + esc(j.location) + '"></label>' +
          '<label class="adm-field"><span>Position</span><input name="position" list="dl-pos" placeholder="Customer Support" value="' + esc(j.position) + '"></label>' +
          '<label class="adm-field"><span>Language</span><input name="language" list="dl-lang" placeholder="German" value="' + esc(j.language) + '"></label>' +
          '<label class="adm-field"><span>Employment type</span><select name="employment_type">' + options(EMPLOYMENT, j.employment_type) + '</select></label>' +
          '<label class="adm-field"><span>Work model</span><select name="work_model">' + options(MODELS, j.work_model) + '</select></label>' +
          '<label class="adm-field"><span>Salary (optional)</span><input name="salary" placeholder="€1,200 + bonus" value="' + esc(j.salary) + '"></label>' +
          '<label class="adm-field"><span>Apply link (optional)</span><input name="apply_url" type="url" placeholder="https://apply.workable.com/…" value="' + esc(j.apply_url) + '"></label>' +
          '<div class="adm-field adm-span2"><span>Job description</span><div class="adm-quill" id="adm-desc"></div></div>' +
        '</div>' +
        '<div class="adm-side">' +
          '<label class="adm-field"><span>Status</span><select name="status">' + options(['draft', 'published', 'closed'], j.status).replace(/>draft</, '>Draft — only the team sees it<').replace(/>published</, '>Published — on the website<').replace(/>closed</, '>Closed — hidden, kept for records<') + '</select></label>' +
          '<label class="adm-check"><input type="checkbox" name="spotlight"' + (j.spotlight ? ' checked' : '') + '> Spotlight on the home page</label>' +
          '<div class="adm-actions">' +
            '<button class="adm-btn" type="submit">Save</button>' +
            (isNew ? '' : '<button class="adm-btn adm-btn--danger adm-btn--ghost" type="button" data-delete>Delete</button>') +
          '</div>' +
          (isNew ? '' : '<p class="adm-small">Last saved ' + fmtDate(j.updated_at) + '</p>') +
        '</div>' +
        datalist('dl-loc', all.map(function (x) { return x.location; })) +
        datalist('dl-pos', all.map(function (x) { return x.position; })) +
        datalist('dl-lang', all.map(function (x) { return x.language; })) +
        '</form>';

      var form = $('form', view);
      var q = editor($('#adm-desc', view), 'What the job is, what you offer, who you are looking for…');
      if (j.description) q.clipboard.dangerouslyPasteHTML(j.description, 'silent');
      dirty = false;
      form.addEventListener('input', function (e) {
        dirty = true;
        if (e.target.name === 'slug') slugTouched = true;
        if (e.target.name === 'title' && !slugTouched) form.slug.value = slugify(form.title.value);
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!form.title.value.trim()) { toast('Give the job a title.', 'error'); form.title.focus(); return; }
        var slug = slugify(form.slug.value || form.title.value);
        form.slug.value = slug;
        var location_ = form.location.value.trim();
        var row = {
          title: form.title.value.trim(), slug: slug,
          country: form.country.value, location: location_, location_slug: slugify(location_.split(',')[0] + (location_ ? '-' + form.country.value : '')),
          position: form.position.value.trim(), language: form.language.value.trim(),
          employment_type: form.employment_type.value, work_model: form.work_model.value,
          salary: form.salary.value.trim(), apply_url: form.apply_url.value.trim(),
          description: editorHtml(q), status: form.status.value, spotlight: form.spotlight.checked
        };
        var btn = $('button[type=submit]', form);
        btn.disabled = true;
        var req = isNew ? sb.from('jobs').insert(row).select('id').single() : sb.from('jobs').update(row).eq('id', id).select('id').single();
        req.then(function (res) {
          btn.disabled = false;
          if (res.error) return toast(friendly(res.error), 'error');
          dirty = false;
          rebuild();
          if (isNew) location.hash = '#jobs/' + res.data.id;
        });
      });

      var del = $('[data-delete]', form);
      if (del) del.addEventListener('click', function () {
        confirmDialog('Delete this job?', '“' + j.title + '” will be removed from the website and the admin panel. To only hide it, set the status to Closed instead.').then(function (ok) {
          if (!ok) return;
          sb.from('jobs').delete().eq('id', id).then(function (res) {
            if (res.error) return toast(friendly(res.error), 'error');
            dirty = false;
            rebuild();
            location.hash = '#jobs';
          });
        });
      });
    });
  }

  // ------------------------------------------------------------------ Atlean Talks
  function postsList(view) {
    listView(view, {
      tab: 'talks', title: 'Atlean Talks', newLabel: 'New article', empty: 'No articles yet. Click “New article” to write the first one.',
      statuses: [['', 'All'], ['published', 'Published'], ['draft', 'Drafts']],
      load: function () { return sb.from('posts').select('id,title,category,author,status,published_at,updated_at').order('published_at', { ascending: false, nullsFirst: true }); },
      text: function (p) { return [p.title, p.category, p.author].join(' '); },
      row: function (p) {
        return '<li><a class="adm-row" href="#talks/' + p.id + '">' +
          '<span class="adm-row__main"><strong>' + esc(p.title) + '</strong>' +
          '<span class="adm-row__meta">' + [p.category, p.author].filter(Boolean).map(esc).join(' · ') + '</span></span>' +
          pill(p.status) + '<span class="adm-row__date">' + fmtDate(p.published_at || p.updated_at) + '</span></a></li>';
      }
    });
  }

  function postEditor(view, id) {
    var isNew = id === 'new';
    var today = new Date().toISOString().slice(0, 10);
    Promise.all([
      isNew ? Promise.resolve({ data: { status: 'draft', author: me.full_name || '' } }) : sb.from('posts').select('*').eq('id', id).single(),
      sb.from('posts').select('category,author'),
      sb.from('profiles').select('full_name')
    ]).then(function (r) {
      if (r[0].error) { view.innerHTML = '<p class="adm-empty">' + esc(friendly(r[0].error)) + '</p>'; return; }
      var p = r[0].data, all = r[1].data || [], team = r[2].data || [];
      var slugTouched = !isNew;
      var live = p.status === 'published' && p.slug;
      view.innerHTML =
        '<form class="adm-edit" novalidate>' +
        '<div class="adm-head"><a class="adm-back" href="#talks">‹ Atlean Talks</a><h1>' + (isNew ? 'New article' : esc(p.title)) + '</h1>' +
          (live ? '<a class="adm-linkbtn" href="' + esc(SITE + p.slug + '/') + '" target="_blank" rel="noopener">View on site ↗</a>' : '') + '</div>' +
        '<div class="adm-grid">' +
          '<label class="adm-field adm-span2"><span>Title *</span><input name="title" required value="' + esc(p.title) + '"></label>' +
          '<label class="adm-field adm-span2"><span>Web address</span><span class="adm-slug"><span>' + esc(SITE) + '</span><input name="slug" value="' + esc(p.slug) + '"></span></label>' +
          '<label class="adm-field"><span>Category</span><input name="category" list="dl-cat" placeholder="Tips" value="' + esc(p.category) + '"></label>' +
          '<label class="adm-field"><span>Author</span><input name="author" list="dl-author" value="' + esc(p.author) + '"></label>' +
          '<label class="adm-field adm-span2"><span>Short summary <small>(shown in the list and on Google, about 2 sentences)</small></span><textarea name="excerpt" rows="3" maxlength="320">' + esc(p.excerpt) + '</textarea></label>' +
          '<div class="adm-field adm-span2"><span>Article</span><div class="adm-quill adm-quill--tall" id="adm-body"></div></div>' +
        '</div>' +
        '<div class="adm-side">' +
          '<label class="adm-field"><span>Status</span><select name="status">' + options(['draft', 'published'], p.status).replace(/>draft</, '>Draft — only the team sees it<').replace(/>published</, '>Published — on the website<') + '</select></label>' +
          '<label class="adm-field"><span>Publish date</span><input type="date" name="date" value="' + esc((p.published_at || '').slice(0, 10) || today) + '"></label>' +
          '<div class="adm-field"><span>Cover image</span>' +
            '<div class="adm-cover" id="adm-cover"></div>' +
            '<div class="adm-cover__btns"><button class="adm-btn adm-btn--ghost adm-btn--sm" type="button" data-cover>Choose…</button><button class="adm-linkbtn" type="button" data-cover-clear>Remove</button></div>' +
          '</div>' +
          '<div class="adm-actions">' +
            '<button class="adm-btn" type="submit">Save</button>' +
            (isNew ? '' : '<button class="adm-btn adm-btn--danger adm-btn--ghost" type="button" data-delete>Delete</button>') +
          '</div>' +
          (isNew ? '' : '<p class="adm-small">Last saved ' + fmtDate(p.updated_at) + '</p>') +
        '</div>' +
        datalist('dl-cat', all.map(function (x) { return x.category; })) +
        datalist('dl-author', all.map(function (x) { return x.author; }).concat(team.map(function (x) { return x.full_name; }))) +
        '</form>';

      var form = $('form', view);
      var cover = p.cover_url || '';
      function drawCover() {
        $('#adm-cover', view).innerHTML = cover ? '<img src="' + esc(cover) + '" alt="">' : '<span>No cover image</span>';
        $('[data-cover-clear]', view).hidden = !cover;
      }
      drawCover();
      $('[data-cover]', view).addEventListener('click', function () {
        pickImage('blog').then(function (url) { if (url) { cover = url; dirty = true; drawCover(); } });
      });
      $('[data-cover-clear]', view).addEventListener('click', function () { cover = ''; dirty = true; drawCover(); });

      var q = editor($('#adm-body', view), 'Write the article. Use the H2/H3 menu for section titles.');
      if (p.body) q.clipboard.dangerouslyPasteHTML(p.body, 'silent');
      dirty = false;
      form.addEventListener('input', function (e) {
        dirty = true;
        if (e.target.name === 'slug') slugTouched = true;
        if (e.target.name === 'title' && !slugTouched) form.slug.value = slugify(form.title.value);
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!form.title.value.trim()) { toast('Give the article a title.', 'error'); form.title.focus(); return; }
        var slug = slugify(form.slug.value || form.title.value);
        form.slug.value = slug;
        var reserved = ['admin', 'atleantalks', 'open-jobs', 'jobs', 'about-us', 'employer-solutions', 'privacy-policy', 'terms-and-conditions', 'assets', 'data', 'media'];
        if (reserved.indexOf(slug) !== -1) { toast('That web address belongs to a page of the site. Choose another slug.', 'error'); return; }
        var body = editorHtml(q);
        var row = {
          title: form.title.value.trim(), slug: slug,
          category: form.category.value.trim(), author: form.author.value.trim(),
          excerpt: form.excerpt.value.trim(), body: body, cover_url: cover,
          status: form.status.value,
          published_at: form.date.value ? form.date.value + 'T09:00:00Z' : null
        };
        if (row.status === 'published' && !row.excerpt) {
          row.excerpt = q.getText().trim().replace(/\s+/g, ' ').slice(0, 220);
        }
        var btn = $('button[type=submit]', form);
        btn.disabled = true;
        var req = isNew ? sb.from('posts').insert(row).select('id').single() : sb.from('posts').update(row).eq('id', id).select('id').single();
        req.then(function (res) {
          btn.disabled = false;
          if (res.error) return toast(friendly(res.error), 'error');
          dirty = false;
          rebuild();
          if (isNew) location.hash = '#talks/' + res.data.id;
        });
      });

      var del = $('[data-delete]', form);
      if (del) del.addEventListener('click', function () {
        confirmDialog('Delete this article?', '“' + p.title + '” will be removed from the website. To only hide it, set the status to Draft instead.').then(function (ok) {
          if (!ok) return;
          sb.from('posts').delete().eq('id', id).then(function (res) {
            if (res.error) return toast(friendly(res.error), 'error');
            dirty = false;
            rebuild();
            location.hash = '#talks';
          });
        });
      });
    });
  }

  // ------------------------------------------------------------------ media library
  function publicUrl(path) { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
  function kindOf(name) {
    if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name)) return 'image';
    if (/\.(mp4|webm|mov|m4v)$/i.test(name)) return 'video';
    return 'file';
  }
  function safeName(name) {
    var dot = name.lastIndexOf('.');
    var base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
    return (slugify(base) || 'file') + ext.replace(/[^.a-z0-9]/g, '');
  }
  function listFolder(folder) {
    return sb.storage.from(BUCKET).list(folder, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } }).then(function (res) {
      if (res.error) throw res.error;
      return (res.data || []).filter(function (f) { return f.id && f.name !== '.emptyFolderPlaceholder'; }).map(function (f) {
        return { name: f.name, path: folder + '/' + f.name, size: f.metadata && f.metadata.size, created: f.created_at, kind: kindOf(f.name) };
      });
    });
  }
  function upload(folder, files) {
    return Promise.all(Array.prototype.map.call(files, function (file) {
      function attempt(n) {
        var name = safeName(file.name);
        if (n) name = name.replace(/(\.[a-z0-9]+)?$/, '-' + (n + 1) + '$1');
        return sb.storage.from(BUCKET).upload(folder + '/' + name, file, { cacheControl: '31536000', upsert: false, contentType: file.type || undefined })
          .then(function (res) {
            if (res.error && /exists|duplicate/i.test(res.error.message) && n < 20) return attempt(n + 1);
            if (res.error) throw new Error(file.name + ': ' + res.error.message);
            return publicUrl(res.data.path);
          });
      }
      return attempt(0);
    }));
  }

  function mediaGrid(container, folder, onPick) {
    container.innerHTML =
      '<div class="adm-tools">' +
        '<div class="adm-seg" role="group" aria-label="Folder">' +
          FOLDERS.map(function (f) { return '<button type="button" data-folder="' + f + '" aria-pressed="' + (f === folder) + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>'; }).join('') +
        '</div>' +
        '<label class="adm-btn adm-upload">Upload files<input type="file" multiple hidden></label>' +
      '</div>' +
      '<div class="adm-drop" hidden>Drop files to upload</div>' +
      '<p class="adm-count" aria-live="polite"></p>' +
      '<ul class="adm-media"></ul>';
    var grid = $('.adm-media', container), count = $('.adm-count', container);

    function draw() {
      count.textContent = 'Loading…';
      listFolder(folder).then(function (files) {
        if (onPick) files = files.filter(function (f) { return f.kind === 'image'; });
        count.textContent = files.length + (files.length === 1 ? ' file' : ' files') + ' in ' + folder;
        grid.innerHTML = files.length ? files.map(function (f) {
          var url = publicUrl(f.path);
          var preview = f.kind === 'image' ? '<img src="' + esc(url) + '" alt="" loading="lazy">'
            : f.kind === 'video' ? '<video src="' + esc(url) + '#t=0.5" preload="metadata" muted></video>'
            : '<span class="adm-media__icon">' + esc((f.name.split('.').pop() || 'file').toUpperCase()) + '</span>';
          return '<li class="adm-media__item" data-path="' + esc(f.path) + '" data-url="' + esc(url) + '">' +
            (onPick ? '<button type="button" class="adm-media__pick" data-pick>' + preview + '</button>' : '<a class="adm-media__preview" href="' + esc(url) + '" target="_blank" rel="noopener">' + preview + '</a>') +
            '<span class="adm-media__name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
            '<span class="adm-media__meta">' + fmtSize(f.size) + ' · ' + fmtDate(f.created) + '</span>' +
            (onPick ? '' : '<span class="adm-media__btns"><button type="button" class="adm-linkbtn" data-copy>Copy link</button><button type="button" class="adm-linkbtn adm-linkbtn--danger" data-del>Delete</button></span>') +
            '</li>';
        }).join('') : '<li class="adm-empty">This folder is empty. Upload files with the button above or drop them here.</li>';
      }).catch(function (e) { count.textContent = friendly(e); });
    }

    function doUpload(files) {
      if (!files || !files.length) return;
      toast('Uploading ' + files.length + (files.length === 1 ? ' file…' : ' files…'));
      upload(folder, files).then(function (urls) {
        toast(urls.length === 1 ? 'Uploaded.' : 'Uploaded ' + urls.length + ' files.', 'ok');
        draw();
      }).catch(function (e) { toast(friendly(e), 'error'); draw(); });
    }

    $$('[data-folder]', container).forEach(function (b) {
      b.addEventListener('click', function () {
        folder = b.dataset.folder;
        $$('[data-folder]', container).forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        draw();
      });
    });
    $('.adm-upload input', container).addEventListener('change', function (e) { doUpload(e.target.files); e.target.value = ''; });

    var drop = $('.adm-drop', container);
    container.addEventListener('dragover', function (e) { e.preventDefault(); drop.hidden = false; });
    container.addEventListener('dragleave', function (e) { if (!container.contains(e.relatedTarget)) drop.hidden = true; });
    container.addEventListener('drop', function (e) { e.preventDefault(); drop.hidden = true; doUpload(e.dataTransfer.files); });

    grid.addEventListener('click', function (e) {
      var item = e.target.closest('.adm-media__item');
      if (!item) return;
      if (e.target.closest('[data-pick]')) return onPick(item.dataset.url);
      if (e.target.closest('[data-copy]')) {
        navigator.clipboard.writeText(item.dataset.url).then(function () { toast('Link copied.', 'ok'); }, function () { window.prompt('Copy this link:', item.dataset.url); });
      }
      if (e.target.closest('[data-del]')) {
        confirmDialog('Delete this file?', 'Any page that still uses ' + item.dataset.path + ' will show a broken image or video.').then(function (ok) {
          if (!ok) return;
          sb.storage.from(BUCKET).remove([item.dataset.path]).then(function (res) {
            if (res.error) return toast(friendly(res.error), 'error');
            toast('Deleted.', 'ok');
            draw();
          });
        });
      }
    });
    draw();
  }

  function mediaView(view) {
    view.innerHTML = '<div class="adm-head"><h1>Media</h1></div><p class="adm-lead">Logos, images, videos and documents for the website. Click “Copy link” to use a file anywhere.</p><div id="adm-media-body"></div>';
    mediaGrid($('#adm-media-body', view), 'images');
  }

  function pickImage(folder) {
    var d = $('#adm-picker');
    return new Promise(function (resolve) {
      var done = false;
      function finish(url) { if (done) return; done = true; d.close(); resolve(url || null); }
      mediaGrid($('#adm-picker-body'), folder, finish);
      $('[data-close]', d).onclick = function () { finish(null); };
      d.addEventListener('close', function once() { d.removeEventListener('close', once); finish(null); });
      d.showModal();
    });
  }

  // ------------------------------------------------------------------ users
  function usersView(view) {
    view.innerHTML =
      '<div class="adm-head"><h1>Users</h1></div>' +
      '<p class="adm-lead">People sign in with their Atlean account (the same login as Atleable). Add their email here to give them access. Editors manage jobs, articles and media; admins can also add and remove people.</p>' +
      '<form class="adm-invite" novalidate>' +
        '<label class="adm-field"><span>Name</span><input name="full_name" placeholder="Maria Silva"></label>' +
        '<label class="adm-field"><span>Atlean email *</span><input name="email" type="email" required placeholder="maria@atleanworld.com"></label>' +
        '<label class="adm-field"><span>Role</span><select name="role"><option value="editor">Editor</option><option value="admin">Admin</option></select></label>' +
        '<button class="adm-btn" type="submit">Give access</button>' +
      '</form>' +
      '<ul class="adm-list adm-users"></ul>';
    var list = $('.adm-users', view);

    function draw() {
      sb.from('profiles').select('*').order('created_at').then(function (res) {
        if (res.error) { list.innerHTML = '<li class="adm-empty">' + esc(friendly(res.error)) + '</li>'; return; }
        list.innerHTML = res.data.map(function (u) {
          var self = u.id === me.id;
          return '<li class="adm-row adm-row--static" data-id="' + u.id + '">' +
            '<span class="adm-row__main"><strong>' + esc(u.full_name || u.email) + (self ? ' <small>(you)</small>' : '') + '</strong><span class="adm-row__meta">' + esc(u.email) + '</span></span>' +
            '<select class="adm-role" aria-label="Role"' + (self ? ' disabled' : '') + '>' + '<option value="editor"' + (u.role === 'editor' ? ' selected' : '') + '>Editor</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option></select>' +
            (self ? '<span></span>' : '<button type="button" class="adm-linkbtn adm-linkbtn--danger" data-remove>Remove</button>') +
            '</li>';
        }).join('');
      });
    }

    $('.adm-invite', view).addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, btn = $('button', f), email = f.email.value.trim();
      if (!email) { toast('Type their email address.', 'error'); return; }
      btn.disabled = true;
      sb.rpc('grant_access', { p_email: email, p_role: f.role.value, p_name: f.full_name.value.trim() || null }).then(function (res) {
        btn.disabled = false;
        if (res.error) return toast(friendly(res.error), 'error');
        toast(email + ' can now sign in to the admin panel.', 'ok');
        f.reset();
        draw();
      });
    });

    list.addEventListener('change', function (e) {
      if (!e.target.classList.contains('adm-role')) return;
      var id = e.target.closest('[data-id]').dataset.id;
      sb.from('profiles').update({ role: e.target.value }).eq('id', id).then(function (res) {
        toast(res.error ? friendly(res.error) : 'Role updated.', res.error ? 'error' : 'ok');
      });
    });
    list.addEventListener('click', function (e) {
      if (!e.target.closest('[data-remove]')) return;
      var li = e.target.closest('[data-id]');
      var name = $('strong', li).textContent;
      confirmDialog('Remove ' + name + '?', 'They will no longer be able to use the website admin panel. Their Atleable account is not affected.', 'Remove').then(function (ok) {
        if (!ok) return;
        sb.from('profiles').delete().eq('id', li.dataset.id).then(function (res) {
          if (res.error) return toast(friendly(res.error), 'error');
          toast(name + ' was removed.', 'ok');
          draw();
        });
      });
    });
    draw();
  }

  start();
})();
