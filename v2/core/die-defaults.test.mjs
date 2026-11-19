import assert from "node:assert/strict";
import test from "node:test";
import {
  isDieLineSettings,
  resolveDieLineDefaults,
  resolveDieLineDefaultsOnSwitch,
} from "./die-defaults.mjs";

const DIE_A = {
  crustsPerCycle: 6, cycleSpeed: 8, speedAdjustment: 0.92, freezerTime: 22,
  casesPerLayer: 6, preTunnelMin: 3.5, postTunnelMin: 3, pressOvenMin: null, frontlineMin: null,
};
const DIE_B = {
  crustsPerCycle: 5, cycleSpeed: 9, speedAdjustment: 0.95, freezerTime: 15,
  casesPerLayer: 4, preTunnelMin: null, postTunnelMin: null, pressOvenMin: 2, frontlineMin: 1,
};
const BLANK = {
  crustsPerCycle: "", cycleSpeed: "", speedAdjustment: "", freezerTime: "",
  casesPerLayer: "", preTunnelMin: "", postTunnelMin: "", pressOvenMin: "", frontlineMin: "",
};

test("initial die selection fills only blank fields and keeps typed values", () => {
  assert.deepEqual(resolveDieLineDefaults(DIE_A, {
    ...BLANK,
    cycleSpeed: 7,
    preTunnelMin: 4,
  }), {
    crustsPerCycle: 6,
    speedAdjustment: 0.92,
    freezerTime: 22,
    casesPerLayer: 6,
    postTunnelMin: 3,
  });
});

test("explicit switching replaces known auto-fills but preserves operator values", () => {
  const switched = resolveDieLineDefaultsOnSwitch(
    DIE_B,
    { ...DIE_A, cycleSpeed: 7, preTunnelMin: 4 },
    [DIE_A, DIE_B],
  );
  assert.deepEqual(switched, {
    crustsPerCycle: 5,
    speedAdjustment: 0.95,
    freezerTime: 15,
    casesPerLayer: 4,
    postTunnelMin: null,
    pressOvenMin: 2,
    frontlineMin: 1,
  });
});

test("missing or disabled defaults do not invent settings", () => {
  assert.deepEqual(resolveDieLineDefaults(null, BLANK), {});
  assert.deepEqual(resolveDieLineDefaultsOnSwitch(null, DIE_A, [DIE_A]), {
    crustsPerCycle: null,
    cycleSpeed: null,
    speedAdjustment: null,
    freezerTime: null,
    casesPerLayer: null,
    preTunnelMin: null,
    postTunnelMin: null,
  });
  assert.deepEqual(resolveDieLineDefaultsOnSwitch(null, { ...DIE_A, cycleSpeed: 7 }, [DIE_A]), {
    crustsPerCycle: null,
    speedAdjustment: null,
    freezerTime: null,
    casesPerLayer: null,
    preTunnelMin: null,
    postTunnelMin: null,
  });
  assert.deepEqual(resolveDieLineDefaults(undefined, BLANK), {});
});

test("an explicit zero is a valid reviewed value and not a blank field", () => {
  const current = { ...BLANK, freezerTime: 0 };
  assert.equal(resolveDieLineDefaults(DIE_A, current).freezerTime, undefined);
  assert.equal(resolveDieLineDefaultsOnSwitch(DIE_B, { ...DIE_A, freezerTime: 0 }, [DIE_A, DIE_B]).freezerTime, undefined);
  assert.equal(isDieLineSettings({ ...DIE_A, freezerTime: -1 }), false);
  assert.equal(isDieLineSettings({ ...DIE_A, extra: 1 }), false);
});
