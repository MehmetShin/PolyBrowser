const ICONS = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
};

const card = document.getElementById('suggestions-card');
let currentItems = [];

function render(data) {
  card.innerHTML = '';
  currentItems = data.suggestions || [];

  if (currentItems.length === 0) {
    window.polyAPI.resizeSuggestions(0);
    return;
  }

  currentItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'suggestion-row';

    // Icon
    const icon = document.createElement('div');
    icon.className = 'suggestion-icon';
    if (item.favicon) {
      const img = document.createElement('img');
      img.src = item.favicon;
      img.onerror = () => {
        icon.innerHTML = item.type === 'bookmark' ? ICONS.star : ICONS.globe;
      };
      icon.appendChild(img);
    } else if (item.type === 'history') {
      icon.innerHTML = ICONS.clock;
    } else if (item.type === 'bookmark') {
      icon.innerHTML = ICONS.star;
    } else {
      icon.innerHTML = ICONS.search;
    }
    row.appendChild(icon);

    // Text content
    const content = document.createElement('div');
    content.className = 'suggestion-content';

    const title = document.createElement('span');
    title.className = 'suggestion-title';
    title.textContent = item.title;
    content.appendChild(title);

    if (item.sub) {
      const sub = document.createElement('span');
      sub.className = 'suggestion-sub';
      sub.textContent = item.sub;
      content.appendChild(sub);
    }
    row.appendChild(content);

    // Click handler
    row.onmousedown = () => {
      window.polyAPI.selectSuggestion(item);
    };

    card.appendChild(row);
  });

  const totalHeight = Math.min(380, Math.ceil(card.getBoundingClientRect().height));
  window.polyAPI.resizeSuggestions(totalHeight > 0 ? totalHeight : 56);
}

window.polyAPI.onSuggestionsData((data) => {
  if (data.theme) {
    document.documentElement.setAttribute('data-theme', data.theme === 'light' ? 'light' : 'dark');
  }
  render(data);
});

window.polyAPI.onThemeChanged((theme) => {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
});

