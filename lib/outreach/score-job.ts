import type { Tx } from "@/lib/db";
import { fitBand, fitScore, type IcpCriteria, learnRates, reachedStages, winProbability } from "./scoring";

/**
 * Recompute fit score, reply probability and win probability for every lead.
 * Runs inside the caller's transaction (RLS as a Client Relations user, or service role from cron).
 */
export async function recomputeScores(sql: Tx) {
  const [icp] = await sql<{ criteria: IcpCriteria }[]>`select criteria from icp_profiles where is_active order by created_at desc limit 1`;
  if (!icp) return { scored: 0 };
  const leads = await sql<{ id: string; stage: string; sector: string | null; organization_type: string | null; size_band: string | null;
    city: string | null; primary_contact_is_alumni: boolean; replied: boolean; contacted: boolean; history: string[]; days_since_activity: number; age_days: number }[]>`
    select l.id, l.stage::text, l.sector, l.organization_type::text, l.size_band, l.city, l.primary_contact_is_alumni, l.days_since_activity,
           extract(day from now() - l.created_at)::int as age_days,
           exists (select 1 from interactions i where i.lead_id = l.id and i.type = 'email_in') as replied,
           exists (select 1 from interactions i where i.lead_id = l.id and i.type = 'email_out') as contacted,
           coalesce((select array_agg(h.to_status) from status_history h where h.entity = 'lead' and h.entity_id = l.id), '{}') as history
    from v_leads l`;

  const scored = leads.map((l) => {
    const fit = fitScore({ sector: l.sector, orgType: l.organization_type, sizeBand: l.size_band, city: l.city, alumniContact: l.primary_contact_is_alumni }, icp.criteria);
    return { ...l, fit, band: fitBand(fit.score) };
  });
  // Two biases to avoid when learning conversion rates:
  //  - survivorship: most leads are never "closed", they just go quiet. Learning only from leads
  //    someone marked won/lost makes the win rate far too optimistic.
  //  - right-censoring: young leads have not had time to sign yet.
  // So we learn from a mature cohort (created 60+ days ago, like a vintage analysis): in it, a lead
  // that is not signed counts as not won - unless it is still visibly in play (replied / meeting /
  // proposal with activity in the last 30 days), whose outcome is unknown and is left out.
  const MATURE_DAYS = 60;
  const IN_PLAY = ["replied", "meeting", "proposal"];
  const cohort = scored.filter((l) => l.age_days >= MATURE_DAYS && !(IN_PLAY.includes(l.stage) && l.days_since_activity <= 30));
  const closed = cohort.map((l) => ({
    band: l.band,
    outcome: (l.stage === "won" ? "won" : l.stage === "not_interested" ? "not_interested" : "lost") as "won" | "lost" | "not_interested",
    reached: reachedStages(l.stage, l.history),
  }));
  const rates = learnRates(closed);

  // reply probability per band (empirical Bayes over contacted leads)
  const contacted = scored.filter((l) => l.contacted);
  const overallReply = contacted.length ? contacted.filter((l) => l.replied).length / contacted.length : 0.15;
  const replyByBand: Record<string, number> = {};
  for (const b of ["A", "B", "C", "D"]) {
    const pool = contacted.filter((l) => l.band === b);
    replyByBand[b] = (pool.filter((l) => l.replied).length + 10 * overallReply) / (pool.length + 10);
  }

  for (const l of scored) {
    const win = winProbability(l.stage, l.band, rates);
    await sql`
      insert into lead_scores (lead_id, fit_score, reply_probability, win_probability, components, model, computed_at)
      values (${l.id}, ${l.fit.score}, ${l.replied ? 1 : replyByBand[l.band]}, ${win},
              ${sql.json({ ...l.fit.parts, band: l.band, stage_rate: rates.stage[l.stage] ?? null, band_lift: rates.band[l.band] })}, 'icp-v1+eb', now())
      on conflict (lead_id) do update set fit_score = excluded.fit_score, reply_probability = excluded.reply_probability,
        win_probability = excluded.win_probability, components = excluded.components, model = excluded.model, computed_at = now()`;
  }
  return { scored: scored.length, rates, replyByBand, overallReply };
}
