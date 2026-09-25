// Generated from docs/openapi.json; run npm run sdk:generate.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface EventInput {
  customerId?: string;
  type: string;
  payload: JsonValue;
  idempotencyKey?: string;
}

export interface EventResponse {
  id: string;
  applicationId: string;
  customerId: string;
  type: string;
  payload: JsonValue;
  idempotencyKey: string;
  operational: boolean;
  createdAt: string;
}

export interface SchemaFailure {
  path: string;
  message: string;
}

export interface ErrorResponse {
  error: string;
  retryAfter?: number;
  failures?: SchemaFailure[];
}
