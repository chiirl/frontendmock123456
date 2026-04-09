(function () {
  var toolbar = document.getElementById('filter-toolbar');
  var list = document.getElementById('event-list');
  var chips = document.getElementById('active-chips');
  var resultsCount = document.getElementById('results-count');
  if (!toolbar || !list || !chips || !resultsCount) return;

  var keys = ['audience', 'industry', 'topic', 'activity', 'mode'];
  var labels = { audience: 'Audience', industry: 'Industry', topic: 'Topic', activity: 'Activity', mode: 'Mode' };
  var rows = Array.prototype.slice.call(list.querySelectorAll('li'));
  var buttons = {};
  var panels = {};

  keys.forEach(function (key) {
    buttons[key] = toolbar.querySelector('[data-filter-button="' + key + '"]');
    panels[key] = toolbar.querySelector('[data-filter-panel="' + key + '"]');
  });

  function matches(rowValue, selectedValue) {
    if (!selectedValue.length) return true;
    var values = String(rowValue || '').split('|').filter(Boolean);
    return selectedValue.some(function (item) { return values.includes(item); });
  }

  function rowMatchesFilters(row, values, skipKey) {
    return (skipKey === 'audience' || matches(row.dataset.audience, values.audience)) &&
      (skipKey === 'industry' || matches(row.dataset.industry, values.industry)) &&
      (skipKey === 'topic' || matches(row.dataset.topic, values.topic)) &&
      (skipKey === 'activity' || matches(row.dataset.activity, values.activity)) &&
      (skipKey === 'mode' || matches(row.dataset.mode, values.mode));
  }

  function getRowValues(row, key) {
    return String(row.dataset[key] || '').split('|').filter(Boolean);
  }

  function currentValues() {
    var values = {};
    keys.forEach(function (key) {
      values[key] = Array.prototype.slice.call(toolbar.querySelectorAll('input[data-filter-key="' + key + '"]:checked')).map(function (input) {
        return String(input.value || '').trim().toLowerCase();
      });
    });
    return values;
  }

  function updateOptions(values) {
    var categoryTotals = {};
    keys.forEach(function (key) {
      var panel = panels[key];
      if (!panel) return;

      var counts = {};
      var total = 0;
      rows.forEach(function (row) {
        if (!rowMatchesFilters(row, values, key)) return;
        if (getRowValues(row, key).length > 0) total += 1;
        getRowValues(row, key).forEach(function (value) {
          counts[value] = (counts[value] || 0) + 1;
        });
      });
      categoryTotals[key] = total;

      Array.prototype.forEach.call(panel.querySelectorAll('.filter-option'), function (option) {
        var optionValue = String(option.getAttribute('data-option') || '').trim().toLowerCase();
        var count = counts[optionValue] || 0;
        var countEl = option.querySelector('.filter-count');
        if (countEl) countEl.textContent = count > 0 ? String(count) : '';
        option.style.display = count === 0 && !values[key].includes(optionValue) ? 'none' : '';
        option.setAttribute('data-count', String(count));
      });

      Array.prototype.slice.call(panel.querySelectorAll('.filter-option'))
        .sort(function (a, b) {
          var countA = Number(a.getAttribute('data-count') || '0');
          var countB = Number(b.getAttribute('data-count') || '0');
          if (countB !== countA) return countB - countA;
          var labelA = String(a.getAttribute('data-option') || '').toLowerCase();
          var labelB = String(b.getAttribute('data-option') || '').toLowerCase();
          return labelA.localeCompare(labelB);
        })
        .forEach(function (option) {
          panel.appendChild(option);
        });
    });
    return categoryTotals;
  }

  function syncUrl(values) {
    var params = new URLSearchParams();
    keys.forEach(function (key) {
      if (values[key].length) params.set(key, values[key].join(','));
    });
    var query = params.toString();
    window.history.replaceState({}, '', query ? ('/?' + query) : '/');
  }

  function updateButtons(values, categoryTotals) {
    keys.forEach(function (key) {
      var button = buttons[key];
      if (!button) return;
      var total = categoryTotals[key] || 0;
      if (!values[key].length) {
        button.textContent = labels[key] + ' ' + total + ' \u25bc';
        button.classList.remove('active');
        return;
      }
      var first = values[key][0] === 'irl' ? 'IRL' : values[key][0] === 'online' ? 'Online' : values[key][0];
      button.textContent = labels[key] + ': ' + first + (values[key].length > 1 ? ' +' + (values[key].length - 1) : '') + ' (' + total + ') \u25bc';
      button.classList.add('active');
    });
  }

  function updateChips(values) {
    var items = [];
    keys.forEach(function (key) {
      values[key].forEach(function (value) {
        items.push({ key: key, value: value });
      });
    });
    chips.innerHTML = items.map(function (item) {
      var label = item.value === 'irl' ? 'IRL' : item.value === 'online' ? 'Online' : item.value;
      return '<button class="chip" type="button" data-chip-key="' + item.key + '" data-chip-value="' + item.value + '">' + labels[item.key] + ': ' + label + ' \u00d7</button>';
    }).join('');
  }

  function applyFilters() {
    var values = currentValues();
    var visibleCount = 0;
    rows.forEach(function (row) {
      var visible = rowMatchesFilters(row, values);
      row.style.display = visible ? '' : 'none';
      if (visible) visibleCount += 1;
    });

    var categoryTotals = updateOptions(values);
    updateButtons(values, categoryTotals);
    updateChips(values);
    resultsCount.textContent = visibleCount + ' event' + (visibleCount === 1 ? '' : 's');
    syncUrl(values);
  }

  keys.forEach(function (key) {
    var button = buttons[key];
    if (button) {
      button.addEventListener('click', function () {
        var willOpen = !panels[key].classList.contains('open');
        keys.forEach(function (otherKey) {
          if (panels[otherKey]) panels[otherKey].classList.remove('open');
        });
        if (willOpen && panels[key]) panels[key].classList.add('open');
      });
    }
    Array.prototype.forEach.call(toolbar.querySelectorAll('input[data-filter-key="' + key + '"]'), function (input) {
      input.addEventListener('change', applyFilters);
    });
  });

  document.getElementById('clear-filters').addEventListener('click', function () {
    Array.prototype.forEach.call(toolbar.querySelectorAll('input[type="checkbox"]'), function (input) {
      input.checked = false;
    });
    keys.forEach(function (key) {
      if (panels[key]) panels[key].classList.remove('open');
    });
    applyFilters();
  });

  chips.addEventListener('click', function (event) {
    var button = event.target.closest('.chip');
    if (!button) return;
    var key = button.getAttribute('data-chip-key');
    var value = button.getAttribute('data-chip-value');
    var input = toolbar.querySelector('input[data-filter-key="' + key + '"][value="' + value + '"]');
    if (input) {
      input.checked = false;
      applyFilters();
    }
  });

  document.addEventListener('click', function (event) {
    if (!toolbar.contains(event.target)) {
      keys.forEach(function (key) {
        if (panels[key]) panels[key].classList.remove('open');
      });
    }
  });

  applyFilters();
})();
