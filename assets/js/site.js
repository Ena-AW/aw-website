// Shared behaviour for every page: the mobile menu.
(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var button = header && header.querySelector('.site-menu-btn');
  var nav = header && header.querySelector('.site-nav');
  if (!button || !nav) return;

  function setOpen(open) {
    header.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.querySelector('.site-vh').textContent = open ? 'Close menu' : 'Menu';
  }

  // Respond on press, not on release: the menu answers as soon as the finger lands.
  button.addEventListener('click', function () {
    setOpen(button.getAttribute('aria-expanded') !== 'true');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && header.classList.contains('is-open')) {
      setOpen(false);
      button.focus();
    }
  });
  document.addEventListener('click', function (e) {
    if (header.classList.contains('is-open') && !header.contains(e.target)) setOpen(false);
  });
  // Close when the layout goes back to desktop, so the menu never gets stuck open.
  var desktop = window.matchMedia('(min-width: 62rem)');
  var onChange = function () { if (desktop.matches) setOpen(false); };
  if (desktop.addEventListener) desktop.addEventListener('change', onChange);
})();

// Smooth scrolling for mouse wheels and trackpads (Lenis, in assets/vendor/lenis).
// Touch screens keep their native scrolling, and nothing changes for people who
// ask the system for less motion. Loaded after the page so it never delays it.
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarse = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)');
  if (!window.requestAnimationFrame || (reduce && reduce.matches) || (coarse && coarse.matches)) return;

  var root = document.documentElement.getAttribute('data-root') || './';
  var script = document.createElement('script');
  script.src = root + 'assets/vendor/lenis/lenis.min.js';
  script.async = true;
  script.onload = function () {
    if (!window.Lenis) return;
    var lenis = new window.Lenis({
      lerp: 0.12,              // how quickly the page catches up with the wheel (higher = snappier)
      wheelMultiplier: 1,
      autoRaf: true,
      anchors: true,           // in-page links (#contact, #who-we-are) glide too
      allowNestedScroll: true  // lists and panels with their own scroll keep it
    });
    window.awLenis = lenis;
    if (reduce && reduce.addEventListener) {
      reduce.addEventListener('change', function () { if (reduce.matches) lenis.destroy(); });
    }
  };
  document.head.appendChild(script);
})();
