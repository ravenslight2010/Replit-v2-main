export const SCHEDULE_TIME_ZONE = "America/Chicago";
export const DEFAULT_PRODUCTION_START_TIME = "06:00";
export const STANDARD_BREAK_MINUTES = 30;
export const MAX_SCHEDULE_RUNS = 100;

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export class ScheduleValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ScheduleValidationError";
    this.status = status;
  }
}

export function isValidProductionDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function centralDate(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function normalizeScheduleRun(value, index = 0) {
  if (!isObject(value) || !hasExactKeys(value, [
    "id", "productCode", "productionSetupCode", "runTemplateCode", "targetCases", "notes",
  ])) {
    throw new ScheduleValidationError(`Planned run ${index + 1} has unsupported fields.`);
  }
  if (typeof value.id !== "string" || !UUID.test(value.id)) {
    throw new ScheduleValidationError(`Planned run ${index + 1} needs a valid ID.`);
  }
  for (const [field, label] of [
    ["productCode", "product"],
    ["productionSetupCode", "production setup"],
    ["runTemplateCode", "run template"],
  ]) {
    if (typeof value[field] !== "string" || !CODE.test(value[field])) {
      throw new ScheduleValidationError(`Choose an available ${label} for planned run ${index + 1}.`);
    }
  }
  if (!Number.isSafeInteger(value.targetCases) || value.targetCases < 1 || value.targetCases > 1_000_000) {
    throw new ScheduleValidationError(`Target cases for planned run ${index + 1} must be a whole number from 1 to 1,000,000.`);
  }
  if (typeof value.notes !== "string" || value.notes.length > 500
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.notes)) {
    throw new ScheduleValidationError(`Notes for planned run ${index + 1} must be 500 characters or fewer.`);
  }
  return {
    id: value.id.toLowerCase(),
    productCode: value.productCode,
    productionSetupCode: value.productionSetupCode,
    runTemplateCode: value.runTemplateCode,
    targetCases: value.targetCases,
    notes: value.notes.trim(),
  };
}

export function normalizeScheduleBreaks(value, runs) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ScheduleValidationError("A schedule needs exactly three standard break slots.");
  }
  const runIds = new Set(runs.map((run) => run.id));
  const breaks = value.map((item, index) => {
    if (!isObject(item) || !hasExactKeys(item, ["slot", "enabled", "runId"])
      || item.slot !== index + 1 || typeof item.enabled !== "boolean"
      || !(item.runId === null || (typeof item.runId === "string" && UUID.test(item.runId)))) {
      throw new ScheduleValidationError(`Break ${index + 1} is invalid.`);
    }
    const runId = item.runId === null ? null : item.runId.toLowerCase();
    if (runId !== null && !runIds.has(runId)) {
      throw new ScheduleValidationError(`Break ${index + 1} points to a planned run that is no longer on this schedule.`);
    }
    return { slot: index + 1, enabled: item.enabled, runId };
  });
  return breaks;
}

export function normalizeSchedule(value) {
  if (!isObject(value) || !hasExactKeys(value, ["date", "revision", "timeZone", "productionStartTime", "runs", "breaks", "updatedAt"])) {
    throw new ScheduleValidationError("The schedule response is incomplete.", 502);
  }
  if (!isValidProductionDate(value.date)
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || value.timeZone !== SCHEDULE_TIME_ZONE
    || typeof value.productionStartTime !== "string" || !CLOCK.test(value.productionStartTime)
    || !Array.isArray(value.runs) || value.runs.length > MAX_SCHEDULE_RUNS
    || !(value.updatedAt === null || (typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))))) {
    throw new ScheduleValidationError("The schedule response contains invalid values.", 502);
  }
  const runs = value.runs.map(normalizeScheduleRun);
  if (new Set(runs.map((run) => run.id)).size !== runs.length) {
    throw new ScheduleValidationError("The schedule response contains duplicate planned-run IDs.", 502);
  }
  return {
    date: value.date,
    revision: value.revision,
    timeZone: SCHEDULE_TIME_ZONE,
    productionStartTime: value.productionStartTime,
    runs,
    breaks: normalizeScheduleBreaks(value.breaks, runs),
    updatedAt: value.updatedAt,
  };
}

