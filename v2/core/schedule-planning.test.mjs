import test from "node:test";
import assert from "node:assert/strict";
import {
  applyScheduleCommand,
  calculateScheduleTimeline,
  centralDate,
  emptySchedule,
  estimateScheduleRunDurationSec,
  isValidProductionDate,
  normalizeSchedule,
  SCHEDULE_TIME_ZONE,
  zonedWallTimeToEpoch,
} from "./schedule-planning.mjs";

const product = {
  id: "88000000-0000-4000-8000-000000000101",
  productCode: "PRODUCT",
  productionSetupCode: "SETUP",
  runTemplateCode: "TEMPLATE",
  targetCases: 20,
  notes: "",
};
const template = {
  code: "TEMPLATE",
  values: { pizzasPerCase: 12, crustsPerCycle: 4, cycleSpeed: 2, freezerTime: 0 },
};

test("production dates are strict calendar dates", () => {
  assert.equal(isValidProductionDate("2028-02-29"), true);
  assert.equal(isValidProductionDate("2027-02-29"), false);
  assert.equal(isValidProductionDate("2027-2-09"), false);
});

test("production dates roll over at Central midnight rather than UTC midnight", () => {
  assert.equal(centralDate(new Date("2026-11-19T05:59:00.000Z")), "2026-11-18");
  assert.equal(centralDate(new Date("2026-11-19T06:00:00.000Z")), "2026-11-19");
});

test("Central wall-clock conversion respects daylight transitions", () => {
  const summer = zonedWallTimeToEpoch("2026-07-01", "06:00");
  assert.equal(new Date(summer).toISOString(), "2026-07-01T11:00:00.000Z");
  assert.equal(zonedWallTimeToEpoch("2026-03-08", "02:30"), undefined);
  const repeated = zonedWallTimeToEpoch("2026-11-01", "01:30");
  assert.equal(new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(repeated)), "01:30");
});

test("schedule estimates use the shared baseline and keep missing durations unknown", () => {
  const duration = estimateScheduleRunDurationSec(product, template);
  assert.equal(Math.round(duration), Math.round(20 * 12 / (4 * 2 * 0.92) * 60));
  assert.equal(estimateScheduleRunDurationSec(product, { code: "TEMPLATE", values: { pizzasPerCase: 12 } }), undefined);
  assert.equal(estimateScheduleRunDurationSec(product, {
    code: "TEMPLATE",
    values: { pizzasPerCase: 12, crustsPerCycle: 4, cycleSpeed: 2, freezerTime: -1 },
  }), undefined);
});

test("unknown run duration blocks later estimates and the projected finish", () => {
  const second = { ...product, id: "88000000-0000-4000-8000-000000000102" };
  const schedule = normalizeSchedule({
    ...emptySchedule("2026-07-01"),
    runs: [product, second],
    breaks: [
      { slot: 1, enabled: true, runId: product.id },
      { slot: 2, enabled: false, runId: null },
      { slot: 3, enabled: false, runId: null },
    ],
    updatedAt: null,
  });
  const result = calculateScheduleTimeline(schedule, [template]);
  assert.equal(result.runs[0].startMs !== undefined, true);
  assert.equal(result.runs[1].startMs !== undefined, true);
  assert.equal(result.projectedFinishMs !== undefined, true);

  const missing = calculateScheduleTimeline(schedule, []);
  assert.equal(missing.runs[0].finishMs, undefined);
  assert.equal(missing.runs[1].startMs, undefined);
  assert.equal(missing.projectedFinishMs, undefined);
  assert.equal(missing.incomplete, true);
});

test("date-scoped commands preserve unrelated runs and unassign removed-run breaks", () => {
  const second = { ...product, id: "88000000-0000-4000-8000-000000000102" };
  const schedule = normalizeSchedule({
    ...emptySchedule("2026-07-01"),
    runs: [product, second],
    breaks: [
      { slot: 1, enabled: true, runId: product.id },
      { slot: 2, enabled: false, runId: null },
      { slot: 3, enabled: false, runId: null },
    ],
    updatedAt: null,
  });
  const changed = applyScheduleCommand(schedule, { type: "move", runId: second.id, toIndex: 0 });
  assert.deepEqual(changed.runs.map((run) => run.id), [second.id, product.id]);
  const removed = applyScheduleCommand(changed, { type: "remove", runId: product.id });
  assert.deepEqual(removed.runs.map((run) => run.id), [second.id]);
  assert.equal(removed.breaks[0].runId, null);
  const merged = applyScheduleCommand(removed, { type: "merge-import", runs: [product] });
  assert.deepEqual(merged.runs.map((run) => run.id), [second.id, product.id]);
  assert.deepEqual(applyScheduleCommand(merged, { type: "merge-import", runs: [product] }).runs, merged.runs);
});
