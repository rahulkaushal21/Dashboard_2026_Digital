-- 008_email_inbox_cross_mailbox_dedup.sql
--
-- Applied 4 Aug 2026, when mail capture moved from the single web@uplers.com inbox
-- to reviewweb@uplers.com (a collector carrying the account/PM team's client mail).
--
-- WHY: Gmail's message id is PER-MAILBOX. The same email sitting in web@ and in
-- pratik@ arrives with two different ids, so deduping on it was correct while
-- exactly one mailbox fed this table — and silently wrong the moment a second one
-- did. Every thread two colleagues share would have been stored twice and classified
-- twice, producing duplicate opportunities: the same double-counting class that had
-- to be unpicked by hand earlier that day (GWF|ICG, Allergy Buddy|Aptar, $7,353).
--
-- dedup_key is the cross-mailbox identity: the RFC 5322 Message-ID header, stamped
-- once by the SENDER and therefore identical in every inbox holding the message.
-- Where that header is unreadable it falls back to 'gm:'||message_id — i.e. exactly
-- the old per-mailbox behaviour. Deliberately NOT a synthetic subject+date key:
-- bulk notifications sent in the same second (the QUT RFQ mails, among others)
-- would falsely merge, and silently losing a real quote is worse than storing it
-- twice.
alter table email_inbox
  add column if not exists dedup_key text,
  add column if not exists mailbox   text;

-- Existing rows predate the header being captured, so give them their per-mailbox
-- identity and stamp the only mailbox that had ever fed this table.
update email_inbox set dedup_key = 'gm:' || message_id where dedup_key is null;
update email_inbox set mailbox   = 'web@uplers.com'      where mailbox   is null;

alter table email_inbox alter column dedup_key set not null;

create unique index if not exists email_inbox_dedup_key_uq on email_inbox (dedup_key);
create index        if not exists email_inbox_mailbox_idx  on email_inbox (mailbox);
