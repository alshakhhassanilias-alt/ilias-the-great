/**
 * Steam: achievements, the overlay and the player's name. The game runs the same without Steam (started from
 * the folder, or Steam not running): every call then quietly does nothing.
 *
 * The app id comes from STEAM_APP_ID, or steam_appid.txt next to the executable (for testing), or 480
 * (Valve's public test app, "Spacewar") during development. Steam sets it itself when it launches the game.
 */
const fs = require('node:fs');
const path = require('node:path');

let client = null;
let appId = 0;
let lastError = '';

function readAppId(baseDir) {
  if (process.env.STEAM_APP_ID) return Number(process.env.STEAM_APP_ID);
  for (const dir of [path.dirname(process.execPath), baseDir, process.cwd()]) {
    try { const v = Number(fs.readFileSync(path.join(dir, 'steam_appid.txt'), 'utf8').trim()); if (v > 0) return v; } catch { /* not there */ }
  }
  return 480;
}

function init(baseDir) {
  try {
    const steamworks = require('steamworks.js');
    appId = readAppId(baseDir);
    client = steamworks.init(appId);
    // the Shift+Tab overlay inside the game window (must be called before any window is created)
    steamworks.electronEnableSteamOverlay();
    return true;
  } catch (e) {
    client = null;
    lastError = String(e && e.message ? e.message : e);
    return false;
  }
}

function status() {
  if (!client) return { on: false, error: lastError };
  let user;
  try { user = client.localplayer.getName(); } catch { /* ignore */ }
  return { on: true, user, appId };
}

function achieve(id) {
  if (!client) return false;
  try {
    if (client.achievement.isActivated(id)) return true;
    return client.achievement.activate(id);
  } catch { return false; }
}

module.exports = { init, status, achieve };
