// Backdrop still per scene (pick it with GAME_URL's ?depth=): the ice walls, props, the board.
// Waits for props, swings a couple of times for life on screen, then shoots.
const depth = new URLSearchParams(location.search).get('depth') ?? '0';
for (let i = 0; i < 30 && (window.__props?.length ?? 0) < 20; i++) await wait(200);
await wait(600);
if (depth !== '0') { for (let i = 0; i < 3; i++) await press('Space', 50); await wait(500); }
await shot(`backdrop-${depth}`);
log.push(['backdrop', depth, D.perf().calls]);
