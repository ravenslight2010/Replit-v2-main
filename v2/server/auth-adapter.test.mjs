import assert from "node:assert/strict";
import test from "node:test";
import { createAuthAdapter, hashPassword, V2AuthError, verifyPassword } from "./auth-adapter.mjs";

const USER_ID = "71000000-0000-4000-8000-000000000001";
const FACILITY_ID = "71000000-0000-4000-8000-000000000099";
const PASSWORD = "correct horse battery";

function principalRow({
  actorId = USER_ID,
  facilityId = FACILITY_ID,
  username = "ShiftManager",
  role = "manager",
  capabilities = ["manage-staff"],
  csrfHash,
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
} = {}) {
  return {
    actor_id: actorId,
    facility_id: facilityId,
    username,
    role_name: role,
    capabilities,
    csrf_hash: csrfHash,
    expires_at: expiresAt,
  };
}

async function createFixture(t, { maxAttempts = 20, clock = Date.now } = {}) {
  const passwordHash = await hashPassword(PASSWORD);
  const sessions = new Map();
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("find_staff_for_sign_in")) {
      return params[0] === "shiftmanager"
        ? { rows: [{ staff_id: USER_ID, password_hash: passwordHash, disabled: false }] }
        : { rows: [] };
    }
    if (sql.includes("open_staff_session")) {
      const [staffId, tokenHash, csrfHash, expiresAt] = params;
      if (staffId !== USER_ID) return { rows: [{ opened: false }] };
      sessions.set(tokenHash, { csrfHash, expiresAt });
      return { rows: [{ opened: true }] };
    }
    if (sql.includes("resolve_staff_session")) {
      const [tokenHash] = params;
      const session = sessions.get(tokenHash);
      if (!session || new Date(session.expiresAt).valueOf() <= clock()) return { rows: [] };
      return { rows: [principalRow({ csrfHash: session.csrfHash, expiresAt: session.expiresAt })] };
    }
    if (sql.includes("revoke_staff_session")) {
      const [tokenHash] = params;
      const revoked = sessions.delete(tokenHash);
      return { rows: [{ revoked }] };
    }
    throw new Error("Unexpected query");
  };
  const adapter = createAuthAdapter({
    query,
    clock,
    loginLimit: { maxAttempts, windowMs: 60_000 },
  });
  t.after(() => sessions.clear());
  return { adapter, calls, sessions };
}

test("hashes passwords with salted Argon2id and verifies without timing-unsafe equality", async () => {
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);
  assert.match(first, /^argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(PASSWORD, first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword(PASSWORD, "plain-text-password"), false);
  assert.equal(await verifyPassword(PASSWORD, "scrypt$invalid$invalid"), false);
  assert.equal(await verifyPassword(PASSWORD, first.replace("m=19456,t=2,p=1", "m=999999,t=2,p=1")), false);
});

test("bounds concurrent Argon2id password checks under login pressure", async () => {
  const encodedHash = await hashPassword(PASSWORD);
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => verifyPassword(PASSWORD, encodedHash)),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled" && result.value === true).length, 4);
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 429);
});

test("first-manager status is closed without a configured secret and rate-limited when open", async () => {
  let queryCount = 0;
  const query = async () => {
    queryCount += 1;
    return { rows: [{ available: true }] };
  };
  const closed = createAuthAdapter({ query });
  assert.equal(await closed.bootstrapAvailable(), false);
  assert.equal(queryCount, 0);

  const configured = createAuthAdapter({
    query,
    bootstrapSecret: "a".repeat(32),
    bootstrapStatusLimit: { maxAttempts: 1, windowMs: 60_000 },
  });
  assert.equal(await configured.bootstrapAvailable({ clientKey: "bootstrap-client" }), true);
  await assert.rejects(
    configured.bootstrapAvailable({ clientKey: "bootstrap-client" }),
    { name: "V2AuthError", status: 429 },
  );
  assert.equal(queryCount, 1);
});

test("sign-in normalizes username, creates a fresh opaque session, and never sends hashes to the client", async (t) => {
  const { adapter, calls, sessions } = await createFixture(t);
  const result = await adapter.signIn({
    username: "ShiftManager",
    password: PASSWORD,
    clientKey: "trusted-client-key",
  });

  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(result.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.staff.userId, USER_ID);
  assert.equal(result.staff.username, "ShiftManager");
  assert.equal(result.staff.role, "manager");
  assert.deepEqual(result.staff.capabilities, ["manage-staff"]);
  assert.equal(JSON.stringify(result).includes("password_hash"), false);
  assert.equal(calls[0].params[0], "shiftmanager");
  assert.equal(calls[1].params[0], USER_ID);
  assert.match(calls[1].params[1], /^[0-9a-f]{64}$/);
  assert.match(calls[1].params[2], /^[0-9a-f]{64}$/);
  assert.equal(sessions.size, 1);
});

