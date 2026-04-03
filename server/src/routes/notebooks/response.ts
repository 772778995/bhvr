export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  message?: string;
};

export type ApiErrorResponse = {
  success: false;
  message: string;
  errorCode: string;
};

export function successResponse<T>(
  data: T,
  message?: string
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    ...(message ? { message } : {}),
  };
}

export function notImplementedResponse(): ApiErrorResponse {
  return {
    success: false,
    message: "功能正在建设中",
    errorCode: "NOT_IMPLEMENTED",
  };
}

export function invalidNotebookIdResponse(): ApiErrorResponse {
  return {
    success: false,
    message: "Invalid notebook id",
    errorCode: "INVALID_NOTEBOOK_ID",
  };
}
