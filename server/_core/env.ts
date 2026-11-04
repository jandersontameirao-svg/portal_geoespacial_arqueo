export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // LLM próprio (ex.: OpenAI). Tem precedência sobre o Forge quando definido.
  // OPENAI_API_KEY + (opcional) OPENAI_BASE_URL/LLM_MODEL no .env da VPS.
  llmApiKey: process.env.OPENAI_API_KEY ?? process.env.BUILT_IN_FORGE_API_KEY ?? "",
  llmBaseUrl: process.env.OPENAI_BASE_URL ?? process.env.BUILT_IN_FORGE_API_URL ?? "",
  llmModel: process.env.LLM_MODEL ?? "",
};
