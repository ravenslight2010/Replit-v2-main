export const DIE_DEFAULT_FIELDS = Object.freeze([
  "crustsPerCycle",
  "cycleSpeed",
  "speedAdjustment",
  "freezerTime",
  "casesPerLayer",
  "preTunnelMin",
  "postTunnelMin",
  "pressOvenMin",
  "frontlineMin",
]);

export const REQUIRED_DIE_DEFAULT_FIELDS = Object.freeze(DIE_DEFAULT_FIELDS.slice(0, 5));

export function isDieLineSettings(value, { allowMissingRequired = false, allowEmpty = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !DIE_DEFAULT_FIELDS.includes(key))) return false;
  if (!allowMissingRequired
    && REQUIRED_DIE_DEFAULT_FIELDS.some((key) => !Object.hasOwn(value, key))) return false;
  return Object.entries(value).every(([key, item]) =>
    DIE_DEFAULT_FIELDS.includes(key)
      && (item === null || (allowEmpty && item === "")
        || (typeof item === "number" && Number.isFinite(item) && item >= 0)));
}

function untouched(value) {
  return value === null || value === undefined || value === "";
}

/**
 * Fill only empty setup fields. This is for the first explicit die selection;
 * import/autofill paths must not replace values that merely match a default.
 */
export function resolveDieLineDefaults(defaults, current) {
  if (!isDieLineSettings(current, { allowMissingRequired: true, allowEmpty: true })
    || !isDieLineSettings(defaults, { allowMissingRequired: true })) return {};
  const fills = {};
  for (const key of DIE_DEFAULT_FIELDS) {
    if (defaults[key] !== undefined && defaults[key] !== null && untouched(current[key])) {
      fills[key] = defaults[key];
    }
  }
  return fills;
}

/**
 * Fill empty fields and replace values known to have been auto-filled from a
 * prior die selection. Values not matching any reviewed default are operator
 * values and remain untouched. Missing target values clear only recognized
 * auto-fills, never values the operator entered.
 */
export function resolveDieLineDefaultsOnSwitch(defaults, current, knownDefaults = []) {
  if (!isDieLineSettings(current, { allowMissingRequired: true, allowEmpty: true })
    || (defaults !== null && !isDieLineSettings(defaults, { allowMissingRequired: true }))
    || !Array.isArray(knownDefaults)
    || knownDefaults.some((entry) => !isDieLineSettings(entry, { allowMissingRequired: true }))) {
    return {};
  }
  const fills = {};
  for (const key of DIE_DEFAULT_FIELDS) {
    const value = defaults?.[key];
    const currentValue = current[key];
    const wasAutoFilled = knownDefaults.some((entry) =>
      entry[key] !== undefined && entry[key] !== null && entry[key] === currentValue);
    if (value !== undefined && value !== null
      && (untouched(currentValue) || wasAutoFilled)
      && value !== currentValue) {
      fills[key] = value;
    } else if ((value === undefined || value === null) && wasAutoFilled) {
      fills[key] = null;
    }
  }
  return fills;
}
