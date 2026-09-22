/**
 * Doodles for artist bots (§16–19 extension).
 *
 * The artist rotates around the table, and in a room of one human plus bots
 * three of every four turns fall to a bot. Bots have no pointer to draw with, so
 * before this file existed a bot turn showed an empty board that nobody could
 * solve — the "no drawing in the board" bug.
 *
 * Bots now sketch the target word using exactly the stroke format clients send
 * in `draw_op` ({ points: [[x,y]…], color, width }, normalised to the board), so
 * the server can store and replay them through `draw_sync` unchanged. The engine
 * deals bot artists only words listed in {@link DRAWABLE_WORDS}, which keeps a
 * bot turn drawable by construction.
 */

export type DoodleStroke = { points: [number, number][]; color: string; width: number };

/** Templates are authored on a 560x320 grid (the displayed board size) so that
 *  circles stay circular once the canvas scales them. */
const GRID_W = 560;
const GRID_H = 320;

const INK = "#12303f";
const GREEN = "#2f7d4f";
const ORANGE = "#d98324";
const BLUE = "#2b6cb0";
const YELLOW = "#dcae2b";
const RED = "#c0392b";

type Pt = [number, number];

/** Templates stay in grid coordinates; {@link doodleFor} fits and normalises. */
const stroke = (points: Pt[], color: string = INK, width = 4): DoodleStroke => ({
  points,
  color,
  width
});

const line = (x1: number, y1: number, x2: number, y2: number, color: string = INK, width = 4): DoodleStroke =>
  stroke([[x1, y1], [x2, y2]], color, width);

const shape = (points: Pt[], color: string = INK, width = 4): DoodleStroke =>
  stroke([...points, points[0] as Pt], color, width);

const dot = (x: number, y: number, color: string = INK, width = 9): DoodleStroke => ({
  points: [[x, y]],
  color,
  width
});

