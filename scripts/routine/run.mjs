// Standalone entry only rebuilds the derived clients table from already-synced
// tabs. The tab syncs + email scan are driven by the Claude routine (it reads
// the sheet via the Sheets connector and Gmail, then calls the writers).
import { rebuildClients } from './writers.mjs'
const n = await rebuildClients()
console.log(`[routine] rebuilt clients -> ${n} companies`)
