/**
 * gmail-backfill.gs — historical backfill of email_inbox for ONE mailbox.
 *
 * Runs under whichever account owns the script (same rule as the live push script:
 * GmailApp = the owner's inbox, there is no mailbox list to configure). It pages
 * through Gmail from SEARCH_QUERY forward and POSTs each message to the gmail-ingest
 * edge function with ?backfill=1, so rows land tagged archived=true (a separate
 * stream from live mail): they are still processed=false and therefore classifiable
 * into FY opportunities / client-health, but excluded from the live daily-scan
 * "queue must be 0" check.
 *
 * Idempotent AND safe to run for several mailboxes: the edge function dedups on the
 * RFC 5322 Message-ID header, which the sender stamps once and is therefore identical
 * in every inbox holding the mail. Gmail's own message id is per-mailbox and would
 * store a shared thread once per colleague. Run `checkHeaderSupport()` from
 * pull-gmail-to-supabase.gs on this account BEFORE backfilling a second mailbox — if
 * the header isn't readable there, backfilling it will duplicate every shared thread.
 *
 * HOW TO RUN (per mailbox)
 *   1. Open the Apps Script project bound to that mailbox (script.google.com).
 *   2. Paste this file in, set MAILBOX below to that address, Save.
 *   3. Run `backfillRun` once to authorise, then either:
 *        - keep clicking Run until the log says "BACKFILL COMPLETE", or
 *        - run `installBackfillTrigger()` once to auto-run every minute until done
 *          (then it self-removes). Use `removeBackfillTrigger()` to stop early.
 *   4. `backfillStatus()` prints progress; `backfillReset()` starts over.
 */

// ---- config ---------------------------------------------------------------
var MAILBOX     = 'reviewweb@uplers.com';  // the inbox THIS copy backfills; must own the script
var INGEST_URL  = 'https://hsmuxmvhgteexanssigc.supabase.co/functions/v1/gmail-ingest';
var INGEST_TOKEN = 'ingestWebHub_a7c2e9';
// Last 3 months. `after:` is exclusive on the day given. Widen to 'after:2026/03/31'
// (FY start) only if the extra volume is worth the classification cost.
var SEARCH_QUERY = 'after:2026/05/03';
var THREADS_PER_RUN = 400;               // ~1.5 min/run, safely under the 6-min execution limit; lower if you hit timeouts
var POST_BATCH = 50;                     // messages per POST to the edge function
var INTERNAL_DOMAINS = ['uplers.com', 'mavlers.com', 'mavlers.agency', 'uplers.in', 'uplers.io'];

// Gmail read calls are a DAILY quota shared by every script on this account — the
// live 30-min pull included. On 4 Aug 2026 this backfill ran every minute for two
// hours, drained the day's allowance, and took the live feed down with it:
// "Exception: Service invoked too many times for one day: premium gmail". Mail
// capture stopped for the rest of the day.
//
// So the backfill now stops itself well before the ceiling and leaves the rest for
// the live pull. It resumes automatically the next day from the same cursor — a
// backfill spread over three days costs nothing; a dead inbox does.
var DAILY_THREAD_BUDGET = 3000;          // threads this script may read per day
var BUDGET_DAY_KEY  = 'bf_budget_day';   // yyyy-mm-dd the counter belongs to
var BUDGET_USED_KEY = 'bf_budget_used';

// Returns true if there is still room today, and books the spend.
function budgetOk(props, threadsWanted) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (props.getProperty(BUDGET_DAY_KEY) !== today) {
    props.setProperty(BUDGET_DAY_KEY, today);
    props.setProperty(BUDGET_USED_KEY, '0');
  }
  var used = parseInt(props.getProperty(BUDGET_USED_KEY) || '0', 10);
  if (used + threadsWanted > DAILY_THREAD_BUDGET) return false;
  props.setProperty(BUDGET_USED_KEY, String(used + threadsWanted));
  return true;
}

