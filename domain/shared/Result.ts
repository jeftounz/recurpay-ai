import type { DomainError } from './DomainError.ts';

export interface Ok<T> {
  readonly isOk: true;
  readonly isErr: false;
  readonly value: T;
}

export interface Err<E extends DomainError = DomainError> {
  readonly isOk: false;
  readonly isErr: true;
  readonly error: E;
}

export type Result<T, E extends DomainError = DomainError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { isOk: true, isErr: false, value };
}

export function err<E extends DomainError = DomainError>(error: E): Err<E> {
  return { isOk: false, isErr: true, error };
}