function oval(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string = INK,
  width = 4,
  from = 0,
  to = Math.PI * 2
): DoodleStroke {
  const steps = Math.max(6, Math.round(36 * (Math.abs(to - from) / (Math.PI * 2))));
  const points: Pt[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = from + (to - from) * (i / steps);
    points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return stroke(points, color, width);
}

function rays(cx: number, cy: number, inner: number, outer: number, count = 8, color: string = ORANGE): DoodleStroke[] {
  const out: DoodleStroke[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count;
    out.push(
      line(
        cx + inner * Math.cos(angle),
        cy + inner * Math.sin(angle),
        cx + outer * Math.cos(angle),
        cy + outer * Math.sin(angle),
        color,
        5
      )
    );
  }
  return out;
}

function snowflake(cx: number, cy: number, r: number, color: string = BLUE): DoodleStroke[] {
  const out: DoodleStroke[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = (Math.PI * i) / 3;
    out.push(line(cx - r * Math.cos(angle), cy - r * Math.sin(angle), cx + r * Math.cos(angle), cy + r * Math.sin(angle), color, 4));
  }
  return out;
}

/** Margin kept around a sketch, in 560x320 board units. */
const FIT_MARGIN = 16;

/**
 * Centre a sketch on the board and scale it up until it fills the space. Without
 * this a doodle landed as a small mark in the middle of a much larger board —
 * the templates are authored roughly a third of the board wide, and the board on
 * the table is the whole canvas. A uniform scale is used on the grid (560x320,
 * the board's own aspect) so shapes never stretch.
 */
function fitToBoard(strokes: DoodleStroke[]): DoodleStroke[] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const item of strokes) {
    for (const [x, y] of item.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return strokes;

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((GRID_W - FIT_MARGIN * 2) / spanX, (GRID_H - FIT_MARGIN * 2) / spanY);
  const offsetX = GRID_W / 2 - (minX + spanX / 2) * scale;
  const offsetY = GRID_H / 2 - (minY + spanY / 2) * scale;
  const round = (value: number): number => Math.round(value * 10000) / 10000;

  return strokes.map((item) => ({
    color: item.color,
    // Slightly heavier line for the larger drawing, capped so it stays a pen.
    width: Math.min(9, Math.round(item.width * 1.4)) || item.width,
    points: item.points.map(([x, y]) => [round(x * scale + offsetX), round(y * scale + offsetY)] as Pt)
  }));
}

/** Grid coordinates -> the 0..1 space the client maps onto the board. */
function toNormalized(strokes: DoodleStroke[]): DoodleStroke[] {
  const round = (value: number): number => Math.round(value * 10000) / 10000;
  return strokes.map((item) => ({
    color: item.color,
    width: item.width,
    points: item.points.map(([x, y]) => [round(x / GRID_W), round(y / GRID_H)] as Pt)
  }));
}

/** Word -> sketch. Only words listed here are ever dealt to a bot artist. */
export const DOODLES: Record<string, DoodleStroke[]> = {
  sun: [oval(280, 160, 60, 60, ORANGE, 6), ...rays(280, 160, 72, 104)],
  moon: [
    oval(285, 160, 66, 66, YELLOW, 6, Math.PI * 0.35, Math.PI * 1.65),
    oval(318, 138, 74, 74, YELLOW, 6, Math.PI * 0.92, Math.PI * 1.92)
  ],
  star: [
    shape(
      Array.from({ length: 10 }, (_, i) => {
        const angle = -Math.PI / 2 + (Math.PI * i) / 5;
        const radius = i % 2 === 0 ? 86 : 36;
        return [280 + radius * Math.cos(angle), 168 + radius * Math.sin(angle)] as Pt;
      }),
      YELLOW,
      5
    )
  ],
  cloud: [
    oval(220, 150, 52, 44, "#9fb4c4", 5, Math.PI * 0.75, Math.PI * 2.25),
    oval(286, 132, 60, 50, "#9fb4c4", 5, Math.PI, Math.PI * 2.15),
    oval(350, 152, 48, 40, "#9fb4c4", 5, Math.PI * 1.15, Math.PI * 2.5),
    line(196, 186, 372, 186, "#9fb4c4", 5)
  ],
  rain: [
    oval(224, 116, 46, 38, "#9fb4c4", 5, Math.PI * 0.8, Math.PI * 2.2),
    oval(288, 100, 52, 44, "#9fb4c4", 5, Math.PI, Math.PI * 2.1),
    oval(344, 118, 42, 36, "#9fb4c4", 5, Math.PI * 1.1, Math.PI * 2.5),
    line(200, 148, 366, 148, "#9fb4c4", 5),
    line(224, 176, 208, 226, BLUE, 5),
    line(268, 176, 252, 226, BLUE, 5),
    line(312, 176, 296, 226, BLUE, 5),
    line(356, 176, 340, 226, BLUE, 5),
    line(206, 254, 358, 254, BLUE, 4)
  ],
  snow: [
    ...snowflake(190, 140, 44),
    ...snowflake(288, 196, 52),
    ...snowflake(382, 128, 40),
    line(150, 268, 418, 268, "#c9d8e2", 5)
  ],
  tree: [
    line(280, 268, 280, 196, "#6b4b2a", 8),
    oval(280, 140, 74, 66, GREEN, 5),
    oval(238, 158, 50, 44, GREEN, 5),
    oval(324, 158, 50, 44, GREEN, 5),
    oval(280, 108, 48, 42, GREEN, 5)
  ],
  leaf: [
    shape(
      [
        [246, 250],
        [262, 168],
        [300, 118],
        [338, 130],
        [352, 192],
        [310, 240],
        [268, 252]
      ],
      GREEN,
      5
    ),
    line(252, 246, 344, 140, GREEN, 4),
    line(292, 196, 268, 176, GREEN, 3),
    line(306, 172, 336, 176, GREEN, 3)
  ],
  fish: [
    shape(
      [
        [186, 160],
        [232, 120],
        [300, 112],
        [352, 146],
        [352, 174],
        [300, 206],
        [232, 200]
      ],
      BLUE,
      5
    ),
    shape(
      [
        [352, 146],
        [404, 112],
        [404, 208],
        [352, 174]
      ],
      BLUE,
      5
    ),
    dot(238, 150, INK, 10),
    shape(
      [
        [262, 112],
        [286, 88],
        [306, 112]
      ],
      BLUE,
      4
    )
  ],
  bird: [
    oval(268, 168, 66, 48, INK, 5),
    oval(332, 132, 26, 26, INK, 5),
    shape(
      [
        [356, 124],
        [388, 132],
        [356, 142]
      ],
      ORANGE,
      4
    ),
    oval(268, 156, 42, 24, "#7f9aa8", 4, Math.PI * 0.1, Math.PI * 0.9),
    line(250, 212, 250, 244, INK, 4),
    line(292, 212, 292, 244, INK, 4),
    dot(338, 126, INK, 8)
  ],
  cat: [
    oval(280, 176, 74, 64, INK, 5),
    shape(
      [
        [216, 132],
        [222, 78],
        [268, 108]
      ],
      INK,
      4
    ),
    shape(
      [
        [344, 132],
        [338, 78],
        [292, 108]
      ],
      INK,
      4
    ),
    dot(254, 164, INK, 10),
    dot(306, 164, INK, 10),
    shape(
      [
        [268, 194],
        [292, 194],
        [280, 206]
      ],
      RED,
      3
    ),
    line(280, 208, 280, 220, INK, 3),
    line(262, 190, 208, 178, INK, 3),
    line(262, 200, 208, 204, INK, 3),
    line(298, 190, 352, 178, INK, 3),
    line(298, 200, 352, 204, INK, 3)
  ],
  dog: [
    oval(280, 172, 70, 62, INK, 5),
    oval(206, 148, 30, 52, INK, 5),
    oval(354, 148, 30, 52, INK, 5),
    oval(280, 206, 32, 24, INK, 4),
    dot(256, 158, INK, 9),
    dot(304, 158, INK, 9),
    dot(280, 200, INK, 12),
    line(280, 214, 280, 232, INK, 3)
  ],
  tiger: [
    oval(280, 172, 76, 66, ORANGE, 5),
    shape(
      [
        [212, 128],
        [218, 74],
        [264, 106]
      ],
      ORANGE,
      4
    ),
    shape(
      [
        [348, 128],
        [342, 74],
        [296, 106]
      ],
      ORANGE,
      4
    ),
    dot(254, 160, INK, 10),
    dot(306, 160, INK, 10),
    line(266, 196, 294, 196, INK, 4),
    line(230, 132, 214, 108, INK, 3),
    line(280, 112, 280, 92, INK, 3),
    line(330, 132, 346, 108, INK, 3)
  ],
  bee: [
    oval(280, 172, 66, 48, YELLOW, 5),
    line(238, 142, 322, 142, INK, 5),
    line(230, 172, 330, 172, INK, 5),
    line(238, 202, 322, 202, INK, 5),
    oval(244, 118, 40, 26, "#cfe6f2", 4, Math.PI, Math.PI * 2),
    oval(316, 118, 40, 26, "#cfe6f2", 4, Math.PI, Math.PI * 2),
    line(266, 128, 252, 96, INK, 3),
    line(300, 128, 314, 96, INK, 3),
    dot(252, 96, INK, 7),
    dot(314, 96, INK, 7)
  ],
  ant: [
    oval(230, 190, 30, 26, INK, 5),
    oval(286, 178, 24, 22, INK, 5),
    oval(336, 166, 34, 30, INK, 5),
    line(212, 200, 176, 226, INK, 3),
    line(230, 208, 210, 246, INK, 3),
    line(262, 196, 240, 234, INK, 3),
    line(310, 194, 330, 236, INK, 3),
    line(340, 190, 362, 224, INK, 3),
    line(344, 146, 320, 112, INK, 3),
    line(352, 148, 378, 112, INK, 3)
  ],
  house: [
    shape(
      [
        [186, 172],
        [374, 172],
        [374, 282],
        [186, 282]
      ],
      INK,
      5
    ),
    shape(
      [
        [170, 172],
        [280, 88],
        [390, 172]
      ],
      RED,
      5
    ),
    shape(
      [
        [256, 282],
        [256, 216],
        [306, 216],
        [306, 282]
      ],
      "#6b4b2a",
      4
    ),
    shape(
      [
        [208, 200],
        [244, 200],
        [244, 232],
        [208, 232]
      ],
      BLUE,
      4
    ),
    line(330, 196, 348, 196, INK, 4),
    line(330, 220, 348, 220, INK, 4),
    shape(
      [
        [214, 130],
        [214, 96],
        [248, 96],
        [248, 112]
      ],
      INK,
      4
    )
  ],
  cup: [
    shape(
      [
        [222, 150],
        [338, 150],
        [322, 268],
        [238, 268]
      ],
      INK,
      5
    ),
    line(214, 150, 346, 150, INK, 5),
    oval(340, 200, 32, 34, INK, 5, -Math.PI * 0.5, Math.PI * 0.5),
    line(232, 132, 250, 132, "#9fb4c4", 4),
    line(262, 122, 280, 122, "#9fb4c4", 4),
    line(212, 284, 348, 284, INK, 4)
  ],
  key: [
    oval(238, 150, 44, 44, YELLOW, 6),
    oval(238, 150, 20, 20, YELLOW, 5),
    line(282, 150, 392, 150, YELLOW, 7),
    line(360, 150, 360, 190, YELLOW, 7),
    line(388, 150, 388, 182, YELLOW, 7)
  ],
  box: [
    shape(
      [
        [196, 176],
        [330, 176],
        [330, 274],
        [196, 274]
      ],
      "#a9754a",
      5
    ),
    shape(
      [
        [196, 176],
        [244, 132],
        [378, 132],
        [330, 176]
      ],
      "#c08a58",
      5
    ),
    shape(
      [
        [330, 176],
        [378, 132],
        [378, 230],
        [330, 274]
      ],
      "#8d5f3a",
      5
    ),
    line(244, 132, 244, 152, INK, 3),
    line(330, 176, 378, 132, INK, 3)
  ],
  egg: [oval(280, 176, 72, 92, INK, 6)],
  hat: [
    line(180, 224, 380, 224, INK, 5),
    shape(
      [
        [222, 224],
        [228, 116],
        [332, 116],
        [338, 224]
      ],
      INK,
      5
    ),
    line(226, 190, 334, 190, RED, 6)
  ],
  bus: [
    shape(
      [
        [172, 132],
        [388, 132],
        [388, 226],
        [172, 226]
      ],
      YELLOW,
      5
    ),
    shape(
      [
        [190, 150],
        [232, 150],
        [232, 186],
        [190, 186]
      ],
      "#cfe6f2",
      4
    ),
    shape(
      [
        [248, 150],
        [290, 150],
        [290, 186],
        [248, 186]
      ],
      "#cfe6f2",
      4
    ),
    shape(
      [
        [306, 150],
        [348, 150],
        [348, 186],
        [306, 186]
      ],
      "#cfe6f2",
      4
    ),
    oval(214, 238, 26, 26, INK, 5),
    oval(346, 238, 26, 26, INK, 5),
    line(172, 206, 388, 206, INK, 3)
  ],
  lamp: [
    shape(
      [
        [216, 128],
        [344, 128],
        [370, 196],
        [190, 196]
      ],
      ORANGE,
      5
    ),
    line(280, 196, 280, 262, INK, 5),
    line(232, 268, 328, 268, INK, 5),
    line(232, 150, 250, 150, YELLOW, 5),
    line(286, 150, 304, 150, YELLOW, 5),
    line(190, 216, 172, 240, YELLOW, 4),
    line(370, 216, 388, 240, YELLOW, 4)
  ],
  kite: [
    shape(
      [
        [280, 74],
        [364, 158],
        [280, 250],
        [196, 158]
      ],
      RED,
      5
    ),
    line(280, 74, 280, 250, INK, 3),
    line(196, 158, 364, 158, INK, 3),
    stroke(
      [
        [280, 250],
        [300, 274],
        [268, 288],
        [292, 306]
      ],
      INK,
      3
    )
  ],
  ship: [
    shape(
      [
        [166, 214],
        [394, 214],
        [352, 268],
        [208, 268]
      ],
      "#8d5f3a",
      5
    ),
    line(280, 76, 280, 214, INK, 5),
    shape(
      [
        [292, 96],
        [292, 206],
        [368, 206]
      ],
      "#cfe6f2",
      4
    ),
    shape(
      [
        [268, 122],
        [268, 206],
        [212, 206]
      ],
      "#cfe6f2",
      4
    ),
    line(140, 288, 214, 288, BLUE, 4),
    line(246, 288, 320, 288, BLUE, 4),
    line(352, 288, 426, 288, BLUE, 4)
  ],
  clock: [
    oval(280, 168, 80, 80, INK, 6),
    line(280, 168, 280, 116, INK, 5),
    line(280, 168, 324, 186, INK, 5),
    line(280, 92, 280, 104, INK, 4),
    line(280, 232, 280, 244, INK, 4),
    line(204, 168, 216, 168, INK, 4),
    line(344, 168, 356, 168, INK, 4)
  ],
  chair: [
    shape(
      [
        [206, 186],
        [354, 186],
        [354, 216],
        [206, 216]
      ],
      "#a9754a",
      5
    ),
    shape(
      [
        [206, 110],
        [354, 110],
        [354, 186],
        [206, 186]
      ],
      "#c08a58",
      5
    ),
    line(218, 110, 218, 190, "#c08a58", 4),
    line(280, 110, 280, 190, "#c08a58", 4),
    line(342, 110, 342, 190, "#c08a58", 4),
    line(216, 216, 216, 272, "#8d5f3a", 5),
    line(344, 216, 344, 272, "#8d5f3a", 5)
  ],
  net: [
    shape(
      [
        [196, 110],
        [364, 110],
        [364, 250],
        [196, 250]
      ],
      INK,
      5
    ),
    line(238, 110, 238, 250, INK, 3),
    line(280, 110, 280, 250, INK, 3),
    line(322, 110, 322, 250, INK, 3),
    line(196, 152, 364, 152, INK, 3),
    line(196, 194, 364, 194, INK, 3),
    line(196, 236, 364, 236, INK, 3)
  ],
  pen: [
    shape(
      [
        [186, 226],
        [352, 116],
        [368, 134],
        [202, 244]
      ],
      BLUE,
      5
    ),
    shape(
      [
        [186, 226],
        [202, 244],
        [172, 256]
      ],
      INK,
      5
    ),
    line(330, 136, 348, 154, INK, 3),
    line(300, 158, 320, 176, INK, 3)
  ],
  map: [
    shape(
      [
        [166, 116],
        [394, 100],
        [394, 250],
        [166, 266]
      ],
      "#e6d5b8",
      5
    ),
    line(242, 112, 242, 262, INK, 3),
    line(316, 106, 316, 256, INK, 3),
    stroke(
      [
        [190, 236],
        [216, 206],
        [252, 216],
        [286, 178],
        [322, 186],
        [352, 146]
      ],
      RED,
      4
    ),
    line(340, 220, 372, 244, INK, 4),
    line(372, 220, 340, 244, INK, 4)
  ],
  fire: [
    shape(
      [
        [280, 88],
        [318, 150],
        [344, 208],
        [318, 258],
        [280, 272],
        [240, 258],
        [216, 208],
        [244, 150]
      ],
      RED,
      5
    ),
    shape(
      [
        [280, 152],
        [302, 196],
        [300, 232],
        [270, 240],
        [252, 210],
        [262, 180]
      ],
      ORANGE,
      4
    ),
    dot(238, 122, YELLOW, 8),
    dot(330, 132, YELLOW, 8)
  ],
  robot: [
    shape(
      [
        [238, 128],
        [322, 128],
        [322, 196],
        [238, 196]
      ],
      "#9fb4c4",
      5
    ),
    dot(262, 158, INK, 10),
    dot(298, 158, INK, 10),
    line(258, 180, 302, 180, INK, 4),
    line(280, 128, 280, 100, INK, 4),
    dot(280, 94, RED, 9),
    shape(
      [
        [216, 204],
        [344, 204],
        [344, 274],
        [216, 274]
      ],
      "#7f9aa8",
      5
    ),
    line(246, 220, 246, 258, INK, 3),
    line(280, 220, 280, 258, INK, 3),
    line(314, 220, 314, 258, INK, 3)
  ],
  daisy: [
    oval(280, 150, 30, 30, YELLOW, 6),
    oval(280, 96, 26, 34, "#e8e2ea", 4),
    oval(342, 130, 34, 26, "#e8e2ea", 4),
    oval(320, 204, 30, 32, "#e8e2ea", 4),
    oval(240, 204, 30, 32, "#e8e2ea", 4),
    oval(218, 130, 34, 26, "#e8e2ea", 4),
    line(280, 180, 280, 284, GREEN, 5),
    oval(238, 236, 34, 18, GREEN, 4, Math.PI, Math.PI * 2)
  ],
  car: [
    shape(
      [
        [166, 216],
        [196, 160],
        [348, 160],
        [394, 216]
      ],
      BLUE,
      5
    ),
    shape(
      [
        [196, 160],
        [388, 160],
        [388, 216],
        [196, 216]
      ],
      BLUE,
      5
    ),
    shape(
      [
        [226, 160],
        [250, 132],
        [330, 132],
        [344, 160]
      ],
      "#cfe6f2",
      4
    ),
    oval(222, 226, 26, 26, INK, 5),
    oval(340, 226, 26, 26, INK, 5)
  ]
};

export const DRAWABLE_WORDS: readonly string[] = Object.keys(DOODLES).sort();

const cache = new Map<string, DoodleStroke[]>();

/** Strokes for a word, or null when the word has no template. */
export function doodleFor(word: string): DoodleStroke[] | null {
  const key = String(word ?? "").trim().toLowerCase();
  if (!key) return null;
  const cached = cache.get(key);
  if (cached) return cached;
  const template = DOODLES[key];
  if (!template) return null;
  // Copy so callers can never mutate the template, then scale it to the board.
  const fitted = fitToBoard(
    template.map((s) => ({
      points: s.points.map(([x, y]) => [x, y] as Pt),
      color: s.color,
      width: s.width
    }))
  );
  const copy = toNormalized(fitted);
  cache.set(key, copy);
  return copy;
}

export function isDrawable(word: string): boolean {
  return doodleFor(word) !== null;
}
