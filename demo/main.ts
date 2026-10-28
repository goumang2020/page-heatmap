import { PageHeatmap, type HeatDatum } from '../src/index';
const ids = ['a','b','c','d','e'];
const data = (): HeatDatum[] => ids.map((id, index) => ({ id, selector: `#product-${id}`, value: [80, 50, 20, 60, 35][index] ?? 0 }));
const status = document.querySelector<HTMLElement>('#status')!;
const map = new PageHeatmap({ data: data(), max: 100, onHover: point => { status.textContent = point ? `${point.id}: ${point.value}` : ''; } });
let paused = false;
document.querySelector('#toggle')!.addEventListener('click', event => { paused = !paused; paused ? map.pause() : map.start(); (event.currentTarget as HTMLButtonElement).textContent = paused ? '继续' : '暂停'; });
document.querySelector('#random')!.addEventListener('click', () => map.setData(data().map(item => ({ ...item, value: Math.round(Math.random() * 100) }))));
document.querySelector('#clear')!.addEventListener('click', () => map.setData([]));
