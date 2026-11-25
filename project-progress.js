// Reading history belongs to the current tab. Embedded project content has its own navigation.
(() => {
  if (window !== window.top) return;
  const key = 'hezhen-opened-projects-v1';
  const page = document.currentScript.dataset.project;
  let opened = [];

  function read() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key));
      opened = Array.isArray(saved) ? saved : [];
    } catch {}
  }
  function save() {
    try { sessionStorage.setItem(key, JSON.stringify(opened)); } catch {}
  }
  function paint() {
    for (const dot of document.querySelectorAll('[data-progress-project]')) {
      const id = dot.dataset.progressProject;
      const current = id === opened.at(-1);
      const visited = opened.includes(id);
      dot.dataset.state = current ? 'current' : visited ? 'visited' : 'unseen';
      dot.title = dot.dataset.name + ' · ' + (current ? '最近查看' : visited ? '已看过' : '未查看');
      dot.setAttribute('aria-label', dot.title);
      if (current) dot.setAttribute('aria-current','true');
      else dot.removeAttribute('aria-current');
    }
  }
  function visit(id) {
    read();
    if (id && opened.at(-1) !== id) {
      opened = opened.filter(item => item !== id);
      opened.push(id);
      save();
    }
    paint();
  }
  if (performance.getEntriesByType('navigation')[0]?.type === 'reload') save();
  visit(page);
  window.addEventListener('pageshow', () => visit(page));
  window.addEventListener('hezhen:progress-ready', () => visit());
  window.addEventListener('hezhen:project-open', event => visit(event.detail));
})();