// ---- main -----------------------------------------------------------------
function backfillRun() {
  var props = PropertiesService.getScriptProperties();
  var start = parseInt(props.getProperty('bf_start') || '0', 10);
  var totalPushed = parseInt(props.getProperty('bf_pushed') || '0', 10);

  if (!budgetOk(props, THREADS_PER_RUN)) {
    Logger.log('Daily thread budget (' + DAILY_THREAD_BUDGET + ') reached — pausing so the live ' +
               'pull keeps its Gmail quota. Resumes tomorrow from thread ' + start + '.');
    return;
  }

  var threads = GmailApp.search(SEARCH_QUERY, start, THREADS_PER_RUN);
  if (threads.length === 0) {
    Logger.log('BACKFILL COMPLETE — processed ' + start + ' threads, pushed ' + totalPushed + ' messages.');
    removeBackfillTrigger();
    return;
  }

  var buf = [];
  var pushed = 0;
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      buf.push(toRow(msgs[m], threads[t].getId()));
      if (buf.length >= POST_BATCH) { pushed += flush(buf); buf = []; }
    }
  }
  if (buf.length) pushed += flush(buf);

  start += threads.length;
  totalPushed += pushed;
  props.setProperty('bf_start', String(start));
  props.setProperty('bf_pushed', String(totalPushed));
  Logger.log('Batch done: +' + threads.length + ' threads (offset now ' + start + '), +' + pushed +
             ' msgs this run, ' + totalPushed + ' cumulative.');
}

// ---- helpers --------------------------------------------------------------
function toRow(msg, threadId) {
  var to = msg.getTo() || '';
  var cc = msg.getCc() || '';
  var from = msg.getFrom() || '';
  return {
    message_id: msg.getId(),
    rfc_message_id: rfcId(msg),
    mailbox: MAILBOX,
    thread_id: threadId,
    subject: msg.getSubject() || '',
    from_addr: from,
    to_addrs: to,
    cc_addrs: cc,
    msg_date: msg.getDate().toISOString(),
    snippet: (msg.getPlainBody() || '').slice(0, 300),
    body: (msg.getPlainBody() || '').slice(0, 60000),
    has_external: hasExternal(from + ' ' + to + ' ' + cc)
  };
}

// The sender-stamped Message-ID: identical in every mailbox holding this message,
// unlike Gmail's per-mailbox id. Null when unreadable — the edge function then keeps
// the old per-mailbox key rather than inventing one, since storing a message twice is
// recoverable and silently merging two real mails is not.
function rfcId(msg) {
  try {
    if (typeof msg.getHeader === 'function') {
      var h = msg.getHeader('Message-ID') || msg.getHeader('Message-Id');
      if (h) return String(h).trim();
    }
  } catch (e) { /* header unavailable */ }
  return null;
}

function hasExternal(participants) {
  var emails = participants.toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/g) || [];
  for (var i = 0; i < emails.length; i++) {
    var dom = emails[i].split('@')[1];
    var internal = false;
    for (var d = 0; d < INTERNAL_DOMAINS.length; d++) {
      if (dom === INTERNAL_DOMAINS[d]) { internal = true; break; }
    }
    if (!internal) return true;   // at least one outside participant
  }
  return false;
}

function flush(rows) {
  var res = UrlFetchApp.fetch(INGEST_URL + '?token=' + INGEST_TOKEN + '&backfill=1', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ mailbox: MAILBOX, messages: rows }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) { Logger.log('POST failed (' + code + '): ' + res.getContentText()); return 0; }
  var j = JSON.parse(res.getContentText());
  return j.inserted || 0;
}

// ---- triggers / ops -------------------------------------------------------
function installBackfillTrigger() {
  removeBackfillTrigger();
  // Apps Script time triggers allow only 1, 5, 10, 15, or 30 min. Every-minute was
  // the original setting and it is what drained the shared Gmail quota on 4 Aug,
  // killing the live 30-min pull for the rest of the day. 10 min is plenty: the
  // work per run is unchanged, it just stops racing the feed it depends on.
  ScriptApp.newTrigger('backfillRun').timeBased().everyMinutes(10).create();
  Logger.log('Trigger installed: backfillRun every 10 min (self-removes when complete, ' +
             'pauses daily at ' + DAILY_THREAD_BUDGET + ' threads).');
}

function removeBackfillTrigger() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'backfillRun') ScriptApp.deleteTrigger(ts[i]);
  }
}

function backfillStatus() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('threads processed: ' + (p.getProperty('bf_start') || '0') +
             ' | messages pushed: ' + (p.getProperty('bf_pushed') || '0'));
  Logger.log('today\'s Gmail budget: ' + (p.getProperty(BUDGET_USED_KEY) || '0') + '/' +
             DAILY_THREAD_BUDGET + ' threads (day ' + (p.getProperty(BUDGET_DAY_KEY) || 'n/a') + ')');
}

function backfillReset() {
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty('bf_start');
  p.deleteProperty('bf_pushed');
  Logger.log('Backfill cursor reset.');
}
