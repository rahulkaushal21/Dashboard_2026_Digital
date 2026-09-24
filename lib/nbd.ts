// The NBD (new business development) team. Only these six people open genuinely
// NEW business — everyone else on the Quotes tab is an account manager working an
// existing client, so their work is repeat business however the sheet tags it.
//
// Matching is on FIRST NAME + optional surname, because the Quotes tab spells the
// same person several ways (`Nevilson` and `Nevilson Christian` are one person).
// Keep the aliases explicit rather than fuzzy-matching: `Damania` contains "aman",
// and a loose match would quietly hand Dhaval's 97 deals to Aman Acharya.
//
// A BARE FIRST NAME is an alias only where exactly one person in the whole book carries
// it — `Nevilson` appears on its own in 6 rows and there is only one of him. Where a
// first name is shared it is NEVER an alias: three people are called Kaustubh and two
// Rahul, and a bare first name would silently credit one person's new business to
// another. Check before adding one.
export const NBD_TEAM = [
  { name: 'Malav Modi', aliases: ['malav modi', 'malav'] },
  // Kaustubh NAG (kaustubh.n@mavlers.com) is the NBD one. Kaustubh AGRAWAL is an
  // account manager and was on this list by mistake until 25 Sep 2026, which made 25
  // of his deals read as new business — and there is a third, Kaustubh Kulkarni.
  // So: no bare 'kaustubh' alias, ever. Same trap as Rahul Jain vs Rahul Kaushal.
  { name: 'Kaustubh Nag', aliases: ['kaustubh nag', 'kaustubh n'] },
  { name: 'Devanshu Kumar', aliases: ['devanshu kumar', 'devanshu'] },
  { name: 'Nevilson Christian', aliases: ['nevilson christian', 'nevilson'] },
  { name: 'Aman Acharya', aliases: ['aman acharya'] },
  // The Quotes tab spells him 'kamesh Biniwale' with a lower-case k; owners are
  // lower-cased before matching, so the full-name alias catches it either way.
  { name: 'Kamesh Biniwale', aliases: ['kamesh biniwale', 'kamesh'] },
] as const

const ALIAS: Set<string> = new Set(NBD_TEAM.flatMap(m => m.aliases as readonly string[]))

// One Quotes cell can carry several owners ("Malav Modi / Kalgi Shah").
const owners = (s?: string) => (s || '').split(/[,/&]|\band\b/i).map(x => x.trim().toLowerCase()).filter(Boolean)

/** True when any owner on the row is on the NBD team. */
export const isNbdOwner = (salesPerson?: string) => owners(salesPerson).some(o => ALIAS.has(o))

/** The NBD member's canonical name, for display. */
export const nbdOwnerName = (salesPerson?: string) =>
  NBD_TEAM.find(m => owners(salesPerson).some(o => (m.aliases as readonly string[]).includes(o)))?.name
