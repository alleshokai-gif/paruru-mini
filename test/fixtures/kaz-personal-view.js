'use strict';
// Synthetic fixture only; never loaded by index.html or used as a production fallback.
const original = require('./kaz-personal-scale.json');
function fixture(projectCount = 10) {
  const d = structuredClone(original);
  d.sources = structuredClone(d.input_sources);
  for (const key of ['projects', 'milestones', 'inbox', 'plan']) d.sources[key] = structuredClone(d.sources.tasks);
  Object.values(d.sources).forEach(s => { s.valid_until = '2026-09-14T09:45:00+09:00'; s.scope = 'synthetic selected scope'; });
  d.sources.resolution={...d.sources.calendar,source_revision:'fixture:resolution-r1'};
  d.sources.calendar.coverage={start:'2026-09-14T00:00:00+09:00',end:'2026-09-15T12:00:00+09:00'};
  const at = time => `2026-09-14T${time}:00+09:00`;
  const confirmation={confirmed_by:'kaz',confirmed_at:d.as_of,valid_until:d.sources.resolution.valid_until,method:'fixture',evidence_ref:'fixture:human-classification-confirmation'};
  const constraints = impact => d.calendar_events.filter(e=>e.impact_on_kaz===impact).map(e=>({start:e.start,end:e.end,source_event_id:e.id,evidence:confirmation,reason:impact==='unknown'?'HUMAN_BOUNDED_UNKNOWN':undefined}));
  d.window_gate={mode:'window_proposal_only',as_of:d.as_of,adopted:false,state:'windows_available',calendar_revision:d.sources.calendar.source_revision,resolution_hash:d.sources.resolution.source_revision,
    confirmed_hard_constraints:constraints('hard_constraint'),confirmed_soft_constraints:constraints('soft_constraint'),unknown_windows:constraints('unknown'),
    confirmed_available_windows:d.availability.windows.map(([start,end])=>({start:at(start),end:at(end)})),
    usable_windows:d.availability.windows.map(([start,end])=>({start:at(start),end:at(end)})),
    availability_evidence:d.availability.windows.map(([start,end])=>({window:{start:at(start),end:at(end)},confirmation})),coverage_evidence:[]};
  d.day_context={day_date:'2026-09-14',origin:'user',evidence_ref:'fixture:explicit-sleep-settings',source_revision:d.sources.constraints.source_revision,
    wake_at:at(d.sleep.wake),stop_at:at(d.sleep.development_stop),bed_at:at(d.sleep.sleep_target),next_wake_at:`2026-09-15T${d.sleep.next_wake}:00+09:00`};
  d.today.status='proposal';
  d.today.plan.forEach(b=>{if(b.origin==='fixed_fixture_plan'){b.certainty='scheduled';b.adoption_ref='fixture:adopted-'+b.work_item_id;}});
  d.today.recommendations={
    'fx-w001':{kind:'human_review_leverage',reason:'確認済み20分枠に収まる・5分のReviewで次の工程へ',evidence_ref:'fixture:evidence-fx-w001'},
    'fx-w004':{kind:'human_review_leverage',reason:'5分のReviewで写真整理の確認待ちを解消',evidence_ref:'fixture:evidence-fx-w004'},
    'fx-w005':{kind:'dependency_unlock',reason:'質問を整理して修理の見積依頼を前へ進める',evidence_ref:'fixture:unlock-w005'}
  };
  d.evidence['fixture:unlock-w005']={kind:'dependency_unlock',work_item_id:'fx-w005',dependent_step:'fixture:repair-estimate',synthetic:true};
  const statuses = ['REVIEW', 'ACTIVE', 'ACTIVE', 'REVIEW', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'REVIEW', 'BLOCKED', 'BLOCKED'];
  d.projects.forEach((p, i) => { p.status = statuses[i]; p.milestones_complete = true; if (p.status === 'BLOCKED') p.blocker = '共有予定の本人関与を確認'; });
  d.work_items[0].selection_reason = '5mの確認で次の工程へ進む · 確認済み20m窓内';
  for (let i = 10; i < projectCount; i++) {
    const id = 'fx-p' + String(i + 1).padStart(2, '0'), done = i % 3 === 0;
    const evidenceRef = 'fixture:extra-' + id, milestoneId = 'fx-m-' + id;
    d.projects.push({ id, title: `検証Project ${i + 1}`, status: done ? 'DONE' : 'BACKLOG', current_focus: done ? '受入済みの終了記録' : '計画の整理', next_action: done ? '終了' : null, milestones: done ? [{ id: milestoneId, accepted: true, evidence_ref: evidenceRef }] : null, milestones_complete: true });
    if (done) d.evidence[evidenceRef] = { project_id: id, milestone_id: milestoneId, decision: 'ACCEPTED', authority: 'synthetic_design_fixture', not_real_user_approval: true };
  }
  return d;
}
module.exports = { fixture };
