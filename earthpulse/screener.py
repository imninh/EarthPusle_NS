"""Variable Screener metrics for the EarthPulse data contract section 6.

Pure NumPy functions over contract-shaped ``(180, 360)`` arrays (row 0 is the
northernmost row). This module reads and writes no files; the export step
(P-EXPORT) loads the P03 trend layers, calls these functions and writes
``screener/{window}/{domain}.json``.

Definitions follow docs/DATA_CONTRACT.md section 6 and
docs/packages/specs/P03b_screener_patterns.md section 3:

- Cell area is proportional to ``cos(latitude)`` of the cell centre.
- Evaluated cells are domain cells whose ``trend_class`` is one of
  ``-1, 0, 1``.
- Area fractions are sums of cell weights, not plain cell counts.
- The area-weighted median is the smallest value whose cumulative weight
  reaches at least half of the total weight (``>= 50%``). An exact-half tie
  therefore selects the lower value.
- ``None`` is used where a ratio or median is undefined (for example a domain
  with no land cells), so the result maps directly to JSON ``null``.

All test data are synthetic. This module never invents data values.
"""

from __future__ import annotations

import numpy as np

from earthpulse import contract as contract

__all__ = [
    "domain_mask",
    "screener_row",
    "screener_table",
    "weighted_median",
]

_DOMAIN_SHAPE = (contract.N_ROWS, contract.N_COLS)
_EVALUATED_CLASSES = (
    contract.TREND_DECREASE,
    contract.TREND_NOT_SIGNIFICANT,
    contract.TREND_INCREASE,
)
_SIGNIFICANT_CLASSES = (contract.TREND_DECREASE, contract.TREND_INCREASE)


def _latitude_weights() -> np.ndarray:
    """Return the ``cos(lat)`` weight of every grid row (shape ``(180,)``)."""

    rows = np.arange(contract.N_ROWS, dtype=float)
    latitudes = contract.LAT_NORTH_CENTER - rows * contract.RESOLUTION_DEG
    return np.cos(np.deg2rad(latitudes))


def _require_contract_shape(name: str, array: np.ndarray) -> None:
    if array.shape != _DOMAIN_SHAPE:
        raise ValueError(
            f"{name} must have contract shape {_DOMAIN_SHAPE}, got {array.shape}"
        )


def domain_mask(
    domain: str | tuple[float, float, float, float],
    common_mask: np.ndarray,
) -> np.ndarray:
    """Cells belonging to ``domain`` and to the common land mask.

    Parameters
    ----------
    domain:
        ``"global"`` for the whole common mask, or a bounding box
        ``(west, south, east, north)`` in degrees. Cell centres on a boundary
        are included. A box with ``west > east`` crosses the antimeridian.
    common_mask:
        Boolean ``(180, 360)`` mask with ``True`` inside the common domain.

    Returns
    -------
    bool ndarray
        ``(180, 360)`` array; the returned array is a new array, so callers may
        modify it without changing ``common_mask``.
    """

    mask = np.asarray(common_mask, dtype=bool)
    _require_contract_shape("common_mask", mask)

    if isinstance(domain, str):
        if domain != "global":
            raise ValueError(f"unknown domain {domain!r}; expected 'global' or a bbox")
        return mask.copy()

    try:
        west, south, east, north = (float(value) for value in domain)
    except (TypeError, ValueError) as exc:
        raise TypeError(
            "domain must be 'global' or a (west, south, east, north) bbox"
        ) from exc

    if not (-90.0 <= south <= north <= 90.0):
        raise ValueError(f"invalid latitude bounds in bbox: {domain!r}")
    if not (-180.0 <= west <= 180.0 and -180.0 <= east <= 180.0):
        raise ValueError(f"invalid longitude bounds in bbox: {domain!r}")

    rows = np.arange(contract.N_ROWS, dtype=float)
    latitudes = contract.LAT_NORTH_CENTER - rows * contract.RESOLUTION_DEG
    cols = np.arange(contract.N_COLS, dtype=float)
    longitudes = contract.LON_WEST_CENTER + cols * contract.RESOLUTION_DEG

    inside_lat = (latitudes >= south) & (latitudes <= north)
    if west <= east:
        inside_lon = (longitudes >= west) & (longitudes <= east)
    else:  # bbox crosses the antimeridian
        inside_lon = (longitudes >= west) | (longitudes <= east)

    return mask & inside_lat[:, None] & inside_lon[None, :]


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float | None:
    """Area-weighted median with the contract's exact-half rule.

    Sort the finite values ascending and return the smallest value whose
    cumulative weight reaches at least half of the total weight. An exact-half
    tie therefore selects the lower value: values ``[1, 2, 3]`` with weights
    ``[1, 1, 2]`` give ``2`` (not ``2.5``).

    Zero or non-finite weights are ignored; non-finite values are ignored
    together with their weights. Returns ``None`` when no usable value exists.
    The half boundary is compared with a relative tolerance of ``1e-12`` so
    that floating-point accumulation does not flip an exact split.
    """

    values_array = np.asarray(values, dtype=float).ravel()
    weights_array = np.asarray(weights, dtype=float).ravel()
    if values_array.shape != weights_array.shape:
        raise ValueError("values and weights must have the same number of elements")

    keep = (
        np.isfinite(values_array)
        & np.isfinite(weights_array)
        & (weights_array > 0.0)
    )
    if not np.any(keep):
        return None

    values_array = values_array[keep]
    weights_array = weights_array[keep]
    order = np.argsort(values_array, kind="stable")
    values_array = values_array[order]
    cumulative = np.cumsum(weights_array[order])

    half = 0.5 * cumulative[-1]
    # Floating-point cumulative sums can land an ulp or two below the exact
    # half; the relative tolerance keeps an equal split deterministic.
    target = half - 1e-12 * abs(float(cumulative[-1]))
    # side="left" gives the first index whose cumulative weight is >= target.
    index = int(np.searchsorted(cumulative, target, side="left"))
    index = min(index, values_array.size - 1)
    return float(values_array[index])


