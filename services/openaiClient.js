'use strict';

/**
 * @deprecated Use services/ai/openaiResponsesClient.js (Official OpenAI SDK + Responses API).
 */
const { generateArticleStructured } = require('./ai/openaiResponsesClient');
const { blogAiConfig } = require('../config/blogAiConfig');

module.exports = {
  chatCompletion: async () => {
    throw new Error('Legacy chatCompletion removed. Use blogArticleAiService / OpenAI Responses API.');
  },
  DEFAULT_MODEL: blogAiConfig.model,
  generateArticleStructured,
};