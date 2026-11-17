// Pixel art primitives: a 3x5 sign font, small sprites drawn from character
// grids, the tier icons and the wordmark. All original, all drawn in code.

const INK = "#14151c";

// ---------------------------------------------------------------- sign font
const GLYPHS = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
  Q: "010101101111011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  0: "111101101101111", 1: "010110010010111", 2: "110001010100111", 3: "110001010001110",
  4: "101101111001001", 5: "111100110001110", 6: "011100111101111", 7: "111001010010010",
  8: "111101111101111", 9: "111101111001110",
  ".": "000000000000010", "!": "010010010000010", "?": "110001010000010", "+": "000010111010000",
  "-": "000000111000000", "%": "101001010100101", ":": "000010000010000", "/": "001001010100100",
  "'": "010010000000000", "&": "010101010101011", "#": "101111101111101", ">": "100010001010100",
  $: "011110010011110",
};

export function drawText(ctx, str, x, y, color, s = 1) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of String(str).toUpperCase()) {
    const g = GLYPHS[ch];
    if (g) for (let i = 0; i < 15; i++) if (g[i] === "1") ctx.fillRect(cx + (i % 3) * s, cy + ((i / 3) | 0) * s, s, s);
    cx += 4 * s;
  }
}
export const textW = (str, s = 1) => (String(str).length * 4 - 1) * s;

// ------------------------------------------------------------------ sprites
function mk(rows, pal) {
  const w = Math.max(...rows.map((r) => r.length));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = rows.length;
  const ctx = cv.getContext("2d");
  rows.forEach((row, y) => {
    if (row.length !== w) console.warn("[sloprillion] ragged sprite row", y, row);
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }
    }
  });
  return cv;
}

const SLIME = { o: "#1f4a2a", g: "#8fe36b", L: "#d9ffc2", d: "#5fbf4d", k: INK, m: "#1f4a2a" };

export const SPR = {
  // The mascot: a blob of slop with ambitions.
  blob: mk([
    ".....oooooo.....",
    "...ooggggggoo...",
    "..ogLLgggggggo..",
    ".ogLgggggggggdo.",
    ".oggggkggkgggdo.",
    ".oggggkggkgggdo.",
    "ogggggggggggggdo",
    "oggggggmmgggggdo",
    "ogggggggggggggdo",
    "oggggggggggggddo",
    "odggggggggggdddo",
    ".oooooooooooooo.",
  ], SLIME),
  duck: mk([
    "....yyy..",
    "...yyyky.",
    "...yyyyoo",
    "y...yyy..",
    "yy.yyyyy.",
    "yyyyyyyy.",
    ".yyyyyyy.",
    "..yyyyy..",
  ], { y: "#ffd23f", k: INK, o: "#f08a3c" }),
  palm: mk([
    "......ggg...ggg......",
    "....gggggg.gggggg....",
    "...ggg..ggggg..ggg...",
    "..gg...ggGgGgg...gg..",
    ".gg...gggGGGggg...gg.",
    ".g...ggg.GtG.ggg...g.",
    "g...gg...ttt...gg...g",
    "....g....ttt....g....",
    "...gg.....t.....gg...",
    "...g.............g...",
  ], { g: "#3f9b5a", G: "#2f7a48", t: "#7a5c3a" }),
  cursor: mk([
    "k........",
    "kk.......",
    "kwk......",
    "kwwk.....",
    "kwwwk....",
    "kwwwwk...",
    "kwwwwwk..",
    "kwwwwwwk.",
    "kwwwwkkkk",
    "kwwkwwk..",
    "kwk.kwwk.",
    "kk..kwwk.",
    ".....kk..",
  ], { k: INK, w: "#ffffff" }),
  bell: mk([
    "....y....",
    "...yyy...",
    "..yhyyy..",
    "..yhyyy..",
    "..yyyyy..",
    ".yyyyyyy.",
    "yyyyyyyyy",
    "....k....",
    "...kkk...",
  ], { y: "#ffc93c", h: "#fff1b8", k: "#7a5a12" }),
};

