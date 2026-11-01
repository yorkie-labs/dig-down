// Backdrop review: one still per scene, named by GAME_URL's ?bg= (none = the default ice walls).
// Waits for props, swings a couple of times for life on screen, then shoots.
const tag = new URLSearchParams(location.search).get('bg') ?? 'ice';
const depth = new URLSearchParams(location.search).get('depth') ?? '0';
for (let i = 0; i < 30 && (window.__props?.length ?? 0) < 20; i++) await wait(200);
await wait(600);
if (depth !== '0') { for (let i = 0; i < 3; i++) await press('Space', 50); await wait(500); }
await shot(`bg-${tag}-${depth}`);
log.push([tag, depth, D.perf().calls]);
