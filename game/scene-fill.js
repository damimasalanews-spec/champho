/* ==========================================================================
   Champ Word — how far the table plate has to be zoomed to fill the frame

   The board is transparent over .viewport-frame, and the frame paints the
   illustrated plate (assets/island-table-bg.webp, 1536x1024) behind it. The plate
   is an island on water: the felt reaches the plate's own edges at its widest row
   and falls short of them everywhere else. So `cover` on its own — which fills the
   frame, but shows the plate's full WIDTH on anything wider than the plate's 3:2 —
   leaves a band of flat water down each side of the screen, and on a squarer screen
   leaves water in the corners above and below the board. Both read as a border,
   which is the one thing the layout is not allowed to have.

   The fix is to zoom the plate until the FELT — not the plate — reaches all four
   edges of the frame. How much zoom that takes depends on the frame's shape AND on
   which rows of the plate end up visible, and the two are coupled: zooming in
   narrows the visible slice of rows. So it is solved rather than tabulated per
   device. For a candidate zoom Z, `cover`'s geometry says the frame shows the plate
   columns within PLATE_W/2 ± PLATE_W/(2Z) and the rows within PLATE_H/2 ± (frame
   height / 2) / (Z x frame width / PLATE_W). Every one of those rows must have felt
   at both the frame's left and right edges, at least MARGIN columns past them. The
   first Z that satisfies that wins — which is also the least cropping, so the
   island stays as much of the picture as it can be.

   The spans below are MEASURED from the plate, not modelled from its shape: for
   every 16th row, the leftmost and rightmost column that is felt rather than water
   or rock. 16 rows is finer than the island's own taper. Between two samples the
   span is read pessimistically (the larger lo, the smaller hi), so a row that falls
   between samples is never assumed wider than the rows that bracket it.

   Loaded as a plain script by wild.html and imported by the layout test, which
   checks fillZoom's own invariant on every shape a real screen can take.
   ========================================================================== */

(function () {
    'use strict';

    var PLATE_W = 1536, PLATE_H = 1024, STEP = 16;

    // Colours that count as felt, and the water/rock that does not: measured off the
    // plate at 0.79 (hue) — see the note above. Index i is plate row i*16.
    var ISLAND_LO = [
        512, 525, 535, 543, 522, 518, 237, 249, 166, 168, 145, 152,
        121, 116, 114, 119, 64, 90, 151, 102, 86, 89, 33, 0,
        0, 0, 0, 39, 18, 78, 64, 46, 42, 73, 30, 10,
        5, 0, 16, 128, 135, 145, 150, 149, 141, 138, 176, 170,
        189, 288, 320, 324, 344, 356, 380, 404, 500, 528, 456, 440,
        708, 696, -1, -1
    ];
    var ISLAND_HI = [
        930, 933, 941, 1355, 1355, 1357, 1305, 1308, 1308, 1337, 1327, 1327,
        1360, 1396, 1401, 1444, 1425, 1477, 1492, 1502, 1495, 1497, 1501, 1535,
        1535, 1535, 1535, 1535, 1535, 1535, 1535, 1524, 1531, 1524, 1516, 1500,
        1487, 1493, 1491, 1489, 1479, 1455, 1460, 1459, 1397, 1425, 1435, 1427,
        1416, 1409, 1394, 1230, 1239, 1232, 1227, 1213, 1206, 1191, 1191, 994,
        1177, 909, -1, -1
    ];

    // How far past the frame's edge the felt has to reach, in plate columns. Not
    // zero: the spans are sampled and the felt's own edge is anti-aliased into the
    // water, so a row that measures as covered to the pixel can still render a
    // hairline of blue.
    var MARGIN = 24;

    // Beyond this the plate is mush at phone sizes, and no screen shape should need
    // it: 3:1 is already squarer than any tablet.
    var MAX_ZOOM = 3;

    /** Felt span across the plate rows [top, bottom], pessimistic between samples. */
    function feltSpan(top, bottom) {
        var i0 = Math.floor(top / STEP), i1 = Math.floor(bottom / STEP);
        if (i0 < 0 || i1 + 1 >= ISLAND_LO.length) return null;
        var lo = 0, hi = PLATE_W - 1;
        for (var i = i0; i <= i1; i++) {
            if (ISLAND_LO[i] < 0 || ISLAND_LO[i + 1] < 0) return null;
            if (ISLAND_LO[i] > lo) lo = ISLAND_LO[i];
            if (ISLAND_LO[i + 1] > lo) lo = ISLAND_LO[i + 1];
            if (ISLAND_HI[i] < hi) hi = ISLAND_HI[i];
            if (ISLAND_HI[i + 1] < hi) hi = ISLAND_HI[i + 1];
        }
        return { lo: lo, hi: hi };
    }

    /**
     * The smallest plate zoom (1 = the plate's width fills the frame) at which the
     * felt covers the whole frame, or null if no zoom up to MAX_ZOOM does — in which
     * case the caller keeps plain `cover`, which at least never leaves a gap.
     */
    function fillZoom(frameW, frameH, margin) {
        if (!(frameW > 0) || !(frameH > 0)) return null;
        var m = margin == null ? MARGIN : margin;
        // `cover`'s own floor: below this the plate does not even fill the frame.
        var zMin = Math.max(1, (frameH / frameW) * (PLATE_W / PLATE_H));
        for (var z = zMin; z <= MAX_ZOOM + 1e-9; z += 0.01) {
            var halfCols = PLATE_W / (2 * z), halfRows = ((frameH / 2) * PLATE_W) / (z * frameW);
            var span = feltSpan(PLATE_H / 2 - halfRows, PLATE_H / 2 + halfRows);
            if (!span) continue;
            if (span.lo > PLATE_W / 2 - halfCols - m) continue;
            if (span.hi < PLATE_W / 2 + halfCols + m) continue;
            return Math.round(z * 100) / 100;
        }
        return null;
    }

    var api = { fillZoom: fillZoom, PLATE_W: PLATE_W, PLATE_H: PLATE_H, STEP: STEP,
                ISLAND_LO: ISLAND_LO, ISLAND_HI: ISLAND_HI, MARGIN: MARGIN, MAX_ZOOM: MAX_ZOOM };
    if (typeof window !== 'undefined') window.ChampWordSceneFill = api;
    if (typeof globalThis !== 'undefined') globalThis.ChampWordSceneFill = api;
})();
