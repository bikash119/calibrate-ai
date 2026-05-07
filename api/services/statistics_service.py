"""Statistical computation service for H-H and LLM-H agreement metrics."""

import logging
from itertools import combinations

import numpy as np
from scipy.stats import spearmanr
from sklearn.metrics import cohen_kappa_score

logger = logging.getLogger("scoring_ai.services.statistics")


def quadratic_weighted_kappa(y1: list[int], y2: list[int]) -> float:
    """Compute Quadratic Weighted Kappa between two rater arrays."""
    return float(cohen_kappa_score(y1, y2, weights="quadratic"))


def bootstrap_qwk_ci(
    y1: list[int], y2: list[int], n_resamples: int = 1000, confidence: float = 0.95
) -> tuple[float, float, float]:
    """Compute QWK with bootstrap confidence interval.

    Returns (qwk, ci_low, ci_high).
    """
    rng = np.random.default_rng(42)
    y1_arr = np.array(y1)
    y2_arr = np.array(y2)
    n = len(y1_arr)

    point_estimate = quadratic_weighted_kappa(y1, y2)

    boot_values = []
    for _ in range(n_resamples):
        idx = rng.integers(0, n, size=n)
        try:
            k = cohen_kappa_score(y1_arr[idx], y2_arr[idx], weights="quadratic")
            boot_values.append(k)
        except ValueError:
            continue

    if not boot_values:
        return point_estimate, point_estimate, point_estimate

    alpha = 1 - confidence
    ci_low = float(np.percentile(boot_values, 100 * alpha / 2))
    ci_high = float(np.percentile(boot_values, 100 * (1 - alpha / 2)))
    return point_estimate, ci_low, ci_high


def exact_agreement_rate(y1: list[int], y2: list[int]) -> float:
    """Fraction of observations where two raters agree exactly."""
    if not y1:
        return 0.0
    return sum(a == b for a, b in zip(y1, y2)) / len(y1)


def within_n_agreement_rate(y1: list[int], y2: list[int], n: int = 1) -> float:
    """Fraction of observations where two raters are within n points."""
    if not y1:
        return 0.0
    return sum(abs(a - b) <= n for a, b in zip(y1, y2)) / len(y1)


def krippendorff_alpha(
    ratings: list[list[int | None]], value_domain: list[int] | None = None
) -> float:
    """Compute Krippendorff's alpha for ordinal data.

    Args:
        ratings: list of rater arrays, one per rater. ratings[r][u] = score rater r
                 gave to unit u, or None if rater r didn't rate unit u.
        value_domain: the possible score values (e.g., [1,2,3,4,5]).

    Returns:
        Alpha coefficient. 1.0 = perfect agreement, 0.0 = chance.
    """
    n_raters = len(ratings)
    if n_raters < 2:
        return 0.0

    n_units = len(ratings[0])
    if value_domain is None:
        all_values = {v for rater in ratings for v in rater if v is not None}
        value_domain = sorted(all_values)

    # Build coincidence matrix
    n_values = len(value_domain)
    val_to_idx = {v: i for i, v in enumerate(value_domain)}
    coincidence = np.zeros((n_values, n_values))

    for u in range(n_units):
        unit_values = [ratings[r][u] for r in range(n_raters) if ratings[r][u] is not None]
        m_u = len(unit_values)
        if m_u < 2:
            continue
        for i in range(len(unit_values)):
            for j in range(len(unit_values)):
                if i != j:
                    c = val_to_idx[unit_values[i]]
                    k = val_to_idx[unit_values[j]]
                    coincidence[c, k] += 1.0 / (m_u - 1)

    n_total = coincidence.sum()
    if n_total == 0:
        return 0.0

    # Marginals
    marginals = coincidence.sum(axis=1)

    # Observed disagreement
    d_o = 0.0
    d_e = 0.0
    for c in range(n_values):
        for k in range(n_values):
            # Ordinal metric: (c - k)^2
            metric = (value_domain[c] - value_domain[k]) ** 2
            d_o += coincidence[c, k] * metric
            d_e += marginals[c] * marginals[k] * metric

    if d_e == 0:
        return 1.0

    d_o /= n_total
    d_e /= n_total * (n_total - 1)

    return 1.0 - d_o / d_e


def spearman_rho_averaged(
    evaluator_totals: dict[str, dict[int, float]]
) -> float:
    """Average Spearman rho across all evaluator pairs.

    Args:
        evaluator_totals: {evaluator_id: {application_id: total_score}}

    Returns:
        Average Spearman rho.
    """
    evaluator_ids = list(evaluator_totals.keys())
    if len(evaluator_ids) < 2:
        return 0.0

    rhos = []
    for e1, e2 in combinations(evaluator_ids, 2):
        common_apps = set(evaluator_totals[e1].keys()) & set(evaluator_totals[e2].keys())
        if len(common_apps) < 3:
            continue
        app_list = sorted(common_apps)
        v1 = [evaluator_totals[e1][a] for a in app_list]
        v2 = [evaluator_totals[e2][a] for a in app_list]
        rho, _ = spearmanr(v1, v2)
        if not np.isnan(rho):
            rhos.append(rho)

    return float(np.mean(rhos)) if rhos else 0.0


