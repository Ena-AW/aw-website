(function () {
  'use strict';

  var root = document.querySelector('.aw-home');
  if (!root) return;

  // Relative path from this page to the site root (set by build.py on <html data-root>).
  var SITE_ROOT = document.documentElement.getAttribute('data-root') || './';

  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // ==========================================================================
  // 1. Vídeo de fundo
  //    Pausa quando a pessoa pede, quando o sistema pede menos movimento ou
  //    poupança de dados, e quando o hero sai do ecrã (poupa bateria).
  // ==========================================================================
  (function initHeroVideo() {
    var hero = root.querySelector('.aw-hero');
    var video = root.querySelector('.aw-hero__video');
    var toggle = root.querySelector('.aw-hero__toggle');
    if (!hero || !video || !toggle) return;

    var choice = null;      // null = sem escolha, 'play' ou 'pause'
    var inView = true;
    var connection = navigator.connection || {};

    function systemWantsStill() { return !!(motionQuery.matches || connection.saveData); }

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
      toggle.setAttribute('aria-label', showsPlaying ? 'Pause background video' : 'Play background video');
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
      }, { threshold: 0.15 }).observe(hero);
    }
    function failed() { hero.classList.add('is-video-failed'); }
    video.addEventListener('error', failed);
    var source = video.querySelector('source');
    if (source) source.addEventListener('error', failed);

    sync();
  })();

  // ==========================================================================
  // 2. Vagas em destaque
  //    Vêm de data/spotlight-jobs.json. No passo 2 esta fonte passa a ser o
  //    Supabase (editável no painel de administração); o desenho fica igual.
  // ==========================================================================
  (function initSpotlightJobs() {
    var list = document.getElementById('aw-jobs-list');
    if (!list) return;

    var CHEVRON = '<svg class="aw-job__chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

    function safeUrl(url) {
      if (/^https?:\/\//i.test(url || '')) return url;
      if (/^[a-z0-9\-\/]+\/?(\?.*)?$/i.test(url || '')) return SITE_ROOT + url.replace(/^\//, '');
      return SITE_ROOT + 'open-jobs/';
    }

    function item(job) {
      var li = document.createElement('li');
      var a = el('a', 'aw-job');
      a.href = safeUrl(job.url);

      var lang = el('span', 'aw-job__lang', job.language);
      if (job.languageCode) lang.lang = job.languageCode;
      a.appendChild(lang);
      a.appendChild(el('h3', 'aw-job__title', job.title));

      var end = el('span', 'aw-job__end');
      end.appendChild(el('span', 'aw-job__place', job.location));
      end.insertAdjacentHTML('beforeend', CHEVRON);   // ícone fixo, nunca dados
      a.appendChild(end);

      li.appendChild(a);
      return li;
    }

    fetch(SITE_ROOT + 'data/spotlight-jobs.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (jobs) {
        if (!Array.isArray(jobs) || !jobs.length) throw new Error('No spotlight jobs');
        list.replaceChildren.apply(list, jobs.map(item));
      })
      .catch(function (error) {
        console.warn('Spotlight jobs: could not load.', error);
        var li = document.createElement('li');
        var p = el('p', 'aw-posts__msg');
        var link = el('a', 'aw-link', 'See all open jobs');
        link.href = SITE_ROOT + 'open-jobs/';
        p.appendChild(link);
        li.style.padding = '1.5rem 0';
        li.appendChild(p);
        list.replaceChildren(li);
      })
      .then(function () { list.removeAttribute('aria-busy'); });
  })();

  // ==========================================================================
  // 3. Carrossel de testemunhos
  //    O scroll é nativo (inércia, snap, teclado). Os botões só avançam um
  //    cartão e mostram quando chegaste ao início ou ao fim.
  // ==========================================================================
  (function initRail() {
    var rail = document.getElementById('aw-voices-rail');
    var prev = document.getElementById('aw-voices-prev');
    var next = document.getElementById('aw-voices-next');
    if (!rail) return;

    var queued = false;
    function gap() { return parseFloat(getComputedStyle(rail).columnGap) || 16; }
    function step() {
      var card = rail.querySelector('.aw-quote');
      return card ? card.getBoundingClientRect().width + gap() : rail.clientWidth * 0.8;
    }
    function setDisabled(button, disabled) {
      if (button) button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
    function update() {
      queued = false;
      var max = rail.scrollWidth - rail.clientWidth;
      setDisabled(prev, rail.scrollLeft <= 2);
      setDisabled(next, rail.scrollLeft >= max - 2);
    }
    function queueUpdate() {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }
    function go(direction) {
      rail.scrollBy({ left: direction * step(), behavior: motionQuery.matches ? 'auto' : 'smooth' });
    }

    if (prev) prev.addEventListener('click', function () {
      if (prev.getAttribute('aria-disabled') !== 'true') go(-1);
    });
    if (next) next.addEventListener('click', function () {
      if (next.getAttribute('aria-disabled') !== 'true') go(1);
    });
    rail.addEventListener('scroll', queueUpdate, { passive: true });
    window.addEventListener('resize', queueUpdate);
    update();
  })();

  // ==========================================================================
  // 4. Atlean Talks · artigos dinâmicos
  //    Por agora ainda vêm do WordPress (REST API, depois RSS). No passo 2
  //    passam a vir do Supabase. Os cartões são construídos com textContent,
  //    por isso um título com aspas ou "&" nunca parte o HTML.
  // ==========================================================================
  (function initPosts() {
    var grid = document.getElementById('aw-posts');
    if (!grid) return;

    var WP = 'https://atleanworld.com';
    var REST_URL = WP + '/wp-json/wp/v2/posts?per_page=3';
    var RSS_URL = WP + '/feed/?_=' + Date.now();
    var TALKS_URL = SITE_ROOT + 'atleantalks/';

    function safeUrl(url) { return /^https?:\/\//i.test(url || '') ? url : TALKS_URL; }
    function plainText(html) {
      return new DOMParser().parseFromString(html || '', 'text/html').documentElement.textContent || '';
    }
    function formatDate(date) {
      return isNaN(date) ? '' : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    // ---- REST ----
    function restImage(post) {
      try { return post.yoast_head_json.og_image[0].url || ''; } catch (e) { return ''; }
    }
    function mediaImage(id) {
      if (!id) return Promise.resolve('');
      return fetch(WP + '/wp-json/wp/v2/media/' + id)
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (media) { return media && media.source_url ? media.source_url : ''; })
        .catch(function () { return ''; });
    }
    function fromRest() {
      return fetch(REST_URL)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (posts) {
          if (!Array.isArray(posts)) throw new Error('Unexpected REST response');
          return Promise.all(posts.map(function (post) {
            var inline = restImage(post);
            return (inline ? Promise.resolve(inline) : mediaImage(post.featured_media)).then(function (imageUrl) {
              return {
                title: plainText(post.title && post.title.rendered),
                link: post.link,
                iso: post.date || '',
                date: new Date(post.date),
                imageUrl: imageUrl
              };
            });
          }));
        });
    }

    // ---- RSS ----
    function nodeText(parent, selector) {
      var node = parent.querySelector(selector);
      return node ? node.textContent : '';
    }
    function rssImage(item) {
      var enclosure = item.querySelector('enclosure[url]');
      if (enclosure && enclosure.getAttribute('url')) return enclosure.getAttribute('url');
      var media = item.getElementsByTagNameNS('*', 'content')[0];
      if (media && media.getAttribute('url')) return media.getAttribute('url');
      var encoded = item.getElementsByTagNameNS('*', 'encoded')[0];
      var html = (encoded && encoded.textContent) || nodeText(item, 'description');
      var match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      return match ? match[1] : '';
    }
    function fromRss() {
      return fetch(RSS_URL)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (text) {
          var xml = new DOMParser().parseFromString(text, 'text/xml');
          if (xml.querySelector('parsererror')) throw new Error('Invalid RSS');
          return Array.prototype.slice.call(xml.querySelectorAll('item'), 0, 3).map(function (item) {
            var published = new Date(nodeText(item, 'pubDate'));
            return {
              title: plainText(nodeText(item, 'title')),
              link: nodeText(item, 'link'),
              iso: isNaN(published) ? '' : published.toISOString(),
              date: published,
              imageUrl: rssImage(item)
            };
          });
        });
    }

    // ---- desenhar ----
    function card(post) {
      var link = el('a', 'aw-post');
      link.href = safeUrl(post.link);

      var media = el('div', 'aw-post__media');
      if (post.imageUrl && /^https?:\/\//i.test(post.imageUrl)) {
        var img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = post.imageUrl;
        media.appendChild(img);
      }
      link.appendChild(media);
      link.appendChild(el('h3', 'aw-post__title', post.title));

      var dateText = formatDate(post.date);
      if (dateText) {
        var time = el('time', 'aw-post__date', dateText);
        if (post.iso) time.setAttribute('datetime', post.iso);
        link.appendChild(time);
      }
      return link;
    }
    function show(nodes) {
      grid.replaceChildren.apply(grid, nodes);
      grid.removeAttribute('aria-busy');
    }
    function showMessage() {
      var message = el('p', 'aw-posts__msg');
      var link = el('a', 'aw-link', 'Read them on Atlean Talks');
      link.href = TALKS_URL;
      message.appendChild(document.createTextNode('We couldn’t load the latest articles right now. '));
      message.appendChild(link);
      message.appendChild(document.createTextNode('.'));
      show([message]);
    }

    fromRest()
      .catch(function (error) {
        console.warn('Atlean Talks: REST API failed, trying the RSS feed instead.', error);
        return fromRss();
      })
      .then(function (items) {
        if (!items || !items.length) return showMessage();
        show(items.map(card));
      })
      .catch(function (error) {
        console.error('Atlean Talks: REST and RSS both failed.', error);
        showMessage();
      });
  })();

})();
