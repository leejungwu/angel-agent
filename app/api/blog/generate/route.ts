export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "유효한 JSON 요청 본문이 필요합니다." },
      { status: 400 },
    );
  }

  const taskId =
    typeof body === "object" && body !== null && "taskId" in body
      ? body.taskId
      : undefined;

  if (typeof taskId !== "number" || !Number.isFinite(taskId)) {
    return Response.json(
      { error: "taskId는 유효한 숫자여야 합니다." },
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return Response.json(
      { error: "OPENAI_API_KEY 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, taskId });
}
