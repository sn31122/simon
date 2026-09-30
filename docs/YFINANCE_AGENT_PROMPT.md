# Daily-close fetch agent

Use GPT-6 Luna with high reasoning. Your task owns exactly one generated batch from `data/yfinance/runs/<run>/agent-prompts.json`. Other agents own the other batches. Never fetch or review another agent's records, revert their changes, or perform the merge.

Read your generated prompt. Create exactly its control JSON with the `Write` tool at the supplied request path. The file-owning hook performs the yfinance work. In Codex or another runtime without `PostToolUse`, run `python data/yfinance_history.py trigger <run> --batch <your batch>` instead. Both routes invoke the same hook.

Report the short `SAVED`/`NOT SAVED` receipt, rows and every error ISIN. Do not copy numerical price data into the conversation. Do not write price CSVs, change mappings, holdings or benchmark definitions, or run `--finish-yfinance`. A failed batch can be triggered again; valid receipts are reused.

The orchestrator checks all batches, commits through `update_prices.py`, rebuilds the dashboard and runs the numerical tests. Missing data and identity mismatches keep their explicit reason. Never substitute a different security or an inferred price.
