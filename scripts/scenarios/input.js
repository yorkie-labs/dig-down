// Input on the logic tick: held keys repeat at MOVE_DELAY then MOVE_RATE (0.2s, 0.11s) of game
// time, every press still turns the hero (lessons: turning to each side, then the hammer), and a
// held hammer keeps digging.
await begin();
const G = () => D.game;
// on the surface the row is open snow: a held arrow walks
const x0 = G().mole.x;
await keyDown('ArrowLeft'); await wait(560); await keyUp('ArrowLeft'); // 1 + floor((0.56-0.2)/0.11) = 4 steps
const walked = x0 - G().mole.x;
check(walked >= 3 && walked <= 4, `held ← walked ${walked} cells in 0.56s (expect ~4)`);
for (const [code, dir] of [['ArrowRight', 'right'], ['ArrowUp', 'up'], ['ArrowLeft', 'left'], ['ArrowDown', 'down']]) {
  await press(code, 30);
  await wait(50);
  check(G().mole.facing === dir, `${code} turns to ${dir} (facing ${G().mole.facing})`);
}
const y0 = G().mole.y;
await keyDown('Space'); await wait(1500); await keyUp('Space');
await wait(600);
check(G().mole.y >= y0 + 3, `held hammer dug ${G().mole.y - y0} rows in 1.5s`);
await shot('input-dug');
