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
//
// Budget in MESSAGES, not threads: the ceiling is 50,000 Gmail read/write calls a
// day on Workspace (20,000 on consumer), and ONE message costs many of them —
// getSubject, getFrom, getTo, getCc, getDate, getId, getPlainBody, getHeader. Call
// it ~8-9 each, so ~5,000-6,000 messages is the true daily ceiling for the whole
// account. Today's 11,172-message run was roughly double it. 2,500 leaves clear
// headroom for the live 30-min pull, which must never be the thing that starves.
var DAILY_MSG_BUDGET = 2500;
var BUDGET_DAY_KEY  = 'bf_budget_day';   // yyyy-mm-dd the counter belongs to
var BUDGET_USED_KEY = 'bf_budget_used';

// Machine senders whose bodies we would fetch and then discard within minutes.
// Tested against the CHEAP getFrom() so the expensive getPlainBody() is never made:
// on this mailbox ProofHub, Disprz and HROne alone accounted for over 1,800
// messages, i.e. a third of a day's entire message budget spent on mail that is
// swept as noise on arrival.
var SKIP_SENDERS = /(proofhubmail|disprz|hronecloud|drive-shares|newsletters@|yourstory|cloudcodes|frontendnation|comments-noreply@docs|mailer-daemon|theresanaiforthat|coursera|chat-noreply|projectcode\.dev|beehiiv|webflow\.com|upgrad|accounts\.google|gohighlevel|glassdoor|mindvalley|browserstack|zohobooks|skool\.com|pressable\.com|meetings-noreply|googlecloud@google|ifttt|duplicator|linkedin|wpengine|kinsta|wordfence|easemytrip|shopify\.com|websummit|clickup|signeasy|dropbox|anthropic|openai|supabase\.com|unlearn\.dev|liquidweb|slack|figma|atlassian|asana|trello|calendly|zoom\.us|eventbrite|substack|producthunt|indeed|naukri|blackbaud|cloudhq|twilio|microsoft\.com|amazon\.com|cursor\.com|grammarly|canva|taskade|wrike|memberful|allevents|godaddy|adobe\.com|lovable\.dev|finsweet|uxpilot|theorg|macaly|byq\.supply|enkash|alison\.com|cooperpress|granth\.info|granth\.in|atharvasystem\.com)/i;

// Day-rolling counter. Returns how many of `wanted` messages may still be read.
function budgetLeft(props) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (props.getProperty(BUDGET_DAY_KEY) !== today) {
    props.setProperty(BUDGET_DAY_KEY, today);
    props.setProperty(BUDGET_USED_KEY, '0');
  }
  return DAILY_MSG_BUDGET - parseInt(props.getProperty(BUDGET_USED_KEY) || '0', 10);
}

function budgetSpend(props, n) {
  var used = parseInt(props.getProperty(BUDGET_USED_KEY) || '0', 10);
  props.setProperty(BUDGET_USED_KEY, String(used + n));
}

// ---- main -----------------------------------------------------------------
function backfillRun() {
  var props = PropertiesService.getScriptProperties();
  var start = parseInt(props.getProperty('bf_start') || '0', 10);
  var totalPushed = parseInt(props.getProperty('bf_pushed') || '0', 10);

  var remaining = budgetLeft(props);
  if (remaining <= 0) {
    Logger.log('Daily Gmail budget (' + DAILY_MSG_BUDGET + ' msgs) spent — pausing so the live ' +
               'pull keeps its quota. Resumes tomorrow from thread ' + start + '.');
    return;
  }

  var threads = GmailApp.search(SEARCH_QUERY, start, THREADS_PER_RUN);
  if (threads.length === 0) {
    Logger.log('BACKFILL COMPLETE — processed ' + start + ' threads, pushed ' + totalPushed + ' messages.');
    removeBackfillTrigger();
    return;
  }

  var buf = [];
  var pushed = 0, read = 0, skipped = 0, threadsDone = 0;
  for (var t = 0; t < threads.length; t++) {
    // Stop mid-page rather than overshoot: the cursor only advances past threads
    // actually finished, so the next run picks up exactly where this one stopped.
    if (read >= remaining) break;
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      // getFrom() is one cheap call; getPlainBody() on a 60k quoted chain is the
      // expensive one. Test the sender FIRST and never touch the body of noise.
      if (SKIP_SENDERS.test(msgs[m].getFrom() || '')) { skipped++; continue; }
      buf.push(toRow(msgs[m], threads[t].getId()));
      read++;
      if (buf.length >= POST_BATCH) { pushed += flush(buf); buf = []; }
    }
    threadsDone++;
  }
  if (buf.length) pushed += flush(buf);
  budgetSpend(props, read);
  Logger.log('read ' + read + ' msgs, skipped ' + skipped + ' noise, budget left today ' +
             (remaining - read) + '/' + DAILY_MSG_BUDGET);

  start += threadsDone;
  totalPushed += pushed;
  props.setProperty('bf_start', String(start));
  props.setProperty('bf_pushed', String(totalPushed));
  // threadsDone, NOT threads.length — a run that stopped on budget finished fewer
  // threads than it fetched, and logging the fetched count would claim progress the
  // cursor did not make.
  Logger.log('Batch done: +' + threadsDone + ' threads (offset now ' + start + '), +' + pushed +
             ' msgs this run, ' + totalPushed + ' cumulative.');
}

// ---- helpers --------------------------------------------------------------
// Cut to n characters WITHOUT splitting an emoji. An emoji is two UTF-16 code
// units, and a plain slice landing between them leaves a lone high surrogate
// (D800-DBFF), which Postgres rejects as "invalid input syntax for type json".
// The live puller hit exactly this on 2 Sep 2026 and stopped capturing for six
// hours, because a failed push holds the cursor and re-sends the same message
// forever. Keep this identical to sliceSafe in pull-gmail-to-supabase.gs.
function sliceSafe(s, n) {
  s = String(s || '');
  if (s.length <= n) return s;
  var cut = s.slice(0, n);
  var last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) cut = cut.slice(0, -1);
  return cut;
}

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
    snippet: sliceSafe(msg.getPlainBody(), 300),
    body: sliceSafe(msg.getPlainBody(), 60000),
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
             'pauses daily at ' + DAILY_MSG_BUDGET + ' messages).');
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
             DAILY_MSG_BUDGET + ' messages (day ' + (p.getProperty(BUDGET_DAY_KEY) || 'n/a') + ')');
}

function backfillReset() {
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty('bf_start');
  p.deleteProperty('bf_pushed');
  Logger.log('Backfill cursor reset.');
}
