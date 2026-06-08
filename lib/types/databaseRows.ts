import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './database-generated'

export type PublicSchema = Database['public']
export type PublicTableName = keyof PublicSchema['Tables']
export type PublicFunctionName = keyof PublicSchema['Functions']

export type TableRow<TableName extends PublicTableName> = PublicSchema['Tables'][TableName]['Row']
export type TableInsert<TableName extends PublicTableName> = PublicSchema['Tables'][TableName]['Insert']
export type TableUpdate<TableName extends PublicTableName> = PublicSchema['Tables'][TableName]['Update']
export type FunctionArgs<FunctionName extends PublicFunctionName> = PublicSchema['Functions'][FunctionName]['Args']
export type FunctionReturns<FunctionName extends PublicFunctionName> = PublicSchema['Functions'][FunctionName]['Returns']

export type PublicSupabaseClient = SupabaseClient<Database, 'public'>
export type JsonObject = { [key: string]: Json | undefined }

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toJsonObject(value: unknown): JsonObject {
  return isJsonObject(value) ? (value as JsonObject) : {}
}
