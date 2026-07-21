/**
 * gmail-backfill.gs — ONE-TIME historical backfill of email_inbox from FY start (1 Apr 2026).
 *
 * Runs under web@uplers.com (same account as the live push script). It pages through
 * Gmail from 1 Apr forward and POSTs each message to the gmail-ingest edge function with
 * ?backfill=1, so rows land tagged archived=true (a separate stream from live mail):
 * they are still processed=false and therefore classifiable into FY opportunities /
 * client-health, but excluded from the live daily-scan "queue must be 0" check.
 *
 * Idempotent: the edge function dedups on message_id, so you can re-run / let a trigger
 * repeat this safely — already-stored messages are ignored, nothing is reset.
 *
 * HOW TO RUN
 *   1. Open the Apps Script project bound to web@uplers.com (script.google.com).
 *   2. Paste this file in, Save.
 *   3. Run `backfillRun` once to authorise, then either:
 *        - keep clicking Run until the log says "BACKFILL COMPLETE", or
 *        - run `installBackfillTrigger()` once to auto-run every 10 min until done
 *          (then it self-removes). Use `removeBackfillTrigger()` to stop early.
 *   4. `backfillStatus()` prints progress; `backfillReset()` starts over.
 */

// ---- config ---------------------------------------------------------------
var INGEST_URL  = 'https://hsmuxmvhgteexanssigc.supabase.co/functions/v1/gmail-ingest';
var INGEST_TOKEN = 'ingestWebHub_a7c2e9';
var SEARCH_QUERY = 'after:2026/03/31';   // FY start = 1 Apr 2026 (after: is exclusive on the day)
var THREADS_PER_RUN = 400;               // ~1.5 min/run, safely under the 6-min execution limit; lower if you hit timeouts
var POST_BATCH = 50;                     // messages per POST to the edge function
var INTERNAL_DOMAINS = ['uplers.com', 'mavlers.com', 'mavlers.agency', 'uplers.in', 'uplers.io'];

// ---- main -----------------------------------------------------------------
function backfillRun() {
  var props = PropertiesService.getScriptProperties();
  var start = parseInt(props.getProperty('bf_start') || '0', 10);
  var totalPushed = parseInt(props.getProperty('bf_pushed') || '0', 10);

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
    payload: JSON.stringify({ messages: rows }),
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
  // Apps Script time triggers allow only 1, 5, 10, 15, or 30 min. 1 = fastest.
  ScriptApp.newTrigger('backfillRun').timeBased().everyMinutes(1).create();
  Logger.log('Trigger installed: backfillRun every 1 min (self-removes when complete).');
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
}

function backfillReset() {
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty('bf_start');
  p.deleteProperty('bf_pushed');
  Logger.log('Backfill cursor reset.');
}
