# Sponsor Clarification Request

**Status:** Ready for Deborah to send<br>
**Sender:** Deborah, the human participant and project owner<br>
**Suggested recipient:** TxODDS hackathon support / TxLINEChat<br>
**Subject:** Eligibility and public derived-data clarification for Samaritan

Hello TxODDS team,

I am Deborah, the human participant, project owner, and submitter of Samaritan, an entry for the Trading Tools and Agents bounty. I remain responsible for the product decisions, submission, demo, and any judge interview. Samaritan uses Claude as a constrained runtime component: it can produce a structured research thesis, but deterministic code owns eligibility, risk, sizing, and execution. Claude has no wallet or order-placement access.

Before submission, could you please confirm two points in writing?

1. **Human participation and agent products.** The bounty invites trading-agent products, while the hackathon terms say entries must be created, developed, and submitted by human participants and the listing metadata identifies the opportunity as `HUMAN_ONLY`. Is Samaritan eligible under the structure above, with me as the human participant and submitter and Claude disclosed only as a constrained component of the product? Is there any additional disclosure wording you would like us to use?

2. **Public derived TXLine output.** We will not publish raw TXLine captures, raw API responses, or a reconstructable copy of the feed. May our public, no-login judge demo display the following outputs derived from TXLine?

   - detector labels and decisions;
   - changes, velocities, z-scores, CUSUM values, cross-market gaps, and latency aggregates;
   - aggregated or rounded probability movements rather than raw probability series;
   - fixture and market identifiers needed to explain a decision;
   - hashes or proof references that let a judge verify provenance without recovering the source feed;
   - a small frozen replay bundle containing only those derived values and decisions.

Please also confirm whether showing an exact normalized `Pct / 100` value or time series would still count as publishing TXLine Data. Unless you approve that expressly, we will omit exact normalized series and expose only non-reconstructive transformations and aggregates.

If the public judge demo must be removed or changed when the hackathon data licence ends, please tell us what availability window you expect for judging.

Thank you. We want the submission to demonstrate TXLine deeply while respecting both the human-participation rule and the data licence.

Deborah<br>
Human participant and project owner, Samaritan

## Internal handling notes

- Deborah must send this request herself and retain the complete written response.
- Do not paraphrase silence as approval.
- Until an affirmative response is received, keep exact normalized TXLine probability series and reconstructive replay data out of public artifacts.
- Until fixture/market-identifier display is affirmatively approved, omit TXLine-specific identifiers from hosted UI/API output, downloadable evidence, receipts, screenshots, video, and submission copy unless their public provenance is independently documented; keep the judge story on derived decisions, buckets, aggregates, and hashes. Opaque request selectors may remain in reproducibility-oriented source/capture configuration because they are not raw or reconstructive feed payloads.
- If the answer narrows permissible use, update the dashboard, repository bundle, video, and submission copy before publication.
- This draft is an operational clarification request, not legal advice.
