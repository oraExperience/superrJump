
// Vision AI Configuration
// Control which vision models are enabled for question extraction

module.exports = {
  // Enable/disable specific vision models
  models: {
    openrouter: {
      enabled: true,  // ✅ Primary vision model via OpenRouter
      
      // CHANGE MODEL HERE - Available OpenRouter Vision Models:
      // 'google/gemini-2.0-flash-exp:free' - 🚀 TESTING: Latest Gemini, FREE tier!
      // 'google/gemini-flash-1.5'        - Stable cheap, $0.075/$0.30 per 1M (~$0.002 per 4 pages)
      // 'openai/gpt-4o-mini'             - Tested: $0.15/$0.60 per 1M (~$0.024 per 4 pages)
      // 'anthropic/claude-3-haiku'       - Fast & cheap, $0.25/$1.25 per 1M (~$0.007 per 4 pages)
      // 'anthropic/claude-3-5-sonnet'    - High quality, $3/$15 per 1M (~$0.08 per 4 pages)
      // 'anthropic/claude-3-5-haiku'     - Balanced, $0.80/$4 per 1M (~$0.022 per 4 pages)
      
      model: 'openai/gpt-4o-mini',  // FINAL: Proven working, 93% cost savings
      maxTokens: 1000,  // Response limit
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
