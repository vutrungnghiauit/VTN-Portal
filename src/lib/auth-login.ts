import { supabase } from "./supabase";

export async function signInWithIdentifier(identifier: string, password: string) {
  if (!supabase) throw new Error("Chưa cấu hình Supabase.");
  const { data, error } = await supabase.functions.invoke("swift-api", {
    body: { action: "login", identifier: identifier.trim(), password },
  });
  if (error) {
    const context = (error as Error & { context?: unknown }).context;
    const response = context instanceof Response
      ? context
      : context && typeof context === "object" && "response" in context && context.response instanceof Response
        ? context.response
        : null;
    if (response) {
      try {
        const payload = await response.clone().json() as { error?: string };
        if (payload.error) throw new Error(payload.error);
      } catch (cause) {
        if (cause instanceof Error && cause.message !== "Unexpected end of JSON input") throw cause;
      }
    }
    const contextMessage = context instanceof Error ? context.message : "";
    if (`${contextMessage} ${error.message}`.toLowerCase().includes("failed to fetch")) {
      throw new Error("Không kết nối được Supabase. Hãy kiểm tra mạng, trạng thái dự án Supabase và Edge Function swift-api đã được triển khai.");
    }
    if (contextMessage) throw new Error(contextMessage);
    if (context && typeof context === "object" && "error" in context && typeof context.error === "string") {
      throw new Error(context.error);
    }
    throw new Error(error.message || "Không thể kết nối dịch vụ đăng nhập.");
  }
  if (data?.error) throw new Error(data.error);
  const session = data?.session as { access_token?: string; refresh_token?: string } | undefined;
  if (!session?.access_token || !session.refresh_token) throw new Error("Không nhận được phiên đăng nhập hợp lệ.");
  const { error: sessionError } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (sessionError) throw sessionError;
}
