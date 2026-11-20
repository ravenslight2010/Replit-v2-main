const API = "/api/v2/qc";
const REFRESH_MS = 7000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const el = {
  panel: document.querySelector("#qc-panel"),
  status: document.querySelector("#qc-status"),
  error: document.querySelector("#qc-error"),
  forms: document.querySelector("#qc-forms"),
  review: document.querySelector("#qc-review-badge"),
  history: document.querySelector("#qc-event-list"),
  facilityHistory: document.querySelector("#qc-facility-event-list"),
  export: document.querySelector("#qc-export"),
  refresh: document.querySelector("#qc-refresh"),
};

let staff = null;
let run = null;
let writable = false;
let data = null;
let facilityEvents = [];
let requestGeneration = 0;
let loadInFlight = false;
let timer = null;
let renderedSettingsFingerprint = null;
let contextCapabilities = "";
let renderedRunEventsFingerprint = null;
let renderedFacilityEventsFingerprint = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function getCsrfHeaders() {
  const match = document.cookie.match(/(?:^|;\s*)v2_csrf=([A-Za-z0-9_-]{43})(?:;|$)/u);
  return match ? { "x-csrf-token": match[1] } : {};
}

async function readBody(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The QC response could not be read. Refresh and try again.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("The QC response was incomplete. Refresh and try again.");
  }
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "The QC request was not accepted.");
  }
  return body;
}

function canManage() {
  return staff?.capabilities?.includes("manage-qc") === true;
}

function canManageAllergens() {
  return staff?.capabilities?.includes("manage-allergens") === true;
}

function canRecord() {
  return staff?.capabilities?.includes("record-qc") === true || canManage();
}

function runItems() {
  return Array.isArray(data?.items) ? data.items.filter((item) =>
    item && UUID.test(item.productId || "") && typeof item.productCode === "string"
    && typeof item.productName === "string" && typeof item.recipeCode === "string"
    && typeof item.stationKey === "string"
    && typeof item.unit === "string") : [];
}

function itemOptions() {
  return runItems().map((item, index) =>
    `<option value="${index}">${escapeHtml(item.productName)} · ${escapeHtml(item.recipeName)} · ${escapeHtml(item.stationKey)} · ${escapeHtml(item.unit)}</option>`,
  ).join("");
}

function selectedItem(form) {
  const item = runItems()[Number(new FormData(form).get("itemIndex"))];
  if (!item) throw new Error("Choose an ingredient from this run’s saved setup.");
  return item;
}

function settingForWeight(item) {
  const key = `weight:${item.productCode.toLocaleLowerCase("en-US")}:${item.stationKey}:${item.unit}`;
  return data?.settings?.find((setting) => setting.settingKey === key && setting.unit === item.unit) ?? null;
}

function settingForBrix() {
  const code = data?.run?.setupSnapshot?.productCode;
  if (typeof code !== "string") return null;
  const key = `brix:${code.toLocaleLowerCase("en-US")}`;
  return data?.settings?.find((setting) => setting.settingKey === key) ?? null;
}

function formStatus(form, message, error = false) {
  const status = form.querySelector("[data-form-status]");
  if (!status) return;
  status.textContent = message;
  status.setAttribute("role", error ? "alert" : "status");
}

function refreshStatus(message, error = false) {
  el.status.textContent = message;
  el.status.setAttribute("role", error ? "alert" : "status");
}

function requestIdFor(form, body) {
  const serialized = JSON.stringify(body);
  if (!form.dataset.qcRequestId || form.dataset.qcRequestPayload !== serialized) {
    form.dataset.qcRequestId = crypto.randomUUID();
    form.dataset.qcRequestPayload = serialized;
  }
  return form.dataset.qcRequestId;
}

async function submitRequest(form, path, body, { download = false } = {}) {
  if (!writable) throw new Error("Refresh the server state before recording QC.");
  const requestId = requestIdFor(form, body);
  form.querySelectorAll("button, input, select").forEach((control) => { control.disabled = true; });
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...getCsrfHeaders() },
      body: JSON.stringify({ ...body, requestId }),
    });
    const result = await readBody(response);
    delete form.dataset.qcRequestId;
    delete form.dataset.qcRequestPayload;
    return result;
  } finally {
    form.querySelectorAll("button, input, select").forEach((control) => {
      control.disabled = !writable;
    });
  }
}

