// Hand-made board pieces (studio review item 10: the board was cell noise with no pattern to
// read). fillRows stamps one every 25m over the noise, and a finite stage's boss piece fills its
// last rows above the goal. All shapes are our design; Mr. Driller's boards are noise too, so
// none of this is sourced.
//
// Legend, 9 columns wide (COLS), 6-12 rows (a boss 16-20):
//   a b c d  colours: mapped to a random permutation of the level's palette, so 'a' is just
//            "some colour" and pieces never need more colours than the level has
//   X        X block      O  air capsule (a clock on time-attack stages)
//   ~        thaw ice     .  empty (must sit under a stack that is held up from the side)
//
// Design rules (checked in game.test.ts): every row is COLS wide; a stamped piece is stable at
// rest; there is a way down that never breaks an X (a boss: once its X-locks are popped); a piece
// with `bait` chains from its key columns and from no other. game.ts may stamp the mirror image.

export interface Chunk {
  id: string;
  rows: string[];
  // Design check (studio review 2 item 1: every piece chained from any column, so chains needed no
  // reading): coming down one of the `keys` columns and digging straight down sets off a cascade of
  // at least `chain` steps; any other column does not. Mirrored with the piece (game.ts).
  bait?: { keys: number[]; chain: number };
  // A boss's X-lock walls, top to bottom: the key column that drops each one's X (see bosses).
  gates?: number[];
}

export interface ChunkSet {
  pool: Chunk[]; // drawn from a bag for each 25m slot (only pieces the level can show), see game.ts
  script?: (Chunk | null)[][]; // tutorial: fixed pieces per level and slot, in place of the pool
  beforeDry?: Chunk[]; // the 75m slot of a level followed by a dry one (capsuleMul < 1)
  boss?: Chunk; // the last rows above the goal of a finite stage
  bosses?: Chunk[]; // endless: taking turns above every ENDLESS_BOSS_EVERY m past ENDLESS_BOSS_FROM (game.ts)
}

// Colours used, from 'a' up: the level needs at least this many.
export const chunkColors = (c: Chunk) => {
  let n = 0;
  for (const row of c.rows) for (const ch of row) if (ch >= 'a' && ch <= 'd') n = Math.max(n, ch.charCodeAt(0) - 96);
  return n;
};
export const chunkHasThaw = (c: Chunk) => c.rows.some((r) => r.includes('~'));

// ---------- the devices ----------
// The pop-4 lessons hang a small stack on a full-width support row S: whichever column the mole
// comes down, it has to break S, and what rested on S drops onto a matching colour below. A first
// lesson should work wherever the mole enters it.

// Pop-4 lesson: 'aaa' on S drops onto the lone 'a' under it (4 → pop); the 'bbb' flanks pop too.
const POP4: Chunk = {
  id: 'pop4',
  rows: [
    'bbbaaabbb',
    'ccccccccc',
    'cbbbabbbc',
    'aaccbccaa',
    'bbaaaaabb',
    'ccbbcbbcc',
  ],
  bait: { keys: [0, 1, 2, 3, 4, 5, 6, 7, 8], chain: 1 },
};

// Pop-4, seen from the middle: two 'aaa' at the edges drop onto edge 'a's, 'bbb' onto a 'b' bar.
const POP4_EDGES: Chunk = {
  id: 'pop4-edges',
  rows: [
    'aaabbbaaa',
    'ccccccccc',
    'abbbbbbba',
    'bcacacacb',
    'acbcbcbca',
    'cbacbacba',
  ],
  bait: { keys: [0, 1, 2, 3, 4, 5, 6, 7, 8], chain: 1 },
};

// Step-aside lesson: lone X blocks on alternate columns. Coming down onto one, the mole steps
// sideways under the stack above, which then wobbles: keep moving.
const STEP_ASIDE: Chunk = {
  id: 'step-aside',
  rows: [
    'abcabcabc',
    'XaXbXcXaX',
    'bcabcabca',
    'aXbXcXaXb',
    'cabcabcab',
    'bbaaccbba',
  ],
};

