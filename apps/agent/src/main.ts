/** Future site agent boundary. The MVP intentionally performs no remote mutations. */
const site = process.env.LAIN_SITE ?? "unknown";
console.log(`lain-agent stub started for site "${site}". Remote reconciliation is not enabled in the MVP.`);
