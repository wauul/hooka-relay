# Generated from docs/openapi.json; run npm run sdk:generate.
from typing import NotRequired, TypedDict, Union

JsonValue = Union[None, bool, int, float, str, list["JsonValue"], dict[str, "JsonValue"]]


class EventInput(TypedDict):
    type: str
    payload: JsonValue
    idempotencyKey: NotRequired[str]


class EventResponse(TypedDict):
    id: str
    applicationId: str
    type: str
    payload: JsonValue
    idempotencyKey: str
    operational: bool
    createdAt: str


class SchemaFailure(TypedDict):
    path: str
    message: str


class ErrorResponse(TypedDict):
    error: str
    retryAfter: NotRequired[int]
    failures: NotRequired[list[SchemaFailure]]
