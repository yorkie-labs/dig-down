// The title scene with the surface props (CDN models) in: a look at the toon conversion and ink
// hulls. Waits for the props to stream in first.
for (let i = 0; i < 40 && (window.__props?.length ?? 0) < 20; i++) await wait(250);
await wait(800);
log.push(['props', window.__props?.length ?? 0, D.perf().calls]);
await shot('title');
