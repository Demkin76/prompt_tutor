const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(pointer: fine)');
const motionButton = document.querySelector('.motion-toggle');
let explicitlyPaused = false;
try { explicitlyPaused = localStorage.getItem('golem-homepage-motion') === 'paused'; } catch { /* Storage is optional. */ }
let motionAllowed = false;
const tilt = document.querySelector('[data-tilt]');
const progress = document.querySelector('.scroll-progress');
const applyMotion = () => {
  motionAllowed = !explicitlyPaused && !reduceMotion.matches;
  root.classList.toggle('motion-enabled', motionAllowed);
  root.classList.toggle('motion-paused', !motionAllowed);
  motionButton.setAttribute('aria-pressed', String(!motionAllowed));
  motionButton.innerHTML = `${motionAllowed ? 'Pause animations' : reduceMotion.matches ? 'Reduced motion' : 'Resume animations'} <span aria-hidden="true">${motionAllowed ? 'Ⅱ' : '▷'}</span>`;
  motionButton.disabled = reduceMotion.matches;
  if (!motionAllowed) {
    document.querySelectorAll('.reveal').forEach(element => element.classList.add('visible'));
    document.querySelectorAll('.magnetic, [data-tilt]').forEach(element => element.style.removeProperty('transform'));
  }
};
motionButton.addEventListener('click', () => {
  explicitlyPaused = !explicitlyPaused;
  try { localStorage.setItem('golem-homepage-motion', explicitlyPaused ? 'paused' : 'enabled'); } catch { /* Storage is optional. */ }
  applyMotion();
});
reduceMotion.addEventListener('change', applyMotion);
const reveals = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    entry.target.classList.add('visible');
    reveals.unobserve(entry.target);
  }
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(element => reveals.observe(element));
applyMotion();
document.addEventListener('visibilitychange', () => root.classList.toggle('page-hidden', document.hidden));
let scrollFrame = 0;
const updateScroll = () => {
  scrollFrame = 0;
  const distance = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = `scaleX(${distance > 0 ? Math.min(1, Math.max(0, scrollY / distance)) : 0})`;
};
addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll); }, { passive: true });
addEventListener('resize', updateScroll);
updateScroll();
tilt.addEventListener('pointermove', event => {
  if (!motionAllowed || !finePointer.matches) return;
  const bounds = tilt.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width - 0.5;
  const y = (event.clientY - bounds.top) / bounds.height - 0.5;
  tilt.style.transform = `rotateY(${x * 10 - 5}deg) rotateX(${-y * 8 + 3}deg) rotateZ(-1deg)`;
});
tilt.addEventListener('pointerleave', () => tilt.style.removeProperty('transform'));
for (const element of document.querySelectorAll('[data-spotlight], .magnetic')) {
  element.addEventListener('pointermove', event => {
    if (!motionAllowed || !finePointer.matches) return;
    const bounds = element.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (element.matches('.magnetic')) element.style.transform = `translate(${(x / bounds.width - 0.5) * 9}px, ${(y / bounds.height - 0.5) * 9}px)`;
    else { element.style.setProperty('--pointer-x', `${x}px`); element.style.setProperty('--pointer-y', `${y}px`); }
  });
  element.addEventListener('pointerleave', () => element.style.removeProperty('transform'));
}
const views = {
  facility: { title: 'Two ways to test your thinking.', description: 'Explore a maze or navigate deadly floors. Each mode challenges a different part of your instructions.', alt: 'GOLEM mode selection with Maze and Red Floor', number: '01' },
  charter: { title: 'The world is hidden. Your intent is not.', description: 'Define priorities and constraints within the character budget. Deploy locks the charter before the agent sees the map.', alt: 'Actual charter editor with a hidden map, written instructions and Deploy button', number: '02' },
  red: { title: 'Every decision, ready to replay.', description: 'Scrub the timeline, step through the action log, and toggle fog to understand how the agent reached its outcome.', alt: 'Red Floor replay with a stone map, locked charter, action log and timeline controls', number: '03' },
  results: { title: 'An outcome you can inspect.', description: 'Compare the three trials, read the pass or fail evidence, and review your score before revising the next charter.', alt: 'Actual run results showing trial outcomes, scoring and Replay buttons', number: '04' },
};
const tabs = [...document.querySelectorAll('[role="tab"]')];
const panel = document.querySelector('#interface-panel');
const screenshot = document.querySelector('#interface-image');
// Resolve public assets from the emitted image URL to also support GitHub Pages subpaths.
const imageBase = new URL('.', screenshot.src);
let selectedView = 'facility';
function selectView(key, focus = false) {
  const view = views[key];
  if (!view) return;
  selectedView = key;
  for (const tab of tabs) {
    const active = tab.dataset.view === key;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  }
  panel.setAttribute('aria-labelledby', `tab-${key}`);
  screenshot.src = new URL(`${key}.jpg`, imageBase).href;
  screenshot.alt = view.alt;
  document.querySelector('#interface-title').textContent = view.title;
  document.querySelector('#interface-description').textContent = view.description;
  document.querySelector('.screen-number').textContent = `${view.number} / 04`;
  if (motionAllowed) screenshot.animate([{ opacity: 0.35, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 380, easing: 'ease-out' });
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectView(tab.dataset.view));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectView(tabs[next].dataset.view, true);
  });
}
document.querySelector('[data-show-replay]').addEventListener('click', () => selectView('red'));
const dialog = document.querySelector('.image-dialog');
document.querySelector('.expand-image').addEventListener('click', () => {
  const expanded = dialog.querySelector('img');
  expanded.src = screenshot.src;
  expanded.alt = views[selectedView].alt;
  dialog.showModal();
});
dialog.querySelector('.close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) {
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
} });
for (const link of document.querySelectorAll('.mobile-menu a')) link.addEventListener('click', () => document.querySelector('.mobile-menu').removeAttribute('open'));
