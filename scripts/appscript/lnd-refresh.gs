/**
 * L&D sheet → dashboard refresh trigger.
 *
 * The dashboard already pulls this sheet on its own every hour (pg_cron job
 * `lnd-sync-hourly` at :23, calling the `sync-lnd` edge function, which reads the
 * published-to-web CSV). This script is NOT what makes the data arrive — it just
 * makes it arrive *immediately* after you finish the weekly update, instead of you
 * waiting up to an hour to see it.
 *
 * Because the pull is the reliable path and this is only a nudge, a failure here is
 * harmless: the hourly cron still catches everything.
 *
 * ── Setup (once) ────────────────────────────────────────────────────────────────
 *  1. Open the L&D spreadsheet → Extensions → Apps Script.
 *  2. Paste this file in, save.
 *  3. Run `setUpTriggers` once and approve the permission prompt.
 *  4. Confirm under Triggers (clock icon) that two triggers now exist.
 *
 * ── Important ───────────────────────────────────────────────────────────────────
 *  The sheet must stay **published to the web** (File → Share → Publish to web,
 *  this tab, CSV). If publishing is ever turned off, the sync fails loudly and
 *  writes the reason to `sync_runs` — it will not silently show stale numbers.
 *
 *  Keep SYNC_URL out of anything public: the token in it is the only thing
 *  authorising the refresh.
 */

var SYNC_URL = 'https://hsmuxmvhgteexanssigc.supabase.co/functions/v1/sync-lnd'
    + '?token=syncLndHub_4e8b21&year=2026';

/** Ping the sync endpoint. Logs the outcome; never throws into the sheet UI. */
function refreshLnd() {
  try {
    var res = UrlFetchApp.fetch(SYNC_URL, { muteHttpExceptions: true });
    var code = res.getResponseCode();
    var body = res.getContentText();
    Logger.log('sync-lnd → HTTP ' + code + ' ' + body);
    if (code !== 200) {
      // Surfaced in Apps Script's own failure notifications; the hourly cron is
      // still the safety net, so we do not retry here.
      console.error('L&D sync failed: HTTP ' + code + ' — ' + body);
    }
    return body;
  } catch (err) {
    console.error('L&D sync could not reach the endpoint: ' + err);
  }
}

/**
 * Fires on edit, but debounced: an actual refresh runs at most once every
 * QUIET_MINUTES. Without this, pasting a 30-row weekly block would fire dozens of
 * requests. The trailing hourly cron guarantees the final state still lands.
 */
var QUIET_MINUTES = 3;

function onSheetEdit(e) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('lastRefreshMs') || 0);
  var now = Date.now();
  if (now - last < QUIET_MINUTES * 60 * 1000) return;
  props.setProperty('lastRefreshMs', String(now));
  refreshLnd();
}

/** Weekly belt-and-braces run, Monday morning after the sheet is updated. */
function weeklyRefresh() {
  refreshLnd();
}

/** Run once by hand to install both triggers. Safe to re-run — it clears first. */
function setUpTriggers() {
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('weeklyRefresh').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();

  Logger.log('Triggers installed: onEdit (debounced ' + QUIET_MINUTES + 'm) + Monday 09:00.');
}
