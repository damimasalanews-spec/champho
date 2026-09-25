/* ==========================================================================
   Champ Word — install and offline plumbing

   Loaded by every page, last, with defer. Two jobs and no more:

   1. Register the service worker, which is what makes the site installable and
      playable offline. See sw.js for what it caches and why.
   2. Hold on to the browser's install prompt so a page that wants an "Install"
      button can use it.

   It deliberately does NOT call preventDefault() on that prompt. Nothing shows an
   Install button yet, and swallowing the event would take away the browser's own
   install affordance in exchange for nothing.

   Wrapped in a guard because this file is loaded by pages that predate it:
   none of them check whether it exists, and a syntax error here must not be able
   to take a game table down with it. That is also why it never throws.
   ========================================================================== */

(function () {
    'use strict';

    // --- 1. the service worker ------------------------------------------------
    // isSecureContext gates this to https and to localhost. A worker cannot be
    // registered from file:// or from plain http on a real hostname, so attempting it
    // there is a guaranteed failure — and one that Chrome logs as a resource error
    // even though the rejected promise is handled. Skipping it keeps a page opened
    // straight off disk quiet, which matters because the arcade demo is opened that
    // way.
    if ('serviceWorker' in navigator && window.isSecureContext === true) {
        // After load, so registration never competes with the first paint. The
        // game's deal animation is already running by the time this fires.
        var register = function () {
            navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {
                /* Registration can still fail in private modes and behind some
                   proxies. The site works fine without it — it just is not installable
                   and not offline-capable — so this stays silent. */
            });
        };

        if (document.readyState === 'complete') register();
        else window.addEventListener('load', register, { once: true });
    }

    // --- 2. the install prompt ------------------------------------------------
    // Held on window.champWord and re-broadcast as an event, so a page can either
    // listen for 'champword:installable' or call champWord.promptInstall() later.
    // Both read and write the SAME slot: an earlier draft kept a closure copy and
    // the helper would have reported 'unavailable' forever.
    var champWord = window.champWord = window.champWord || {};

    champWord.installPrompt = null;
    champWord.installable = false;

    /**
     * Show the browser's install prompt.
     * Resolves to 'accepted', 'dismissed', or 'unavailable' when there is nothing
     * to show (already installed, or the browser never offered one).
     */
    champWord.promptInstall = function () {
        var event = champWord.installPrompt;
        if (!event) return Promise.resolve('unavailable');
        champWord.installPrompt = null;   // the event is single-use
        champWord.installable = false;
        event.prompt();
        return event.userChoice
            .then(function (choice) { return choice && choice.outcome ? choice.outcome : 'dismissed'; })
            .catch(function () { return 'dismissed'; });
    };

    window.addEventListener('beforeinstallprompt', function (event) {
        champWord.installPrompt = event;
        champWord.installable = true;
        try {
            window.dispatchEvent(new CustomEvent('champword:installable', { detail: event }));
        } catch (error) {
            /* CustomEvent is universally available; this is belt and braces. */
        }
    });

    window.addEventListener('appinstalled', function () {
        champWord.installPrompt = null;
        champWord.installable = false;
        hideInstallButton();
        try {
            window.dispatchEvent(new CustomEvent('champword:installed'));
        } catch (error) {
            /* as above */
        }
    });

    // --- 3. the install button ------------------------------------------------
    // A button that offers installation, and is invisible until installation is
    // actually possible. It is created from here rather than added to five pages by
    // hand for two reasons: the stylesheets of three of those pages are self-contained
    // single files, so there is nowhere to put a shared rule; and the button must not
    // exist at all on a browser that cannot install, where it would be dead weight in
    // the board layout the 1920x1080 spec fixes.
    //
    // On wild.html it mounts inside #game-stage and is positioned in the board's own
    // pixels, so it sits beside the settings gear and scales with everything else. On
    // the other four pages there is no stage, so it is fixed to the viewport corner.

    var INSTALL_CSS = [
        '.cw-install-btn{position:absolute;top:35px;right:126px;display:none;align-items:center;gap:12px;',
        'height:70px;padding:0 26px;border:3px solid #fff;border-radius:35px;cursor:pointer;',
        'background:linear-gradient(180deg,#ffd83d 0%,#f0a800 55%,#c07f00 100%);color:#3a2400;',
        'font-family:Nunito,"Segoe UI",system-ui,sans-serif;font-size:1.45rem;font-weight:900;',
        'letter-spacing:.5px;text-transform:uppercase;line-height:1;white-space:nowrap;',
        'box-shadow:0 5px 0 #8a5c00,0 12px 22px rgba(0,0,0,.42);z-index:330;',
        'transition:transform .12s ease,box-shadow .12s ease}',
        '.cw-install-btn.is-visible{display:inline-flex}',
        '.cw-install-btn:active{transform:translateY(4px);box-shadow:0 1px 0 #8a5c00,0 5px 12px rgba(0,0,0,.4)}',
        '.cw-install-btn svg{width:30px;height:30px;flex:none}',
        // No stage (the hub, classic, score, the networked client): pin it to the
        // viewport corner, and make it a touch target first and a label second.
        '.cw-install-btn.cw-fixed{position:fixed;top:14px;right:14px;height:56px;padding:0 20px;font-size:1.02rem;border-radius:28px;z-index:2147483000}',
        '.cw-install-btn.cw-fixed svg{width:24px;height:24px}',
        '@media (max-width:560px){.cw-install-btn.cw-fixed .cw-install-label{display:none}.cw-install-btn.cw-fixed{padding:0 15px}}',
        '.cw-install-hint{position:absolute;top:118px;right:126px;max-width:330px;padding:14px 18px;',
        'border-radius:16px;background:rgba(0,0,0,.86);color:#fff;font-family:Nunito,"Segoe UI",system-ui,sans-serif;',
        'font-size:1.02rem;line-height:1.5;z-index:331;display:none;box-shadow:0 10px 26px rgba(0,0,0,.45)}',
        '.cw-install-hint.is-visible{display:block}',
        '.cw-install-hint.cw-fixed{position:fixed;top:80px;right:14px;max-width:min(330px,78vw)}'
    ].join('');

    var INSTALL_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M12 3v10m0 0l-4.2-4.2M12 13l4.2-4.2M4.5 16.5V18a2.5 2.5 0 002.5 2.5h10a2.5 2.5 0 002.5-2.5v-1.5"'
        + ' fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var installButton = null;
    var installHint = null;

    function isStandalone() {
        try {
            if (window.matchMedia) {
                if (window.matchMedia('(display-mode: standalone)').matches) return true;
                if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
            }
        } catch (error) { /* matchMedia is universal; belt and braces */ }
        return navigator.standalone === true;
    }

    // iOS never fires beforeinstallprompt — installing is a manual Share-sheet action,
    // and iPadOS reports itself as a Mac. Both are covered here.
    function isIos() {
        return /iP(hone|ad|od)/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function ensureInstallButton() {
        if (installButton) return installButton;

        var style = document.createElement('style');
        style.textContent = INSTALL_CSS;
        document.head.appendChild(style);

        installButton = document.createElement('button');
        installButton.type = 'button';
        installButton.className = 'cw-install-btn';
        installButton.setAttribute('aria-label', 'Install this game as an app');
        installButton.innerHTML = INSTALL_GLYPH + '<span class="cw-install-label">Install</span>';

        // Inside the stage on the board page, so it is positioned in board pixels and
        // takes the board's scale like every other piece of furniture. On the other
        // pages there is no board, so it pins to the viewport instead.
        var stage = document.getElementById('game-stage');
        if (stage) {
            stage.appendChild(installButton);
        } else {
            installButton.classList.add('cw-fixed');
            document.body.appendChild(installButton);
        }

        installHint = document.createElement('div');
        installHint.className = 'cw-install-hint' + (stage ? '' : ' cw-fixed');
        installHint.setAttribute('role', 'status');
        installHint.textContent = 'Tap Share, then "Add to Home Screen" to install.';
        (stage || document.body).appendChild(installHint);

        installButton.addEventListener('click', function () {
            if (champWord.installPrompt) {
                champWord.promptInstall().then(function (outcome) {
                    // 'accepted' means the browser is installing; the appinstalled
                    // handler hides the button. 'dismissed' keeps it, because the player
                    // may change their mind, but the prompt itself is single-use so the
                    // button will no longer be able to open it.
                    if (outcome === 'accepted') hideInstallButton();
                    else showInstallHint('You can install any time from the browser menu.');
                });
                return;
            }
            // No prompt available: iOS, or a browser that never offered one.
            showInstallHint();
        });

        return installButton;
    }

    function showInstallHint(text) {
        ensureInstallButton();
        if (!installHint) return;
        if (text) installHint.textContent = text;
        installHint.classList.add('is-visible');
        clearTimeout(showInstallHint._timer);
        showInstallHint._timer = setTimeout(function () {
            if (installHint) installHint.classList.remove('is-visible');
        }, 7000);
    }

    function showInstallButton() {
        if (isStandalone()) return;      // already installed: never offer it
        ensureInstallButton();
        installButton.classList.add('is-visible');
    }

    function hideInstallButton() {
        if (!installButton) return;
        installButton.classList.remove('is-visible');
        if (installHint) installHint.classList.remove('is-visible');
    }

    window.addEventListener('champword:installable', showInstallButton);

    // Chrome fires beforeinstallprompt before load in some cases, and pwa.js is deferred
    // — so the event may already have been captured by the time this runs.
    if (champWord.installable) showInstallButton();

    // iOS has no event to wait for. Offer the button after load, but only on the real
    // thing: not in a desktop browser pretending to be an iPad, and not if already
    // launched from the home screen.
    if (isIos() && !isStandalone()) {
        var offerIos = function () { showInstallButton(); };
        if (document.readyState === 'complete') offerIos();
        else window.addEventListener('load', offerIos, { once: true });
    }

    // If the app is launched from the home screen while a tab is open, drop the offer.
    try {
        if (window.matchMedia) {
            var standaloneQuery = window.matchMedia('(display-mode: standalone)');
            var onModeChange = function () { if (isStandalone()) hideInstallButton(); };
            if (standaloneQuery.addEventListener) standaloneQuery.addEventListener('change', onModeChange);
            else if (standaloneQuery.addListener) standaloneQuery.addListener(onModeChange);
        }
    } catch (error) { /* as above */ }
})();
