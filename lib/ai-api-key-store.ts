import { prisma } from "@/lib/prisma";
import type { AiProvider } from "@/lib/ai-design";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

export type SavedAiApiKeyInfo = {
  hasKey: boolean;
  provider?: AiProvider;
  model?: string | null;
  updatedAt?: Date;
};

export type SavedAiApiKey = {
  provider: AiProvider;
  model?: string | null;
  apiKey: string;
};

export async function getSavedAiApiKeyInfo(
  userId: string,
): Promise<SavedAiApiKeyInfo> {
  const row = await prisma.aiApiKey.findUnique({
    where: { userId },
    select: { provider: true, model: true, updatedAt: true },
  });
  if (!row || !isAiProvider(row.provider)) return { hasKey: false };
  return {
    hasKey: true,
    provider: row.provider,
    model: row.model,
    updatedAt: row.updatedAt,
  };
}

export async function getSavedAiApiKey(
  userId: string,
): Promise<SavedAiApiKey | null> {
  const row = await prisma.aiApiKey.findUnique({
    where: { userId },
    select: { provider: true, model: true, encryptedKey: true },
  });
  if (!row || !isAiProvider(row.provider)) return null;
  return {
    provider: row.provider,
    model: row.model,
    apiKey: decryptSecret(row.encryptedKey, userId),
  };
}

export async function saveAiApiKey({
  userId,
  provider,
  model,
  apiKey,
}: {
  userId: string;
  provider: AiProvider;
  model?: string | null;
  apiKey: string;
}) {
  await prisma.aiApiKey.upsert({
    where: { userId },
    create: {
      userId,
      provider,
      model: model || null,
      encryptedKey: encryptSecret(apiKey, userId),
    },
    update: {
      provider,
      model: model || null,
      encryptedKey: encryptSecret(apiKey, userId),
    },
  });
}

export async function deleteSavedAiApiKey(userId: string) {
  await prisma.aiApiKey.deleteMany({ where: { userId } });
}

export function isAiProvider(provider: unknown): provider is AiProvider {
  return provider === "openai" || provider === "anthropic";
}
