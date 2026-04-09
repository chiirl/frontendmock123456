(function () {
  var filterBar = document.getElementById('filter-bar-modern');
  var container = document.getElementById('events-container');
  var chipsWrap = document.getElementById('active-chips-modern');
  var resultsCount = document.getElementById('results-count-modern');
  if (!filterBar || !container) return;

  var keys = ['audience', 'industry', 'topic', 'activity', 'mode'];
  var labels = { audience: 'Audience', industry: 'Industry', topic: 'Topic', activity: 'Activity', mode: 'Mode' };
  var cards = Array.prototype.slice.call(container.querySelectorAll('.card'));
  var daySections = Array.prototype.slice.call(container.querySelectorAll('.day-section'));

  function getChecked(key) {
    return Array.prototype.slice.call(filterBar.querySelectorAll('input[data-modern-filter-key="' + key + '"]:checked')).map(function (i) { return i.value.trim().toLowerCase(); });
  }
  function currentValues() {
    var v = {}; keys.forEach(function (k) { v[k] = getChecked(k); }); return v;
  }
  function matches(rowVal, selected) {
    if (!selected.length) return true;
    var vals = String(rowVal || '').split('|').filter(Boolean);
    return selected.some(function (s) { return vals.includes(s); });
  }
  function cardVisible(card, values) {
    return keys.every(function (k) { return matches(card.dataset[k], values[k]); });
  }

  function applyFilters() {
    var values = currentValues();
    var visible = 0;
    cards.forEach(function (card) {
      var show = cardVisible(card, values);
      card.classList.toggle('hidden', !show);
      if (show) visible += 1;
    });
    daySections.forEach(function (section) {
      var hasVisible = Array.prototype.some.call(section.querySelectorAll('.card'), function (c) { return !c.classList.contains('hidden'); });
      section.classList.toggle('hidden', !hasVisible);
    });
    resultsCount.textContent = visible + ' event' + (visible === 1 ? '' : 's');
    updateChips(values);
    updateButtons(values);
    syncUrl(values);
  }

  function updateButtons(values) {
    keys.forEach(function (key) {
      var btn = filterBar.querySelector('[data-modern-filter-btn="' + key + '"]');
      if (!btn) return;
      var active = values[key].length > 0;
      btn.classList.toggle('active', active);
      if (active) {
        var first = values[key][0] === 'irl' ? 'IRL' : values[key][0] === 'online' ? 'Online' : values[key][0];
        btn.textContent = labels[key] + ': ' + first + (values[key].length > 1 ? ' +' + (values[key].length - 1) : '') + ' \u25be';
      } else {
        btn.textContent = labels[key] + ' \u25be';
      }
    });
  }

  function updateChips(values) {
    var items = [];
    keys.forEach(function (key) { values[key].forEach(function (val) { items.push({ key: key, value: val }); }); });
    chipsWrap.innerHTML = items.map(function (item) {
      var label = item.value === 'irl' ? 'IRL' : item.value === 'online' ? 'Online' : item.value;
      return '<button class="chip-modern" type="button" data-chip-key="' + item.key + '" data-chip-value="' + item.value + '">' + labels[item.key] + ': ' + label + ' \u00d7</button>';
    }).join('');
  }

  function syncUrl(values) {
    var params = new URLSearchParams();
    params.set('view', 'modern');
    keys.forEach(function (key) { if (values[key].length) params.set(key, values[key].join(',')); });
    window.history.replaceState({}, '', '/?' + params.toString());
  }

  keys.forEach(function (key) {
    var btn = filterBar.querySelector('[data-modern-filter-btn="' + key + '"]');
    var panel = filterBar.querySelector('[data-modern-filter-panel="' + key + '"]');
    if (btn && panel) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = panel.classList.contains('open');
        Array.prototype.forEach.call(filterBar.querySelectorAll('.filter-dropdown'), function (p) { p.classList.remove('open'); });
        if (!isOpen) panel.classList.add('open');
      });
    }
    Array.prototype.forEach.call(filterBar.querySelectorAll('input[data-modern-filter-key="' + key + '"]'), function (input) {
      input.addEventListener('change', applyFilters);
    });
  });

  document.addEventListener('click', function (e) {
    if (!filterBar.contains(e.target)) {
      Array.prototype.forEach.call(filterBar.querySelectorAll('.filter-dropdown'), function (p) { p.classList.remove('open'); });
    }
  });

  document.getElementById('clear-modern-filters').addEventListener('click', function () {
    Array.prototype.forEach.call(filterBar.querySelectorAll('input[type="checkbox"]'), function (i) { i.checked = false; });
    Array.prototype.forEach.call(filterBar.querySelectorAll('.filter-dropdown'), function (p) { p.classList.remove('open'); });
    applyFilters();
  });

  chipsWrap.addEventListener('click', function (e) {
    var btn = e.target.closest('.chip-modern');
    if (!btn) return;
    var key = btn.getAttribute('data-chip-key');
    var val = btn.getAttribute('data-chip-value');
    var input = filterBar.querySelector('input[data-modern-filter-key="' + key + '"][value="' + val + '"]');
    if (input) { input.checked = false; applyFilters(); }
  });

  applyFilters();
})();
