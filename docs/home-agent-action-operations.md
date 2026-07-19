# Home Agent操作保護 運用手順

## 1. 目的と適用範囲

この文書は、PALURU Mini旧Home Agentの次の操作を安全に有効化・停止・復旧するための運用手順です。

- `pauseRoomAutomation`
- `resumeRoomAutomation`

温湿度、学校、給食、予定などのread-only `homeAgent`は対象外です。実エアコンの温度、mode、風量変更は未接続であり、この手順を実施しても有効になりません。

アーキテクチャと設計判断は[Home Agent Climate Slice](home-agent-climate-slice.md)を参照してください。Property名の一覧はREADMEを入口とし、この文書には値を記録しません。

## 2. 運用上の前提

- PALURU Mini Web Appは匿名HTTP到達可能な構成です。
- pairing tokenは端末に配布するbearer credentialであり、利用者本人を証明するものではありません。
- `confirmationId`は操作内容を保護しますが、呼び出し元認証の代わりにはなりません。
- kill switchが未設定、`true`以外、または必要な設定が不足している場合、操作はfail closedで拒否されます。
- read-only確認と操作確認を分け、操作試験時以外はkill switchをOFFにします。
- Secret、token、hash、URL、実機IDをチケット、README、Git、チャット、画面キャプチャ、ログへ記録しません。

## 3. デプロイ・有効化手順

### 3.1 事前準備

1. 現在のPWA Build、Mini GASの公開version、既存Web Appが正しいプロジェクトであることを確認します。
2. kill switchをOFFにします。未設定もOFF扱いですが、作業中の状態を明確にするため明示的なOFFを推奨します。
3. 対象端末のPWA生成`deviceId`を、値を公開場所へ転記せず安全な運用台帳で確認します。
4. 対象とする論理roomIdを確認します。SwitchBot等の実機IDはallowlistへ使用しません。
5. pairing tokenとhashを安全なローカル手段で準備します。生tokenをサーバー設定へ保存しません。

### 3.2 反映順序

1. **kill switch OFFを再確認する。**
2. PALURU Mini GASのソースを更新する。
3. GASエディタで対象ソースの反映を確認する。
4. 所有者が既存Web App deploymentを新versionへ更新する。新規deploymentは作成しない。
5. read-only `homeAgent`が旧PWAから引き続き成功することを確認する。
6. PALURU Mini PWAを既存の公開先へ反映する。
7. PWAのBuild、`app.js`、Service Workerが新しい版へ更新されたことを確認する。
8. 対象端末のPWA設定画面へ、その端末専用pairing tokenを入力する。
9. 対象`deviceId`に対応するtoken hashをサーバー設定へ登録する。
10. 論理roomIdのallowlistを登録する。
11. kill switch OFFのままread-only回帰、認証拒否、room拒否を確認する。

GASを先に更新するのは、旧PWAが従来のcandidate／`confirmed=true`形式を送っても新GASが操作をfail closedで拒否するためです。反対方向の混在が起きても契約不一致は操作失敗側へ倒れ、read-only経路には影響しないことを確認します。

### 3.3 一時的な操作受入試験

1. 監視可能な時間帯であることを確認します。
2. 現在の自動制御状態とactive pauseの有無を確認します。
3. kill switchを一時的にONにします。
4. allowlist済みの1部屋だけでpause候補を作成します。
5. 確認画面の内容、5分以内の実行、結果表示を確認します。
6. 同じ確認を再送し、上流操作が二重実行されず同じ結果が返ることを確認します。
7. active pauseが1件だけで、期限と対象部屋が意図どおりであることを確認します。
8. 同じpauseを対象にresume候補を作成して実行します。
9. active pauseが解除され、通常制御状態へ戻ったことを確認します。
10. 状態競合、期限切れ、改ざん確認を安全なモックまたは非実行経路で確認します。
11. 試験中に問題があれば直ちにkill switchをOFFにし、ロールバック手順へ進みます。

### 3.4 正式ONの判定

次の条件をすべて満たした場合だけ正式ONにします。

