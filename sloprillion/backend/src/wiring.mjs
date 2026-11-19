// Shared setup for handler.mjs and local-server.mjs: load the rounds, pick a
// judge. Kept out of app.mjs so the app stays pure.

// The rounds are whatever src/rounds/index.js lists, in its order. Reading the
// folder instead would also pick up index.js itself and any helper next to it.
export async function loadRounds() {
  const { loadAllRounds } = await import("../../src/rounds/index.js");
  return loadAllRounds();
}

// Used when the judge is off or failed to load. It throws rather than
// returning a verdict: the app treats a thrown judge as "not accepted, nothing
// cached", so a real answer refused while the judge was off is judged properly
// once it is back instead of staying cached as wrong.
export const rejectingJudge = async () => { throw new Error("judge unavailable"); };

async function readApiKey(env) {
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY;
  const name = env.OPENAI_KEY_PARAM;
  if (!name) return undefined;
  const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
  const r = await new SSMClient({}).send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  return r.Parameter?.Value;
}

// Never throws: any failure degrades to a judge that rejects everything.
export async function loadJudge(env = process.env) {
  const provider = env.JUDGE_PROVIDER;
  if (!provider || provider === "off") return rejectingJudge;
  try {
    const { makeJudge } = await import("./judge.mjs");
    const apiKey = provider === "openai" ? await readApiKey(env) : undefined;
    return makeJudge({ provider, model: env.JUDGE_MODEL || undefined, apiKey });
  } catch (e) {
    console.warn("sloprillion: judge unavailable:", e?.message);
    return rejectingJudge;
  }
}

export function appConfig(env = process.env) {
  const cap = Number(env.JUDGE_DAILY_CAP);
  const past = Number(env.PAST_DAYS);
  return {
    ...(env.PAST_DAYS && Number.isFinite(past) && past >= 0 ? { pastDays: past } : {}),
    ...(Number.isFinite(cap) && cap >= 0 && env.JUDGE_DAILY_CAP !== "" && env.JUDGE_DAILY_CAP != null ? { judgeDailyCap: cap } : {}),
    ...(env.STATS_KEY ? { statsKey: env.STATS_KEY } : {}),
  };
}
