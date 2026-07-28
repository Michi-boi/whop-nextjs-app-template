import { Redis } from "@upstash/redis";

export const redis = Redis.fromEnv();

export function tvNameKey(userId: string) {
  return `tvname:${userId}`;
}
