// Helpers every scenario gets (evaluated in the page, before the scenario body).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const D = window.__dd;
const log = [];
const check = (ok, what) => log.push([ok ? 'ok' : 'FAIL', what]);
// hold a key for ms of wall time (Space = drill, arrows = move/turn)
async function press(code, ms = 80) { await keyDown(code); await wait(ms); await keyUp(code); }
async function begin() { if (!D.started) D.start(); await wait(300); }
// let the frame loop run ms, then read the sampler (frame JS cost + renderer.info)
async function measure(ms = 3000) { D.perfReset(); await wait(ms); return D.perf(); }
