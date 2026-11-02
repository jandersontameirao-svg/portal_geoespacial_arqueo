-- Dados exclusivamente sintéticos para validação local descartável.
-- Não usar em homologação ou produção.
INSERT INTO `users` (`id`, `openId`, `name`, `email`, `loginMethod`, `role`, `mfaEnabled`, `mfaSecret`)
VALUES
  (1, 'synthetic-admin', 'Synthetic Admin', 'synthetic-admin@example.test', 'synthetic', 'admin', false, NULL),
  (2, 'synthetic-editor', 'Synthetic Editor', 'synthetic-editor@example.test', 'synthetic', 'editor', false, NULL),
  (3, 'synthetic-client', 'Synthetic Client', 'synthetic-client@example.test', 'synthetic', 'client', false, NULL)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `email` = VALUES(`email`),
  `role` = VALUES(`role`),
  `mfaEnabled` = VALUES(`mfaEnabled`),
  `mfaSecret` = VALUES(`mfaSecret`);