test("unknown usernames and bad passwords return the same safe failure", async (t) => {
  const { adapter } = await createFixture(t);
  await assert.rejects(
    adapter.signIn({ username: "not-a-user", password: PASSWORD, clientKey: "ip-a" }),
    { name: "V2AuthError", status: 401, message: "Invalid username or password." },
  );
  await assert.rejects(
    adapter.signIn({ username: "ShiftManager", password: "incorrect", clientKey: "ip-b" }),
    { name: "V2AuthError", status: 401, message: "Invalid username or password." },
  );
});

test("sign-in input is bounded and rate-limited by client and normalized username", async (t) => {
  let now = 1000;
  const { adapter, calls } = await createFixture(t, { maxAttempts: 1, clock: () => now });
  await assert.rejects(
    adapter.signIn({ username: "ab", password: PASSWORD, clientKey: "ip-a" }),
    { status: 400 },
  );
  await adapter.signIn({ username: "ShiftManager", password: PASSWORD, clientKey: "ip-a" });
  await assert.rejects(
    adapter.signIn({ username: "shiftmanager", password: PASSWORD, clientKey: "ip-a" }),
    { status: 429, retryAfterSeconds: 60 },
  );
  assert.equal(calls.filter((call) => call.sql.includes("find_staff_for_sign_in")).length, 1);

  now += 60_001;
  await adapter.signIn({ username: "ShiftManager", password: PASSWORD, clientKey: "ip-a" });
  assert.equal(calls.filter((call) => call.sql.includes("find_staff_for_sign_in")).length, 2);
});

test("authentication resolves only the hashed cookie and rejects malformed or duplicate cookies", async (t) => {
  const { adapter } = await createFixture(t);
  const signedIn = await adapter.signIn({
    username: "ShiftManager",
    password: PASSWORD,
    clientKey: "ip-a",
  });
  const request = {
    headers: {
      cookie: `theme=dark; v2_session=${signedIn.token}; v2_csrf=${signedIn.csrfToken}`,
    },
  };
  const auth = await adapter.authenticate(request);
  assert.equal(auth.verified, true);
  assert.equal(auth.actorId, USER_ID);
  assert.equal(auth.facilityId, FACILITY_ID);
  assert.deepEqual(auth.capabilities, ["manage-staff"]);
  assert.equal("token" in auth, false);

  assert.equal(await adapter.authenticate({ headers: { cookie: "v2_session=bad" } }), null);
  assert.equal(
    await adapter.authenticate({ headers: { cookie: `v2_session=${signedIn.token}; v2_session=${signedIn.token}` } }),
    null,
  );
});

test("CSRF verification requires the matching readable cookie and request header", async (t) => {
  const { adapter } = await createFixture(t);
  const signedIn = await adapter.signIn({
    username: "ShiftManager",
    password: PASSWORD,
    clientKey: "ip-a",
  });
  const auth = await adapter.authenticate({
    headers: { cookie: `v2_session=${signedIn.token}; v2_csrf=${signedIn.csrfToken}` },
  });
  const cookie = `v2_session=${signedIn.token}; v2_csrf=${signedIn.csrfToken}`;
  assert.equal(await adapter.verifyCsrf({ headers: { cookie, "x-csrf-token": signedIn.csrfToken } }, auth), true);
  assert.equal(await adapter.verifyCsrf({ headers: { cookie, "x-csrf-token": "wrong" } }, auth), false);
  assert.equal(await adapter.verifyCsrf({ headers: { cookie } }, auth), false);
  assert.equal(await adapter.verifyCsrf({ headers: { cookie, "x-csrf-token": signedIn.csrfToken } }, null), false);
});

test("sign-out revokes the session, and run authorization accepts only authenticated run actions", async (t) => {
  const { adapter } = await createFixture(t);
  const signedIn = await adapter.signIn({
    username: "ShiftManager",
    password: PASSWORD,
    clientKey: "ip-a",
  });
  const request = {
    headers: {
      cookie: `v2_session=${signedIn.token}; v2_csrf=${signedIn.csrfToken}`,
      "x-csrf-token": signedIn.csrfToken,
    },
  };
  const auth = await adapter.authenticate(request);
  assert.equal(adapter.authorizeRun({ auth, action: "run.lifecycle.command" }), true);
  assert.equal(adapter.authorizeRun({ auth, action: "station.command" }), true);
  assert.equal(adapter.authorizeRun({ auth, action: "staff.delete" }), false);
  assert.equal(adapter.authorizeRun({ auth: null, action: "run.read" }), false);
  assert.equal(await adapter.signOut(request), true);
  assert.equal(await adapter.authenticate(request), null);
});

