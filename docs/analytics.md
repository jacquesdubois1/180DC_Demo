# Analytics: methods behind the numbers

Every number the Hub shows can be explained in one sentence to the team, and every method is tested against data with
a known truth (`tests/unit`). The demo seed is generated with built-in effects (harsh reviewers, a better e-mail variant,
better-fitting leads replying more) so you can check that the analytics recover them.

## Recruitment

### Reviewer calibration - `lib/analytics/calibration.ts`

Each application is scored by different reviewers, so a raw average mixes the candidate's quality with *who happened to
review them*. The Hub fits an additive two-way model

```
score[a, r] = μ + θ[a] + β[r] + ε        ε ~ N(0, σ²)
```

- `θ[a]` candidate quality - what we rank on
- `β[r]` reviewer severity - negative = harsher than average

Estimated by **penalised alternating least squares** (ridge penalties λ_reviewer = 2, λ_candidate = 0.5 shrink estimates
for people with little data towards zero - the random-effects / empirical-Bayes idea). Reviewers overlap across many
candidates, which is what makes `β` identifiable. Standard errors are `σ / √(n + λ)`.
The calibration page shows each reviewer's severity with its uncertainty, the share of score variance explained by
reviewers, and how many ranks each candidate moves.

*Test:* on a synthetic cycle with known severities the estimates correlate > 0.95 with the truth, and the calibrated
ranking is closer to true quality than the raw average.

### Inter-rater reliability - `lib/analytics/agreement.ts`

**Krippendorff's α (interval metric)**: `α = 1 − D_observed / D_expected`. Works with any number of reviewers per
candidate and missing reviews. Rule of thumb: ≥ 0.8 reliable, 0.667-0.8 tentative, below that the rubric needs clearer
anchors. *Test:* reproduces the textbook value 0.849 from Krippendorff (2011).

### Reviewer assignment - `lib/analytics/assignment.ts`

An **integer linear program** solved with HiGHS (WebAssembly, runs inside the serverless function):

| | |
| --- | --- |
| decision | `x[a,r] ∈ {0,1}`: reviewer r reviews application a |
| coverage | each application gets the required number of reviewers (soft, shortage penalised ×1000) |
| capacity | `current_load[r] + Σ_a x[a,r] ≤ capacity[r]` |
| conflicts | a declared conflict of interest never gets a variable |
| seniority | at least one senior reviewer per application (soft) |
| fairness | `L ≥ load[r] / capacity[r]` for all r, and L is minimised |
| objective | `1000·shortage + 5·missing senior + 20·L − expertise matches` |

Typical cycle (140 applications, 6 reviewers) solves in well under a second. If the solver is unavailable a greedy
heuristic produces a feasible plan. HR always sees the proposal before applying it.

## Client outreach

### A/B testing of e-mails - `lib/outreach/abtest.ts`

Each variant's reply rate gets a **Beta(1 + replies, 1 + non-replies)** posterior. From 20,000 Monte-Carlo draws:

- `P(B > A)` and `P(variant is best)` - "there is a 94% chance that B gets more replies"
- 90% credible interval per variant
- **expected loss** `E[max_k θ_k − θ_v]`: how many reply-rate points we give up by committing to variant v

Stopping rule: a variant wins when its expected loss is below 0.5 percentage points (Stucchio's criterion) or it is best
with ≥ 95% probability, and every variant has at least 20 sends. Unlike a p-value this is valid whenever you look.

New sends are split by **Thompson sampling**: each e-mail draws once from every posterior and uses the variant with the
highest draw. Better variants get more traffic while the test keeps learning.

### Lead scoring - `lib/outreach/scoring.ts`, `lib/outreach/score-job.ts`

Two transparent layers:

1. **Fit (0-100)** from the ideal client profile that Client Relations edits: weighted match of sector, organisation type,
   size, location and an Esade-alumni contact. Bands A (≥ 80), B (65-80), C (50-65), D.
2. **Probabilities learned from history**
   - `P(sign | stage reached)` and a lift per fit band
   - learned from a **mature cohort** (leads created ≥ 60 days ago). Inside it, a lead that is not signed counts as not
     won unless it is visibly still in play. This removes two biases: *survivorship* (most leads are never closed, they
     just go quiet) and *right-censoring* (young leads had no time to sign)
   - **empirical-Bayes shrinkage** with k = 5 pseudo-observations of the overall rate, so a band with one lucky win does not
     get a 100% rate
   - **isotonic regression** (pool-adjacent-violators) keeps the band lifts monotone: a better fit never predicts a lower
     win rate
   - a follow-up e-mail is a side step, not a stage every signed lead passed - otherwise follow-ups look like a strong
     success signal

`P(win) = P(sign | current stage) × lift(band)`. The overview sums it over open leads into the expected number of signed
projects and compares it with the consulting teams recruitment will staff this term.

The scoring page validates the profile on the data (reply rate per fit band) and offers a what-if preview before saving a
new profile version.

### Entity resolution - `lib/outreach/dedup.ts`

Normalise (accents, punctuation, legal forms like S.L., GmbH) → block (first letter / first token) → compare with
**Jaro-Winkler**. Same website or company e-mail domain, or an identical normalised name, is a sure duplicate; similarity
≥ 0.88 is a *possible* duplicate that a person decides. (Short names with a long common prefix, like "Kidsnet" and
"Kidsnest", score above 0.97 - which is why similarity alone never merges automatically.)
