// KeyPing web: mejora progresiva sin dependencias ni peticiones de red.
// 1) Botón de descarga según el sistema (Windows, Linux o Android si la release trae APK).
// 2) Sugerencia de idioma (nunca redirige).
(function () {
  'use strict';

  function detectOS() {
    var platform = '';
    try {
      if (navigator.userAgentData && navigator.userAgentData.platform) platform = navigator.userAgentData.platform;
    } catch (e) { /* sin userAgentData */ }
    var ua = (navigator.userAgent || '') + ' ' + platform;
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod|CrOS/i.test(ua)) return 'other';
    if (/Windows|Win32|Win64/i.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X|macOS/i.test(ua)) return 'other';
    if (/Linux|X11/i.test(ua)) return 'linux';
    return 'other';
  }

  function setupDownloads() {
    var os = detectOS();
    document.documentElement.setAttribute('data-os', os);
    var blocks = document.querySelectorAll('[data-download]');
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var primary = b.querySelector('[data-primary]');
      var label = b.querySelector('[data-label]');
      var other = b.querySelector('[data-other]');
      var unsupported = b.querySelector('[data-unsupported]');
      if (os === 'windows' || os === 'linux') {
        var me = os === 'windows' ? 'win' : 'linux';
        var them = os === 'windows' ? 'linux' : 'win';
        primary.setAttribute('href', b.getAttribute('data-' + me + '-href'));
        primary.setAttribute('data-os-target', os);
        label.textContent = b.getAttribute('data-' + me + '-label');
        other.setAttribute('href', b.getAttribute('data-' + them + '-href'));
        other.textContent = b.getAttribute('data-' + them + '-other');
        other.hidden = false;
      } else if (os === 'android' && b.getAttribute('data-android-href')) {
        primary.setAttribute('href', b.getAttribute('data-android-href'));
        primary.setAttribute('data-os-target', os);
        label.textContent = b.getAttribute('data-android-label');
      } else if (unsupported) {
        unsupported.hidden = false;
      }
    }
    // Página de descargas: resalta la tarjeta del sistema detectado.
    var card = document.querySelector('[data-platform-card="' + os + '"]');
    if (card) card.classList.add('is-detected');
  }

  function setupLangSuggest() {
    var box = document.getElementById('lang-suggest');
    if (!box) return;
    var lang = box.getAttribute('data-lang');
    var alt = box.getAttribute('data-alt-lang');
    var prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    var first = String(prefs[0] || '').toLowerCase().slice(0, 2);
    if (!first || first === lang || first !== alt) return;
    // Solo al llegar desde fuera: si ya navega por la web, ha elegido idioma.
    var ref = document.referrer;
    if (ref) {
      try { if (new URL(ref).origin === location.origin) return; } catch (e) { /* referrer inválido */ }
    }
    box.hidden = false;
    var btn = box.querySelector('[data-dismiss]');
    if (btn) btn.addEventListener('click', function () { box.hidden = true; });
  }

  function init() {
    setupDownloads();
    setupLangSuggest();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