async function handleFormSubmit(event) {
  const form = event.target.closest("form[data-qc-action]");
  if (!form) return;
  event.preventDefault();
  if (!writable) {
    formStatus(form, "Refresh the server state before recording QC.", true);
    return;
  }

  const action = form.dataset.qcAction;
  try {
    const values = new FormData(form);
    let path = `/runs/${encodeURIComponent(run.id)}/events`;
    let body;
    if (action === "lot") {
      const item = selectedItem(form);
      body = {
        eventType: "lot-recorded",
        productId: item.productId,
        recipeCode: item.recipeCode,
        stationKey: item.stationKey,
        lotCode: values.get("lotCode"),
      };
    } else if (action === "weight") {
      const item = selectedItem(form);
      body = {
        eventType: "weight-check",
        productId: item.productId,
        recipeCode: item.recipeCode,
        stationKey: item.stationKey,
        actual: values.get("actual"),
        reason: values.get("reason") || "",
      };
    } else if (action === "cleaning") {
      const localTime = values.get("cleanedAt");
      const cleanedAt = new Date(localTime);
      if (!localTime || Number.isNaN(cleanedAt.valueOf())) throw new Error("Enter when cleaning was completed.");
      body = {
        eventType: "cleaning-recorded",
        method: values.get("method"),
        cleanedAt: cleanedAt.toISOString(),
      };
    } else if (action === "date-code") {
      body = { eventType: "date-code-observed", observedText: values.get("observedText") };
    } else if (action === "brix") {
      body = { eventType: "brix-check", actual: values.get("actual") };
    } else if (action === "allergen-review") {
      body = { eventType: "run-check-reviewed", checkType: "allergen-footprint" };
    } else if (action === "component-check") {
      body = {
        eventType: "run-check-reviewed",
        checkType: "component-presence",
        observations: (data.components ?? []).map((item, index) => {
          const status = values.get(`componentStatus-${index}`);
          return {
            productId: item.productId,
            recipeCode: item.recipeCode,
            stationKey: item.stationKey,
            status,
            observedProductId: status === "identity-mismatch"
              ? (data.componentProducts ?? []).find((product) =>
                product.productCode === values.get(`componentObserved-${index}`))?.productId ?? null
              : null,
          };
        }),
      };
      if (body.observations.some((observation, index) =>
        observation.status === "identity-mismatch" && !observation.observedProductId)) {
        throw new Error("Choose an active observed product code for each identity mismatch.");
      }
    } else if (action === "checkpoint") {
      body = {
        eventType: "checkpoint-observed",
        checkpointType: values.get("checkpointType"),
        stationKey: values.get("stationKey"),
        checkpointLabel: values.get("checkpointLabel"),
        observedValue: values.get("observedValue"),
        unit: values.get("unit"),
        note: values.get("note") || "",
      };
    } else if (action === "corrective-action") {
      body = {
        eventType: "corrective-action-observed",
        targetEventId: values.get("targetEventId"),
        actionObserved: values.get("actionObserved"),
        followUpNote: values.get("followUpNote") || "",
      };
    } else if (action === "review-flag") {
      const targetType = values.get("targetType");
      body = {
        eventType: "review-flag-raised",
        targetType,
        reason: values.get("reason"),
      };
      if (targetType === "lot") body.targetEventId = values.get("targetEventId");
    } else if (action === "review-flag-review") {
      path = `/runs/${encodeURIComponent(form.dataset.targetRunId)}/events`;
      body = {
        eventType: "review-flag-reviewed",
        targetEventId: form.dataset.targetEventId,
        reviewNote: values.get("reviewNote"),
      };
    } else if (action === "substitution-propose") {
      path = `/runs/${encodeURIComponent(run.id)}/substitutions`;
      const sourceItems = [...form.querySelectorAll("[data-source-row]")].map((row) => {
        const item = runItems()[Number(row.querySelector('[name="sourceItemIndex"]')?.value)];
        if (!item) throw new Error("Choose every source component from this run.");
        return {
          productId: item.productId,
          recipeCode: item.recipeCode,
          stationKey: item.stationKey,
          quantity: row.querySelector('[name="sourceQuantity"]')?.value,
          unit: item.unit,
        };
      });
      const replacementProductId = values.get("replacementProductId");
      const replacement = data.componentProducts?.find((product) => product.productId === replacementProductId);
      if (!replacement) throw new Error("Choose an active replacement product.");
      body = {
        sourceItems,
        replacementProductId,
        replacementQuantity: values.get("replacementQuantity"),
        replacementUnit: replacement.unit,
        reason: values.get("reason"),
      };
    } else if (action === "substitution-decision") {
      const decision = event.submitter?.value;
      if (!["approve", "reject"].includes(decision)) throw new Error("Choose approve or reject.");
      path = `/runs/${encodeURIComponent(form.dataset.targetRunId)}/substitutions/${encodeURIComponent(form.dataset.targetEventId)}/decision`;
      body = { decision };
      if (decision === "reject") body.reason = values.get("reason");
    } else if (action === "substitution-correction") {
      path = `/runs/${encodeURIComponent(run.id)}/substitutions/${encodeURIComponent(form.dataset.targetSubstitutionId)}/corrections`;
      let sourceItems;
      try {
        sourceItems = JSON.parse(values.get("sourceItems"));
      } catch {
        throw new Error("The saved source components could not be read. Refresh and try again.");
      }
      const replacementProductId = values.get("replacementProductId");
      const replacement = data.componentProducts?.find((product) => product.productId === replacementProductId);
      if (!replacement) throw new Error("Choose an active replacement product.");
      body = {
        sourceItems,
        replacementProductId,
        replacementQuantity: values.get("replacementQuantity"),
        replacementUnit: replacement.unit,
        reason: values.get("reason"),
      };
    } else if (action === "ingredient-link") {
      path = "/ingredient-links";
      body = {
        productId: values.get("productId"),
        ingredientCode: values.get("ingredientCode") || null,
      };
    } else if (action === "weight-setting" || action === "brix-setting") {
      path = "/settings";
      let stationKey = null;
      let subjectCode = data?.run?.setupSnapshot?.productCode;
      let unit = "°Bx";
      if (action === "weight-setting") {
        const item = selectedItem(form);
        stationKey = item.stationKey;
        subjectCode = item.productCode;
        unit = item.unit;
      }
      body = {
        settingType: action === "weight-setting" ? "weight-override" : "brix",
        subjectCode,
        stationKey,
        target: values.get("target"),
        tolerance: values.get("tolerance") || "",
        unit,
        sourceReference: values.get("sourceReference"),
      };
    } else if (action === "signoff") {
      body = { eventType: "review-signed-off" };
    } else if (action === "cleaning-verify") {
      path = `/runs/${encodeURIComponent(form.dataset.targetRunId)}/events`;
      body = { eventType: "cleaning-verified", targetEventId: form.dataset.targetEventId };
    } else if (action === "correction") {
      path = `/runs/${encodeURIComponent(form.dataset.targetRunId)}/events`;
      body = {
        eventType: "correction",
        targetEventId: form.dataset.targetEventId,
        correctedText: values.get("correctedText"),
        reason: values.get("reason"),
      };
    } else if (action === "redaction") {
      path = `/runs/${encodeURIComponent(form.dataset.targetRunId)}/events`;
      body = {
        eventType: "redaction",
        targetEventId: form.dataset.targetEventId,
        reason: values.get("reason"),
      };
    } else if (action === "setting-redaction") {
      path = "/settings/redactions";
      body = {
        eventType: "redaction",
        targetEventId: form.dataset.targetEventId,
        reason: values.get("reason"),
      };
    } else {
      throw new Error("This QC action is not available.");
    }

    const result = await submitRequest(form, `${API}${path}`, body);
    const eventResult = result.event;
    const successMessage = action === "allergen-review"
      ? "Footprint review recorded. Unknown ingredients remain unknown; this is not a clearance."
      : action === "ingredient-link"
        ? "Link recorded. Existing run snapshots do not change."
        : action === "component-check"
          ? "Component observations recorded. This check does not block production."
          : action === "checkpoint"
            ? "Checkpoint observation saved. No safety criterion was evaluated."
            : action === "corrective-action"
              ? "Corrective-action observation saved to QC history."
              : action === "review-flag"
                ? "Review flag saved. Production and shipping remain available."
                : action === "review-flag-review"
                  ? "Manager review added to the flag history."
          : action === "substitution-propose"
            ? "Proposal recorded. Stock changes only after QC manager approval."
            : action === "substitution-decision"
              ? body.decision === "approve"
                ? "Approved. Replacement stock was adjusted with the QC record."
                : "Proposal rejected. Inventory was not changed."
              : action === "substitution-correction"
                ? "Correction recorded with a compensating stock movement."
        : eventResult?.payload?.result === "not_evaluated"
          ? "Saved. This reading is not evaluated because no approved target is available."
          : "Saved to the facility QC history.";
    if (form.matches("[data-qc-reset-on-success]")) form.reset();
    form.querySelectorAll("[data-details]").forEach((details) => { details.open = false; });
    refreshStatus("QC history updated from the server.");
    await load({ quiet: true });
    const currentForm = form.isConnected
      ? form
      : (action === "ingredient-link" ? el.forms.querySelector('form[data-qc-action="ingredient-link"]')
        : (action === "substitution-propose" ? el.forms.querySelector('form[data-qc-action="substitution-propose"]')
          : (action === "substitution-correction" ? el.forms.querySelector('form[data-qc-action="substitution-correction"]') : null)));
    if (currentForm) {
      const details = currentForm.closest("details");
      if (details) details.open = true;
      formStatus(currentForm, successMessage);
    } else {
      refreshStatus(successMessage);
    }
  } catch (error) {
    formStatus(form, error instanceof Error ? error.message : "The QC record was not saved. Retry the same entry.", true);
  }
}

function fmtDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Time unavailable" : date.toLocaleString();
}

