(function() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;
  function sync() {
    var dark = document.documentElement.classList.contains('theme-dark');
    btn.textContent = dark ? '\u2600' : '\u263d';
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  }
  sync();
  btn.addEventListener('click', function() {
    var dark = document.documentElement.classList.contains('theme-dark');
    var t = dark ? 'light' : 'dark';
    document.documentElement.className = 'theme-' + t;
    localStorage.setItem('chiirl-theme', t);
    sync();
  });
})();
