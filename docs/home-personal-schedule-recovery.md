# Home personal schedule visibility

Comparison with the parent of PR #154 showed that the original `todayParuru` DOM, Home initialization, Calendar request and member settings were retained. The family schedule list was the only Home section removed by that PR. The pre-existing renderer hid the entire original card after a successful zero-item response, making a healthy empty result indistinguishable from a missing feature.

Keep that original card in its original position and show an explicit empty message. Preserve member selection, include-unknown selection, the configured tomorrow switch time, ended-event filtering, ownership and existing Calendar write behavior. Family Schedule remains independent and is not inserted into Home.

The original aggregate can catch a shared Calendar read failure and then pass empty arrays to both day mappers. Those mappers do not throw, so the shared warning could be lost. Retain this existing warning at the aggregate boundary. The Home card distinguishes loading, loaded-empty, loaded-with-items, loaded-partial, loaded-stale and error; Calendar's state is exposed separately as loading/empty/loaded/unavailable/stale. A bounded read ends in the existing retry UI instead of indefinite loading. This does not add a source, credential or API operation, or change the existing schema.

Tests cover healthy zero remaining visible, Calendar failure not becoming an empty result, prior data marked stale, today/tomorrow grouping, authentication initialization and unchanged family-page behavior. Production acceptance additionally requires the deployed Home card, real Calendar data through the existing selection controls, restoration of the original selection, both 360px and 390px layouts, and the independent family page.
