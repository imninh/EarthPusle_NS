"""Core pattern classes from significant temperature and moisture trends.

Implements contract section 7 (docs/DATA_CONTRACT.md): the pattern layer is
``int8`` with codes

===== ==========================================
  1   warming + drying
  2   warming + wetting
  3   cooling + drying
  4   cooling + wetting
  0   mixed / inconclusive
 -9   insufficient data
-99   outside domain
===== ==========================================

Only *significant* trends (contract trend classes ``1`` and ``-1``) create a
pattern. A temperature increase combined with a moisture decrease is
"warming + drying", and so on. If either input is ``-99`` the output is
``-99``; otherwise if either input is ``-9`` the output is ``-9``. ``-99``
therefore wins over ``-9``.
"""

from __future__ import annotations

import numpy as np

from earthpulse import contract as contract

__all__ = ["pattern_class"]

_VALID_CODES = (
    contract.TREND_INCREASE,
    contract.TREND_DECREASE,
    contract.TREND_NOT_SIGNIFICANT,
    contract.INSUFFICIENT_DATA,
    contract.OUTSIDE_DOMAIN,
)


def pattern_class(
    temp_class: np.ndarray,
    moist_class: np.ndarray,
) -> np.ndarray:
    """Combine trend classes into the contract pattern-class layer.

    Both inputs must have the same shape and contain only contract trend
    classes: ``1``, ``-1``, ``0``, ``-9`` or ``-99``. The result is a new
    ``int8`` array of the same shape.
    """

    temperature = np.asarray(temp_class)
    moisture = np.asarray(moist_class)

    if temperature.shape != moisture.shape:
        raise ValueError(
            "temp_class and moist_class must have the same shape, got "
            f"{temperature.shape} and {moisture.shape}"
        )

    invalid = ~(
        np.isin(temperature, _VALID_CODES) & np.isin(moisture, _VALID_CODES)
    )
    if np.any(invalid):
        bad = sorted(
            {
                str(value)
                for value in np.concatenate(
                    (temperature[invalid], moisture[invalid])
                ).ravel().tolist()
            }
        )
        raise ValueError(
            "pattern classes must be one of "
            f"{list(_VALID_CODES)}; found {bad}"
        )

    outside = (temperature == contract.OUTSIDE_DOMAIN) | (
        moisture == contract.OUTSIDE_DOMAIN
    )
    insufficient = (temperature == contract.INSUFFICIENT_DATA) | (
        moisture == contract.INSUFFICIENT_DATA
    )

    warming = temperature == contract.TREND_INCREASE
    cooling = temperature == contract.TREND_DECREASE
    wetting = moisture == contract.TREND_INCREASE
    drying = moisture == contract.TREND_DECREASE

    result = np.full(temperature.shape, contract.PATTERN_MIXED, dtype=np.int8)
    result[warming & drying] = contract.PATTERN_WARMING_DRYING
    result[warming & wetting] = contract.PATTERN_WARMING_WETTING
    result[cooling & drying] = contract.PATTERN_COOLING_DRYING
    result[cooling & wetting] = contract.PATTERN_COOLING_WETTING

    # Missing-data codes overrule any computed pattern; -99 wins over -9.
    result[insufficient] = contract.INSUFFICIENT_DATA
    result[outside] = contract.OUTSIDE_DOMAIN
    return result
