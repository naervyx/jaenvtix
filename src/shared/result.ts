export interface OkResult<T> {
    ok: true;
    value: T;
}

export interface ErrResult<E> {
    ok: false;
    error: E;
}

export type Result<T, E> = OkResult<T> | ErrResult<E>;

export function ok<T>(value: T): OkResult<T> {
    return { ok: true, value };
}

export function err<E>(error: E): ErrResult<E> {
    return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is OkResult<T> {
    return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is ErrResult<E> {
    return !result.ok;
}

export function map<T, E, U>(result: Result<T, E>, mapper: (value: T) => U): Result<U, E> {
    return result.ok ? ok(mapper(result.value)) : result;
}

export function mapError<T, E, F>(result: Result<T, E>, mapper: (error: E) => F): Result<T, F> {
    return result.ok ? result : err(mapper(result.error));
}

export async function fromPromise<T, E>(promise: Promise<T>, onError: (error: unknown) => E): Promise<Result<T, E>> {
    try {
        const value = await promise;

        return ok(value);
    } catch (error) {
        return err(onError(error));
    }
}
