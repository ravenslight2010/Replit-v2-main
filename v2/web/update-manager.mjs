const UPDATE_TIMEOUT_MS = 15_000;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function waitForUpdateResult(registration) {
  let timeoutId;
  let onUpdateFound;
  let updateFound = false;
  const result = new Promise((resolve) => {
    const finish = (value) => resolve(value);
    onUpdateFound = () => {
      updateFound = true;
      const worker = registration.installing;
      if (!worker) {
        finish("failed");
        return;
      }
      const inspect = () => {
        if (worker.state === "activated") finish("updated");
        else if (worker.state === "redundant") finish("failed");
      };
      worker.addEventListener("statechange", inspect);
      inspect();
    };
    registration.addEventListener("updatefound", onUpdateFound, { once: true });
    timeoutId = window.setTimeout(() => finish("none"), UPDATE_TIMEOUT_MS);
  });
  return {
    result,
    cleanup() {
      window.clearTimeout(timeoutId);
      registration.removeEventListener("updatefound", onUpdateFound);
    },
    wasFound: () => updateFound,
  };
}

export function initializeUpdateControls({
  documentRef = document,
  navigatorRef = navigator,
  reload = () => window.location.reload(),
  getReloadBlockReason = () => "",
} = {}) {
  const openButton = documentRef.querySelector("#check-updates-button");
  const dialog = documentRef.querySelector("#update-dialog");
  const status = documentRef.querySelector("#update-status");
  const checkButton = documentRef.querySelector("#update-check-again");
  const reloadButton = documentRef.querySelector("#update-reload");
  const closeButton = documentRef.querySelector("#update-close");
  if (!openButton || !dialog || !status || !checkButton || !reloadButton || !closeButton) return;

  let outcome = "idle";
  const dirtyForms = new Set();
  const pendingForms = [];
  let resultMessage = "";

  function getBlockReason() {
    return getReloadBlockReason()
      || (dirtyForms.size ? "A form has unsaved edits. Save or discard them before reloading." : "");
  }

  function updateReloadButton() {
    const reason = getBlockReason();
    reloadButton.disabled = Boolean(reason) || outcome === "checking";
    reloadButton.textContent = outcome === "available" ? "Reload to update" : "Reload page";
    reloadButton.setAttribute("aria-describedby", "update-status");
    status.textContent = outcome === "checking" ? "Checking for an app update…" : resultMessage;
    if (reason && outcome !== "checking") status.textContent += ` ${reason}`;
  }

  function markFormDirty(form) {
    if (!(form instanceof HTMLFormElement)) return;
    dirtyForms.add(form);
    form.dataset.updateDirty = "true";
  }

  function markFormPending(form) {
    if (!(form instanceof HTMLFormElement)) return;
    markFormDirty(form);
    if (!pendingForms.includes(form)) pendingForms.push(form);
  }

  function clearForm(form) {
    dirtyForms.delete(form);
    form?.removeAttribute("data-update-dirty");
    const index = pendingForms.indexOf(form);
    if (index >= 0) pendingForms.splice(index, 1);
  }

  documentRef.addEventListener("input", (event) => markFormDirty(event.target?.closest?.("form")));
  documentRef.addEventListener("change", (event) => markFormDirty(event.target?.closest?.("form")));
  documentRef.addEventListener("submit", (event) => markFormPending(event.target));
  documentRef.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (button?.form && dirtyForms.has(button.form)) markFormPending(button.form);
  }, true);
  documentRef.addEventListener("reset", (event) => {
    const form = event.target;
    window.setTimeout(() => clearForm(form), 0);
  }, true);

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const request = args[0];
    const method = String(args[1]?.method || (request instanceof Request ? request.method : "GET")).toUpperCase();
    if (response.ok && WRITE_METHODS.has(method) && pendingForms.length) {
      clearForm(pendingForms[0]);
    }
    return response;
  };

  function showDialog() {
    if (!dialog.open) dialog.showModal();
    checkButton.focus();
    void checkForUpdate();
  }

  function setResult(nextOutcome, message) {
    outcome = nextOutcome;
    resultMessage = message;
    reloadButton.hidden = false;
    updateReloadButton();
  }

  async function checkForUpdate() {
    outcome = "checking";
    status.textContent = "Checking for an app update…";
    reloadButton.hidden = true;
    reloadButton.disabled = true;
    checkButton.disabled = true;
    try {
      const serviceWorker = navigatorRef.serviceWorker;
      if (!serviceWorker || typeof serviceWorker.getRegistration !== "function") {
        setResult("unavailable", "This browser cannot check for app updates. Updates will not reload this page. Save or finish work, then use your browser’s reload control.");
        return;
      }
      const registration = await serviceWorker.getRegistration("/");
      if (!registration?.active || typeof registration.update !== "function") {
        setResult("unavailable", "The app update service is not ready. Updates will not reload this page. Save or finish work, then use your browser’s reload control.");
        return;
      }
      if (registration.waiting) {
        setResult("available", "An app update is ready. This page will not reload automatically.");
        return;
      }

      const previousActive = registration.active;
      const pendingUpdate = waitForUpdateResult(registration);
      let result;
      try {
        await registration.update();
        if (registration.waiting || (registration.active && registration.active !== previousActive)) {
          result = "updated";
        } else if (pendingUpdate.wasFound() || registration.installing) {
          result = await pendingUpdate.result;
        } else {
          result = "none";
        }
      } finally {
        pendingUpdate.cleanup();
      }
      if (registration.waiting || (registration.active && registration.active !== previousActive)) {
        setResult("available", "An app update is ready. This page will not reload automatically.");
      } else if (result === "failed") {
        setResult("failed", "The update could not be installed. No update is confirmed and this page was not reloaded. Try the check again.");
      } else if (result === "none" && (pendingUpdate.wasFound() || registration.installing)) {
        setResult("failed", "The update is still installing or its check timed out. No reload was requested. Check again when the connection is stable.");
      } else {
        setResult("current", "No new app version is available. This page was not reloaded.");
      }
    } catch {
      setResult("failed", "The update check failed. That does not mean an update is available, and this page was not reloaded. Try again when connected.");
    } finally {
      checkButton.disabled = false;
    }
  }

  openButton.addEventListener("click", showDialog);
  checkButton.addEventListener("click", () => { void checkForUpdate(); });
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll(
      'button:not([disabled]):not([hidden]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (documentRef.activeElement === first || !dialog.contains(documentRef.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (documentRef.activeElement === last || !dialog.contains(documentRef.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });
  reloadButton.addEventListener("click", () => {
    const reason = getBlockReason();
    if (reason) {
      status.textContent = `Reload is paused to protect your work. ${reason}`;
      return;
    }
    reload();
  });
  dialog.addEventListener("close", () => {
    const moreMenu = openButton.closest("details");
    if (moreMenu) moreMenu.open = false;
    window.setTimeout(() => (moreMenu?.querySelector("summary") || openButton).focus(), 0);
  });

  const hasUnsavedWork = () => dirtyForms.size > 0;
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
