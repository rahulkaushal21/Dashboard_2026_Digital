/**
 * Push the Quotes / Web SQLs / Escalation / Feedback tabs into Supabase.
 *
 * No "Publish to web" needed — this runs as you and reads the PRIVATE sheet,
 * then POSTs each tab to the Supabase `sheet-ingest` function.
 *
 * Safe to paste alongside your existing revenue script: it declares NO global
 * variables (everything is inside the functions), so it won't collide with
 * names like SPREADSHEET_ID already defined elsewhere.
 *
 * SETUP (one time):
 *   1. Open the Business Sheet → Extensions → Apps Script.
 *   2. Add this as a new file (or paste at the end of Code.gs).
 *   3. Run `syncSheetsToSupabase` once → approve the permission prompt.
 *   4. Run `installSupabaseTabTrigger` once → it will then push every hour.
 *
 * Check Executions / Logs to confirm each tab returns {"ok":true,...}.
 */

function syncSheetsToSupabase() {
  // --- config (kept local so it never clashes with other scripts) ---
  var INGEST_URL   = 'https://hsmuxmvhgteexanssigc.supabase.co/functions/v1/sheet-ingest';
  var INGEST_TOKEN = 'ingestWebHub_a7c2e9';
  var SHEET_ID     = '1KbQsWVj0oNDlC4IRPPFfiYPqIW5u6fOeeOn7I3X5lUY';
  // tab key (what the backend expects) -> the sheet's gid in the Business Sheet
  var TAB_GIDS = {
    quotes:   802492618,
    sql:      1146954915,
    esc:      1247504485,
    feedback: 2009627668
  };

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var byGid = {};
  ss.getSheets().forEach(function (sh) { byGid[sh.getSheetId()] = sh; });

  Object.keys(TAB_GIDS).forEach(function (tab) {
    var gid = TAB_GIDS[tab];
    var sh = byGid[gid];
    if (!sh) { Logger.log('SKIP ' + tab + ': no tab with gid ' + gid); return; }

    // header row + data rows, exactly as displayed (dates as shown, e.g. 12-Jun-2026)
    var rows = sh.getDataRange().getDisplayValues();

    var resp = UrlFetchApp.fetch(INGEST_URL + '?token=' + INGEST_TOKEN, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ tab: tab, rows: rows }),
      muteHttpExceptions: true
    });
    Logger.log(tab + ' -> ' + resp.getResponseCode() + ' ' + resp.getContentText());
  });
}

// Run once to (re)create the hourly trigger for syncSheetsToSupabase.
function installSupabaseTabTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncSheetsToSupabase') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncSheetsToSupabase').timeBased().everyHours(1).create();
  Logger.log('Hourly trigger installed for syncSheetsToSupabase.');
}
