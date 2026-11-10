"""Schema 1.3 second-witness agreement layers (DATA_CONTRACT §13).

The agreement compares a main P03 trend file with the independent P13 witness
trend file of the same variable and window:

- sign from the Sen slope of each product;
- significance from each product's own BH-FDR q < 0.05;
- codes: 2 corroborated, 1 same sign / witness not significant,
  -1 opposite sign / witness not significant, -2 contradicted,
  0 main trend not significant, -9 not evaluated, -99 outside domain.
"""

from __future__ import annotations

from pathlib import Path
from typing import Mapping

import numpy as np
import xarray as xr
from numpy.typing import ArrayLike

from earthpulse import contract

WITNESS_AGREEMENT_CODES = frozenset(
    {
        contract.WITNESS_CORROBORATED,
        contract.WITNESS_SAME_SIGN,
        contract.WITNESS_MAIN_NOT_SIGNIFICANT,
        contract.WITNESS_OPPOSITE_SIGN,
        contract.WITNESS_CONTRADICTED,
        contract.INSUFFICIENT_DATA,
        contract.OUTSIDE_DOMAIN,
    }
)

# Product metadata for index.witness.products (DATA_CONTRACT §13).
WITNESS_PRODUCT_INFO: dict[str, dict[str, str]] = {
    "M2TMNXSLV": {"doi": "10.5067/AP1B0BA5PD2K", "label": "MERRA-2 reanalysis"},
    "M2TMNXLND": {"doi": "10.5067/8S35XF81C28F", "label": "MERRA-2 reanalysis"},
    "GPCPMON": {"doi": "10.5067/MEASURES/GPCP/DATA306", "label": "GPCP satellite–gauge"},
}

MAIN_TREND_LAYER_NAMES = ("sen_slope", "q_value", "trend_class")
TREND_LAYER_NAMES = (*MAIN_TREND_LAYER_NAMES, "std_change_decade")


def _grid(values: ArrayLike, label: str) -> np.ndarray:
    array = np.asarray(values)
    if array.shape != (contract.N_ROWS, contract.N_COLS):
        raise ValueError(
            f"{label}: expected shape {(contract.N_ROWS, contract.N_COLS)}, "
            f"got {array.shape}"
        )
    return array


def _finite(values: np.ndarray) -> np.ndarray:
    return np.isfinite(np.asarray(values, dtype=float))


def witness_agreement(
    main_sen_slope: ArrayLike,
    main_q_value: ArrayLike,
    main_trend_class: ArrayLike,
    witness_sen_slope: ArrayLike,
    witness_q_value: ArrayLike,
    witness_trend_class: ArrayLike,
    mask: ArrayLike | None = None,
    q_threshold: float = contract.Q_THRESHOLD,
) -> np.ndarray:
    """Return the int8 witness_agreement grid for one variable × window."""
    main_slope = _grid(main_sen_slope, "main_sen_slope")
    main_q = _grid(main_q_value, "main_q_value")
    main_class = _grid(main_trend_class, "main_trend_class")
    witness_slope = _grid(witness_sen_slope, "witness_sen_slope")
    witness_q = _grid(witness_q_value, "witness_q_value")
    witness_class = _grid(witness_trend_class, "witness_trend_class")

    if mask is not None:
        domain = _grid(mask, "mask").astype(bool)
        outside = ~domain
    else:
        outside = np.zeros(main_class.shape, dtype=bool)

    main_values = np.asarray(main_slope, dtype=float)
    witness_values = np.asarray(witness_slope, dtype=float)
    main_q_values = np.asarray(main_q, dtype=float)
    witness_q_values = np.asarray(witness_q, dtype=float)

    outside |= (main_class == contract.OUTSIDE_DOMAIN) | (
        witness_class == contract.OUTSIDE_DOMAIN
    )

    main_slope_valid = _finite(main_values)
    witness_slope_valid = _finite(witness_values)
    main_directional = main_slope_valid & (main_values != 0)
    witness_directional = witness_slope_valid & (witness_values != 0)
    main_q_valid = _finite(main_q_values)
    witness_q_valid = _finite(witness_q_values)

    not_evaluated = (
        (main_class == contract.INSUFFICIENT_DATA)
        | (witness_class == contract.INSUFFICIENT_DATA)
        | ~main_slope_valid
        | ~main_q_valid
        | ~witness_slope_valid
        | ~witness_q_valid
    )

    main_significant = main_directional & main_q_valid & (
        main_q_values < q_threshold
    )
    witness_significant = witness_directional & witness_q_valid & (
        witness_q_values < q_threshold
    )
    # A zero-slope witness has no direction; it cannot be classified as same/opposite.
    not_evaluated |= main_significant & ~witness_directional
    not_evaluated &= ~outside
    same_direction = np.sign(main_values) == np.sign(witness_values)

    codes = np.full(main_class.shape, contract.WITNESS_MAIN_NOT_SIGNIFICANT, dtype=np.int8)
    codes[not_evaluated] = contract.INSUFFICIENT_DATA
    codes[outside] = contract.OUTSIDE_DOMAIN

    active = ~not_evaluated & ~outside
    codes[active & ~main_significant] = contract.WITNESS_MAIN_NOT_SIGNIFICANT
    codes[active & main_significant & witness_significant & same_direction] = (
        contract.WITNESS_CORROBORATED
    )
    codes[active & main_significant & witness_significant & ~same_direction] = (
        contract.WITNESS_CONTRADICTED
    )
    codes[active & main_significant & ~witness_significant & same_direction] = (
        contract.WITNESS_SAME_SIGN
    )
    codes[active & main_significant & ~witness_significant & ~same_direction] = (
        contract.WITNESS_OPPOSITE_SIGN
    )
    return codes


