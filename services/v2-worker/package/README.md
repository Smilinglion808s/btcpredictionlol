# V2 Final R1 — integration package

This small package contains the finalized **Direction8 → Fade8 → Direction45** policy, Python decision code and three fitted bundles. Use it with the existing collector and durable sender. Read `PORTING.md` for the complete input, state and serializer contract.

- Two checkpoints: T+8 and T+45 on each 15-minute candle.
- One decision intent per candle; Direction8 has priority over Fade8.
- Same Binance spot BTCUSDT price, volume and trade-flow inputs as the lab.
- Directional models use 25 features; Fade8 uses 33 derived features with ten technical factors.
- No order-book, funding, open-interest or altcoin feed.
- Persistent `DecisionStore` is required to enforce routing across checkpoints and restarts.
- No HTTP sender, quote adapter, order placement or enabled execution switch is included.

Tested with Python 3.12.14. Install the pinned dependencies from `requirements.txt` in the target environment, then use the example in `PORTING.md`. Map the internal event through the existing serializer and explicitly register the three new sleeve IDs. Deployed receiver compatibility has not been tested.

The bundles are valid from **14 September 2026 through 11 October 2026 UTC**, expiring at **12 October 2026 00:00 UTC**. `refit.py` writes a new bundle directory at each scheduled four-week boundary. It requires the prepared data and feature tables from the full research package, extended with new causal observations.

The finalized historical simulation starts with $50 and uses a fixed $2 risk per trade. At assumed effective odds 1.75 / 2.20 / 1.60 it ends at $3,598.10 over 104 weeks, with 96 profitable weeks and a 48.8% maximum percentage drawdown. Lowering only Fade8 to 2.00 causes a funding failure in week 4. Prices and fills are assumptions, and all 104 weeks have previously been researched.

The separate full research package contains the raw inputs, all historical bundles, backtest report, spreadsheet, ledgers and `verify_package.py`. That offline verification rebuilds every feature and reproduces all 69,888 decisions. This smaller ZIP intentionally contains only the port and refit components.