export function emptySchedule(date, productionStartTime = DEFAULT_PRODUCTION_START_TIME) {
  if (!isValidProductionDate(date)) throw new ScheduleValidationError("Choose a valid production date.");
  if (typeof productionStartTime !== "string" || !CLOCK.test(productionStartTime)) {
    throw new ScheduleValidationError("The production start time is invalid.", 502);
  }
  return {
    date,
    revision: 0,
    timeZone: SCHEDULE_TIME_ZONE,
    productionStartTime,
    runs: [],
    breaks: [1, 2, 3].map((slot) => ({ slot, enabled: false, runId: null })),
    updatedAt: null,
  };
}

function localDateParts(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  return Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
}

export function zonedWallTimeToEpoch(date, time, timeZone = SCHEDULE_TIME_ZONE) {
  if (!isValidProductionDate(date) || typeof time !== "string" || !CLOCK.test(time)) return undefined;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = targetUtc;
  for (let index = 0; index < 4; index += 1) {
    const local = localDateParts(candidate, timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const correction = targetUtc - localAsUtc;
    if (correction === 0) break;
    candidate += correction;
  }
  const actual = localDateParts(candidate, timeZone);
  if (actual.year !== year || actual.month !== month || actual.day !== day
    || actual.hour !== hour || actual.minute !== minute) return undefined;
  return candidate;
}

export function estimateScheduleRunDurationSec(run, template) {
  const values = template?.values;
  if (!isObject(values)) return undefined;
  const positive = (number) => typeof number === "number" && Number.isFinite(number) && number > 0;
  const nonnegative = (number) => typeof number === "number" && Number.isFinite(number) && number >= 0;
  const cases = run.targetCases;
  const pizzasPerCase = values.pizzasPerCase;
  const speedAdjustment = values.speedAdjustment === undefined ? 0.92 : values.speedAdjustment;
  const rate = positive(values.crustsPerCycle) && positive(values.cycleSpeed) && positive(speedAdjustment)
    ? Math.round(values.crustsPerCycle * values.cycleSpeed * speedAdjustment * 100) / 100
    : 0;
  const freezerTime = typeof values.freezerTime === "string" && values.freezerTime.trim() !== ""
    ? Number(values.freezerTime)
    : values.freezerTime;
  if (!positive(cases) || !positive(pizzasPerCase) || !positive(rate) || !nonnegative(freezerTime)) return undefined;
  const duration = cases * pizzasPerCase / rate * 60 + freezerTime * 60;
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

export function calculateScheduleTimeline(schedule, templates, { nowMs = Date.now(), today = centralDate(nowMs) } = {}) {
  const byCode = new Map(templates.map((template) => [template.code, template]));
  const startMs = zonedWallTimeToEpoch(schedule.date, schedule.productionStartTime, schedule.timeZone);
  const runs = [];
  const breaks = [];
  let cursor = startMs;
  let incomplete = startMs === undefined;
  let partialFinishMs;
  const todayStart = zonedWallTimeToEpoch(today, "00:00", schedule.timeZone);
  const dateStart = zonedWallTimeToEpoch(schedule.date, "00:00", schedule.timeZone);
  const isToday = todayStart !== undefined && dateStart === todayStart;
  if (isToday && cursor !== undefined) cursor = Math.max(cursor, nowMs);

  for (const run of schedule.runs) {
    const durationSec = estimateScheduleRunDurationSec(run, byCode.get(run.runTemplateCode));
    const start = cursor;
    const finish = start !== undefined && durationSec !== undefined ? start + durationSec * 1000 : undefined;
    if (finish === undefined || !Number.isFinite(finish) || Number.isNaN(new Date(finish).getTime())) {
      cursor = undefined;
      incomplete = true;
    } else {
      cursor = finish;
      partialFinishMs = finish;
    }
    runs.push({ runId: run.id, startMs: start, finishMs: finish, durationSec, status: "planned" });
    const afterRunBreaks = schedule.breaks.filter((item) => item.enabled && item.runId === run.id);
    for (const item of afterRunBreaks) {
      const breakStart = cursor;
      const breakFinish = breakStart === undefined ? undefined : breakStart + STANDARD_BREAK_MINUTES * 60_000;
      if (breakFinish === undefined || !Number.isFinite(breakFinish) || Number.isNaN(new Date(breakFinish).getTime())) {
        incomplete = true;
        breaks.push({ slot: item.slot, startMs: undefined, finishMs: undefined, status: "pending", reason: "unknown-duration" });
        cursor = undefined;
      } else {
        cursor = breakFinish;
        partialFinishMs = breakFinish;
        breaks.push({ slot: item.slot, startMs: breakStart, finishMs: breakFinish, status: "scheduled" });
      }
    }
  }
  for (const item of schedule.breaks) {
    if (!item.enabled) continue;
    if (item.runId === null) {
      incomplete = true;
      breaks.push({ slot: item.slot, status: "unassigned", reason: "missing-run" });
    }
  }
  return {
    timeZone: schedule.timeZone,
    productionStartMs: startMs,
    runs,
    breaks: breaks.sort((left, right) => left.slot - right.slot),
    projectedFinishMs: incomplete ? undefined : cursor,
    partialFinishMs,
    incomplete,
  };
}

export function applyScheduleCommand(schedule, command) {
  const runs = schedule.runs.map((run) => ({ ...run }));
  const breaks = schedule.breaks.map((item) => ({ ...item }));
  const find = (id) => runs.findIndex((run) => run.id === id);
  switch (command?.type) {
    case "add": {
      const run = normalizeScheduleRun(command.run, runs.length);
      if (runs.length >= MAX_SCHEDULE_RUNS || find(run.id) !== -1) {
        throw new ScheduleValidationError("This planned run cannot be added.");
      }
      runs.push(run);
      break;
    }
    case "update": {
      const index = find(command?.runId);
      if (index < 0) throw new ScheduleValidationError("That planned run is no longer on the schedule.", 409);
      runs[index] = normalizeScheduleRun({ ...runs[index], ...command.changes }, index);
      break;
    }
    case "remove": {
      const index = find(command?.runId);
      if (index < 0) throw new ScheduleValidationError("That planned run is no longer on the schedule.", 409);
      runs.splice(index, 1);
      for (const item of breaks) if (item.runId === command.runId) item.runId = null;
      break;
    }
    case "move": {
      const index = find(command?.runId);
      if (index < 0 || !Number.isSafeInteger(command.toIndex) || command.toIndex < 0 || command.toIndex >= runs.length) {
        throw new ScheduleValidationError("Choose a planned run and a valid position.");
      }
      const [run] = runs.splice(index, 1);
      runs.splice(command.toIndex, 0, run);
      break;
    }
    case "swap": {
      const first = find(command?.firstRunId);
      const second = find(command?.secondRunId);
      if (first < 0 || second < 0 || first === second) throw new ScheduleValidationError("Choose two different planned runs.");
      [runs[first], runs[second]] = [runs[second], runs[first]];
      break;
    }
    case "breaks":
      return { ...schedule, breaks: normalizeScheduleBreaks(command.breaks, runs), runs };
    case "merge-import": {
      if (!Array.isArray(command.runs) || command.runs.length > MAX_SCHEDULE_RUNS) {
        throw new ScheduleValidationError("The reviewed import contains too many planned runs.");
      }
      for (const imported of command.runs.map(normalizeScheduleRun)) {
        const index = find(imported.id);
        if (index < 0) runs.push(imported);
        else runs[index] = imported;
        if (runs.length > MAX_SCHEDULE_RUNS) {
          throw new ScheduleValidationError("The schedule cannot contain more than 100 planned runs.");
        }
      }
      const validIds = new Set(runs.map((run) => run.id));
      for (const item of breaks) if (item.runId && !validIds.has(item.runId)) item.runId = null;
      return { ...schedule, runs, breaks };
    }
    default:
      throw new ScheduleValidationError("Choose a supported schedule change.");
  }
  return { ...schedule, runs, breaks };
}
