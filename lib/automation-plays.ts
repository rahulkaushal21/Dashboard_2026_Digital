// Automation plays by industry — the AI & Automation offer, mapped onto the client
// directory we already have.
//
// Why this exists: the Full-directory tab holds ~2,000 companies grouped into 13
// industries, and almost all of them buy web build/maintenance from us. Booked
// "AI & Automation" revenue is a rounding error against that (~$14k, and ~89% of it is
// a single client, Telfer Digital). Telfer is the proof: timesheet sync into their
// operational system, a warranty-accounting run, a nightly SAP cleanse, an AI
// translation plugin — none of it is a website, all of it came out of watching where
// their team was doing the same thing by hand every week.
//
// The plays below are that same question asked of every other industry: where does
// this kind of client still run on a person, a spreadsheet and an inbox? Each one is
// written to be sellable as-is — a scope an AM can open a conversation with, not a
// category. Nothing here is generated from client data; it is a fixed offer catalogue,
// and the counts beside it on the page come from the directory.

export type PlayType = 'Chatbot' | 'Dashboard' | 'Sheet & data' | 'Workflow' | 'AI content'

export const PLAY_TYPE_TONE: Record<PlayType, string> = {
  'Chatbot': 'bg-blue-500/15 text-blue-400',
  'Dashboard': 'bg-mav-yellow/20 text-mav-yellow',
  'Sheet & data': 'bg-green-500/15 text-green-400',
  'Workflow': 'bg-purple-500/15 text-purple-300',
  'AI content': 'bg-orange-500/15 text-orange-300',
}

export type Play = {
  name: string
  type: PlayType
  replaces: string   // the manual effort it removes — the thing the client is paying a person to do today
  example: string    // a concrete build, phrased the way it would be pitched
}

export type IndustryPlaybook = {
  pain: string       // where the manual work actually sits in this industry
  plays: Play[]
}