// --------------------------------------------------------------- tier icons
const ICONS = {
  slop: [
    "............",
    ".....xx.....",
    "....xxxx....",
    "....xxxx..x.",
    "...xxxxxx.x.",
    "..xxwxxxxxx.",
    ".xxwxxxxxxxx",
    ".xxxxxxxxxxx",
    "xxxxxxxxxxxx",
    "xxxxxxxxxxxx",
    ".xxxxxxxxxx.",
    "............",
  ],
  boilerplate: [
    ".xxxxxxxx...",
    ".xwwwwwwxx..",
    ".xwwwwwwwxx.",
    ".xwxxxxwwwx.",
    ".xwwwwwwwwx.",
    ".xwxxxxxxwx.",
    ".xwwwwwwwwx.",
    ".xwxxxxxxwx.",
    ".xwwwwwwwwx.",
    ".xwxxxxwwwx.",
    ".xwwwwwwwwx.",
    ".xxxxxxxxxx.",
  ],
  signal: [
    "............",
    "..........xx",
    "..........xx",
    ".......xx.xx",
    ".......xx.xx",
    "....xx.xx.xx",
    "....xx.xx.xx",
    ".xx.xx.xx.xx",
    ".xx.xx.xx.xx",
    ".xx.xx.xx.xx",
    ".xx.xx.xx.xx",
    "............",
  ],
  deepcut: [
    ".xxxxxxxxx..",
    ".xxwwwwxxxx.",
    ".xxwwxwxxxx.",
    ".xxwwwwxxxx.",
    ".xxxxxxxxxx.",
    ".xxxxxxxxxx.",
    ".xwwwwwwwwx.",
    ".xwxxxxxxwx.",
    ".xwwwwwwwwx.",
    ".xwxxxxxxwx.",
    ".xwwwwwwwwx.",
    ".xxxxxxxxxx.",
  ],
  ood: [
    "............",
    "..........xx",
    "..........xx",
    "...xx.......",
    "..xxxx......",
    "..x..x......",
    ".xx..xx.....",
    ".x....x.....",
    "xx....xx....",
    "x......xxxxx",
    "xxxxxxxxxxxx",
    "............",
  ],
  tenx: [
    ".....xx.....",
    ".....xx.....",
    "....xxxx....",
    "....xwxx....",
    "..xxxwxxxx..",
    "xxxxwwxxxxxx",
    "xxxxxxxxxxxx",
    "..xxxxxxxx..",
    "....xxxx....",
    "....xxxx....",
    ".....xx.....",
    ".....xx.....",
  ],
  miss: [
    "............",
    ".xx......xx.",
    ".xxx....xxx.",
    "..xxx..xxx..",
    "...xxxxxx...",
    "....xxxx....",
    "....xxxx....",
    "...xxxxxx...",
    "..xxx..xxx..",
    ".xxx....xxx.",
    ".xx......xx.",
    "............",
  ],
};

export function tierIcon(key) {
  const cv = mk(ICONS[key] || ICONS.miss, { x: INK, w: "#ffffff" });
  cv.className = "icon";
  cv.setAttribute("aria-hidden", "true");
  return cv;
}

// ----------------------------------------------------------------- wordmark
// Seven hand-drawn letters. The first four have had slop poured over them.
const LETTERS = {
  S: [".####.", "##..##", "##....", "##....", ".####.", "....##", "....##", "##..##", ".####."],
  L: ["##....", "##....", "##....", "##....", "##....", "##....", "##....", "######", "######"],
  O: [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  P: ["#####.", "##..##", "##..##", "##..##", "#####.", "##....", "##....", "##....", "##...."],
  R: ["#####.", "##..##", "##..##", "##..##", "#####.", "##.##.", "##..##", "##..##", "##..##"],
  I: ["##", "##", "##", "##", "##", "##", "##", "##", "##"],
  N: ["##..##", "###.##", "###.##", "######", "##.###", "##.###", "##..##", "##..##", "##..##"],
};

export function drawWordmark(canvas) {
  const word = "SLOPRILLION";
  const padX = 2, padTop = 1, rows = 9, hang = 3;
  const xs = [];
  let w = 0;
  for (const ch of word) { xs.push(w); w += LETTERS[ch][0].length + 1; }
  w -= 1;
  const W = w + padX * 2, H = padTop + rows + hang + 2;
  const px = new Map(); // "x,y" -> colour
  const key = (x, y) => x + "," + y;

  const GOLD = "#ffc93c", GOLD_HI = "#fff1b8", GOLD_LO = "#dc9d1c";
  const GOO = "#8fe36b", GOO_HI = "#dcffc8", GOO_LO = "#58b647";

  [...word].forEach((ch, li) => {
    LETTERS[ch].forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== "#") continue;
        let col = y === 0 ? GOLD_HI : y === rows - 1 ? GOLD_LO : GOLD;
        // slop sits on the top of S, L, O, P with a ragged lower edge
        if (li < 4 && (y < 2 || (y === 2 && (x + li) % 3 !== 1))) col = y === 0 ? GOO_HI : GOO;
        px.set(key(padX + xs[li] + x, padTop + y), col);
      }
    });
  });

  // drips: [letter, column in letter, last row]. Rows past 8 hang below the letter.
  const drips = [[0, 0, 4], [0, 5, 3], [1, 0, 6], [1, 1, 4], [2, 0, 5], [2, 5, 7], [3, 1, 11], [3, 0, 9], [3, 4, 3]];
  for (const [li, cx, last] of drips) {
    for (let y = 2; y <= last; y++) {
      const k = key(padX + xs[li] + cx, padTop + y);
      if (y >= rows || px.has(k)) px.set(k, y === last ? GOO_LO : GOO);
    }
  }

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  // outline, with a second row underneath so the letters sit on a hard shadow
  ctx.fillStyle = INK;
  for (const k of px.keys()) {
    const [x, y] = k.split(",").map(Number);
    ctx.fillRect(x - 1, y - 1, 3, 4);
  }
  for (const [k, col] of px) {
    const [x, y] = k.split(",").map(Number);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }
}