test("password recovery hides account existence, hashes codes, and uses a one-time password change", async () => {
  let now = 10_000;
  const calls = [];
  const logs = [];
  const adapter = createAuthAdapter({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("request_staff_password_reset")) return { rows: [{ accepted: params[0] === "shiftmanager" }] };
      if (sql.includes("list_staff_password_reset_requests")) {
        return {
          rows: [{
            request_id: "71000000-0000-4000-8000-000000000010",
            staff_id: USER_ID,
            username: "ShiftManager",
            state: "pending",
            requested_at: new Date(now).toISOString(),
            decided_at: null,
            code_expires_at: null,
          }],
        };
      }
      if (sql.includes("decide_staff_password_reset")) return { rows: [{ outcome: "approved" }] };
      if (sql.includes("reissue_staff_password_reset_code")) return { rows: [{ outcome: "reissued" }] };
      if (sql.includes("complete_staff_password_reset")) return { rows: [{ completed: true }] };
      throw new Error("Unexpected query");
    },
    clock: () => now,
    logger: (entry) => logs.push(entry),
    passwordResetRequestLimit: { maxAttempts: 1, windowMs: 60_000 },
  });

  assert.deepEqual(
    await adapter.requestPasswordReset({ username: "ShiftManager", clientKey: "client-a" }),
    { accepted: true },
  );
  assert.deepEqual(
    await adapter.requestPasswordReset({ username: "MissingAccount", clientKey: "client-b" }),
    { accepted: true },
  );
  assert.equal(calls[0].sql.includes("request_staff_password_reset"), true);
  assert.equal(calls[0].params[0], "shiftmanager");
  await assert.rejects(
    adapter.requestPasswordReset({ username: "shiftmanager", clientKey: "client-a" }),
    { status: 429 },
  );

  const requests = await adapter.listPasswordResetRequests({ actorId: USER_ID });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].state, "pending");
  assert.equal("recoveryCode" in requests[0], false);

  const approved = await adapter.decidePasswordReset({
    actorId: USER_ID,
    requestId: "71000000-0000-4000-8000-000000000010",
    decision: "approve",
    clientKey: "manager-client",
  });
  assert.equal(approved.outcome, "approved");
  assert.match(approved.code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(approved.expiresAt), now + 10 * 60 * 1000);
  const decisionCall = calls.find((call) => call.sql.includes("decide_staff_password_reset"));
  assert.match(decisionCall.params[3], /^[0-9a-f]{64}$/);
  assert.notEqual(decisionCall.params[3], approved.code);
  assert.equal(JSON.stringify(logs).includes(approved.code), false);

  const reissued = await adapter.reissuePasswordResetCode({
    actorId: USER_ID,
    requestId: "71000000-0000-4000-8000-000000000010",
    clientKey: "manager-client",
  });
  assert.equal(reissued.outcome, "reissued");
  assert.notEqual(reissued.code, approved.code);

  await adapter.completePasswordReset({
    username: "ShiftManager",
    code: reissued.code,
    newPassword: "new password is private",
    clientKey: "client-a",
  });
  const completionCall = calls.find((call) => call.sql.includes("complete_staff_password_reset"));
  assert.equal(completionCall.params[0], "shiftmanager");
  assert.match(completionCall.params[1], /^[0-9a-f]{64}$/);
  assert.notEqual(completionCall.params[1], reissued.code);
  assert.equal(await verifyPassword("new password is private", completionCall.params[2]), true);
  assert.equal(JSON.stringify(calls).includes(reissued.code), false);
  assert.equal(JSON.stringify(logs).includes(reissued.code), false);
});

