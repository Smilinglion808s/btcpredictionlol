Place the three frozen joblib bundles and continuous seed bars from the V2
package here. The package's Python module goes in `src/model_package/` and must
expose `predictor.load(artifact_dir)` returning an object with
`evaluate(checkpoint, open_ms, one_second, fifteen_minute) -> list[dict]`
(keys: sleeve, side, probability, eligible, features_ready, reason, inputs_hash,
model_hash). Missing artifacts => model_valid=false, heartbeats only.
