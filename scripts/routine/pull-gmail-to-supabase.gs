/**
 * pull-gmail-to-supabase.gs
 * ─────────────────────────
 * Google Apps Script that pulls new inbox mail every 30 minutes and pushes the
 * raw messages into the PRIVATE Supabase `email_inbox` table (via the
 * `gmail-ingest` edge function). Claude then reads unprocessed rows from Supabase
 * to deep-dive and classify (opportunities / feedback / escalations / sentiment).
 *
 * WHY: this replaces the claude.ai Gmail MCP connector, whose OAuth token kept
 * expiring every few hours and stalling the scan. Apps Script runs with a stable,
 * long-lived Google authorization that does NOT expire like that, and it runs even
 * when no Claude session is open — so mail is captured continuously and nothing is
 * lost. The Gmail connector is removed from the loop entirely.
 *
 * GAP-PROOF: the script keeps a persistent cursor (the timestamp of the newest
 * message it has successfully pushed) in Script Properties. Each run resumes from
 * that cursor (minus a small overlap), NOT from a fixed 2h window — so if Google
 * ever delays or disables the trigger for hours, the very next run still catches
 * up the whole backlog automatically (capped at MAX_WINDOW_HOURS). Dedup on
 * message_id in the edge function makes the overlap harmless.
 *
 * ⚠ CRITICAL: this script reads the mailbox of WHATEVER Google account it runs
 * under (GmailApp = the owner's inbox). It MUST be created/owned by web@uplers.com,
 * or it will scan the wrong inbox. Verify with whoAmI() below before installing.
 *
 * SETUP (one time — do these IN ORDER):
 *   1. Sign in to script.google.com as web@uplers.com (NOT rahul.k / any other).
 *   2. New project → name it "Gmail → Supabase inbox" → paste this whole file.
 *   3. Run whoAmI()               → authorize when prompted → confirm the log
 *                                    (View ▸ Logs) shows web@uplers.com.
 *   4. Run pullGmailToSupabase()  → one manual backfill; confirm the log shows
 *                                    "pushed N" and no "ingest error".
 *   5. Run installGmailPullTrigger() → creates the recurring 30-min trigger.
 *   6. (optional) Run status()    → prints the cursor + trigger state anytime.
 * That's it. From then on it runs itself every 30 min, unattended.
 */

// ── Config ──────────────────────────────────────────────────────────────────
var SUPABASE_FN      = 'https://hsmuxmvhgteexanssigc.supabase.co/functions/v1/gmail-ingest';
var INGEST_TOKEN     = 'ingestWebHub_a7c2e9';   // shared secret; matches the edge function
var COLD_START_HOURS = 6;                        // first ever run (no cursor): look back this far
var OVERLAP_MIN      = 20;                        // re-pull this much before the cursor (dedup makes it safe)
var MAX_WINDOW_HOURS = 72;                        // safety cap: even after a long outage, never scan more than this
var CURSOR_KEY       = 'lastMsgEpochMs';          // Script Property holding the newest pushed msg time
var INTERNAL         = ['mavlers.com', 'uplers.com', 'uplers.in', 'mavlers.agency', 'mavlers.biz'];
// VENDORS/subcontractors we hire — NOT clients. Any thread involving one of these domains
// is skipped entirely (never pushed to Supabase), so their correspondence is never tracked
// as client business. Add a domain here to permanently stop tracking that vendor.
var VENDOR_SKIP      = ['granth.info', 'granth.in', 'atharvasystem.com'];
// Internal-only threads are skipped as noise EXCEPT when the body reads like a
// relayed client opportunity/escalation — so an AM forwarding a client request
// internally is still captured.
var INCLUDE_INTERNAL_RE = /\b(rfq|quote|new business|new client|new project|new request|opportunity|proposal|estimate|escalat|complaint|urgent|refund|cancel|dissatisf|disappointed)\b/i;

// ── Confirm which mailbox this will scan ────────────────────────────────────
function whoAmI() {
  Logger.log('This script will scan the inbox of: ' + Session.getActiveUser().getEmail());
  Logger.log('It MUST say web@uplers.com. If not, recreate the project under that account.');
}

// ── Show the current cursor + trigger state (diagnostic) ────────────────────
function status() {
  var props = PropertiesService.getScriptProperties();
  var cur = props.getProperty(CURSOR_KEY);
  Logger.log('Cursor (newest pushed msg): ' + (cur ? new Date(Number(cur)).toUTCString() : '(none — next run is a cold start)'));
  var trs = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'pullGmailToSupabase'; });
  Logger.log('Active 30-min triggers: ' + trs.length + (trs.length ? ' ✓' : ' ✗ (run installGmailPullTrigger)'));
}

