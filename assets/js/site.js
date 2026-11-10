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
