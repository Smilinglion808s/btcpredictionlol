"""Integer-only accounting; all rounding is conservative to the paper account."""
from decimal import Decimal, InvalidOperation
SAT = 100_000_000
MICRO = 1_000_000
BPS = 10_000

def scaled(value, scale):
    if isinstance(value, (float, bool)):
        raise ValueError('Use decimal strings, never floats')
    try: d = Decimal(str(value)) * scale
    except (InvalidOperation, ValueError): raise ValueError('Invalid decimal')
    if not d.is_finite() or d < 0 or d != d.to_integral_value() or d > 10**18:
        raise ValueError('Invalid or overprecise decimal')
    return int(d)

def price(value): return scaled(value, MICRO)
def quantity(value): return scaled(value, SAT)
def ceildiv(n, d): return -(-n // d)
def cost(p, q): return ceildiv(p * q, SAT)
def proceeds(p, q): return p * q // SAT

def execution_price(bid, ask, side, opening, slippage_bps):
    buy = (side == 'LONG') == opening
    slip = int(Decimal(str(slippage_bps)) * 10)
    return ceildiv(ask * (100_000 + slip), 100_000) if buy else bid * (100_000 - slip) // 100_000

def fee(p, q, bps): return ceildiv(cost(p, q) * bps, BPS)

def gross_pnl(entry, exit, q, side):
    # Floor signed P&L: no favorable rounding of small losses.
    return proceeds(exit,q)-cost(entry,q) if side == 'LONG' else proceeds(entry,q)-cost(exit,q)

def carry(entry, q, elapsed_ms, bps_per_day):
    return ceildiv(cost(entry, q) * bps_per_day * max(0, elapsed_ms), BPS * 86_400_000)
