# Keep Version 1.1 tile current

## Changes
- Refresh Version 1.1 stats every 10 seconds, including while the tab is in the background.
- Refresh immediately when the stats page opens, regains focus, or reconnects.
- Reduce the matching server cache window so polling cannot repeatedly return an older tile snapshot.
- Leave all model logic, webhook controls, endpoints, and delivery behavior unchanged.

## Verification
- Run the focused checks and confirm the app builds cleanly.
- Open the stats page and verify the Version 1.1 tile continues rendering with refreshed data.