// X-boxed capsule lesson: walled left, right and below, so it is taken from above.
const BOXED_CAPSULE: Chunk = {
  id: 'boxed-capsule',
  rows: [
    'abcabcabc',
    'aXOXbXOXa',
    'bcXcacXcb',
    'cabcabcab',
    'abcabcabc',
    'bcabcabca',
  ],
};

// X wall with one opening: four sideways digs beat five hits and 20% air.
const X_WALL: Chunk = {
  id: 'x-wall',
  rows: [
    'abcabcabc',
    'bcabcabca',
    'XXXXaXXXX',
    'cabcbcabc',
    'abcabcabc',
    'bcabcabca',
  ],
};

// Key-column chains (studio review 2 item 1). A full-width S fired the chain from any column, so
// the planner that ignored chains still cleared (review 2). Now the trigger is a plug G under a
// lone F, reached from 1-2 key columns beside F; the rest of the piece is filler in which no cell
// touches its own colour (the 3-step pieces' filler is searched instead: see KEY_CHAIN3), so a wrong column digs out one cell at a time and drops nothing (the
// shaft above it is already empty). X caps F's own column: digging F out instead is a wrong
// column too. The cascade is the old one: F falls through the slot under G onto T ('aaa', step 1);
// the 'b's that sat on T drop onto the 'b' bar (step 2); for three steps, the 'c' that sat on the
// bar drops onto 'ccc' (step 3). Every step is a piece sitting still on the group that pops, which
// is all the rules carry a chain through. Filler found by search over real boards (scratch r3).
//
// Two steps, key 4 (G is 'ccc' on row 2). Round 3: re-searched like KEY_CHAIN3 (a straight digger
// got no pop at all from the old filler alone); column 5 is no longer a key. In context: key 98%,
// a wrong column 38% (two steps happen by themselves on noise; round-2 filler 50% / 43%).
const TWO_CHAIN: Chunk = {
  id: 'key-chain2',
  rows: [
    'aacXabaca',
    'ccbabbbac',
    'acXcccabc',
    'aaa.bcbcb',
    'bacaabccX',
    'baXbabaac',
    'bbacacabb',
  ],
  bait: { keys: [4], chain: 2 },
};

// Three steps, key 6 (G is 'cc' on row 2). Round 3 review: the design test's player steps off the
// board whenever anything moves, but a player digging straight down (one swing per 0.13-0.45 s,
// never waiting) got only a 1-step pop here: digging on destroyed the groups the cascade lands on
// before the ~1 s wobble ended. Filler re-searched (scratch r3/kdesign: hill climbing, keeping the
// hole-beside-the-key cue the key tip teaches) so the key column chains 3 steps for both players at
// level 1-5 wobble and fall speeds and no other column does, alone and in real-board context (4
// noise rows above and below, palette permuted, half mirrored; 40 boards): key column 93%, a wrong
// column 3% (the round-2 filler: 13% / 13%, the key did nothing for this player).
const KEY_CHAIN3: Chunk = {
  id: 'key-chain3',
  rows: [
    'cbbccacca',
    'cbcc.abbc',
    'cbbaXccab',
    'aacXb.bbc',
    'cbacaaacb',
    'bbabbbbcc',
    'bcccccbab',
    'aabbbbcac',
  ],
  bait: { keys: [6], chain: 3 },
};

// The same for 4-colour levels, key 5 (G is 'aa'); re-searched the same way: key 88%, wrong 3%
// (round-2 filler: 5% / 8%).
const KEY_CHAIN3_4: Chunk = {
  id: 'key-chain3-4',
  rows: [
    'aXcbXdddb',
    'bcabdbbXd',
    'cdbXaacbb',
    'cdac.bbad',
    'cbcabd.da',
    'bccbbbccc',
    'aabbacbda',
    'ddcbdbddd',
  ],
  bait: { keys: [5], chain: 3 },
};

// Two colours (studio review 2 item 4: 2-colour levels drew from a single piece). With two
// colours the plug G has to be 'b' around an 'a' F, and the filler cannot avoid every pair, so
// these sit in boards that chain on their own anyway; what the key adds is the sure thing.
// Pop-4, keys 6-7:
const POP4_2C: Chunk = {
  id: 'key-pop4-2c',
  rows: [
    'ababaXaba',
    'babaXabab',
    'ababXbbba',
    'babaX.Xab',
    'ababaaaba',
    'bababbbab',
    'ababaaaba',
  ],
  bait: { keys: [6, 7], chain: 1 },
};