// Keyed by the 13 directory industry groups (plus the catch-all).
export const AUTOMATION_PLAYS: Record<string, IndustryPlaybook> = {
  'Marketing & Advertising': {
    pain: 'Our biggest bucket, and almost all of it is agencies who resell us. Their margin leaks in coordination: briefs retyped into project tools, status chased across email, monthly client reports rebuilt by hand in slides, and a resourcing spreadsheet that only one person understands.',
    plays: [
      {
        name: 'Client reporting factory',
        type: 'Dashboard',
        replaces: 'An account manager rebuilding the same 12 monthly decks from GA4, Search Console, HubSpot and ad platforms — usually 2–4 days a month, every month.',
        example: 'One white-labelled reporting dashboard per end client, pulling live from their own connectors, with an AI-written commentary paragraph the AM edits instead of authors. Sold per end client, so it scales with the agency roster rather than as a one-off.',
      },
      {
        name: 'Brief-to-ticket intake',
        type: 'Workflow',
        replaces: 'Briefs arriving as email or a Google Doc, then being retyped into ProofHub/ClickUp/Basecamp — and the estimate being written from scratch each time.',
        example: 'A branded intake form that parses the brief, creates the project and tasks in their PM tool, attaches the assets, and drafts a first estimate from their own historic rate card. This is exactly the manual step our own AMs do dozens of times a week.',
      },
      {
        name: 'Resourcing & capacity board',
        type: 'Sheet & data',
        replaces: 'The master resourcing spreadsheet — hours per person per week, maintained by hand, out of date by Wednesday.',
        example: 'Sync timesheets and project schedules into one capacity view with over-allocation flags. Big Gun Digital maintains 52 websites and is rebuilding its maintenance process right now; this is the same problem one layer up.',
      },
    ],
  },

  'Technology & Software': {
    pain: 'The most automation-literate buyers on the list, which cuts both ways: they will not buy a toy, but they already believe in the category and have budget lines for it. Their pain is glue — data sitting in one system that a human copies into another.',
    plays: [
      {
        name: 'Docs & support answer bot',
        type: 'Chatbot',
        replaces: 'Support engineers answering the same product questions, and a docs site nobody can search properly.',
        example: 'A retrieval chatbot trained on their docs, changelog and past tickets, embedded in the docs site and the in-app help. Deflects tier-1 volume and gives them a log of what users could not find — which becomes the docs roadmap.',
      },
      {
        name: 'System-to-system sync',
        type: 'Workflow',
        replaces: 'Nightly CSV exports, a person reconciling two systems, and silent failures nobody notices until a customer complains.',
        example: 'A monitored queue between their CRM/billing/product database with retry, alerting and a health dashboard. Note the cautionary tale: an unmonitored sync queue on a client site reached 61 million rows before anyone noticed — the monitoring IS the product.',
      },
      {
        name: 'Onboarding & trial nurture',
        type: 'Workflow',
        replaces: 'Manual trial follow-up and a CSM eyeballing which accounts have gone quiet.',
        example: 'Product events into HubSpot, scored into a health signal, driving both the nurture sequence and an at-risk list for the CSM. We already do this shape for ourselves — it is what the Clients page is.',
      },
    ],
  },

  'Consumer, Retail & Food': {
    pain: 'Almost entirely eCommerce operators. The manual effort is in the catalogue and the inbox: product data typed twice, images resized by hand, and a customer-service queue full of the same five questions about delivery.',
    plays: [
      {
        name: 'Order & delivery chatbot',
        type: 'Chatbot',
        replaces: 'The "where is my order" inbox — routinely half of all customer-service volume for a small retailer.',
        example: 'A storefront assistant wired to their order and courier APIs that answers order status, returns and stock questions live, and hands off to a human with the full context attached.',
      },
      {
        name: 'Catalogue & PIM pipeline',
        type: 'Sheet & data',
        replaces: 'Product spreadsheets re-keyed into Shopify/WooCommerce, image resizing, and AI-less copy written per SKU.',
        example: 'A pipeline that takes the supplier sheet, normalises it, generates SEO product copy and alt text, resizes imagery and pushes to the store. GWF had ~118 products with images for only a fraction — that gap is a repeatable build.',
      },
      {
        name: 'Trading dashboard',
        type: 'Dashboard',
        replaces: 'A Monday-morning spreadsheet stitching sales, margin, stock cover and ad spend from four exports.',
        example: 'One live trading view with stock-out and margin alerts. Pairs naturally with the maintenance retainers we already sell these clients.',
      },
    ],
  },

  'Design & Creative': {
    pain: 'Small studios where the founder is also the project manager. Everything routine — proposals, feedback rounds, asset handover, chasing invoices — comes out of billable design time.',
    plays: [
      {
        name: 'Feedback consolidation',
        type: 'Workflow',
        replaces: 'Comments scattered across Figma, email and WhatsApp, manually collated into a change list before every revision round.',
        example: 'Pull comments from Figma and email into one deduplicated, prioritised change list per round, with an AI summary of what actually changed. The Cause & FX build is running on exactly this pattern of Figma comments plus reference links.',
      },
      {
        name: 'Proposal & SOW generator',
        type: 'AI content',
        replaces: 'Rewriting the same proposal from an old file, and re-deriving pricing each time.',
        example: 'A generator that takes scope inputs and produces a branded proposal, SOW and estimate from their own rate card and past projects.',
      },
      {
        name: 'Asset delivery & licence tracking',
        type: 'Sheet & data',
        replaces: 'Manual handover packs, and no record of where a stock image came from.',
        example: 'Automated delivery packaging plus an image-provenance register. This is not hypothetical: an RTR Sports image drew a third-party copyright case, and the first question asked was where the image came from.',
      },
    ],
  },

  'Financial Services': {
    pain: 'Compliance makes everything manual on purpose — but the wrong things are manual. Advisers re-key client data, disclosures are checked by eye, and lead handling is a spreadsheet because nobody trusts a tool with it.',
    plays: [
      {
        name: 'Compliant lead routing',
        type: 'Workflow',
        replaces: 'Enquiries landing in a shared inbox and being assigned by hand, with an audit trail reconstructed later.',
        example: 'Form-to-CRM routing with consent capture, full audit log and SLA alerting. Cazenove & Loyd lost enquiry flow entirely when a Zapier licence lapsed — that fragility is the pitch.',
      },
      {
        name: 'Document intake & extraction',
        type: 'AI content',
        replaces: 'Reading PDFs — statements, applications, KYC packs — and typing the fields into a system.',
        example: 'Upload-to-structured-data with a human confirmation step and a confidence score, so the reviewer checks rather than types.',
      },
      {
        name: 'Adviser-facing knowledge bot',
        type: 'Chatbot',
        replaces: 'Advisers hunting through product PDFs and policy documents to answer one client question.',
        example: 'An internal-only assistant over their product and compliance library that always cites the source document — the citation is what makes it usable in a regulated setting.',
      },
    ],
  },

  'Healthcare & Life Sciences': {
    pain: 'Clinics and practices run on the phone and the front desk. Booking, intake forms, recalls and referrals are all human-mediated, and the compliance bar means most generic tools are ruled out.',
    plays: [
      {
        name: 'Appointment & triage assistant',
        type: 'Chatbot',
        replaces: 'Reception answering booking, hours, location and preparation questions all day.',
        example: 'A site assistant that books into their practice system, answers pre-appointment questions from their own materials, and escalates anything clinical to a human — never answering it itself.',
      },
      {
        name: 'Patient intake digitisation',
        type: 'Sheet & data',
        replaces: 'Paper or PDF intake forms retyped into the practice management system.',
        example: 'Structured digital intake with conditional logic, consent handling and direct write-back. The Tullahoma and RoseRx builds are already forms-plus-consent work — this is the productised version.',
      },
      {
        name: 'Recall & no-show recovery',
        type: 'Workflow',
        replaces: 'Someone working a list of overdue patients by phone, when they get time.',
        example: 'Automated recall and reminder sequences with rebooking links, and a dashboard of recovered appointments — a build that pays for itself in filled slots and can be sold on that basis.',
      },
    ],
  },

  'Media & Entertainment': {
    pain: 'High content volume, small teams. Publishing, metadata, rights and event data are all hand-maintained, and event timing bugs or stale listings are visible to the whole audience.',
    plays: [
      {
        name: 'Content & metadata pipeline',
        type: 'AI content',
        replaces: 'Manual tagging, summarising, transcription and SEO metadata for every asset published.',
        example: 'Ingest video/audio/article, auto-transcribe, generate summaries, tags, chapters and metadata, publish to the CMS with a human approving rather than authoring.',
      },
      {
        name: 'Event & listings automation',
        type: 'Workflow',
        replaces: 'Event data maintained by hand in the CMS, with recurring events a known source of error.',
        example: 'A single event source of truth syncing to site, calendar and ticketing. TiE Silicon Valley has had a recurring-event timing fault reported and re-reported for months; the fix is architectural, and it is a scope.',
      },
      {
        name: 'Audience dashboard',
        type: 'Dashboard',
        replaces: 'Traffic, subscriptions and revenue exported from three platforms into one spreadsheet each week.',
        example: 'A live view by title/series/campaign with drop-off alerting, so editorial decisions come off one screen.',
      },
    ],
  },

  'Education & Training': {
    pain: 'Third-highest lifetime value on the list despite only ten booked clients — these engagements are large. The manual work is enrolment admin, cohort tracking and reporting, most of it in spreadsheets that get re-cut every intake.',
    plays: [
      {
        name: 'Enrolment & cohort automation',
        type: 'Workflow',
        replaces: 'Applications tracked in a spreadsheet, welcome emails sent by hand, cohort lists rebuilt every intake.',
        example: 'Application-to-enrolment flow with document collection, payment status and automatic cohort provisioning into the LMS.',
      },
      {
        name: 'Learner progress dashboard',
        type: 'Sheet & data',
        replaces: 'Progress spreadsheets maintained per cohort, with definitions that quietly change between exports.',
        example: 'A recomputed-from-raw progress view with completion, at-risk learners and trainer load. We learned this the hard way internally: our own L&D sheet changed its progress definition mid-year and made nine learners appear to advance without completing anything — so the rule is compute from raw counts, never trust the exported summary column.',
      },
      {
        name: 'Course Q&A assistant',
        type: 'Chatbot',
        replaces: 'Trainers answering the same course, timetable and assessment questions every intake.',
        example: 'An assistant over course materials and policies, available to learners in the portal, with unanswered questions routed to the trainer as a weekly digest.',
      },
    ],
  },

  'Industrial, Energy & Transport': {
    pain: 'The richest automation territory on the list and the least digitised. Quoting, scheduling, compliance paperwork and field reporting still run on spreadsheets, email and paper — and the operational systems are old and rarely integrated.',
    plays: [
      {
        name: 'Quote & job costing engine',
        type: 'Sheet & data',
        replaces: 'A pricing spreadsheet only one estimator fully understands, re-keyed into a quote document.',
        example: 'A rules-based quoting tool with versioned pricing, approval thresholds and a quote-to-job handoff. Telfer Digital — our single biggest AI & Automation client — started from exactly this shape of work.',
      },
      {
        name: 'Field data capture',
        type: 'Workflow',
        replaces: 'Paper job sheets, photos on phones and timesheets typed up at the end of the week.',
        example: 'Mobile capture writing straight into their operational system, with photo evidence, timestamps and offline support for sites with no signal.',
      },
      {
        name: 'Operational integration & monitoring',
        type: 'Workflow',
        replaces: 'Nightly manual exports between an ERP/legacy system and everything else, with nobody watching whether they ran.',
        example: 'Monitored sync with alerting and a reconciliation report. Telfer\'s timesheet sync, warranty accounting run and nightly SAP cleanse are all live examples we can point at by name.',
      },
    ],
  },

  'Travel & Hospitality': {
    pain: 'Enquiry-led and seasonal. Itineraries, quotes and availability are assembled by hand per enquiry, and out-of-hours enquiries simply wait — which is when a lot of travel research happens.',
    plays: [
      {
        name: 'Enquiry & itinerary assistant',
        type: 'Chatbot',
        replaces: 'Out-of-hours enquiries sitting unanswered, and the same qualifying questions asked by email over several days.',
        example: 'A booking assistant that qualifies the enquiry, checks availability and drafts an outline itinerary for a consultant to finish — so the client wakes up to a warm lead rather than a cold form.',
      },
      {
        name: 'Availability & rate sync',
        type: 'Sheet & data',
        replaces: 'Rates and availability maintained separately on the website, OTAs and an internal sheet.',
        example: 'One source of truth pushing to every channel, with drift alerts when a channel disagrees.',
      },
      {
        name: 'Post-stay review & rebooking',
        type: 'Workflow',
        replaces: 'Review requests sent manually, and repeat-guest offers that depend on someone remembering.',
        example: 'Triggered post-stay sequences with review routing and a rebooking incentive tied to the guest record.',
      },
    ],
  },

  'Real Estate & Construction': {
    pain: 'Listings and project documentation are the manual load: property data entered several times over, tender and compliance packs assembled by hand, and enquiries routed by whoever sees them first.',
    plays: [
      {
        name: 'Listing syndication',
        type: 'Sheet & data',
        replaces: 'The same property typed into the website, the portals and a spreadsheet.',
        example: 'One listing record generating portal feeds, site pages and AI-written descriptions, with photo processing built in.',
      },
      {
        name: 'Enquiry routing & qualification',
        type: 'Workflow',
        replaces: 'Enquiries assigned by hand, with no record of response time.',
        example: 'Automatic routing by territory and property type, with SLA tracking and an agent leaderboard.',
      },
      {
        name: 'Document & compliance assembly',
        type: 'AI content',
        replaces: 'Tender responses, certificates and handover packs assembled manually per project.',
        example: 'Templated assembly pulling from a document library, with expiry tracking on certificates so nothing lapses unnoticed.',
      },
    ],
  },

  'Professional Services': {
    pain: 'Consultancies, legal, HR and recruiters — businesses that sell time and therefore lose money on every hour spent on admin. Proposals, CVs, timesheets and client reporting are all hand-built.',
    plays: [
      {
        name: 'Proposal & pitch automation',
        type: 'AI content',
        replaces: 'Rewriting proposals from old documents and hunting for the right case study.',
        example: 'A generator drawing on their own case-study and credentials library, producing a branded first draft with the relevant references already selected.',
      },
      {
        name: 'Candidate / matter pipeline',
        type: 'Workflow',
        replaces: 'CVs or matters tracked in a spreadsheet, with status chased by email.',
        example: 'Structured pipeline with parsing, automatic status updates to the client and stage-based alerts. YLP Legal is already an active web client — this is the layer above the site.',
      },
      {
        name: 'Time & utilisation dashboard',
        type: 'Dashboard',
        replaces: 'Utilisation calculated monthly in a spreadsheet, always in arrears.',
        example: 'Live utilisation, realisation and margin by person and by client, with alerts before a project goes underwater rather than after.',
      },
    ],
  },

  'Non-Profit & Public Sector': {
    pain: 'Small teams, heavy reporting obligations, and funding tied to evidence. Donation reconciliation, grant reporting and volunteer coordination are almost always spreadsheet-and-inbox jobs.',
    plays: [
      {
        name: 'Donation & grant reporting',
        type: 'Dashboard',
        replaces: 'Funder reports assembled by hand from payment platforms, spreadsheets and programme notes.',
        example: 'A reporting view per funder with the metrics each one asks for, exportable in their format — the work that currently eats a programme manager\'s month-end.',
      },
      {
        name: 'Volunteer & programme coordination',
        type: 'Workflow',
        replaces: 'Rotas in spreadsheets, reminders sent by hand, attendance recorded on paper.',
        example: 'Sign-up, rota, reminder and attendance capture in one flow, feeding straight into the impact numbers the funder report needs.',
      },
      {
        name: 'Service navigation assistant',
        type: 'Chatbot',
        replaces: 'Staff answering eligibility and "which service do I need" questions by phone and email.',
        example: 'A plain-language assistant over their own service documentation with a clear route to a human — accessibility and reading level are part of the build, not an afterthought.',
      },
    ],
  },

  'Other / Unclassified': {
    pain: 'A handful of directory rows whose industry was never captured. Worth classifying before pitching — the play depends entirely on the sector.',
    plays: [
      {
        name: 'Classify, then pitch',
        type: 'Sheet & data',
        replaces: 'Guessing at the offer for an unclassified account.',
        example: 'Read the company website, set the industry on the directory row, then use that industry\'s plays. The directory already does this for most rows — these are the leftovers.',
      },
    ],
  },
}

