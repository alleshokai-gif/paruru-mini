const fail = (code) => { throw new Error(code); };

function validateJourney(journey, hubService) {
  if (!journey?.id || !journey.label || !Array.isArray(journey.children) || journey.children.length < 2)
    fail('BUS_JOURNEY_SERVICE_INVALID');
  const ids = new Set();
  for (const child of journey.children) {
    if (!child?.id || ids.has(child.id) || !child.hubId || !child.decisionGroupId || !child.label
      || !child.purposeLabel || !hubService.hasHub(child.hubId)) fail('BUS_JOURNEY_SERVICE_INVALID');
    ids.add(child.id);
  }
}

function unavailableChild(child) {
  return { id: child.id, hubId: child.hubId, label: child.label, purposeLabel: child.purposeLabel,
    state: 'unavailable', decisionGroup: null, providers: [] };
}

export function createJourneyService({ journeys, hubService, now = () => Date.now() / 1000 } = {}) {
  if (!Array.isArray(journeys) || !journeys.length || typeof hubService?.hasHub !== 'function'
    || typeof hubService?.getHub !== 'function' || typeof now !== 'function') fail('BUS_JOURNEY_SERVICE_INVALID');
  const journeyMap = new Map();
  for (const journey of journeys) {
    validateJourney(journey, hubService);
    if (journeyMap.has(journey.id)) fail('BUS_JOURNEY_SERVICE_INVALID');
    journeyMap.set(journey.id, journey);
  }
  return {
    hasJourney(id) { return journeyMap.has(id); },
    async getJourney(id) {
      const journey = journeyMap.get(id);
      if (!journey) fail('BUS_JOURNEY_NOT_FOUND');
      const results = await Promise.allSettled(journey.children.map((child) => hubService.getHub(child.hubId)));
      const children = results.map((result, index) => {
        const child = journey.children[index];
        if (result.status !== 'fulfilled') return unavailableChild(child);
        const hub = result.value;
        const decisionGroup = hub.decisionGroups?.find((group) => group.id === child.decisionGroupId);
        if (!decisionGroup) return unavailableChild(child);
        return { id: child.id, hubId: child.hubId, label: child.label, purposeLabel: child.purposeLabel,
          state: decisionGroup.arrivals.length ? 'available' : 'empty', decisionGroup,
          providers: hub.providers, attributions: hub.attributions };
      });
      const attributions = [];
      const attributionKeys = new Set();
      for (const child of children) for (const value of child.attributions || []) {
        const key = `${value.provider}|${value.url}`;
        if (!attributionKeys.has(key)) { attributionKeys.add(key); attributions.push(value); }
      }
      return { success: true, journeyGroupId: journey.id, journeyGroupLabel: journey.label,
        generatedAt: now(), children: children.map(({ attributions: _attributions, ...child }) => child), attributions };
    }
  };
}