// Two steps, key 4.
const CHAIN2_2C: Chunk = {
  id: 'key-chain2-2c',
  rows: [
    'abaXababa',
    'baXababab',
    'abXbbabba',
    'bab.Xbabb',
    'abaaaabab',
    'babbbabab',
    'abaaababa',
  ],
  bait: { keys: [4], chain: 2 },
};

// Thaw cave: two-high stacks on thaw ice with their own colour waiting below. Dig beside a stack
// and the ice melts, dropping it into a pop (a melt chain) without a swing at the stack.
const THAW_DROP: Chunk = {
  id: 'thaw-drop',
  rows: [
    'babcabbac',
    'cabbacbab',
    'c~bb~cb~c',
    'aacaabaac',
    'bbcbbcbbc',
    'cabcabcab',
  ],
};

// Frozen lake: one X held up by a plug drops into a pocket of three (4 X → pop → a frozen
// friend). Key 5: the column beside the X, whose dig breaks the plug ('cc' on row 2).
const X_POCKET: Chunk = {
  id: 'x-pocket',
  rows: [
    'bacacbcba',
    'acbcXabcb',
    'cbcaccabc',
    'bcab.abab',
    'cbcXXXcbc',
    'acacbcbcb',
  ],
  bait: { keys: [5], chain: 1 },
};

// The same for 2-colour levels.
const X_POCKET2: Chunk = {
  id: 'x-pocket2',
  rows: [
    'babababab',
    'ababXabaa',
    'bababbaba',
    'abab.abab',
    'babXXXaba',
    'abababbab',
  ],
  bait: { keys: [5], chain: 1 },
};

// Aurora: two capsule alcoves walled in X right before a dry level — stock up while you can.
// Dig down the middle, then step sideways into an alcove. The first version left the capsules
// open on top: taking one dropped the cell above onto the hero between X ledges, which made
// 70-79m the deadliest band of every aurora level (design review 2). The X roof is joined to the
// ledge, so it stays put once the capsules are gone.
const SHELF: Chunk = {
  id: 'capsule-shelf',
  rows: [
    'abcabcabc',
    'XXXbcbXXX',
    'XOOacaOOX',
    'XXXbabXXX',
    'bcabcabca',
    'cabcabcab',
  ],
};

// Ice slide: clocks on X ledges, each under a stack. Step in from the side to take one and the
// stack above drops into the cell you stand in, with X below: grab and step back out.
const CLOCK_LEDGE: Chunk = {
  id: 'clock-ledge',
  rows: [
    'aabbcbbaa',
    'abOcacObc',
    'bcXabaXcb',
    'cabcabcab',
    'abcabcabc',
    'bcabcabca',
  ],
};

// ---------- bosses (the last rows above a finite stage's goal) ----------
// Studio review 2 item 3: the bosses were 10-15 rows anyone could dig straight through. Now 16-20
// rows with a key structure that gates the way down. The X-lock: an X wall across the board, and
// above it one X held up by a plug, as in the X pocket. Dig the key column beside it (column 6, or
// 2 mirrored; not next to the centre, where the mole starts and would find it by stepping off the
// lone X) and the X drops onto the wall: one X group that fell, so the whole wall pops (leaving a
// frozen friend where friends are on) and the way opens. Any other column runs into the wall: an
// X to break per wall row, 20% air each on time stages, 12% on the igloo. One row on the igloo and
// thaw cave, two locks of one row on the lake, a two-row wall on aurora and the ice slide. Once a
// wall pops, everything above it drops by the wall's height: stay in the key shaft until it lands.
// Filler found by search over real boards (scratch r3); the key column is checked in game.test.ts.

