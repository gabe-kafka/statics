import { INPUTS, type Fields } from "./design-fields";

export type AiProvider = "openai" | "anthropic";

export type AiDesignRequest = {
  provider: AiProvider;
  model?: string;
  apiKey: string;
  prompt: string;
  fields: Fields;
  E: number;
  I: number;
};

export type AiDesignResult = {
  reply: string;
  fields: Fields;
  E: number;
  I: number;
};

const FIELD_KEYS = INPUTS.map((input) => input.key);

const FIELD_SCHEMA_PROPERTIES = Object.fromEntries(
  FIELD_KEYS.map((key) => [key, { type: "string" }]),
);

const MAX_API_KEY_LENGTH = 8_192;
const MAX_MODEL_LENGTH = 120;
const MAX_PROMPT_LENGTH = 8_000;
const MAX_FIELD_LENGTH = 50_000;
const PROVIDER_TIMEOUT_MS = 30_000;
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]+$/;

const DESIGN_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    E: { type: "number" },
    I: { type: "number" },
    fields: {
      type: "object",
      additionalProperties: false,
      properties: FIELD_SCHEMA_PROPERTIES,
      required: FIELD_KEYS,
    },
  },
  required: ["reply", "E", "I", "fields"],
};

export async function generateDesignUpdate(
  req: AiDesignRequest,
): Promise<AiDesignResult> {
  const provider = validateProvider(req.provider);
  const apiKey = req.apiKey.trim();
  const prompt = req.prompt.trim();

  if (!apiKey) throw new Error("Missing API key.");
  if (apiKey.length > MAX_API_KEY_LENGTH) throw new Error("API key is too long.");
  if (!prompt) throw new Error("Missing prompt.");
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("Prompt is too long.");
  validateFields(req.fields);
  if (!Number.isFinite(req.E) || req.E <= 0) throw new Error("Invalid E.");
  if (!Number.isFinite(req.I) || req.I <= 0) throw new Error("Invalid I.");

  const model = validateModel(
    req.model?.trim() ||
      (provider === "openai" ? "gpt-5.5" : "claude-sonnet-4-6"),
  );
  const input = buildUserInput(req.prompt, req.fields, req.E, req.I);
  let raw: unknown;
  try {
    raw =
      provider === "openai"
        ? await callOpenAi({ apiKey, model, input })
        : await callAnthropic({ apiKey, model, input });
  } catch (err) {
    if (isAbortError(err)) throw new Error("Provider request timed out.");
    throw err;
  }
  return coerceAiDesignResult(raw);
}

export function coerceAiDesignResult(raw: unknown): AiDesignResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI returned an invalid response.");
  }
  const obj = raw as Partial<AiDesignResult>;
  if (typeof obj.reply !== "string") {
    throw new Error("AI response is missing reply.");
  }
  if (!Number.isFinite(obj.E) || obj.E! <= 0) {
    throw new Error("AI response has invalid E.");
  }
  if (!Number.isFinite(obj.I) || obj.I! <= 0) {
    throw new Error("AI response has invalid I.");
  }
  validateFields(obj.fields);

  return {
    reply: obj.reply,
    E: obj.E!,
    I: obj.I!,
    fields: obj.fields,
  };
}

function validateProvider(provider: string): AiProvider {
  if (provider === "openai" || provider === "anthropic") return provider;
  throw new Error("Unsupported provider.");
}

function validateModel(model: string): string {
  if (!model) throw new Error("Missing model.");
  if (model.length > MAX_MODEL_LENGTH) throw new Error("Model name is too long.");
  if (!MODEL_PATTERN.test(model)) throw new Error("Model name is invalid.");
  return model;
}

function validateFields(fields: unknown): asserts fields is Fields {
  if (!fields || typeof fields !== "object") {
    throw new Error("Fields must be an object.");
  }
  const value = fields as Record<string, unknown>;
  for (const key of FIELD_KEYS) {
    if (typeof value[key] !== "string") {
      throw new Error(`Field ${key} must be a string.`);
    }
    if (value[key].length > MAX_FIELD_LENGTH) {
      throw new Error(`Field ${key} is too long.`);
    }
  }
}