function eventSummary(event) {
  const payload = event.payload ?? {};
  if (payload.redacted) return "Record content redacted; audit entry retained.";
  switch (event.eventType) {
    case "lot-recorded":
      return `Lot ${payload.lotCode ?? "—"} · ${payload.productName ?? payload.productCode ?? "ingredient"} · ${payload.stationKey ?? "station"}`;
    case "weight-check":
      return `Weight ${payload.actual ?? "—"} ${payload.unit ?? ""} · ${String(payload.result ?? "not_evaluated").replaceAll("_", " ")}`;
    case "cleaning-recorded":
      return `Cleaning ${payload.method ?? "—"} · completed ${fmtDate(payload.cleanedAt)}`;
    case "cleaning-verified":
      return `Cleaning record ${payload.targetEventId ?? ""} verified by a second staff member.`;
    case "date-code-observed":
      return `Printed text “${payload.observedText ?? ""}” · not evaluated`;
    case "checkpoint-observed":
      return `${payload.checkpointType === "temperature" ? "Temperature" : "Elapsed time"} · ${payload.checkpointLabel ?? "checkpoint"} · ${payload.observedValue ?? "—"} ${payload.unit ?? ""} · not evaluated`;
    case "corrective-action-observed":
      return `Corrective-action observation · ${payload.actionObserved ?? "—"}${payload.followUpNote ? ` · Follow-up: ${payload.followUpNote}` : ""}`;
    case "review-flag-raised":
      return `Needs review · ${payload.targetType === "lot" ? "lot record" : "run"} · ${payload.reason ?? "reason not recorded"}`;
    case "review-flag-reviewed":
      return `Manager review recorded · ${payload.reviewNote ?? "—"}`;
    case "brix-check":
      return `Brix ${payload.actual ?? "—"} °Bx · ${String(payload.result ?? "not_evaluated").replaceAll("_", " ")}`;
    case "run-check-reviewed":
      if (payload.checkType === "allergen-footprint") {
        const listed = Array.isArray(payload.allergens) && payload.allergens.length
          ? payload.allergens.join(", ")
          : "none of the nine tracked allergens";
        return payload.result === "reviewed"
          ? `Allergen footprint reviewed · ${listed}`
          : `Allergen footprint not evaluated · ${payload.unknownCount ?? "some"} ingredient identities or facts unknown`;
      }
      if (payload.checkType === "component-presence") {
        return `Component identity and presence recorded · ${payload.observations?.length ?? 0} components checked`;
      }
      return "Run checklist reviewed.";
    case "run-substitution-proposed":
      return `Substitution proposed · ${payload.sourceItems?.length ?? 1} source components to ${payload.replacementQuantity ?? "—"} ${payload.replacementUnit ?? ""} ${payload.replacementProductName ?? "replacement"}`;
    case "run-substitution-approved":
      return `Substitution approved · ${payload.replacementQuantity ?? "—"} ${payload.replacementUnit ?? ""} ${payload.replacementProductName ?? "replacement"} posted to inventory`;
    case "run-substitution-rejected":
      return `Substitution rejected · ${payload.reason ?? "reason recorded"}`;
    case "run-substitution-corrected":
      return `Substitution corrected · compensating inventory movement recorded · ${payload.reason ?? ""}`;
    case "review-signed-off":
      return "Run QC review signed off.";
    case "correction":
      return `Correction: ${payload.correctedText ?? "—"} · ${payload.reason ?? ""}`;
    case "redaction":
      return `A prior record was redacted: ${payload.reason ?? ""}`;
    default:
      return event.eventType.replaceAll("-", " ");
  }
}

function referenceEventLabel(event) {
  if (event.eventType === "checkpoint-observed") {
    const kind = event.payload?.checkpointType === "temperature" ? "Temperature" : "Time";
    return `${kind} · ${event.payload?.stationKey ?? "station"} · ${event.payload?.checkpointLabel ?? "checkpoint"}`;
  }
  if (event.eventType === "review-flag-raised") {
    return `Review flag · ${event.payload?.targetType === "lot" ? "lot" : "run"}`;
  }
  return "QC record";
}

function renderEvent(event, eventPool = data.events, allowActions = true) {
  const payload = event.payload ?? {};
  const safeId = escapeHtml(event.id);
  const substitutionEvent = event.eventType.startsWith("run-substitution-");
  const editable = !payload.redacted && !substitutionEvent
    && !["review-signed-off", "redaction", "correction"].includes(event.eventType);
  const verified = eventPool.some((candidate) =>
    candidate.eventType === "cleaning-verified" && candidate.payload?.targetEventId === event.id);
  const reviewFlagReviewed = eventPool.some((candidate) =>
    candidate.eventType === "review-flag-reviewed" && candidate.payload?.targetEventId === event.id);
  const verifyForm = allowActions && event.eventType === "cleaning-recorded" && !verified && event.actorId !== staff?.userId
    ? `<form data-qc-action="cleaning-verify" data-target-event-id="${safeId}" data-target-run-id="${escapeHtml(event.runId)}">
         <button class="button button-secondary button-small" type="submit" ${writable ? "" : "disabled"}>Verify as a second staff member</button>
         <p data-form-status role="status"></p>
       </form>`
    : "";
  const reviewFlagForm = allowActions && event.eventType === "review-flag-raised"
    && !reviewFlagReviewed && canManage()
    ? `<div class="qc-review-flag-action">
         <form class="qc-inline-form" data-qc-action="review-flag-review" data-target-event-id="${safeId}" data-target-run-id="${escapeHtml(event.runId)}">
           <p class="qc-help">Manager review · advisory only</p>
           <label class="field"><span>Manager review note</span><input name="reviewNote" minlength="3" maxlength="500" required /></label>
           <button class="button button-secondary button-small" type="submit" ${writable ? "" : "disabled"}>Record manager review</button>
           <p data-form-status role="status"></p>
         </form>
       </div>`
    : "";
  const correctionForm = allowActions && editable && event.runId
    ? `<details data-details><summary>Correct this record</summary>
         <form class="qc-inline-form" data-qc-action="correction" data-target-event-id="${safeId}" data-target-run-id="${escapeHtml(event.runId)}">
           <label class="field"><span>Corrected information</span><input name="correctedText" maxlength="500" required /></label>
           <label class="field"><span>Reason</span><input name="reason" minlength="3" maxlength="500" required /></label>
           <button class="button button-secondary button-small" type="submit" ${writable ? "" : "disabled"}>Add correction</button>
           <p data-form-status role="status"></p>
         </form>
       </details>`
    : "";
  const decided = eventPool.some((candidate) =>
    ["run-substitution-approved", "run-substitution-rejected"].includes(candidate.eventType)
    && candidate.payload?.proposalEventId === event.id);
  const substitutionDecision = event.eventType === "run-substitution-proposed"
    && allowActions && data?.run?.status !== "completed" && canManage() && !decided
    ? `<form data-qc-action="substitution-decision" data-target-event-id="${safeId}" data-target-run-id="${escapeHtml(event.runId)}">
         <button class="button button-primary button-small" type="submit" name="decision" value="approve" ${writable ? "" : "disabled"}>Approve and adjust stock</button>
         <p data-form-status role="status"></p>
       </form>
       <details data-details><summary>Reject proposal</summary>
         <form class="qc-inline-form" data-qc-action="substitution-decision" data-target-event-id="${safeId}" data-target-run-id="${escapeHtml(event.runId)}">
           <label class="field"><span>Reason for rejection</span><input name="reason" minlength="3" maxlength="500" required /></label>
           <button class="button button-caution button-small" type="submit" name="decision" value="reject" ${writable ? "" : "disabled"}>Reject proposal</button>
           <p data-form-status role="status"></p>
         </form>
       </details>`
    : "";
  const redactionForm = allowActions && editable && canManage()
    ? `<details data-details><summary>Redact record content</summary>
         <form class="qc-inline-form" data-qc-action="${event.runId ? "redaction" : "setting-redaction"}" data-target-event-id="${safeId}" ${event.runId ? `data-target-run-id="${escapeHtml(event.runId)}"` : ""}>
           <label class="field"><span>Redaction reason</span><input name="reason" minlength="3" maxlength="500" required /></label>
           <button class="button button-caution button-small" type="submit" ${writable ? "" : "disabled"}>Record redaction</button>
           <p data-form-status role="status"></p>
         </form>
       </details>`
    : "";
  return `<li class="qc-event" data-event-id="${safeId}" data-event-type="${escapeHtml(event.eventType)}">
    <div class="qc-event-meta"><span>${escapeHtml(event.eventType.replaceAll("-", " "))}</span><time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(fmtDate(event.occurredAt))}</time></div>
    <p>${escapeHtml(eventSummary(event))}</p>
    <p class="qc-event-actor">Recorded by staff ID ${escapeHtml(event.actorId)}</p>
    ${verifyForm}${reviewFlagForm}${substitutionDecision}${correctionForm}${redactionForm}
  </li>`;
}