def witness_std_change(
    witness_std_change_decade: ArrayLike,
    agreement: ArrayLike,
) -> np.ndarray:
    """Witness standardized change per decade; NaN where not evaluated/outside."""
    values = _grid(witness_std_change_decade, "witness_std_change_decade")
    codes = _grid(agreement, "witness_agreement")
    invalid = np.isin(
        codes, (contract.INSUFFICIENT_DATA, contract.OUTSIDE_DOMAIN)
    )
    result = np.asarray(values, dtype=np.float32).copy()
    result[invalid] = np.nan
    return result


def witness_layers(
    main: Mapping[str, np.ndarray],
    witness: Mapping[str, np.ndarray],
    mask: ArrayLike,
    q_threshold: float = contract.Q_THRESHOLD,
) -> dict[str, np.ndarray]:
    """Build both exported witness layers from P03/P13 trend layer mappings."""
    for name in MAIN_TREND_LAYER_NAMES:
        if name not in main:
            raise ValueError(f"main trend layers missing {name!r}")
    for name in TREND_LAYER_NAMES:
        if name not in witness:
            raise ValueError(f"witness trend layers missing {name!r}")

    agreement = witness_agreement(
        main["sen_slope"],
        main["q_value"],
        main["trend_class"],
        witness["sen_slope"],
        witness["q_value"],
        witness["trend_class"],
        mask=mask,
        q_threshold=q_threshold,
    )
    std_change = witness_std_change(witness["std_change_decade"], agreement)
    return {
        "witness_agreement": agreement.astype(np.int8),
        "witness_std_change": std_change.astype(np.float32),
    }


def read_trend_layers(path: str | Path) -> dict[str, np.ndarray]:
    """Read the four P03/P13 trend layers needed for the agreement."""
    with xr.open_dataset(path, engine="netcdf4") as ds:
        missing = [name for name in TREND_LAYER_NAMES if name not in ds]
        if missing:
            raise ValueError(f"{path}: missing trend layers {missing}")
        return {
            name: np.asarray(ds[name].values) for name in TREND_LAYER_NAMES
        }


def witness_screener_fields(
    trend_class: ArrayLike,
    agreement: ArrayLike,
    domain: ArrayLike,
) -> dict[str, float | None]:
    """Area-weighted corroborated/contradicted fractions of significant main area."""
    classes = _grid(trend_class, "trend_class")
    codes = _grid(agreement, "witness_agreement")
    area = _grid(domain, "domain").astype(bool)

    weights = np.cos(np.deg2rad(contract.row_to_lat(np.arange(contract.N_ROWS))))
    weights = np.repeat(weights[:, None], contract.N_COLS, axis=1)
    significant = area & np.isin(
        classes, (contract.TREND_DECREASE, contract.TREND_INCREASE)
    )
    corroborated = significant & (codes == contract.WITNESS_CORROBORATED)
    contradicted = significant & (codes == contract.WITNESS_CONTRADICTED)

    significant_area = float(weights[significant].sum())
    if significant_area <= 0:
        return {
            "witness_corroborated_fraction": None,
            "witness_contradicted_fraction": None,
        }
    return {
        "witness_corroborated_fraction": float(weights[corroborated].sum())
        / significant_area,
        "witness_contradicted_fraction": float(weights[contradicted].sum())
        / significant_area,
    }


def index_products(variable_ids: list[str]) -> dict[str, dict[str, str]]:
    """Build the index.witness.products block for the requested variables."""
    products: dict[str, dict[str, str]] = {}
    for variable_id in variable_ids:
        if variable_id not in contract.WITNESSES:
            raise KeyError(f"no witness is registered for variable {variable_id!r}")
        product, version, source_variable = contract.WITNESSES[variable_id]
        info = WITNESS_PRODUCT_INFO.get(product)
        if info is None:
            raise KeyError(f"no DOI/label metadata for witness product {product!r}")
        products[variable_id] = {
            "product": product,
            "version": version,
            "source_variable": source_variable,
            "doi": info["doi"],
            "label": info["label"],
        }
    return products