// Snowy hill, the tutorial's exam (no wall: X-locks are not taught): the two-step key piece (key 4),
// then the three-step one below it (key 6; 5 sets off two steps of it too). Round 3: both halves are the re-searched pieces, so a
// player digging straight down gets the chain too, not only one who waits out every wobble.
const SNOWY_BOSS: Chunk = {
  id: 'snowy-boss',
  rows: [
    'aacXabaca',
    'ccbabbbac',
    'acXcccabc',
    'aaa.bcbcb',
    'bacaabccX',
    'baXbabaac',
    'bbacacabb',
    'cbcacbcac',
    'cbbccacca',
    'cbcc.abbc',
    'cbbaXccab',
    'aacXb.bbc',
    'cbacaaacb',
    'bbabbbbcc',
    'bcccccbab',
    'aabbbbcac',
  ],
  bait: { keys: [4, 5, 6], chain: 2 },
};

// Igloo: an X-lock, then the three-step key piece (key 6) for the chain air.
const IGLOO_BOSS: Chunk = {
  id: 'igloo-boss',
  rows: [
    'acacbcaca',
    'cbcacXbac',
    'acbcaccba',
    'bacab.acb',
    'cbaca.bac',
    'XXXXXXXXX',
    'cbbccacca',
    'cbcc.abbc',
    'cbbaXccab',
    'aacXb.bbc',
    'cbacaaacb',
    'bbabbbbcc',
    'bcccccbab',
    'aabbbbcac',
    'acababcbc',
    'cabcbabcb',
  ],
  bait: { keys: [6], chain: 2 },
  gates: [6],
};

// Thaw cave: thaw ice over the cave, an X-lock, then the old thaw keyhole wall: stand over a
// keyhole and it melts.
const THAW_BOSS: Chunk = {
  id: 'thaw-boss',
  rows: [
    'adadcdada',
    'c~db~ad~b',
    'dbadcdbda',
    'cabcacabd',
    'dbabcXdac',
    'cdbdaccbd',
    'dbcab.adb',
    'adbda.bcd',
    'XXXXXXXXX',
    'dcadacbdc',
    'XX~XXX~XX',
    'XXdXXXdXX',
    'adcadcbcd',
    'bcdbcbada',
    'cacdbdcab',
    'bdabdbaca',
  ],
  bait: { keys: [6], chain: 1 },
  gates: [6],
};

// Frozen lake: two X-locks of one row each, keys 6 then 2: two walls to pop, two friends.
const LAKE_BOSS: Chunk = {
  id: 'lake-boss',
  rows: [
    'cbabcacac',
    'acbcbXaba',
    'cacbaccac',
    'abacb.acb',
    'bacba.bac',
    'XXXXXXXXX',
    'bcbcabcac',
    'cacbcabcb',
    'bcbabcaba',
    'abaXcbcab',
    'caccacabc',
    'bca.bacab',
    'aXb.acaba',
    'XXXXXXXXX',
    'abcacacac',
    'cabcbcbca',
    'abcbabcab',
  ],
  bait: { keys: [6], chain: 1 },
  gates: [6, 2],
};

// Aurora: the last level is dry: an X-lock, a walled capsule shelf under it, then the three-step
// key piece (key 6) to earn chain air.
const AURORA_BOSS: Chunk = {
  id: 'aurora-boss',
  rows: [
    'abacbacab',
    'babacXaba',
    'abcbaccac',
    'cabcb.acb',
    'acaba.bac',
    'XXXXXXXXX',
    'XXXXXXXXX',
    'bacbcacab',
    'XXXcbcXXX',
    'XOObcaOOX',
    'XXXcacXXX',
    'cbbccacca',
    'cbcc.abbc',
    'cbbaXccab',
    'aacXb.bbc',
    'cbacaaacb',
    'bbabbbbcc',
    'bcccccbab',
    'aabbbbcac',
  ],
  bait: { keys: [6], chain: 1 },
  gates: [6],
};

// Ice slide: an X-lock (the wall costs time here), clocks on X ledges, the three-step piece.
const ICE_BOSS: Chunk = {
  id: 'ice-boss',
  rows: [
    'bcacacacb',
    'abcacXbac',
    'bcbcaccba',
    'cbaXb.acb',
    'acbca.bac',
    'XXXXXXXXX',
    'XXXXXXXXX',
    'ababacabc',
    'caOcbaOab',
    'bcXacbXca',
    'cbbccacca',
    'cbcc.abbc',
    'cbbaXccab',
    'aacXb.bbc',
    'cbacaaacb',
    'bbabbbbcc',
    'bcccccbab',
    'aabbbbcac',
  ],
  bait: { keys: [6], chain: 1 },
  gates: [6],
};