// ── Main: pull recent inbox messages → Supabase ─────────────────────────────
function pullGmailToSupabase() {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var minCutoff = now - MAX_WINDOW_HOURS * 3600 * 1000;   // never look back further than the cap

  // Resume from the cursor (with overlap); cold start → COLD_START_HOURS.
  var cursor = props.getProperty(CURSOR_KEY);
  var cutoff = cursor
    ? Math.max(Number(cursor) - OVERLAP_MIN * 60 * 1000, minCutoff)
    : now - COLD_START_HOURS * 3600 * 1000;

  // Gmail search only accepts whole hours (newer_than:Xh). Round the window UP so
  // we never under-scan, then filter precisely by `cutoff` per message below.
  var hoursBack = Math.min(MAX_WINDOW_HOURS, Math.max(1, Math.ceil((now - cutoff) / 3600000)));
  var query = 'in:inbox newer_than:' + hoursBack + 'h';   // NB: Gmail's `m` unit means MONTHS — never use it.

  var out = [];
  var maxPushedEpoch = cursor ? Number(cursor) : 0;
  var start = 0, PAGE = 100;

  while (true) {
    var threads = GmailApp.search(query, start, PAGE);
    if (!threads.length) break;
    for (var i = 0; i < threads.length; i++) {
      var t = threads[i];
      var tid = t.getId();
      var msgs = t.getMessages();
      for (var j = 0; j < msgs.length; j++) {
        var m = msgs[j];
        var epoch = m.getDate().getTime();
        if (epoch < cutoff) continue;                      // only NEW messages past the cursor/window
        var from = m.getFrom() || '';
        var to = m.getTo() || '';
        var cc = m.getCc() || '';
        var participants = (from + ',' + to + ',' + cc).toLowerCase();
        var body = m.getPlainBody() || '';
        // Skip vendor/subcontractor threads entirely — they are not clients.
        if (hasVendor(participants)) continue;
        var external = computeExternal(participants);
        // Skip pure-internal chatter unless it reads like a relayed client matter.
        if (!external && !INCLUDE_INTERNAL_RE.test(body.slice(0, 4000) + ' ' + m.getSubject())) continue;
        out.push({
          message_id: m.getId(),
          thread_id: tid,
          subject: m.getSubject(),
          from_addr: from,
          to_addrs: to,
          cc_addrs: cc,
          msg_date: m.getDate().toISOString(),
          snippet: body.slice(0, 300),
          body: body.slice(0, 60000),
          has_external: external
        });
        if (epoch > maxPushedEpoch) maxPushedEpoch = epoch;
      }
    }
    if (threads.length < PAGE) break;
    start += PAGE;
  }

  // Push in batches. Only advance the cursor if EVERY batch succeeded — a failed
  // push must not move the high-water mark, or those messages would be skipped
  // next run (mirrors the Claude routine's markScan/markScanFailed discipline).
  var pushed = 0, allOk = true;
  for (var k = 0; k < out.length; k += 200) {
    var res = postBatch(out.slice(k, k + 200));
    if (res < 0) { allOk = false; } else { pushed += res; }
  }

  if (allOk && maxPushedEpoch > 0) {
    props.setProperty(CURSOR_KEY, String(maxPushedEpoch));
  }
  Logger.log('pullGmailToSupabase: window=' + hoursBack + 'h, queued ' + out.length +
             ', pushed ' + pushed + (allOk ? '' : ' — SOME BATCHES FAILED (cursor held)') +
             ', cursor=' + (maxPushedEpoch ? new Date(maxPushedEpoch).toUTCString() : 'unchanged'));
}

// hasVendor = any participant is on a vendor/subcontractor domain we don't track
function hasVendor(participants) {
  var emails = participants.match(/[a-z0-9._%+-]+@[a-z0-9.-]+/g) || [];
  for (var i = 0; i < emails.length; i++) {
    var dom = (emails[i].split('@')[1] || '');
    for (var j = 0; j < VENDOR_SKIP.length; j++) {
      if (dom === VENDOR_SKIP[j] || dom.slice(-(VENDOR_SKIP[j].length + 1)) === '.' + VENDOR_SKIP[j]) return true;
    }
  }
  return false;
}

// external = any participant whose domain is not one of ours
function computeExternal(participants) {
  var emails = participants.match(/[a-z0-9._%+-]+@[a-z0-9.-]+/g) || [];
  for (var i = 0; i < emails.length; i++) {
    var dom = (emails[i].split('@')[1] || '');
    var internal = false;
    for (var j = 0; j < INTERNAL.length; j++) {
      if (dom === INTERNAL[j] || dom.slice(-(INTERNAL[j].length + 1)) === '.' + INTERNAL[j]) { internal = true; break; }
    }
    if (!internal) return true;
  }
  return false;
}

// Returns count inserted (>=0) on success, or -1 on failure (so the caller holds the cursor).
function postBatch(messages) {
  var res = UrlFetchApp.fetch(SUPABASE_FN + '?token=' + INGEST_TOKEN, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ messages: messages }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) { Logger.log('ingest error ' + code + ': ' + res.getContentText().slice(0, 300)); return -1; }
  try { return JSON.parse(res.getContentText()).inserted || 0; } catch (e) { return 0; }
}

// ── One-time: install the 30-minute trigger ─────────────────────────────────
function installGmailPullTrigger() {
  var trs = ScriptApp.getProjectTriggers();
  for (var i = 0; i < trs.length; i++) {
    if (trs[i].getHandlerFunction() === 'pullGmailToSupabase') ScriptApp.deleteTrigger(trs[i]);
  }
  ScriptApp.newTrigger('pullGmailToSupabase').timeBased().everyMinutes(30).create();
  Logger.log('30-minute trigger installed for pullGmailToSupabase.');
}
