import { query } from "./_generated/server";

// Fixtures ordered by kickoff, each annotated with its latest debate status
// so the portal can badge "predictions in" / "pundits arguing".
export const list = query({
  args: {},
  handler: async (ctx) => {
    const fixtures = await ctx.db.query("fixtures").withIndex("by_kickoff").collect();
    const out = [];
    for (const f of fixtures) {
      const debate = await ctx.db
        .query("debates")
        .withIndex("by_fixture", (q) => q.eq("fixtureId", f._id))
        .order("desc")
        .first();
      out.push({ ...f, debateId: debate?._id ?? null, debateStatus: debate?.status ?? null });
    }
    return out;
  },
});
