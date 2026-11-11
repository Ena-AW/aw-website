// Admin panel · Social media planner.
// Plan, write and schedule posts, carousels, reels and stories for Instagram,
// Facebook and LinkedIn in one place. Posts are stored in website.social_posts;
// a publishing job (Edge Function on a schedule, added once the Meta and
// LinkedIn apps are approved) sends each one out at its time and writes the
// result back. Until then everything here works except the actual sending.
(function () {
  'use strict';

  var A = window.AWAdmin;
  if (!A) return;
  var sb = A.sb, $ = A.$, $$ = A.$$, esc = A.esc;

  var TZ = 'Europe/Lisbon';
  var NETS = {
    instagram: { name: 'Instagram', limit: 2200, tags: 30, formats: ['post', 'carousel', 'reel', 'story'] },
    facebook:  { name: 'Facebook',  limit: 63206,          formats: ['post', 'carousel', 'reel', 'story'] },
    linkedin:  { name: 'LinkedIn',  limit: 3000,           formats: ['post', 'carousel', 'reel'] }
  };
  var ORDER = ['instagram', 'facebook', 'linkedin'];
  var FORMATS = {
    post:     { name: 'Post',     hint: 'One photo or video with a caption. Facebook and LinkedIn can also post text only.' },
    carousel: { name: 'Carousel', hint: '2 to 10 photos or videos people swipe through.' },
    reel:     { name: 'Reel',     hint: 'One vertical video (9:16), up to 90 seconds. On LinkedIn it goes out as a video post.' },
    story:    { name: 'Story',    hint: 'One vertical photo or video (9:16). Disappears after 24 hours. Stories have no caption. Not available on LinkedIn.' }
  };
  var STATUS = {
    draft: 'Draft', scheduled: 'Scheduled', publishing: 'Publishing', published: 'Published', failed: 'Failed'
  };

  var ICON = {
    instagram: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M14 8h3V4h-3c-2.8 0-5 2.2-5 5v2H7v4h2v7h4v-7h3l1-4h-4V9c0-.6.4-1 1-1z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.5h4V21H3zM9.5 9.5h3.8v1.6h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6V21h-4v-5.1c0-1.2 0-2.8-1.7-2.8s-2 1.3-2 2.7V21h-4z"/></svg>'
  };
  function netIcons(list) {
    return '<span class="soc-nets">' + (list || []).map(function (n) {
      return '<span class="soc-net soc-net--' + n + '" title="' + esc(NETS[n] ? NETS[n].name : n) + '">' + (ICON[n] || '') + '</span>';
    }).join('') + '</span>';
  }

  // ---- time helpers (everything shown and typed in Lisbon time) ----
  function parts(date) {
    var f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var o = {};
    f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function dayKey(date) { var p = parts(date); return p.year + '-' + p.month + '-' + p.day; }
  function timeOf(date) { var p = parts(date); return p.hour + ':' + p.minute; }
  // "2026-11-20" + "10:30" in Lisbon -> Date
  function fromLisbon(day, time) {
    var guess = new Date(day + 'T' + (time || '10:00') + ':00Z');
    var p = parts(guess);
    var shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    return new Date(guess.getTime() - (shown - guess.getTime()));
  }
  function niceWhen(iso) {
    if (!iso) return 'Not scheduled';
    var d = new Date(iso);
    return d.toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function firstMedia(p) { return (p.media || [])[0]; }
  function thumb(m, cls) {
    if (!m) return '<span class="' + (cls || 'soc-thumb') + ' soc-thumb--empty">Aa</span>';
    return m.kind === 'video'
      ? '<video class="' + (cls || 'soc-thumb') + '" src="' + esc(m.url) + '#t=0.5" preload="metadata" muted playsinline></video>'
      : '<img class="' + (cls || 'soc-thumb') + '" src="' + esc(m.url) + '" alt="" loading="lazy">';
  }
  function pill(status) { return '<span class="adm-pill adm-pill--' + status + '">' + esc(STATUS[status] || status) + '</span>'; }
  function label(p) { return p.title || (p.caption || '').split('\n')[0].slice(0, 80) || FORMATS[p.format].name + ' without a caption'; }

  // ------------------------------------------------------------------ shell with sub-tabs
  function socialView(view) {
    var sub = location.hash.split('/')[1] || (window.matchMedia('(max-width: 40rem)').matches ? 'list' : 'calendar');
    if (sub === 'post') return composer(view, decodeURIComponent(location.hash.split('/')[2] || 'new'));
    view.innerHTML =
      '<div class="adm-head"><h1>Social media</h1><a class="adm-btn" href="#social/post/new">New post</a></div>' +
      '<nav class="adm-seg adm-seg--nav" aria-label="Social media views">' +
        [['calendar', 'Calendar'], ['list', 'List'], ['accounts', 'Accounts']].map(function (t) {
          return '<a href="#social/' + t[0] + '"' + (t[0] === sub ? ' aria-current="page"' : '') + '>' + t[1] + '</a>';
        }).join('') +
      '</nav>' +
      '<div data-sub></div>';
    var body = $('[data-sub]', view);
    if (sub === 'accounts') return accounts(body);
    if (sub === 'list') return list(body);
    return calendar(body);
  }

  // ------------------------------------------------------------------ calendar
  var month = null;   // { y, m } shown in the calendar
  function calendar(body) {
    if (!month) { var t = parts(new Date()); month = { y: +t.year, m: +t.month }; }
    var first = new Date(Date.UTC(month.y, month.m - 1, 1));
    var start = new Date(first); start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));   // Monday before the 1st
    var days = [];
    for (var i = 0; i < 42; i++) { var d = new Date(start); d.setUTCDate(start.getUTCDate() + i); days.push(d); }
    var from = fromLisbon(days[0].toISOString().slice(0, 10), '00:00');
    var to = fromLisbon(days[41].toISOString().slice(0, 10), '23:59');
    var today = dayKey(new Date());
    var title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    body.innerHTML =
      '<div class="soc-cal__bar">' +
        '<h2 class="soc-cal__title">' + esc(title) + '</h2>' +
        '<div class="soc-cal__nav">' +
          '<button type="button" class="adm-icon" data-step="-1" aria-label="Previous month">‹</button>' +
          '<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-today>Today</button>' +
          '<button type="button" class="adm-icon" data-step="1" aria-label="Next month">›</button>' +
        '</div>' +
      '</div>' +
      '<div class="soc-cal" role="grid" aria-label="' + esc(title) + '">' +
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<div class="soc-cal__dow" role="columnheader">' + d + '</div>'; }).join('') +
        days.map(function (d) {
          var key = d.toISOString().slice(0, 10);
          var cls = 'soc-day' + (d.getUTCMonth() !== month.m - 1 ? ' is-out' : '') + (key === today ? ' is-today' : '') + (key < today ? ' is-past' : '');
          return '<div class="' + cls + '" role="gridcell" data-day="' + key + '">' +
            '<span class="soc-day__n">' + d.getUTCDate() + '</span>' +
            '<div class="soc-day__posts"></div>' +
            (key >= today ? '<a class="soc-day__add" href="#social/post/new?day=' + key + '" aria-label="New post on ' + key + '">+</a>' : '') +
          '</div>';
        }).join('') +
      '</div>' +
      '<p class="adm-small soc-cal__drafts" data-drafts></p>';

    $$('[data-step]', body).forEach(function (b) {
      b.addEventListener('click', function () {
        month.m += Number(b.dataset.step);
        if (month.m < 1) { month.m = 12; month.y--; }
        if (month.m > 12) { month.m = 1; month.y++; }
        calendar(body);
      });
    });
    $('[data-today]', body).addEventListener('click', function () { month = null; calendar(body); });

    Promise.all([
      sb.from('social_posts').select('id,title,caption,format,platforms,media,scheduled_at,status').gte('scheduled_at', from.toISOString()).lte('scheduled_at', to.toISOString()).order('scheduled_at'),
      sb.from('social_posts').select('id', { count: 'exact', head: true }).is('scheduled_at', null)
    ]).then(function (r) {
      if (r[0].error) { A.toast(A.friendly(r[0].error), 'error'); return; }
      (r[0].data || []).forEach(function (p) {
        var cell = $('[data-day="' + dayKey(new Date(p.scheduled_at)) + '"] .soc-day__posts', body);
        if (!cell) return;
        cell.insertAdjacentHTML('beforeend',
          '<a class="soc-chip soc-chip--' + p.status + '" href="#social/post/' + p.id + '" title="' + esc(label(p)) + '">' +
            '<span class="soc-chip__time">' + timeOf(new Date(p.scheduled_at)) + '</span>' + netIcons(p.platforms) +
            '<span class="soc-chip__text">' + esc(label(p)) + '</span></a>');
      });
      var n = r[1].count || 0;
      $('[data-drafts]', body).innerHTML = n ? n + (n === 1 ? ' draft has' : ' drafts have') + ' no date yet. <a href="#social/list">See them in the list</a>.' : '';
    });
  }

  // ------------------------------------------------------------------ list
  var listFilter = 'upcoming';
  function list(body) {
    var filters = [['upcoming', 'Upcoming'], ['draft', 'Drafts'], ['published', 'Published'], ['failed', 'Failed'], ['all', 'All']];
    body.innerHTML =
      '<div class="adm-tools"><div class="adm-seg" role="group" aria-label="Show">' +
        filters.map(function (f) { return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (f[0] === listFilter) + '">' + f[1] + '</button>'; }).join('') +
      '</div></div>' +
      '<ul class="adm-list soc-list"><li class="adm-empty">Loading…</li></ul>';
    $$('[data-f]', body).forEach(function (b) {
      b.addEventListener('click', function () { listFilter = b.dataset.f; list(body); });
    });

    var q = sb.from('social_posts').select('id,title,caption,format,platforms,media,scheduled_at,status,updated_at');
    if (listFilter === 'upcoming') q = q.in('status', ['scheduled', 'publishing']).order('scheduled_at');
    else if (listFilter === 'all') q = q.order('updated_at', { ascending: false });
    else q = q.eq('status', listFilter).order(listFilter === 'draft' ? 'updated_at' : 'scheduled_at', { ascending: false });
    q.limit(200).then(function (res) {
      var ul = $('.soc-list', body);
      if (res.error) { ul.innerHTML = '<li class="adm-empty">' + esc(A.friendly(res.error)) + '</li>'; return; }
      var rows = res.data || [];
      ul.innerHTML = rows.length ? rows.map(function (p) {
        return '<li><a class="adm-row soc-row" href="#social/post/' + p.id + '">' +
          thumb(firstMedia(p)) +
          '<span class="adm-row__main"><strong>' + esc(label(p)) + '</strong>' +
            '<span class="adm-row__meta">' + netIcons(p.platforms) + ' ' + esc(FORMATS[p.format].name) + ' · ' + esc(niceWhen(p.scheduled_at)) + '</span></span>' +
          pill(p.status) + '</a></li>';
      }).join('') : '<li class="adm-empty">' + ({ upcoming: 'Nothing scheduled. Click “New post” to plan one.', draft: 'No drafts.', published: 'Nothing published from here yet.', failed: 'No failed posts.', all: 'No posts yet.' })[listFilter] + '</li>';
    });
  }

  // ------------------------------------------------------------------ accounts
  function accounts(body) {
    var isAdmin = A.me().role === 'admin';
    body.innerHTML = '<div class="soc-accounts"></div><p class="adm-small soc-accounts__note">Connecting needs the Atlean World apps approved by Meta and LinkedIn first. Until then, plan and schedule as normal: everything is kept and will go out once connected.</p>';
    sb.from('social_accounts').select('*').then(function (res) {
      var rows = res.data || [];
      $('.soc-accounts', body).innerHTML = ORDER.map(function (n) {
        var acc = rows.filter(function (a) { return a.platform === n; })[0];
        var on = acc && acc.status === 'connected';
        var desc = n === 'instagram' ? 'Instagram professional (business) account linked to the Facebook Page.'
          : n === 'facebook' ? 'The Atlean World Facebook Page, through Meta Business.'
          : 'The Atlean World LinkedIn company page.';
        return '<section class="adm-card soc-acc">' +
          '<span class="soc-net soc-net--' + n + ' soc-net--lg">' + ICON[n] + '</span>' +
          '<div class="soc-acc__main"><h2>' + NETS[n].name + '</h2>' +
            '<p class="adm-small">' + (on ? 'Connected as <strong>' + esc(acc.name || acc.handle) + '</strong>' : desc) + '</p></div>' +
          (on ? '<span class="adm-pill adm-pill--published">Connected</span>'
              : acc && acc.status === 'expired' ? '<span class="adm-pill adm-pill--closed">Needs reconnecting</span>'
              : '<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-connect="' + n + '"' + (isAdmin ? '' : ' disabled title="Only admins can connect accounts"') + '>Connect</button>') +
        '</section>';
      }).join('');
      $$('[data-connect]', body).forEach(function (b) {
        b.addEventListener('click', function () {
          A.toast('Connecting ' + NETS[b.dataset.connect].name + ' is being set up. Posts you schedule now are kept and go out once it is connected.');
        });
      });
    });
  }

  // ------------------------------------------------------------------ composer
  function composer(view, id) {
    var isNew = id.indexOf('new') === 0;
    var presetDay = (id.match(/day=(\d{4}-\d{2}-\d{2})/) || [])[1];
    var load = isNew
      ? Promise.resolve({ data: { title: '', format: 'post', platforms: ['instagram', 'facebook', 'linkedin'], caption: '', overrides: {}, media: [], link_url: '', scheduled_at: presetDay ? fromLisbon(presetDay, '10:00').toISOString() : null, status: 'draft', results: {} } })
      : sb.from('social_posts').select('*').eq('id', id).single();

    load.then(function (res) {
      if (res.error) { view.innerHTML = '<p class="adm-empty">' + esc(A.friendly(res.error)) + '</p>'; return; }
      var p = res.data;
      var st = {
        format: p.format, platforms: p.platforms.slice(), media: (p.media || []).slice(),
        overrides: JSON.parse(JSON.stringify(p.overrides || {})), preview: null
      };
      var locked = p.status === 'published' || p.status === 'publishing';
      var when = p.scheduled_at ? new Date(p.scheduled_at) : null;

      view.innerHTML =
        '<form class="adm-edit soc-edit" novalidate>' +
        '<div class="adm-head"><a class="adm-back" href="#social">‹ Social media</a><h1>' + (isNew ? 'New post' : esc(label(p))) + '</h1>' + (isNew ? '' : pill(p.status)) + '</div>' +
        (locked ? '<p class="adm-note">This post has already gone out. Changes here won’t update it on the networks. Use “Duplicate” to post it again.</p>' : '') +
        resultsHtml(p) +
        '<div class="soc-main">' +
          '<section class="adm-card">' +
            '<label class="adm-field"><span>Name <small>(only the team sees it)</small></span><input name="title" value="' + esc(p.title) + '" placeholder="e.g. Lisbon German jobs — week 47"></label>' +
            '<div class="adm-field"><span>Where</span><div class="soc-pick" data-nets>' +
              ORDER.map(function (n) {
                return '<button type="button" class="soc-toggle" data-net="' + n + '" aria-pressed="' + (st.platforms.indexOf(n) !== -1) + '">' +
                  '<span class="soc-net soc-net--' + n + '">' + ICON[n] + '</span>' + NETS[n].name + '</button>';
              }).join('') +
            '</div></div>' +
            '<div class="adm-field"><span>Type</span><div class="adm-seg soc-formats" role="group" aria-label="Type">' +
              Object.keys(FORMATS).map(function (f) { return '<button type="button" data-format="' + f + '" aria-pressed="' + (f === st.format) + '">' + FORMATS[f].name + '</button>'; }).join('') +
            '</div><small data-format-hint></small></div>' +
          '</section>' +

          '<section class="adm-card">' +
            '<div class="adm-card__head"><h2>Photos and videos</h2>' +
              '<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-add-media>Add from media library</button></div>' +
            '<ul class="soc-media" data-media></ul>' +
          '</section>' +

          '<section class="adm-card" data-caption-card>' +
            '<label class="adm-field"><span>Caption</span><textarea name="caption" rows="7" placeholder="Write the caption. #hashtags and @mentions work as usual.">' + esc(p.caption) + '</textarea></label>' +
            '<div class="soc-counts" data-counts></div>' +
            '<label class="adm-field" data-link-field><span>Link <small>(Facebook and LinkedIn show a preview card; Instagram ignores links in captions)</small></span><input name="link_url" type="url" placeholder="https://atleanworld.com/jobs/…" value="' + esc(p.link_url) + '"></label>' +
            '<details class="soc-custom"' + (Object.keys(st.overrides).length ? ' open' : '') + '><summary>Customise for each network</summary><div data-overrides></div></details>' +
          '</section>' +
        '</div>' +

        '<aside class="adm-side soc-side">' +
          '<div class="adm-field"><span>When</span>' +
            '<div class="adm-seg soc-when" role="group" aria-label="When">' +
              '<button type="button" data-when="draft" aria-pressed="' + (p.status === 'draft' || p.status === 'failed') + '">Draft</button>' +
              '<button type="button" data-when="schedule" aria-pressed="' + (p.status === 'scheduled' || p.status === 'publishing' || p.status === 'published') + '">Schedule</button>' +
            '</div></div>' +
          '<div class="soc-datetime" data-datetime>' +
            '<label class="adm-field"><span>Date</span><input type="date" name="day" value="' + (when ? dayKey(when) : (presetDay || '')) + '"></label>' +
            '<label class="adm-field"><span>Time <small>(Lisbon)</small></span><input type="time" name="time" step="300" value="' + (when ? timeOf(when) : '10:00') + '"></label>' +
          '</div>' +
          '<ul class="soc-checks" data-checks></ul>' +
          '<div class="adm-actions">' +
            '<button class="adm-btn" type="submit"' + (locked ? ' disabled' : '') + '>Save</button>' +
            (isNew ? '' : '<button class="adm-btn adm-btn--ghost" type="button" data-duplicate>Duplicate</button>') +
            (isNew ? '' : '<button class="adm-btn adm-btn--danger adm-btn--ghost" type="button" data-delete>Delete</button>') +
          '</div>' +
          '<div class="soc-preview"><div class="adm-seg soc-preview__tabs" data-preview-tabs></div><div data-preview></div></div>' +
        '</aside>' +
        '</form>';

      var form = $('form', view);

      // ---------- drawing ----------
      function allowed(net) { return NETS[net].formats.indexOf(st.format) !== -1; }
      function nets() { return st.platforms.filter(allowed); }

      function drawNets() {
        $$('[data-net]', form).forEach(function (b) {
          var n = b.dataset.net, ok = allowed(n);
          b.setAttribute('aria-pressed', st.platforms.indexOf(n) !== -1 && ok);
          b.disabled = !ok || locked;
          b.title = ok ? '' : NETS[n].name + ' has no ' + FORMATS[st.format].name.toLowerCase() + 's';
        });
        $$('[data-format]', form).forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.format === st.format); b.disabled = locked; });
        $('[data-format-hint]', form).textContent = FORMATS[st.format].hint;
        var story = st.format === 'story';
        $('[data-caption-card]', form).hidden = story;
      }

      function drawMedia() {
        var ul = $('[data-media]', form);
        ul.innerHTML = st.media.map(function (m, i) {
          return '<li class="soc-media__item">' + thumb(m, 'soc-media__img') +
            '<span class="soc-media__n">' + (i + 1) + '</span>' +
            '<input class="soc-media__alt" placeholder="Describe it (alt text)" aria-label="Description of file ' + (i + 1) + '" data-alt="' + i + '" value="' + esc(m.alt || '') + '">' +
            '<span class="soc-media__btns">' +
              '<button type="button" class="adm-icon" data-left="' + i + '" aria-label="Move earlier"' + (i === 0 ? ' disabled' : '') + '>‹</button>' +
              '<button type="button" class="adm-icon" data-right="' + i + '" aria-label="Move later"' + (i === st.media.length - 1 ? ' disabled' : '') + '>›</button>' +
              '<button type="button" class="adm-icon adm-icon--danger" data-drop="' + i + '" aria-label="Remove">✕</button>' +
            '</span></li>';
        }).join('') || '<li class="adm-empty soc-media__empty">No photos or videos yet.</li>';
      }

      function captionFor(n) {
        var o = st.overrides[n];
        return o && o.caption != null && o.caption !== '' ? o.caption : form.caption.value;
      }
      function hashtags(text) { return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length; }

      function drawCounts() {
        $('[data-counts]', form).innerHTML = nets().map(function (n) {
          var text = captionFor(n), len = [...text].length, over = len > NETS[n].limit;
          var tags = NETS[n].tags ? hashtags(text) : null;
          return '<span class="soc-count' + (over || (tags != null && tags > NETS[n].tags) ? ' is-over' : '') + '">' +
            '<span class="soc-net soc-net--' + n + '">' + ICON[n] + '</span>' + len.toLocaleString('en-GB') + ' / ' + NETS[n].limit.toLocaleString('en-GB') +
            (tags != null ? ' · ' + tags + ' / ' + NETS[n].tags + ' #' : '') + '</span>';
        }).join('');
      }

      function drawOverrides() {
        var box = $('[data-overrides]', form);
        box.innerHTML = nets().map(function (n) {
          var o = st.overrides[n] || {};
          return '<div class="soc-ov">' +
            '<h3><span class="soc-net soc-net--' + n + '">' + ICON[n] + '</span>' + NETS[n].name + '</h3>' +
            '<label class="adm-field"><span>Caption for ' + NETS[n].name + ' <small>(empty = same as above)</small></span><textarea rows="4" data-ov="' + n + '" data-key="caption">' + esc(o.caption || '') + '</textarea></label>' +
            (n === 'instagram' ? '<label class="adm-field"><span>First comment <small>(good place for hashtags)</small></span><textarea rows="2" data-ov="instagram" data-key="first_comment">' + esc(o.first_comment || '') + '</textarea></label>' : '') +
          '</div>';
        }).join('') || '<p class="adm-small">Choose at least one network.</p>';
      }

      // what would stop this post from going out, per network
      function problems() {
        var out = [], m = st.media, videos = m.filter(function (x) { return x.kind === 'video'; }).length;
        if (!nets().length) out.push('Choose at least one network.');
        if (st.format === 'carousel' && (m.length < 2 || m.length > 10)) out.push('A carousel needs 2 to 10 photos or videos (now ' + m.length + ').');
        if ((st.format === 'reel') && !(m.length === 1 && videos === 1)) out.push('A reel needs exactly one video.');
        if (st.format === 'story' && m.length !== 1) out.push('A story needs exactly one photo or video.');
        if (st.format === 'post' && m.length > 1) out.push('A post takes one photo or video. Switch to Carousel for more.');
        if (st.format === 'post' && !m.length && nets().indexOf('instagram') !== -1) out.push('Instagram needs a photo or video.');
        if (st.format !== 'story') nets().forEach(function (n) {
          var text = captionFor(n);
          if ([...text].length > NETS[n].limit) out.push(NETS[n].name + ': caption is too long.');
          if (NETS[n].tags && hashtags(text) > NETS[n].tags) out.push('Instagram allows up to 30 hashtags.');
          if (!text.trim() && !m.length) out.push(NETS[n].name + ': add a caption or a photo.');
        });
        return out;
      }
      function scheduling() { var b = $('[data-when][aria-pressed="true"]', form); return b && b.dataset.when === 'schedule'; }

      function drawChecks() {
        var list = problems();
        var sched = scheduling();
        $('[data-datetime]', form).hidden = !sched;
        if (sched && form.day.value) {
          var t = fromLisbon(form.day.value, form.time.value);
          if (t < new Date(Date.now() - 60000) && !locked) list.push('That time has passed. Pick a time in the future.');
        } else if (sched) list.push('Pick a date.');
        $('[data-checks]', form).innerHTML = list.length
          ? list.map(function (t) { return '<li class="is-bad">' + esc(t) + '</li>'; }).join('')
          : '<li class="is-ok">' + (sched ? 'Ready to go out ' + esc(niceWhen(fromLisbon(form.day.value, form.time.value).toISOString())) + '.' : 'Saved as a draft: it won’t go out until you schedule it.') + '</li>';
        var save = $('button[type=submit]', form);
        if (!locked) save.textContent = sched ? 'Schedule' : 'Save draft';
      }

      function drawPreview() {
        var ns = nets();
        if (ns.indexOf(st.preview) === -1) st.preview = ns[0] || null;
        $('[data-preview-tabs]', form).innerHTML = ns.map(function (n) {
          return '<button type="button" data-pv="' + n + '" aria-pressed="' + (n === st.preview) + '">' + NETS[n].name + '</button>';
        }).join('');
        var box = $('[data-preview]', form);
        if (!st.preview) { box.innerHTML = ''; return; }
        var n = st.preview, m = st.media[0], text = st.format === 'story' ? '' : captionFor(n);
        var tall = st.format === 'story' || st.format === 'reel';
        var media = m ? (m.kind === 'video'
            ? '<video src="' + esc(m.url) + '#t=0.5" muted playsinline preload="metadata"></video>'
            : '<img src="' + esc(m.url) + '" alt="">') : '';
        var dots = st.media.length > 1 ? '<span class="pv-dots">' + st.media.map(function (_, i) { return '<i' + (i === 0 ? ' class="on"' : '') + '></i>'; }).join('') + '</span>' : '';
        var name = n === 'instagram' ? 'atleanworld' : 'Atlean World';
        box.innerHTML =
          '<div class="pv pv--' + n + (tall ? ' pv--tall' : '') + '">' +
            '<div class="pv__head"><span class="pv__avatar"><img src="' + esc(A.SITE + 'media/brand/favicon.png') + '" alt=""></span><span><b>' + name + '</b>' + (n === 'linkedin' ? '<small>Recruitment · Promoted by you</small>' : '') + '</span></div>' +
            (n !== 'instagram' && text ? '<p class="pv__text">' + esc(text) + '</p>' : '') +
            (media ? '<div class="pv__media">' + media + dots + '</div>' : (n === 'instagram' ? '<div class="pv__media pv__media--empty">Add a photo or video</div>' : '')) +
            (n === 'instagram' && text ? '<p class="pv__text"><b>' + name + '</b> ' + esc(text) + '</p>' : '') +
          '</div>';
      }

      function drawAll() { drawNets(); drawMedia(); drawCounts(); drawOverrides(); drawChecks(); drawPreview(); }

      // ---------- events ----------
      form.addEventListener('click', function (e) {
        var t = e.target.closest('button');
        if (!t || t.type === 'submit') return;
        if (t.dataset.net) {
          var n = t.dataset.net, at = st.platforms.indexOf(n);
          if (at === -1) st.platforms.push(n); else st.platforms.splice(at, 1);
          st.platforms.sort(function (a, b) { return ORDER.indexOf(a) - ORDER.indexOf(b); });
        } else if (t.dataset.format) {
          st.format = t.dataset.format;
        } else if (t.dataset.when) {
          $$('[data-when]', form).forEach(function (b) { b.setAttribute('aria-pressed', b === t); });
          if (t.dataset.when === 'schedule' && !form.day.value) form.day.value = dayKey(new Date(Date.now() + 86400000));
        } else if (t.dataset.pv) {
          st.preview = t.dataset.pv; drawPreview(); return;
        } else if (t.hasAttribute('data-add-media')) {
          A.pickMedia({ title: 'Add photos and videos', folder: 'social', kinds: ['image', 'video'], multiple: true }).then(function (files) {
            if (!files.length) return;
            st.media = st.media.concat(files.map(function (f) { return { url: f.url, kind: f.kind, alt: '' }; })).slice(0, 10);
            A.setDirty(true); drawAll();
          });
          return;
        } else if (t.dataset.left != null) { var i = +t.dataset.left; st.media.splice(i - 1, 0, st.media.splice(i, 1)[0]); }
        else if (t.dataset.right != null) { var j = +t.dataset.right; st.media.splice(j + 1, 0, st.media.splice(j, 1)[0]); }
        else if (t.dataset.drop != null) { st.media.splice(+t.dataset.drop, 1); }
        else return;
        A.setDirty(true);
        drawAll();
      });
      form.addEventListener('input', function (e) {
        A.setDirty(true);
        var t = e.target;
        if (t.dataset.alt != null) { st.media[+t.dataset.alt].alt = t.value; return; }
        if (t.dataset.ov) {
          var o = st.overrides[t.dataset.ov] = st.overrides[t.dataset.ov] || {};
          if (t.value) o[t.dataset.key] = t.value; else delete o[t.dataset.key];
          if (!Object.keys(o).length) delete st.overrides[t.dataset.ov];
        }
        drawCounts(); drawChecks(); drawPreview();
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (locked) return;
        var sched = scheduling();
        var list = problems();
        if (sched && form.day.value && fromLisbon(form.day.value, form.time.value) < new Date(Date.now() - 60000)) list.push('past');
        if (sched && !form.day.value) list.push('no date');
        if (sched && list.length) { A.toast('Fix the points under “When” before scheduling, or save it as a draft.', 'error'); return; }
        var row = {
          title: form.title.value.trim(), format: st.format, platforms: nets(),
          caption: st.format === 'story' ? '' : form.caption.value, overrides: st.overrides, media: st.media,
          link_url: form.link_url.value.trim(),
          scheduled_at: form.day.value ? fromLisbon(form.day.value, form.time.value).toISOString() : null,
          status: sched ? 'scheduled' : 'draft'
        };
        if (isNew) row.created_by = A.me().id;
        var btn = $('button[type=submit]', form);
        A.busy(btn, true);
        (isNew ? sb.from('social_posts').insert(row).select('id').single() : sb.from('social_posts').update(row).eq('id', id).select('id').single())
          .then(function (res) {
            A.busy(btn, false);
            drawChecks();
            if (res.error) return A.toast(A.friendly(res.error), 'error');
            A.setDirty(false);
            A.toast(sched ? 'Scheduled for ' + niceWhen(row.scheduled_at) + '.' : 'Draft saved.', 'ok');
            location.hash = sched ? '#social/calendar' : '#social/list';
          });
      });

      var dup = $('[data-duplicate]', form);
      if (dup) dup.addEventListener('click', function () {
        var copy = { title: (p.title ? p.title + ' (copy)' : ''), format: st.format, platforms: nets(), caption: form.caption.value, overrides: st.overrides, media: st.media, link_url: form.link_url.value.trim(), status: 'draft', created_by: A.me().id };
        sb.from('social_posts').insert(copy).select('id').single().then(function (res) {
          if (res.error) return A.toast(A.friendly(res.error), 'error');
          A.setDirty(false);
          A.toast('Copied as a new draft.', 'ok');
          location.hash = '#social/post/' + res.data.id;
        });
      });
      var del = $('[data-delete]', form);
      if (del) del.addEventListener('click', function () {
        A.confirmDialog('Delete this post?', locked ? 'It is removed from the planner only. It stays on the networks.' : 'It won’t go out and is removed from the planner.').then(function (ok) {
          if (!ok) return;
          sb.from('social_posts').delete().eq('id', id).then(function (r) {
            if (r.error) return A.toast(A.friendly(r.error), 'error');
            A.setDirty(false);
            location.hash = '#social';
          });
        });
      });

      drawAll();
      A.setDirty(false);
    });
  }

  function resultsHtml(p) {
    var r = p.results || {};
    var keys = Object.keys(r);
    if (!keys.length) return '';
    return '<ul class="soc-results">' + keys.map(function (n) {
      var x = r[n] || {};
      return '<li class="' + (x.error ? 'is-bad' : 'is-ok') + '"><span class="soc-net soc-net--' + n + '">' + (ICON[n] || '') + '</span>' +
        (x.error ? esc(NETS[n] ? NETS[n].name : n) + ': ' + esc(x.error)
                 : (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">See it on ' + esc(NETS[n] ? NETS[n].name : n) + ' ↗</a>' : 'Published')) +
      '</li>';
    }).join('') + '</ul>';
  }

  A.views.social = function () { return socialView; };
})();
