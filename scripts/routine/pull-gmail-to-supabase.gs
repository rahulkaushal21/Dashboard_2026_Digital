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
 * ⚠ CRITICAL: this script reads the mailbox of WHATEVER Google account it runs
 * under (GmailApp = the owner's inbox). It MUST be created/owned by web@uplers.com,
 * or it will scan the wrong inbox. Verify with whoAmI() below before installing.
 *
 * SETUP (one time):
 *   1. Sign in to script.google.com as web@uplers.com (NOT rahul.k / any other).
 *   2. New project → paste this file.
 *   3. Run whoAmI() once → authorize → confirm the log shows web@uplers.com.
 *   4. Run installGmailPullTrigger() once → creates the 30-min time trigger.
 *   5. Run pullGmailToSupabase() once manually to backfill + confirm it works.
 */

// ── Config ──────────────────────────────────────────────────────────────────
var SUPABASE_FN   = 'https://hsmuxmvhgteexanssigc.supabase.co/functions/v1/gmail-ingest';
var INGEST_TOKEN  = 'ingestWebHub_a7c2e9';            // shared secret; matches the edge function
var WINDOW_HOURS  = 2;                                 // 30-min trigger + 2h window = safe overlap (dedup on message_id makes re-sends harmless)
var INTERNAL      = ['mavlers.com', 'uplers.com', 'uplers.in', 'mavlers.agency', 'mavlers.biz'];
// Internal-only threads are skipped as noise EXCEPT when the body reads like a
// relayed client opportunity/escalation — so an AM forwarding a client request
// internally is still captured.
var INCLUDE_INTERNAL_RE = /\b(rfq|quote|new business|new client|new project|new request|opportunity|proposal|estimate|escalat|complaint|urgent|refund|cancel|dissatisf|disappointed)\b/i;

// ── Confirm which mailbox this will scan ────────────────────────────────────
function whoAmI() {
  Logger.log('This script will scan the inbox of: ' + Session.getActiveUser().getEmail());
  Logger.log('It MUST say web@uplers.com. If not, recreate the project under that account.');
}

// ── Main: pull recent inbox messages → Supabase ─────────────────────────────
function pullGmailToSupabase() {
  var cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;
  var query = 'in:inbox newer_than:' + WINDOW_HOURS + 'h';
  var out = [];
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
        if (m.getDate().getTime() < cutoff) continue;      // only NEW messages in the window
        var from = m.getFrom() || '';
        var to = m.getTo() || '';
        var cc = m.getCc() || '';
        var participants = (from + ',' + to + ',' + cc).toLowerCase();
        var body = m.getPlainBody() || '';
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
      }
    }
    if (threads.length < PAGE) break;
    start += PAGE;
  }

  var pushed = 0;
  for (var k = 0; k < out.length; k += 200) {
    pushed += postBatch(out.slice(k, k + 200));
  }
  Logger.log('pullGmailToSupabase: examined window=' + WINDOW_HOURS + 'h, queued ' + out.length + ' messages, pushed ' + pushed);
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

function postBatch(messages) {
  var res = UrlFetchApp.fetch(SUPABASE_FN + '?token=' + INGEST_TOKEN, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ messages: messages }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) { Logger.log('ingest error ' + code + ': ' + res.getContentText().slice(0, 300)); return 0; }
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
