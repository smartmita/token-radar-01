# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/smartmita/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/smartmita/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Empirical pre-token launch valuation radar and costed farming planner built for DefiLlama snapshot data using Huber IRLS regression (`MCAP ~ TVL^0.47`) with blind LOO & walk-forward feature ablation (keeping multi-chain, 7d flow, and age; dropping overfitting category fixed effects), tier-calibrated P25–P75 intervals, logistic peer token prevalence (AUC 0.775), and `$/hr`- & min-capital-costed farm plans.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=mn4m0zhh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
