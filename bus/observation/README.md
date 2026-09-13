# PALURU Bus Observation Job

P1研究用のbounded Cloud Run Job。Realtime Bus API / PWAとは別image・別entrypointで動作する。

- 既定10回、32秒間隔、最大330秒
- 1 sampleにつきODPT feed取得1回
- Raw API response、生vehicle ID、Secretを保存しない
- `observation_id`によるretry duplicate抑止
- Position UIとPublic実発車予測は変更しない

必要なruntime設定、Sheets setup、Cloud Build、Job作成、Scheduler案は`docs/PALURU_BUS_P1_OBSERVATION_PLATFORM.md`を参照する。
