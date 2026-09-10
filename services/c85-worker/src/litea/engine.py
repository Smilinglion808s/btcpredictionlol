"""Portable Lite A feature-level inference. Standard library only; no network.

This is deliberately not a live market-data adapter or execution service.
Every output is hard-coded execution-disabled. Feature/receipt provenance is
the caller's responsibility and is not established by this numerical engine.
"""
from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from zoneinfo import ZoneInfo

UTC = timezone.utc
BOISE = ZoneInfo('America/Boise')
MODES = {'baseline', 'floor4', 'trail4'}


def instant(value):
    d = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if d.tzinfo is None:
        raise ValueError('Timezone-aware timestamps required')
    return d.astimezone(UTC)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


class Head:
    def __init__(self, payload):
        self.payload = json.loads(canonical(payload))
        self.id = digest(payload)
        self.fields = payload['feature_order']
        if len(self.fields) != 60 or len(set(self.fields)) != 60:
            raise ValueError('Lite A requires the complete 60-column schema')
        self.start = instant(payload['fit_cutoff'])
        self.end = instant(payload['valid_until_exclusive'])
        if self.end <= self.start or self.end > self.start + timedelta(days=1):
            raise ValueError('A head cannot silently outlive its next daily fit')
        for key in ['train_end', 'max_train_settlement']:
            if instant(payload[key]) >= self.start:
                raise ValueError('Training inputs or labels exceed fit cutoff')
        for key in ['imputation', 'center', 'scale', 'coefficient']:
            a = payload[key]
            if len(a) != 60 or not all(math.isfinite(float(x)) for x in a):
                raise ValueError('Invalid fitted parameter array: ' + key)
        if any(x <= 0 for x in payload['scale']) or not math.isfinite(payload['intercept']):
            raise ValueError('Invalid fitted scale/intercept')

    @classmethod
    def load(cls, path, expected_sha256):
        data = Path(path).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_sha256:
            raise ValueError('Head checksum mismatch')
        return cls(json.loads(data))

    def predict(self, features, target):
        if not self.start <= instant(target) < self.end:
            raise ValueError('FIT_NOT_APPLICABLE')
        if set(features) != set(self.fields):
            raise ValueError('Feature schema must match exactly')
        b = self.payload
        terms = []
        for j, key in enumerate(self.fields):
            value = features[key]
            value = float(value) if value is not None else math.nan
            if not math.isfinite(value):
                value = b['imputation'][j]
            terms.append(((value - b['center'][j]) / b['scale'][j]) * b['coefficient'][j])
        z = math.fsum(terms) + b['intercept']
        return 1 / (1 + math.exp(-z)) if z >= 0 else math.exp(z) / (1 + math.exp(z))