function renderForms() {
  const previousValues = new Map();
  el.forms.querySelectorAll("form[data-qc-action]").forEach((form) => {
    const values = {};
    for (const [name, value] of new FormData(form)) values[name] = value;
    previousValues.set(`${form.dataset.qcAction}:${form.dataset.targetEventId ?? ""}`, values);
  });
  const items = runItems();
  const hasItems = items.length > 0;
  const editable = writable ? "" : "disabled";
  const options = itemOptions();
  const weightSetting = hasItems ? settingForWeight(items[0]) : null;
  const brixSetting = settingForBrix();
  const footprint = data?.allergenFootprint;
  const footprintUnknown = Array.isArray(footprint?.unknownIngredients) ? footprint.unknownIngredients : [];
  const footprintNames = Array.isArray(footprint?.allergens) ? footprint.allergens : [];
  const footprintSection = `<section class="qc-card" aria-labelledby="qc-allergen-heading">
      <p class="eyebrow">RUN-SNAPSHOT FACTS · VISIBILITY ONLY</p><h3 id="qc-allergen-heading">Ingredient allergen footprint</h3>
      <p class="qc-help">This derived footprint is separate from the manual run-allergen field. It is not a safety clearance, production hold, or shipping decision.</p>
      ${footprint?.status === "complete"
        ? `<p>${footprintNames.length
          ? `Tracked allergens in reviewed ingredient records: ${footprintNames.map(escapeHtml).join(", ")}.`
          : "No tracked allergens were identified in the reviewed ingredient records."}</p>`
        : "<p><strong>Unknown:</strong> at least one ingredient link or allergen fact is missing or unreviewed. Known entries below do not remove that uncertainty.</p>"}
      ${footprintNames.length ? `<p><strong>Known tracked allergens:</strong> ${footprintNames.map(escapeHtml).join(", ")}</p>` : ""}
      ${footprintUnknown.length
        ? `<div><strong>Unknown ingredient coverage</strong><ul>${footprintUnknown.map((item) =>
          `<li>${escapeHtml(item.productName)} · ${escapeHtml(item.stationKey)} — ${escapeHtml(
            item.reason === "missing-link" ? "no approved ingredient link"
              : item.reason === "allergen-facts-unreviewed" ? "ingredient facts not reviewed"
              : item.reason === "substitution-remaining-quantity-not-final" ? "substitution amounts are not final until the run is complete"
                : "ingredient facts unavailable",
          )}</li>`,
        ).join("")}</ul></div>`
        : ""}
      <form data-qc-action="allergen-review">
        <button class="button button-secondary" type="submit" ${editable}>Record that I reviewed this footprint</button>
        <p data-form-status role="status"></p>
      </form>
    </section>`;
  const ingredientLinkData = data?.ingredientLinks;
  const productOptions = Array.isArray(ingredientLinkData?.products)
    ? ingredientLinkData.products.map((product) =>
      `<option value="${escapeHtml(product.productId)}" data-ingredient-code="${escapeHtml(product.ingredientCode ?? "")}">${escapeHtml(product.productName)} · ${escapeHtml(product.productCode)}${product.ingredientCode ? ` · linked to ${escapeHtml(product.ingredientName)}` : " · unlinked"}</option>`,
    ).join("")
    : "";
  const ingredientOptions = Array.isArray(ingredientLinkData?.ingredients)
    ? ingredientLinkData.ingredients.map((ingredient) =>
      `<option value="${escapeHtml(ingredient.ingredientCode)}">${escapeHtml(ingredient.ingredientName)} · ${ingredient.allergensReviewed
        ? `${ingredient.allergens.length ? ingredient.allergens.map(escapeHtml).join(", ") : "reviewed empty"}`
        : "allergen facts unreviewed"}</option>`,
    ).join("")
    : "";
  const linkEvents = Array.isArray(ingredientLinkData?.events) ? ingredientLinkData.events : [];
  const componentProducts = Array.isArray(data?.componentProducts) ? data.componentProducts : [];
  const componentProductOptions = `<option value="" selected disabled>Choose an active inventory product</option>${componentProducts.map((product) =>
    `<option value="${escapeHtml(product.productId)}">${escapeHtml(product.productName)} · ${escapeHtml(product.productCode)} · ${escapeHtml(product.unit)}</option>`,
  ).join("")}`;
  const sourceRowMarkup = (index) => `<div class="qc-substitution-source" data-source-row>
      <label class="field"><span>Original component ${index + 1}</span>
        <select name="sourceItemIndex" required><option value="" selected disabled>Choose a run component</option>${options}</select>
      </label>
      <label class="field"><span>Amount being replaced</span>
        <input name="sourceQuantity" inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?" required />
      </label>
      <button class="button button-secondary button-small" type="button" data-remove-source ${index === 0 ? "hidden" : ""}>Remove source</button>
    </div>`;
  const components = Array.isArray(data?.components) ? data.components : [];
  const events = Array.isArray(data?.events) ? data.events : [];
  const runRecipes = data?.run?.setupSnapshot?.productionPlan?.recipes;
  const stationKeys = [...new Set([
    ...(Array.isArray(runRecipes) ? runRecipes.map((recipe) => recipe?.stationKey) : []),
    ...runItems().map((item) => item.stationKey),
  ].filter((stationKey) => ["dough", "cheese", "pepperoni", "sauce", "frontline"].includes(stationKey)))];
  const stationOptions = stationKeys.map((stationKey) =>
    `<option value="${escapeHtml(stationKey)}">${escapeHtml(stationKey)}</option>`,
  ).join("");
  const checkpointTargets = events.filter((event) =>
    ["checkpoint-observed", "review-flag-raised"].includes(event.eventType) && !event.payload?.redacted);
  const checkpointTargetOptions = checkpointTargets.map((event) =>
    `<option value="${escapeHtml(event.id)}">${escapeHtml(referenceEventLabel(event))} · ${escapeHtml(fmtDate(event.occurredAt))}</option>`,
  ).join("");
  const lotTargets = events.filter((event) => event.eventType === "lot-recorded" && !event.payload?.redacted);
  const lotTargetOptions = lotTargets.map((event) =>
    `<option value="${escapeHtml(event.id)}">${escapeHtml(String(event.payload?.lotCode ?? "Lot record").slice(0, 32))} · ${escapeHtml(event.payload?.productCode ?? "Product")} · ${escapeHtml(fmtDate(event.occurredAt))}</option>`,
  ).join("");
  const componentRows = components.map((item, index) => `<div class="qc-component-row" data-component-row>
      <div><strong>${escapeHtml(item.productName)}</strong><p class="qc-help">${escapeHtml(item.recipeName)} · ${escapeHtml(item.stationKey)} · ${escapeHtml(item.unit)}${item.substitution ? " · approved replacement" : ""}</p></div>
      <label class="field" for="qc-component-status-${index}"><span>Identity and presence</span>
        <select id="qc-component-status-${index}" name="componentStatus-${index}">
          <option value="not-observed">Not observed</option>
          <option value="present">Present and identity matched</option>
          <option value="missing">Missing</option>
          <option value="identity-mismatch">Different identity observed</option>
        </select>
      </label>
      <label class="field" for="qc-component-observed-${index}"><span>Observed identity if different</span>
        <input id="qc-component-observed-${index}" name="componentObserved-${index}" list="qc-product-identities" placeholder="Choose a product code" />
      </label>
    </div>`).join("");
  const componentSection = `<section class="qc-card" aria-labelledby="qc-components-heading">
      <p class="eyebrow">RUN SNAPSHOT + APPROVED SUBSTITUTIONS · ADVISORY</p><h3 id="qc-components-heading">Component identity and presence</h3>
      <p class="qc-help">Record only whether each component is present and whether its inventory identity matches. This check does not measure quantity or block production.</p>
      ${components.length ? `<form data-qc-action="component-check">
        <datalist id="qc-product-identities">${componentProducts.map((product) =>
          `<option value="${escapeHtml(product.productCode)}" label="${escapeHtml(`${product.productName} · ${product.unit}`)}"></option>`,
        ).join("")}</datalist>
        <div class="qc-component-list">${componentRows}</div>
        <button class="button button-primary" type="submit" ${editable}>Record component observations</button><p data-form-status role="status"></p>
      </form>` : "<p class=\"qc-help\">No component identities are available from this run snapshot.</p>"}
    </section>`;
  const substitutions = Array.isArray(data?.substitutions) ? data.substitutions : [];
  const correctionForms = canManage() ? substitutions.map((substitution) => {
    const currentProduct = componentProducts.find((product) =>
      product.productId === substitution.replacementProductId);
    const correctionSources = JSON.stringify((substitution.sourceItems ?? []).map((item) => ({
      productId: item.productId,
      recipeCode: item.recipeCode,
      stationKey: item.stationKey,
      quantity: item.quantity,
      unit: item.unit,
    })));
    const correctionProductOptions = componentProducts.map((product) =>
      `<option value="${escapeHtml(product.productId)}" ${product.productId === substitution.replacementProductId ? "selected" : ""}>${escapeHtml(product.productName)} · ${escapeHtml(product.productCode)} · ${escapeHtml(product.unit)}</option>`,
    ).join("");
    return `<details data-details><summary>Correct substitution ${escapeHtml(substitution.replacementProductName)}</summary>
      <form class="qc-inline-form" data-qc-action="substitution-correction" data-target-substitution-id="${escapeHtml(substitution.id)}">
        <input type="hidden" name="sourceItems" value="${escapeHtml(correctionSources)}" />
        <label class="field"><span>Replacement product</span><select name="replacementProductId" required>${correctionProductOptions}</select></label>
        <label class="field"><span data-replacement-unit-label>Replacement amount (${escapeHtml(currentProduct?.unit ?? substitution.replacementUnit)})</span>
          <input name="replacementQuantity" value="${escapeHtml(substitution.replacementQuantity)}" inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?" required /></label>
        <label class="field"><span>Correction reason</span><input name="reason" minlength="3" maxlength="500" required /></label>
        <button class="button button-secondary button-small" type="submit" ${editable}>Save correction and adjust stock</button>
        <p data-form-status role="status"></p>
      </form>
    </details>`;
  }).join("") : "";
  const substitutionSection = `<section class="qc-card" aria-labelledby="qc-substitution-heading">
      <p class="eyebrow">QC APPROVAL · EXACT INVENTORY UNITS</p><h3 id="qc-substitution-heading">Ingredient substitution</h3>
      <p class="qc-help">A proposal lists every source ingredient and amount, plus one replacement and its exact amount. QC manager approval adjusts stock immediately. Run completion subtracts the replaced source amounts and does not deduct the replacement twice.</p>
      ${data?.run?.status === "completed"
        ? "<p class=\"qc-help\"><strong>This run is complete.</strong> Its saved QC and inventory snapshot cannot be changed.</p>"
        : `<form data-qc-action="substitution-propose" data-qc-reset-on-success>
          <div data-source-rows>${sourceRowMarkup(0)}</div>
          <button class="button button-secondary button-small" type="button" data-add-source ${editable || !hasItems ? "disabled" : ""}>Add another source component</button>
          <label class="field"><span>Replacement product</span><select name="replacementProductId" required>${componentProductOptions}</select></label>
          <label class="field"><span data-replacement-unit-label>Replacement amount (${escapeHtml(componentProducts[0]?.unit ?? "unit")})</span><input name="replacementQuantity" inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?" required /></label>
          <label class="field"><span>Reason for substitution</span><input name="reason" minlength="3" maxlength="500" required /></label>
          <button class="button button-primary" type="submit" ${editable || !hasItems || !componentProducts.length ? "disabled" : ""}>Submit for QC approval</button>
          <p data-form-status role="status"></p>
        </form>`}
      ${data?.run?.status === "completed" ? "" : correctionForms}
      ${!componentProducts.length ? "<p class=\"qc-help\">No active inventory products are available for a replacement.</p>" : ""}
    </section>`;
  const checkpointSection = `<section class="qc-card" aria-labelledby="qc-checkpoint-heading">
      <p class="eyebrow">OBSERVATION ONLY · SOURCE-BOUNDED</p><h3 id="qc-checkpoint-heading">Temperature and time checkpoints</h3>
      <p class="qc-help">Record a run and station observation using an explicit unit. No target, tolerance, pass result, or safety evaluation is configured here.</p>
      ${stationKeys.length ? `<form data-qc-action="checkpoint" data-qc-reset-on-success>
        <label class="field"><span>Observation type</span><select name="checkpointType"><option value="temperature">Temperature</option><option value="time">Elapsed time</option></select></label>
        <label class="field"><span>Production station</span><select name="stationKey" required>${stationOptions}</select></label>
        <label class="field"><span>Checkpoint description</span><input name="checkpointLabel" maxlength="100" required /></label>
        <label class="field"><span>Observed value</span><input name="observedValue" inputmode="decimal" pattern="-?(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?" required /></label>
        <label class="field"><span>Unit</span><select name="unit"><option value="°C">°C</option><option value="°F">°F</option></select></label>
        <label class="field"><span>Optional observation note</span><input name="note" maxlength="500" /></label>
        <button class="button button-primary" type="submit" ${editable}>Record checkpoint</button><p data-form-status role="status"></p>
      </form>` : "<p class=\"qc-help\">No production station is available in this run snapshot.</p>"}
    </section>`;
  const correctiveActionSection = `<section class="qc-card" aria-labelledby="qc-corrective-heading">
      <p class="eyebrow">APPEND-ONLY OBSERVATION</p><h3 id="qc-corrective-heading">Corrective-action observation</h3>
      <p class="qc-help">Describe an action observed in response to a checkpoint or review flag. This does not assert that a hazard was controlled or a production hold was released.</p>
      ${checkpointTargets.length ? `<form data-qc-action="corrective-action" data-qc-reset-on-success>
        <label class="field"><span>Related checkpoint or review flag</span><select name="targetEventId" required>${checkpointTargetOptions}</select></label>
        <label class="field"><span>Action observed</span><input name="actionObserved" minlength="3" maxlength="500" required /></label>
        <label class="field"><span>Optional follow-up note</span><input name="followUpNote" maxlength="500" /></label>
        <button class="button button-primary" type="submit" ${editable}>Record action observation</button><p data-form-status role="status"></p>
      </form>` : "<p class=\"qc-help\">Record a checkpoint or review flag before linking an action observation.</p>"}
    </section>`;
  const reviewFlagSection = `<section class="qc-card" aria-labelledby="qc-review-flag-heading">
      <p class="eyebrow">NEEDS REVIEW · NO HOLD</p><h3 id="qc-review-flag-heading">Flag a run or lot for review</h3>
      <p class="qc-help">Flags request manager attention only. They do not stop production or shipping and are not a compliance or certification decision.</p>
      <form data-qc-action="review-flag" data-qc-reset-on-success>
        <label class="field"><span>Flag scope</span><select name="targetType"><option value="run">This run</option><option value="lot" ${lotTargets.length ? "" : "disabled"}>A recorded lot</option></select></label>
        <label class="field" data-lot-target-field hidden><span>Recorded lot</span><select name="targetEventId"><option value="">Choose a lot record</option>${lotTargetOptions}</select></label>
        <label class="field"><span>Reason</span><input name="reason" minlength="3" maxlength="500" required /></label>
        <button class="button button-primary" type="submit" ${editable}>Flag for manager review</button><p data-form-status role="status"></p>
      </form>
    </section>`;
  const allergenLinkManager = canManageAllergens()
    ? `<section class="qc-card qc-manager-card" aria-labelledby="qc-ingredient-links-heading">
        <p class="eyebrow">MANAGER-REVIEWED LINKS · APPEND-ONLY AUDIT</p><h3 id="qc-ingredient-links-heading">Link run products to ingredient identities</h3>
        <p class="qc-help">Choose an exact product and an existing canonical ingredient identity. This does not edit ingredient facts, combine products, or change any run already created.</p>
        ${ingredientLinkData?.productsTruncated || ingredientLinkData?.ingredientsTruncated
          ? '<p class="qc-help"><strong>List limit reached:</strong> only the first 2,000 matching products or ingredient identities are available here.</p>'
          : ""}
        <form data-qc-action="ingredient-link" data-qc-reset-on-success>
          <label class="field"><span>Inventory product</span><select name="productId" required>${productOptions}</select></label>
          <label class="field"><span>Canonical ingredient identity</span>
            <select name="ingredientCode"><option value="">Unlink this product</option>${ingredientOptions}</select>
          </label>
          <button class="button button-primary" type="submit" ${editable || !productOptions || !ingredientOptions ? "disabled" : ""}>Save reviewed link</button>
          <p data-form-status role="status"></p>
        </form>
        <div class="qc-setting-list"><h4>Recent link changes</h4>
          ${linkEvents.length ? linkEvents.map((event) => `<div class="qc-setting-row">
            <p><strong>${escapeHtml(event.productName)}</strong> · ${event.action === "unlinked"
              ? `unlinked from ${escapeHtml(event.previousIngredientName ?? event.previousIngredientCode ?? "prior identity")}`
              : `linked to ${escapeHtml(event.ingredientName ?? event.ingredientCode)}`}</p>
            <p class="qc-help">${escapeHtml(fmtDate(event.occurredAt))} · staff ID ${escapeHtml(event.actorId)}</p>
          </div>`).join("") : '<p class="qc-help">No ingredient links have been recorded.</p>'}
        </div>
      </section>`
    : "";
  const managerForms = canManage()
    ? `<section class="qc-card qc-manager-card" aria-labelledby="qc-settings-heading">
         <p class="eyebrow">MANAGER REVIEW</p><h3 id="qc-settings-heading">QC target settings</h3>
         <p class="qc-help">Weight target changes are explicit overrides with a source reference. Missing targets stay not evaluated. Brix requires both an approved target and tolerance.</p>
         ${hasItems ? `<form data-qc-action="weight-setting" data-qc-reset-on-success>
           <label class="field"><span>Ingredient and station</span><select name="itemIndex" required>${options}</select></label>
           <label class="field"><span>Reviewed target</span><input name="target" inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?" required /></label>
           <label class="field"><span>Tolerance in selected unit</span><input name="tolerance" inputmode="decimal" placeholder="Default ±0.1" /></label>
           <label class="field"><span>Approved source or review reference</span><input name="sourceReference" maxlength="300" required /></label>
           <p class="field-hint" data-weight-hint></p><button class="button button-primary" type="submit" ${editable}>Save weight override</button><p data-form-status role="status"></p>
         </form>` : "<p class=\"qc-help\">No ingredient identities are available in this run snapshot.</p>"}
         <form data-qc-action="brix-setting" data-qc-reset-on-success>
           <p class="field-hint">${data?.run?.setupSnapshot?.productCode
             ? `Product: ${escapeHtml(data.run.setupSnapshot.productCode)}`
             : "This run has no linked product for Brix settings."}</p>
           <label class="field"><span>Brix target (°Bx)</span><input name="target" inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?" required /></label>
           <label class="field"><span>Explicit tolerance (°Bx)</span><input name="tolerance" inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?" required /></label>
           <label class="field"><span>Approved source or review reference</span><input name="sourceReference" maxlength="300" required /></label>
           <button class="button button-primary" type="submit" ${editable || !data?.run?.setupSnapshot?.productCode ? "disabled" : ""}>Save Brix target</button><p data-form-status role="status"></p>
         </form>
         <div class="qc-setting-list">
           <h4>Current reviewed settings</h4>
           ${data.settings.length ? data.settings.map((setting) => `<div class="qc-setting-row">
             <p><strong>${escapeHtml(setting.settingType === "brix" ? "Brix" : setting.subjectCode)}</strong>
               · ${escapeHtml(setting.target)} ± ${escapeHtml(setting.tolerance ?? "0.1")} ${escapeHtml(setting.unit)}
               ${setting.stationKey ? `· ${escapeHtml(setting.stationKey)}` : ""}</p>
             <p class="qc-help">Source: ${escapeHtml(setting.sourceReference)}</p>
             <details data-details><summary>Redact this setting</summary>
               <form class="qc-inline-form" data-qc-action="setting-redaction" data-target-event-id="${escapeHtml(setting.id)}">
                 <label class="field"><span>Redaction reason</span><input name="reason" minlength="3" maxlength="500" required /></label>
                 <button class="button button-caution button-small" type="submit" ${editable}>Redact setting</button>
                 <p data-form-status role="status"></p>
               </form>
             </details>
           </div>`).join("") : "<p class=\"qc-help\">No reviewed QC settings are active.</p>"}
         </div>
         <form data-qc-action="signoff">
           <button class="button button-secondary" type="submit" ${editable}>Sign off this run’s QC review</button><p data-form-status role="status"></p>
         </form>
       </section>`
    : "";

  el.forms.innerHTML = `${footprintSection}
    ${componentSection}
    ${checkpointSection}
    ${correctiveActionSection}
    ${reviewFlagSection}
    ${substitutionSection}
    ${allergenLinkManager}
    <section class="qc-card" aria-labelledby="qc-lots-heading">
      <p class="eyebrow">RUN-LINKED · APPEND-ONLY</p><h3 id="qc-lots-heading">Ingredient lots</h3>
      ${hasItems ? `<form data-qc-action="lot" data-qc-reset-on-success>
        <label class="field"><span>Ingredient and station</span><select name="itemIndex" required>${options}</select></label>
        <label class="field"><span>Lot code</span><input name="lotCode" maxlength="120" autocomplete="off" required /></label>
        <button class="button button-primary" type="submit" ${editable}>Record lot</button><p data-form-status role="status"></p>
      </form>` : "<p class=\"qc-help\">This run has no canonical ingredient product snapshot for lot selection.</p>"}
    </section>
    <section class="qc-card" aria-labelledby="qc-weight-heading">
      <p class="eyebrow">TARGET-SOURCED · ADVISORY</p><h3 id="qc-weight-heading">Weight check</h3>
      <p class="qc-help">${weightSetting
        ? `Reviewed target ${escapeHtml(weightSetting.target)} ± ${escapeHtml(weightSetting.tolerance ?? "0.1")} ${escapeHtml(weightSetting.unit)}.`
        : "No reviewed target is available for the selected ingredient. Readings will be not evaluated."}</p>
      ${hasItems ? `<form data-qc-action="weight">
        <label class="field"><span>Ingredient and station</span><select name="itemIndex" required>${options}</select></label>
        <label class="field"><span>Actual weight</span><input name="actual" inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?" required /></label>
        <label class="field"><span>Reason if outside target</span><input name="reason" maxlength="500" /></label>
        <p class="field-hint" data-weight-hint></p>
        <button class="button button-primary" type="submit" ${editable}>Record weight</button><p data-form-status role="status"></p>
      </form>` : "<p class=\"qc-help\">No canonical ingredient product snapshot is available for weight checks.</p>"}
    </section>
    <section class="qc-card" aria-labelledby="qc-cleaning-heading">
      <p class="eyebrow">SECOND PERSON REQUIRED</p><h3 id="qc-cleaning-heading">Cleaning record</h3>
      <form data-qc-action="cleaning" data-qc-reset-on-success>
        <label class="field"><span>Cleaning method</span><input name="method" maxlength="120" required /></label>
        <label class="field"><span>Cleaning completion time</span><input name="cleanedAt" type="datetime-local" required /></label>
        <button class="button button-primary" type="submit" ${editable}>Record cleaning</button><p data-form-status role="status"></p>
      </form>
      <p class="qc-help">A different authenticated QC staff member must verify each cleaning record.</p>
    </section>
    <section class="qc-card" aria-labelledby="qc-date-heading">
      <p class="eyebrow">OBSERVATION ONLY</p><h3 id="qc-date-heading">Printed date-code text</h3>
      <form data-qc-action="date-code" data-qc-reset-on-success>
        <label class="field"><span>Enter the literal printed text</span><input name="observedText" maxlength="200" required /></label>
        <button class="button button-primary" type="submit" ${editable}>Record observation</button><p data-form-status role="status"></p>
      </form>
      <p class="qc-help">Not evaluated. No applicable exact-text reference is configured. This is not a calendar-validity or expiry check.</p>
    </section>
    <section class="qc-card" aria-labelledby="qc-brix-heading">
      <p class="eyebrow">EXPLICIT TARGET ONLY · ADVISORY</p><h3 id="qc-brix-heading">Brix reading</h3>
      <p class="qc-help">${brixSetting
        ? `Reviewed target ${escapeHtml(brixSetting.target)} ± ${escapeHtml(brixSetting.tolerance)} °Bx.`
        : "No manager-reviewed target and tolerance are configured. Readings will be not evaluated."}</p>
      <form data-qc-action="brix">
        <label class="field"><span>Actual reading (°Bx)</span><input name="actual" inputmode="decimal" pattern="(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,6})?" required /></label>
        <button class="button button-primary" type="submit" ${editable}>Record Brix</button><p data-form-status role="status"></p>
      </form>
    </section>
    ${managerForms}`;
  el.forms.querySelectorAll("form[data-qc-action]").forEach((form) => form.addEventListener("submit", handleFormSubmit));
  const reviewFlagForm = el.forms.querySelector('form[data-qc-action="review-flag"]');
  const lotTargetField = reviewFlagForm?.querySelector("[data-lot-target-field]");
  const lotTargetSelect = reviewFlagForm?.querySelector('select[name="targetEventId"]');
  reviewFlagForm?.querySelector('select[name="targetType"]')?.addEventListener("change", (event) => {
    const showLot = event.currentTarget.value === "lot";
    if (lotTargetField) lotTargetField.hidden = !showLot;
    if (lotTargetSelect) lotTargetSelect.required = showLot;
  });
  const checkpointTypeSelect = el.forms.querySelector('form[data-qc-action="checkpoint"] select[name="checkpointType"]');
  const checkpointUnitSelect = el.forms.querySelector('form[data-qc-action="checkpoint"] select[name="unit"]');
  checkpointTypeSelect?.addEventListener("change", () => {
    if (!checkpointUnitSelect) return;
    const selectedUnit = checkpointUnitSelect.value;
    const options = checkpointTypeSelect.value === "temperature"
      ? [["°C", "°C"], ["°F", "°F"]]
      : [["min", "minutes"], ["s", "seconds"], ["h", "hours"]];
    checkpointUnitSelect.replaceChildren(...options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    if (options.some(([value]) => value === selectedUnit)) checkpointUnitSelect.value = selectedUnit;
  });
  const sourceRows = el.forms.querySelector("[data-source-rows]");
  const addSourceButton = el.forms.querySelector("[data-add-source]");
  if (sourceRows && addSourceButton) {
    addSourceButton.addEventListener("click", () => {
      const count = sourceRows.querySelectorAll("[data-source-row]").length;
      if (count >= 20) return;
      const template = document.createElement("template");
      template.innerHTML = sourceRowMarkup(count);
      sourceRows.append(template.content);
      sourceRows.querySelectorAll("[data-remove-source]").forEach((button) => {
        button.hidden = sourceRows.querySelectorAll("[data-source-row]").length <= 1;
        button.onclick = () => {
          button.closest("[data-source-row]")?.remove();
          sourceRows.querySelectorAll("[data-source-row]").forEach((row, index) => {
            const label = row.querySelector(".field span");
            if (label) label.textContent = `Original component ${index + 1}`;
          });
          sourceRows.querySelectorAll("[data-remove-source]").forEach((remove) => {
            remove.hidden = sourceRows.querySelectorAll("[data-source-row]").length <= 1;
          });
        };
      });
    });
  }
  for (const form of el.forms.querySelectorAll("form[data-qc-action]")) {
    const values = previousValues.get(`${form.dataset.qcAction}:${form.dataset.targetEventId ?? ""}`);
    if (!values) continue;
    for (const [name, value] of Object.entries(values)) {
      const control = form.elements.namedItem(name);
      if (control && control.type !== "submit") control.value = value;
    }
  }
  checkpointTypeSelect?.dispatchEvent(new Event("change"));
  const restoredReviewFlagType = reviewFlagForm?.querySelector('select[name="targetType"]')?.value;
  if (lotTargetField && restoredReviewFlagType === "lot") lotTargetField.hidden = false;
  if (lotTargetSelect && restoredReviewFlagType === "lot") lotTargetSelect.required = true;
  const productSelect = el.forms.querySelector('form[data-qc-action="ingredient-link"] select[name="productId"]');
  const ingredientSelect = el.forms.querySelector('form[data-qc-action="ingredient-link"] select[name="ingredientCode"]');
  if (productSelect && ingredientSelect) {
    const updateLinkedIdentity = () => {
      ingredientSelect.value = productSelect.selectedOptions[0]?.dataset.ingredientCode ?? "";
    };
    productSelect.addEventListener("change", updateLinkedIdentity);
    updateLinkedIdentity();
  }
  el.forms.querySelectorAll('form[data-qc-action="substitution-propose"], form[data-qc-action="substitution-correction"]')
    .forEach((form) => {
      const select = form.querySelector('select[name="replacementProductId"]');
      const label = form.querySelector("[data-replacement-unit-label]");
      const updateUnitLabel = () => {
        const product = componentProducts.find((candidate) => candidate.productId === select?.value);
        if (label && product) label.textContent = `Replacement amount (${product.unit})`;
      };
      select?.addEventListener("change", updateUnitLabel);
      updateUnitLabel();
    });
  el.forms.querySelectorAll('select[name="itemIndex"]').forEach((select) => {
    const form = select.form;
    const item = runItems()[Number(select.value)];
    const setting = item ? settingForWeight(item) : null;
    const hint = form?.querySelector("[data-weight-hint]");
    if (!hint) return;
    if (form.dataset.qcAction === "weight-setting") {
      hint.textContent = item ? `Target unit: ${item.unit}.` : "";
    } else {
      hint.textContent = setting
        ? `Reviewed target ${setting.target} ± ${setting.tolerance ?? "0.1"} ${setting.unit}.`
        : "No reviewed target is available for this ingredient. This reading will be not evaluated.";
    }
  });
  el.forms.querySelectorAll('select[name="itemIndex"]').forEach((select) => {
    if (select.form?.dataset.qcAction === "weight") {
      select.addEventListener("change", () => {
        const item = runItems()[Number(select.value)];
        const setting = item ? settingForWeight(item) : null;
        const hint = select.form.querySelector("[data-weight-hint]");
        if (hint) hint.textContent = setting
          ? `Reviewed target ${setting.target} ± ${setting.tolerance ?? "0.1"} ${setting.unit}.`
          : "No reviewed target is available for the selected ingredient. This reading will be not evaluated.";
      });
    }
  });
}

function render() {
  if (!data || !run || !staff) return;
  el.review.textContent = data.review?.status === "signed-off" ? "Signed off" : "Review open";
  el.review.dataset.state = data.review?.status === "signed-off" ? "complete" : "open";
  el.export.hidden = !canManage();
  const fingerprint = JSON.stringify({
    events: data.events,
    settings: data.settings,
    ingredientLinks: data.ingredientLinks,
    allergenFootprint: data.allergenFootprint,
    substitutions: data.substitutions,
    components: data.components,
    componentProducts: data.componentProducts,
    runStatus: data.run?.status,
  });
  if (fingerprint !== renderedSettingsFingerprint || el.forms.childElementCount === 0) {
    renderForms();
    renderedSettingsFingerprint = fingerprint;
  }
  const events = Array.isArray(data.events) ? data.events : [];
  const runEventsFingerprint = JSON.stringify(events);
  if (runEventsFingerprint !== renderedRunEventsFingerprint) {
    el.history.innerHTML = events.length
      ? events.map((event) => renderEvent(event, events)).join("")
      : "<li class=\"qc-empty\">No QC records exist for this run.</li>";
    el.history.querySelectorAll("form[data-qc-action]").forEach((form) => form.addEventListener("submit", handleFormSubmit));
    renderedRunEventsFingerprint = runEventsFingerprint;
  }
  const facilityEventsFingerprint = JSON.stringify(facilityEvents);
  if (facilityEventsFingerprint !== renderedFacilityEventsFingerprint) {
    el.facilityHistory.innerHTML = facilityEvents.length
      ? facilityEvents.map((event) => renderEvent(event, facilityEvents, false)).join("")
      : "<li class=\"qc-empty\">No QC records exist for this facility.</li>";
    el.facilityHistory.querySelectorAll("form[data-qc-action]").forEach((form) => form.addEventListener("submit", handleFormSubmit));
    renderedFacilityEventsFingerprint = facilityEventsFingerprint;
  }
}

async function load({ quiet = false } = {}) {
  if (!canRecord() || !run || loadInFlight || navigator.onLine === false) return false;
  loadInFlight = true;
  const generation = requestGeneration;
  if (!quiet) refreshStatus("Loading QC history from the server.");
  try {
    const response = await fetch(`${API}/runs/${encodeURIComponent(run.id)}?limit=100`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const body = await readBody(response);
    if (generation !== requestGeneration || !staff || run?.id !== body.run?.id) return false;
    if (!body.run || !Array.isArray(body.items) || !Array.isArray(body.events)
      || !Array.isArray(body.settings) || !Array.isArray(body.substitutions)
      || !Array.isArray(body.components) || !Array.isArray(body.componentProducts) || !body.review) {
      throw new Error("QC history was incomplete. Refresh and try again.");
    }
    const facilityResponse = await fetch(`${API}/history?limit=100`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const facilityBody = await readBody(facilityResponse);
    if (generation !== requestGeneration) return false;
    if (!Array.isArray(facilityBody.events)) {
      throw new Error("Facility QC history is incomplete. Refresh and try again.");
    }
    let ingredientLinks = null;
    if (canManageAllergens()) {
      const linksResponse = await fetch(`${API}/ingredient-links`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      ingredientLinks = await readBody(linksResponse);
      if (!Array.isArray(ingredientLinks.products) || !Array.isArray(ingredientLinks.ingredients)
        || !Array.isArray(ingredientLinks.events)) {
        throw new Error("Ingredient-link history is incomplete. Refresh and try again.");
      }
    }
    data = { ...body, ingredientLinks };
    facilityEvents = facilityBody.events;
    el.error.hidden = true;
    refreshStatus("QC history is current on this device.");
    render();
    return true;
  } catch (error) {
    if (generation !== requestGeneration) return false;
    el.error.textContent = error instanceof Error ? error.message : "QC history could not be loaded. Retry.";
    el.error.hidden = false;
    refreshStatus("QC history is not confirmed by the server.", true);
    return false;
  } finally {
    loadInFlight = false;
  }
}

function clear() {
  requestGeneration += 1;
  staff = null;
  run = null;
  data = null;
  writable = false;
  el.panel.hidden = true;
  el.forms.replaceChildren();
  el.history.replaceChildren();
  el.facilityHistory.replaceChildren();
  renderedSettingsFingerprint = null;
  renderedRunEventsFingerprint = null;
  renderedFacilityEventsFingerprint = null;
  contextCapabilities = "";
  if (timer) window.clearInterval(timer);
  timer = null;
}

export function initializeQc() {
  if (!el.panel) return { updateContext() {}, clear() {} };
  el.refresh.addEventListener("click", () => void load());
  el.export.addEventListener("click", async () => {
    if (!canManage() || !writable) return;
    el.export.disabled = true;
    try {
      const response = await fetch(`${API}/export.csv`, {
        credentials: "same-origin",
        headers: { Accept: "text/csv, application/json" },
      });
      if (!response.ok) await readBody(response);
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = "v2-qc-history.csv";
      link.click();
      URL.revokeObjectURL(href);
      refreshStatus("Facility QC history export downloaded.");
    } catch (error) {
      el.error.textContent = error instanceof Error ? error.message : "The QC export could not be downloaded.";
      el.error.hidden = false;
    } finally {
      el.export.disabled = !writable;
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void load({ quiet: true });
  });
  window.addEventListener("online", () => void load({ quiet: true }));
  timer = window.setInterval(() => {
    if (!document.hidden) void load({ quiet: true });
  }, REFRESH_MS);

  return {
    updateContext(context) {
      const nextStaff = context?.staff ?? null;
      const nextRun = context?.run ?? null;
      const nextStaffId = nextStaff?.userId ?? null;
      const nextRunId = nextRun?.id ?? null;
      const changed = staff?.userId !== nextStaffId || run?.id !== nextRunId;
      const nextCapabilities = JSON.stringify(nextStaff?.capabilities ?? []);
      const accessChanged = contextCapabilities !== nextCapabilities;
      const wasWritable = writable;
      staff = nextStaff;
      run = nextRun;
      contextCapabilities = nextCapabilities;
      writable = context?.writable === true && navigator.onLine !== false;
      el.panel.hidden = !canRecord() || !run;
      el.forms.querySelectorAll("button, input, select").forEach((control) => {
        if (control.closest("[data-qc-action='brix-setting']") && !data?.run?.setupSnapshot?.productCode) {
          control.disabled = true;
        } else {
          control.disabled = !writable;
        }
      });
      el.export.disabled = !writable || !canManage();
      if (changed) {
        requestGeneration += 1;
        data = null;
        facilityEvents = [];
        renderedSettingsFingerprint = null;
        renderedRunEventsFingerprint = null;
        renderedFacilityEventsFingerprint = null;
        el.forms.replaceChildren();
        el.history.replaceChildren();
        el.facilityHistory.replaceChildren();
        if (canRecord() && run) void load();
      } else if (data && (accessChanged || wasWritable !== writable)) {
        const noBrixProduct = typeof data.run?.setupSnapshot?.productCode !== "string";
        el.forms.querySelectorAll("button, input, select").forEach((control) => {
          control.disabled = !writable
            || (control.closest('form[data-qc-action="brix-setting"]') !== null && noBrixProduct);
        });
        render();
      }
      if (!writable && canRecord() && run) {
        refreshStatus("Read-only. QC history may be out of date until the server refreshes.");
      }
    },
    clear,
  };
}
