// OpenAI provider for the AI layer (AI_PROVIDER=openai, OPENAI_API_KEY).
//
// Same three narrow jobs as the Anthropic path in lib/ai.js, through OpenAI's
// Responses API: structured output against the same JSON schemas, and web
// search for finding a restaurant's menu. Plain fetch, no SDK dependency.
//
// Menu sources arrive as Anthropic-style content blocks (lib/sources.js);
// toOpenAIContent converts them.

const BASE = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
export const openaiModel = () => process.env.OPENAI_MODEL || 'gpt-5';
export const openaiAvailable = () => Boolean(process.env.OPENAI_API_KEY);

/** Reasoning models take an effort setting; others reject the parameter. */
const reasoning = (effort) => (/^(gpt-5|o\d)/.test(openaiModel()) ? { reasoning: { effort } } : {});

/** Anthropic-style content blocks → Responses API input parts. */
export function toOpenAIContent(parts) {
  return parts.map((p) => {
    if (p.type === 'text') return { type: 'input_text', text: p.text };
    if (p.type === 'image') return { type: 'input_image', image_url: `data:${p.source.media_type};base64,${p.source.data}`, detail: 'high' };
    if (p.type === 'document') return { type: 'input_file', filename: 'menu.pdf', file_data: `data:${p.source.media_type};base64,${p.source.data}` };
    throw new Error(`Unsupported content part: ${p.type}`);
  });
}

async function respond(body, AIError) {
  let res;
  try {
    res = await fetch(`${BASE()}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: openaiModel(), store: false, ...body }),
    });
  } catch {
    throw new AIError('AI service error (network).', 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new AIError('The AI key was rejected. Check OPENAI_API_KEY.', 500);
    if (res.status === 429) throw new AIError('The AI service is busy or out of credit. Try again in a moment.', 429);
    if (res.status === 400) throw new AIError(`The AI service rejected the request: ${detail}`, 400);
    throw new AIError(`AI service error (${res.status}).`, 502);
  }
  return data;
}

/** The text the model wrote, or a refusal. */
export function readOutput(data) {
  let text = ''; let refusal = null;
  for (const item of data.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text') text += c.text;
      if (c.type === 'refusal') refusal = c.refusal || 'refused';
    }
  }
  return { text, refusal, truncated: data.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens' };
}

/** Structured output: the model is constrained to `schema` (strict JSON schema). */
export async function openaiStructured({ name, system, content, schema, maxTokens, effort, AIError }) {
  const data = await respond({
    instructions: system,
    input: [{ role: 'user', content: toOpenAIContent(content) }],
    text: { format: { type: 'json_schema', name, schema, strict: true } },
    max_output_tokens: maxTokens,
    ...reasoning(effort),
  }, AIError);
  const { text, refusal, truncated } = readOutput(data);
  if (refusal) throw new AIError('The AI declined to process this input.', 422);
  if (truncated) throw new AIError('This menu is too long to read in one go. Try a single page or section.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError('The AI returned something unreadable. Please try again.');
  }
}

/** Free-text answer with the web search tool enabled. Returns null if search is unavailable. */
export async function openaiWebSearch({ system, question, AIError }) {
  try {
    const data = await respond({
      instructions: system,
      input: question,
      tools: [{ type: 'web_search' }],
      max_output_tokens: 8000,
      ...reasoning('low'),
    }, AIError);
    const { text, refusal } = readOutput(data);
    return refusal ? null : text;
  } catch {
    return null; // e.g. web search not enabled for this key; the caller falls back
  }
}