- 本番受入チェックリストがすべて完了している。
- read-only Home Agentに回帰がない。
- pairingされていない端末が拒否される。
- allowlist外roomが拒否される。
- pause／resumeが同一対象を一回だけ変更する。
- 実行後の状態再取得と画面表示が一致する。
- Secret、token、confirmation、操作本文がログや公開レスポンスへ漏れていない。
- ロールバック担当者と手順が共有されている。

## 4. ロールバック手順

### 4.1 緊急停止

1. **最優先でkill switchをOFFにする。** コードやPWAの切戻しより先に実施します。
2. 新しい操作候補が発行・実行されないことを確認します。
3. read-only Home Agentが利用できることを確認します。
4. 問題発生時刻、対象の論理room、操作種別、公開versionだけを記録します。token、confirmationId、URL、実機ID、本文は記録しません。

### 4.2 PWA／GAS切戻し

1. 影響範囲を確認し、PWAのみ、Mini GASのみ、または両方を既知の安定版へ戻します。
2. Mini GASは既存Web App deploymentを更新し、新規deploymentを作りません。
3. PWAは既存公開先を利用し、Service WorkerとBuildが切戻し版へ揃ったことを確認します。
4. Propertiesは不用意に削除しません。特にdevice hash、allowlist、期限付きidempotency状態を一括削除すると、原因調査や安全な再送判定を失う可能性があります。
5. Property修正が必要な場合もkill switchをOFFにしたまま、対象キーだけを変更します。

### 4.3 実行済みpauseの確認

コードを切り戻しても、すでに保存されたpause状態は自動で消えません。

1. Source of Truthで対象roomのactive pauseを確認します。
2. pauseが意図どおりで安全なら、期限切れまで維持するか運用判断します。
3. 解除が必要なら、既存の承認済み安全経路または所有者による管理手順でresumeします。
4. 別のpauseへ変わっている場合、古いconfirmationで解除しません。
5. active pauseがないこと、または許容した期限・対象であることを確認します。

### 4.4 復旧判定

次をすべて満たすまでkill switchをONへ戻しません。

- 原因と影響範囲が特定されている。
- 安定版PWA／GASの組合せが確認されている。
- active pauseの状態が把握されている。
- read-only回帰が通っている。
- pairing、allowlist、confirmation、idempotencyの拒否試験が通っている。
- pause／resumeを再試験する監視体制がある。
- ログ・レスポンスに機密情報がない。

## 5. Pairing token運用

### 5.1 token要件

- 暗号学的に安全な乱数生成器で作る。
- 32文字以上とする。
- 端末ごとに異なる値を使用する。
- 人名、誕生日、端末名、連番、既存パスワードを使用しない。
- 生tokenは対象PWAの`localStorage`だけに保存する。
- サーバーにはSHA-256 lowercase hexのhashだけを保存する。
- 生tokenをログ、README例、Git、チャット、Issue、スクリーンショットへ残さない。

### 5.2 deviceId規則

PWAが生成するUUIDを認証対応表のキーとして使用します。

- deviceIdを人名や実機IDへ変更しない。
- 1つのPWAインストールにつき1つとする。
- 複数端末でコピー・共有しない。
- PWAデータ消去や再インストールでdeviceIdが変わった場合は新規端末として登録する。
- 運用台帳で人が読むラベルを付ける場合は`household-role-platform-seq`形式とし、deviceIdそのものとは分離する。
- 運用台帳にも生tokenは記録しない。

### 5.3 新規登録

1. kill switchをOFFにする。
2. 対象端末のdeviceIdを確認する。
3. その端末専用tokenを生成する。
4. 生tokenをPWA設定画面へ入力する。
5. ローカルでSHA-256 hashを計算する。
6. deviceIdとhashの対応だけをサーバー設定へ追加する。
7. kill switch OFFのまま未認証端末の拒否を確認する。
8. 受入試験の時間だけONにして対象端末を確認する。

### 5.4 rotation

1. kill switchをOFFにする。
2. 新しいtokenを生成する。
3. 対象PWAへ新tokenを保存する。
4. サーバー側の該当deviceIdのhashを新hashへ置換する。
5. 古いtokenで拒否、新tokenで受入可能であることを確認する。
6. 受入チェック後にkill switchをONへ戻す。

