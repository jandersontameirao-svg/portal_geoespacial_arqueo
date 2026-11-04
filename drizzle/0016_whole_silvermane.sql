CREATE TABLE `atena_chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`autorId` int,
	`autorNome` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `atena_chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `atena_memories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`categoria` enum('custo','processo','preferencia','comercial','tecnico','prazo','modelo_escopo','geral') NOT NULL DEFAULT 'geral',
	`diretriz` text NOT NULL,
	`ativo` boolean NOT NULL DEFAULT true,
	`criadoPorId` int,
	`criadoPorNome` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `atena_memories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `observacoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`descricao` text NOT NULL,
	`categoria` enum('reclamacao','melhoria','bug','caracteristica') NOT NULL,
	`area` varchar(120),
	`imagens` json,
	`status` enum('aberta','em_analise','resolvida') NOT NULL DEFAULT 'aberta',
	`criadoPorId` int,
	`criadoPorNome` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `observacoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `atena_chat_scope_idx` ON `atena_chat_messages` (`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `atena_memories_ativo_idx` ON `atena_memories` (`ativo`);--> statement-breakpoint
CREATE INDEX `observacoes_status_idx` ON `observacoes` (`status`);--> statement-breakpoint
CREATE INDEX `observacoes_autor_idx` ON `observacoes` (`criadoPorId`);--> statement-breakpoint
CREATE INDEX `observacoes_created_idx` ON `observacoes` (`createdAt`);