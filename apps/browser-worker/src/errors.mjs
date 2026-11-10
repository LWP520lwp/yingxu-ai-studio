export class WorkerError extends Error {
  constructor(status, code, message, submissionUncertain = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.submissionUncertain = submissionUncertain;
  }
}

export function errorBody(error) {
  const known = error instanceof WorkerError;
  return {
    status: known ? error.status : 500,
    body: {
      code: known ? error.code : "WORKER_ERROR",
      message: known ? error.message : "浏览器操作失败，请检查本机窗口或会话状态",
      submissionUncertain: error?.submissionUncertain === true,
    },
  };
}