古いhashと新しいhashを長期間併存させません。

### 5.5 端末紛失

1. 直ちにkill switchをOFFにする。
2. 紛失端末のdeviceIdに対応するhashを削除する。
3. 他端末とtokenを共有していた場合は、影響する全端末をrotationする。
4. active pauseと直近の操作結果を確認する。
5. 拒否試験後、必要な端末だけ再度有効化する。

### 5.6 端末廃止

1. kill switchをOFFにする。
2. サーバー側の該当deviceId hashを削除する。
3. 可能なら端末側PWAデータを消去する。
4. 運用台帳を廃止状態へ更新する。
5. active pauseが残っていないことを確認してから通常運用へ戻す。

## 6. 本番受入チェックリスト

### Read-only回帰

- [ ] 温湿度などのread-only `homeAgent`が成功する
- [ ] 学校、給食、天気、出発前チェックの既存経路が維持される
- [ ] kill switch OFFでもread-only応答が変わらない

### 呼び出し元・入力拒否

- [ ] pairing tokenなしを拒否する
- [ ] 不一致tokenを拒否する
- [ ] 未登録deviceIdを拒否する
- [ ] allowlist外roomを拒否する
- [ ] pause／resume以外の操作を拒否する
- [ ] 未接続`setAirconOverride`を拒否する

### Confirmation・冪等性

- [ ] confirmationIdなしを拒否する
- [ ] confirmationId改ざんを拒否する
- [ ] clientRequestId不一致を拒否する
- [ ] 5分を過ぎたconfirmationを拒否する
- [ ] PWAからroom、duration、skillを差し替えられない
- [ ] 同じconfirmation再送で上流操作が増えない
- [ ] 同じclientRequestId再送で新しいpause行が増えない
- [ ] 異なる操作内容で同じclientRequestIdを使うと拒否する

### Pause／resume

- [ ] pauseは最大8時間を超えない
- [ ] pause後のactive状態と表示が一致する
- [ ] resumeはconfirmationへ結び付いたpauseだけを対象とする
- [ ] resume後にactive pauseが解除されている
- [ ] proposal後にpause対象が変化した場合は実行を拒否する
- [ ] 実行失敗時に成功表示しない

### 情報漏えい

- [ ] PWA公開assetへ固定Secretやtokenがない
- [ ] ログへpairing token、共有Secret、confirmationId、操作本文がない
- [ ] 公開レスポンスへtoken、hash、内部URL、実機IDがない
- [ ] 内部idempotency状態へtoken、共有Secret、メッセージ本文がない

### 運用

- [ ] 緊急時にkill switchをOFFにできる担当者がいる
- [ ] ロールバック対象versionが特定できる
- [ ] active pauseの確認・解除手順を担当者が理解している
- [ ] 受入完了記録に秘密情報を含めていない

## 7. 既知リスクと将来課題

### 既知リスク

- pairing tokenは端末のbearer credentialであり、利用者本人の認証ではありません。
- 同一originにXSSがあると、`localStorage`のtokenを窃取される可能性があります。
- 端末共有、端末乗っ取り、ブラウザプロファイル複製を防げません。
- Web Appは匿名到達可能であり、不正リクエスト自体の到達は防げません。
- actor、userId、deviceIdは権限主体ではなく、pairing済み端末からのcontextです。
- confirmationは操作内容と再送を保護しますが、pairing tokenを盗まれた端末の本人性は保証しません。

### 将来課題

- Google IdentityのID token検証
- Firebase Authによる利用者・端末管理
- 専用GatewayでのJWT検証、rate limit、IP／端末リスク判定
- HttpOnly cookieを利用できる同一origin構成
- 端末失効一覧と管理画面
- 操作監査ログの機密情報を含まない標準Schema
- 操作権限の利用者・room・時間帯別Policy

本人認証を導入する場合も、kill switch、room allowlist、confirmation、idempotency、実行直前状態再検証は防御層として維持します。