// ---------- per-stage sets ----------
// Snowy hill is a three-section tutorial (studio review item 12): 0-100m digging and pop-4,
// 100-200m stepping aside, 200-300m X blocks and boxed capsules, then a 2-chain exam.
export const SNOWY_CHUNKS: ChunkSet = {
  pool: [POP4, POP4_EDGES, STEP_ASIDE, BOXED_CAPSULE, TWO_CHAIN],
  script: [
    [POP4, POP4_EDGES, POP4],
    [STEP_ASIDE, POP4_EDGES, STEP_ASIDE],
    [BOXED_CAPSULE, X_WALL, null],
  ],
  boss: SNOWY_BOSS,
};
// Pools hold each piece once (the bag in game.ts does the rest): with the mirror image a pool of
// n pieces shows 2n variants. Key-column chains no longer hand out chain air to whoever digs
// through them, so the chain pieces kept out of the thaw cave and aurora pools (their free chain air
// lifted the greedy bot's clear, sim) are back in. Our choice; re-calibrate with the bots.
// no X wall on the igloo: an X there costs ~12% of a swing-air tank, a second X-lock before the boss
export const IGLOO_CHUNKS: ChunkSet = { pool: [TWO_CHAIN, KEY_CHAIN3, KEY_CHAIN3_4, STEP_ASIDE], boss: IGLOO_BOSS };
// Round 3 (review: 57-63% of slots repeated a piece): a run of n slots over a pool of p pieces
// repeats at least (n - p) / n, so the 14-slot 500m stages need 7+ pieces and aurora's 16 pool
// slots 8+. The 3-step pieces also give the lake a key worth finding (it had none). Our choice.
export const THAW_CHUNKS: ChunkSet = {
  pool: [THAW_DROP, STEP_ASIDE, TWO_CHAIN, KEY_CHAIN3, KEY_CHAIN3_4, X_POCKET, BOXED_CAPSULE, X_WALL],
  boss: THAW_BOSS,
};
export const LAKE_CHUNKS: ChunkSet = {
  pool: [X_POCKET, X_POCKET2, TWO_CHAIN, KEY_CHAIN3, KEY_CHAIN3_4, POP4_2C, CHAIN2_2C, STEP_ASIDE],
  boss: LAKE_BOSS,
};
export const AURORA_CHUNKS: ChunkSet = {
  pool: [X_POCKET, X_POCKET2, TWO_CHAIN, KEY_CHAIN3, KEY_CHAIN3_4, THAW_DROP, STEP_ASIDE, BOXED_CAPSULE, X_WALL],
  beforeDry: [SHELF],
  boss: AURORA_BOSS,
};
export const ICE_CHUNKS: ChunkSet = { pool: [CLOCK_LEDGE, TWO_CHAIN, STEP_ASIDE, X_WALL], boss: ICE_BOSS };
export const ENDLESS_CHUNKS: ChunkSet = {
  pool: [TWO_CHAIN, KEY_CHAIN3, KEY_CHAIN3_4, X_POCKET, X_POCKET2, THAW_DROP, STEP_ASIDE, X_WALL, POP4_2C, CHAIN2_2C, BOXED_CAPSULE],
  bosses: [IGLOO_BOSS, LAKE_BOSS, AURORA_BOSS], // the 3-colour ones: every 500m level has 3 colours
};

// every distinct piece, for the design tests
export const ALL_CHUNKS: Chunk[] = [
  POP4, POP4_EDGES, STEP_ASIDE, BOXED_CAPSULE, X_WALL, TWO_CHAIN, KEY_CHAIN3, KEY_CHAIN3_4, POP4_2C, CHAIN2_2C,
  THAW_DROP, X_POCKET, X_POCKET2, SHELF, CLOCK_LEDGE, SNOWY_BOSS, IGLOO_BOSS, THAW_BOSS, LAKE_BOSS, AURORA_BOSS, ICE_BOSS,
];
