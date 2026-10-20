import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const elevatedRoles = ["super_admin", "system_admin", "sub_admin"];
const assignableRoles = ["system_admin", "sub_admin", "teacher", "assistant", "class_president", "class_vice", "student"];

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Chỉ hỗ trợ POST." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) throw new Error("Thiếu cấu hình Supabase cho Edge Function.");

    const body = await request.json();
    const action = String(body.action ?? "");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    if (action === "login") {
      const identifier = String(body.identifier ?? "").trim();
      const password = String(body.password ?? "");
      if (!identifier || !password) return json({ error: "Tên người dùng/MSSV hoặc mật khẩu không chính xác." }, 401);

      const remoteIp = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${remoteIp}:${identifier.toLowerCase()}`));
      const loginKey = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const { data: mayAttempt, error: rateError } = await admin.rpc("check_account_login_rate", { p_key: loginKey });
      if (rateError) throw rateError;
      if (!mayAttempt) return json({ error: "Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút." }, 429);

      let loginEmail = identifier.includes("@") ? identifier.toLowerCase() : "";
      if (!loginEmail && /^[A-Za-z0-9._-]{1,100}$/.test(identifier)) {
        const { data: profile, error: profileError } = await admin.from("user_profiles").select("user_id").ilike("username", identifier).maybeSingle();
        if (profileError) throw profileError;
        let userId: string | null = profile?.user_id ?? null;
        if (!userId) {
          const codes = [...new Set([identifier, identifier.toUpperCase(), identifier.toLowerCase()])];
          const { data: studentMatches, error: studentError } = await admin.from("students").select("auth_user_id").in("student_code", codes).is("deleted_at", null).not("auth_user_id", "is", null);
          if (studentError) throw studentError;
          const distinctIds = [...new Set((studentMatches ?? []).map((row) => row.auth_user_id).filter(Boolean))];
          if (distinctIds.length === 1) userId = String(distinctIds[0]);
        }
        if (userId) {
          const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
          if (authUserError) throw authUserError;
          loginEmail = authUser.user?.email ?? "";
        }
      }
      if (!loginEmail) return json({ error: "Tên người dùng/MSSV hoặc mật khẩu không chính xác." }, 401);

      const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await authClient.auth.signInWithPassword({ email: loginEmail, password });
      if (error || !data.session) return json({ error: "Tên người dùng/MSSV hoặc mật khẩu không chính xác." }, 401);
      await admin.rpc("clear_account_login_rate", { p_key: loginKey });
      return json({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
    }

    if (action === "register") {
      const { data: settings, error: settingsError } = await admin.rpc("get_registration_settings");
      if (settingsError) throw settingsError;
      if (!settings?.enabled) return json({ error: "Hiện không nhận đăng ký tài khoản mới." }, 403);
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim();
      if (!email || !name || name.length > 120 || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Vui lòng nhập họ tên và email hợp lệ." }, 400);
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: name, role_key: "student" }, redirectTo: request.headers.get("origin") ?? url });
      if (error) throw error;
      return json({ message: settings.approvalRequired ? "Đã gửi email xác nhận. Tài khoản sẽ chờ quản trị viên duyệt." : "Đã gửi email mời đăng ký." });
    }

    const authorization = request.headers.get("Authorization");
    if (!authorization) return json({ error: "Cần đăng nhập." }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Phiên đăng nhập không hợp lệ." }, 401);
    const callerId = authData.user.id;
    const { data: callerRole, error: roleError } = await userClient.rpc("current_role_key");
    if (roleError) throw roleError;
    const isAdmin = elevatedRoles.includes(callerRole);
    const isTeacher = callerRole === "teacher";
    if (!isAdmin && !isTeacher) return json({ error: "Vai trò của bạn không được quản lý tài khoản." }, 403);

    const permissionAction = action === "list" ? "read" : ["create", "invite"].includes(action) ? "create" : ["edit", "delete", "reset-password", "reset-student-password", "approval", "account-status", "access", "role", "link-student"].includes(action) ? (action === "delete" ? "delete" : "update") : null;
    if (!permissionAction) return json({ error: "Thao tác không hợp lệ." }, 400);
    if (callerRole !== "super_admin") {
      const { data: allowed, error: permissionError } = await userClient.rpc("can_access_module", { p_module: "accounts", p_action: permissionAction });
      if (permissionError) throw permissionError;
      if (!allowed) return json({ error: "Bạn chưa được cấp quyền thực hiện thao tác quản lý tài khoản này." }, 403);
    }

    const canManageTarget = async (userId: string, targetRole: string, managerId: string | null) => {
      if (targetRole === "super_admin") return callerRole === "super_admin" && userId === callerId;
      if (isAdmin) {
        if (callerRole !== "super_admin" && elevatedRoles.includes(targetRole)) return false;
        return true;
      }
      if (!isTeacher || !["student", "assistant"].includes(targetRole)) return false;
      if (managerId === callerId) return true;
      const { data: ownedStudent, error } = await admin.from("students").select("id").eq("auth_user_id", userId).eq("owner_id", callerId).is("deleted_at", null).limit(1).maybeSingle();
      if (error) throw error;
      return Boolean(ownedStudent);
    };

    const getTarget = async (userId: string) => {
      const { data, error } = await admin.from("user_profiles").select("user_id,username,display_name,role_key,phone,manager_id").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Không tìm thấy tài khoản.");
      if (!await canManageTarget(userId, data.role_key, data.manager_id)) throw new Error("Bạn không có quyền quản lý tài khoản này.");
      return data;
    };

    if (action === "list") {
      const allProfiles: Array<{ user_id: string; username: string | null; display_name: string; role_key: string; phone: string | null; registration_status: "pending" | "approved" | "rejected"; created_at: string; manager_id: string | null }> = [];
      const allAuthUsers = [];
      const allStudents: Array<{ auth_user_id: string | null; student_code: string; owner_id: string; full_name: string }> = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from("user_profiles").select("user_id,username,display_name,role_key,phone,registration_status,created_at,manager_id").order("created_at", { ascending: false }).range(offset, offset + 999);
        if (error) throw error;
        allProfiles.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      for (let page = 1; ; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        allAuthUsers.push(...(data.users ?? []));
        if (!data.users || data.users.length < 1000) break;
      }
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from("students").select("auth_user_id,student_code,owner_id,full_name").is("deleted_at", null).range(offset, offset + 999);
        if (error) throw error;
        allStudents.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      let visibleProfiles = allProfiles;
      if (isTeacher) {
        const ownedStudentIds = new Set(allStudents.filter((student) => student.owner_id === callerId).map((student) => student.auth_user_id));
        visibleProfiles = allProfiles.filter((profile) => profile.user_id !== callerId && profile.role_key !== "super_admin" &&
          (profile.manager_id === callerId || ownedStudentIds.has(profile.user_id)) && ["student", "assistant"].includes(profile.role_key));
      } else if (callerRole !== "super_admin") {
        visibleProfiles = allProfiles.filter((profile) => profile.role_key !== "super_admin" && !["system_admin", "sub_admin"].includes(profile.role_key));
      }
      const authUsers = new Map(allAuthUsers.map((user) => [user.id, user]));
      const studentByUser = new Map(allStudents.filter((student) => student.auth_user_id).map((student) => [student.auth_user_id, student]));
      const availableStudents = isTeacher
        ? allStudents.filter((student) => student.owner_id === callerId && !student.auth_user_id).map((student) => ({ student_code: student.student_code, full_name: student.full_name }))
        : [];
      return json({ accounts: visibleProfiles.map((profile) => {
        const authUser = authUsers.get(profile.user_id);
        return { ...profile, studentCode: studentByUser.get(profile.user_id)?.student_code ?? null, email: authUser?.email ?? "", lastSignInAt: authUser?.last_sign_in_at ?? null, confirmed: Boolean(authUser?.email_confirmed_at), bannedUntil: authUser?.banned_until ?? null };
      }), availableStudents });
    }

    if (action === "create" || action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim();
      const username = String(body.username ?? "").trim().toLowerCase();
      const role = String(body.role ?? "student");
      const password = "1111";
      const studentCode = String(body.studentCode ?? "").trim();
      if (!/^\S+@\S+\.\S+$/.test(email) || !name || name.length > 120 || !/^[a-z0-9._-]{3,60}$/.test(username)) return json({ error: "Vui lòng kiểm tra họ tên, email và tên đăng nhập (3–60 ký tự)." }, 400);
      if (!assignableRoles.includes(role)) return json({ error: "Vai trò không hợp lệ." }, 400);
      if (callerRole !== "super_admin" && ["system_admin", "sub_admin"].includes(role)) return json({ error: "Chỉ Super Admin mới được cấp vai trò quản trị." }, 403);
      if (isTeacher && !["student", "assistant"].includes(role)) return json({ error: "Giảng viên chỉ được tạo tài khoản sinh viên hoặc trợ giảng." }, 403);
      if (action === "invite") {
        if (!isAdmin) return json({ error: "Chỉ quản trị viên mới được gửi lời mời." }, 403);
        const { data: invitation, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { username, full_name: name, role_key: role }, redirectTo: request.headers.get("origin") ?? url });
        if (error) throw error;
        if (invitation.user) {
          const { error: profileError } = await admin.from("user_profiles").update({ username, display_name: name, role_key: role, registration_status: "approved", updated_at: new Date().toISOString() }).eq("user_id", invitation.user.id);
          if (profileError) throw profileError;
        }
        return json({ message: "Đã gửi email mời tài khoản." });
      }
      
      if (isTeacher && role === "student" && !studentCode) return json({ error: "Giảng viên cần chọn hồ sơ sinh viên được mình phụ trách." }, 400);
      let studentRecord: { id: string; student_code: string; auth_user_id: string | null } | null = null;
      if (studentCode) {
        let query = admin.from("students").select("id,student_code,auth_user_id").ilike("student_code", studentCode).is("deleted_at", null);
        if (isTeacher) query = query.eq("owner_id", callerId);
        const { data, error } = await query.limit(2);
        if (error) throw error;
        if (!data || data.length !== 1) return json({ error: "Không tìm thấy duy nhất một hồ sơ sinh viên trong phạm vi phụ trách." }, 404);
        if (data[0].auth_user_id) return json({ error: "Hồ sơ này đã liên kết với tài khoản đăng nhập." }, 409);
        studentRecord = data[0];
        if (role !== "student") return json({ error: "Chỉ tài khoản sinh viên mới liên kết với hồ sơ sinh viên." }, 400);
      }
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, full_name: name, role_key: role } });
      if (createError) {
        if (/password|weak.?password/i.test(createError.message)) return json({ error: "Supabase Auth từ chối mật khẩu mặc định 1111. Hãy đặt Password minimum length thành 4 trong cấu hình Auth của dự án." }, 400);
        throw createError;
      }
      if (!created.user) throw new Error("Supabase không trả về tài khoản vừa tạo.");
      const userId = created.user.id;
      const { error: profileError } = await admin.from("user_profiles").upsert({ user_id: userId, username, display_name: name, role_key: role, phone: String(body.phone ?? "").trim() || null, manager_id: isTeacher ? callerId : null, registration_status: "approved", updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (profileError) {
        await admin.auth.admin.deleteUser(userId);
        throw profileError;
      }
      if (studentRecord) {
        const { error: linkError } = await admin.from("students").update({ auth_user_id: userId }).eq("id", studentRecord.id).is("auth_user_id", null);
        if (linkError) {
          await admin.auth.admin.deleteUser(userId);
          throw linkError;
        }
      }
      await admin.from("system_audit_logs").insert({ actor_id: callerId, subject_user_id: userId, module_key: "accounts", action: "create_account", source_table: "auth.users", record_id: userId, record_label: `${name} (${username})`, details: { role, manager_id: isTeacher ? callerId : null } }).then(() => undefined).catch((auditError) => console.error("Could not record account creation audit event", auditError));
      return json({ message: "Đã tạo tài khoản và cấp quyền truy cập ngay.", userId, account: { user_id: userId, username, display_name: name, role_key: role, phone: String(body.phone ?? "").trim() || null, registration_status: "approved", created_at: created.user.created_at, email, studentCode: studentRecord?.student_code ?? null, lastSignInAt: null, confirmed: true, bannedUntil: created.user.banned_until ?? null } });
    }

    const userId = String(body.userId ?? "");
    if (!userId) return json({ error: "Thiếu mã tài khoản." }, 400);
    const target = await getTarget(userId);

    // Super Admin accounts are isolated: allow editing only the caller's own profile.
    if (target.role_key === "super_admin" && (userId !== callerId || action !== "edit")) {
      return json({ error: "Super Admin chỉ được chỉnh sửa thông tin tài khoản của chính mình." }, 403);
    }

    if (action === "edit") {
      const name = String(body.name ?? "").trim();
      const username = String(body.username ?? "").trim().toLowerCase();
      const email = String(body.email ?? "").trim().toLowerCase();
      const phone = String(body.phone ?? "").trim() || null;
      const role = body.role === undefined ? target.role_key : String(body.role);
      if (!name || name.length > 120 || !/^[a-z0-9._-]{3,60}$/.test(username) || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Vui lòng kiểm tra họ tên, tên đăng nhập và email." }, 400);
      if ((target.role_key === "super_admin" ? role !== "super_admin" : !assignableRoles.includes(role)) || (callerRole !== "super_admin" && ["system_admin", "sub_admin"].includes(role)) || (isTeacher && !["student", "assistant"].includes(role))) return json({ error: "Vai trò không hợp lệ hoặc vượt quyền quản lý." }, 403);
      if (isTeacher && role !== target.role_key) return json({ error: "Giảng viên không được đổi vai trò tài khoản cấp dưới." }, 403);
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true, user_metadata: { username, full_name: name, role_key: role } });
      if (authUpdateError) throw authUpdateError;
      const { error: profileUpdateError } = await admin.from("user_profiles").update({ username, display_name: name, phone, role_key: role, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (profileUpdateError) throw profileUpdateError;
      await admin.from("system_audit_logs").insert({ actor_id: callerId, subject_user_id: userId, module_key: "accounts", action: "edit_account", source_table: "auth.users", record_id: userId, record_label: `${name} (${username})`, details: { role, email } }).then(() => undefined).catch((auditError) => console.error("Could not record account update audit event", auditError));
      return json({ message: "Đã cập nhật tài khoản." });
    }

    if (action === "delete") {
      const [{ data: ownedRecords, error: ownedError }, { data: managedProfiles, error: managedError }] = await Promise.all([
        admin.from("students").select("id").eq("owner_id", userId).is("deleted_at", null).limit(1),
        admin.from("user_profiles").select("user_id").eq("manager_id", userId).limit(1),
      ]);
      if (ownedError) throw ownedError;
      if (managedError) throw managedError;
      if (ownedRecords?.length) return json({ error: "Tài khoản đang sở hữu hồ sơ sinh viên. Hãy chuyển hồ sơ sang giảng viên khác trước khi xóa." }, 409);
      if (managedProfiles?.length) return json({ error: "Tài khoản đang quản lý tài khoản cấp dưới. Hãy chuyển quyền quản lý trước khi xóa." }, 409);
      const { error: auditError } = await admin.from("system_audit_logs").insert({ actor_id: callerId, subject_user_id: userId, module_key: "accounts", action: "delete_account", source_table: "auth.users", record_id: userId, record_label: `${target.display_name} (${target.username})`, details: { role: target.role_key } });
      if (auditError) console.error("Could not record account deletion audit event", auditError.message);
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) throw deleteError;
      return json({ message: "Đã xóa tài khoản." });
    }

    if (action === "reset-password" || action === "reset-student-password") {
      let studentCode: string | null = null;
      const { data: student, error: studentError } = await admin.from("students").select("student_code").eq("auth_user_id", userId).is("deleted_at", null).maybeSingle();
      if (studentError) throw studentError;
      studentCode = student?.student_code ?? null;
      const suppliedPassword = String(body.password ?? "");
      const password = suppliedPassword || studentCode || (target.username && target.username.length >= 6 ? target.username : `${target.username || "user"}_123`);
      if (!password || password.length < 6 || password.length > 128) return json({ error: "Mật khẩu mặc định ngắn hơn 6 ký tự. Hãy nhập mật khẩu mới có ít nhất 6 ký tự." }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      await admin.from("system_audit_logs").insert({ actor_id: callerId, subject_user_id: userId, module_key: "accounts", action: "reset_password", source_table: "auth.users", record_id: userId, record_label: `${target.display_name} (${target.username})`, details: { method: suppliedPassword ? "custom" : studentCode ? "student_code" : "username" } }).then(() => undefined).catch(() => undefined);
      return json({ message: "Đã đặt lại mật khẩu.", password });
    }

    if (action === "account-status") {
      if (!isAdmin && !isTeacher) return json({ error: "Bạn không có quyền cập nhật trạng thái tài khoản." }, 403);
      const status = String(body.status ?? "");
      if (!["pending", "active", "rejected", "locked"].includes(status)) return json({ error: "Trạng thái tài khoản không hợp lệ." }, 400);
      const registrationStatus = status === "pending" ? "pending" : status === "rejected" ? "rejected" : "approved";
      const { error: profileUpdateError } = await admin.from("user_profiles").update({ registration_status: registrationStatus, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (profileUpdateError) throw profileUpdateError;
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, { ban_duration: status === "rejected" || status === "locked" ? "876000h" : "none" });
      if (authUpdateError) throw authUpdateError;
      return json({ message: "Đã cập nhật trạng thái tài khoản." });
    }
    if (action === "approval") {
      const status = String(body.status ?? "");
      if (!isAdmin || !["approved", "rejected"].includes(status)) return json({ error: "Thao tác duyệt không hợp lệ hoặc vượt quyền." }, 403);
      const { error } = await admin.from("user_profiles").update({ registration_status: status, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (error) throw error;
      if (status === "rejected") await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      return json({ message: status === "approved" ? "Đã duyệt tài khoản." : "Đã từ chối và khóa tài khoản." });
    }

    if (action === "access") {
      const suspended = Boolean(body.suspended);
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: suspended ? "876000h" : "none" });
      if (error) throw error;
      return json({ message: suspended ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản." });
    }

    if (action === "role") {
      if (!isAdmin && !isTeacher) return json({ error: "Bạn không có quyền đổi vai trò tài khoản." }, 403);
      const role = String(body.role ?? "");
      if (!assignableRoles.includes(role) || (callerRole !== "super_admin" && ["system_admin", "sub_admin"].includes(role)) || (isTeacher && !["student", "assistant"].includes(role))) return json({ error: "Vai trò không hợp lệ hoặc vượt quyền quản lý." }, 403);
      const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId);
      if (authUserError) throw authUserError;
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, { user_metadata: { ...authUser.user.user_metadata, role_key: role } });
      if (authUpdateError) throw authUpdateError;
      const { error } = await admin.from("user_profiles").update({ role_key: role, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (error) throw error;
      return json({ message: "Đã cập nhật vai trò." });
    }

    if (action === "link-student") {
      if (!isAdmin) return json({ error: "Chỉ quản trị viên mới được liên kết hồ sơ sinh viên." }, 403);
      if (target.role_key !== "student") return json({ error: "Chỉ tài khoản sinh viên mới liên kết được MSSV." }, 400);
      const studentCode = String(body.studentCode ?? "").trim();
      const { data: matches, error } = await admin.from("students").select("id,auth_user_id").ilike("student_code", studentCode).is("deleted_at", null).limit(2);
      if (error) throw error;
      if (!matches?.length || matches.length !== 1) return json({ error: "Không tìm thấy duy nhất một hồ sơ sinh viên với MSSV này." }, 404);
      if (matches[0].auth_user_id && matches[0].auth_user_id !== userId) return json({ error: "Hồ sơ này đã liên kết với tài khoản khác." }, 409);
      const { error: updateError } = await admin.from("students").update({ auth_user_id: userId }).eq("id", matches[0].id);
      if (updateError) throw updateError;
      return json({ message: `Đã liên kết MSSV ${studentCode}.` });
    }

    return json({ error: "Thao tác không hợp lệ." }, 400);
  } catch (cause) {
    console.error("swift-api request failed", cause);
    return json({ error: cause instanceof Error ? cause.message : "Không thể xử lý yêu cầu." }, 400);
  }
});
