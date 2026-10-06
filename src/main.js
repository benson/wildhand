import { Game } from './game.js';

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:18px;z-index:99;background:#1b1430';
  d.textContent = `wildhand couldn't start: ${e.message}. it needs webgl2 — try a recent chrome, firefox or safari.`;
  document.body.appendChild(d);
});
