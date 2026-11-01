// Title → start → dig a few rows: the game boots, a run starts, drilling breaks blocks, no page errors.
await shot('smoke-title');
await begin();
check(D.started && D.game.state === 'playing', 'run started');
const y0 = D.game.mole.y;
for (let i = 0; i < 12; i++) await press('Space', 60);
await wait(800);
check(D.game.mole.y > y0, `dug down (row ${y0} → ${D.game.mole.y})`);
await shot('smoke-dig');
log.push(['perf', await measure(2000)]);
