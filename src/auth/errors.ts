export class AuthRequiredError extends Error {
  constructor(message = "Login required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
