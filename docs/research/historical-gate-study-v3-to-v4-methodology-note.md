# Historical Gate V3 → V4 Methodology Note

**Dated:** July 14, 2026<br>
**Real-money gate:** closed

The causal/economic v3 rerun repaired the future-informed total-line selector, normalized binary Total Goals emissions into executor-expressible buy cases, and added fixture-clustered uncertainty. It is preserved at `historical-gate-study-causal-economic-v3.md`.

Review of that generated report exposed one remaining reporting gap: Samaritan's proposed forward paper family is **Total Goals only**, while v3 showed the training minimum for the selected detector configuration only in aggregate across Total Goals and Match Result. The held-out report already separated both market families, but it did not prove that the prespecified Total Goals family independently met the training sample floor.

V4 therefore adds one audit field without changing any detector threshold, selector rule, train/test boundary, cost proxy, label, or held-out row:

- count normalized Total Goals cases for the already training-selected configuration using training fixtures only;
- assess the prespecified held-out Total Goals slice against the same minimum sample, positive after-cost point estimate, and fixture-clustered 95% interval rule;
- keep the aggregate detector result visible;
- label any passing Total Goals result only as a historical signal candidate for a fresh forward paper review.

No v3 artifact was overwritten. V4 uses a new protocol ID, configuration hash, JSON path, and Markdown path. This refinement cannot activate the paper study: the corrected paper protocol remains `engineering_candidate_unregistered`, operational Claude readiness remains disabled, and Deborah must review and sign a fresh protocol before any qualifying observation.
