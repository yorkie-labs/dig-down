// Per-frame cost baseline: the title scene, then a run in progress (blocks, effects, HUD), sampled
// while drilling so the effect pools are busy. Compare runs before/after a render change; run with
// MOBILE=1 to see the phone canvas sizes (DPR 3).
log.push(['title', await measure(3000)]);
await begin();
await wait(500);
D.perfReset();
for (let i = 0; i < 30; i++) { await press(i % 7 === 3 ? 'ArrowLeft' : i % 7 === 5 ? 'ArrowRight' : 'Space', 60); await wait(60); }
log.push(['digging', D.perf()]);
await shot('perf-digging');
