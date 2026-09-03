/** Shared error for the exam domain — `status` maps directly to HTTP. */
export class ExamsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}