def classification_agreement_at_cutoff(
    evaluator_totals: dict[str, dict[int, float]],
    cutoff_percentile: float = 30.0,
) -> float:
    """Compute pairwise classification agreement at the bottom-X% cutoff.

    For each evaluator pair, compute the fraction of applications where both
    agree on keep/cut at the given percentile cutoff.
    """
    evaluator_ids = list(evaluator_totals.keys())
    if len(evaluator_ids) < 2:
        return 0.0

    agreements = []
    for e1, e2 in combinations(evaluator_ids, 2):
        common_apps = set(evaluator_totals[e1].keys()) & set(evaluator_totals[e2].keys())
        if len(common_apps) < 5:
            continue
        app_list = sorted(common_apps)
        v1 = np.array([evaluator_totals[e1][a] for a in app_list])
        v2 = np.array([evaluator_totals[e2][a] for a in app_list])

        t1 = np.percentile(v1, cutoff_percentile)
        t2 = np.percentile(v2, cutoff_percentile)

        cut1 = v1 <= t1
        cut2 = v2 <= t2
        agree = (cut1 == cut2).mean()
        agreements.append(agree)

    return float(np.mean(agreements)) if agreements else 0.0


def compute_hh_baseline(
    evaluator_scores: list[dict],
    criterion_names: list[str],
    scale_values: list[int] | None = None,
    cutoff_percentile: float = 30.0,
) -> dict:
    """Compute the full H-H baseline for a project.

    Args:
        evaluator_scores: list of dicts with keys: application_id, evaluator_id, criterion_name, score
        criterion_names: list of criterion names to compute metrics for
        scale_values: the possible score values (e.g., [1,2,3,4,5])
        cutoff_percentile: bottom-X% for classification agreement

    Returns:
        {
            "per_criterion": [{"criterion_name": ..., "exact_agreement": ..., ...}, ...],
            "overall_qwk": float,
            "spearman_rho": float,
            "classification_agreement": float,
            "evaluator_pairs": int,
        }
    """
    # Group scores by criterion and application
    by_criterion: dict[str, dict[int, dict[str, int]]] = {}
    for s in evaluator_scores:
        crit = s["criterion_name"]
        app_id = s["application_id"]
        eval_id = s["evaluator_id"]
        if crit not in by_criterion:
            by_criterion[crit] = {}
        if app_id not in by_criterion[crit]:
            by_criterion[crit][app_id] = {}
        by_criterion[crit][app_id][eval_id] = s["score"]

    # Collect all evaluator IDs
    all_evaluators = set()
    for s in evaluator_scores:
        all_evaluators.add(s["evaluator_id"])
    evaluator_ids = sorted(all_evaluators)
    n_pairs = len(list(combinations(evaluator_ids, 2)))

    per_criterion = []
    all_qwks = []

    for crit_name in criterion_names:
        crit_data = by_criterion.get(crit_name, {})

        # Build pairwise comparisons for QWK/exact/within-1
        y1_all, y2_all = [], []
        for app_id, app_scores in crit_data.items():
            evals = list(app_scores.items())
            for (e1, s1), (e2, s2) in combinations(evals, 2):
                y1_all.append(s1)
                y2_all.append(s2)

        if len(y1_all) < 3:
            per_criterion.append({
                "criterion_name": crit_name,
                "exact_agreement": None,
                "within_1": None,
                "qwk": None,
                "qwk_ci_low": None,
                "qwk_ci_high": None,
                "krippendorff_alpha": None,
                "n_pairs": 0,
            })
            continue

        exact = exact_agreement_rate(y1_all, y2_all)
        within1 = within_n_agreement_rate(y1_all, y2_all, 1)
        qwk, ci_low, ci_high = bootstrap_qwk_ci(y1_all, y2_all)
        all_qwks.append(qwk)

        # Krippendorff alpha — build ratings matrix
        app_ids_ordered = sorted(crit_data.keys())
        ratings_matrix = []
        for eval_id in evaluator_ids:
            row = [crit_data.get(app_id, {}).get(eval_id, None) for app_id in app_ids_ordered]
            ratings_matrix.append(row)
        alpha = krippendorff_alpha(ratings_matrix, value_domain=scale_values)

        per_criterion.append({
            "criterion_name": crit_name,
            "exact_agreement": round(exact, 4),
            "within_1": round(within1, 4),
            "qwk": round(qwk, 4),
            "qwk_ci_low": round(ci_low, 4),
            "qwk_ci_high": round(ci_high, 4),
            "krippendorff_alpha": round(alpha, 4),
            "n_pairs": len(y1_all),
        })

    # Overall metrics
    overall_qwk = float(np.mean(all_qwks)) if all_qwks else None

    # Spearman rho on totals
    evaluator_totals: dict[str, dict[int, float]] = {}
    for s in evaluator_scores:
        eid = s["evaluator_id"]
        aid = s["application_id"]
        if eid not in evaluator_totals:
            evaluator_totals[eid] = {}
        evaluator_totals[eid][aid] = evaluator_totals[eid].get(aid, 0) + s["score"]

    rho = spearman_rho_averaged(evaluator_totals)
    class_agree = classification_agreement_at_cutoff(evaluator_totals, cutoff_percentile)

    return {
        "per_criterion": per_criterion,
        "overall_qwk": round(overall_qwk, 4) if overall_qwk is not None else None,
        "spearman_rho": round(rho, 4),
        "classification_agreement": round(class_agree, 4),
        "evaluator_pairs": n_pairs,
    }