test("staff account history uses a stable bounded cursor and exposes only allowlisted values", async () => {
  const calls = [];
  const occurredAt = "2026-11-16T12:00:00.000Z";
  const eventId = "71000000-0000-4000-8000-000000000010";
  const adapter = createAuthAdapter({
    query: async (sql, params) => {
      calls.push({ sql, params });
      const rows = [
        {
          event_id: eventId,
          actor_id: USER_ID,
          actor_type: "staff",
          actor_username: "ShiftManager",
          target_id: "71000000-0000-4000-8000-000000000002",
          target_username: "ShiftOperator",
          change_type: "updated",
          before_state: { roleName: "operator", disabled: false },
          after_state: { roleName: "manager", disabled: false },
          occurred_at: occurredAt,
          password_hash: "must-not-escape",
          csrf_hash: "must-not-escape",
        },
        {
          event_id: "71000000-0000-4000-8000-000000000011",
          actor_id: null,
          actor_type: "bootstrap",
          actor_username: "First-manager setup",
          target_id: USER_ID,
          target_username: "ShiftManager",
          change_type: "created",
          before_state: null,
          after_state: { roleName: "manager", disabled: false },
          occurred_at: occurredAt,
        },
      ];
      return {
        rows: params[2] === null ? rows : rows.slice(1),
      };
    },
    passwordResetMinimumResponseMs: 0,
  });

  const page = await adapter.listStaffChangeHistory({ actorId: USER_ID, limit: 1 });
  assert.equal(calls[0].sql.includes("list_staff_account_change_history"), true);
  assert.deepEqual(calls[0].params, [USER_ID, 1, null, null]);
  assert.equal(page.events.length, 1);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.nextCursor, { occurredAt, id: eventId });
  assert.deepEqual(page.events[0], {
    id: eventId,
    actorId: USER_ID,
    actorType: "staff",
    actorUsername: "ShiftManager",
    targetId: "71000000-0000-4000-8000-000000000002",
    targetUsername: "ShiftOperator",
    changeType: "updated",
    before: { roleName: "operator", disabled: false },
    after: { roleName: "manager", disabled: false },
    occurredAt,
  });
  assert.equal(JSON.stringify(page).includes("must-not-escape"), false);

  const nextPage = await adapter.listStaffChangeHistory({
    actorId: USER_ID,
    limit: 1,
    before: { occurredAt, id: eventId },
  });
  assert.deepEqual(calls[1].params, [USER_ID, 1, occurredAt, eventId]);
  assert.equal(nextPage.events[0].actorType, "bootstrap");
  assert.equal(nextPage.events[0].actorId, null);
  assert.equal(nextPage.hasMore, false);
  assert.equal(nextPage.nextCursor, null);
});

test("password recovery converts database permission races into a safe forbidden response", async () => {
  const adapter = createAuthAdapter({
    query: async () => {
      throw Object.assign(new Error("database permission detail"), { code: "42501" });
    },
  });
  await assert.rejects(
    adapter.listPasswordResetRequests({ actorId: USER_ID }),
    (error) => error instanceof V2AuthError
      && error.status === 403
      && !error.message.includes("database permission detail"),
  );
});

test("password recovery decisions and completion are rate-limited before database or password work", async () => {
  const calls = [];
  const adapter = createAuthAdapter({
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes("decide_staff_password_reset")) return { rows: [{ outcome: "approved" }] };
      if (sql.includes("complete_staff_password_reset")) return { rows: [{ completed: true }] };
      throw new Error("Unexpected query");
    },
    passwordResetDecisionLimit: { maxAttempts: 1, windowMs: 60_000 },
    passwordResetCompletionLimit: { maxAttempts: 1, windowMs: 60_000 },
    passwordResetMinimumResponseMs: 0,
  });
  const requestId = "71000000-0000-4000-8000-000000000010";
  await adapter.decidePasswordReset({
    actorId: USER_ID, requestId, decision: "approve", clientKey: "manager-client",
  });
  await assert.rejects(
    adapter.reissuePasswordResetCode({ actorId: USER_ID, requestId, clientKey: "manager-client" }),
    { status: 429 },
  );
  assert.equal(calls.filter((sql) => /decide_staff_password_reset|reissue_staff_password_reset_code/u.test(sql)).length, 1);

  const completion = {
    username: "ShiftManager",
    code: "a".repeat(43),
    newPassword: "a new password",
    clientKey: "staff-client",
  };
  await adapter.completePasswordReset(completion);
  await assert.rejects(adapter.completePasswordReset(completion), { status: 429 });
  assert.equal(calls.filter((sql) => sql.includes("complete_staff_password_reset")).length, 1);
});

test("session cookie helpers are HttpOnly and clear the same V2 cookie", (t) => {
  const adapter = createAuthAdapter({ query: async () => ({ rows: [] }) });
  const token = "a".repeat(43);
  const cookie = adapter.sessionCookie(token, { secure: true });
  assert.match(cookie, /^v2_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  const cleared = adapter.clearSessionCookie({ secure: true });
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /Secure/);
  const csrf = adapter.csrfCookie(token, { secure: true });
  assert.match(csrf, /^v2_csrf=/);
  assert.doesNotMatch(csrf, /HttpOnly/);
  assert.match(csrf, /SameSite=Lax/);
  assert.match(csrf, /Secure/);
  const clearedCsrf = adapter.clearCsrfCookie({ secure: true });
  assert.match(clearedCsrf, /Max-Age=0/);
  assert.match(clearedCsrf, /Secure/);
});