function buildUserInput(
  prompt: string,
  fields: Fields,
  E: number,
  I: number,
): string {
  return JSON.stringify(
    {
      instruction: prompt,
      current: { E, I, fields },
      tableFormat: {
        nodes: "(x, y)",
        members: "(i, j) zero-based node indexes",
        loadCases: "(case, label)",
        loadCombinations: "(combo, case, factor)",
        pointLoads: "(node, Fx, Fy, M, case)",
        distLoads: "(member, w_i, w_j, case)",
        fixity: "(node, Rx, Ry, Mz) with 1 restrained and 0 free",
        pointSprings: "(node, Kx, Ky, Km)",
        uniformSprings: "(member, k/in/ft)",
        hinges: "(member, end) where end is i or j",
      },
    },
    null,
    2,
  );
}

const SYSTEM_PROMPT = [
  "You are editing a 2D frame/beam model for the statics web app.",
  "Return only the requested structured output.",
  "Use the app's internal zero-based references for node and member indexes.",
  "Plain-English references like node 1 or member 1 usually mean the user's visible one-based index; convert them to zero-based in the returned table strings.",
  "Preserve existing rows unless the user asks to change or replace them.",
  "Use downward loads as negative Fy, w_i, and w_j.",
  "If the user asks for a single beam length, use nodes (0, 0) and (length, 0) unless context says otherwise.",
  "If the prompt introduces loads and no load case is given, use D.",
  "If load cases are missing, include D and L.",
  "If load combinations are missing, include at least (SERVICE, D, 1).",
  "Return every table field as a newline-separated set of parenthesized rows, or an empty string when there are no rows.",
].join("\n");

async function callOpenAi({
  apiKey,
  model,
  input,
}: {
  apiKey: string;
  model: string;
  input: string;
}): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "statics_design_update",
          strict: true,
          schema: DESIGN_OUTPUT_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) throw providerError("OpenAI", res.status);
  const json = await safeProviderJson(res);
  const text = extractOpenAiText(json);
  return JSON.parse(text);
}

async function callAnthropic({
  apiKey,
  model,
  input,
}: {
  apiKey: string;
  model: string;
  input: string;
}): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: input }],
      output_config: {
        format: {
          type: "json_schema",
          schema: DESIGN_OUTPUT_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) throw providerError("Anthropic", res.status);
  const json = await safeProviderJson(res);
  return JSON.parse(extractAnthropicText(json));
}

function extractOpenAiText(json: unknown): string {
  const outputText = (json as { output_text?: unknown }).output_text;
  if (typeof outputText === "string") return outputText;

  const output = (json as { output?: unknown }).output;
  if (!Array.isArray(output)) throw new Error("OpenAI returned no output.");
  for (const item of output) {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  throw new Error("OpenAI returned no text output.");
}

function extractAnthropicText(json: unknown): string {
  const content = (json as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("Anthropic returned no text output.");
  }
  const text = content.find(
    (part): part is { type: string; text: string } =>
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string",
  )?.text;
  if (typeof text !== "string") {
    throw new Error("Anthropic returned no text output.");
  }
  return text;
}

async function safeProviderJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new Error("Provider returned an invalid response.");
  }
}

function providerError(provider: string, status: number): Error {
  if (status === 401 || status === 403) {
    return new Error(`${provider} rejected the API key or permissions.`);
  }
  if (status === 404) {
    return new Error(`${provider} could not find that model.`);
  }
  if (status === 429) {
    return new Error(`${provider} rate limit or quota was reached.`);
  }
  return new Error(`${provider} request failed (${status}).`);
}

function isAbortError(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  return name === "AbortError" || name === "TimeoutError";
}