class LiteA:
    """One head, two confidence queues, optional settled-outcome admission gate.

    Call settlements and decisions in observed-time order. A restored checkpoint
    contains rank and risk state plus the last immutable decision, not raw feed
    buffers or training rows. Old targets require the caller's durable ledger.
    """
    def __init__(self, mode='baseline'):
        if mode not in MODES:
            raise ValueError('Unknown policy')
        self.mode = mode
        self.history = {-1: deque(maxlen=768), 1: deque(maxlen=768)}
        self.days = {}
        self.pending = {}
        self.clock = None
        self.last_target = None
        self.last_fingerprint = None
        self.last_output = None
        self.last_head_id = None

    def _advance(self, observed_at):
        now = instant(observed_at)
        if self.clock is not None and now < instant(self.clock):
            raise ValueError('Observed-time events are out of order')
        self.clock = now.isoformat()
        return now

    def settle(self, ticker, label, *, available_at, observed_at):
        available, now = instant(available_at), instant(observed_at)
        if label not in (-1, 1) or available > now:
            raise ValueError('Invalid label or future settlement')
        call = self.pending.get(ticker)
        if call and available <= instant(call['decision_at']):
            raise ValueError('Settlement cannot predate its call')
        self._advance(now)
        call = self.pending.pop(ticker, None)
        if call is None:
            return False  # Uncalled/already consumed: never credits profit twice.
        d = self.days[call['day']]
        d['pending'] -= 1
        d['pnl_hundredths'] += 87 if label == call['direction'] else -100
        d['peak_hundredths'] = max(d['peak_hundredths'], d['pnl_hundredths'])
        if d['pending'] < 0:
            raise AssertionError('Negative pending count')
        return True

    def decide(self, *, target, ticker, features, input_valid, head, observed_at):
        target, now = instant(target), instant(observed_at)
        if now < target + timedelta(seconds=5):
            raise ValueError('Full T+5 window has not ended')
        # A retry returns the original output. A revised feature/head payload
        # must not mutate an already made decision, even after a restart.
        normalized = {k: (float(v) if v is not None and math.isfinite(float(v)) else None)
                      for k, v in features.items()}
        fingerprint = digest({'target':target.isoformat(), 'ticker':ticker,
            'features':normalized, 'input_valid':bool(input_valid), 'head':head.id if head else None})
        if self.last_target == target.isoformat():
            if fingerprint != self.last_fingerprint:
                raise ValueError('Changed duplicate decision')
            return json.loads(canonical(self.last_output))
        if self.last_target and target <= instant(self.last_target):
            raise ValueError('Target sequence must increase')
        if ticker in self.pending:
            raise ValueError('Duplicate pending ticker')
        # Validate the numerical operation before touching any runtime state.
        p = head.predict(normalized, target) if input_valid and head else None
        self._advance(now)
        day = target.astimezone(BOISE).date().isoformat()
        self.days = {k:v for k,v in self.days.items() if k == day or v['pending']}
        rank = None; count = 0; direction = 0; candidate = 0; prediction = 0
        risk_before = None
        if not input_valid:
            reason = 'INPUT_UNAVAILABLE'
        elif p is None:
            reason = 'FIT_UNAVAILABLE'
        else:
            direction = 1 if p >= .5 else -1
            score = abs(p - .5)
            queue = self.history[direction]
            count = len(queue)
            if count >= 96:
                rank = (sum(v < score for v in queue) + .5*sum(v == score for v in queue)) / count
            queue.append(score)  # ALL valid scores, even risk-gated/non-called.
            candidate = direction if rank is not None and rank >= .638 else 0
            reason = 'RANK_WARMUP' if rank is None else 'CONFIDENCE_ABSTAIN'
            if candidate:
                allowed = True
                if self.mode != 'baseline':
                    d = self.days.setdefault(day, {'pnl_hundredths':0, 'peak_hundredths':0, 'pending':0})
                    anchor = d['peak_hundredths'] if self.mode == 'trail4' else 0
                    available = d['pnl_hundredths'] - d['pending']*100 - anchor + 400
                    risk_before = {**d, 'budget_remaining_hundredths':available}
                    allowed = available >= 100
                    if allowed:
                        d['pending'] += 1
                        self.pending[ticker] = {'day':day, 'direction':direction,
                                                'decision_at':now.isoformat()}
                if allowed:
                    prediction = candidate
                    reason = 'MODEL_CALL'
                else:
                    reason = 'DAILY_RISK_ABSTAIN'
        output = {'model_id':'lite-a-' + self.mode + '-r1', 'target':target.isoformat(),
            'ticker':ticker, 'feature_window_end':(target+timedelta(seconds=5)).isoformat(),
            'observed_at':now.isoformat(), 'head_id':head.id if head else None,
            'p_yes':p, 'direction':direction, 'rank':rank, 'rank_count':count,
            'candidate':candidate, 'prediction':prediction, 'reason':reason,
            'risk_before':risk_before, 'execution_enabled':False,
            'evidence':'FEATURE_LEVEL_ONLY_RECEIPT_PROVENANCE_NOT_VERIFIED'}
        self.last_target = target.isoformat()
        self.last_fingerprint = fingerprint
        self.last_output = output
        self.last_head_id = head.id if head else None
        return json.loads(canonical(output))

    def snapshot(self):
        state = {'schema':1, 'mode':self.mode, 'history':{str(k):list(v) for k,v in self.history.items()},
            'days':self.days, 'pending':self.pending, 'clock':self.clock,
            'last_target':self.last_target, 'last_fingerprint':self.last_fingerprint,
            'last_output':self.last_output, 'last_head_id':self.last_head_id}
        return {'sha256':digest(state), 'state':json.loads(canonical(state))}

    @classmethod
    def restore(cls, envelope):
        s = envelope['state']
        if envelope['sha256'] != digest(s) or s['schema'] != 1:
            raise ValueError('Invalid checkpoint checksum or schema')
        e = cls(s['mode'])
        e.history = {int(k):deque(v,maxlen=768) for k,v in s['history'].items()}
        if set(e.history) != {-1, 1} or any(len(v)>768 for v in s['history'].values()):
            raise ValueError('Invalid history')
        for queue in e.history.values():
            if not all(math.isfinite(v) and 0<=v<=.5 for v in queue):
                raise ValueError('Invalid confidence history')
        for k in ['days','pending','clock','last_target','last_fingerprint','last_output','last_head_id']:
            setattr(e, k, json.loads(canonical(s[k])))
        for day, d in e.days.items():
            if d['pending'] != sum(v['day']==day for v in e.pending.values()):
                raise ValueError('Checkpoint pending count mismatch')
        return e

    def save_checkpoint(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent,prefix=path.name+'.',delete=False) as f:
            temporary = f.name
            f.write(canonical(self.snapshot()))
            f.flush(); os.fsync(f.fileno())
        os.replace(temporary,path)


def wrap_historical_head(original):
    """Preserve all fitted values; explicitly expire at the next UTC midnight."""
    b = dict(original)
    start = instant(b['fit_cutoff'])
    b['valid_until_exclusive'] = (start.replace(hour=0,minute=0,second=0,microsecond=0)
                                  + timedelta(days=1)).isoformat()
    b['model_family'] = 'lite-a-r1'
    b['release_status'] = 'HISTORICAL_EXPIRED_NOT_A_CURRENT_DEPLOYMENT'
    return b
