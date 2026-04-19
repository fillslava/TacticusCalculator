import { apiGet, type ApiCredentials } from './client';
import { ApiPlayerResponseSchema, type ApiPlayerResponse } from './types';

export async function getPlayer(creds: ApiCredentials): Promise<ApiPlayerResponse> {
  const raw = await apiGet<unknown>('/api/v1/player', creds);
  return ApiPlayerResponseSchema.parse(raw);
}

export async function getCurrentGuildRaid(creds: ApiCredentials): Promise<unknown> {
  return apiGet<unknown>('/api/v1/guildRaid', creds);
}

export async function getGuildRaidBySeason(
  season: number,
  creds: ApiCredentials,
): Promise<unknown> {
  return apiGet<unknown>(`/api/v1/guildRaid/${season}`, creds);
}
