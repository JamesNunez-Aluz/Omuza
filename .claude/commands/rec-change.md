Evaluate this recommendation change ($ARGUMENTS) against the deterministic baseline.

Require:
- explicit hypothesis;
- feature provenance for every input;
- leakage review (no future data, no destination-service data);
- versioned ranker/selector;
- golden and property tests;
- offline temporal evaluation;
- novelty, diversity, aversion, and calibration guardrails;
- rollback plan (one feature-flag change).

Reject any feature derived from Spotify or a source without approved model/
recommendation eligibility. Reject any embedding computed from ineligible text
(spec §10.20 permits only user free-text, confirmed reason elaborations, and
license-eligible catalog tags).
