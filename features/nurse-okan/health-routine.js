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
  const ROUTINE_STATUS = Object.freeze({
    RECORDED: "recorded",
    DUE_MISSING: "due_missing",
    NOT_DUE: "not_due",
  });
  const MISSING_AFTER_HOURS = Object.freeze({
    morning: 9,
    lunch: 15,
    dinner: 22,
    condition: 23,
  });

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

  function isRoutineRecorded(value) {
    return String(value && value.recordedAt || "").trim() !== "";
  }

  function isRoutineComplete(slot, value) {
    return ROUTINES.some((routine) => routine.slot === slot) && isRoutineRecorded(value);
  }

  function resolveRoutineStatus(slot, value, now) {
    if (isRoutineRecorded(value)) return ROUTINE_STATUS.RECORDED;
    const missingAfterHour = MISSING_AFTER_HOURS[slot];
    return Number.isFinite(missingAfterHour) && localHour_(now) >= missingAfterHour
      ? ROUTINE_STATUS.DUE_MISSING
      : ROUTINE_STATUS.NOT_DUE;
  }

  function getPendingRoutineStates_(slots, now) {
    return ROUTINES.map((routine) => ({
      routine,
      status: resolveRoutineStatus(routine.slot, slots[routine.slot], now),
    })).filter((state) => state.status !== ROUTINE_STATUS.RECORDED);
  }

  function selectNextRoutineState_(pending) {
    const dueMissing = pending.filter((state) => state.status === ROUTINE_STATUS.DUE_MISSING);
    return (dueMissing.length ? dueMissing : pending)[0] || null;
  }

  function resolveNextHealthTask(dailyRecord, now) {
    const slots = dailyRecord && dailyRecord.slots && typeof dailyRecord.slots === "object"
      ? dailyRecord.slots : {};
    const selectedState = selectNextRoutineState_(getPendingRoutineStates_(slots, now));
    if (!selectedState) return null;
    const selected = selectedState.routine;
    const overdue = selectedState.status === ROUTINE_STATUS.DUE_MISSING;
    return {
      slot: selected.slot,
      title: selected.title,
      status: selectedState.status,
      overdue,
      priority: overdue ? "high" : "normal",
      action: "daily",
    };
  }

  function resolveCurrentHealthCheck(dailyRecord, now) {
    const routine = resolveCurrentRoutine(now);
    if (!routine) return null;
    const slots = dailyRecord && dailyRecord.slots && typeof dailyRecord.slots === "object"
      ? dailyRecord.slots : {};
    const status = resolveRoutineStatus(routine.slot, slots[routine.slot], now);
    return {
      slot: routine.slot,
      title: routine.title,
      status,
      overdue: status === ROUTINE_STATUS.DUE_MISSING,
      action: "daily",
    };
  }

  function listDueMissingRoutines(dailyRecord, now) {
    const slots = dailyRecord && dailyRecord.slots && typeof dailyRecord.slots === "object"
      ? dailyRecord.slots : {};
    return ROUTINES.map((routine) => ({
      slot: routine.slot,
      title: routine.title,
      status: resolveRoutineStatus(routine.slot, slots[routine.slot], now),
      action: "daily",
    })).filter((routine) => routine.status === ROUTINE_STATUS.DUE_MISSING);
  }

  return Object.freeze({
    ROUTINES,
    ROUTINE_STATUS,
    MISSING_AFTER_HOURS,
    resolveCurrentRoutine,
    resolveRoutineStatus,
    resolveNextHealthTask,
    resolveCurrentHealthCheck,
    listDueMissingRoutines,
    isRoutineRecorded,
    isRoutineComplete,
  });
}));
