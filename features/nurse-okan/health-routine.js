(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.PALURUHealthRoutine = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const ROUTINES = Object.freeze([
    { slot: "morning", title: "朝の健康記録", dueHour: 7 },
    { slot: "lunch", title: "昼の健康記録", dueHour: 12 },
    { slot: "post_training", title: "部活後の健康記録", dueHour: 17 },
    { slot: "dinner", title: "夜の健康記録", dueHour: 20 },
    { slot: "condition", title: "体調の健康記録", dueHour: 22 },
  ]);

  function localHour_(now) {
    const date = now instanceof Date ? now : new Date(now || Date.now());
    if (Number.isNaN(date.getTime())) return 0;
    return Number(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo", hour: "numeric", hour12: false,
    }).format(date));
  }

  function resolveCurrentRoutine(now) {
    const hour = localHour_(now);
    return ROUTINES.slice().reverse().find((routine) => hour >= routine.dueHour) || null;
  }

  function isChecked_(value) {
    return value === true || String(value || "").toLowerCase() === "true";
  }

  function isRoutineComplete(slot, value) {
    const record = value || {};
    if (slot === "morning") {
      return record.morningStaple && record.morningStaple !== "none"
        && isChecked_(record.morningWater)
        && isChecked_(record.morningMedication)
        && isChecked_(record.morningCondition);
    }
    if (slot === "lunch") {
      return record.lunchAmount && record.lunchAmount !== "none"
        && isChecked_(record.lunchWater)
        && isChecked_(record.lunchCondition);
    }
    if (slot === "post_training") {
      return record.postTrainingProteinSource && record.postTrainingProteinSource !== "none"
        && Number(record.postTrainingOnigiriCount) > 0
        && isChecked_(record.postTrainingWater)
        && isChecked_(record.postTrainingCondition);
    }
    if (slot === "dinner") {
      return Number(record.dinnerRiceBowls) > 0
        && isChecked_(record.dinnerMedication)
        && isChecked_(record.bedtime);
    }
    return Boolean(record.recordedAt);
  }

  function getPendingRoutines_(slots) {
    return ROUTINES.filter((routine) => !isRoutineComplete(routine.slot, slots[routine.slot]));
  }

  function getRoutineState_(routine, currentRoutine) {
    return {
      overdue: Boolean(currentRoutine && routine.dueHour <= currentRoutine.dueHour),
      routine,
    };
  }

  function selectNextRoutine_(pending, currentRoutine) {
    const overdue = pending.filter((routine) => getRoutineState_(routine, currentRoutine).overdue);
    const selected = (overdue.length ? overdue : pending)[0];
    return selected ? getRoutineState_(selected, currentRoutine) : null;
  }

  function resolveNextHealthTask(dailyRecord, now) {
    const slots = dailyRecord && dailyRecord.slots && typeof dailyRecord.slots === "object"
      ? dailyRecord.slots : {};
    const selectedState = selectNextRoutine_(getPendingRoutines_(slots), resolveCurrentRoutine(now));
    if (!selectedState) return null;
    const selected = selectedState.routine;
    return {
      slot: selected.slot,
      title: selected.title,
      overdue: selectedState.overdue,
      priority: selectedState.overdue ? "high" : "normal",
      action: "daily",
    };
  }

  return Object.freeze({ ROUTINES, resolveCurrentRoutine, resolveNextHealthTask, isRoutineComplete });
}));