// Cross-industry plays: the ones that sell into any of the 13 because the pain is
// structural rather than sectoral. Kept separate so the industry lists stay specific.
export const UNIVERSAL_PLAYS: Play[] = [
  {
    name: 'Website concierge chatbot',
    type: 'Chatbot',
    replaces: 'A contact form that produces a cold lead and a two-day reply.',
    example: 'Trained on the site we already built for them, answering product and service questions, qualifying the enquiry and booking a call. The cheapest upsell on this list because we already hold the content and the site.',
  },
  {
    name: 'Spreadsheet retirement',
    type: 'Sheet & data',
    replaces: 'The one critical spreadsheet a business actually runs on, maintained by one person, with no validation or history.',
    example: 'Move it to a real store with a proper interface, validation, audit history and the reports the sheet was faking. Ask any client which sheet would hurt most to lose — that is the scope.',
  },
  {
    name: 'Ops health dashboard',
    type: 'Dashboard',
    replaces: 'Weekly status assembled by hand from several systems into slides.',
    example: 'One live board with the handful of numbers that actually drive decisions, plus alerting when something moves. This dashboard is the reference implementation — it is worth demoing as the proof.',
  },
  {
    name: 'Inbox triage & routing',
    type: 'Workflow',
    replaces: 'A shared inbox where a person reads everything and forwards it on.',
    example: 'Classify incoming mail, extract the details that matter, route to the right owner and raise the record automatically — with anything uncertain left for a human rather than guessed at.',
  },
]
