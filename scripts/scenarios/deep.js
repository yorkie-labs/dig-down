// A deep scene (open with ?depth=N): band tints, shaft props, the board and effects mid-dig.
await wait(1500); // shaft props stream in
for (let i = 0; i < 6; i++) await press('Space', 50);
await wait(120); // shards and flashes in the air
await shot('deep');
log.push(['state', D.game.level, D.game.mole.y, D.perf().calls]);
