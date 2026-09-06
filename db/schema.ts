import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  email: text('email'),
  passwordHash: text('password_hash').notNull(),
  status: text('status').notNull().default('pending'),
  level: text('level').notNull().default('pending'),
  dailySecondsLimit: integer('daily_seconds_limit').notNull().default(0),
  monthlySecondsLimit: integer('monthly_seconds_limit').notNull().default(0),
  dailyTokenLimit: integer('daily_token_limit').notNull().default(0),
  monthlyPriceCents: integer('monthly_price_cents').notNull().default(0),
  storageLimitBytes: integer('storage_limit_bytes').notNull().default(104857600),
  membershipExpiresAt: integer('membership_expires_at'),
  adminNote: text('admin_note').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastLoginAt: integer('last_login_at'),
}, table => [uniqueIndex('idx_users_username').on(table.username), uniqueIndex('idx_users_email').on(table.email), index('idx_users_status').on(table.status)]);

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [index('idx_sessions_user_expires').on(table.userId, table.expiresAt)]);

export const cloudRecords = sqliteTable('cloud_records', {
  id: text('id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  data: text('data').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.id] }), index('idx_cloud_records_user_oldest').on(table.userId, table.updatedAt)]);

export const usageEvents = sqliteTable('usage_events', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  feature: text('feature').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  costMicros: integer('cost_micros').notNull().default(0),
  priceSnapshot: text('price_snapshot').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
}, table => [index('idx_usage_events_user_created').on(table.userId, table.createdAt), index('idx_usage_events_created').on(table.createdAt)]);

export const usageDaily = sqliteTable('usage_daily', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  tokens: integer('tokens').notNull().default(0),
  costMicros: integer('cost_micros').notNull().default(0),
  activeSeconds: integer('active_seconds').notNull().default(0),
  trainingSeconds: integer('training_seconds').notNull().default(0),
  translationSeconds: integer('translation_seconds').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.userId, table.day] }), index('idx_usage_daily_day').on(table.day)]);

export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const priceHistory = sqliteTable('price_history', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  period: text('period').notNull(),
  cacheHitMicrosPerMillion: integer('cache_hit_micros_per_million').notNull(),
  inputMicrosPerMillion: integer('input_micros_per_million').notNull(),
  outputMicrosPerMillion: integer('output_micros_per_million').notNull(),
  effectiveAt: integer('effective_at').notNull(),
  retiredAt: integer('retired_at'),
}, table => [index('idx_price_history_model_effective').on(table.model, table.effectiveAt)]);
