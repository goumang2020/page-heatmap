import { PageHeatmap, type HeatDatum } from '../src/index';
const ids = ['a','b','c','d','e'];
const data = (): HeatDatum[] => ids.map((id, index) => ({ id, selector: `#product-${id}`, value: [80, 50, 20, 60, 35][index] ?? 0 }));
const status = document.querySelector<HTMLElement>('#status')!;
const map = new PageHeatmap({ data: data(), max: 100, onHover: point => { status.textContent = point ? `${point.id}: ${point.value}` : ''; } });
const listeners = new AbortController();
const eventOptions = { signal: listeners.signal };
let paused = false;
document.querySelector('#toggle')!.addEventListener('click', event => {
  paused = !paused;
  if (paused) map.pause(); else map.start();
  (event.currentTarget as HTMLButtonElement).textContent = paused ? '继续' : '暂停';
}, eventOptions);
document.querySelector('#random')!.addEventListener('click', () => map.setData(data().map(item => ({ ...item, value: Math.round(Math.random() * 100) }))), eventOptions);
document.querySelector('#clear')!.addEventListener('click', () => map.setData([]), eventOptions);

// Avoid leaving an old overlay behind during Vite hot-module replacement.
if (import.meta.hot) import.meta.hot.dispose(() => { listeners.abort(); map.destroy(); });
