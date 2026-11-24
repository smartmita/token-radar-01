# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/smartmita/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/smartmita/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Empirical pre-token launch radar ranking 188 clean pre-token protocols (`40` Watchlist + `18` Off-List `>=$50M` + `130` Early `<$50M`) by **Expected Launch Value** (`Cond. FDV × 12M Launch Odds`), featuring `VALUELADDER()` Huber IRLS regression (`MCAP ~ TVL^0.46 + Chains`) with strict LOO & walk-forward ablation, tier-calibrated `P25–P75` / `P10–P90` OOF bands, `LAUNCHODDS()` 10-fold & walk-forward survival hazard (`0.745` AUC, `0.204` Brier), `LEDGERCHECK()` full 758-protocol accounting, and realistic `FARMPLAN()` economics (`44/188` `+EV`).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=mn4m0zhh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
