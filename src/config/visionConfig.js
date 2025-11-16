
// Vision AI Configuration
// Control which vision models are enabled for question extraction

module.exports = {
  // Enable/disable specific vision models
  models: {
    openrouter: {
      enabled: true,  // ✅ Primary vision model via OpenRouter
      
      // CHANGE MODEL HERE - Available OpenRouter Vision Models:
      // 'anthropic/claude-3.5-sonnet'    - Best for math, $3/$15 per 1M tokens (current)
      // 'google/gemini-pro-1.5'          - Fast & cheap, $0.50/$1.50 per 1M tokens
      // 'google/gemini-flash-1.5'        - Fastest, $0.075/$0.30 per 1M tokens
      // 'openai/gpt-4o'                  - Good quality, $2.50/$10 per 1M tokens
      // 'anthropic/claude-3-opus'        - Highest quality, $15/$75 per 1M tokens
      // 'meta-llama/llama-3.2-90b-vision' - Open source, $0.50/$0.80 per 1M tokens
      
      model: 'anthropic/claude-3.5-sonnet',  // Current model
      maxTokens: 400,  // Response limit (adjust based on credits)
      priority: 1  // Try first
    },
    openai: {
      enabled: false,  // ❌ Disabled (requires credits)
      model: 'gpt-4o',
      maxTokens: 2000,
      priority: 2
    },
    gemini: {
      enabled: false,  // ❌ Disabled (API not working)
      model: 'gemini-1.5-flash',
      priority: 3
    },
    huggingface: {
      enabled: false,  // ❌ Disabled (API changed)
      model: 'Qwen/Qwen2-VL-7B-Instruct',
      priority: 4
    },
    groq: {
      enabled: false,  // ❌ Disabled (models decommissioned)
      models: ['llama-3.2-11b-vision-preview', 'llama-3.2-90b-vision-preview'],
      priority: 5
    }
  },
  
  // Fallback to text extraction if all vision methods fail
  allowTextFallback: true,
  
  // Get enabled models in priority order
  getEnabledModels() {
    return Object.entries(this.models)
      .filter(([_, config]) => config.enabled)
      .sort((a, b) => a[1].priority - b[1].priority)
      .map(([name, config]) => ({ name, ...config }));
  }
};
