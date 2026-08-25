// The NBD (new business development) team. Only these five people open genuinely
// NEW business — everyone else on the Quotes tab is an account manager working an
// existing client, so their work is repeat business however the sheet tags it.
//
// Matching is on FIRST NAME + optional surname, because the Quotes tab spells the
// same person several ways (`Nevilson` and `Nevilson Christian` are one person).
// Keep the aliases explicit rather than fuzzy-matching: `Damania` contains "aman",
// and a loose match would quietly hand Dhaval's 97 deals to Aman Acharya.
export const NBD_TEAM = [
  { name: 'Malav Modi', aliases: ['malav modi', 'malav'] },
  { name: 'Kaustubh Agrawal', aliases: ['kaustubh agrawal', 'kaustubh nag', 'kaustubh'] },
  { name: 'Devanshu Kumar', aliases: ['devanshu kumar', 'devanshu'] },
  { name: 'Nevilson Christian', aliases: ['nevilson christian', 'nevilson'] },
  { name: 'Aman Acharya', aliases: ['aman acharya'] },
] as const

const ALIAS: Set<string> = new Set(NBD_TEAM.flatMap(m => m.aliases as readonly string[]))

// One Quotes cell can carry several owners ("Malav Modi / Kalgi Shah").
const owners = (s?: string) => (s || '').split(/[,/&]|\band\b/i).map(x => x.trim().toLowerCase()).filter(Boolean)

/** True when any owner on the row is on the NBD team. */
export const isNbdOwner = (salesPerson?: string) => owners(salesPerson).some(o => ALIAS.has(o))

/** The NBD member's canonical name, for display. */
export const nbdOwnerName = (salesPerson?: string) =>
  NBD_TEAM.find(m => owners(salesPerson).some(o => (m.aliases as readonly string[]).includes(o)))?.name
