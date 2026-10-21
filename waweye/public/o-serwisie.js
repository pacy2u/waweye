'use strict';
// Film-przewodnik w formacie urządzenia: 9:16 na telefonie (wąski, pionowy ekran), 16:9 na komputerze.
// Zmienia się przy obrocie albo zmianie okna, ale tylko zanim film ruszył.
(function () {
  var box = document.getElementById('przewodnik'), v = box && box.querySelector('video');
  if (!v || !window.matchMedia) return;
  var phone = window.matchMedia('(max-width: 699px) and (orientation: portrait)');
  function pick() {
    if (v.currentTime > 0 || !v.paused) return;
    var f = phone.matches ? '9x16' : '16x9';
    var src = '/media/waweye-przewodnik-' + f + '.mp4';
    if (v.getAttribute('src') === src) return;
    v.setAttribute('src', src);
    v.setAttribute('poster', '/media/waweye-przewodnik-' + f + '-plakat.webp');
    box.classList.toggle('tall', phone.matches);
  }
  pick();
  if (phone.addEventListener) phone.addEventListener('change', pick); else phone.addListener(pick);
})();
