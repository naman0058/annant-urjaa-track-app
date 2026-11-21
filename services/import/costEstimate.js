'use strict';

const { blogAiConfig } = require('../../config/blogAiConfig');

/** Rough $/1M tokens (input/output) — configurable defaults for gpt-4o-mini class models */
const MODEL_RATES = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  default: { in: 0.2, out: 0.8 },
};

function envRateOverride() {
  const inR = parseFloat(process.env.BLOG_IMPORT_RATE_IN_PER_M);
  const outR = parseFloat(process.env.BLOG_IMPORT_RATE_OUT_PER_M);
  if (Number.isFinite(inR) && Number.isFinite(outR) && inR >= 0 && outR >= 0) {
    return { in: inR, out: outR, source: 'env' };
  }
  return null;
}

function ratesForModel(model) {
  const envRates = envRateOverride();
  if (envRates) return envRates;
  const m = String(model || blogAiConfig.model).toLowerCase();
  const base = MODEL_RATES[m] ? { ...MODEL_RATES[m] } : m.includes('mini') ? { ...MODEL_RATES['gpt-4o-mini'] } : { ...MODEL_RATES.default };
  return { ...base, source: 'default_table' };
}

function estimateTokensForPlainChars(charCount) {
  const sourceTokens = Math.ceil(charCount / 4);
  const outputTokens = Math.min(12000, Math.ceil(sourceTokens * 1.2) + 2500);
  const inputTokens = sourceTokens + 1200;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function estimateCostUsd({ inputTokens, outputTokens, model }) {
  const r = ratesForModel(model);
  return (inputTokens / 1e6) * r.in + (outputTokens / 1e6) * r.out;
}

function estimateForFiles(files, model) {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const f of files) {
    const chars = f.estimatedChars || f.size || 2000;
    const est = estimateTokensForPlainChars(chars);
    inputTokens += est.inputTokens;
    outputTokens += est.outputTokens;
  }
  const cost = estimateCostUsd({ inputTokens, outputTokens, model });
  const rates = ratesForModel(model);
  return {
    fileCount: files.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: Math.round(cost * 10000) / 10000,
    model: model || blogAiConfig.model,
    ratesSource: rates.source || 'default_table',
    inputRatePerM: rates.in,
    outputRatePerM: rates.out,
    withinBudget:
      !blogAiConfig.importBudgetUsd || cost <= blogAiConfig.importBudgetUsd,
    budgetUsd: blogAiConfig.importBudgetUsd,
  };
}

function usageToCost(usage, model) {
  if (!usage) return 0;
  const inT = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outT = usage.output_tokens ?? usage.completion_tokens ?? 0;
  return estimateCostUsd({ inputTokens: inT, outputTokens: outT, model });
}

module.exports = {
  estimateForFiles,
  estimateTokensForPlainChars,
  usageToCost,
  ratesForModel,
};