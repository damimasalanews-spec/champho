# mobile/www

This is Capacitor's webDir, and it is deliberately almost empty.

The wrapper loads the live site (see `server.url` in capacitor.config.json) rather than
a bundled copy of it, because the game is multiplayer and its socket URL is derived from
`location.host`: a bundled copy would look for the server on the device and find
nothing. Loading the live site also means a deploy reaches installed apps immediately,
with no store review in between.

So the only file that has to exist here is `offline.html`, which is what
`server.errorPath` shows when the device has no network. The app icons and splash art
live in `android/app/src/main/res/` where Android expects them.

If you would rather ship a self-contained offline game instead, the change is to drop
`server.url`, put the site's files in here, and give the client an explicit server URL
for the socket — `mobile/www` is the place to put them.
