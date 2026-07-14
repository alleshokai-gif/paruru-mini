const HOME_AGENT_SKILLS = {
  getFamilySchedule: {
    id: 'getFamilySchedule',
    name: '家族予定取得',
    ownerAgent: 'paruru',
    description: 'Googleファミリーカレンダーから対象日の予定を読むラッパー',
    inputSchema: {
      type: 'object',
      required: ['date'],
      properties: {
        date: { type: 'string', format: 'date' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        events: { type: 'array' },
      },
    },
    readOnly: true,
    requiresConfirmation: false,
    source: 'Google Calendar via CalendarApp / PALURU_FAMILY_CALENDAR_ID',
    handler: 'getFamilyScheduleSkill_',
  },
  getSchoolSummary: {
    id: 'getSchoolSummary',
    name: '学校サマリー取得',
    ownerAgent: 'peno',
    description: 'Calendar_DimやDaily_Contextから学校日・休暇・行事を読むラッパー',
    inputSchema: {
      type: 'object',
      required: ['date'],
      properties: {
        date: { type: 'string', format: 'date' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        isSchoolDay: { type: ['boolean', 'null'] },
        season: { type: 'string' },
        events: { type: 'array' },
      },
    },
    readOnly: true,
    requiresConfirmation: false,
    source: 'School Spreadsheet / Calendar_Dim / Daily_Context',
    handler: 'getSchoolSummarySkill_',
  },
  getSchoolLunch: {
    id: 'getSchoolLunch',
    name: '給食取得',
    ownerAgent: 'peno',
    description: 'Lunch_Factから対象日の給食献立を読むラッパー',
    inputSchema: {
      type: 'object',
      required: ['date'],
      properties: {
        date: { type: 'string', format: 'date' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        menu: { type: 'string' },
      },
    },
    readOnly: true,
    requiresConfirmation: false,
    source: 'School Spreadsheet / Lunch_Fact',
    handler: 'getSchoolLunchSkill_',
  },
  getWeatherSummary: {
    id: 'getWeatherSummary',
    name: '天気サマリー取得',
    ownerAgent: 'shimao',
    description: 'Signage_Statusの4地点天気を読み、必要時のみMessageのしまお文へfallbackするラッパー',
    inputSchema: {
      type: 'object',
      required: ['date'],
      properties: {
        date: { type: 'string', format: 'date' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        weatherText: { type: 'string' },
        currentTemperature: { type: ['number', 'string'] },
        maxTemperature: { type: ['number', 'string'] },
        minTemperature: { type: ['number', 'string'] },
        umbrellaRecommended: { type: 'boolean' },
      },
    },
    readOnly: true,
    requiresConfirmation: false,
    source: 'Signage_Status / Message fallback',
    handler: 'getWeatherSummarySkill_',
  },
  buildDepartureCheck: {
    id: 'buildDepartureCheck',
    name: '出発前チェック統合',
    ownerAgent: 'paruru',
    description: '予定・学校・給食・天気を統合して出発前チェックJSONを作る',
    inputSchema: {
      type: 'object',
      required: ['date', 'skillResults'],
      properties: {
        date: { type: 'string', format: 'date' },
        skillResults: { type: 'object' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        suggestedItems: { type: 'array' },
        signageMessage: { type: 'string' },
      },
    },
    readOnly: true,
    requiresConfirmation: false,
    source: 'Home Agent rule-based aggregator',
    handler: 'buildDepartureCheckSkill_',
  },
  createSignageAlert: {
    id: 'createSignageAlert',
    name: 'Signage Alert候補作成',
    ownerAgent: 'paruru',
    description: 'Signage Alert APIに渡す候補を作る。v0.1では送信しない',
    inputSchema: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string' },
        deviceId: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        requiresConfirmation: { type: 'boolean' },
        action: { type: 'object' },
      },
    },
    readOnly: false,
    requiresConfirmation: true,
    source: 'Signage Alert API candidate only',
    handler: 'createSignageAlertSkill_',
  },
  getRoomClimate: {
    id: 'getRoomClimate',
    name: '部屋の温湿度取得',
    ownerAgent: 'shimao',
    description: 'Room Registryと最新温湿度ログから指定部屋の状態を読む',
    inputSchema: { type: 'object', required: ['roomId'], properties: { roomId: { type: 'string' } } },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: false,
    source: 'switchbot-temp-log Web App / Log / ROOM_CONFIG',
    handler: 'getRoomClimateSkill_',
  },
  getRoomClimateTrend: {
    id: 'getRoomClimateTrend',
    name: '部屋温度傾向取得',
    ownerAgent: 'shimao',
    description: 'switchbot-temp-logから直近ログの温度傾向を取得する',
    inputSchema: { type: 'object', required: ['roomId'], properties: { roomId: { type: 'string' }, windowMinutes: { type: 'number' } } },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: false,
    source: 'switchbot-temp-log Web App / Log',
    handler: 'getRoomClimateTrendSkill_',
  },
  roomClimateOverview: {
    id: 'roomClimateOverview',
    name: '家全体の温湿度概要',
    ownerAgent: 'shimao',
    description: 'switchbot-temp-logから問題部屋優先の温湿度概要を取得する',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: false,
    source: 'switchbot-temp-log Web App / Log / ROOM_CONFIG',
    handler: 'roomClimateOverviewSkill_',
  },
  getAllRoomClimateAlerts: {
    id: 'getAllRoomClimateAlerts',
    name: '全室温湿度アラート取得',
    ownerAgent: 'shimao',
    description: '問題がある部屋だけを抽出する',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: false,
    source: 'switchbot-temp-log Web App / Log / ROOM_CONFIG',
    handler: 'getAllRoomClimateAlertsSkill_',
  },
  getAirconStatus: {
    id: 'getAirconStatus',
    name: 'エアコン状態取得',
    ownerAgent: 'shimao',
    description: 'Aircon_State相当の最新状態を読む',
    inputSchema: { type: 'object', required: ['roomId'], properties: { roomId: { type: 'string' } } },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: false,
    source: 'switchbot-temp-log Web App / Aircon_State / ROOM_CONFIG',
    handler: 'getAirconStatusSkill_',
  },
  getRoomAutomationPause: {
    id: 'getRoomAutomationPause',
    name: '部屋の自動制御pause取得',
    ownerAgent: 'shimao',
    description: '部屋別の一時停止状態を読む',
    inputSchema: { type: 'object', required: ['roomId'], properties: { roomId: { type: 'string' } } },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: false,
    source: 'Automation Pause sheet',
    handler: 'getRoomAutomationPauseSkill_',
  },
  buildAirconAdjustmentProposal: {
    id: 'buildAirconAdjustmentProposal',
    name: '空調一時差し込み提案',
    ownerAgent: 'shimao',
    description: '確認前のエアコン調整候補だけを作る',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: true,
    source: 'Room Climate / Aircon State',
    handler: 'buildAirconAdjustmentProposalSkill_',
  },
  buildAdaptiveClimateProposal: {
    id: 'buildAdaptiveClimateProposal',
    name: 'Adaptive空調補正提案',
    ownerAgent: 'shimao',
    description: '温度差と傾向から設定温度補正候補を作る。実操作はしない',
    inputSchema: { type: 'object', required: ['roomId'], properties: { roomId: { type: 'string' } } },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: false,
    source: 'switchbot-temp-log Web App / Adaptive Climate',
    handler: 'buildAdaptiveClimateProposalSkill_',
  },
  buildManualComfortAdjustmentProposal: {
    id: 'buildManualComfortAdjustmentProposal',
    name: '体感空調補正提案',
    ownerAgent: 'shimao',
    description: '暑い・寒い・強めて等の体感入力から一時補正候補を作る。実操作はしない',
    inputSchema: { type: 'object', required: ['roomId', 'message'], properties: { roomId: { type: 'string' }, message: { type: 'string' } } },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: false,
    source: 'switchbot-temp-log Web App / Adaptive Climate',
    handler: 'buildManualComfortAdjustmentProposalSkill_',
  },
  buildPauseRoomAutomationProposal: {
    id: 'buildPauseRoomAutomationProposal',
    name: '部屋自動制御pause提案',
    ownerAgent: 'shimao',
    description: '確認前のpause候補だけを作る',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    readOnly: true,
    requiresConfirmation: true,
    source: 'Automation Pause',
    handler: 'buildPauseRoomAutomationProposalSkill_',
  },
  pauseRoomAutomation: {
    id: 'pauseRoomAutomation',
    name: '部屋自動制御pause',
    ownerAgent: 'shimao',
    description: 'v0.1では確認済み実装が無い限り実行しない',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    readOnly: false,
    requiresConfirmation: true,
    source: 'Not connected in this slice',
    handler: 'pauseRoomAutomationSkill_',
  },
  resumeRoomAutomation: {
    id: 'resumeRoomAutomation',
    name: '部屋自動制御resume',
    ownerAgent: 'shimao',
    description: 'v0.1では確認済み実装が無い限り実行しない',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    readOnly: false,
    requiresConfirmation: true,
    source: 'Not connected in this slice',
    handler: 'resumeRoomAutomationSkill_',
  },
};

function getHomeSkillRegistry_() {
  return Object.keys(HOME_AGENT_SKILLS).reduce(function(out, key) {
    out[key] = Object.assign({}, HOME_AGENT_SKILLS[key]);
    return out;
  }, {});
}

function getHomeSkillDefinition_(skillId) {
  return HOME_AGENT_SKILLS[skillId] || null;
}

function getHomeSkillSequenceForIntent_(intent) {
  if (intent === HOME_AGENT_INTENT_PERSONAL_SCHEDULE) {
    return ['getFamilySchedule'];
  }

  if (intent === HOME_AGENT_INTENT_SCHOOL_STATUS) {
    return ['getSchoolSummary'];
  }

  if (intent === HOME_AGENT_INTENT_SCHOOL_LUNCH) {
    return ['getSchoolLunch'];
  }

  if (intent === HOME_AGENT_INTENT_WEATHER_CHECK) {
    return ['getWeatherSummary'];
  }

  if (intent === HOME_AGENT_INTENT_DEPARTURE_CHECK || intent === HOME_AGENT_INTENT_DAILY_DEPARTURE_CHECK) {
    return [
      'getFamilySchedule',
      'getSchoolSummary',
      'getSchoolLunch',
      'getWeatherSummary',
      'buildDepartureCheck',
    ];
  }

  if (intent === HOME_AGENT_INTENT_ROOM_CLIMATE_CHECK) {
    return ['getRoomClimate'];
  }

  if (intent === HOME_AGENT_INTENT_ROOM_CLIMATE_OVERVIEW) {
    return ['roomClimateOverview'];
  }

  if (intent === HOME_AGENT_INTENT_ROOM_CLIMATE_ALERT_CHECK) {
    return ['getAllRoomClimateAlerts'];
  }

  if (intent === HOME_AGENT_INTENT_ADAPTIVE_CLIMATE_CHECK) {
    return ['getRoomClimate', 'getRoomClimateTrend', 'getRoomAutomationPause', 'buildAdaptiveClimateProposal'];
  }

  if (intent === HOME_AGENT_INTENT_AIRCON_COMFORT_ADJUSTMENT) {
    return ['getRoomClimate', 'getRoomClimateTrend', 'buildManualComfortAdjustmentProposal'];
  }

  if (intent === HOME_AGENT_INTENT_AIRCON_OVERRIDE_REQUEST) {
    return ['getRoomClimate', 'getAirconStatus', 'getRoomAutomationPause', 'buildAirconAdjustmentProposal'];
  }

  if (intent === HOME_AGENT_INTENT_PAUSE_ROOM_AUTOMATION) {
    return ['getRoomClimate', 'getRoomAutomationPause', 'buildPauseRoomAutomationProposal'];
  }

  if (intent === HOME_AGENT_INTENT_RESUME_ROOM_AUTOMATION) {
    return ['getRoomClimate', 'getRoomAutomationPause'];
  }

  return [];
}

function invokeHomeSkill_(skillId, request, previousResults) {
  const skill = getHomeSkillDefinition_(skillId);
  if (!skill) {
    return homeAgentSkillError_(skillId, 'paruru', 'skill_not_registered', 'Skill is not registered');
  }

  const handler = globalThis[skill.handler];
  if (typeof handler !== 'function') {
    return homeAgentSkillError_(skillId, skill.ownerAgent, 'handler_not_found', 'Skill handler not found: ' + skill.handler);
  }

  try {
    return handler(request, previousResults || {});
  } catch (error) {
    return homeAgentSkillError_(
      skill.id,
      skill.ownerAgent,
      'skill_exception',
      error && error.message ? error.message : String(error)
    );
  }
}
