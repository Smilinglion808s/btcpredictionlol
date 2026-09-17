"""Original U's decision-time selection. No outcomes, arrival data or orders used here."""
from dataclasses import dataclass, asdict
from math import isfinite

CHECKPOINTS=(120,180,300,480,600,720)
def fee_unit(p):return .07*p*(1-p)
def finite(v):
    try:return isfinite(float(v))
    except (ValueError,TypeError):return False

@dataclass(frozen=True)
class Candidate:
    source:str
    side:int
    known_ask:float
    probability:float
    limit_all_in:float
    edge:float
    def payload(self):return asdict(self)

def candidate(row,source):
    seconds=(480,600,720) if source=='L' else CHECKPOINTS
    if row.get('second') not in seconds or not row.get('feature_valid') or not row.get('quote_valid'):return None
    spread=row.get('spread');py=row.get('p_V12' if source=='L' else 'p_V12_REPRICING')
    if not finite(spread) or spread<0 or spread>.04+1e-9 or not finite(py):return None
    selected=[]
    for side in (1,-1):
        known=row.get('yes_ask' if side==1 else 'no_ask')
        if not finite(known):continue
        prob=py if side==1 else 1-py
        cost=known+.01+fee_unit(known+.01)
        def probability(key):
            value=row.get(key,float('nan'))
            return value if side==1 else 1-value
        if source=='L':
            if side!=(1 if row['market_p']>=.5 else -1) or not .65-1e-9<=known<=.95+1e-9:continue
            a,b=probability('p_LINEAR'),probability('p_NONLINEAR')
            if not finite(a) or not finite(b) or prob-cost<.02-1e-12 or min(a,b)<=cost:continue
            limit=min(prob-.02,a,b)
        else:
            if not .2-1e-9<=known<=.95+1e-9:continue
            a,b=probability('p_PHYSICAL'),probability('p_QUOTE')
            if not finite(a) or not finite(b):continue
            limit=min(prob-.03,a-.01,b-.01)
            if cost>limit+1e-12:continue
        selected.append(Candidate(source,side,float(known),float(prob),float(limit),float(prob-cost)))
    return max(selected,key=lambda c:(c.edge,c.side)) if selected else None

def choose(l_row,r_row):
    # The source is selected BEFORE looking at an arrival quote. No fallback
    # from L to R at the same checkpoint after a failed price check.
    return (candidate(l_row,'L') if l_row is not None else None) or (candidate(r_row,'R') if r_row is not None else None)

def arrival_admissible(c,ask,valid):
    if c is None or valid is not True or not finite(ask):return False
    price=max(c.known_ask,ask)+.01
    return price<1 and price+fee_unit(price)<=c.limit_all_in+1e-12
