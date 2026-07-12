const HOME_AGENT_TIMEZONE = 'Asia/Tokyo';
const HOME_AGENT_INTENT_DAILY_DEPARTURE_CHECK = 'daily_departure_check';

const HOME_AGENT_AGENTS = {
  paruru: {
    id: 'paruru',
    name: 'ぱるる',
    role: '受付・Intent Router・結果統合・ユーザー回答',
    allowedSkills: [
      'getFamilySchedule',
      'buildDepartureCheck',
      'createSignageAlert',
    ],
  },
  peno: {
    id: 'peno',
    name: 'ぺんお',
    role: '学校・給食担当',
    allowedSkills: [
      'getSchoolSummary',
      'getSchoolLunch',
    ],
  },
  shimao: {
    id: 'shimao',
    name: 'しまお',
    role: '家庭環境・空調・外部天気補助担当',
    allowedSkills: [
      'getWeatherSummary',
    ],
  },
  popio: {
    id: 'popio',
    name: 'ぽぴお',
    role: '家計・予算・支出担当',
    allowedSkills: [],
  },
  nurseOkan: {
    id: 'nurseOkan',
    name: 'ナースおかん',
    role: '健康・栄養・温湿度担当',
    allowedSkills: [],
  },
  aircon: {
    id: 'aircon',
    name: 'エアコン管理',
    role: '空調提案・操作担当',
    allowedSkills: [],
  },
  energy: {
    id: 'energy',
    name: '電力管理',
    role: '電力状況・異常検知担当',
    allowedSkills: [],
  },
};

function getHomeAgentRegistry_() {
  return Object.keys(HOME_AGENT_AGENTS).reduce(function(out, key) {
    out[key] = Object.assign({}, HOME_AGENT_AGENTS[key]);
    return out;
  }, {});
}

function getHomeAgentDefinition_(agentId) {
  return HOME_AGENT_AGENTS[agentId] || null;
}

function getHomeAgentsForIntent_(intent) {
  if (intent === HOME_AGENT_INTENT_DAILY_DEPARTURE_CHECK) {
    return ['paruru', 'peno', 'shimao'];
  }

  return ['paruru'];
}
