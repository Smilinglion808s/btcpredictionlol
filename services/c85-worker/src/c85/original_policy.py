"""Unchanged source functions extracted from the recovered C85 dependencies."""

from __future__ import annotations

from collections import deque

import numpy as np

import pandas as pd

RANK_HISTORY=768

RANK_MINIMUM=96

MODELS=['EWMA16','EWMA64','EWMA_SIDE32','DUAL_SPEED','CUSUM_GLOBAL','CUSUM_SIDE']

SPANS=[16,32,64,128]

def day_balanced_weights(timestamps: pd.Series) -> np.ndarray:
    days = timestamps.dt.strftime("%Y-%m-%d")
    counts = days.value_counts()
    weights = days.map(1.0 / counts).to_numpy(float)
    return weights / weights.mean()

def directional_rank(
    value: np.ndarray, direction: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    ranks = np.full(len(value), np.nan)
    counts = np.zeros(len(value), dtype=np.int16)
    history = {1: deque(maxlen=RANK_HISTORY), -1: deque(maxlen=RANK_HISTORY)}
    for index, (current, side) in enumerate(zip(value, direction)):
        side = int(side)
        if side not in {-1, 1} or not np.isfinite(current):
            continue
        prior = np.asarray(history[side], dtype=float)
        counts[index] = len(prior)
        if len(prior) >= RANK_MINIMUM:
            ranks[index] = (
                np.sum(prior < current) + 0.5 * np.sum(prior == current)
            ) / len(prior)
        history[side].append(float(current))
    return ranks, counts

def asymmetric_prediction(
    rank: np.ndarray,
    proposal: np.ndarray,
    yes_threshold: float,
    no_threshold: float,
) -> np.ndarray:
    threshold = np.where(np.asarray(proposal) == 1, yes_threshold, no_threshold)
    return np.where(
        np.isfinite(rank)
        & np.isin(proposal, [-1, 1])
        & (rank >= threshold),
        proposal,
        0,
    ).astype(np.int8)

def confirmed_extension(
    frame: pd.DataFrame,
    core: np.ndarray,
    price_column: str,
    minimum_distance: float,
) -> tuple[np.ndarray, np.ndarray]:
    c54 = frame["c54_prediction"].to_numpy(np.int8)
    price = frame[price_column].to_numpy(float)
    market_side = np.where(np.isfinite(price), np.where(price >= 0.5, 1, -1), 0)
    extension = (
        (core == 0)
        & frame["market_q1"].to_numpy(bool)
        & np.isin(c54, [-1, 1])
        & (market_side == c54)
        & np.isfinite(price)
        & (np.abs(price - 0.5) >= minimum_distance)
    )
    prediction = np.where(extension, c54, core).astype(np.int8)
    return prediction, extension

def run(f, name):
    assert name in MODELS
    b = f.C71.to_numpy(int)
    y = f.label.to_numpy(int)
    decision = f.ts.astype('int64').to_numpy() + 5_000_000_000
    settle = f.settlement_ts.astype('int64').to_numpy()
    valid = f.source_valid.to_numpy(bool)
    called = np.flatnonzero(b)
    order = called[np.argsort(settle[called], kind='stable')]
    # Independent pooled / YES / NO states; all original called settlements.
    states = {key: {'count': 0, 'ewma': {n: .60 for n in SPANS},
                    'cusum': 0., 'alarm': False, 'last_ns': -1}
              for key in [0, -1, 1]}
    cursor = 0
    rows = []
    for i, t in enumerate(decision):
        while cursor < len(order) and settle[order[cursor]] < t:
            j = int(order[cursor])
            assert decision[j] < t
            w = int(b[j] == y[j])
            increment = np.log(.45 / .60) if w else np.log(.55 / .40)
            for key in [0, int(b[j])]:
                s = states[key]
                s['count'] += 1
                for n in SPANS:
                    a = 2 / (n + 1)
                    s['ewma'][n] = (1 - a) * s['ewma'][n] + a * w
                s['cusum'] = float(np.clip(s['cusum'] + increment, 0, np.log(20)))
                if s['cusum'] >= np.log(5):
                    s['alarm'] = True
                elif s['cusum'] <= np.log(2):
                    s['alarm'] = False
                s['last_ns'] = int(settle[j])
            cursor += 1
        side = int(b[i])
        key = side if name in ['EWMA_SIDE32', 'CUSUM_SIDE'] else 0
        s = states[key]
        count = s['count']
        if name in ['CUSUM_GLOBAL', 'CUSUM_SIDE']:
            minimum = 32
            keep = not s['alarm']
        elif name == 'DUAL_SPEED':
            minimum = 128
            keep = not (s['ewma'][16] < 1 / 1.8 and
                        s['ewma'][128] - s['ewma'][16] >= .08)
        else:
            n = {'EWMA16': 16, 'EWMA64': 64, 'EWMA_SIDE32': 32}[name]
            minimum = 2 * n
            keep = s['ewma'][n] >= 1 / 1.8
        warm = count < minimum
        pred = side if valid[i] and (keep or warm) else 0
        rows.append({'prediction': pred, 'settled_count': count,
                     'latest_available_ns': s['last_ns'],
                     **{'ewma' + str(n): s['ewma'][n] for n in SPANS},
                     'cusum': s['cusum'], 'cusum_alarm': s['alarm'],
                     'warmup_passthrough': bool(side and valid[i] and warm),
                     'risk_blocked': bool(side and valid[i] and not warm and not keep),
                     'source_valid': bool(valid[i])})
    result = pd.DataFrame(rows)
    assert ((result.prediction == 0) | (result.prediction == b)).all()
    assert (result.prediction[~valid] == 0).all()
    assert (result.latest_available_ns.to_numpy() < decision).all()
    return result

def rank_stream(values, side, valid):
    history = {-1: deque(maxlen=768), 1: deque(maxlen=768)}
    rank = np.full(len(values), np.nan)
    count = np.zeros(len(values), int)
    for i, (score, direction, ok) in enumerate(zip(values, side, valid)):
        if direction == 0 or not ok: continue
        h = history[int(direction)]
        count[i] = len(h)
        if np.isfinite(score):
            if len(h) >= 96:
                a = np.asarray(h)
                rank[i] = ((a < score).sum() + .5*(a == score).sum()) / len(h)
            h.append(float(score))
    return rank, count

state_run=run
