// Atlean Talks list: search, category chips and pages of 9.
// The articles are already in the page (build.py writes them in); this only
// shows and hides rows. The state lives in the URL (?q=, ?category=, ?page=),
// so a filtered list can be shared and the back button works.
(function () {
  'use strict';

  var PER_PAGE = 9;
  var rows = Array.prototype.slice.call(document.querySelectorAll('#aw-trows .aw-talk'));
  var input = document.getElementById('aw-tq');
  var chips = Array.prototype.slice.call(document.querySelectorAll('#aw-chips .aw-chip'));
  var count = document.getElementById('aw-tcount');
  var empty = document.getElementById('aw-tempty');
  var pager = document.getElementById('aw-pager');
  if (!rows.length || !input) return;

  // Search text for each row, without accents, so "cafe" finds "café".
  function fold(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  rows.forEach(function (row) { row._text = fold(row.textContent); });

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('category') || '',
    page: Math.max(1, parseInt(params.get('page'), 10) || 1)
  };
  if (!chips.some(function (c) { return c.dataset.cat === state.cat; })) state.cat = '';
  input.value = state.q;

  function saveUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('category', state.cat);
    if (state.page > 1) p.set('page', state.page);
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  function render(scroll) {
    var words = fold(state.q).split(/\s+/).filter(Boolean);
    var matches = rows.filter(function (row) {
      if (state.cat && row.dataset.cat !== state.cat) return false;
      return words.every(function (w) { return row._text.indexOf(w) !== -1; });
    });
    var pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PER_PAGE;
    var shown = matches.slice(start, start + PER_PAGE);

    rows.forEach(function (row) { row.hidden = shown.indexOf(row) === -1; });
    chips.forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.cat === state.cat ? 'true' : 'false'); });

    var filtered = words.length || state.cat;
    count.textContent = filtered
      ? matches.length + (matches.length === 1 ? ' article' : ' articles')
      : rows.length + ' articles';
    empty.hidden = matches.length > 0;
    renderPager(pages);
    saveUrl();

    if (scroll) {
      var top = input.closest('form').getBoundingClientRect().top + window.scrollY - 24;
      if (window.awLenis) window.awLenis.scrollTo(top); else window.scrollTo({ top: top, behavior: 'smooth' });
    }
  }

  function button(label, page, opts) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.page = page;
    if (opts && opts.aria) b.setAttribute('aria-label', opts.aria);
    if (opts && opts.current) b.setAttribute('aria-current', 'page');
    if (opts && opts.disabled) b.disabled = true;
    return b;
  }

  function renderPager(pages) {
    pager.textContent = '';
    pager.hidden = pages < 2;
    if (pages < 2) return;
    pager.appendChild(button('‹', state.page - 1, { aria: 'Previous page', disabled: state.page === 1 }));
    for (var i = 1; i <= pages; i++) {
      pager.appendChild(button(String(i), i, { aria: 'Page ' + i, current: i === state.page }));
    }
    pager.appendChild(button('›', state.page + 1, { aria: 'Next page', disabled: state.page === pages }));
  }

  pager.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    state.page = parseInt(b.dataset.page, 10);
    render(true);
  });

  var timer;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      state.q = input.value.trim();
      state.page = 1;
      render(false);
    }, 120);
  });

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      state.cat = chip.dataset.cat;
      state.page = 1;
      render(false);
    });
  });

  render(false);
})();
