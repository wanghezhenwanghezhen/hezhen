// Square cells give the Chinese heading the same rhythm as the START marker.
const titleLetters = [
  [
    '.#########.',
    '.#.......#.',
    '.#.......#.',
    '.#.......#.',
    '.#########.',
    '.#.......#.',
    '.#.......#.',
    '.#.......#.',
    '.#########.',
    '.#.......#.',
    '.#.......#.',
    '.#.......#.',
    '.#########.',
  ],
  [
    '..########.',
    '.........#.',
    '.........#.',
    '...#######.',
    '.........#.',
    '.##########',
    '.....#.....',
    '.#...#...#.',
    '..#..#..#..',
    '...#.#.#...',
    '..#..#..#..',
    '##...#...##',
    '...###.....',
  ],
];

function directoryTitle() {
  const faces = [], backing = [];
  for (const [letter, rows] of titleLetters.entries()) {
    for (const [y, row] of rows.entries()) {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '#') continue;
        const px = (letter * 14 + x) * 10, py = y * 10;
        backing.push(`M${px} ${py}h10v10h-10z`);
        faces.push(`M${px + 1} ${py + 1}h8v8h-8z`);
      }
    }
  }
  return `<svg viewBox="-4 -5 262 142" aria-hidden="true" focusable="false">
    <path d="${backing.join('')}" class="directory-glyph-outline" stroke-width="6" stroke-linejoin="round"/>
    <path d="${faces.join('')}" class="directory-glyph-dots"/>
  </svg>`;
}

export function directoryMarkup(parts) {
  const links = parts.map(part => `<a href="#${part.id}"><span class="directory-number">${part.number}</span> <strong>${part.title}</strong></a>`).join('');
  return `<section class="directory-ticket" id="route-directory" aria-labelledby="directory-title">
    <div class="directory-stock" aria-hidden="true"><div class="directory-fabric"></div></div>
    <div class="directory-typeset">
      <h2 id="directory-title" data-route-stop><span class="screen-reader-only">目录</span>${directoryTitle()}</h2>
      <nav class="report-parts-nav" aria-label="目录">${links}</nav>
    </div>
  </section>`;
}

export function installEndingSpacing() {
  const main = document.querySelector('.defense main');
  const first = main.querySelector('#visual-language');
  const card = first.querySelector('.story-copy'), rack = first.querySelector('.story-card-area');
  const next = main.querySelector('#work-path .story-copy');
  let frame = 0, last = '';
  function measure() {
    frame = 0;
    const scale = main.getBoundingClientRect().width / main.offsetWidth;
    const bottom = Math.max(card.getBoundingClientRect().bottom, rack.getBoundingClientRect().bottom);
    const gap = Math.max(0,(next.getBoundingClientRect().top-bottom)/scale).toFixed(2)+'px';
    if (gap !== last) { main.style.setProperty('--ending-gap',gap); last=gap; }
  }
  function schedule() { if (!frame) frame=requestAnimationFrame(measure); }
  const observer = new ResizeObserver(schedule);
  for (const el of [first, rack, next, main.querySelector('#position-value'), main.querySelector('#work-path')]) observer.observe(el);
  window.addEventListener('resize',schedule,{passive:true});
  document.fonts.ready.then(schedule);
  schedule();
}
