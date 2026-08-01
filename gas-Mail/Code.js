function runMailTriageDryRun() {
  const settings = getMailDryRunSettings_();
  const readResult = readMailMetadataForDryRun_(settings);
  const result = createMailDryRunResult_(settings, readResult);

  mailBatches_(readResult.messages, settings.batchSize).forEach(function(batch) {
    batch.forEach(function(metadata) {
      try {
        const classification = classifyMailMetadata_(mailRuleInput_(metadata));
        addMailClassificationToDryRunResult_(result, metadata, classification, settings.diagnostic);
      } catch (_) {
        addMailDryRunError_(result, 'CLASSIFICATION_FAILED');
      }
    });
  });

  result.errors.reasonCounts.READ_FAILED = readResult.readErrorCount;
  result.errors.count += readResult.readErrorCount;
  logMailDryRunSummary_(result);
  return result;
}

function createMailDryRunResult_(settings, readResult) {
  const categories = {};
  MAIL_ALLOWED_CLASSIFICATION_VALUES.category.forEach(function(category) { categories[category] = 0; });
  return {
    mode: 'dry_run',
    searchedAt: mailNowIso_(),
    search: {
      lookbackHours: settings.lookbackHours,
      searchLimit: settings.searchLimit,
      batchSize: settings.batchSize,
    },
    hasMoreLikely: readResult.hasMoreLikely,
    counts: {
      fetched: readResult.messages.length,
      classified: 0,
      high: 0,
      medium: 0,
      low: 0,
      actionRequired: 0,
      archiveRecommended: 0,
      unknown: 0,
    },
    categories: categories,
    diagnostics: [],
    errors: { count: 0, reasonCounts: { READ_FAILED: 0, CLASSIFICATION_FAILED: 0 } },
  };
}

function mailBatches_(items, batchSize) {
  const batches = [];
  for (let start = 0; start < items.length; start += batchSize) batches.push(items.slice(start, start + batchSize));
  return batches;
}

function mailRuleInput_(metadata) {
  return {
    from: metadata.from,
    senderDomain: metadata.senderDomain,
    subject: metadata.subject,
    snippet: metadata.snippet,
    hasAttachment: metadata.hasAttachment,
  };
}

function addMailClassificationToDryRunResult_(result, metadata, classification, diagnosticEnabled) {
  result.counts.classified += 1;
  result.counts[classification.importance] += 1;
  if (classification.actionRequired) result.counts.actionRequired += 1;
  if (classification.archiveRecommended) result.counts.archiveRecommended += 1;
  if (classification.category === MAIL_CATEGORY.unknown) result.counts.unknown += 1;
  result.categories[classification.category] += 1;
  if (diagnosticEnabled && result.diagnostics.length < MAIL_DRY_RUN_LIMITS.diagnosticMaxItems) {
    result.diagnostics.push({
      messageIdHash: mailMessageIdHash_(metadata.messageId),
      receivedAt: metadata.receivedAt,
      senderDomain: metadata.senderDomain,
      subjectPreview: mailSubjectPreview_(metadata.subject),
      classification: cloneMailClassification_(classification),
    });
  }
}

function addMailDryRunError_(result, reason) {
  result.errors.count += 1;
  result.errors.reasonCounts[reason] += 1;
}

function logMailDryRunSummary_(result) {
  if (typeof Logger === 'undefined' || typeof Logger.log !== 'function') return;
  Logger.log(JSON.stringify({
    mode: result.mode,
    searchedAt: result.searchedAt,
    search: result.search,
    hasMoreLikely: result.hasMoreLikely,
    counts: result.counts,
    categories: result.categories,
    errors: result.errors,
  }));
}
