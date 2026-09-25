/* ==========================================================================
   Champ Word — the card set's marks, and the one builder that draws a face

   The card set is drawn, not painted: every face is the stylesheet's colour field,
   emblem and gloss plus the marks in here. That is what makes a card the same
   object at 137px in a hand and at 600px on an asset sheet, and it is why there is
   no artwork to re-export when a size changes.

   ORIGINALITY. None of these marks is UNO's. The skip is a pause — two bars with
   the turn moving on beneath them — rather than a circle with a slash through it.
   The reverse is one bold U-turn arrow rather than two arrows chasing each other.
   The draw two is two cards sliding in behind the count rather than the official
   two-card motif. The wild is a four-petal pinwheel in the four colours around a
   white core rather than a four-colour oval. Same genre, drawn again from scratch:
   the brief for this set asked for the energy of the genre without its artwork, and
   the two places the table used to borrow the real thing — a face band described in
   the sheet as "the classic UNO card face", and a card back with the UNO wordmark in
   a tilted oval — are gone.

   Loaded by wild.html and by cards.html (the asset sheet), so the sheet and the
   game cannot drift apart: they are the same builder over the same stylesheet.
   ========================================================================== */

(function () {
    'use strict';

    // Bodies only, wrapped by glyphSvg() — one set of path data draws both the card's
    // centre symbol at 68% of the card and the tiny mark in each of its corners.
    var GLYPH_BODY = {
        skip: '<g fill="#ffffff">'
            + '<rect x="27" y="15" width="17" height="55" rx="8.5"/>'
            + '<rect x="56" y="15" width="17" height="55" rx="8.5"/>'
            + '</g>'
            + '<path d="M15 84 C35 94 65 94 85 84" fill="none" stroke="#ffffff"'
            + ' stroke-opacity=".88" stroke-width="9" stroke-linecap="round"/>',
        reverse: '<path d="M30 86 L30 46 A20 20 0 0 1 70 46 L70 60" fill="none"'
            + ' stroke="#ffffff" stroke-width="15" stroke-linecap="round"/>'
            + '<path d="M54 56 L86 56 L70 88 Z" fill="#ffffff" stroke="#ffffff"'
            + ' stroke-width="7" stroke-linejoin="round"/>',
        draw2: '<g fill="rgba(255,255,255,.20)" stroke="rgba(255,255,255,.78)"'
            + ' stroke-width="6" stroke-linejoin="round">'
            + '<rect x="30" y="14" width="52" height="70" rx="12" transform="rotate(9 56 49)"/>'
            + '<rect x="18" y="20" width="52" height="70" rx="12" transform="rotate(-9 44 55)"/>'
            + '</g>',
        discard_all: '<g fill="rgba(255,255,255,.24)" stroke="#ffffff"'
            + ' stroke-width="6" stroke-linejoin="round">'
            + '<rect x="20" y="24" width="46" height="62" rx="11" transform="rotate(-19 43 55)"/>'
            + '<rect x="34" y="24" width="46" height="62" rx="11" transform="rotate(19 57 55)"/>'
            + '</g>'
            + '<path d="M50 26 C53 38 58 43 70 46 C58 49 53 54 50 66 C47 54 42 49 30 46'
            + ' C42 43 47 38 50 26 Z" fill="#ffffff" fill-opacity=".95"/>',
        wild: wildPinwheel(''),
        wild4: wildPinwheel('<rect x="22" y="35" width="56" height="30" rx="15" fill="#ffffff"/>'
            + '<text x="50" y="57" text-anchor="middle" font-family="Nunito, sans-serif"'
            + ' font-size="21" font-weight="900" fill="#14161c">+4</text>')
    };

    /** Four petals in the four colours around a white core — the wild symbol. */
    function wildPinwheel(centre) {
        return '<g stroke="#ffffff" stroke-width="4.5" stroke-linejoin="round">'
            + '<path d="M50 50 C50 24 62 9 85 9 C85 33 73 48 50 50 Z" fill="#ff4646"/>'
            + '<path d="M50 50 C76 50 91 62 91 85 C67 85 52 73 50 50 Z" fill="#ffd42a"/>'
            + '<path d="M50 50 C50 76 38 91 15 91 C15 67 27 52 50 50 Z" fill="#34d35f"/>'
            + '<path d="M50 50 C24 50 9 38 9 15 C33 15 48 27 50 50 Z" fill="#3b8bff"/>'
            + '</g>'
            + '<circle cx="50" cy="50" r="12.5" fill="#ffffff"/>'
            + centre;
    }

    /** Wraps a body for either the card's centre mark or its corner mark. */
    function glyphSvg(kind, cls) {
        var body = GLYPH_BODY[kind];
        if (!body) return '';
        return '<svg class="' + cls + '" viewBox="0 0 100 100" aria-hidden="true"'
            + ' focusable="false">' + body + '</svg>';
    }

    /** Which symbol a card wears, from its type, with the demo's emoji as fallback. */
    function glyphKind(card) {
        var type = String(card && card.type ? card.type : '');
        var value = String(card && card.value != null ? card.value : '');
        if (type === 'skip' || value === '\uD83D\uDEAB') return 'skip';
        if (type === 'reverse' || value === '\uD83D\uDD01') return 'reverse';
        if (type === 'draw2' || value === '+2') return 'draw2';
        if (type === 'discard_all' || value === 'ALL') return 'discard_all';
        if (type === 'wild4' || value === '+4' || value === 'W4') return 'wild4';
        if (type === 'wild' || value === '\u2605' || value === 'W') return 'wild';
        return '';
    }

    /** The four face colours, in the order the palette is documented in. */
    var COLOURS = ['red', 'yellow', 'green', 'blue'];

    function escapeCardText(text) {
        return String(text).replace(/[&<>"]/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
        });
    }

    /**
     * The inside of one card face, as markup.
     *
     * One builder for all of them — the local hand, the partner's fan, the thrown card
     * and the discard pile — so a card cannot be a different card depending on where it
     * is on the table. That is exactly how the old faces drifted: four call sites, each
     * assembling its own value and corners, and only some of them knowing about the
     * action sizes.
     *
     * Numbers carry the digit in the centre and in both corners. The two "+" cards and
     * "ALL" carry their count over their symbol, because the count is what a player reads
     * from the far seat. SKIP and REVERSE have no reading beyond the symbol, so their
     * corners repeat a small copy of it rather than inventing a letter for it.
     */
    function cardFaceHtml(card) {
        var kind = glyphKind(card);
        var value = escapeCardText(card && card.value != null ? card.value : '');
        var centre = '';
        if (!kind) centre = '<div class="card-value">' + value + '</div>';
        else if (kind === 'draw2') centre = '<div class="card-value action-symbol draw-count">+2</div>';
        else if (kind === 'discard_all') centre = '<div class="card-value action-symbol">ALL</div>';

        var corner;
        if (kind === 'skip' || kind === 'reverse' || kind === 'wild') corner = glyphSvg(kind, 'mini-glyph');
        else if (kind === 'wild4') corner = '+4';
        else if (kind === 'draw2') corner = '+2';
        else if (kind === 'discard_all') corner = 'ALL';
        else corner = value;

        var glyphClass = 'card-glyph' + (kind === 'wild' || kind === 'wild4' ? ' is-wild' : '');
        return centre
            + glyphSvg(kind, glyphClass)
            + '<div class="corner-value corner-top-left">' + corner + '</div>'
            + '<div class="corner-value corner-bottom-right">' + corner + '</div>';
    }

    /** The same face, painted onto an element: the game's own entry point. */
    function paintCardFace(el, card) {
        if (!el) return el;
        if (card && card.type === 'discard_all') el.classList.add('discard-all');
        el.innerHTML = cardFaceHtml(card);
        return el;
    }

    var api = {
        GLYPH_BODY: GLYPH_BODY, COLOURS: COLOURS,
        glyphSvg: glyphSvg, glyphKind: glyphKind,
        cardFaceHtml: cardFaceHtml, paintCardFace: paintCardFace,
        escapeCardText: escapeCardText
    };
    if (typeof window !== 'undefined') window.ChampCards = api;
    if (typeof globalThis !== 'undefined') globalThis.ChampCards = api;
})();