def screener_row(
    variable_id: str,
    trend_class: np.ndarray,
    std_change_decade: np.ndarray,
    sen_slope_decade: np.ndarray,
    domain: np.ndarray,
) -> dict:
    """Compute one contract section 6 row.

    ``domain`` must already be the domain intersected with the common mask
    (usually the output of :func:`domain_mask`). Classes other than ``-1, 0, 1``
    (``-9`` and ``-99``) are not evaluated.

    ``valid_area_fraction`` uses the whole domain as denominator. The two
    ``sig_*`` fractions use the evaluated area as denominator. Medians are
    taken over significant cells only (classes ``1`` and ``-1``), ignoring
    non-finite values there. ``n_cells_evaluated`` is a plain cell count.
    """

    if not isinstance(variable_id, str) or not variable_id:
        raise ValueError("variable_id must be a non-empty string")

    classes = np.asarray(trend_class)
    std_change = np.asarray(std_change_decade, dtype=float)
    sen_slope = np.asarray(sen_slope_decade, dtype=float)
    domain_array = np.asarray(domain, dtype=bool)

    _require_contract_shape("trend_class", classes)
    _require_contract_shape("std_change_decade", std_change)
    _require_contract_shape("sen_slope_decade", sen_slope)
    _require_contract_shape("domain", domain_array)

    weights = np.broadcast_to(_latitude_weights()[:, None], _DOMAIN_SHAPE)

    evaluated = domain_array & np.isin(classes, _EVALUATED_CLASSES)
    significant = evaluated & np.isin(classes, _SIGNIFICANT_CLASSES)
    increasing = significant & (classes == contract.TREND_INCREASE)
    decreasing = significant & (classes == contract.TREND_DECREASE)

    domain_area = float(weights[domain_array].sum())
    evaluated_area = float(weights[evaluated].sum())
    increase_area = float(weights[increasing].sum())
    decrease_area = float(weights[decreasing].sum())

    def _fraction(numerator: float, denominator: float) -> float | None:
        if denominator <= 0.0:
            return None
        return float(numerator / denominator)

    valid_area_fraction = _fraction(evaluated_area, domain_area)
    sig_increase_area_fraction = _fraction(increase_area, evaluated_area)
    sig_decrease_area_fraction = _fraction(decrease_area, evaluated_area)

    if (
        sig_increase_area_fraction is None
        or sig_decrease_area_fraction is None
        or sig_increase_area_fraction + sig_decrease_area_fraction == 0.0
    ):
        regional_contrast = None
    else:
        total = sig_increase_area_fraction + sig_decrease_area_fraction
        regional_contrast = float(
            min(sig_increase_area_fraction, sig_decrease_area_fraction) / total
        )

    significant_weights = weights[significant]
    median_abs_std_change_decade = weighted_median(
        np.abs(std_change[significant]), significant_weights
    )
    median_sen_slope_decade_sig = weighted_median(
        sen_slope[significant], significant_weights
    )

    return {
        "variable": variable_id,
        "valid_area_fraction": valid_area_fraction,
        "sig_increase_area_fraction": sig_increase_area_fraction,
        "sig_decrease_area_fraction": sig_decrease_area_fraction,
        "median_abs_std_change_decade": median_abs_std_change_decade,
        "median_sen_slope_decade_sig": median_sen_slope_decade_sig,
        "regional_contrast": regional_contrast,
        "n_cells_evaluated": int(np.count_nonzero(evaluated)),
    }


def screener_table(
    per_variable: dict[str, dict[str, np.ndarray]],
    domain: np.ndarray,
) -> list[dict]:
    """Build the ``rows`` list of a screener JSON file.

    ``per_variable`` maps variable id to a dict with the keys
    ``trend_class``, ``std_change_decade`` and ``sen_slope_decade``. Insertion
    order is preserved in the returned list.
    """

    required = ("trend_class", "std_change_decade", "sen_slope_decade")
    domain_array = np.asarray(domain, dtype=bool)
    _require_contract_shape("domain", domain_array)

    rows: list[dict] = []
    for variable_id, layers in per_variable.items():
        missing = [key for key in required if key not in layers]
        if missing:
            raise KeyError(f"{variable_id!r} is missing layers: {missing}")
        rows.append(
            screener_row(
                variable_id,
                layers["trend_class"],
                layers["std_change_decade"],
                layers["sen_slope_decade"],
                domain_array,
            )
        )
    return rows
