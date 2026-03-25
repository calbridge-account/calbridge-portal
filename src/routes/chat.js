const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { buildChatContext } = require('../services/chatContextService');

const MAX_HISTORY = 10; // keep last 10 message pairs

/**
 * POST /chat
 * Send a message to the AI assistant.
 * Body: { message: string }
 * Returns: { reply: string }
 */
router.post('/', requireAuth, async (req, res, next) => {
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'Chat not configured' });
  }

  const { message } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const { OpenAI } = require('openai');
    const openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY
    });

    // Build data context from Snowflake
    const dataContext = await buildChatContext(req.session.clientId);

    // System prompt
    const systemPrompt = `You are the Calbridge portal assistant — a helpful, concise AI that helps Amazon sellers understand their advertising and contribution margin data.

You have read-only access to this client's performance data. You CANNOT make any changes to campaigns, bids, budgets, or any Amazon settings. If asked to make changes, politely explain you can only provide analysis and recommendations.

Here is the client's current performance data:
${dataContext}

Guidelines:
- Be concise and actionable. Lead with the insight, then explain.
- Use dollar amounts, percentages, and concrete numbers when discussing data.
- If you don't have data for something, say so honestly.
- Do not fabricate metrics. Only reference data provided above.
- Keep responses focused on advertising performance, contribution margin, and Amazon selling.
- Format responses clearly — use bullet points or short paragraphs.`;

    // Session conversation history (initialized if empty)
    if (!req.session.chatHistory) req.session.chatHistory = [];

    // Build messages array for the API call
    const messages = [
      { role: 'system', content: systemPrompt },
      ...req.session.chatHistory,
      { role: 'user', content: message.trim() }
    ];

    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.0-flash-001',
      messages,
      max_tokens: 600,
      temperature: 0.4
    });

    const reply = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

    // Append to history (trim to last MAX_HISTORY pairs = MAX_HISTORY * 2 messages)
    req.session.chatHistory.push(
      { role: 'user', content: message.trim() },
      { role: 'assistant', content: reply }
    );
    if (req.session.chatHistory.length > MAX_HISTORY * 2) {
      req.session.chatHistory = req.session.chatHistory.slice(-MAX_HISTORY * 2);
    }

    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /chat/history
 * Return the current session's conversation history.
 */
router.get('/history', requireAuth, (req, res) => {
  res.json({ history: req.session.chatHistory || [] });
});

/**
 * DELETE /chat/history
 * Clear the conversation history.
 */
router.delete('/history', requireAuth, (req, res) => {
  req.session.chatHistory = [];
  res.json({ message: 'Chat history cleared' });
});

module.exports = router;
