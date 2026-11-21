const PREVIEW_DATABASE = "v2_agent_preview";

export const AGENT_PREVIEW_USERNAME = "agent-preview-manager";
export const AGENT_PREVIEW_PASSWORD = "v2-agent-preview-only";

export class AgentPreviewConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentPreviewConfigError";
    this.code = code;
  }
}

function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function assertAgentPreviewTarget(env, connectionString) {
  if (env.V2_AGENT_TEST_PREVIEW !== "true") return false;
  if (env.NODE_ENV !== "development") {
    throw new AgentPreviewConfigError(
      "V2_AGENT_PREVIEW_ENVIRONMENT",
      "The V2 agent test preview is available only in development.",
    );
  }
  if (env.V2_USE_PROJECT_DATABASE === "true") {
    throw new AgentPreviewConfigError(
      "V2_AGENT_PREVIEW_PROJECT_DATABASE",
      "The V2 agent test preview cannot use the project database.",
    );
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new AgentPreviewConfigError(
      "V2_AGENT_PREVIEW_DATABASE_INVALID",
      "The V2 agent test preview requires its own loopback PostgreSQL database.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !isLoopbackHost(parsed.hostname)
    || parsed.pathname !== `/${PREVIEW_DATABASE}`
    || !parsed.port
    || parsed.search
    || parsed.hash
    || parsed.password
  ) {
    throw new AgentPreviewConfigError(
      "V2_AGENT_PREVIEW_DATABASE_UNSAFE",
      "The V2 agent test preview requires its own loopback PostgreSQL database.",
    );
  }

  if (typeof env.DATABASE_URL === "string" && env.DATABASE_URL.length > 0) {
    try {
      const projectTarget = new URL(env.DATABASE_URL);
      if (
        projectTarget.hostname === parsed.hostname
        && projectTarget.port === parsed.port
        && projectTarget.pathname === parsed.pathname
      ) {
        throw new AgentPreviewConfigError(
          "V2_AGENT_PREVIEW_PROJECT_DATABASE",
          "The V2 agent test preview cannot use the project database.",
        );
      }
    } catch (error) {
      if (error instanceof AgentPreviewConfigError) throw error;
    }
  }
  return true;
}
