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
        try {
            window.dispatchEvent(new CustomEvent('champword:installed'));
        } catch (error) {
            /* as above */
        }
    });
})();
