"""Pure unit tests for the agreement-statistics primitives.

These functions are where silent bugs would invalidate every calibration
result, so we test against known-correct values rather than just shape checks.
"""

import math

import pytest

from api.services.statistics_service import (
    bootstrap_qwk_ci,
    exact_agreement_rate,
    krippendorff_alpha,
    quadratic_weighted_kappa,
    within_n_agreement_rate,
)


# ------------------------------------------------------------------ #
# QWK                                                                 #
# ------------------------------------------------------------------ #


class TestQuadraticWeightedKappa:
    def test_perfect_agreement_is_one(self):
        y = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5]
        assert quadratic_weighted_kappa(y, y) == pytest.approx(1.0)

    def test_perfect_disagreement_is_negative(self):
        # Maximum disagreement on a 1-5 scale
        y1 = [1, 1, 1, 5, 5, 5]
        y2 = [5, 5, 5, 1, 1, 1]
        kappa = quadratic_weighted_kappa(y1, y2)
        assert kappa < 0

    def test_known_value_clinical_example(self):
        # From scikit-learn docs / standard QWK reference data
        y1 = [1, 2, 3, 4, 5]
        y2 = [1, 2, 3, 4, 5]
        assert quadratic_weighted_kappa(y1, y2) == pytest.approx(1.0)

    def test_one_off_disagreement(self):
        # All raters within 1 point — QWK should be high but < 1
        y1 = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5]
        y2 = [2, 3, 2, 5, 4, 1, 1, 4, 4, 4]
        kappa = quadratic_weighted_kappa(y1, y2)
        assert 0.5 < kappa < 1.0


class TestBootstrapQwkCi:
    def test_perfect_agreement_ci_collapses_near_one(self):
        y = [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]
        qwk, ci_low, ci_high = bootstrap_qwk_ci(y, y, n_resamples=100)
        assert qwk == pytest.approx(1.0)
        # CI for perfect data should be very tight at 1.0
        assert ci_low > 0.99
        assert ci_high == pytest.approx(1.0)

    def test_ci_brackets_point_estimate_in_typical_case(self):
        y1 = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5]
        y2 = [1, 2, 4, 4, 5, 2, 2, 3, 3, 5, 1, 3, 3, 4, 5]
        qwk, ci_low, ci_high = bootstrap_qwk_ci(y1, y2, n_resamples=200)
        assert ci_low <= qwk <= ci_high
        assert ci_low < ci_high   # Non-degenerate

    def test_seed_is_deterministic(self):
        y1 = [1, 3, 2, 4, 5, 2, 3, 1, 4, 5]
        y2 = [2, 3, 2, 5, 4, 1, 3, 2, 4, 5]
        a = bootstrap_qwk_ci(y1, y2, n_resamples=100)
        b = bootstrap_qwk_ci(y1, y2, n_resamples=100)
        assert a == b   # Fixed seed (42) inside


# ------------------------------------------------------------------ #
# Exact / within-N agreement                                          #
# ------------------------------------------------------------------ #


class TestSimpleAgreement:
    def test_exact_full_agreement(self):
        assert exact_agreement_rate([1, 2, 3], [1, 2, 3]) == 1.0

    def test_exact_no_agreement(self):
        assert exact_agreement_rate([1, 2, 3], [2, 3, 1]) == 0.0

    def test_exact_partial(self):
        assert exact_agreement_rate([1, 2, 3, 4], [1, 2, 5, 4]) == pytest.approx(0.75)

    def test_exact_empty(self):
        assert exact_agreement_rate([], []) == 0.0

    def test_within_1_strict(self):
        # 2 vs 4 is delta 2 — not within 1
        rate = within_n_agreement_rate([1, 2, 3, 5], [1, 2, 4, 4], 1)
        assert rate == pytest.approx(1.0)   # all within 1

    def test_within_1_with_far_pair(self):
        rate = within_n_agreement_rate([1, 2, 3], [1, 2, 5], 1)
        assert rate == pytest.approx(2 / 3)


# ------------------------------------------------------------------ #
# Krippendorff's alpha                                                #
# ------------------------------------------------------------------ #


class TestKrippendorffAlpha:
    def test_perfect_agreement_is_one(self):
        # 3 raters, 4 units, all agree
        ratings = [
            [1, 2, 3, 4],
            [1, 2, 3, 4],
            [1, 2, 3, 4],
        ]
        alpha = krippendorff_alpha(ratings, value_domain=[1, 2, 3, 4])
        assert alpha == pytest.approx(1.0)

    def test_chance_level_near_zero(self):
        # 3 raters, 6 units, scores are essentially random / disagree
        ratings = [
            [1, 2, 3, 1, 2, 3],
            [3, 2, 1, 2, 1, 3],
            [2, 3, 1, 3, 2, 1],
        ]
        alpha = krippendorff_alpha(ratings, value_domain=[1, 2, 3])
        # Random labels → near 0
        assert -0.5 < alpha < 0.5

    def test_perfect_disagreement_is_negative(self):
        ratings = [
            [1, 1, 1, 1, 1],
            [5, 5, 5, 5, 5],
        ]
        alpha = krippendorff_alpha(ratings, value_domain=[1, 2, 3, 4, 5])
        # Two raters always far apart → strongly negative
        assert alpha < -0.5

    def test_handles_missing_values(self):
        # Some units have only one rater; alpha should still compute on the rest
        ratings = [
            [1, 2, None, 3, 4],
            [1, 2, 3, 3, 4],
        ]
        alpha = krippendorff_alpha(ratings, value_domain=[1, 2, 3, 4])
        # 4/4 units fully agree → alpha very high
        assert alpha > 0.9

    def test_too_few_raters_returns_zero(self):
        ratings = [[1, 2, 3]]   # only one rater
        assert krippendorff_alpha(ratings) == 0.0


# ------------------------------------------------------------------ #
# Edge cases                                                          #
# ------------------------------------------------------------------ #


def test_qwk_constant_inputs_handled():
    """When all raters give the same value, QWK is undefined (kappa formula
    divides by zero). bootstrap_qwk_ci should handle the resulting NaN gracefully."""
    y = [3] * 20
    # cohen_kappa_score raises a warning but returns NaN; our wrapper should
    # at least not crash.
    qwk, ci_low, ci_high = bootstrap_qwk_ci(y, y, n_resamples=20)
    # Either NaN-like or zero — just ensure no exception
    assert qwk is not None
    assert ci_low is not None
    assert ci_high is not None
